'''Test setup: every test runs against a fresh in-memory AWS (moto) with the
same table, indexes and bucket that Terraform creates, and calls the real
Lambda handlers with API Gateway-shaped events.'''

import importlib.util
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENDPOINTS = os.path.join(ROOT, 'endpoints')
sys.path.insert(0, os.path.join(ENDPOINTS, 'common', 'python'))   # the shared layer

os.environ.update({
    'AWS_ACCESS_KEY_ID': 'testing', 'AWS_SECRET_ACCESS_KEY': 'testing',
    'AWS_SECURITY_TOKEN': 'testing', 'AWS_SESSION_TOKEN': 'testing',
    'AWS_DEFAULT_REGION': 'eu-west-1', 'REGION': 'eu-west-1',
    'FILE_SHARING_TABLE': 'files-test', 'USERS_TABLE': 'users-test',
    'USER_FILES_BUCKET': 'files-bucket-test',
    'TOKEN_SECRET': 'test-secret',
    'SENDER_EMAIL': 'sender@example.com',
    'SENDER_SES_ARN': 'arn:aws:ses:eu-west-1:123456789012:identity/sender@example.com',
    'PUBLIC_API_URL': 'https://api.example.com',
    'KMS_MODE': 's3',
    'S3_UPLOAD_PART_MIN_SIZE': '1',   # let moto accept tiny multipart parts
})
os.environ.pop('AWS_ENDPOINT_URL', None)
os.environ.pop('AUTH_ENDPOINT', None)

import boto3  # noqa: E402
import pytest  # noqa: E402
from moto import mock_aws  # noqa: E402

GB = 1024 ** 3


@pytest.fixture
def aws(monkeypatch):
    monkeypatch.setenv('USER_QUOTA_BYTES', str(10 * GB))
    monkeypatch.setenv('RATE_LIMIT_TABLE', 'ratelimit-test')
    monkeypatch.setenv('ANALYTICS_TABLE', 'analytics-test')
    with mock_aws():
        ddb = boto3.client('dynamodb')
        ddb.create_table(
            TableName='analytics-test', BillingMode='PAY_PER_REQUEST',
            KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}, {'AttributeName': 'sk', 'KeyType': 'RANGE'}],
            AttributeDefinitions=[{'AttributeName': 'pk', 'AttributeType': 'S'},
                                  {'AttributeName': 'sk', 'AttributeType': 'S'}])
        ddb.create_table(
            TableName='ratelimit-test', BillingMode='PAY_PER_REQUEST',
            KeySchema=[{'AttributeName': 'id', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'id', 'AttributeType': 'S'}])
        ddb.create_table(
            TableName='files-test', BillingMode='PAY_PER_REQUEST',
            KeySchema=[{'AttributeName': 'file_id', 'KeyType': 'HASH'}],
            AttributeDefinitions=[
                {'AttributeName': 'file_id', 'AttributeType': 'S'},
                {'AttributeName': 'user_id', 'AttributeType': 'S'},
                {'AttributeName': 'uploaded_at', 'AttributeType': 'S'},
                {'AttributeName': 'target_file_id', 'AttributeType': 'S'},
                {'AttributeName': 'created_at', 'AttributeType': 'N'},
            ],
            GlobalSecondaryIndexes=[
                {'IndexName': 'user-files', 'Projection': {'ProjectionType': 'ALL'},
                 'KeySchema': [{'AttributeName': 'user_id', 'KeyType': 'HASH'},
                               {'AttributeName': 'uploaded_at', 'KeyType': 'RANGE'}]},
                {'IndexName': 'file-links', 'Projection': {'ProjectionType': 'ALL'},
                 'KeySchema': [{'AttributeName': 'target_file_id', 'KeyType': 'HASH'},
                               {'AttributeName': 'created_at', 'KeyType': 'RANGE'}]},
            ])
        ddb.create_table(
            TableName='users-test', BillingMode='PAY_PER_REQUEST',
            KeySchema=[{'AttributeName': 'email', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'email', 'AttributeType': 'S'}])
        boto3.client('s3').create_bucket(Bucket='files-bucket-test',
                                         CreateBucketConfiguration={'LocationConstraint': 'eu-west-1'})
        boto3.client('ses').verify_email_identity(EmailAddress='sender@example.com')
        yield


_LOADED = {}


def load(folder, module):
    '''Import a Lambda handler module from endpoints/<folder>/src.'''
    key = (folder, module)
    if key not in _LOADED:
        src = os.path.join(ENDPOINTS, folder, 'src')
        sys.path.insert(0, src)
        try:
            spec = importlib.util.spec_from_file_location('handler_' + module, os.path.join(src, module + '.py'))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
        finally:
            sys.path.remove(src)
        _LOADED[key] = mod
    return _LOADED[key]


def forget(folder, module):
    '''Drop a cached handler so the next load() imports it again.'''
    _LOADED.pop((folder, module), None)


def event(method, path, body=None, user='user-1', name='Ada', email='ada@example.com', ip='203.0.113.7',
          query=None):
    '''An API Gateway proxy event. user=None means no authorizer context.'''
    ctx = {'domainName': 'api.example.com', 'stage': 'dev', 'identity': {'sourceIp': ip}}
    if user:
        ctx['authorizer'] = {'user_id': user, 'name': name, 'email': email}
    return {'httpMethod': method, 'path': path, 'headers': {}, 'queryStringParameters': query,
            'body': json.dumps(body) if body is not None else None, 'requestContext': ctx}


def call(folder, module, method, path, body=None, **kwargs):
    '''Run a handler; returns (status, parsed JSON body or raw text, response).'''
    response = load(folder, module).lambda_handler(event(method, path, body, **kwargs), None)
    raw = response.get('body') or ''
    try:
        parsed = json.loads(raw)
    except ValueError:
        parsed = raw
    return response['statusCode'], parsed, response


def s3():
    return boto3.client('s3')


def table():
    return boto3.resource('dynamodb').Table('files-test')


def upload_file(user='user-1', name='notes.txt', data=b'hello world'):
    '''Run the whole single-PUT upload flow; returns the file id.'''
    status, body, _ = call('upload-file', 'upload_file', 'POST', '/v1/users/{0}/files'.format(user),
                           {'file_name': name, 'content_type': 'text/plain', 'size': len(data)}, user=user)
    assert status == 201, body
    s3().put_object(Bucket='files-bucket-test', Key='{0}/{1}/{2}'.format(user, body['file_id'], name), Body=data)
    status, done, _ = call('complete-upload', 'complete_upload', 'POST',
                           '/v1/users/{0}/files/{1}/complete'.format(user, body['file_id']), user=user)
    assert status == 200, done
    return body['file_id']
