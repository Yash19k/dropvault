'''Fixed-window rate limits: password guessing, sign-up floods, email spam and
runaway record creation.

One item per (key, window) in RATE_LIMIT_TABLE:
  id          "<key>#<window start>"   (keys hash emails and IPs, see subject())
  hits        how many times it was counted in this window
  expires_at  DynamoDB TTL removes the item once its window is over

Counting is one conditional update, so parallel requests can't slip past a
limit together. Limits fail open: if the table can't be reached the request
goes ahead (the error is logged), so a DynamoDB hiccup never locks everyone
out. Without RATE_LIMIT_TABLE (older deployments, tests that don't set it)
nothing is limited.
'''

import hashlib
import os
import time

import boto3

import log

LOGGER = log.setup_logging()


class Limited(Exception):
    '''Over the limit; retry_after is the number of seconds until it resets.'''

    def __init__(self, retry_after):
        super().__init__('rate limited')
        self.retry_after = max(1, int(retry_after))


def env_limit(name, default):
    '''A limit from the environment (0 = no limit).'''
    try:
        return max(0, int(os.getenv(name) or default))
    except ValueError:
        return default


def subject(kind, value):
    '''A key that doesn't store the email address or IP itself.'''
    digest = hashlib.sha256((value or '').strip().lower().encode()).hexdigest()[:32]
    return '{0}#{1}'.format(kind, digest)


def source_ip(event):
    '''The caller's IP as API Gateway saw it (not a spoofable header).'''
    return (((event or {}).get('requestContext') or {}).get('identity') or {}).get('sourceIp') or ''


def _table():
    name = os.getenv('RATE_LIMIT_TABLE')
    return boto3.resource('dynamodb').Table(name) if name else None


def _window(seconds, now):
    start = now - now % seconds
    return start, start + seconds - now


def hit(key, limit, seconds, cost=1, now=None):
    '''Count `cost` hits in the current window; raise Limited (counting
       nothing) when that would take the window past `limit`.'''
    table = _table()
    if table is None or not limit:
        return
    now = int(time.time()) if now is None else int(now)
    start, retry_after = _window(seconds, now)
    if cost > limit:   # never fits, not even in an empty window
        raise Limited(retry_after)
    try:
        table.update_item(
            Key={'id': '{0}#{1}'.format(key, start)},
            UpdateExpression='ADD hits :cost SET expires_at = if_not_exists(expires_at, :exp)',
            ConditionExpression='attribute_not_exists(hits) OR hits <= :room',
            ExpressionAttributeValues={':cost': int(cost), ':room': int(limit) - int(cost),
                                       ':exp': start + seconds + 60})
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        raise Limited(retry_after) from None
    except Exception:  # pylint: disable=broad-except
        LOGGER.exception('rate limit %s could not be counted', key.split('#', 1)[0])


def give_back(key, seconds, cost=1, now=None):
    '''Return hits counted by hit() that turned out not to be used (e.g.
       emails the email service refused).'''
    table = _table()
    if table is None or not cost:
        return
    now = int(time.time()) if now is None else int(now)
    start, _ = _window(seconds, now)
    try:
        table.update_item(Key={'id': '{0}#{1}'.format(key, start)}, UpdateExpression='ADD hits :neg',
                          ConditionExpression='attribute_exists(hits)',
                          ExpressionAttributeValues={':neg': -int(cost)})
    except Exception:  # pylint: disable=broad-except
        pass   # the window ended (or the table is unreachable): nothing to give back


def used(key, seconds, now=None):
    '''Hits counted so far in the current window (0 if unknown).'''
    table = _table()
    if table is None:
        return 0
    now = int(time.time()) if now is None else int(now)
    start, _ = _window(seconds, now)
    try:
        item = table.get_item(Key={'id': '{0}#{1}'.format(key, start)}).get('Item') or {}
        return int(item.get('hits', 0))
    except Exception:  # pylint: disable=broad-except
        LOGGER.exception('rate limit %s could not be read', key.split('#', 1)[0])
        return 0


def check(key, limit, seconds, now=None):
    '''Raise Limited if the current window is already full (counts nothing).'''
    if not limit or _table() is None:
        return
    now = int(time.time()) if now is None else int(now)
    if used(key, seconds, now) >= limit:
        raise Limited(_window(seconds, now)[1])


def clear(key, seconds, now=None):
    '''Forget the current window (e.g. failed sign-ins after a correct one).'''
    table = _table()
    if table is None:
        return
    now = int(time.time()) if now is None else int(now)
    start, _ = _window(seconds, now)
    try:
        table.delete_item(Key={'id': '{0}#{1}'.format(key, start)})
    except Exception:  # pylint: disable=broad-except
        LOGGER.exception('rate limit %s could not be cleared', key.split('#', 1)[0])


def wait_text(seconds):
    '''"3 minutes", "1 hour" for error messages.'''
    seconds = max(1, int(seconds))
    if seconds < 90:
        return '{0} seconds'.format(seconds) if seconds != 1 else '1 second'
    minutes = (seconds + 59) // 60
    if minutes < 90:
        return '{0} minutes'.format(minutes)
    hours = (minutes + 59) // 60
    return '{0} hours'.format(hours) if hours != 1 else '1 hour'
