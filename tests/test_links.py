'''Short links: download limits, stats, turning links off, email sharing.'''

import time

import boto3

from conftest import call, load, table, upload_file

QR = ('qr-link', 'qr_link')


def link_path(file_id, suffix='qr', user='user-1'):
    return '/v1/users/{0}/files/{1}/{2}'.format(user, file_id, suffix)


def make_link(file_id, **body):
    status, created, _ = call(*QR, 'POST', link_path(file_id), body)
    assert status == 201, created
    return created['short_url'].rsplit('/', 1)[1], created


def open_link(code, method='GET'):
    return call(*QR, method, '/v1/d/{0}'.format(code), user=None)


def links_of(file_id):
    status, body, _ = call(*QR, 'GET', link_path(file_id, 'links'))
    assert status == 200
    return body


def test_unlimited_link_redirects_and_counts(aws):
    file_id = upload_file()
    code, created = make_link(file_id, expires_in=3600)
    assert created['short_url'] == 'https://api.example.com/v1/d/' + code
    for _ in range(2):
        status, _, response = open_link(code)
        assert status == 302 and 'X-Amz-Signature' in response['headers']['Location']
    listing = links_of(file_id)
    assert listing['links'][0]['downloads'] == 2
    assert listing['links'][0]['last_downloaded_at'] is not None
    assert listing['download_count'] == 2


def test_limited_link_needs_a_button_press_and_stops_at_the_limit(aws):
    file_id = upload_file(name='contract.pdf')
    code, created = make_link(file_id, max_downloads=2)
    assert created['max_downloads'] == 2

    # opening (as a mail scanner would) shows a page and uses nothing up
    status, page, _ = open_link(code)
    assert status == 200 and 'contract.pdf' in page and 'method="post"' in page and '2 more times' in page
    assert links_of(file_id)['links'][0]['downloads'] == 0

    for _ in range(2):
        status, _, response = open_link(code, 'POST')
        assert status == 303 and 'X-Amz-Signature' in response['headers']['Location']
    status, page, _ = open_link(code, 'POST')
    assert status == 410 and 'Download limit reached' in page
    status, page, _ = open_link(code)
    assert status == 410
    assert links_of(file_id)['links'][0]['status'] == 'limit_reached'


def test_bad_options_are_rejected(aws):
    file_id = upload_file()
    for body in ({'max_downloads': 0}, {'max_downloads': 1001}, {'max_downloads': '3'},
                 {'max_downloads': True}, {'expires_in': 5}):
        status, _, _ = call(*QR, 'POST', link_path(file_id), body)
        assert status == 400, body


def test_turn_off_one_link_leaves_the_others(aws):
    file_id = upload_file()
    first, _ = make_link(file_id)
    second, _ = make_link(file_id, channel='qr')
    status, _, _ = call(*QR, 'DELETE', link_path(file_id, 'links/' + first))
    assert status == 200
    status, page, _ = open_link(first)
    assert status == 410 and 'turned this link off' in page
    assert open_link(second)[0] == 302
    by_code = {link['code']: link for link in links_of(file_id)['links']}
    assert by_code[first]['status'] == 'revoked' and by_code[second]['status'] == 'active'
    assert by_code[second]['channel'] == 'qr'


def test_cannot_turn_off_a_link_of_another_file(aws):
    mine = upload_file()
    theirs = upload_file(user='user-2')
    _, created, _ = call(*QR, 'POST', link_path(theirs, user='user-2'), {}, user='user-2')
    their_code = created['short_url'].rsplit('/', 1)[1]
    status, _, _ = call(*QR, 'DELETE', link_path(mine, 'links/' + their_code))
    assert status == 404
    assert open_link(their_code)[0] == 302


def test_turn_off_all_links(aws):
    file_id = upload_file()
    code, _ = make_link(file_id)
    time.sleep(0.002)
    status, _, _ = call(*QR, 'DELETE', link_path(file_id))
    assert status == 200
    assert open_link(code)[0] == 410
    time.sleep(0.002)
    newer, _ = make_link(file_id)          # links made afterwards work
    assert open_link(newer)[0] == 302


def test_expired_link(aws):
    file_id = upload_file()
    code, _ = make_link(file_id, expires_in=900)
    table().update_item(Key={'file_id': 'QR#' + code}, UpdateExpression='SET expires_at = :past',
                        ExpressionAttributeValues={':past': int(time.time()) - 10})
    status, page, _ = open_link(code)
    assert status == 410 and 'Link expired' in page


def test_unknown_and_malformed_codes(aws):
    assert open_link('doesNotExist1')[0] == 404
    assert open_link('bad<code>')[0] == 404


def test_deleting_a_file_removes_its_links(aws):
    file_id = upload_file()
    code, _ = make_link(file_id)
    call('delete-user-file', 'delete_user_file', 'DELETE', '/v1/users/user-1/files/' + file_id)
    assert 'Item' not in table().get_item(Key={'file_id': 'QR#' + code})
    assert open_link(code)[0] == 404


def test_share_by_email_makes_one_link_per_recipient(aws):
    file_id = upload_file(name='plan.pdf')
    status, body, _ = call('share-file', 'share_file', 'POST', link_path(file_id, 'share'),
                           {'share_with': ['a@example.com', 'b@example.com'], 'expires_in': 86400,
                            'max_downloads': 1})
    assert status == 201, body
    assert body['max_downloads'] == 1 and body['expires_at'] is not None
    links = links_of(file_id)['links']
    assert sorted(link['recipient'] for link in links) == ['a@example.com', 'b@example.com']
    assert {link['channel'] for link in links} == {'email'}
    assert len({link['code'] for link in links}) == 2
    assert all(link['max_downloads'] == 1 for link in links)
    sent = boto3.client('ses').get_send_statistics()['SendDataPoints']
    assert sum(p['DeliveryAttempts'] for p in sent) == 2


def test_share_email_escapes_user_text():
    share = load('share-file', 'share_file')
    html = share.build_email_html('<b>Eve</b>', '<script>x</script>.pdf', 'https://x/d/a"b', 'DropVault', 3600, 1)
    assert '<script>' not in html and '<b>Eve</b>' not in html
    assert 'once' in html


def test_share_validates_recipients(aws):
    file_id = upload_file()
    status, _, _ = call('share-file', 'share_file', 'POST', link_path(file_id, 'share'),
                        {'share_with': ['not-an-email']})
    assert status == 400
