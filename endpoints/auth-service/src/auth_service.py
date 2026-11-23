#! /usr/bin/env python
'''Simple auth service for DropVault: email + password sign-up and sign-in.

Routes (API Gateway REST, Lambda proxy):
  POST /v1/users          {full_name, email, password} -> tokens + user_id + role (signed in)
  POST /v1/login          {email, password}            -> tokens + role (403 if suspended)
  POST /v1/refresh-token  {refresh_token}              -> new tokens + role
  POST /v1/logout         Authorization: Bearer <access token> (or {access_token}
                          or {refresh_token})           -> 200, ends every session
  POST /v1/password       Authorization: Bearer <access token>
                          {current_password, new_password} -> new tokens; signs out
                                                        every other device
  GET  /v1/userinfo       Authorization: Bearer <id or access token>
                                                        -> {user_id, name, email}

Rate limits (ratelimit.py in the shared layer, all configurable):
  sign-in      LOGIN_PER_IP attempts per IP and LOGIN_FAILURES wrong passwords
               per account, per 15 minutes (429 + Retry-After after that)
  sign-up      SIGNUPS_PER_IP per IP per hour
  password     wrong current passwords count as failed sign-ins

The owner admins (ADMIN_EMAILS) can't be signed up for through the API,
because there is no email verification: whoever registered the address first
would become an admin. The owner sets up (or recovers) that account with
terraform/admin-account.sh, which invokes this Lambda directly - something
only AWS credentials for the account allow:
  {"action": "owner_password", "email": "...", "name"?: "..."}
      -> {email, temporary_password, created}

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
import ratelimit
import tokens

TABLE = boto3.resource('dynamodb').Table(os.environ['USERS_TABLE'])
ACCESS_TTL = 3600            # 1 hour
REFRESH_TTL = 30 * 24 * 3600  # 30 days
MAX_EMAIL = 254
MAX_NAME = 100
MAX_PASSWORD = 256
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
WINDOW = 15 * 60          # sign-in limits count per 15 minutes
SIGNUP_WINDOW = 3600      # sign-up limit counts per hour

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Cache-Control': 'no-store',          # answers carry tokens
    'X-Content-Type-Options': 'nosniff',
}
EXISTS = 'An account with this email already exists'


def respond(status, body, headers=None):
    return {'statusCode': status, 'headers': dict(CORS_HEADERS, **(headers or {})),
            'body': json.dumps(body), 'isBase64Encoded': False}


def too_many(limited, message):
    return respond(429, {'message': message.format(ratelimit.wait_text(limited.retry_after)),
                         'retry_after': limited.retry_after},
                   {'Retry-After': str(limited.retry_after)})


def login_per_ip():
    return ratelimit.env_limit('LOGIN_PER_IP', 100)


def login_failures():
    return ratelimit.env_limit('LOGIN_FAILURES', 10)


def signups_per_ip():
    return ratelimit.env_limit('SIGNUPS_PER_IP', 20)


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
def sign_up(body, event):
    try:
        ratelimit.hit(ratelimit.subject('signup-ip', ratelimit.source_ip(event)), signups_per_ip(), SIGNUP_WINDOW)
    except ratelimit.Limited as limited:
        return too_many(limited, 'Too many new accounts from your network. Try again in {0}.')
    email = text(body, 'email').strip().lower()
    name = ' '.join(text(body, 'full_name').split())   # collapse whitespace / newlines
    password = text(body, 'password')
    if not name or len(email) > MAX_EMAIL or not EMAIL_RE.match(email):
        return respond(400, {'message': 'Full name and a valid email are required'})
    if len(name) > MAX_NAME:
        return respond(400, {'message': 'Full name must be at most {0} characters'.format(MAX_NAME)})
    if len(password) < 8 or len(password) > MAX_PASSWORD:
        return respond(400, {'message': 'Password must be 8 to {0} characters'.format(MAX_PASSWORD)})
    if email in accounts.owner_emails():
        # Same answer as a taken address: an owner admin's account is set up
        # with terraform/admin-account.sh, never by whoever signs up first.
        return respond(409, {'message': EXISTS})
    now = int(time.time())
    user = {'email': email, 'user_id': str(uuid.uuid4()), 'name': name,
            'password': hash_password(password), 'created_at': now,
            'last_login_at': now, 'login_count': 1}   # signing up signs you in
    try:
        TABLE.put_item(Item=user, ConditionExpression='attribute_not_exists(email)')
    except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
        return respond(409, {'message': EXISTS})
    return respond(201, dict(issue_tokens(user), user_id=user['user_id'], email=email))


def count_failure(fail_key):
    '''One more wrong password for this account (the attempt itself is
       answered either way).'''
    try:
        ratelimit.hit(fail_key, login_failures(), WINDOW)
    except ratelimit.Limited:
        pass


def login(body, event):
    email = text(body, 'email').strip().lower()
    password = text(body, 'password')[:MAX_PASSWORD]
    fail_key = ratelimit.subject('login-fail', email)
    try:
        ratelimit.hit(ratelimit.subject('login-ip', ratelimit.source_ip(event)), login_per_ip(), WINDOW)
    except ratelimit.Limited as limited:
        return too_many(limited, 'Too many sign-in attempts from your network. Try again in {0}.')
    try:
        # Counted per address whether or not the account exists, so the
        # answer doesn't reveal which addresses have accounts.
        ratelimit.check(fail_key, login_failures(), WINDOW)
    except ratelimit.Limited as limited:
        return too_many(limited, 'Too many wrong passwords for this account. Try again in {0}, '
                                 'or ask an administrator to reset your password.')
    user = None
    if email and len(email) <= MAX_EMAIL:
        user = TABLE.get_item(Key={'email': email}).get('Item')
    if not user:
        check_password(password, DUMMY_HASH)
        count_failure(fail_key)
        return respond(401, {'message': 'Incorrect email or password'})
    if not check_password(password, user['password']):
        count_failure(fail_key)
        return respond(401, {'message': 'Incorrect email or password'})
    if accounts.is_suspended(user):
        return respond(403, {'message': SUSPENDED})
    ratelimit.clear(fail_key, WINDOW)
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
    '''End all of the caller's sessions, on every device. Takes the access
       token, or the refresh token (the access token may have expired while
       the tab slept, and the refresh token is the one worth ending).'''
    claims = (verify(bearer(headers) or text(body, 'access_token'), ('id', 'access'))
              or verify(text(body, 'refresh_token'), ('refresh',)))
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


def current_user(headers):
    '''(claims, account) for a signed-in caller whose session is still live
       (not signed out, suspended or deleted), else (None, None).'''
    claims = verify(bearer(headers), ('id', 'access'))
    if not claims:
        return None, None
    user = TABLE.get_item(Key={'email': claims['email']}).get('Item')
    if not accounts.session_valid(user, claims):
        return None, None
    return claims, user


def userinfo(headers):
    claims, _user = current_user(headers)
    if not claims:
        return respond(401, {'message': 'Unauthorized'})
    return respond(200, {'user_id': claims['sub'], 'name': claims['name'],
                         'email': claims['email']})


def change_password(headers, body):
    '''The caller sets a new password. Every other session ends; this one
       gets fresh tokens so it stays signed in.'''
    claims, user = current_user(headers)
    if not claims:
        return respond(401, {'message': 'Unauthorized'})
    fail_key = ratelimit.subject('login-fail', user['email'])
    try:
        ratelimit.check(fail_key, login_failures(), WINDOW)
    except ratelimit.Limited as limited:
        return too_many(limited, 'Too many wrong passwords for this account. Try again in {0}.')
    new_password = text(body, 'new_password')
    if not check_password(text(body, 'current_password')[:MAX_PASSWORD], user['password']):
        count_failure(fail_key)
        return respond(400, {'message': 'Your current password is incorrect'})
    if len(new_password) < 8 or len(new_password) > MAX_PASSWORD:
        return respond(400, {'message': 'Password must be 8 to {0} characters'.format(MAX_PASSWORD)})
    try:
        updated = TABLE.update_item(
            Key={'email': user['email']},
            UpdateExpression='SET password = :p, password_changed_at = :now ADD token_version :one',
            ConditionExpression='user_id = :uid AND password = :old',
            ExpressionAttributeValues={':p': hash_password(new_password), ':now': int(time.time()), ':one': 1,
                                       ':uid': user['user_id'], ':old': user['password']},
            ReturnValues='ALL_NEW')['Attributes']
    except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
        return respond(409, {'message': 'Your password was changed somewhere else. Sign in again.'})
    return respond(200, dict(issue_tokens(updated), message='Password changed'))


def owner_password(event):
    '''Direct invocation only (terraform/admin-account.sh): create an owner
       admin's account, or give it a new temporary password.'''
    email = str(event.get('email') or '').strip().lower()
    if email not in accounts.owner_emails():
        return {'error': '{0} is not in admin_emails'.format(email or 'That address')}
    password = accounts.temporary_password()
    now = int(time.time())
    name = ' '.join(str(event.get('name') or '').split())[:MAX_NAME] or 'Admin'
    try:
        TABLE.put_item(Item={'email': email, 'user_id': str(uuid.uuid4()), 'name': name,
                             'password': hash_password(password), 'created_at': now},
                       ConditionExpression='attribute_not_exists(email)')
        created = True
    except TABLE.meta.client.exceptions.ConditionalCheckFailedException:
        TABLE.update_item(Key={'email': email},
                          UpdateExpression='SET password = :p, password_reset_at = :now '
                                           'REMOVE suspended_at ADD token_version :one',
                          ExpressionAttributeValues={':p': hash_password(password), ':now': now, ':one': 1})
        created = False
    ratelimit.clear(ratelimit.subject('login-fail', email), WINDOW)
    print('owner account {0}: {1}'.format('created' if created else 'password reset', email))
    return {'email': email, 'temporary_password': password, 'created': created}


# --- feature switches the web app reads at start-up (GET /v1/features) -------
# Email sharing: "auto" (default) turns it on by itself once AWS takes SES out of
# the sandbox, because before that mail only reaches verified addresses.
# "on"/"off" force it. SES is asked at most every FEATURE_TTL seconds per
# Lambda instance; if the check fails the last answer stands.
FEATURE_TTL = 600
SES_STATE = {'checked': 0.0, 'production': False}


def ses_production():
    now = time.time()
    if now - SES_STATE['checked'] >= FEATURE_TTL:
        try:
            account = boto3.client('sesv2').get_account()
            SES_STATE['production'] = bool(account.get('ProductionAccessEnabled'))
        except Exception as error:  # pylint: disable=broad-except
            print('SES account check failed: {0}'.format(error))
        SES_STATE['checked'] = now
    return SES_STATE['production']


def email_sharing_enabled():
    setting = (os.environ.get('EMAIL_SHARING') or 'auto').strip().lower()
    if setting in ('on', 'off'):
        return setting == 'on'
    return ses_production()


def features():
    return respond(200, {'email_sharing': email_sharing_enabled()}, {'Cache-Control': 'public, max-age=300'})


def lambda_handler(event, _context):
    event = event or {}
    if 'httpMethod' not in event and event.get('action') == 'owner_password':
        return owner_password(event)   # direct invocation; API Gateway always sets httpMethod
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
            return sign_up(body, event)
        if method == 'POST' and path.endswith('/v1/login'):
            return login(body, event)
        if method == 'POST' and path.endswith('/v1/password'):
            return change_password(headers, body)
        if method == 'POST' and path.endswith('/v1/refresh-token'):
            return refresh(body)
        if method == 'POST' and path.endswith('/v1/logout'):
            return logout(headers, body)
        if method == 'GET' and path.endswith('/v1/userinfo'):
            return userinfo(headers)
        if method == 'GET' and path.endswith('/v1/features'):
            return features()
        return respond(404, {'message': 'Not found'})
    except Exception as error:  # pylint: disable=broad-except
        print('auth error: {0}'.format(error))
        return respond(500, {'message': 'Internal server error'})
