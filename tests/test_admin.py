'''The admin panel API (endpoints/admin), and the account rules behind it:
roles, suspension, per-user storage limits, password resets.'''

import json

import boto3
import pytest

from conftest import GB, call, forget, s3, table, upload_file

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
    from conftest import load
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


# --- system ----------------------------------------------------------------------
def test_system_without_cloudwatch(people, monkeypatch):
    monkeypatch.setenv('ADMIN_EMAILS', 'boss@example.com')
    data = ok('GET', '/system')
    assert data['config']['owner_admins'] == ['boss@example.com']
    assert data['config']['default_quota_bytes'] == 10 * GB
    assert data['counts']['users'] == 3
    assert data['health']['available'] is False


def test_system_reads_alarms_and_metrics(people, monkeypatch):
    monkeypatch.setenv('API_NAME', 'test-api')
    monkeypatch.setenv('API_STAGE', 'dev')
    monkeypatch.setenv('ALARM_PREFIX', 'test-')
    monkeypatch.setenv('LAMBDA_NAMES', 'test-list,test-qr')
    cloudwatch = boto3.client('cloudwatch')
    cloudwatch.put_metric_alarm(AlarmName='test-list-errors', Namespace='AWS/Lambda', MetricName='Errors',
                                Statistic='Sum', Period=300, EvaluationPeriods=1, Threshold=1,
                                ComparisonOperator='GreaterThanOrEqualToThreshold')
    cloudwatch.put_metric_data(Namespace='AWS/ApiGateway', MetricData=[{
        'MetricName': 'Count', 'Value': 7, 'Dimensions': [{'Name': 'ApiName', 'Value': 'test-api'},
                                                          {'Name': 'Stage', 'Value': 'dev'}]}])
    health = ok('GET', '/system')['health']
    assert health['available'] is True
    assert [a['name'] for a in health['alarms']] == ['test-list-errors']
    assert health['api']['requests'] == 7 and len(health['api']['hourly']) == 24
    assert [fn['name'] for fn in health['lambdas']] == ['test-list', 'test-qr']


# --- the auth service side ------------------------------------------------------------
def auth(path, body):
    from conftest import load
    response = load('auth-service', 'auth_service').lambda_handler(
        {'httpMethod': 'POST', 'path': path, 'headers': {}, 'body': json.dumps(body)}, None)
    return response['statusCode'], json.loads(response['body'])


def test_auth_reports_role_records_logins_and_refuses_suspended(aws, monkeypatch):
    forget('auth-service', 'auth_service')
    monkeypatch.setenv('ADMIN_EMAILS', 'owner@example.com')
    status, owner = auth('/v1/users', {'full_name': 'Owner', 'email': 'owner@example.com', 'password': 'longpassword'})
    assert status == 201 and owner['role'] == 'admin'
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
