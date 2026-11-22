'''Site heartbeats for the admin panel's Analytics page and "online now".

  POST /v1/presence   {sid, vid, page, view?, secs?, leave?, ref?, new?, tz?}  -> 200 {ok: true}

Public, so visitors who aren't signed in count too. When the request carries
a session token (Authorization: Bearer ...), the visit is linked to that
account: with the built-in auth service the token's signature and expiry are
checked here (no account lookup, so a heartbeat stays one write); with an
external auth service it is checked once per token against /v1/userinfo and
remembered for a few minutes. An invalid or expired token just counts as a
visitor who isn't signed in.

Bots and scripts (by User-Agent) are ignored, and each IP may send at most
PRESENCE_PER_IP heartbeats per 10 minutes (a tab sends about 20). See
visits.py in the shared layer for what is stored.
'''

import os
import time

import api
import auth
import log
import ratelimit
import tokens
import visits

LOGGER = log.setup_logging()
WINDOW = 600
_USERINFO_CACHE = {}          # external auth: token -> (user_id, expires)
USERINFO_TTL = 300


def caller(event):
    '''The signed-in account's user id, or None.'''
    header = auth.header(event, 'Authorization')
    if not header:
        return None
    token = tokens.strip_bearer(header)
    if os.getenv('TOKEN_SECRET'):
        claims = tokens.verify(token, ('id', 'access'))
        return claims.get('sub') if claims else None
    cached = _USERINFO_CACHE.get(token)
    if cached and cached[1] > time.time():
        return cached[0]
    user_id = auth.resolve_user(header)[0]
    if len(_USERINFO_CACHE) > 1000:
        _USERINFO_CACHE.clear()
    _USERINFO_CACHE[token] = (user_id, time.time() + USERINFO_TTL)
    return user_id


def parse(body):
    '''The heartbeat, checked and cleaned (400 if it can't be used).'''
    if not visits.valid_id(body.get('sid')) or not visits.valid_id(body.get('vid')):
        raise api.ApiError(400, 'sid and vid must be 8-40 letters, digits, - or _')
    page = visits.clean_page(body.get('page'))
    if not page:
        raise api.ApiError(400, 'page must be a path like /app')
    secs = body.get('secs', 0)
    if not isinstance(secs, (int, float)) or isinstance(secs, bool) or secs < 0:
        raise api.ApiError(400, 'secs must be a number of seconds')
    tz = body.get('tz')
    return {
        'sid': body['sid'], 'vid': body['vid'], 'page': page, 'secs': int(secs),
        'view': body.get('view') is True, 'leave': body.get('leave') is True, 'new': body.get('new') is True,
        'ref': visits.clean_ref(body.get('ref')) if isinstance(body.get('ref'), str) else None,
        'tz': tz if isinstance(tz, str) and visits.TZ_RE.match(tz) else None,
    }


@api.route('POST, OPTIONS')
def lambda_handler(event):
    if event.get('httpMethod') != 'POST':
        raise api.ApiError(404, 'Not found')
    if not visits.enabled():
        return 200, {'ok': True}
    user_agent = auth.header(event, 'User-Agent') or ''
    beat = parse(api.json_body(event))
    if visits.is_bot(user_agent):
        return 200, {'ok': True}
    ratelimit.hit(ratelimit.subject('presence', ratelimit.source_ip(event)),
                  ratelimit.env_limit('PRESENCE_PER_IP', 240), WINDOW)
    visits.record(beat, caller(event), user_agent)
    return 200, {'ok': True}
