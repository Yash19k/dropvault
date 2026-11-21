'''Clean up uploads that were started but never finished.

Every new file record has a `ttl` one day out, which complete-upload removes.
If an upload is abandoned (tab closed, connection lost for good), DynamoDB's
TTL deletes the record, and this Lambda receives that deletion from the
table's stream. It then aborts the unfinished multipart upload (whose parts
would otherwise be stored and billed) or deletes the half-uploaded object.

The event source mapping (terraform/cleanup.tf) only passes on deletions made
by the TTL service for UPLOADING records; the checks here repeat that filter.
'''

from boto3.dynamodb.types import TypeDeserializer
from botocore.exceptions import ClientError

import log
import storage

LOGGER = log.setup_logging()
DESERIALIZE = TypeDeserializer().deserialize


def expired_upload(record):
    '''The old file item if this stream record is a TTL-expired upload.'''
    if record.get('eventName') != 'REMOVE':
        return None
    identity = record.get('userIdentity') or {}
    if identity.get('type') != 'Service' or identity.get('principalId') != 'dynamodb.amazonaws.com':
        return None
    image = (record.get('dynamodb') or {}).get('OldImage') or {}
    item = {key: DESERIALIZE(value) for key, value in image.items()}
    if item.get('status') != 'UPLOADING' or not item.get('user_id') or not item.get('file_name'):
        return None
    return item


def clean(item):
    s3 = storage.s3()
    key = storage.object_key(item)
    if item.get('upload_id'):
        try:
            s3.abort_multipart_upload(Bucket=storage.bucket(), Key=key, UploadId=item['upload_id'])
        except ClientError as error:
            if error.response.get('Error', {}).get('Code') != 'NoSuchUpload':
                raise
    s3.delete_object(Bucket=storage.bucket(), Key=key)   # no error if it isn't there
    LOGGER.info('cleaned up abandoned upload %s', item['file_id'])


def lambda_handler(event, _context):
    cleaned = 0
    for record in (event or {}).get('Records', []):
        item = expired_upload(record)
        if item:
            clean(item)
            cleaned += 1
    return {'cleaned': cleaned}
