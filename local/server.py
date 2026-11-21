#! /usr/bin/env python
'''Offline backend for DropVault.

One process on http://localhost:4000 that plays API Gateway: it routes every
request to the REAL Lambda handlers in ../endpoints (loaded unmodified, with
the shared layer endpoints/common on the import path), with AWS calls pointed
at LocalStack:

  /v1/users, /v1/login, /v1/refresh-token, /v1/logout, /v1/userinfo -> auth-service
  /v1/users/{user_id}/files/...                                    -> the file Lambdas
  /v1/admin/...                                                    -> admin
  /v1/d/{code}                                                     -> qr-link (public)

Like API Gateway, it runs the real authorizer Lambda before a protected route
and passes the caller to the handler in requestContext.authorizer.

On start it creates the S3 bucket (+ CORS), the files and users tables and the
SES sender identity in LocalStack. Accounts from older versions of this server
(local/.data/auth.json) are copied into the users table. Set ADMIN_EMAILS
(comma-separated) to make those accounts admins of the admin panel.
'''

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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.getenv('PORT', '4000'))
LOCALSTACK = os.getenv('LOCALSTACK_URL', 'http://localhost:4566')
REGION = 'eu-west-1'
BUCKET = 'enclave-files-local'
TABLE = 'enclave-files-local'
USERS_TABLE = 'enclave-users-local'
SENDER = 'no-reply@enclave.local'
HERE = os.path.dirname(os.path.abspath(__file__))
ENDPOINTS = os.path.join(HERE, '..', 'endpoints')
COMMON = os.path.join(ENDPOINTS, 'common', 'python')   # the shared Lambda layer
sys.path.insert(0, COMMON)
DATA_DIR = os.path.join(HERE, '.data')
LEGACY_USERS = os.path.join(DATA_DIR, 'auth.json')   # accounts of the old stand-in auth service


def token_secret():
    '''The key that signs session tokens, kept so sessions survive a restart.'''
    path = os.path.join(DATA_DIR, 'token_secret')
    try:
        with open(path) as handle:
            return handle.read().strip()
    except FileNotFoundError:
        os.makedirs(DATA_DIR, exist_ok=True)
        secret = secrets.token_urlsafe(36)
        with open(path, 'w') as handle:
            handle.write(secret)
        return secret


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
    'USERS_TABLE': USERS_TABLE,
    'TOKEN_SECRET': token_secret(),
    'APP_ENV': 'local',
    'USER_FILES_BUCKET': BUCKET,
    # 127.0.0.1, not localhost: on Windows Python tries ::1 first and stalls ~2s
    'AUTH_ENDPOINT': 'http://127.0.0.1:{0}'.format(PORT),
    'SENDER_EMAIL': SENDER,
    'SENDER_SES_ARN': 'arn:aws:ses:{0}:000000000000:identity/{1}'.format(REGION, SENDER),
    'APP_NAME': 'DropVault',
    'PUBLIC_API_URL': 'http://localhost:{0}'.format(PORT),  # base of QR short links
    'KMS_ALIAS_PREFIX': 'enclave-local',
})
os.environ.setdefault('USER_QUOTA_BYTES', str(10 * 1024 ** 3))   # 10 GiB, like the AWS default
os.environ.setdefault('KMS_MODE', 's3')
os.environ.setdefault('ADMIN_EMAILS', '')

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
# LocalStack bootstrap (the table mirrors terraform/dynamodb.tf)
# ---------------------------------------------------------------------------
TABLE_ATTRIBUTES = [
    {'AttributeName': 'file_id', 'AttributeType': 'S'},
    {'AttributeName': 'user_id', 'AttributeType': 'S'},
    {'AttributeName': 'uploaded_at', 'AttributeType': 'S'},
    {'AttributeName': 'target_file_id', 'AttributeType': 'S'},
    {'AttributeName': 'created_at', 'AttributeType': 'N'},
]
TABLE_INDEXES = [
    {'IndexName': 'user-files', 'Projection': {'ProjectionType': 'ALL'},
     'KeySchema': [{'AttributeName': 'user_id', 'KeyType': 'HASH'},
                   {'AttributeName': 'uploaded_at', 'KeyType': 'RANGE'}]},
    {'IndexName': 'file-links', 'Projection': {'ProjectionType': 'ALL'},
     'KeySchema': [{'AttributeName': 'target_file_id', 'KeyType': 'HASH'},
                   {'AttributeName': 'created_at', 'KeyType': 'RANGE'}]},
]


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
                         AttributeDefinitions=TABLE_ATTRIBUTES, GlobalSecondaryIndexes=TABLE_INDEXES)
        ddb.get_waiter('table_exists').wait(TableName=TABLE)
    else:
        # a table from before the indexes existed: add the missing ones
        have = {i['IndexName'] for i in ddb.describe_table(TableName=TABLE)['Table']
                .get('GlobalSecondaryIndexes', [])}
        for index in TABLE_INDEXES:
            if index['IndexName'] not in have:
                ddb.update_table(TableName=TABLE, AttributeDefinitions=TABLE_ATTRIBUTES,
                                 GlobalSecondaryIndexUpdates=[{'Create': index}])

    # like terraform/dynamodb.tf: records with a `ttl` (unfinished uploads,
    # expired links, old stats and audit entries) are removed after it
    ttl = ddb.describe_time_to_live(TableName=TABLE).get('TimeToLiveDescription', {})
    if ttl.get('TimeToLiveStatus') not in ('ENABLED', 'ENABLING'):
        ddb.update_time_to_live(TableName=TABLE, TimeToLiveSpecification={'Enabled': True, 'AttributeName': 'ttl'})

    if USERS_TABLE not in ddb.list_tables().get('TableNames', []):
        ddb.create_table(TableName=USERS_TABLE, BillingMode='PAY_PER_REQUEST',
                         KeySchema=[{'AttributeName': 'email', 'KeyType': 'HASH'}],
                         AttributeDefinitions=[{'AttributeName': 'email', 'AttributeType': 'S'}])
        ddb.get_waiter('table_exists').wait(TableName=USERS_TABLE)
    import_legacy_users()

    boto3.client('ses', region_name=REGION).verify_email_identity(EmailAddress=SENDER)
    print('[aws] LocalStack ready: bucket={0} table={1} kms_mode={2}'.format(
        BUCKET, TABLE, os.environ['KMS_MODE']))
    if os.environ['ADMIN_EMAILS']:
        print('[api] Admins: {0} (admin panel at http://localhost:3001/admin)'.format(os.environ['ADMIN_EMAILS']))


def import_legacy_users():
    '''Copy accounts made by the old stand-in auth service into the users table
       (same user ids and password hashes, so sign-ins and files carry over).'''
    try:
        with open(LEGACY_USERS) as handle:
            legacy = json.load(handle).get('users', {})
    except (FileNotFoundError, ValueError):
        return
    users = boto3.resource('dynamodb', region_name=REGION).Table(USERS_TABLE)
    copied = 0
    for user in legacy.values():
        if not (user.get('email') and user.get('user_id') and user.get('password')):
            continue
        try:
            # no created_at: the old server didn't record when they signed up
            users.put_item(Item={'email': user['email'], 'user_id': user['user_id'], 'name': user.get('name') or '',
                                 'password': user['password']},
                           ConditionExpression='attribute_not_exists(email)')
            copied += 1
        except users.meta.client.exceptions.ConditionalCheckFailedException:
            pass
    if copied:
        print('[auth] Copied {0} account(s) from {1}'.format(copied, LEGACY_USERS))


# ---------------------------------------------------------------------------
# Load the Lambda handlers. Shared code comes from endpoints/common (on
# sys.path above), just like the Lambda layer on AWS.
# ---------------------------------------------------------------------------
def load_handler(folder, module):
    src = os.path.join(ENDPOINTS, folder, 'src')
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
PUBLIC = False      # no authorizer (anyone may open it)
PROTECTED = True    # runs the authorizer first, like on AWS
AUTH = ('auth-service', 'auth_service')
ADMIN = ('admin', 'admin')
ROUTES = [
    ('POST', r'^/v1/users$', AUTH, PUBLIC),
    ('POST', r'^/v1/login$', AUTH, PUBLIC),
    ('POST', r'^/v1/refresh-token$', AUTH, PUBLIC),
    ('POST', r'^/v1/logout$', AUTH, PUBLIC),
    ('GET', r'^/v1/userinfo$', AUTH, PUBLIC),
    ('POST', r'^/v1/users/{0}/files$'.format(SEG), ('upload-file', 'upload_file'), PROTECTED),
    ('POST', r'^/v1/users/{0}/files/{0}/parts$'.format(SEG), ('upload-file', 'upload_file'), PROTECTED),
    ('GET', r'^/v1/users/{0}/files$'.format(SEG), ('get-user-files', 'get_user_files'), PROTECTED),
    ('POST', r'^/v1/users/{0}/files/{0}/complete$'.format(SEG), ('complete-upload', 'complete_upload'), PROTECTED),
    ('GET', r'^/v1/users/{0}/files/{0}/download$'.format(SEG), ('download-file', 'download_file'), PROTECTED),
    ('POST', r'^/v1/users/{0}/files/{0}/share$'.format(SEG), ('share-file', 'share_file'), PROTECTED),
    ('DELETE', r'^/v1/users/{0}/files/{0}$'.format(SEG), ('delete-user-file', 'delete_user_file'), PROTECTED),
    ('POST', r'^/v1/users/{0}/files/{0}/qr$'.format(SEG), ('qr-link', 'qr_link'), PROTECTED),
    ('DELETE', r'^/v1/users/{0}/files/{0}/qr$'.format(SEG), ('qr-link', 'qr_link'), PROTECTED),
    ('GET', r'^/v1/users/{0}/files/{0}/links$'.format(SEG), ('qr-link', 'qr_link'), PROTECTED),
    ('DELETE', r'^/v1/users/{0}/files/{0}/links/{0}$'.format(SEG), ('qr-link', 'qr_link'), PROTECTED),
    ('GET', r'^/v1/d/{0}$'.format(SEG), ('qr-link', 'qr_link'), PUBLIC),
    ('POST', r'^/v1/d/{0}$'.format(SEG), ('qr-link', 'qr_link'), PUBLIC),
] + [(method, r'^/v1/admin/.+$', ADMIN, PROTECTED) for method in ('GET', 'POST', 'PATCH', 'DELETE')]
HANDLERS = {}
AUTHORIZER = ('authorizer', 'authorizer')
METHOD_ARN = 'arn:aws:execute-api:{0}:000000000000:local/local/GET/v1'.format(REGION)


def authorize(authorization):
    '''What API Gateway does before a protected route: run the authorizer
       Lambda. Returns the caller {user_id, name, email}, or None.'''
    try:
        result = HANDLERS[AUTHORIZER]({'authorizationToken': authorization or '', 'methodArn': METHOD_ARN}, None)
    except Exception:  # "Unauthorized"
        return None
    return result['context']



# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------
CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
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
        url = urllib.parse.urlsplit(self.path)
        path = url.path.rstrip('/') or '/'
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length).decode() if length else ''
        headers = {k.lower(): v for k, v in self.headers.items()}

        for method, pattern, target, protected in ROUTES:
            if self.command != method or not re.match(pattern, path):
                continue
            event = {
                'httpMethod': method,
                'path': path,
                'headers': {'Authorization': headers.get('authorization'),
                            'Content-Type': headers.get('content-type')},
                'queryStringParameters': dict(urllib.parse.parse_qsl(url.query)) or None,
                'body': raw or None,
                'requestContext': {},
            }
            if protected:
                caller = authorize(headers.get('authorization'))
                if not caller:
                    self.send(401, {'message': 'Unauthorized'})
                    return
                event['requestContext']['authorizer'] = caller
            result = HANDLERS[target](event, None)
            body = result.get('body') or ''
            self.send(result['statusCode'], body.encode(), result.get('headers') or {})
            return
        self.send(404, {'message': 'Not found: {0} {1}'.format(self.command, path)})

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any


def main():
    bootstrap_aws()
    for target in [route[2] for route in ROUTES] + [AUTHORIZER]:
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
    print('[api] DropVault local API on http://localhost:{0}  (auth + file API)'.format(PORT))
    print('[api] Sent emails: {0}/_aws/ses'.format(LOCALSTACK), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
