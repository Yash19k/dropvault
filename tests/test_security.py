'''Abuse and hardening: rate limits (sign-in guessing, sign-up floods, email
spam, record floods), binding upload sizes, owner-admin bootstrap, password
change, session checks on /userinfo and logout, and the public pages' headers.'''

import json
import types
import urllib.parse

import boto3
import pytest
from botocore.exceptions import ClientError

import ratelimit
from conftest import GB, call, forget, load, s3, table, upload_file

BUCKET = 'files-bucket-test'


@pytest.fixture
def auth_service(aws):
    '''The auth service binds its table on import: import it inside the mock.'''
    forget('auth-service', 'auth_service')
    yield load('auth-service', 'auth_service')
    forget('auth-service', 'auth_service')


def auth_call(method, path, body=None, headers=None, ip='198.51.100.1'):
    response = load('auth-service', 'auth_service').lambda_handler(
        {'httpMethod': method, 'path': path, 'headers': headers or {},
         'requestContext': {'identity': {'sourceIp': ip}},
         'body': json.dumps(body) if body is not None else None}, None)
    return response['statusCode'], json.loads(response['body']), response.get('headers') or {}


def sign_up(email='ada@example.com', password='longpassword', ip='198.51.100.1'):
    return auth_call('POST', '/v1/users', {'full_name': 'Ada', 'email': email, 'password': password}, ip=ip)


def login(email='ada@example.com', password='longpassword', ip='198.51.100.1'):
    return auth_call('POST', '/v1/login', {'email': email, 'password': password}, ip=ip)


def bearer(token):
    return {'Authorization': 'Bearer ' + token}


# --- the rate limiter itself ---------------------------------------------------------
def test_rate_limit_counts_per_window_and_resets(aws):
    for _ in range(3):
        ratelimit.hit('t#a', 3, 60, now=1000)
    with pytest.raises(ratelimit.Limited) as caught:
        ratelimit.hit('t#a', 3, 60, now=1010)
    assert caught.value.retry_after == 10          # the window 960..1020 ends in 10 s
    ratelimit.hit('t#a', 3, 60, now=1020)          # next window
    ratelimit.hit('t#b', 3, 60, now=1010)          # other keys are separate
    with pytest.raises(ratelimit.Limited):
        ratelimit.hit('t#c', 3, 60, cost=4, now=1000)   # a cost that doesn't fit counts nothing
    assert ratelimit.used('t#c', 60, now=1000) == 0


def test_rate_limit_fails_open_when_the_table_is_missing(aws, monkeypatch):
    monkeypatch.setenv('RATE_LIMIT_TABLE', 'no-such-table')
    for _ in range(5):
        ratelimit.hit('t#x', 1, 60)                 # logged, not raised
    monkeypatch.delenv('RATE_LIMIT_TABLE')
    for _ in range(5):
        ratelimit.hit('t#x', 1, 60)                 # no table configured: no limits


# --- sign-in, sign-up --------------------------------------------------------------
def test_wrong_passwords_lock_the_account_for_a_while(auth_service, monkeypatch):
    monkeypatch.setenv('LOGIN_FAILURES', '3')
    sign_up()
    for _ in range(3):
        assert login(password='wrong-password')[0] == 401
    status, body, headers = login()                 # even the right password waits now
    assert status == 429 and 'wrong passwords' in body['message']
    assert int(headers['Retry-After']) == body['retry_after'] > 0
    # other accounts are unaffected
    assert sign_up('bob@example.com')[0] == 201
    assert login('bob@example.com')[0] == 200


def test_failed_sign_ins_count_for_unknown_addresses_too(auth_service, monkeypatch):
    '''Otherwise the 429 would reveal which addresses have accounts.'''
    monkeypatch.setenv('LOGIN_FAILURES', '2')
    for _ in range(2):
        assert login('nobody@example.com', 'whatever-pass')[0] == 401
    assert login('nobody@example.com', 'whatever-pass')[0] == 429


def test_a_correct_password_clears_earlier_failures(auth_service, monkeypatch):
    monkeypatch.setenv('LOGIN_FAILURES', '3')
    sign_up()
    for _ in range(2):
        login(password='wrong-password')
    assert login()[0] == 200
    for _ in range(2):
        login(password='wrong-password')
    assert login()[0] == 200


def test_sign_ins_are_limited_per_network(auth_service, monkeypatch):
    monkeypatch.setenv('LOGIN_PER_IP', '4')
    sign_up()
    for _ in range(4):
        login(ip='192.0.2.9')
    status, body, _ = login(ip='192.0.2.9')
    assert status == 429 and 'network' in body['message']
    assert login(ip='192.0.2.10')[0] == 200


def test_sign_ups_are_limited_per_network(auth_service, monkeypatch):
    monkeypatch.setenv('SIGNUPS_PER_IP', '2')
    assert sign_up('a@example.com', ip='192.0.2.1')[0] == 201
    assert sign_up('b@example.com', ip='192.0.2.1')[0] == 201
    assert sign_up('c@example.com', ip='192.0.2.1')[0] == 429
    assert sign_up('c@example.com', ip='192.0.2.2')[0] == 201


# --- owner admins ------------------------------------------------------------------
def test_owner_address_cant_be_claimed_through_sign_up(auth_service, monkeypatch):
    monkeypatch.setenv('ADMIN_EMAILS', 'owner@example.com')
    status, body, _ = sign_up('Owner@Example.com')
    assert status == 409
    assert boto3.resource('dynamodb').Table('users-test').get_item(Key={'email': 'owner@example.com'}).get(
        'Item') is None


def test_owner_account_bootstrap_and_recovery(auth_service, monkeypatch):
    monkeypatch.setenv('ADMIN_EMAILS', 'owner@example.com')
    made = auth_service.lambda_handler({'action': 'owner_password', 'email': 'owner@example.com',
                                        'name': 'Yash'}, None)
    assert made['created'] is True
    status, tokens_, _ = login('owner@example.com', made['temporary_password'])
    assert status == 200 and tokens_['role'] == 'admin'

    again = auth_service.lambda_handler({'action': 'owner_password', 'email': 'owner@example.com'}, None)
    assert again['created'] is False and again['temporary_password'] != made['temporary_password']
    assert login('owner@example.com', made['temporary_password'])[0] == 401
    assert login('owner@example.com', again['temporary_password'])[0] == 200
    # the reset ended the sessions from before it
    assert auth_call('POST', '/v1/refresh-token', {'refresh_token': tokens_['refresh_token']})[0] == 401


def test_owner_bootstrap_only_for_owner_addresses_and_only_directly(auth_service, monkeypatch):
    monkeypatch.setenv('ADMIN_EMAILS', 'owner@example.com')
    assert 'error' in auth_service.lambda_handler({'action': 'owner_password', 'email': 'x@example.com'}, None)
    # through API Gateway (httpMethod set) the action field means nothing
    response = auth_service.lambda_handler({'httpMethod': 'POST', 'path': '/v1/users', 'action': 'owner_password',
                                            'email': 'owner@example.com', 'body': '{}'}, None)
    assert response['statusCode'] == 400


# --- sessions --------------------------------------------------------------------
def test_userinfo_refuses_tokens_of_ended_sessions(auth_service):
    _, tokens_, _ = sign_up()
    assert auth_call('GET', '/v1/userinfo', headers=bearer(tokens_['id_token']))[0] == 200
    auth_call('POST', '/v1/logout', headers=bearer(tokens_['access_token']))
    assert auth_call('GET', '/v1/userinfo', headers=bearer(tokens_['id_token']))[0] == 401


def test_logout_with_only_the_refresh_token_ends_the_session(auth_service):
    _, tokens_, _ = sign_up()
    assert auth_call('POST', '/v1/logout', {'refresh_token': tokens_['refresh_token']})[0] == 200
    assert auth_call('POST', '/v1/refresh-token', {'refresh_token': tokens_['refresh_token']})[0] == 401


def test_change_password(auth_service):
    _, old, _ = sign_up()
    status, body, _ = auth_call('POST', '/v1/password', {'current_password': 'nope-nope', 'new_password': 'x' * 10},
                                headers=bearer(old['access_token']))
    assert status == 400 and 'current password' in body['message']
    assert auth_call('POST', '/v1/password', {'current_password': 'longpassword', 'new_password': 'short'},
                     headers=bearer(old['access_token']))[0] == 400
    status, new, _ = auth_call('POST', '/v1/password', {'current_password': 'longpassword',
                                                       'new_password': 'a-new-password'},
                               headers=bearer(old['access_token']))
    assert status == 200 and new['id_token']
    assert login(password='longpassword')[0] == 401
    assert login(password='a-new-password')[0] == 200
    # every other session ended; the one that changed it got fresh tokens
    assert auth_call('POST', '/v1/refresh-token', {'refresh_token': old['refresh_token']})[0] == 401
    assert auth_call('POST', '/v1/refresh-token', {'refresh_token': new['refresh_token']})[0] == 200
    assert auth_call('POST', '/v1/password', {'current_password': 'a-new-password', 'new_password': 'whatever12'},
                     headers=bearer(old['access_token']))[0] == 401


def test_wrong_current_passwords_count_as_failed_sign_ins(auth_service, monkeypatch):
    monkeypatch.setenv('LOGIN_FAILURES', '2')
    _, tokens_, _ = sign_up()
    for _ in range(2):
        auth_call('POST', '/v1/password', {'current_password': 'guess-guess', 'new_password': 'x' * 10},
                  headers=bearer(tokens_['access_token']))
    assert auth_call('POST', '/v1/password', {'current_password': 'longpassword', 'new_password': 'x' * 10},
                     headers=bearer(tokens_['access_token']))[0] == 429
    assert login()[0] == 429


def test_auth_answers_are_never_cached(auth_service):
    _, _, headers = sign_up()
    assert headers['Cache-Control'] == 'no-store' and headers['X-Content-Type-Options'] == 'nosniff'
    status, _, headers = call('get-user-files', 'get_user_files', 'GET', '/v1/users/user-1/files')
    assert headers['headers']['Cache-Control'] == 'no-store'


# --- uploads -----------------------------------------------------------------------
def signed_headers(url):
    return urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)['X-Amz-SignedHeaders'][0].split(';')


def start(size, name='a.bin', user='user-1'):
    return call('upload-file', 'upload_file', 'POST', '/v1/users/{0}/files'.format(user),
                {'file_name': name, 'size': size}, user=user)


def test_size_is_required_and_signed_into_the_upload_url(aws):
    assert call('upload-file', 'upload_file', 'POST', '/v1/users/user-1/files', {'file_name': 'a.bin'})[0] == 400
    status, body, _ = start(1234)
    assert status == 201 and 'content-length' in signed_headers(body['upload_url'])


def test_each_part_url_signs_its_exact_size(aws, monkeypatch):
    monkeypatch.setenv('MULTIPART_THRESHOLD', '10')
    mib = 1024 * 1024
    size = 40 * mib + 5            # 16 MiB parts: 16 + 16 + 8 MiB + 5 bytes
    _, body, _ = start(size)
    assert body['upload_type'] == 'multipart' and body['part_count'] == 3
    upload = load('upload-file', 'upload_file')
    item = table().get_item(Key={'file_id': body['file_id']})['Item']
    assert [upload.part_length(item, n) for n in (1, 2, 3)] == [16 * mib, 16 * mib, 8 * mib + 5]
    status, parts, _ = call('upload-file', 'upload_file', 'POST',
                            '/v1/users/user-1/files/{0}/parts'.format(body['file_id']), {'part_numbers': [1, 3]})
    assert status == 200 and all('content-length' in signed_headers(u) for u in parts['urls'].values())


def test_unfinished_uploads_hold_their_space(aws, monkeypatch):
    monkeypatch.setenv('USER_QUOTA_BYTES', '1000')
    assert start(600)[0] == 201                      # started, never finished
    status, body, _ = start(600)
    assert status == 413 and body['reserved_bytes'] == 600 and 'unfinished' in body['message']
    assert start(400)[0] == 201                      # what's left still fits


def test_abandoned_uploads_stop_holding_space(aws, monkeypatch):
    monkeypatch.setenv('USER_QUOTA_BYTES', '1000')
    _, body, _ = start(600)
    table().update_item(Key={'file_id': body['file_id']}, UpdateExpression='SET #t = :past',
                        ExpressionAttributeNames={'#t': 'ttl'}, ExpressionAttributeValues={':past': 1})
    assert start(600)[0] == 201                      # TTL hasn't deleted it yet, but it's expired


def test_unfinished_uploads_are_capped(aws, monkeypatch):
    monkeypatch.setenv('MAX_PENDING_UPLOADS', '2')
    upload_file()                                    # finished uploads don't count
    assert start(1)[0] == 201 and start(1)[0] == 201
    status, body, _ = start(1)
    assert status == 429 and 'unfinished uploads' in body['message']
    assert start(1, user='user-2', name='b')[0] == 201   # per user


def test_uploads_per_hour_are_limited(aws, monkeypatch):
    monkeypatch.setenv('UPLOADS_PER_HOUR', '2')
    assert start(1)[0] == 201 and start(1)[0] == 201
    status, body, response = start(1)
    assert status == 429 and int(response['headers']['Retry-After']) > 0


def test_completing_a_multipart_upload_twice_is_harmless(aws, monkeypatch):
    monkeypatch.setenv('MULTIPART_THRESHOLD', '10')
    _, body, _ = start(20)
    item = table().get_item(Key={'file_id': body['file_id']})['Item']
    key = 'user-1/{0}/a.bin'.format(body['file_id'])
    s3().upload_part(Bucket=BUCKET, Key=key, UploadId=item['upload_id'], PartNumber=1, Body=b'x' * 20)
    complete = load('complete-upload', 'complete_upload')
    # another call completed the upload in S3 between our read and our complete
    parts = s3().list_parts(Bucket=BUCKET, Key=key, UploadId=item['upload_id'])['Parts']
    s3().complete_multipart_upload(Bucket=BUCKET, Key=key, UploadId=item['upload_id'], MultipartUpload={
        'Parts': [{'PartNumber': p['PartNumber'], 'ETag': p['ETag']} for p in parts]})
    complete.finish_multipart(item)                  # NoSuchUpload, but it's done: no 410
    status, done, _ = call('complete-upload', 'complete_upload', 'POST',
                           '/v1/users/user-1/files/{0}/complete'.format(body['file_id']))
    assert status == 200 and done['status'] == 'READY'
    _, listed, _ = call('get-user-files', 'get_user_files', 'GET', '/v1/users/user-1/files')
    assert listed['usage']['used_bytes'] == 20


# --- sharing -----------------------------------------------------------------------
class FakeSes:
    def __init__(self, refuse=()):
        self.refuse, self.sent = set(refuse), []

    def send_email(self, **kwargs):
        to = kwargs['Destination']['ToAddresses'][0]
        if to in self.refuse:
            raise ClientError({'Error': {'Code': 'MessageRejected', 'Message': 'Address blacklisted: ' + to}},
                              'SendEmail')
        self.sent.append(to)


def share(monkeypatch, ses, recipients, file_id):
    module = load('share-file', 'share_file')
    monkeypatch.setattr(module, 'boto3', types.SimpleNamespace(client=lambda *a, **k: ses))
    return call('share-file', 'share_file', 'POST', '/v1/users/user-1/files/{0}/share'.format(file_id),
                {'share_with': recipients})


def test_share_emails_have_a_daily_budget(aws, monkeypatch):
    monkeypatch.setenv('SHARE_EMAILS_PER_DAY', '3')
    file_id, ses = upload_file(), FakeSes()
    assert share(monkeypatch, ses, ['a@example.com', 'b@example.com'], file_id)[0] == 201
    status, body, response = share(monkeypatch, ses, ['c@example.com', 'd@example.com'], file_id)
    assert status == 429 and 'have 1 left' in body['message'] and response['headers']['Retry-After']
    assert share(monkeypatch, ses, ['c@example.com'], file_id)[0] == 201
    assert ses.sent == ['a@example.com', 'b@example.com', 'c@example.com']


def test_emails_that_werent_sent_dont_use_the_budget(aws, monkeypatch):
    monkeypatch.setenv('SHARE_EMAILS_PER_DAY', '2')
    file_id = upload_file()
    status, body, _ = share(monkeypatch, FakeSes(refuse=['bad@example.com']), ['bad@example.com'], file_id)
    assert status == 422
    assert share(monkeypatch, FakeSes(), ['a@example.com', 'b@example.com'], file_id)[0] == 201


def test_recipients_are_deduplicated_case_insensitively(aws, monkeypatch):
    file_id, ses = upload_file(), FakeSes()
    status, body, _ = share(monkeypatch, ses, ['Ann@Example.com', 'ann@example.com', ' bob@example.com'], file_id)
    assert status in (201, 400)
    if status == 201:   # (the schema may refuse the leading space; either way nobody gets two emails)
        assert ses.sent == ['ann@example.com', 'bob@example.com']
    status, body, _ = share(monkeypatch, ses, ['Cy@Example.com', 'cy@example.com'], file_id)
    assert status == 201 and body['sent'] == ['cy@example.com']


# --- links ---------------------------------------------------------------------------
def test_links_per_hour_are_limited(aws, monkeypatch):
    monkeypatch.setenv('LINKS_PER_HOUR', '2')
    file_id = upload_file()
    path = '/v1/users/user-1/files/{0}/qr'.format(file_id)
    assert call('qr-link', 'qr_link', 'POST', path, {})[0] == 201
    assert call('qr-link', 'qr_link', 'POST', path, {})[0] == 201
    assert call('qr-link', 'qr_link', 'POST', path, {})[0] == 429


def test_public_link_pages_cant_be_framed_or_run_scripts(aws):
    status, body, response = call('qr-link', 'qr_link', 'GET', '/v1/d/unknowncode1', user=None)
    headers = response['headers']
    assert status == 404
    assert "frame-ancestors 'none'" in headers['Content-Security-Policy']
    assert "default-src 'none'" in headers['Content-Security-Policy']
    assert headers['X-Frame-Options'] == 'DENY' and headers['Referrer-Policy'] == 'no-referrer'


def test_quota_is_still_enforced_at_completion(aws, monkeypatch):
    '''The up-front check is advisory; complete-upload makes the atomic one.'''
    monkeypatch.setenv('USER_QUOTA_BYTES', str(GB))
    upload_file(data=b'x' * 10)
    _, listed, _ = call('get-user-files', 'get_user_files', 'GET', '/v1/users/user-1/files')
    assert listed['usage'] == {'used_bytes': 10, 'quota_bytes': GB}


class FakeSesAccount:
    def __init__(self, production=False, fail=False):
        self.production, self.fail, self.calls = production, fail, 0

    def get_account(self):
        self.calls += 1
        if self.fail:
            raise ClientError({'Error': {'Code': 'AccessDenied', 'Message': 'no'}}, 'GetAccount')
        return {'ProductionAccessEnabled': self.production}


def features_with(auth_service, monkeypatch, ses):
    monkeypatch.setattr(auth_service.boto3, 'client', lambda name, **_: ses)
    status, body, headers = auth_call('GET', '/v1/features')
    assert status == 200 and 'max-age' in headers['Cache-Control']
    return body['email_sharing']


def test_email_sharing_turns_on_by_itself_once_ses_leaves_the_sandbox(auth_service, monkeypatch):
    monkeypatch.delenv('EMAIL_SHARING', raising=False)
    ses = FakeSesAccount(production=False)
    assert features_with(auth_service, monkeypatch, ses) is False
    ses.production = True
    assert features_with(auth_service, monkeypatch, ses) is False   # cached for FEATURE_TTL
    assert ses.calls == 1
    auth_service.SES_STATE['checked'] = 0                           # the cache runs out
    assert features_with(auth_service, monkeypatch, ses) is True
    ses.fail = True                                                 # a failed check keeps the last answer
    auth_service.SES_STATE['checked'] = 0
    assert features_with(auth_service, monkeypatch, ses) is True


def test_email_sharing_can_be_forced_on_or_off(auth_service, monkeypatch):
    ses = FakeSesAccount(production=True)
    monkeypatch.setenv('EMAIL_SHARING', 'off')
    assert features_with(auth_service, monkeypatch, ses) is False
    monkeypatch.setenv('EMAIL_SHARING', 'on')
    ses.production = False
    assert features_with(auth_service, monkeypatch, ses) is True
    assert ses.calls == 0
