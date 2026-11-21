'''Return a short-lived presigned download URL for one of the caller's files.

  GET /v1/users/{user_id}/files/{file_id}/download -> {file_id, file_name, download_url}
'''

import api
import storage

DOWNLOAD_URL_TTL = 3600


@api.route('GET, OPTIONS')
def lambda_handler(event):
    _user, item = api.owned_file(event, ready=True)
    return 200, {'file_id': item['file_id'], 'file_name': item['file_name'],
                 'download_url': storage.presigned_download(item, DOWNLOAD_URL_TTL)}
