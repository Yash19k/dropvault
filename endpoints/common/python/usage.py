'''Per-user storage quota.

Each user has one counter item, USAGE#<user_id> {used_bytes, quota_bytes?},
in the files table. A file counts once its upload is complete (complete-upload
adds its size); deleting it subtracts the size. Unfinished uploads don't count.

The limit is USER_QUOTA_BYTES (0 = unlimited), unless an admin has given the
user their own limit, stored as quota_bytes on the counter (0 = unlimited
too). It is enforced atomically when an upload completes, so parallel uploads
can't sneak past it together. Counters are created on first use from the
user's existing files, so accounts made before quotas existed start with the
right number.
'''

import os

import storage

PREFIX = 'USAGE#'


class QuotaExceeded(Exception):
    pass


def default_quota_bytes():
    try:
        return max(0, int(os.getenv('USER_QUOTA_BYTES') or 0))
    except ValueError:
        return 0


def _key(user_id):
    return {'file_id': PREFIX + user_id}


def effective_quota(counter):
    '''The limit that applies to the user owning this counter item.'''
    if counter and counter.get('quota_bytes') is not None:
        return max(0, int(counter['quota_bytes']))
    return default_quota_bytes()


def counter(user_id):
    '''The user's counter item (created from their files if missing).'''
    table = storage.table()
    item = table.get_item(Key=_key(user_id), ConsistentRead=True).get('Item')
    if item:
        return item
    total = sum(int(f.get('size', 0)) for f in storage.user_files(user_id)
                if f.get('status', 'READY') == 'READY')
    item = dict(_key(user_id), kind='usage', used_bytes=total)
    try:
        table.put_item(Item=item, ConditionExpression='attribute_not_exists(file_id)')
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        # created concurrently: use that one
        return table.get_item(Key=_key(user_id), ConsistentRead=True)['Item']
    return item


def used_bytes(user_id):
    '''Bytes the user's finished files take up.'''
    return int(counter(user_id).get('used_bytes', 0))


def quota_bytes(user_id):
    '''The user's storage limit in bytes (0 = unlimited).'''
    return effective_quota(counter(user_id))


def summary(user_id):
    item = counter(user_id)
    return {'used_bytes': int(item.get('used_bytes', 0)), 'quota_bytes': effective_quota(item)}


def add(user_id, size):
    '''Count `size` more bytes, refusing if that would go over the quota.'''
    quota = quota_bytes(user_id)   # also makes sure the counter exists
    if quota:
        if size > quota:
            raise QuotaExceeded()
        kwargs = {'ConditionExpression': 'used_bytes <= :limit',
                  'ExpressionAttributeValues': {':size': int(size), ':limit': quota - int(size)}}
    else:
        kwargs = {'ExpressionAttributeValues': {':size': int(size)}}
    table = storage.table()
    try:
        table.update_item(Key=_key(user_id), UpdateExpression='ADD used_bytes :size', **kwargs)
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        raise QuotaExceeded() from None


def release(user_id, size):
    '''Stop counting `size` bytes (a finished file was deleted).'''
    table = storage.table()
    try:
        table.update_item(Key=_key(user_id), UpdateExpression='ADD used_bytes :neg',
                          ConditionExpression='attribute_exists(file_id)',
                          ExpressionAttributeValues={':neg': -int(size)})
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        pass  # no counter yet: it will be computed from the remaining files


def set_quota(user_id, quota):
    '''Give the user their own limit in bytes (0 = unlimited), or None to go
       back to the default.'''
    counter(user_id)
    if quota is None:
        storage.table().update_item(Key=_key(user_id), UpdateExpression='REMOVE quota_bytes')
    else:
        storage.table().update_item(Key=_key(user_id), UpdateExpression='SET quota_bytes = :q',
                                    ExpressionAttributeValues={':q': int(quota)})
