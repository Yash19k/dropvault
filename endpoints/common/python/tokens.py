'''Session tokens of the built-in auth service: "payload.signature", where the
payload is base64url JSON claims and the signature is HMAC-SHA256 with
TOKEN_SECRET. Tokens carry their own expiry, so nothing is stored per token.

Used by the auth service (to issue and check tokens) and by the API Gateway
authorizer (to check them without calling the auth service).
'''

import base64
import hashlib
import hmac
import json
import os
import time


def _secret():
    return os.environ['TOKEN_SECRET'].encode()


def _b64(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def _unb64(text):
    return base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))


def sign(claims):
    payload = _b64(json.dumps(claims, separators=(',', ':')).encode())
    sig = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
    return payload + '.' + sig


def verify(token, allowed_types):
    '''The token's claims if it is genuine, unexpired and of an allowed type.'''
    try:
        payload, sig = (token or '').split('.', 1)
        expected = _b64(hmac.new(_secret(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            return None
        claims = json.loads(_unb64(payload))
    except (ValueError, TypeError):
        return None
    if not isinstance(claims, dict) or claims.get('typ') not in allowed_types:
        return None
    exp = claims.get('exp')
    if not isinstance(exp, (int, float)) or exp < time.time():
        return None
    return claims


def strip_bearer(value):
    '''"Bearer abc" -> "abc" (and "abc" -> "abc").'''
    value = (value or '').strip()
    return value[7:].strip() if value.lower().startswith('bearer ') else value
