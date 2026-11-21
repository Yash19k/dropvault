'''Delete one of the caller's files: the S3 object (or the unfinished
multipart upload), its record, its short links, and its share of the
storage quota (see deletion.py in the shared layer).

  DELETE /v1/users/{user_id}/files/{file_id}
'''

import api
import deletion


@api.route('DELETE, OPTIONS')
def lambda_handler(event):
    (user_id, _name, _email), item = api.owned_file(event)
    deletion.delete_file(item)
    return 200, {'user_id': user_id, 'file_id': item['file_id'], 'file_name': item['file_name'],
                 'file_status': 'DELETED'}
