#! /usr/bin/env python
'''Short, scannable download links (for QR codes).

  POST   /v1/users/{user_id}/files/{file_id}/qr  (Bearer token, owner only)
         body {expires_in: 900|3600|21600|86400|604800|"never"}  (default 3600)
         -> {short_url, expires_at}   (expires_at is null for "never")
  DELETE /v1/users/{user_id}/files/{file_id}/qr  (Bearer token, owner only)
         -> revoke every link to the file made so far -> {links_revoked_at}
  GET    /v1/d/{code}                             (public - what the QR opens)
         -> 302 redirect to a fresh 5-minute presigned S3 download

A presigned S3 URL is ~1,500 characters (it carries the Lambda's session
token), which makes a QR code too dense to scan reliably. The short link is
~80 characters. Link records are described in links.py. Deleting the file
or revoking its links breaks them.
'''

import os
import json
import time
import html
import boto3
from botocore.config import Config
import auth
import links
import log

LOGGER = log.setup_logging()
REDIRECT_TTL = 300   # presigned URL behind each scan

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*'
}


def table():
    return boto3.resource('dynamodb').Table(os.environ['FILE_SHARING_TABLE'])


def s3_client(region):
    '''Regional, SigV4, virtual-hosted S3 client (same as download-file).'''
    return boto3.client(
        's3',
        region_name=region,
        endpoint_url='https://s3.{0}.amazonaws.com'.format(region),
        config=Config(signature_version='s3v4', s3={'addressing_style': 'virtual'})
    )


def json_response(status, body):
    return {'statusCode': status, 'headers': CORS_HEADERS, 'body': json.dumps(body),
            'isBase64Encoded': False}


def html_page(status, title, message):
    '''Friendly page for people who scan an expired/invalid code on a phone.'''
    body = '''<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{t}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f7f5;
font-family:'IBM Plex Sans',Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b1b18;padding:24px;box-sizing:border-box">
<div style="max-width:400px;background:#fff;border:1px solid #e5e5e0;border-radius:8px;padding:28px;text-align:center">
<div style="font-size:13px;font-weight:600;color:#0e6b5e;margin:0 0 14px">DropVault</div>
<h1 style="font-size:19px;margin:0 0 10px">{t}</h1>
<p style="color:#5c5c55;font-size:14px;line-height:1.6;margin:0">{m}</p></div></body></html>'''.format(
        t=html.escape(title), m=html.escape(message))
    return {'statusCode': status, 'body': body, 'isBase64Encoded': False,
            'headers': {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}}


def owned_file(event):
    '''(user_id, file_item) for the caller's file, or (None, error response).'''
    user_id, _name, _email = auth.resolve_user((event.get('headers') or {}).get('Authorization'))
    if not user_id:
        return None, json_response(401, {'message': 'Unauthorized'})
    parts = event['path'].split('/')          # ['', 'v1', 'users', uid, 'files', fid, 'qr']
    if parts[3] != user_id:
        return None, json_response(401, {'message': 'User not authorized to perform this action'})
    item = table().get_item(Key={'file_id': parts[5]}).get('Item')
    if not item or item.get('user_id') != user_id:
        return None, json_response(404, {'error_message': 'File not found'})
    return user_id, item


def create_link(event):
    try:
        body = json.loads(event.get('body') or '{}') or {}
    except ValueError:
        return json_response(400, {'message': 'Body must be JSON'})
    ttl, error = links.parse_expires_in(body.get('expires_in'))
    if error:
        return json_response(400, {'message': error})
    user_id, item = owned_file(event)
    if not user_id:
        return item
    short_url, expires_at = links.create(table(), event, item['file_id'], user_id, ttl)
    return json_response(201, {'short_url': short_url, 'expires_at': expires_at})


def revoke_links(event):
    user_id, item = owned_file(event)
    if not user_id:
        return item
    revoked_at = int(time.time() * 1000)
    table().update_item(Key={'file_id': item['file_id']},
                        UpdateExpression='SET links_revoked_at = :t',
                        ExpressionAttributeValues={':t': revoked_at})
    return json_response(200, {'file_id': item['file_id'], 'links_revoked_at': revoked_at})


def follow_link(event):
    code = event['path'].rstrip('/').split('/')[-1]
    link = table().get_item(Key={'file_id': 'QR#' + code}).get('Item') if code else None
    if not link:
        return html_page(404, 'Link not found',
                         'This download link is invalid or has expired. '
                         'Ask the person who shared it for a new one.')
    if 'expires_at' in link and int(link['expires_at']) < time.time():
        return html_page(410, 'Link expired',
                         'This link expired on {0}. Ask the person who shared it for a new one.'
                         .format(links.format_utc(link['expires_at'])))
    item = table().get_item(Key={'file_id': link['target_file_id']}).get('Item')
    if not item or item.get('user_id') != link['owner_id'] or item.get('status', 'READY') != 'READY':
        return html_page(404, 'File not available',
                         'The file behind this link has been deleted or is no longer available.')
    if int(link.get('created_at', 0)) <= int(item.get('links_revoked_at', -1)):
        return html_page(410, 'Link turned off',
                         'The person who shared this file has turned this link off. '
                         'Ask them for a new one if you still need it.')
    key = '{0}/{1}/{2}'.format(item['user_id'], item['file_id'], item['file_name'])
    url = s3_client(os.getenv('REGION')).generate_presigned_url(
        'get_object',
        Params={
            'Bucket': os.environ['USER_FILES_BUCKET'],
            'Key': key,
            'ResponseContentDisposition': 'attachment; filename="{0}"'.format(item['file_name'])
        },
        ExpiresIn=REDIRECT_TTL
    )
    return {'statusCode': 302, 'body': '', 'isBase64Encoded': False,
            'headers': {'Location': url, 'Cache-Control': 'no-store'}}


def lambda_handler(event, _):
    '''Lambda entrypoint.'''
    try:
        method = event.get('httpMethod')
        if method == 'GET':
            return follow_link(event)
        if method == 'DELETE':
            return revoke_links(event)
        return create_link(event)
    except Exception as error:  # pylint: disable=broad-except
        LOGGER.error({'error_message': '{}'.format(error)})
        if event.get('httpMethod') == 'GET':
            return html_page(500, 'Something went wrong', 'Please try again in a moment.')
        return json_response(400, {'error_message': 'Internal server error'})
