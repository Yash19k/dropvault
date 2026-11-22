'''Finish an upload once the browser has sent the bytes to S3.

  POST /v1/users/{user_id}/files/{file_id}/complete

For a multipart upload this stitches the parts together in S3 (the server
lists the parts itself, so the browser doesn't need to report ETags). It then
records the real size, counts it against the user's storage quota, and marks
the file READY. A file that doesn't fit in the quota is deleted and 413 is
returned. Calling it again for a READY file is harmless.
'''

from botocore.exceptions import ClientError

import api
import log
import storage
import usage

LOGGER = log.setup_logging()


def already_completed(item):
    '''True if a parallel call has already stitched this upload together.'''
    current = storage.get_file(item['file_id']) or {}
    if current.get('status') == 'READY':
        return True
    try:
        storage.s3().head_object(Bucket=storage.bucket(), Key=storage.object_key(item))
        return True
    except ClientError:
        return False


def finish_multipart(item):
    '''Combine the uploaded parts into the final object.'''
    s3 = storage.s3()
    kwargs = {'Bucket': storage.bucket(), 'Key': storage.object_key(item), 'UploadId': item['upload_id']}
    parts = []
    try:
        while True:
            page = s3.list_parts(**kwargs)
            parts.extend({'PartNumber': p['PartNumber'], 'ETag': p['ETag']} for p in page.get('Parts', []))
            if not page.get('IsTruncated'):
                break
            kwargs['PartNumberMarker'] = page['NextPartNumberMarker']
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') == 'NoSuchUpload':
            if already_completed(item):
                return
            raise api.ApiError(410, 'This upload has expired. Start it again.') from None
        raise
    have = {p['PartNumber'] for p in parts}
    missing = [n for n in range(1, int(item['part_count']) + 1) if n not in have]
    if missing:
        raise api.ApiError(409, 'Some parts have not been uploaded yet', missing_parts=missing[:100])
    try:
        s3.complete_multipart_upload(MultipartUpload={'Parts': sorted(parts, key=lambda p: p['PartNumber'])},
                                     **{k: kwargs[k] for k in ('Bucket', 'Key', 'UploadId')})
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') == 'NoSuchUpload' and already_completed(item):
            return
        raise


def discard(item):
    '''Remove a file that can't be kept (over quota).'''
    storage.s3().delete_object(Bucket=storage.bucket(), Key=storage.object_key(item))
    storage.table().delete_item(Key={'file_id': item['file_id']})


@api.route('POST, OPTIONS')
def lambda_handler(event):
    (user_id, _name, _email), item = api.owned_file(event)
    if item.get('status') == 'READY':
        return 200, {'file_id': item['file_id'], 'status': 'READY', 'size': int(item.get('size', 0))}

    if item.get('upload_id'):
        finish_multipart(item)
        current = storage.get_file(item['file_id']) or {}
        if current.get('status') == 'READY':   # a parallel call finished (and counted) it
            return 200, {'file_id': item['file_id'], 'status': 'READY', 'size': int(current.get('size', 0))}
    try:
        size = int(storage.s3().head_object(Bucket=storage.bucket(),
                                            Key=storage.object_key(item))['ContentLength'])
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') in ('404', 'NoSuchKey', 'NotFound'):
            raise api.ApiError(409, 'The file has not reached storage yet') from None
        raise

    try:
        usage.add(user_id, size)
    except usage.QuotaExceeded:
        discard(item)
        raise api.ApiError(413, 'Not enough storage space for this file',
                           used_bytes=usage.used_bytes(user_id), quota_bytes=usage.quota_bytes(user_id)) from None

    table = storage.table()
    try:
        table.update_item(
            Key={'file_id': item['file_id']},
            UpdateExpression='SET #s = :ready, #sz = :size REMOVE #t, upload_id, part_size, part_count',
            ConditionExpression='#s = :uploading',
            ExpressionAttributeNames={'#s': 'status', '#t': 'ttl', '#sz': 'size'},
            ExpressionAttributeValues={':ready': 'READY', ':uploading': 'UPLOADING', ':size': size})
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        usage.release(user_id, size)   # a parallel call already completed (and counted) it
    return 200, {'file_id': item['file_id'], 'status': 'READY', 'size': size}
