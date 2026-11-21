#! /usr/bin/env python
'''Simple auth service for DropVault: email + password sign-up and sign-in.

Routes (API Gateway REST, Lambda proxy):
  POST /v1/users          {full_name, email, password} -> tokens + user_id + role (signed in)
  POST /v1/login          {email, password}            -> tokens + role (403 if suspended)
  POST /v1/refresh-token  {refresh_token}              -> new tokens + role
  POST /v1/logout         Authorization: Bearer <access token> (or {access_token})
                                                        -> 200, ends every session
  GET  /v1/userinfo       Authorization: Bearer <id or access token>
                                                        -> {user_id, name, email}

/v1/userinfo is what lets any other service (or an external setup without the
API Gateway authorizer) validate a caller. Users live in DynamoDB (key: email);
passwords are PBKDF2-SHA256 hashed; tokens (see tokens.py in the shared
layer) are HMAC-SHA256 signed and carry their own expiry. The API Gateway
authorizer checks the same tokens without calling this service.

Every token carries the account's token_version as `ver`. Logging out (and
an admin suspending the account, resetting its password or signing it out)
bumps the version, which ends every session: refresh tokens stop working
here, and the authorizer turns away the old access tokens. `role` ("admin" or
"user") tells the web app whether to show the admin panel; the admin API
checks it again on every request (accounts.py in the shared layer).
'''

import json
import os
import re
import secrets
import time
import uuid

import boto3

import accounts
import tokens

TABLE = boto3.resource('dynamodb').Table(os.environ['USERS_TABLE'])
ACCESS_TTL = 3600            # 1 hour
REFRESH_TTL = 30 * 24 * 3600  # 30 days
MAX_EMAIL = 254
MAX_NAME = 100
MAX_PASSWORD = 256
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}


def respond(status, body):
    return {'statusCode': status, 'headers': CORS_HEADERS,
            'body': json.dumps(body), 'isBase64Encoded': False}


# --- passwords (PBKDF2-SHA256, shared with the admin panel's password reset) --
hash_password = accounts.hash_password
check_password = accounts.check_password
SUSPENDED = 'This account has been suspended. Contact the administrator if you think this is a mistake.'

# Hashed when the email is unknown, so a failed login takes the same time
# whether or not the account exists (no account enumeration by timing).
DUMMY_HASH = hash_password(secrets.token_hex(16))


def text(body, field):
    '''A string field from the JSON body ('' if missing or not a string).'''
    value = body.get(field)
    return value if isinstance(value, str) else ''


# --- tokens (signing lives in the shared layer: common/python/tokens.py) -----
sign = tokens.sign
verify = tokens.verify


def issue_tokens(user):
    now = int(time.time())
    # Every token carries the user's token version; bumping it (logout,
    # suspend, password reset) ends every session issued before.
    base = {'sub': user['user_id'], 'email': user['email'], 'name': user['name'], 'iat': now,
            'ver': int(user.get('token_version', 0))}
    return {
        'id_token': sign(dict(base, typ='id', exp=now + ACCESS_TTL)),
        'access_token': sign(dict(base, typ='access', exp=now + ACCESS_TTL)),
        'refresh_token': sign(dict(base, typ='refresh', exp=now + REFRESH_TTL)),
        'token_type': 'Bearer',
        'expires_in': ACCESS_TTL,
        'role': accounts.role(user),
    }


def record_login(user):
    '''Last sign-in time and count, shown in the admin panel (best effort).'''
    try:
        TABLE.update_item(Key={'email': user['email']},
                          UpdateExpression='SET last_login_at = :now ADD login_count :one',
                          ExpressionAttributeValues={':now': int(time.time()), ':one': 1})
    except Exception as error:  # pylint: disable=broad-except
        print('could not record login: {0}'.format(error))


# --- routes ------------------------------------------------------------------
def sign_up(body):
    email = text(body, 'email').strip().lower()
    name = ' '.join(text(body, 'full_name').split())   # collapse whitespace / newlines
    password = text(body, 'password')
    if not name or len(email) > MAX_EMAIL or not EMAIL_RE.match(email):
        return respond(400, {'message': 'Full name and a valid email are required'})
    if len(name) > MAX_NAME:
        return respond(400, {'message': 'Full name must be at most {0} characters'.format(MAX_NAME)})
    if len(password) < 8 or len(password) > MAX_PASSWORD:
        return respond(400, {'message': 'Password must be 8 to {0} characters'.format(MAX_PASSWORD)})
    now = int(time.time())
    user = {'email': email, 'user_id': str(uuid.uuid4()), 'name': name,
            'password': hash_password(password), 'created_at': now,
            'last_login_at': now, 'login_count': 1}   # signing up signs you in
    try:
        TABLE.put_item(Item=user, ConditionExpression='attribute_not_exists(email)')
    except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
        return respond(409, {'message': 'An account with this email already exists'})
    return respond(201, dict(issue_tokens(user), user_id=user['user_id'], email=email))


def login(body):
    email = text(body, 'email').strip().lower()
    password = text(body, 'password')[:MAX_PASSWORD]
    user = None
    if email and len(email) <= MAX_EMAIL:
        user = TABLE.get_item(Key={'email': email}).get('Item')
    if not user:
        check_password(password, DUMMY_HASH)
        return respond(401, {'message': 'Incorrect email or password'})
    if not check_password(password, user['password']):
        return respond(401, {'message': 'Incorrect email or password'})
    if accounts.is_suspended(user):
        return respond(403, {'message': SUSPENDED})
    record_login(user)
    return respond(200, issue_tokens(user))


def refresh(body):
    claims = verify(text(body, 'refresh_token'), ('refresh',))
    if not claims:
        return respond(401, {'message': 'Invalid refresh token'})
    user = TABLE.get_item(Key={'email': claims['email']}).get('Item')
    if user and user.get('user_id') == claims.get('sub') and accounts.is_suspended(user):
        return respond(403, {'message': SUSPENDED})
    if not accounts.session_valid(user, claims):
        return respond(401, {'message': 'Invalid refresh token'})
    return respond(200, issue_tokens(user))


def bearer(headers):
    return tokens.strip_bearer(next((v for k, v in headers.items() if k.lower() == 'authorization'), ''))


def logout(headers, body):
    '''End all of the caller's sessions, on every device.'''
    claims = verify(bearer(headers) or text(body, 'access_token'), ('id', 'access'))
    if claims:
        try:
            TABLE.update_item(
                Key={'email': claims['email']},
                UpdateExpression='ADD token_version :one',
                ConditionExpression='attribute_exists(email) AND user_id = :uid',
                ExpressionAttributeValues={':one': 1, ':uid': claims['sub']},
            )
        except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
            pass  # account no longer exists: nothing to revoke
    return respond(200, {'message': 'Logged out'})


def userinfo(headers):
    claims = verify(bearer(headers), ('id', 'access'))
    if not claims:
        return respond(401, {'message': 'Unauthorized'})
    return respond(200, {'user_id': claims['sub'], 'name': claims['name'],
                         'email': claims['email']})


def lambda_handler(event, _context):
    method = event.get('httpMethod')
    path = (event.get('path') or '').rstrip('/')
    headers = event.get('headers') or {}
    try:
        body = json.loads(event.get('body') or '{}') if method == 'POST' else {}
    except ValueError:
        return respond(400, {'message': 'Invalid JSON body'})
    if not isinstance(body, dict):
        return respond(400, {'message': 'Body must be a JSON object'})

    try:
        if method == 'POST' and path.endswith('/v1/users'):
            return sign_up(body)
        if method == 'POST' and path.endswith('/v1/login'):
            return login(body)
        if method == 'POST' and path.endswith('/v1/refresh-token'):
            return refresh(body)
        if method == 'POST' and path.endswith('/v1/logout'):
            return logout(headers, body)
        if method == 'GET' and path.endswith('/v1/userinfo'):
            return userinfo(headers)
        return respond(404, {'message': 'Not found'})
    except Exception as error:  # pylint: disable=broad-except
        print('auth error: {0}'.format(error))
        return respond(500, {'message': 'Internal server error'})
