'''Start an upload, and hand out URLs for the parts of a large one.

  POST /v1/users/{user_id}/files                  {file_name, content_type?, size?}
       Small files (up to MULTIPART_THRESHOLD) -> upload_type "single":
         {file_id, upload_url, upload_headers}   one presigned PUT
       Larger files -> upload_type "multipart":
         {file_id, part_size, part_count}        then ask for part URLs below
  POST /v1/users/{user_id}/files/{file_id}/parts  {part_numbers: [1, 2, ...], include_uploaded?}
       -> {urls: {"1": url, ...}, uploaded_parts: [...]}

Multipart uploads go straight from the browser to S3 in parts, several at a
time, so there is no 5 GB limit and a dropped connection only costs the part
in flight. Asking with include_uploaded lists the parts S3 already has, which
is how a paused upload resumes (even after a page reload).

Every new file record carries a `ttl` one day out (pushed back while parts
keep coming). If the upload is never completed DynamoDB deletes the record
and the cleanup Lambda removes whatever reached S3.
'''

import math
import os
import time
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

import api
import log
import storage
import usage
import validation

LOGGER = log.setup_logging()
KMS_LOCK_STALE_SECONDS = 60
ABANDON_AFTER = 86400                  # unfinished uploads are cleaned up after a day
MIB = 1024 * 1024
MIN_PART_SIZE = 16 * MIB               # S3 minimum is 5 MiB; bigger parts = fewer requests
MAX_PARTS = 10000                      # S3 maximum
MAX_URLS_PER_REQUEST = 100
PART_URL_TTL = 3600


def multipart_threshold():
    return int(os.getenv('MULTIPART_THRESHOLD') or 100 * MIB)


def part_size_for(size):
    '''Smallest whole-MiB part size >= MIN_PART_SIZE that fits in 10,000 parts.'''
    needed = math.ceil(size / MAX_PARTS)
    return max(MIN_PART_SIZE, math.ceil(needed / MIB) * MIB)


def kms_mode():
    return os.getenv('KMS_MODE', 's3')


def ensure_user_kms_key(user_id):
    '''In per_user mode, return the user's KMS key, creating it EXACTLY ONCE.

    A DynamoDB conditional write (one sentinel item per user) is the lock: only
    the single winner calls kms:CreateKey; every concurrent upload waits for the
    winner to publish the ARN. No races, no orphaned keys. Returns the key ARN,
    or None when per-user mode is off.'''
    if kms_mode() != 'per_user':
        return None

    prefix = os.getenv('KMS_ALIAS_PREFIX', 'enclave')
    alias = 'alias/{0}/user/{1}'.format(prefix, user_id)
    table = storage.table()
    lock_id = 'USERKEY#{0}'.format(user_id)

    record = table.get_item(Key={'file_id': lock_id}).get('Item')
    if record and record.get('kms_key_arn'):
        return record['kms_key_arn']

    kms = boto3.client('kms', region_name=storage.region())

    # The alias may already exist (a user created before this lock existed):
    # adopt it and backfill the sentinel - never create a duplicate key.
    try:
        key_arn = kms.describe_key(KeyId=alias)['KeyMetadata']['Arn']
        table.put_item(Item={'file_id': lock_id, 'kind': 'user_key',
                             'status': 'READY', 'kms_key_arn': key_arn})
        return key_arn
    except kms.exceptions.NotFoundException:
        pass

    conditional_failed = table.meta.client.exceptions.ConditionalCheckFailedException
    try:
        table.put_item(
            Item={'file_id': lock_id, 'kind': 'user_key', 'status': 'CREATING',
                  'claimed_at': int(time.time())},
            ConditionExpression='attribute_not_exists(file_id)')
    except conditional_failed:
        # Another upload is creating it - wait for the ARN to be published.
        for _ in range(40):
            record = table.get_item(Key={'file_id': lock_id}).get('Item')
            if record and record.get('kms_key_arn'):
                return record['kms_key_arn']
            time.sleep(0.25)
        try:
            return kms.describe_key(KeyId=alias)['KeyMetadata']['Arn']
        except kms.exceptions.NotFoundException:
            pass
        # The winner died before creating the key: take over a stale claim,
        # otherwise this user could never upload again. Still atomic.
        try:
            table.update_item(
                Key={'file_id': lock_id},
                UpdateExpression='SET claimed_at = :now',
                ConditionExpression='attribute_not_exists(kms_key_arn) AND '
                                    '(attribute_not_exists(claimed_at) OR claimed_at < :stale)',
                ExpressionAttributeValues={':now': int(time.time()),
                                           ':stale': int(time.time()) - KMS_LOCK_STALE_SECONDS})
        except conditional_failed:
            raise api.ApiError(503, 'Encryption key is still being created, try again shortly') from None

    key_arn = kms.create_key(
        Description='DropVault per-user file key ({0})'.format(user_id),
        Tags=[{'TagKey': 'app', 'TagValue': prefix}, {'TagKey': 'user_id', 'TagValue': user_id}]
    )['KeyMetadata']['Arn']
    kms.create_alias(AliasName=alias, TargetKeyId=key_arn)
    table.update_item(
        Key={'file_id': lock_id},
        UpdateExpression='SET kms_key_arn = :a, #s = :r',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':a': key_arn, ':r': 'READY'})
    return key_arn


def check_quota(user_id, size):
    '''Refuse early when the file obviously won't fit (complete-upload makes
       the final, atomic check).'''
    summary = usage.summary(user_id)
    quota, used = summary['quota_bytes'], summary['used_bytes']
    if not quota:
        return
    if used + size > quota:
        raise api.ApiError(413, 'Not enough storage space for this file',
                           used_bytes=used, quota_bytes=quota)


def create_upload(event):
    user_id, _name, _email = api.require_user(event)
    body = api.json_body(event)
    ok, error = validation.validate_body(body, __file__, 'new_file.json')
    if not ok:
        raise api.ApiError(400, error)

    file_name = body['file_name']
    content_type = body.get('content_type') or 'application/octet-stream'
    size = int(body.get('size') or 0)
    check_quota(user_id, size)

    file_id = str(uuid.uuid4())
    item = {
        'file_id': file_id, 'user_id': user_id, 'file_name': file_name,
        'content_type': content_type, 'size': size,
        'uploaded_at': datetime.now(timezone.utc).isoformat(),
        'status': 'UPLOADING', 'ttl': int(time.time()) + ABANDON_AFTER,
    }
    params = {'Bucket': storage.bucket(), 'Key': storage.object_key(item), 'ContentType': content_type}
    kms_key_arn = ensure_user_kms_key(user_id)
    if kms_key_arn:
        params['ServerSideEncryption'] = 'aws:kms'
        params['SSEKMSKeyId'] = kms_key_arn
        item['kms_key_arn'] = kms_key_arn

    response = {'file_id': file_id, 'status': 'UPLOADING'}
    if size > multipart_threshold():
        upload_id = storage.s3().create_multipart_upload(**params)['UploadId']
        part_size = part_size_for(size)
        item.update(upload_id=upload_id, part_size=part_size, part_count=math.ceil(size / part_size))
        response.update(upload_type='multipart', part_size=part_size, part_count=item['part_count'])
    else:
        # per_user: the browser must echo the matching SSE headers on the PUT.
        upload_headers = {}
        if kms_key_arn:
            upload_headers = {'x-amz-server-side-encryption': 'aws:kms',
                              'x-amz-server-side-encryption-aws-kms-key-id': kms_key_arn}
        response.update(upload_type='single', upload_headers=upload_headers,
                        upload_url=storage.presign_s3().generate_presigned_url(
                            'put_object', Params=params, ExpiresIn=3600))
    storage.table().put_item(Item=item)
    return 201, response


def uploaded_parts(item):
    '''Part numbers S3 already holds for this multipart upload.'''
    numbers = []
    kwargs = {'Bucket': storage.bucket(), 'Key': storage.object_key(item), 'UploadId': item['upload_id']}
    while True:
        page = storage.s3().list_parts(**kwargs)
        numbers.extend(p['PartNumber'] for p in page.get('Parts', []))
        if not page.get('IsTruncated'):
            return numbers
        kwargs['PartNumberMarker'] = page['NextPartNumberMarker']


def part_urls(event):
    _user, item = api.owned_file(event)
    if item.get('status') != 'UPLOADING' or not item.get('upload_id'):
        raise api.ApiError(409, 'This file is not a multipart upload in progress')
    body = api.json_body(event)
    numbers = body.get('part_numbers') or []
    part_count = int(item['part_count'])
    if (not isinstance(numbers, list) or len(numbers) > MAX_URLS_PER_REQUEST
            or not all(isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= part_count
                       for n in numbers)):
        raise api.ApiError(400, 'part_numbers must be up to {0} part numbers from 1 to {1}'.format(
            MAX_URLS_PER_REQUEST, part_count))

    response = {'file_id': item['file_id'], 'part_size': int(item['part_size']), 'part_count': part_count}
    try:
        if body.get('include_uploaded'):
            response['uploaded_parts'] = uploaded_parts(item)
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') == 'NoSuchUpload':
            raise api.ApiError(410, 'This upload has expired. Start it again.') from None
        raise

    signer = storage.presign_s3()
    key = storage.object_key(item)
    response['urls'] = {str(n): signer.generate_presigned_url(
        'upload_part', ExpiresIn=PART_URL_TTL,
        Params={'Bucket': storage.bucket(), 'Key': key, 'UploadId': item['upload_id'], 'PartNumber': n})
        for n in sorted(set(numbers))}
    # still active: don't let the abandoned-upload cleanup take it
    storage.table().update_item(Key={'file_id': item['file_id']}, UpdateExpression='SET #t = :t',
                                ExpressionAttributeNames={'#t': 'ttl'},
                                ExpressionAttributeValues={':t': int(time.time()) + ABANDON_AFTER})
    return 200, response


@api.route('POST, OPTIONS')
def lambda_handler(event):
    if (event.get('path') or '').rstrip('/').endswith('/parts'):
        return part_urls(event)
    return create_upload(event)
