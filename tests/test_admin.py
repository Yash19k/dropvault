'''The admin panel API (endpoints/admin), and the account rules behind it:
roles, suspension, per-user storage limits, password resets.'''

import io
import json
import time
import zipfile

import boto3
import pytest

from conftest import GB, call, event, forget, load, s3, table, upload_file

ADMIN = ('admin', 'admin')


def users():
    return boto3.resource('dynamodb').Table('users-test')


def add_user(user_id, email, name='Someone', **extra):
    item = dict({'email': email, 'user_id': user_id, 'name': name, 'password': 'x', 'created_at': 1_700_000_000},
                **extra)
    users().put_item(Item=item)
    return item


@pytest.fixture
def people(aws):
    '''An admin (Boss) and two ordinary users (Ada, Bob).'''
    add_user('admin-1', 'boss@example.com', 'Boss', role='admin')
    add_user('user-1', 'ada@example.com', 'Ada')
    add_user('user-2', 'bob@example.com', 'Bob')


def admin(method, path, body=None, user='admin-1', email='boss@example.com'):
    status, data, _ = call(*ADMIN, method, '/v1/admin' + path, body, user=user, name='Boss', email=email)
    return status, data


def ok(method, path, body=None, **kwargs):
    status, data = admin(method, path, body, **kwargs)
    assert status == 200, data
    return data


def make_link(file_id, user='user-1', **body):
    status, created, _ = call('qr-link', 'qr_link', 'POST', '/v1/users/{0}/files/{1}/qr'.format(user, file_id),
                              body, user=user)
    assert status == 201, created
    return created['short_url'].rsplit('/', 1)[1]


def follow(code):
    return call('qr-link', 'qr_link', 'GET', '/v1/d/' + code, user=None)


# --- who may use it ----------------------------------------------------------------
def test_only_admins_get_in(people):
    assert admin('GET', '/overview', user='user-1', email='ada@example.com')[0] == 403
    assert call(*ADMIN, 'GET', '/v1/admin/overview', user=None)[0] == 401
    assert admin('GET', '/overview')[0] == 200


def test_owner_emails_are_admins_without_a_role(people, monkeypatch):
    monkeypatch.setenv('ADMIN_EMAILS', 'someone@example.com, ADA@example.com')
    assert admin('GET', '/users', user='user-1', email='ada@example.com')[0] == 200


def test_suspended_or_demoted_admins_are_turned_away(people):
    users().update_item(Key={'email': 'boss@example.com'}, UpdateExpression='SET suspended_at = :t',
                        ExpressionAttributeValues={':t': 1})
    assert admin('GET', '/overview')[0] == 403
    users().update_item(Key={'email': 'boss@example.com'}, UpdateExpression='REMOVE suspended_at, #r',
                        ExpressionAttributeNames={'#r': 'role'})
    assert admin('GET', '/overview')[0] == 403


def test_unknown_routes(people):
    assert admin('GET', '/nope')[0] == 404
    assert admin('POST', '/users')[0] == 404


# --- overview, users, files, links -----------------------------------------------------
def test_overview_counts_everything(people):
    photo = upload_file(name='photo.png', data=b'p' * 300)
    upload_file(name='notes.txt', data=b'n' * 100)
    upload_file(user='user-2', name='song.mp3', data=b's' * 50)
    code = make_link(photo)
    assert follow(code)[0] == 302

    data = ok('GET', '/overview')
    totals = data['totals']
    assert totals == {'users': 3, 'admins': 1, 'suspended': 0, 'files': 3, 'uploading': 0, 'storage_bytes': 450,
                      'links': 1, 'active_links': 1, 'downloads': 1}
    assert len(data['daily']) == 90
    today = data['daily'][-1]
    assert (today['uploads'], today['upload_bytes'], today['links'], today['downloads']) == (3, 450, 1, 1)
    assert data['downloads_counted_since'] == today['date']
    assert [k['kind'] for k in data['storage_by_kind']] == ['image', 'document', 'audio']
    assert [u['email'] for u in data['top_users']] == ['ada@example.com', 'bob@example.com']
    assert data['links_by_status']['active'] == 1 and data['links_by_channel']['link'] == 1
    assert {e['type'] for e in data['recent']} >= {'upload', 'share', 'download', 'signup'}


def test_users_list_shows_storage_links_and_never_passwords(people):
    file_id = upload_file(data=b'x' * 1000)
    make_link(file_id)
    rows = {u['email']: u for u in ok('GET', '/users')['users']}
    ada = rows['ada@example.com']
    assert (ada['file_count'], ada['used_bytes'], ada['link_count'], ada['active_links']) == (1, 1000, 1, 1)
    assert ada['quota_bytes'] == 10 * GB and not ada['custom_quota']
    assert rows['boss@example.com']['role'] == 'admin' and rows['bob@example.com']['role'] == 'user'
    assert 'password' not in json.dumps(rows)


def test_user_detail_has_files_links_and_activity(people):
    file_id = upload_file()
    make_link(file_id)
    detail = ok('GET', '/users/user-1')
    assert detail['user']['email'] == 'ada@example.com'
    assert [f['file_id'] for f in detail['files']] == [file_id]
    assert detail['files'][0]['owner']['email'] == 'ada@example.com'
    assert len(detail['links']) == 1 and detail['links'][0]['file']['file_name'] == 'notes.txt'
    assert {e['type'] for e in detail['activity']} == {'signup', 'upload', 'share'}
    assert admin('GET', '/users/missing')[0] == 404


def test_files_download_links_off_and_delete(people):
    file_id = upload_file(name='report.pdf')
    code = make_link(file_id)
    files = ok('GET', '/files')['files']
    assert files[0]['owner']['email'] == 'ada@example.com' and files[0]['kind'] == 'pdf'
    assert files[0]['active_links'] == 1

    assert 'X-Amz-Signature' in ok('GET', '/files/{0}/download'.format(file_id))['download_url']
    ok('DELETE', '/files/{0}/links'.format(file_id))
    assert follow(code)[0] == 410
    ok('DELETE', '/files/' + file_id)
    assert table().get_item(Key={'file_id': file_id}).get('Item') is None
    assert s3().list_objects_v2(Bucket='files-bucket-test').get('KeyCount') == 0
    assert table().get_item(Key={'file_id': 'USAGE#user-1'})['Item']['used_bytes'] == 0
    assert admin('DELETE', '/files/' + file_id)[0] == 404
    assert admin('GET', '/files/QR%23{0}/download'.format(code))[0] == 404   # not a file

    summaries = [e['summary'] for e in ok('GET', '/activity')['events'] if e['type'] == 'admin']
    assert summaries == ['Deleted report.pdf (owned by ada@example.com)',
                         'Turned off every link to report.pdf (owned by ada@example.com)',
                         'Downloaded report.pdf (owned by ada@example.com)']


def test_links_list_and_turn_off(people):
    file_id = upload_file()
    first, second = make_link(file_id), make_link(file_id, channel='qr')
    listed = ok('GET', '/links')['links']
    assert {link['code'] for link in listed} == {first, second}
    assert listed[0]['owner']['email'] == 'ada@example.com' and listed[0]['file']['file_name'] == 'notes.txt'
    ok('DELETE', '/links/' + first)
    statuses = {link['code']: link['status'] for link in ok('GET', '/links')['links']}
    assert statuses == {first: 'revoked', second: 'active'}
    assert admin('DELETE', '/links/nope!')[0] == 404


# --- changing accounts --------------------------------------------------------------
def test_role_suspend_and_quota_changes(people):
    changes = ok('PATCH', '/users/user-1', {'role': 'admin', 'suspended': True, 'quota_bytes': 500})['changes']
    assert changes == ['Made ada@example.com an admin', 'Suspended ada@example.com',
                       "Set ada@example.com's storage limit to 500 B"]
    ada = users().get_item(Key={'email': 'ada@example.com'})['Item']
    assert ada['role'] == 'admin' and ada['suspended_at'] and ada['token_version'] == 1

    ok('PATCH', '/users/user-1', {'role': 'user', 'suspended': False})
    ada = users().get_item(Key={'email': 'ada@example.com'})['Item']
    assert 'role' not in ada and 'suspended_at' not in ada

    # the per-user limit is what uploads are checked against
    status, body, _ = call('upload-file', 'upload_file', 'POST', '/v1/users/user-1/files',
                           {'file_name': 'big.bin', 'size': 600})
    assert status == 413 and body['quota_bytes'] == 500
    listed = call('get-user-files', 'get_user_files', 'GET', '/v1/users/user-1/files')[1]
    assert listed['usage']['quota_bytes'] == 500
    ok('PATCH', '/users/user-1', {'quota_bytes': None})
    assert ok('GET', '/users/user-1')['user']['quota_bytes'] == 10 * GB
    ok('PATCH', '/users/user-1', {'quota_bytes': 0})     # 0 = unlimited
    assert call('upload-file', 'upload_file', 'POST', '/v1/users/user-1/files',
                {'file_name': 'big.bin', 'size': 20 * GB})[0] == 201

    actions = [e['action'] for e in ok('GET', '/activity')['events'] if e['type'] == 'admin']
    assert actions.count('user.role') == 2 and 'user.unsuspend' in actions


@pytest.mark.parametrize('body,message', [
    ({}, 'Nothing to change'),
    ({'role': 'god'}, 'role must be'),
    ({'suspended': 'yes'}, 'suspended must be'),
    ({'quota_bytes': -1}, 'quota_bytes must be'),
    ({'quota_bytes': True}, 'quota_bytes must be'),
    ({'email': 'x@example.com'}, 'Unknown field'),
])
def test_bad_changes_are_rejected(people, body, message):
    status, data = admin('PATCH', '/users/user-1', body)
    assert status == 400 and message in data['message']


def test_admins_cannot_lock_themselves_or_owners_out(people, monkeypatch):
    monkeypatch.setenv('ADMIN_EMAILS', 'bob@example.com')
    assert admin('PATCH', '/users/admin-1', {'role': 'user'})[0] == 400
    assert admin('PATCH', '/users/admin-1', {'suspended': True})[0] == 400
    assert admin('DELETE', '/users/admin-1')[0] == 400
    assert admin('POST', '/users/admin-1/signout')[0] == 400
    for method, path, body in (('PATCH', '/users/user-2', {'suspended': True}), ('DELETE', '/users/user-2', None),
                               ('POST', '/users/user-2/password', None)):
        status, data = admin(method, path, body)
        assert status == 403 and 'owner admin' in data['message']
    # changing your own storage limit is fine
    assert admin('PATCH', '/users/admin-1', {'quota_bytes': 0})[0] == 200


def test_sign_out_and_password_reset(people):
    forget('auth-service', 'auth_service')
    service = load('auth-service', 'auth_service')

    def login(password):
        response = service.lambda_handler({'httpMethod': 'POST', 'path': '/v1/login', 'headers': {},
                                           'body': json.dumps({'email': 'ada@example.com', 'password': password})},
                                          None)
        return response['statusCode']

    ok('POST', '/users/user-1/signout')
    assert users().get_item(Key={'email': 'ada@example.com'})['Item']['token_version'] == 1

    password = ok('POST', '/users/user-1/password')['temporary_password']
    assert len(password) == 12
    assert login(password) == 200 and login('x') == 401
    assert users().get_item(Key={'email': 'ada@example.com'})['Item']['token_version'] == 2
    forget('auth-service', 'auth_service')


def test_delete_user_removes_everything_they_had(people):
    mine = upload_file(name='a.txt')
    upload_file(name='b.txt')
    theirs = upload_file(user='user-2', name='keep.txt')
    make_link(mine)
    result = ok('DELETE', '/users/user-1')
    assert result['files_deleted'] == 2
    assert users().get_item(Key={'email': 'ada@example.com'}).get('Item') is None
    left = [i['file_id'] for i in table().scan()['Items'] if not i['file_id'].startswith(('AUDIT#', 'STATS#'))]
    assert sorted(left) == sorted([theirs, 'USAGE#user-2'])
    keys = [o['Key'] for o in s3().list_objects_v2(Bucket='files-bucket-test')['Contents']]
    assert keys == ['user-2/{0}/keep.txt'.format(theirs)]
    assert admin('DELETE', '/users/user-1')[0] == 404


# --- system and health ----------------------------------------------------------------
def test_system_reports_config_and_counts(people, monkeypatch):
    monkeypatch.setenv('ADMIN_EMAILS', 'boss@example.com')
    data = ok('GET', '/system')
    assert data['config']['owner_admins'] == ['boss@example.com']
    assert data['config']['default_quota_bytes'] == 10 * GB
    assert data['counts']['users'] == 3
    assert 'health' not in data


def get_health(range_key=None):
    ev = event('GET', '/v1/admin/health', user='admin-1', name='Boss', email='boss@example.com')
    if range_key:
        ev['queryStringParameters'] = {'range': range_key}
    response = load(*ADMIN).lambda_handler(ev, None)
    return response['statusCode'], json.loads(response['body'])


def checks_of(data):
    return {c['id']: c for c in data['checks']}


def test_health_offline_runs_the_checks_it_can(people):
    status, data = get_health()
    assert status == 200 and data['offline'] is True and data['range'] == '24h'
    checks = checks_of(data)
    assert list(checks) == ['api', 'functions', 'files_table', 'users_table', 'storage', 'email', 'encryption',
                            'cleanup', 'alarms']
    for offline_only in ('api', 'functions', 'cleanup', 'alarms'):
        assert checks[offline_only]['status'] == 'unknown'
    # the test table has no TTL: unfinished uploads would never expire
    assert checks['files_table']['status'] == 'warning' and 'TTL' in checks['files_table']['summary']
    assert checks['users_table']['status'] == 'ok'
    assert checks['storage']['status'] == 'ok' and checks['encryption']['status'] == 'ok'
    assert checks['email']['status'] == 'ok'
    assert data['status'] == 'warning'
    assert data['api'] is None and data['errors'] is None

    boto3.client('dynamodb').update_time_to_live(
        TableName='files-test', TimeToLiveSpecification={'Enabled': True, 'AttributeName': 'ttl'})
    assert get_health()[1]['status'] == 'ok'


def test_health_bad_range(people):
    assert get_health('1y')[0] == 400


def make_function(name):
    iam = boto3.client('iam')
    role = iam.create_role(RoleName='health-test', AssumeRolePolicyDocument='{}')['Role']['Arn']
    package = io.BytesIO()
    with zipfile.ZipFile(package, 'w') as archive:
        archive.writestr('handler.py', 'def handler(event, context):\n    return 1\n')
    boto3.client('lambda').create_function(FunctionName=name, Runtime='python3.12', Role=role,
                                           Handler='handler.handler', Code={'ZipFile': package.getvalue()})


def test_health_on_aws(people, monkeypatch):
    for key, value in {'API_NAME': 'test-api', 'API_ID': 'abc123', 'API_STAGE': 'dev', 'ALARM_PREFIX': 'test-',
                       'LAMBDA_NAMES': 'test-list,test-gone,test-authorizer',
                       'CLEANUP_FUNCTION': 'test-cleanup'}.items():
        monkeypatch.setenv(key, value)
    make_function('test-list')
    s3_ = s3()
    s3_.put_bucket_encryption(Bucket='files-bucket-test', ServerSideEncryptionConfiguration={
        'Rules': [{'ApplyServerSideEncryptionByDefault': {'SSEAlgorithm': 'AES256'}}]})
    s3_.put_public_access_block(Bucket='files-bucket-test', PublicAccessBlockConfiguration={
        'BlockPublicAcls': True, 'IgnorePublicAcls': True, 'BlockPublicPolicy': True, 'RestrictPublicBuckets': True})
    cloudwatch = boto3.client('cloudwatch')
    cloudwatch.put_metric_alarm(AlarmName='test-list-errors', Namespace='AWS/Lambda', MetricName='Errors',
                                Statistic='Sum', Period=300, EvaluationPeriods=1, Threshold=1,
                                ComparisonOperator='GreaterThanOrEqualToThreshold')
    cloudwatch.set_alarm_state(AlarmName='test-list-errors', StateValue='ALARM', StateReason='Threshold crossed')
    cloudwatch.put_metric_data(Namespace='AWS/ApiGateway', MetricData=[{
        'MetricName': 'Count', 'Value': 7, 'Dimensions': [{'Name': 'ApiName', 'Value': 'test-api'},
                                                          {'Name': 'Stage', 'Value': 'dev'}]}])
    # five expired tokens turned away: Lambda counts them as authorizer "errors"
    cloudwatch.put_metric_data(Namespace='AWS/Lambda', MetricData=[{
        'MetricName': 'Errors', 'Value': 5, 'Dimensions': [{'Name': 'FunctionName', 'Value': 'test-authorizer'}]}])
    logs = boto3.client('logs')
    logs.create_log_group(logGroupName='/aws/lambda/test-authorizer')
    logs.create_log_stream(logGroupName='/aws/lambda/test-authorizer', logStreamName='a-1')
    logs.put_log_events(logGroupName='/aws/lambda/test-authorizer', logStreamName='a-1', logEvents=[
        {'timestamp': int(time.time() * 1000) - 30000,
         'message': '[ERROR] Exception: Unauthorized\nTraceback (most recent call last):\n  File "/var/task/a.py"'}])
    logs.create_log_group(logGroupName='/aws/lambda/test-list')
    logs.create_log_stream(logGroupName='/aws/lambda/test-list', logStreamName='run-1')
    at = int(time.time() * 1000) - 60000
    logs.put_log_events(logGroupName='/aws/lambda/test-list', logStreamName='run-1', logEvents=[
        {'timestamp': at, 'message': '2026-11-21 10:00:00,000 - handler - ERROR - unhandled error'},
        {'timestamp': at + 1, 'message': 'Traceback (most recent call last):'},
        {'timestamp': at + 2, 'message': '  File "handler.py", line 3, in handler'},
        {'timestamp': at + 3, 'message': "KeyError: 'file_id'"},
        {'timestamp': at + 5000, 'message': '2026-11-21 10:00:05,000 - handler - INFO - all good'},
    ])
    # an unhandled error as the Lambda runtime logs it: one event, several lines
    logs.create_log_stream(logGroupName='/aws/lambda/test-list', logStreamName='run-2')
    logs.put_log_events(logGroupName='/aws/lambda/test-list', logStreamName='run-2', logEvents=[
        {'timestamp': at - 600000, 'message': "[ERROR] KeyError: 'x'\rTraceback (most recent call last):\r"
                                              '  File "/var/task/list.py", line 9, in handler'}])
    # the exception line doesn't look like an error on its own: found by reading
    # the lines just after the "ERROR" line
    logs.create_log_stream(logGroupName='/aws/lambda/test-list', logStreamName='run-3')
    logs.put_log_events(logGroupName='/aws/lambda/test-list', logStreamName='run-3', logEvents=[
        {'timestamp': at - 300000, 'message': '2026-11-21 09:55:00,000 - handler - ERROR - unhandled error'},
        {'timestamp': at - 299500, 'message': 'botocore.errorfactory.MessageRejected: Email address is not verified.'},
    ])

    status, data = get_health('1h')
    assert status == 200 and data['offline'] is False and data['range'] == '1h'
    checks = checks_of(data)
    assert checks['functions']['status'] == 'error' and 'gone' in checks['functions']['summary']
    assert checks['alarms']['status'] == 'error' and 'list-errors' in checks['alarms']['summary']
    assert checks['storage']['status'] == 'ok'
    assert checks['email']['status'] == 'warning' and 'sandbox' in checks['email']['summary']
    assert checks['cleanup']['status'] == 'error'          # no stream trigger in the mock
    assert data['status'] == 'error'
    assert [a['state'] for a in data['alarms']] == ['ALARM']

    assert data['api']['requests'] == 7 and len(data['api']['series']) == 30
    rows = {f['short']: f for f in data['functions']}
    assert rows['list']['state'] == 'Active' and rows['gone']['state'] == 'Missing'
    assert rows['list']['invocations'] == 0
    assert rows['authorizer']['errors'] == 0 and rows['authorizer']['rejected'] == 5

    # newest first; the authorizer's "Unauthorized" is a rejection, not an error
    assert [e['function'] for e in data['errors']] == ['list', 'list', 'list']
    assert data['errors'][1]['message'] == ('handler - ERROR - unhandled error · '
                                            'botocore.errorfactory.MessageRejected: Email address is not verified.')
    assert data['errors'][2]['message'] == "[ERROR] KeyError: 'x'"
    error = data['errors'][0]
    assert error['function'] == 'list' and error['at'] == at
    assert 'unhandled error' in error['message'] and "KeyError: 'file_id'" in error['message']
    assert 'Traceback' not in error['message'] and '2026-11-21' not in error['message']


# --- the auth service side ------------------------------------------------------------
def auth(path, body):
    response = load('auth-service', 'auth_service').lambda_handler(
        {'httpMethod': 'POST', 'path': path, 'headers': {}, 'body': json.dumps(body)}, None)
    return response['statusCode'], json.loads(response['body'])


def test_auth_reports_role_records_logins_and_refuses_suspended(aws, monkeypatch):
    forget('auth-service', 'auth_service')
    monkeypatch.setenv('ADMIN_EMAILS', 'owner@example.com')
    # nobody can claim the owner admin's address through sign-up (no email verification) ...
    status, body = auth('/v1/users', {'full_name': 'Owner', 'email': 'owner@example.com', 'password': 'longpassword'})
    assert status == 409 and body['message'] == 'An account with this email already exists'
    # ... the owner sets it up with terraform/admin-account.sh (a direct Lambda invocation)
    made = load('auth-service', 'auth_service').lambda_handler(
        {'action': 'owner_password', 'email': 'owner@example.com'}, None)
    assert made['created'] is True and len(made['temporary_password']) == 12
    status, owner = auth('/v1/login', {'email': 'owner@example.com', 'password': made['temporary_password']})
    assert status == 200 and owner['role'] == 'admin'
    status, member = auth('/v1/users', {'full_name': 'Mem', 'email': 'mem@example.com', 'password': 'longpassword'})
    assert member['role'] == 'user'

    status, tokens_ = auth('/v1/login', {'email': 'mem@example.com', 'password': 'longpassword'})
    assert status == 200 and tokens_['role'] == 'user'
    record = users().get_item(Key={'email': 'mem@example.com'})['Item']
    assert record['login_count'] == 2 and record['last_login_at']   # sign-up + this login

    users().update_item(Key={'email': 'mem@example.com'}, UpdateExpression='SET suspended_at = :t',
                        ExpressionAttributeValues={':t': 1})
    status, body = auth('/v1/login', {'email': 'mem@example.com', 'password': 'longpassword'})
    assert status == 403 and 'suspended' in body['message']
    status, body = auth('/v1/refresh-token', {'refresh_token': tokens_['refresh_token']})
    assert status == 403 and 'suspended' in body['message']
    # a wrong password still says nothing about the account
    assert auth('/v1/login', {'email': 'mem@example.com', 'password': 'wrong-pass'})[0] == 401
    forget('auth-service', 'auth_service')
