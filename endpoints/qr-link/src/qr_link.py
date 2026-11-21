'''Short download links: create, list with stats, turn off, and follow.

Owner routes (Bearer token):
  POST   /v1/users/{user_id}/files/{file_id}/qr
         {expires_in?, max_downloads?, channel?: "link"|"qr"} -> {short_url, expires_at, max_downloads}
  DELETE /v1/users/{user_id}/files/{file_id}/qr            turn off every link to the file
  GET    /v1/users/{user_id}/files/{file_id}/links         every link with its download stats
  DELETE /v1/users/{user_id}/files/{file_id}/links/{code}  turn off one link

Public routes (what people open):
  GET    /v1/d/{code}   unlimited link -> 302 to a fresh 5-minute S3 download
                        limited link   -> a page with a Download button
  POST   /v1/d/{code}   the Download button -> counts one download, then 303 to S3

Links with a download limit wait for a button press because email security
scanners and chat apps open links on their own to preview them; a plain GET
would use up a one-time link before the recipient ever saw it.

A presigned S3 URL is ~1,500 characters, too dense for a QR code to scan
reliably; the short link is ~80. Link records are described in links.py.
'''

import html
import time

import api
import auth
import links
import log
import storage

LOGGER = log.setup_logging()
REDIRECT_TTL = 300   # lifetime of the presigned URL behind each download


# --- public pages --------------------------------------------------------------
def html_page(status, title, message, extra=''):
    '''A small page for people opening a link (often on a phone).'''
    body = '''<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>{t}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f7f5;
font-family:'IBM Plex Sans',Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1b18;padding:24px;box-sizing:border-box">
<div style="max-width:400px;width:100%;box-sizing:border-box;background:#fff;border:1px solid #e5e5e0;border-radius:8px;padding:28px;text-align:center">
<div style="font-size:13px;font-weight:600;color:#0e6b5e;margin:0 0 14px">DropVault</div>
<h1 style="font-size:19px;margin:0 0 10px;word-break:break-word">{t}</h1>
<p style="color:#5c5c55;font-size:14px;line-height:1.6;margin:0">{m}</p>{x}</div></body></html>'''.format(
        t=html.escape(title), m=html.escape(message), x=extra)
    return {'statusCode': status, 'body': body, 'isBase64Encoded': False,
            'headers': {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
                        'X-Robots-Tag': 'noindex'}}


def format_size(size):
    size = float(size or 0)
    for unit in ('B', 'KB', 'MB', 'GB'):
        if size < 1024:
            return '{0:.0f} {1}'.format(size, unit) if unit == 'B' else '{0:.1f} {1}'.format(size, unit)
        size /= 1024
    return '{0:.1f} TB'.format(size)


def unusable_page(state, link):
    if state == 'expired':
        return html_page(410, 'Link expired', 'This link expired on {0}. Ask the person who shared it '
                         'for a new one.'.format(links.format_utc(link['expires_at'])))
    if state == 'revoked':
        return html_page(410, 'Link turned off', 'The person who shared this file has turned this link off. '
                         'Ask them for a new one if you still need it.')
    if state == 'limit_reached':
        return html_page(410, 'Download limit reached', 'This link has been used as many times as the '
                         'person who shared it allowed. Ask them for a new one if you still need it.')
    return html_page(404, 'File not available',
                     'The file behind this link has been deleted or is no longer available.')


def download_button_page(link, item):
    left = int(link['max_downloads']) - int(link.get('downloads', 0))
    note = 'This link can be used {0} more {1}.'.format(left, 'time' if left == 1 else 'times')
    button = ('<form method="post" style="margin:22px 0 0"><button type="submit" style="background:#0e6b5e;'
              'color:#fff;border:0;border-radius:6px;padding:11px 22px;font-size:14px;font-weight:600;'
              'cursor:pointer">Download ({0})</button></form>'
              '<p style="color:#8b8b83;font-size:12px;margin:14px 0 0">{1}</p>').format(
                  html.escape(format_size(item.get('size'))), html.escape(note))
    return html_page(200, item['file_name'], 'Shared with you on DropVault.', button)


def follow_link(event):
    code = ((event.get('pathParameters') or {}).get('code')
            or (event.get('path') or '').rstrip('/').split('/')[-1])
    table = storage.table()
    link = table.get_item(Key={'file_id': 'QR#' + code}).get('Item') if links.valid_code(code) else None
    if not link or link.get('kind') != 'qr_link':
        return html_page(404, 'Link not found', 'This download link is invalid or has expired. '
                         'Ask the person who shared it for a new one.')
    item = storage.get_file(link['target_file_id'])
    state = links.status(link, item)
    if state != 'active':
        return unusable_page(state, link)
    if link.get('max_downloads') and event.get('httpMethod') != 'POST':
        return download_button_page(link, item)
    if not links.record_download(table, link):
        return unusable_page('limit_reached', link)
    return {'statusCode': 303 if event.get('httpMethod') == 'POST' else 302, 'body': '',
            'isBase64Encoded': False,
            'headers': {'Location': storage.presigned_download(item, REDIRECT_TTL), 'Cache-Control': 'no-store'}}


# --- owner routes ----------------------------------------------------------------
def create_link(event):
    body = api.json_body(event)
    ttl, error = links.parse_expires_in(body.get('expires_in'))
    if error:
        raise api.ApiError(400, error)
    max_downloads, error = links.parse_max_downloads(body.get('max_downloads'))
    if error:
        raise api.ApiError(400, error)
    channel = body.get('channel') if body.get('channel') in ('link', 'qr') else 'link'
    (user_id, _name, _email), item = api.owned_file(event, ready=True)
    short_url, expires_at = links.create(storage.table(), event, item['file_id'], user_id, ttl,
                                         channel=channel, max_downloads=max_downloads)
    return 201, {'short_url': short_url, 'expires_at': expires_at, 'max_downloads': max_downloads}


def revoke_all(event):
    _user, item = api.owned_file(event)
    revoked_at = int(time.time() * 1000)
    storage.table().update_item(Key={'file_id': item['file_id']},
                                UpdateExpression='SET links_revoked_at = :t',
                                ExpressionAttributeValues={':t': revoked_at})
    return 200, {'file_id': item['file_id'], 'links_revoked_at': revoked_at}


def list_links(event):
    _user, item = api.owned_file(event)
    found = [links.describe(event, link, item) for link in storage.file_links(item['file_id'])]
    return 200, {'file_id': item['file_id'], 'links': found,
                 'download_count': int(item.get('download_count', 0))}


def revoke_one(event):
    (user_id, _name, _email), item = api.owned_file(event)
    code = auth.path_param(event, 'code', 7)
    if not links.valid_code(code):
        raise api.ApiError(404, 'Link not found')
    table = storage.table()
    try:
        table.update_item(
            Key={'file_id': 'QR#' + code},
            UpdateExpression='SET revoked_at = :now',
            ConditionExpression='target_file_id = :f AND owner_id = :u',
            ExpressionAttributeValues={':now': int(time.time()), ':f': item['file_id'], ':u': user_id})
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        raise api.ApiError(404, 'Link not found') from None
    return 200, {'code': code, 'status': 'revoked'}


@api.route('GET, POST, DELETE, OPTIONS')
def owner_routes(event):
    method = event.get('httpMethod')
    parts = (event.get('path') or '').rstrip('/').split('/')
    if len(parts) > 7 and parts[6] == 'links' and method == 'DELETE':
        return revoke_one(event)
    if parts[-1] == 'links' and method == 'GET':
        return list_links(event)
    if parts[-1] == 'qr' and method == 'DELETE':
        return revoke_all(event)
    if parts[-1] == 'qr' and method == 'POST':
        return create_link(event)
    raise api.ApiError(404, 'Not found')


def lambda_handler(event, context):
    '''Lambda entrypoint.'''
    event = event or {}
    if '/v1/d/' not in (event.get('path') or ''):
        return owner_routes(event, context)
    try:
        return follow_link(event)
    except Exception:  # pylint: disable=broad-except
        LOGGER.exception('follow_link failed')
        return html_page(500, 'Something went wrong', 'Please try again in a moment.')
