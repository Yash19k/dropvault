'''Deleting a file completely: the S3 object (or its unfinished multipart
upload), its record, its short links, and its share of the owner's storage
quota. Used by the delete-file route and by the admin panel.'''

from botocore.exceptions import ClientError

import storage
import usage


def abort_multipart(item):
    try:
        storage.s3().abort_multipart_upload(Bucket=storage.bucket(), Key=storage.object_key(item),
                                            UploadId=item['upload_id'])
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') != 'NoSuchUpload':
            raise


def delete_links(file_id):
    '''Links would stop working anyway; removing them keeps the table tidy.'''
    with storage.table().batch_writer() as batch:
        for link in storage.file_links(file_id):
            batch.delete_item(Key={'file_id': link['file_id']})


def delete_file(item):
    '''Remove the file everywhere. Returns True if this call deleted it.'''
    if item.get('status') == 'UPLOADING' and item.get('upload_id'):
        abort_multipart(item)
    storage.s3().delete_object(Bucket=storage.bucket(), Key=storage.object_key(item))

    # ALL_OLD tells us whether this call really deleted a READY file, so two
    # parallel deletes can't both subtract its size.
    old = storage.table().delete_item(Key={'file_id': item['file_id']},
                                      ReturnValues='ALL_OLD').get('Attributes')
    if old and old.get('status', 'READY') == 'READY':
        usage.release(item['user_id'], int(old.get('size', 0)))
    delete_links(item['file_id'])
    return bool(old)
