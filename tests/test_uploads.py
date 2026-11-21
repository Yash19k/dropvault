'''Uploads (single and multipart), listing, quota, download and delete.'''

import pytest

from conftest import GB, call, load, s3, table, upload_file

BUCKET = 'files-bucket-test'


def files_path(user='user-1'):
    return '/v1/users/{0}/files'.format(user)


def test_single_upload_lists_file_and_counts_usage(aws):
    file_id = upload_file(data=b'x' * 1234)
    status, body, _ = call('get-user-files', 'get_user_files', 'GET', files_path())
    assert status == 200
    assert [f['file_id'] for f in body['user_files']] == [file_id]
    assert body['user_files'][0]['status'] == 'READY'
    assert body['user_files'][0]['size'] == 1234
    assert body['usage'] == {'used_bytes': 1234, 'quota_bytes': 10 * GB}
    # finished uploads lose their abandoned-upload ttl
    assert 'ttl' not in table().get_item(Key={'file_id': file_id})['Item']


def test_list_only_returns_the_callers_files(aws):
    mine = upload_file(user='user-1')
    upload_file(user='user-2')
    status, body, _ = call('get-user-files', 'get_user_files', 'GET', files_path())
    assert status == 200
    assert [f['file_id'] for f in body['user_files']] == [mine]


def test_new_upload_record_expires_if_never_finished(aws):
    status, body, _ = call('upload-file', 'upload_file', 'POST', files_path(),
                           {'file_name': 'a.bin', 'size': 10})
    assert status == 201 and body['upload_type'] == 'single'
    item = table().get_item(Key={'file_id': body['file_id']})['Item']
    assert item['status'] == 'UPLOADING' and int(item['ttl']) > 0


def test_requests_need_a_user_and_their_own_path(aws):
    status, _, _ = call('get-user-files', 'get_user_files', 'GET', files_path(), user=None)
    assert status == 401
    status, _, _ = call('get-user-files', 'get_user_files', 'GET', files_path('someone-else'))
    assert status == 403


def test_invalid_file_name_is_rejected(aws):
    status, body, _ = call('upload-file', 'upload_file', 'POST', files_path(), {'file_name': '../etc/passwd'})
    assert status == 400


def test_upload_refused_up_front_when_quota_is_full(aws, monkeypatch):
    monkeypatch.setenv('USER_QUOTA_BYTES', '100')
    upload_file(data=b'x' * 60)
    status, body, _ = call('upload-file', 'upload_file', 'POST', files_path(), {'file_name': 'b', 'size': 50})
    assert status == 413
    assert body['used_bytes'] == 60 and body['quota_bytes'] == 100


def test_quota_enforced_on_real_size_at_completion(aws, monkeypatch):
    '''A client can declare a small size and upload more: the real size counts.'''
    monkeypatch.setenv('USER_QUOTA_BYTES', '100')
    status, body, _ = call('upload-file', 'upload_file', 'POST', files_path(), {'file_name': 'big', 'size': 1})
    key = 'user-1/{0}/big'.format(body['file_id'])
    s3().put_object(Bucket=BUCKET, Key=key, Body=b'x' * 500)
    status, done, _ = call('complete-upload', 'complete_upload', 'POST',
                           '{0}/{1}/complete'.format(files_path(), body['file_id']))
    assert status == 413
    assert 'Item' not in table().get_item(Key={'file_id': body['file_id']})
    assert s3().list_objects_v2(Bucket=BUCKET).get('KeyCount') == 0


def test_usage_counter_is_backfilled_for_existing_users(aws):
    '''Accounts from before quotas have files but no counter.'''
    table().put_item(Item={'file_id': 'old-1', 'user_id': 'user-1', 'file_name': 'a', 'size': 300,
                           'uploaded_at': '2026-01-01T00:00:00', 'status': 'READY'})
    status, body, _ = call('get-user-files', 'get_user_files', 'GET', files_path())
    assert body['usage']['used_bytes'] == 300


def test_complete_twice_counts_once(aws):
    file_id = upload_file(data=b'x' * 10)
    status, body, _ = call('complete-upload', 'complete_upload', 'POST',
                           '{0}/{1}/complete'.format(files_path(), file_id))
    assert status == 200
    _, listing, _ = call('get-user-files', 'get_user_files', 'GET', files_path())
    assert listing['usage']['used_bytes'] == 10


def test_complete_before_bytes_arrive_is_409(aws):
    status, body, _ = call('upload-file', 'upload_file', 'POST', files_path(), {'file_name': 'a', 'size': 5})
    status, done, _ = call('complete-upload', 'complete_upload', 'POST',
                           '{0}/{1}/complete'.format(files_path(), body['file_id']))
    assert status == 409


@pytest.fixture
def small_parts(monkeypatch):
    '''Make "large" files tiny: multipart above 10 bytes, 4-byte parts.'''
    mod = load('upload-file', 'upload_file')
    monkeypatch.setenv('MULTIPART_THRESHOLD', '10')
    monkeypatch.setattr(mod, 'MIB', 1)
    monkeypatch.setattr(mod, 'MIN_PART_SIZE', 4)
    return mod


def start_multipart(data):
    status, body, _ = call('upload-file', 'upload_file', 'POST', files_path(),
                           {'file_name': 'movie.mp4', 'content_type': 'video/mp4', 'size': len(data)})
    assert status == 201, body
    return body


def send_parts(file_id, data, part_size, numbers):
    item = table().get_item(Key={'file_id': file_id})['Item']
    for n in numbers:
        s3().upload_part(Bucket=BUCKET, Key='user-1/{0}/movie.mp4'.format(file_id), UploadId=item['upload_id'],
                         PartNumber=n, Body=data[(n - 1) * part_size:n * part_size])


def test_multipart_upload_resumes_and_completes(aws, small_parts):
    data = b'0123456789abcdefghij'                     # 20 bytes -> 5 parts of 4
    start = start_multipart(data)
    assert start['upload_type'] == 'multipart'
    assert (start['part_size'], start['part_count']) == (4, 5)
    assert 'upload_url' not in start
    parts_path = '{0}/{1}/parts'.format(files_path(), start['file_id'])

    status, body, _ = call('upload-file', 'upload_file', 'POST', parts_path, {'part_numbers': [1, 2, 3]})
    assert status == 200 and sorted(body['urls']) == ['1', '2', '3']
    send_parts(start['file_id'], data, 4, [1, 2])      # connection drops after 2 parts

    # "resume": ask which parts S3 already has
    status, body, _ = call('upload-file', 'upload_file', 'POST', parts_path,
                           {'part_numbers': [3, 4, 5], 'include_uploaded': True})
    assert body['uploaded_parts'] == [1, 2]

    status, early, _ = call('complete-upload', 'complete_upload', 'POST',
                            '{0}/{1}/complete'.format(files_path(), start['file_id']))
    assert status == 409 and early['missing_parts'] == [3, 4, 5]

    send_parts(start['file_id'], data, 4, [3, 4, 5])
    status, done, _ = call('complete-upload', 'complete_upload', 'POST',
                           '{0}/{1}/complete'.format(files_path(), start['file_id']))
    assert status == 200 and done['size'] == 20
    stored = s3().get_object(Bucket=BUCKET, Key='user-1/{0}/movie.mp4'.format(start['file_id']))['Body'].read()
    assert stored == data
    item = table().get_item(Key={'file_id': start['file_id']})['Item']
    assert item['status'] == 'READY' and 'upload_id' not in item


def test_part_numbers_are_validated(aws, small_parts):
    start = start_multipart(b'x' * 20)
    parts_path = '{0}/{1}/parts'.format(files_path(), start['file_id'])
    for bad in ([0], [6], ['1'], list(range(1, 102))):
        status, _, _ = call('upload-file', 'upload_file', 'POST', parts_path, {'part_numbers': bad})
        assert status == 400, bad


def test_list_marks_unfinished_multipart_as_resumable(aws, small_parts):
    start = start_multipart(b'x' * 20)
    _, body, _ = call('get-user-files', 'get_user_files', 'GET', files_path())
    entry = next(f for f in body['user_files'] if f['file_id'] == start['file_id'])
    assert entry['status'] == 'UPLOADING' and entry['resumable'] is True


def test_part_size_fits_within_ten_thousand_parts():
    mod = load('upload-file', 'upload_file')
    assert mod.part_size_for(200 * 1024 ** 2) == 16 * 1024 ** 2
    huge = 1024 ** 4                                       # 1 TiB
    assert huge / mod.part_size_for(huge) <= 10000


def test_delete_releases_quota_and_removes_object(aws):
    file_id = upload_file(data=b'x' * 40)
    status, _, _ = call('delete-user-file', 'delete_user_file', 'DELETE', '{0}/{1}'.format(files_path(), file_id))
    assert status == 200
    _, body, _ = call('get-user-files', 'get_user_files', 'GET', files_path())
    assert body['user_files'] == [] and body['usage']['used_bytes'] == 0
    assert s3().list_objects_v2(Bucket=BUCKET).get('KeyCount') == 0


def test_delete_unfinished_multipart_aborts_it(aws, small_parts):
    start = start_multipart(b'x' * 20)
    send_parts(start['file_id'], b'x' * 20, 4, [1])
    status, _, _ = call('delete-user-file', 'delete_user_file', 'DELETE',
                        '{0}/{1}'.format(files_path(), start['file_id']))
    assert status == 200
    assert s3().list_multipart_uploads(Bucket=BUCKET).get('Uploads', []) == []
    _, body, _ = call('get-user-files', 'get_user_files', 'GET', files_path())
    assert body['usage']['used_bytes'] == 0


def test_cannot_touch_someone_elses_file(aws):
    file_id = upload_file(user='user-2')
    status, _, _ = call('download-file', 'download_file', 'GET', '{0}/{1}/download'.format(files_path(), file_id))
    assert status == 404
    status, _, _ = call('delete-user-file', 'delete_user_file', 'DELETE', '{0}/{1}'.format(files_path(), file_id))
    assert status == 404


def test_download_returns_presigned_url(aws):
    file_id = upload_file(name='report final.pdf')
    status, body, _ = call('download-file', 'download_file', 'GET', '{0}/{1}/download'.format(files_path(), file_id))
    assert status == 200 and body['file_name'] == 'report final.pdf'
    assert 'X-Amz-Signature' in body['download_url']
