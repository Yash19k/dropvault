'''Short download links shared by email, copy-link and QR codes.

Kept identical in endpoints/qr-link/src and endpoints/share-file/src (each
Lambda zips its own folder).

A link is a record in the files table under file_id "QR#<code>" (no user_id
attribute, so it never shows up in file listings):
  target_file_id, owner_id, created_at, and expires_at/ttl unless it never expires.
Revoking a file's links stamps `links_revoked_at` on the file record; any link
created at or before that moment stops working.
'''

import os
import time
import secrets
import string
import datetime

# Seconds a link may live, as offered in the web app. NEVER = no expiry.
NEVER = 'never'
CODE_CHARS = frozenset(string.ascii_letters + string.digits + '-_')
ALLOWED_TTLS = (900, 3600, 21600, 86400, 604800)   # 15m, 1h, 6h, 1d, 7d
DEFAULT_TTL = 3600


def valid_code(code):
    '''Codes are what create() makes: short and URL-safe.'''
    return bool(code) and len(code) <= 32 and all(c in CODE_CHARS for c in code)


def parse_expires_in(value):
    '''Validate the requested lifetime. Returns (ttl_or_NEVER, error).'''
    if value is None:
        return DEFAULT_TTL, None
    if value == NEVER:
        return NEVER, None
    if isinstance(value, int) and not isinstance(value, bool) and value in ALLOWED_TTLS:
        return value, None
    return None, 'expires_in must be one of {0} or "never"'.format(list(ALLOWED_TTLS))


def public_base_url(event):
    '''Base URL of this API as the outside world sees it.'''
    if os.getenv('PUBLIC_API_URL'):
        return os.environ['PUBLIC_API_URL'].rstrip('/')
    ctx = event.get('requestContext') or {}
    domain = ctx.get('domainName') or ''
    # The default execute-api host needs the stage in the path; a custom domain
    # (domain.tf maps the stage at the root) must NOT have it, or links 403.
    if domain.endswith('.amazonaws.com'):
        return 'https://{0}/{1}'.format(domain, ctx.get('stage')).rstrip('/')
    return 'https://{0}'.format(domain)


def create(table, event, file_id, owner_id, ttl):
    '''Store a new link record. Returns (short_url, expires_at or None).'''
    code = secrets.token_urlsafe(9)           # 12 URL-safe chars, ~72 bits of entropy
    now = time.time()
    item = {
        'file_id': 'QR#' + code, 'kind': 'qr_link',
        'target_file_id': file_id, 'owner_id': owner_id,
        'created_at': int(now * 1000),        # ms, compared against links_revoked_at
    }
    expires_at = None
    if ttl != NEVER:
        expires_at = int(now) + ttl
        item['expires_at'] = expires_at
        item['ttl'] = expires_at              # DynamoDB TTL cleans the record up
    table.put_item(Item=item)
    return '{0}/v1/d/{1}'.format(public_base_url(event), code), expires_at


def describe_ttl(ttl):
    '''Human wording for a lifetime, e.g. "1 hour", "7 days".'''
    if ttl == NEVER:
        return None
    names = {900: '15 minutes', 3600: '1 hour', 21600: '6 hours', 86400: '1 day', 604800: '7 days'}
    return names.get(ttl, '{0} minutes'.format(ttl // 60))


def format_utc(epoch):
    '''"18 Nov 2026, 15:40 UTC" for messages shown to people opening a link.'''
    dt = datetime.datetime.fromtimestamp(int(epoch), tz=datetime.timezone.utc)
    return '{0} {1}, {2} UTC'.format(dt.day, dt.strftime('%b %Y'), dt.strftime('%H:%M'))
