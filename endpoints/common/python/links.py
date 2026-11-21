'''Short download links shared by email, copy-link and QR codes.

A link is an item in the files table under file_id "QR#<code>":
  kind          'qr_link'
  target_file_id, owner_id
  created_at    ms epoch (compared against the file's links_revoked_at)
  channel       'email' | 'link' | 'qr'
  recipient     the email address, for links sent by email
  expires_at    s epoch; absent = never expires
  max_downloads optional download limit
  downloads, first_downloaded_at, last_downloaded_at   download stats
  revoked_at    set when this one link is turned off
  ttl           DynamoDB deletes the item 30 days after it expires, so its
                stats stay visible for a while

Links have no user_id, so they never show up in file listings; the
file-links index finds a file's links. Turning off all of a file's links
stamps links_revoked_at on the file: links created before then stop working.
'''

import datetime
import os
import secrets
import string
import time

import stats

NEVER = 'never'
CODE_CHARS = frozenset(string.ascii_letters + string.digits + '-_')
ALLOWED_TTLS = (900, 3600, 21600, 86400, 604800)   # 15m, 1h, 6h, 1d, 7d
DEFAULT_TTL = 3600
MAX_DOWNLOAD_LIMIT = 1000
CHANNELS = ('email', 'link', 'qr')
KEEP_STATS_SECONDS = 30 * 86400


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


def parse_max_downloads(value):
    '''Validate the optional download limit. Returns (limit_or_None, error).'''
    if value is None:
        return None, None
    if isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= MAX_DOWNLOAD_LIMIT:
        return value, None
    return None, 'max_downloads must be a whole number from 1 to {0}, or null'.format(MAX_DOWNLOAD_LIMIT)


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


def link_url(event, code):
    return '{0}/v1/d/{1}'.format(public_base_url(event), code)


def create(table, event, file_id, owner_id, ttl, channel='link', max_downloads=None, recipient=None):
    '''Store a new link. Returns (short_url, expires_at or None).'''
    code = secrets.token_urlsafe(9)           # 12 URL-safe chars, ~72 bits of entropy
    now = time.time()
    item = {
        'file_id': 'QR#' + code, 'kind': 'qr_link',
        'target_file_id': file_id, 'owner_id': owner_id,
        'created_at': int(now * 1000),
        'channel': channel if channel in CHANNELS else 'link',
        'downloads': 0,
    }
    if recipient:
        item['recipient'] = recipient
    if max_downloads:
        item['max_downloads'] = int(max_downloads)
    expires_at = None
    if ttl != NEVER:
        expires_at = int(now) + ttl
        item['expires_at'] = expires_at
        item['ttl'] = expires_at + KEEP_STATS_SECONDS
    table.put_item(Item=item)
    return link_url(event, code), expires_at


def status(link, file_item, now=None):
    '''active | revoked | expired | limit_reached | file_missing'''
    now = time.time() if now is None else now
    if not file_item or file_item.get('user_id') != link.get('owner_id') \
            or file_item.get('status', 'READY') != 'READY':
        return 'file_missing'
    if link.get('revoked_at') or int(link.get('created_at', 0)) <= int(file_item.get('links_revoked_at', -1)):
        return 'revoked'
    if 'expires_at' in link and int(link['expires_at']) < now:
        return 'expired'
    if link.get('max_downloads') and int(link.get('downloads', 0)) >= int(link['max_downloads']):
        return 'limit_reached'
    return 'active'


def describe(event, link, file_item):
    '''A link as the owner sees it in the app (with its stats).'''
    def num(name):
        return int(link[name]) if link.get(name) is not None else None
    return {
        'code': link['file_id'][3:],
        'url': link_url(event, link['file_id'][3:]),
        'channel': link.get('channel', 'link'),
        'recipient': link.get('recipient'),
        'created_at': num('created_at'),
        'expires_at': num('expires_at'),
        'max_downloads': num('max_downloads'),
        'downloads': int(link.get('downloads', 0)),
        'first_downloaded_at': num('first_downloaded_at'),
        'last_downloaded_at': num('last_downloaded_at'),
        'status': status(link, file_item),
    }


def record_download(table, link):
    '''Count one download. False if the link has used up its download limit
       (checked atomically, so two people can't both take the last one).'''
    now = int(time.time())
    condition = 'attribute_exists(file_id)'
    values = {':one': 1, ':now': now}
    if link.get('max_downloads'):
        condition += ' AND downloads < :max'
        values[':max'] = int(link['max_downloads'])
    try:
        table.update_item(
            Key={'file_id': link['file_id']},
            UpdateExpression='ADD downloads :one SET last_downloaded_at = :now, '
                             'first_downloaded_at = if_not_exists(first_downloaded_at, :now)',
            ConditionExpression=condition,
            ExpressionAttributeValues=values)
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        return False
    try:  # running total on the file, shown in the file list (best effort)
        table.update_item(Key={'file_id': link['target_file_id']},
                          UpdateExpression='ADD download_count :one',
                          ConditionExpression='attribute_exists(file_id)',
                          ExpressionAttributeValues={':one': 1})
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        pass
    stats.bump('downloads')   # downloads per day, for the admin overview
    return True


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
