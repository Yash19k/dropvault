'''Tokens, the API Gateway authorizer, the auth service, and the cleanup of
abandoned uploads.'''

import json
import time

import boto3
import pytest

import tokens
from conftest import call, forget, load, s3

ARN = 'arn:aws:execute-api:eu-west-1:123456789012:abc123/dev/GET/v1/users/u/files'


def make_token(typ='id', exp_in=3600, **claims):
    base = {'sub': 'user-1', 'email': 'ada@example.com', 'name': 'Ada', 'typ': typ,
            'exp': int(time.time()) + exp_in}
    return tokens.sign(dict(base, **claims))


# --- tokens -------------------------------------------------------------------
def test_token_round_trip():
    claims = tokens.verify(make_token(), ('id',))
    assert claims['sub'] == 'user-1'


@pytest.mark.parametrize('token,types', [
    (make_token(exp_in=-5), ('id',)),             # expired
    (make_token(typ='refresh'), ('id', 'access')),  # wrong kind
    ('garbage', ('id',)),
    ('', ('id',)),
])
def test_bad_tokens_are_rejected(token, types):
    assert tokens.verify(token, types) is None


def test_tampered_token_is_rejected():
    payload, sig = make_token().split('.')
    forged = tokens.sign({'sub': 'user-2', 'typ': 'id', 'exp': int(time.time()) + 60}).split('.')[0]
    assert tokens.verify(forged + '.' + sig, ('id',)) is None


# --- authorizer ---------------------------------------------------------------
def add_account(**extra):
    boto3.resource('dynamodb').Table('users-test').put_item(Item=dict(
        {'email': 'ada@example.com', 'user_id': 'user-1', 'name': 'Ada', 'password': 'x'}, **extra))


def authorize(token):
    return load('authorizer', 'authorizer').lambda_handler(
        {'authorizationToken': 'Bearer ' + token, 'methodArn': ARN}, None)


def test_authorizer_allows_valid_token_for_the_whole_api(aws):
    add_account()
    authorizer = load('authorizer', 'authorizer')
    result = authorizer.lambda_handler({'authorizationToken': 'Bearer ' + make_token(), 'methodArn': ARN}, None)
    assert result['principalId'] == 'user-1'
    assert result['context'] == {'user_id': 'user-1', 'name': 'Ada', 'email': 'ada@example.com'}
    statement = result['policyDocument']['Statement'][0]
    assert statement['Effect'] == 'Allow'
    assert statement['Resource'] == 'arn:aws:execute-api:eu-west-1:123456789012:abc123/dev/*'


@pytest.mark.parametrize('header', ['', 'Bearer nope', 'Bearer ' + make_token(exp_in=-1),
                                    'Bearer ' + make_token(typ='refresh')])
def test_authorizer_denies_bad_tokens(header):
    authorizer = load('authorizer', 'authorizer')
    with pytest.raises(Exception, match='^Unauthorized$'):
        authorizer.lambda_handler({'authorizationToken': header, 'methodArn': ARN}, None)


@pytest.mark.parametrize('account', [
    None,                                          # deleted
    {'suspended_at': 1},                           # suspended by an admin
    {'token_version': 1},                          # signed out since the token was issued
    {'user_id': 'someone-else'},                   # the email now belongs to a new account
])
def test_authorizer_denies_tokens_of_ended_sessions(aws, account):
    if account is not None:
        add_account(**account)
    with pytest.raises(Exception, match='^Unauthorized$'):
        authorize(make_token())


def test_authorizer_accepts_the_current_session_version(aws):
    add_account(token_version=3)
    assert authorize(make_token(ver=3))['principalId'] == 'user-1'


# --- auth service -------------------------------------------------------------
def auth_call(method, path, body=None, headers=None):
    service = load('auth-service', 'auth_service')
    response = service.lambda_handler({'httpMethod': method, 'path': path, 'headers': headers or {},
                                       'body': json.dumps(body) if body is not None else None}, None)
    return response['statusCode'], json.loads(response['body'])


def test_sign_up_login_refresh_logout(aws):
    # the service binds its table when imported, so import it inside this mock
    forget('auth-service', 'auth_service')
    status, signed_up = auth_call('POST', '/v1/users',
                                  {'full_name': 'Ada', 'email': 'Ada@Example.com', 'password': 'longpassword'})
    assert status == 201 and signed_up['email'] == 'ada@example.com'
    assert auth_call('POST', '/v1/users', {'full_name': 'Ada', 'email': 'ada@example.com',
                                                'password': 'longpassword'})[0] == 409
    assert auth_call('POST', '/v1/login', {'email': 'ada@example.com', 'password': 'wrong-pass'})[0] == 401

    status, tokens_ = auth_call('POST', '/v1/login', {'email': 'ada@example.com', 'password': 'longpassword'})
    assert status == 200
    status, info = auth_call('GET', '/v1/userinfo', headers={'Authorization': 'Bearer ' + tokens_['id_token']})
    assert status == 200 and info['email'] == 'ada@example.com'

    status, renewed = auth_call('POST', '/v1/refresh-token', {'refresh_token': tokens_['refresh_token']})
    assert status == 200
    auth_call('POST', '/v1/logout', headers={'Authorization': 'Bearer ' + renewed['access_token']})
    assert auth_call('POST', '/v1/refresh-token', {'refresh_token': renewed['refresh_token']})[0] == 401
    forget('auth-service', 'auth_service')


def test_handlers_fall_back_to_userinfo_without_authorizer(aws):
    '''No authorizer context and no auth service configured -> 401, not a crash.'''
    status, _, _ = call('download-file', 'download_file', 'GET', '/v1/users/user-1/files/x/download', user=None)
    assert status == 401


# --- cleanup of abandoned uploads -----------------------------------------------
def stream_record(item, by_ttl=True, event_name='REMOVE'):
    serializer = boto3.dynamodb.types.TypeSerializer()
    record = {'eventName': event_name,
              'dynamodb': {'OldImage': {k: serializer.serialize(v) for k, v in item.items()}}}
    if by_ttl:
        record['userIdentity'] = {'type': 'Service', 'principalId': 'dynamodb.amazonaws.com'}
    return record


def test_cleanup_removes_partial_uploads_after_ttl(aws):
    bucket = 'files-bucket-test'
    s3().put_object(Bucket=bucket, Key='user-1/f1/half.bin', Body=b'abc')
    upload_id = s3().create_multipart_upload(Bucket=bucket, Key='user-1/f2/big.bin')['UploadId']
    s3().upload_part(Bucket=bucket, Key='user-1/f2/big.bin', UploadId=upload_id, PartNumber=1, Body=b'x')
    cleanup = load('cleanup', 'cleanup')
    result = cleanup.lambda_handler({'Records': [
        stream_record({'file_id': 'f1', 'user_id': 'user-1', 'file_name': 'half.bin', 'status': 'UPLOADING'}),
        stream_record({'file_id': 'f2', 'user_id': 'user-1', 'file_name': 'big.bin', 'status': 'UPLOADING',
                       'upload_id': upload_id}),
    ]}, None)
    assert result == {'cleaned': 2}
    assert s3().list_objects_v2(Bucket=bucket).get('KeyCount') == 0
    assert s3().list_multipart_uploads(Bucket=bucket).get('Uploads', []) == []


def test_cleanup_ignores_everything_else(aws):
    bucket = 'files-bucket-test'
    s3().put_object(Bucket=bucket, Key='user-1/f1/keep.bin', Body=b'abc')
    item = {'file_id': 'f1', 'user_id': 'user-1', 'file_name': 'keep.bin', 'status': 'UPLOADING'}
    cleanup = load('cleanup', 'cleanup')
    result = cleanup.lambda_handler({'Records': [
        stream_record(item, by_ttl=False),                         # deleted by a user, not TTL
        stream_record(dict(item, status='READY')),                  # a finished file
        stream_record(item, event_name='MODIFY'),
    ]}, None)
    assert result == {'cleaned': 0}
    assert s3().list_objects_v2(Bucket=bucket)['KeyCount'] == 1
