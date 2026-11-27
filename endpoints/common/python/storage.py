'''DynamoDB and S3 access shared by the Lambdas.

The files table (key: file_id) holds several kinds of item:
  <uuid>            a file: user_id, file_name, size, status UPLOADING|READY, ...
  QR#<code>         a short link (see links.py): target_file_id, owner_id, ...
  USAGE#<user_id>   a user's storage counter and own limit, if any (see usage.py)
  USERKEY#<user_id> a user's KMS key (per_user encryption mode)
  STATS#<date>      that day's download count (see stats.py)
  AUDIT#<ms>#<id>   one action taken in the admin panel (endpoints/admin)

Two sparse global secondary indexes avoid scanning the table:
  user-files  (user_id, uploaded_at)        only file items have user_id
  file-links  (target_file_id, created_at)  only link items have target_file_id
Only the admin panel, which shows everything, scans the table.
'''

import mimetypes
import os
import time

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.config import Config

USER_FILES_INDEX = 'user-files'
FILE_LINKS_INDEX = 'file-links'


def table():
    return boto3.resource('dynamodb').Table(os.environ['FILE_SHARING_TABLE'])


def bucket():
    return os.environ['USER_FILES_BUCKET']


def region():
    return os.getenv('REGION') or os.getenv('AWS_REGION') or 'us-east-1'


def s3():
    '''Plain S3 client for server-side calls.'''
    return boto3.client('s3', region_name=region())


def presign_s3():
    '''S3 client for presigned URLs the browser uses: SigV4 against the REGIONAL
       virtual-hosted endpoint (needed for SSE-KMS, and the global endpoint's
       307 redirect breaks browser CORS uploads).'''
    return boto3.client(
        's3', region_name=region(),
        endpoint_url='https://s3.{0}.amazonaws.com'.format(region()),
        config=Config(signature_version='s3v4', s3={'addressing_style': 'virtual'}))


def object_key(item):
    '''S3 key of a file: namespaced by user and file id, so names never collide.'''
    return '{0}/{1}/{2}'.format(item['user_id'], item['file_id'], item['file_name'])


def get_file(file_id):
    return table().get_item(Key={'file_id': file_id}).get('Item')


def _query_all(**kwargs):
    '''Every item of a Query, following pagination (1 MB per page).'''
    items = []
    while True:
        response = table().query(**kwargs)
        items.extend(response.get('Items', []))
        if 'LastEvaluatedKey' not in response:
            return items
        kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']


def scan_all(source):
    '''Every item in a table, following pagination (admin panel only).'''
    items, kwargs = [], {}
    while True:
        response = source.scan(**kwargs)
        items.extend(response.get('Items', []))
        if 'LastEvaluatedKey' not in response:
            return items
        kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']


def user_files(user_id):
    '''All of a user's file items, newest first.'''
    return _query_all(IndexName=USER_FILES_INDEX, KeyConditionExpression=Key('user_id').eq(user_id),
                      ScanIndexForward=False)


def pending_uploads(user_id):
    '''The user's unfinished uploads that haven't been abandoned yet (TTL can
       take a while to delete expired ones): [{file_id, size, ttl}].'''
    now = int(time.time())
    items = _query_all(IndexName=USER_FILES_INDEX, KeyConditionExpression=Key('user_id').eq(user_id),
                       FilterExpression=Attr('status').eq('UPLOADING'),
                       ProjectionExpression='file_id, #sz, #t',
                       ExpressionAttributeNames={'#sz': 'size', '#t': 'ttl'})
    return [item for item in items if int(item.get('ttl') or now + 1) > now]


def file_links(file_id):
    '''All short-link items pointing at a file, newest first.'''
    return _query_all(IndexName=FILE_LINKS_INDEX, KeyConditionExpression=Key('target_file_id').eq(file_id),
                      ScanIndexForward=False)


def presigned_download(item, expires_in):
    '''Presigned GET that downloads with the original file name.'''
    from auth import content_disposition
    return presign_s3().generate_presigned_url(
        'get_object',
        Params={'Bucket': bucket(), 'Key': object_key(item),
                'ResponseContentDisposition': content_disposition(item['file_name'])},
        ExpiresIn=expires_in)


# Types the browser may render as-is in a preview. SVG is deliberately NOT
# here: it can carry <script> that runs when the browser renders it inline, so
# it (like HTML) is served as plain text instead and can never run as a page.
PREVIEW_TYPES = {
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp',
    'image/x-icon', 'image/vnd.microsoft.icon',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska', 'video/x-m4v',
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/webm',
    'audio/flac', 'audio/x-flac', 'audio/aac', 'audio/mp4', 'audio/x-m4a',
    'application/pdf',
}


def preview_content_type(item):
    content_type = (item.get('content_type') or '').split(';')[0].strip().lower()
    if content_type in ('', 'application/octet-stream'):
        # the browser didn't know the type at upload time: go by the extension
        content_type = (mimetypes.guess_type(item['file_name'])[0] or '').lower()
    return content_type if content_type in PREVIEW_TYPES else 'text/plain; charset=utf-8'


def presigned_preview(item, expires_in):
    '''Presigned GET that the browser shows instead of saving (in-app preview):
       (url, content type it is served with).'''
    from auth import inline_disposition
    content_type = preview_content_type(item)
    url = presign_s3().generate_presigned_url(
        'get_object',
        Params={'Bucket': bucket(), 'Key': object_key(item),
                'ResponseContentDisposition': inline_disposition(item['file_name']),
                'ResponseContentType': content_type},
        ExpiresIn=expires_in)
    return url, content_type
