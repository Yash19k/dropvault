#! /usr/bin/env python
'''Resolve and validate the caller by delegating to the external auth
   microservice's /userinfo endpoint. This service only knows the auth endpoint
   (from env) - it never depends on the auth implementation,
   its identity store, or its infrastructure. Returns (user_id, name, email),
   or (None, None, None) if the auth service rejects the token.

   Kept identical in every endpoints/*/src folder (each Lambda zips its own).'''

import os
import json
import urllib.request
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
       path (the offline server in ../local only passes `path`).'''
    value = ((event or {}).get('pathParameters') or {}).get(name)
    if value:
        return value
    parts = ((event or {}).get('path') or '').split('/')
    return parts[index] if len(parts) > index else None


def resolve_user(authorization_header):
    '''Validate the bearer token and resolve the user via the auth service.'''
    endpoint = (os.getenv('AUTH_ENDPOINT') or '').rstrip('/')
    if not endpoint or not authorization_header:
        return None, None, None
    request = urllib.request.Request(
        endpoint + '/v1/userinfo',
        headers={'Authorization': authorization_header}
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            data = json.loads(response.read().decode())
        return data.get('user_id'), data.get('name'), data.get('email')
    except Exception as error:  # pylint: disable=broad-except
        LOGGER.error('auth /userinfo failed: %s', error)
        return None, None, None


def resolve_event_user(event):
    '''(user_id, name, email) for the request's Authorization header.'''
    return resolve_user(header(event, 'Authorization'))


def content_disposition(file_name):
    '''RFC 6266 attachment header that survives quotes, newlines and non-ASCII
       characters in the stored file name (no header injection, no S3 errors).'''
    from urllib.parse import quote
    fallback = ''.join(c if 32 <= ord(c) < 127 and c not in '"\\' else '_' for c in file_name)
    return 'attachment; filename="{0}"; filename*=UTF-8\'\'{1}'.format(
        fallback or 'download', quote(file_name, safe=''))
