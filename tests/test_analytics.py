'''Site heartbeats (endpoints/presence) and the admin Analytics page and
"online now" built on them (endpoints/admin/src/analytics.py).'''

import json
import time

import boto3
import pytest

import tokens
import visits
from conftest import call, load, upload_file

ADMIN = ('admin', 'admin')
CHROME = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) '
          'Chrome/131.0 Safari/537.36')
IPHONE = ('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
          'Version/18.0 Mobile/15E148 Safari/604.1')


def users():
    return boto3.resource('dynamodb').Table('users-test')


def visits_table():
    return boto3.resource('dynamodb').Table('analytics-test')


@pytest.fixture
def people(aws):
    users().put_item(Item={'email': 'boss@example.com', 'user_id': 'admin-1', 'name': 'Boss', 'password': 'x',
                           'role': 'admin', 'created_at': int(time.time()) - 86400})
    users().put_item(Item={'email': 'ada@example.com', 'user_id': 'user-1', 'name': 'Ada', 'password': 'x',
                           'created_at': int(time.time()) - 3600})


def beat(body, token=None, ua=CHROME, ip='198.51.100.4'):
    event = {'httpMethod': 'POST', 'path': '/v1/presence', 'body': json.dumps(body),
             'headers': {'User-Agent': ua, **({'Authorization': 'Bearer ' + token} if token else {})},
             'requestContext': {'identity': {'sourceIp': ip}}}
    response = load('presence', 'presence').lambda_handler(event, None)
    return response['statusCode'], json.loads(response['body'])


def token_for(user_id, email, name):
    now = int(time.time())
    return tokens.sign({'sub': user_id, 'email': email, 'name': name, 'iat': now, 'ver': 0, 'typ': 'id',
                        'exp': now + 3600})


def admin(path, query=None):
    status, data, _ = call(*ADMIN, 'GET', '/v1/admin' + path, user='admin-1', name='Boss',
                           email='boss@example.com', query=query)
    assert status == 200, data
    return data


def sessions():
    return visits_table().scan()['Items']


# --- heartbeats ----------------------------------------------------------------
def test_a_heartbeat_records_the_visit(people):
    status, _ = beat({'sid': 'tab-aaaaaaaa', 'vid': 'browser-1111', 'page': '/', 'view': True, 'new': True,
                      'ref': 'https://www.google.com/search?q=x', 'tz': 'Asia/Kolkata'})
    assert status == 200
    status, _ = beat({'sid': 'tab-aaaaaaaa', 'vid': 'browser-1111', 'page': '/signup', 'view': True, 'secs': 30})
    assert status == 200
    [item] = sessions()
    assert item['pk'].startswith('D#') and item['sk'] == 'tab-aaaaaaaa'
    assert int(item['pv']) == 2 and int(item['secs']) == 30
    assert item['lp'] == '/' and item['cur'] == '/signup'
    assert item['ref'] == 'google.com' and item['tz'] == 'Asia/Kolkata'
    assert (item['dev'], item['br'], item['os']) == ('desktop', 'Chrome', 'Windows')
    assert int(item['p:/']) == 1 and int(item['p:/signup']) == 1
    assert 'uid' not in item


def test_a_signed_in_heartbeat_is_linked_to_the_account(people):
    beat({'sid': 'tab-bbbbbbbb', 'vid': 'browser-2222', 'page': '/app', 'view': True},
         token=token_for('user-1', 'ada@example.com', 'Ada'), ua=IPHONE)
    [item] = sessions()
    assert item['uid'] == 'user-1'
    assert (item['dev'], item['os']) == ('mobile', 'iOS')


def test_a_forged_token_counts_as_a_visitor(people):
    beat({'sid': 'tab-cccccccc', 'vid': 'browser-3333', 'page': '/app', 'view': True}, token='abc.def')
    assert 'uid' not in sessions()[0]


def test_ids_are_folded_out_of_page_paths(people):
    beat({'sid': 'tab-dddddddd', 'vid': 'browser-4444', 'page': '/admin/users/1234-5678', 'view': True})
    assert int(sessions()[0]['p:/admin/users/:id']) == 1


@pytest.mark.parametrize('body', [
    {'sid': 'x', 'vid': 'browser-5555', 'page': '/'},
    {'sid': 'tab-eeeeeeee', 'vid': 'browser-5555', 'page': 'https://evil.example'},
    {'sid': 'tab-eeeeeeee', 'vid': 'browser-5555', 'page': '/', 'secs': -5},
])
def test_bad_heartbeats_are_refused(people, body):
    assert beat(body)[0] == 400
    assert sessions() == []


def test_bots_are_ignored(people):
    assert beat({'sid': 'tab-ffffffff', 'vid': 'browser-6666', 'page': '/', 'view': True},
                ua='Googlebot/2.1 (+http://www.google.com/bot.html)')[0] == 200
    assert sessions() == []


def test_one_ip_cant_flood_heartbeats(people, monkeypatch):
    monkeypatch.setenv('PRESENCE_PER_IP', '3')
    for _ in range(3):
        assert beat({'sid': 'tab-gggggggg', 'vid': 'browser-7777', 'page': '/'})[0] == 200
    assert beat({'sid': 'tab-gggggggg', 'vid': 'browser-7777', 'page': '/'})[0] == 429


# --- online now -------------------------------------------------------------------
def test_live_shows_who_is_online(people):
    beat({'sid': 'tab-hhhhhhhh', 'vid': 'browser-8888', 'page': '/app', 'view': True, 'secs': 10},
         token=token_for('user-1', 'ada@example.com', 'Ada'))
    beat({'sid': 'tab-iiiiiiii', 'vid': 'browser-9999', 'page': '/', 'view': True})
    live = admin('/analytics/live')
    assert live['counts'] == {'online': 2, 'signed_in': 1, 'guests': 1}
    assert live['online'][0]['user']['name'] == 'Ada' and live['online'][0]['page'] == '/app'
    assert live['users']['user-1']['online'] is True


def test_closing_the_tab_goes_offline(people):
    body = {'sid': 'tab-jjjjjjjj', 'vid': 'browser-0000', 'page': '/app', 'view': True}
    beat(body, token=token_for('user-1', 'ada@example.com', 'Ada'))
    beat(dict(body, view=False, leave=True), token=token_for('user-1', 'ada@example.com', 'Ada'))
    assert admin('/analytics/live')['counts']['online'] == 0
    row = next(u for u in admin('/users')['users'] if u['user_id'] == 'user-1')
    assert row['online'] is False and row['last_seen_at']


def test_users_list_marks_online_accounts(people):
    beat({'sid': 'tab-kkkkkkkk', 'vid': 'browser-aaaa', 'page': '/app', 'view': True},
         token=token_for('user-1', 'ada@example.com', 'Ada'))
    rows = {u['user_id']: u for u in admin('/users')['users']}
    assert rows['user-1']['online'] is True
    assert rows['admin-1']['online'] is False and rows['admin-1']['last_seen_at'] is None


# --- the analytics page ----------------------------------------------------------
def test_analytics_counts_traffic_and_product_numbers(people):
    upload_file(user='user-1', name='clip.mp4', data=b'x' * 2048)
    beat({'sid': 'tab-llllllll', 'vid': 'browser-bbbb', 'page': '/', 'view': True, 'secs': 20, 'new': True})
    beat({'sid': 'tab-llllllll', 'vid': 'browser-bbbb', 'page': '/signup', 'view': True, 'secs': 30})
    beat({'sid': 'tab-mmmmmmmm', 'vid': 'browser-cccc', 'page': '/app', 'view': True, 'secs': 40},
         token=token_for('user-1', 'ada@example.com', 'Ada'))
    data = admin('/analytics', {'range': '24h', 'tz': '330'})
    cur = data['kpis']['cur']
    assert (cur['visitors'], cur['sessions'], cur['pageviews']) == (2, 2, 3)
    assert cur['active_users'] == 1 and cur['new_visitors'] == 1
    assert cur['bounce_rate'] == 50.0 and cur['avg_session_seconds'] == 45
    assert cur['signups'] == 1 and cur['uploads'] == 1 and cur['videos'] == 1
    assert len(data['buckets']) == 24 and sum(data['series']['pageviews']) == 3
    assert {p['name']: p['views'] for p in data['pages']} == {'/': 1, '/signup': 1, '/app': 1}
    assert data['files']['videos']['files'] == 1
    assert data['funnel'][1] == {'step': 'Signed up', 'count': 1}
    assert data['funnel'][2]['count'] == 1
    assert data['engagement']['dau'] == 1
    assert data['top_users'][0]['name'] == 'Ada'
    assert sum(sum(row) for row in data['heatmap']) == 90


def test_analytics_checks_the_range(people):
    status, _, _ = call(*ADMIN, 'GET', '/v1/admin/analytics', user='admin-1', name='Boss',
                        email='boss@example.com', query={'range': '1y'})
    assert status == 400


def test_only_admins_see_analytics(people):
    status, _, _ = call(*ADMIN, 'GET', '/v1/admin/analytics/live', user='user-1', email='ada@example.com')
    assert status == 403



def test_retention_counts_only_complete_weeks(people):
    rows = admin('/analytics', {'range': '30d', 'tz': '0'})['retention']
    assert len(rows) == 8
    # oldest cohort first; the current week isn't over, so it never gets a column
    assert [len(r['weeks']) for r in rows] == [6, 5, 4, 3, 2, 1, 0, 0]


def test_last_seen_looks_back_past_today(people):
    old = int(time.time()) - 3 * 86400
    visits.record({'sid': 'tab-oldoldold', 'vid': 'browser-old1', 'page': '/app', 'view': True}, 'user-1', CHROME,
                  now=old)
    row = next(u for u in admin('/users')['users'] if u['user_id'] == 'user-1')
    assert row['online'] is False and row['last_seen_at'] == old * 1000
