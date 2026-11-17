#! /usr/bin/env python
'''Short, scannable download links (for QR codes).

  POST /v1/users/{user_id}/files/{file_id}/qr   (Bearer token, owner only)
       -> {short_url, expires_at}
  GET  /v1/d/{code}                              (public - what the QR opens)
       -> 302 redirect to a fresh 5-minute presigned S3 download

A presigned S3 URL is ~1,500 characters (it carries the Lambda's session
token), which makes a QR code too dense to scan reliably. The short link is
~80 characters. Link records live in the files table under file_id
"QR#<code>" (no user_id attribute, so they never show up in file listings)
and expire after LINK_TTL seconds. Deleting the file breaks its links.
'''

import os
import json
import time
import secrets
import html
import boto3
from botocore.config import Config
import auth
import log

LOGGER = log.setup_logging()
LINK_TTL = int(os.getenv('QR_LINK_TTL', '3600'))   # how long a QR/short link works
REDIRECT_TTL = 300                                  # presigned URL behind each scan

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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


def public_base_url(event):
    '''Base URL of this API as the outside world sees it.'''
    if os.getenv('PUBLIC_API_URL'):
        return os.environ['PUBLIC_API_URL'].rstrip('/')
    ctx = event.get('requestContext') or {}
    return 'https://{0}/{1}'.format(ctx.get('domainName'), ctx.get('stage')).rstrip('/')


def json_response(status, body):
    return {'statusCode': status, 'headers': CORS_HEADERS, 'body': json.dumps(body),
            'isBase64Encoded': False}


def html_page(status, title, message):
    '''Friendly page for people who scan an expired/invalid code on a phone.'''
    body = '''<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{t}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1120;
font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e2e8f0;padding:24px;box-sizing:border-box">
<div style="max-width:420px;text-align:center"><h1 style="font-size:20px;color:#fff;margin:0 0 12px">{t}</h1>
<p style="color:#94a3b8;line-height:1.6;margin:0">{m}</p></div></body></html>'''.format(
        t=html.escape(title), m=html.escape(message))
    return {'statusCode': status, 'body': body, 'isBase64Encoded': False,
            'headers': {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}}


def create_link(event):
    user_id, _name, _email = auth.resolve_user((event.get('headers') or {}).get('Authorization'))
    if not user_id:
        return json_response(401, {'message': 'Unauthorized'})
    parts = event['path'].split('/')          # ['', 'v1', 'users', uid, 'files', fid, 'qr']
    if parts[3] != user_id:
        return json_response(401, {'message': 'User not authorized to perform this action'})
    file_id = parts[5]
    item = table().get_item(Key={'file_id': file_id}).get('Item')
    if not item or item.get('user_id') != user_id:
        return json_response(404, {'error_message': 'File not found'})

    code = secrets.token_urlsafe(9)           # 12 URL-safe chars, ~72 bits of entropy
    expires_at = int(time.time()) + LINK_TTL
    table().put_item(Item={
        'file_id': 'QR#' + code, 'kind': 'qr_link',
        'target_file_id': file_id, 'owner_id': user_id,
        'expires_at': expires_at, 'ttl': expires_at,
    })
    return json_response(201, {'short_url': '{0}/v1/d/{1}'.format(public_base_url(event), code),
                               'expires_at': expires_at})


def follow_link(event):
    code = event['path'].rstrip('/').split('/')[-1]
    link = table().get_item(Key={'file_id': 'QR#' + code}).get('Item') if code else None
    if not link or int(link.get('expires_at', 0)) < time.time():
        return html_page(404, 'Link expired',
                         'This download link has expired or is invalid. '
                         'Ask the person who shared it for a new QR code.')
    item = table().get_item(Key={'file_id': link['target_file_id']}).get('Item')
    if not item or item.get('user_id') != link['owner_id'] or item.get('status', 'READY') != 'READY':
        return html_page(404, 'File not available',
                         'The file behind this link has been deleted or is no longer available.')
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
        if event.get('httpMethod') == 'GET':
            return follow_link(event)
        return create_link(event)
    except Exception as error:  # pylint: disable=broad-except
        LOGGER.error({'error_message': '{}'.format(error)})
        if event.get('httpMethod') == 'GET':
            return html_page(500, 'Something went wrong', 'Please try again in a moment.')
        return json_response(400, {'error_message': 'Internal server error'})
