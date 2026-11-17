#! /usr/bin/env python
'''Simple auth service for Enclave: email + password sign-up and sign-in.

Routes (API Gateway REST, Lambda proxy):
  POST /v1/users          {full_name, email, password} -> tokens + user_id (signed in)
  POST /v1/login          {email, password}            -> tokens
  POST /v1/refresh-token  {refresh_token}              -> new tokens
  POST /v1/logout                                       -> 200 (tokens are stateless)
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
    if claims.get('typ') not in allowed_types or claims.get('exp', 0) < time.time():
        return None
    return claims


def issue_tokens(user):
    now = int(time.time())
    base = {'sub': user['user_id'], 'email': user['email'], 'name': user['name'], 'iat': now}
    return {
        'id_token': sign(dict(base, typ='id', exp=now + ACCESS_TTL)),
        'access_token': sign(dict(base, typ='access', exp=now + ACCESS_TTL)),
        'refresh_token': sign(dict(base, typ='refresh', exp=now + REFRESH_TTL)),
        'token_type': 'Bearer',
        'expires_in': ACCESS_TTL,
    }


# --- routes ------------------------------------------------------------------
def sign_up(body):
    email = (body.get('email') or '').strip().lower()
    name = (body.get('full_name') or '').strip()
    password = body.get('password') or ''
    if not name or not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
        return respond(400, {'message': 'Full name and a valid email are required'})
    if len(password) < 8:
        return respond(400, {'message': 'Password must be at least 8 characters'})
    user = {'email': email, 'user_id': str(uuid.uuid4()), 'name': name,
            'password': hash_password(password), 'created_at': int(time.time())}
    try:
        TABLE.put_item(Item=user, ConditionExpression='attribute_not_exists(email)')
    except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
        return respond(409, {'message': 'An account with this email already exists'})
    return respond(201, dict(issue_tokens(user), user_id=user['user_id'], email=email))


def login(body):
    email = (body.get('email') or '').strip().lower()
    user = TABLE.get_item(Key={'email': email}).get('Item') if email else None
    if not user or not check_password(body.get('password') or '', user['password']):
        return respond(401, {'message': 'Incorrect email or password'})
    return respond(200, issue_tokens(user))


def refresh(body):
    claims = verify(body.get('refresh_token') or '', ('refresh',))
    if not claims:
        return respond(401, {'message': 'Invalid refresh token'})
    user = TABLE.get_item(Key={'email': claims['email']}).get('Item')
    if not user:
        return respond(401, {'message': 'Invalid refresh token'})
    return respond(200, issue_tokens(user))


def userinfo(headers):
    auth = next((v for k, v in headers.items() if k.lower() == 'authorization'), '') or ''
    token = auth[7:].strip() if auth.lower().startswith('bearer ') else auth.strip()
    claims = verify(token, ('id', 'access'))
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

    try:
        if method == 'POST' and path.endswith('/v1/users'):
            return sign_up(body)
        if method == 'POST' and path.endswith('/v1/login'):
            return login(body)
        if method == 'POST' and path.endswith('/v1/refresh-token'):
            return refresh(body)
        if method == 'POST' and path.endswith('/v1/logout'):
            return respond(200, {'message': 'Logged out'})
        if method == 'GET' and path.endswith('/v1/userinfo'):
            return userinfo(headers)
        return respond(404, {'message': 'Not found'})
    except Exception as error:  # pylint: disable=broad-except
        print('auth error: {0}'.format(error))
        return respond(500, {'message': 'Internal server error'})
