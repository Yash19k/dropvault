#! /usr/bin/env python
'''Offline backend for Enclave.

One process on http://localhost:4000 that plays two roles:

  1. API Gateway: routes /v1/users/{user_id}/files... to the REAL Lambda handlers
     in ../endpoints (loaded unmodified), with AWS calls pointed at LocalStack.
  2. A simple stand-in auth service (replacing CognitoApi): sign-up with full
     name + email + password, password login, and /v1/userinfo. No email
     confirmation and no MFA.

On start it creates the S3 bucket (+ CORS), the DynamoDB table and the SES
sender identity in LocalStack. Users are kept in local/.data/auth.json.
'''

import hashlib
import hmac
import importlib.util
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.getenv('PORT', '4000'))
LOCALSTACK = os.getenv('LOCALSTACK_URL', 'http://localhost:4566')
REGION = 'eu-west-1'
BUCKET = 'enclave-files-local'
TABLE = 'enclave-files-local'
SENDER = 'no-reply@enclave.local'
HERE = os.path.dirname(os.path.abspath(__file__))
ENDPOINTS = os.path.join(HERE, '..', 'endpoints')
DATA_FILE = os.path.join(HERE, '.data', 'auth.json')

# ---------------------------------------------------------------------------
# Environment the Lambdas expect (as Terraform would set it), aimed at LocalStack
# ---------------------------------------------------------------------------
os.environ.update({
    'AWS_ACCESS_KEY_ID': 'test',
    'AWS_SECRET_ACCESS_KEY': 'test',
    'AWS_DEFAULT_REGION': REGION,
    'AWS_ENDPOINT_URL': LOCALSTACK,
    'REGION': REGION,
    'FILE_SHARING_TABLE': TABLE,
    'USER_FILES_BUCKET': BUCKET,
    # 127.0.0.1, not localhost: on Windows Python tries ::1 first and stalls ~2s
    'AUTH_ENDPOINT': 'http://127.0.0.1:{0}'.format(PORT),
    'SENDER_EMAIL': SENDER,
    'SENDER_SES_ARN': 'arn:aws:ses:{0}:000000000000:identity/{1}'.format(REGION, SENDER),
    'APP_NAME': 'Enclave',
    'PUBLIC_API_URL': 'http://localhost:{0}'.format(PORT),  # base of QR short links
    'KMS_ALIAS_PREFIX': 'enclave-local',
})
os.environ.setdefault('KMS_MODE', 's3')

import boto3  # noqa: E402  (after env is set)
from botocore.config import Config  # noqa: E402

# The Lambdas hard-code the real regional S3 endpoint with virtual-host
# addressing. Redirect S3 to LocalStack with path-style URLs instead, so the
# presigned URLs the browser uses are http://localhost:4566/<bucket>/<key>.
_real_client = boto3.client


def _local_client(service_name, *args, **kwargs):
    if service_name == 's3':
        kwargs['endpoint_url'] = LOCALSTACK
        kwargs['config'] = Config(signature_version='s3v4', s3={'addressing_style': 'path'})
    return _real_client(service_name, *args, **kwargs)


boto3.client = _local_client


# ---------------------------------------------------------------------------
# LocalStack bootstrap
# ---------------------------------------------------------------------------
def bootstrap_aws():
    for attempt in range(60):
        try:
            s3 = boto3.client('s3', region_name=REGION)
            s3.list_buckets()
            break
        except Exception as error:  # LocalStack still starting
            if attempt == 59:
                sys.exit('LocalStack is not reachable at {0}: {1}'.format(LOCALSTACK, error))
            time.sleep(1)

    existing = [b['Name'] for b in s3.list_buckets().get('Buckets', [])]
    if BUCKET not in existing:
        s3.create_bucket(Bucket=BUCKET,
                         CreateBucketConfiguration={'LocationConstraint': REGION})
    s3.put_bucket_cors(Bucket=BUCKET, CORSConfiguration={'CORSRules': [{
        'AllowedOrigins': ['*'],
        'AllowedMethods': ['GET', 'PUT', 'HEAD'],
        'AllowedHeaders': ['*'],
        'ExposeHeaders': ['ETag'],
        'MaxAgeSeconds': 3000,
    }]})

    ddb = boto3.client('dynamodb', region_name=REGION)
    if TABLE not in ddb.list_tables().get('TableNames', []):
        ddb.create_table(TableName=TABLE, BillingMode='PAY_PER_REQUEST',
                         KeySchema=[{'AttributeName': 'file_id', 'KeyType': 'HASH'}],
                         AttributeDefinitions=[{'AttributeName': 'file_id', 'AttributeType': 'S'}])
        ddb.get_waiter('table_exists').wait(TableName=TABLE)

    boto3.client('ses', region_name=REGION).verify_email_identity(EmailAddress=SENDER)
    print('[aws] LocalStack ready: bucket={0} table={1} kms_mode={2}'.format(
        BUCKET, TABLE, os.environ['KMS_MODE']))


# ---------------------------------------------------------------------------
# Load the six Lambda handlers. Each has its own auth/log/constants modules
# with clashing names, so they are imported one directory at a time.
# ---------------------------------------------------------------------------
def load_handler(folder, module):
    src = os.path.join(ENDPOINTS, folder, 'src')
    for shared in ('auth', 'log', 'constants'):
        sys.modules.pop(shared, None)
    sys.path.insert(0, src)
    try:
        spec = importlib.util.spec_from_file_location(
            'lambda_' + module, os.path.join(src, module + '.py'))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    finally:
        sys.path.remove(src)
    return mod.lambda_handler


SEG = r'([^/]+)'
FILE_ROUTES = [
    ('POST', r'^/v1/users/{0}/files$'.format(SEG), ('upload-file', 'upload_file')),
    ('GET', r'^/v1/users/{0}/files$'.format(SEG), ('get-user-files', 'get_user_files')),
    ('POST', r'^/v1/users/{0}/files/{0}/complete$'.format(SEG), ('complete-upload', 'complete_upload')),
    ('GET', r'^/v1/users/{0}/files/{0}/download$'.format(SEG), ('download-file', 'download_file')),
    ('POST', r'^/v1/users/{0}/files/{0}/share$'.format(SEG), ('share-file', 'share_file')),
    ('DELETE', r'^/v1/users/{0}/files/{0}$'.format(SEG), ('delete-user-file', 'delete_user_file')),
    ('POST', r'^/v1/users/{0}/files/{0}/qr$'.format(SEG), ('qr-link', 'qr_link')),
    ('GET', r'^/v1/d/{0}$'.format(SEG), ('qr-link', 'qr_link')),
]
HANDLERS = {}


# ---------------------------------------------------------------------------
# Stand-in auth service (CognitoApi-compatible shapes used by web/src)
# ---------------------------------------------------------------------------
LOCK = threading.Lock()


def load_db():
    try:
        with open(DATA_FILE) as handle:
            return json.load(handle)
    except (FileNotFoundError, ValueError):
        return {'users': {}, 'tokens': {}}


DB = load_db()


def save_db():
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    with open(DATA_FILE, 'w') as handle:
        json.dump(DB, handle, indent=2)


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 200000).hex()
    return salt + '$' + digest


def check_password(password, stored):
    salt = stored.split('$', 1)[0]
    return hmac.compare_digest(hash_password(password, salt), stored)


def find_user(email):
    email = (email or '').strip().lower()
    for user in DB['users'].values():
        if user['email'] == email:
            return user
    return None


class AuthError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def issue_tokens(user):
    tokens = {
        'id_token': 'id-' + secrets.token_urlsafe(32),
        'access_token': 'ac-' + secrets.token_urlsafe(32),
        'refresh_token': 'rf-' + secrets.token_urlsafe(32),
        'token_type': 'Bearer',
        'expires_in': 3600,
    }
    for kind in ('id_token', 'access_token'):
        DB['tokens'][tokens[kind]] = user['user_id']
    DB['tokens'][tokens['refresh_token']] = 'refresh:' + user['user_id']
    return tokens


def auth_route(method, path, body, headers):
    '''Returns (status, payload) or None when the path is not an auth route.'''
    with LOCK:
        # Sign up: full name + email + password -> account is active immediately
        # and the caller is signed in (tokens returned). No email, no MFA.
        if method == 'POST' and path == '/v1/users':
            email = (body.get('email') or '').strip().lower()
            name = (body.get('full_name') or '').strip()
            password = body.get('password') or ''
            if not name or not re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', email):
                raise AuthError(400, 'Full name and a valid email are required')
            if len(password) < 8:
                raise AuthError(400, 'Password must be at least 8 characters')
            if find_user(email):
                raise AuthError(409, 'An account with this email already exists')
            user = {'user_id': str(uuid.uuid4()), 'email': email, 'name': name,
                    'password': hash_password(password)}
            DB['users'][user['user_id']] = user
            tokens = issue_tokens(user)
            save_db()
            print('[auth] New account: {0}'.format(email), flush=True)
            return 201, dict(tokens, user_id=user['user_id'], email=email)

        # Sign in: email + password -> tokens
        if method == 'POST' and path == '/v1/login':
            user = find_user(body.get('email'))
            if not user or not user.get('password') or not check_password(
                    body.get('password') or '', user['password']):
                raise AuthError(401, 'Incorrect email or password')
            tokens = issue_tokens(user)
            save_db()
            return 200, tokens

        if method == 'POST' and path == '/v1/refresh-token':
            owner = DB['tokens'].get(body.get('refresh_token') or '', '')
            user = DB['users'].get(owner.replace('refresh:', '', 1)) if owner.startswith('refresh:') else None
            if not user:
                raise AuthError(401, 'Invalid refresh token')
            tokens = issue_tokens(user)
            save_db()
            return 200, tokens

        if method == 'POST' and path == '/v1/logout':
            user_id = DB['tokens'].get(body.get('access_token') or '')
            if user_id:
                DB['tokens'] = {t: u for t, u in DB['tokens'].items()
                                if u not in (user_id, 'refresh:' + user_id)}
                save_db()
            return 200, {'message': 'Logged out'}

        if method == 'GET' and path == '/v1/userinfo':
            token = (headers.get('authorization') or '').replace('Bearer ', '', 1).strip()
            user = DB['users'].get(DB['tokens'].get(token, ''))
            if not user:
                raise AuthError(401, 'Unauthorized')
            return 200, {'user_id': user['user_id'], 'name': user['name'],
                         'email': user['email'], 'phone_number': user.get('phone')}
    return None


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        if '/v1/userinfo' not in self.path:  # the Lambdas call this on every request
            sys.stderr.write('[http] ' + (fmt % args) + '\n')

    def send(self, status, payload, extra_headers=None):
        data = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode()
        self.send_response(status)
        headers = dict(CORS)
        headers.setdefault('Content-Type', 'application/json')
        headers.update(extra_headers or {})
        headers['Content-Length'] = str(len(data))
        for key, value in headers.items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send(204, b'')

    def handle_any(self):
        path = urllib.parse.urlsplit(self.path).path.rstrip('/') or '/'
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length).decode() if length else ''
        headers = {k.lower(): v for k, v in self.headers.items()}

        # File API -> real Lambda handlers
        for method, pattern, (folder, module) in FILE_ROUTES:
            if self.command == method and re.match(pattern, path):
                event = {
                    'httpMethod': method,
                    'path': path,
                    'headers': {'Authorization': headers.get('authorization'),
                                'Content-Type': headers.get('content-type')},
                    'body': raw or None,
                }
                result = HANDLERS[(folder, module)](event, None)
                body = result.get('body') or ''
                self.send(result['statusCode'], body.encode(), result.get('headers') or {})
                return

        # Auth service
        try:
            body = json.loads(raw) if raw else {}
            result = auth_route(self.command, path, body, headers)
        except AuthError as error:
            self.send(error.status, {'message': str(error)})
            return
        except ValueError:
            self.send(400, {'message': 'Invalid JSON body'})
            return
        if result is None:
            self.send(404, {'message': 'Not found: {0} {1}'.format(self.command, path)})
        else:
            self.send(*result)

    do_GET = do_POST = do_PUT = do_DELETE = handle_any


def main():
    bootstrap_aws()
    for _method, _pattern, target in FILE_ROUTES:
        if target not in HANDLERS:
            HANDLERS[target] = load_handler(*target)
    # Listen on both loopbacks so "localhost" is instant whether it resolves to
    # 127.0.0.1 or ::1 (browsers on Windows try ::1 first).
    server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    try:
        class V6Server(ThreadingHTTPServer):
            address_family = socket.AF_INET6
        v6 = V6Server(('::1', PORT), Handler)
        threading.Thread(target=v6.serve_forever, daemon=True).start()
    except OSError:
        pass  # no IPv6 loopback - IPv4 only
    print('[api] Enclave local API on http://localhost:{0}  (auth + file API)'.format(PORT))
    print('[api] Sent emails: {0}/_aws/ses'.format(LOCALSTACK), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
