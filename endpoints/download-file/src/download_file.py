'''Return a short-lived presigned URL for one of the caller's files.

  GET /v1/users/{user_id}/files/{file_id}/download           -> {file_id, file_name, download_url}
  GET /v1/users/{user_id}/files/{file_id}/download?inline=1  -> {..., preview_url, content_type}

inline=1 is for the in-app preview: the URL opens the file in the browser
(Content-Disposition: inline) instead of saving it.
'''

import api
import storage

DOWNLOAD_URL_TTL = 3600
# Long enough to watch a film without the video stopping half way.
PREVIEW_URL_TTL = 4 * 3600


@api.route('GET, OPTIONS')
def lambda_handler(event):
    _user, item = api.owned_file(event, ready=True)
    body = {'file_id': item['file_id'], 'file_name': item['file_name']}
    if api.query_param(event, 'inline') in ('1', 'true'):
        url, content_type = storage.presigned_preview(item, PREVIEW_URL_TTL)
        body.update(preview_url=url, content_type=content_type)
    else:
        body['download_url'] = storage.presigned_download(item, DOWNLOAD_URL_TTL)
    return 200, body
