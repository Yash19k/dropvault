'''List the caller's files and how much of their storage quota they use.

  GET /v1/users/{user_id}/files
      -> {user_id, user_files: [...], usage: {used_bytes, quota_bytes}}

Reads the user-files index (user_id -> files), so it only touches this
user's items instead of scanning the whole table.
'''

import api
import storage
import usage


def describe(item):
    entry = {
        'file_id': item['file_id'],
        'file_name': item['file_name'],
        'content_type': item.get('content_type', 'application/octet-stream'),
        'size': int(item.get('size', 0)),
        'uploaded_at': item.get('uploaded_at'),
        'status': item.get('status', 'READY'),
        'download_count': int(item.get('download_count', 0)),
    }
    if entry['status'] == 'UPLOADING':
        # a multipart upload can be resumed by uploading the same file again
        entry['resumable'] = bool(item.get('upload_id'))
    return entry


@api.route('GET, OPTIONS')
def lambda_handler(event):
    user_id, _name, _email = api.require_user(event)
    files = [describe(item) for item in storage.user_files(user_id)]
    return 200, {'user_id': user_id, 'user_files': files, 'usage': usage.summary(user_id)}
