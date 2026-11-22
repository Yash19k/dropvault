'''Who is calling? Request helpers shared by every file Lambda.

On AWS, API Gateway runs the Lambda authorizer (endpoints/authorizer) before a
protected route and passes the caller in requestContext.authorizer, so the
handlers don't call the auth service at all. Without an authorizer (an
external setup, or a route someone forgot to protect) the bearer token is
checked against {AUTH_ENDPOINT}/v1/userinfo instead, as before.
'''

import json
import os
import urllib.request
from urllib.parse import quote

import log

LOGGER = log.setup_logging()


def header(event, name):
    '''Case-insensitive request header lookup (HTTP/2 clients send lowercase
       names, and API Gateway may pass `headers` as null).'''
    wanted = name.lower()
    for key, value in ((event or {}).get('headers') or {}).items():
        if key.lower() == wanted:
            return value
    return None


def path_param(event, name, index):
    '''A path parameter from API Gateway, falling back to its position in the
       path (/v1/users/{user_id}/files/{file_id}/... -> user_id is 3, file_id 5).'''
    value = ((event or {}).get('pathParameters') or {}).get(name)
    if value:
        return value
    parts = ((event or {}).get('path') or '').split('/')
    return parts[index] if len(parts) > index else None


def authorizer_user(event):
    '''(user_id, name, email) from the API Gateway authorizer, or None.'''
    ctx = (((event or {}).get('requestContext') or {}).get('authorizer')) or {}
    if ctx.get('user_id'):
        return ctx['user_id'], ctx.get('name') or '', ctx.get('email') or ''
    return None


def resolve_user(authorization_header):
    '''Validate the bearer token with the auth service's /v1/userinfo.'''
    endpoint = (os.getenv('AUTH_ENDPOINT') or '').rstrip('/')
    if not endpoint or not authorization_header:
        return None, None, None
    request = urllib.request.Request(endpoint + '/v1/userinfo',
                                     headers={'Authorization': authorization_header})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.loads(response.read().decode())
        return data.get('user_id'), data.get('name'), data.get('email')
    except Exception as error:  # pylint: disable=broad-except
        LOGGER.error('auth /userinfo failed: %s', error)
        return None, None, None


def resolve_event_user(event):
    '''(user_id, name, email) for the request, or (None, None, None).'''
    return authorizer_user(event) or resolve_user(header(event, 'Authorization'))


def content_disposition(file_name):
    '''RFC 6266 attachment header that survives quotes, newlines and non-ASCII
       characters in the stored file name (no header injection, no S3 errors).'''
    fallback = ''.join(c if 32 <= ord(c) < 127 and c not in '"\\' else '_' for c in file_name)
    return 'attachment; filename="{0}"; filename*=UTF-8\'\'{1}'.format(
        fallback or 'download', quote(file_name, safe=''))


def inline_disposition(file_name):
    '''Like content_disposition, but the browser shows the file (preview).'''
    return 'inline' + content_disposition(file_name)[len('attachment'):]
