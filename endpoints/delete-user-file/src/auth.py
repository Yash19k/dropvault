#! /usr/bin/env python
'''Resolve and validate the caller by delegating to the external auth
   microservice's /userinfo endpoint. This service only knows the auth endpoint
   (from env) - it never depends on the auth implementation,
   its identity store, or its infrastructure. Returns (user_id, name, email),
   or (None, None, None) if the auth service rejects the token.'''

import os
import json
import urllib.request
import log

LOGGER = log.setup_logging()


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
    except Exception as error:
        LOGGER.error('auth /userinfo failed: %s', error)
        return None, None, None
