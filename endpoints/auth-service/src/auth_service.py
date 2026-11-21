#! /usr/bin/env python
'''Simple auth service for DropVault: email + password sign-up and sign-in.

Routes (API Gateway REST, Lambda proxy):
  POST /v1/users          {full_name, email, password} -> tokens + user_id (signed in)
  POST /v1/login          {email, password}            -> tokens
  POST /v1/refresh-token  {refresh_token}              -> new tokens
  POST /v1/logout         Authorization: Bearer <access token> (or {access_token})
                                                        -> 200, revokes every refresh token
  GET  /v1/userinfo       Authorization: Bearer <id or access token>
                                                        -> {user_id, name, email}

The file Lambdas validate callers by calling /v1/userinfo, exactly as they would
against any other auth microservice. Users live in DynamoDB (key: email);
passwords are PBKDF2-SHA256 hashed; tokens are HMAC-SHA256 signed with
TOKEN_SECRET and carry their own expiry, so no token storage is needed.
'''

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid

import boto3

TABLE = boto3.resource('dynamodb').Table(os.environ['USERS_TABLE'])
SECRET = os.environ['TOKEN_SECRET'].encode()
ACCESS_TTL = 3600            # 1 hour
REFRESH_TTL = 30 * 24 * 3600  # 30 days
PBKDF2_ROUNDS = 200000
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


# --- passwords ---------------------------------------------------------------
def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(),
                                 PBKDF2_ROUNDS).hex()
    return '{0}${1}'.format(salt, digest)


def check_password(password, stored):
    salt = stored.split('$', 1)[0]
    return hmac.compare_digest(hash_password(password, salt), stored)


# Hashed when the email is unknown, so a failed login takes the same time
# whether or not the account exists (no account enumeration by timing).
DUMMY_HASH = hash_password(secrets.token_hex(16))


def text(body, field):
    '''A string field from the JSON body ('' if missing or not a string).'''
    value = body.get(field)
    return value if isinstance(value, str) else ''


# --- tokens ------------------------------------------------------------------
def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def _unb64(text):
    return base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))


def sign(claims):
    payload = _b64(json.dumps(claims, separators=(',', ':')).encode())
    sig = _b64(hmac.new(SECRET, payload.encode(), hashlib.sha256).digest())
    return payload + '.' + sig


def verify(token, allowed_types):
    try:
        payload, sig = token.split('.', 1)
        expected = _b64(hmac.new(SECRET, payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        claims = json.loads(_unb64(payload))
    except (ValueError, TypeError):
        return None
    if not isinstance(claims, dict) or claims.get('typ') not in allowed_types:
        return None
    exp = claims.get('exp')
    if not isinstance(exp, (int, float)) or exp < time.time():
        return None
    return claims


def issue_tokens(user):
    now = int(time.time())
    base = {'sub': user['user_id'], 'email': user['email'], 'name': user['name'], 'iat': now}
    # Refresh tokens carry the user's token version; logout bumps it, which
    # revokes every refresh token issued before (access tokens expire in 1h).
    return {
        'id_token': sign(dict(base, typ='id', exp=now + ACCESS_TTL)),
        'access_token': sign(dict(base, typ='access', exp=now + ACCESS_TTL)),
        'refresh_token': sign(dict(base, typ='refresh', exp=now + REFRESH_TTL,
                                   ver=int(user.get('token_version', 0)))),
        'token_type': 'Bearer',
        'expires_in': ACCESS_TTL,
    }


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
    user = {'email': email, 'user_id': str(uuid.uuid4()), 'name': name,
            'password': hash_password(password), 'created_at': int(time.time())}
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
    return respond(200, issue_tokens(user))


def refresh(body):
    claims = verify(text(body, 'refresh_token'), ('refresh',))
    if not claims:
        return respond(401, {'message': 'Invalid refresh token'})
    user = TABLE.get_item(Key={'email': claims['email']}).get('Item')
    if (not user or user.get('user_id') != claims.get('sub')
            or int(claims.get('ver', 0)) != int(user.get('token_version', 0))):
        return respond(401, {'message': 'Invalid refresh token'})
    return respond(200, issue_tokens(user))


def bearer(headers):
    auth = next((v for k, v in headers.items() if k.lower() == 'authorization'), '') or ''
    return auth[7:].strip() if auth.lower().startswith('bearer ') else auth.strip()


def logout(headers, body):
    '''Revoke all of the caller's refresh tokens (signs out every device once
       their current 1-hour access token runs out).'''
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
