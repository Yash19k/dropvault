'''Site visits for the admin panel's Analytics page and "online now".

The web app sends a small heartbeat (POST /v1/presence, endpoints/presence)
every 30 seconds while a tab is open, visible and in use, one when the page
changes, and a last one when the tab closes. Each heartbeat updates one item
per browser tab per UTC day in ANALYTICS_TABLE:

  pk  "D#<yyyy-mm-dd>"   the UTC day
  sk  <sid>              a random id per browser tab (sessionStorage)

  vid       a random id per browser (localStorage): tells visitors apart
  uid       the signed-in account, if any (the newest one seen in the tab)
  first_at  last_at      epoch seconds of the first and latest heartbeat
  secs      seconds the tab was visible and in use
  pv        page views
  s<n> v<n> seconds and page views in 5-minute slot n of the day (0-287)
  p:<path>  page views per page (paths with ids are folded: /admin/users/:id)
  cur       the page the tab is on now
  lp        landing page
  ref       where the visit came from (referrer host, or "direct")
  dev br os device type, browser and operating system (from the User-Agent)
  tz        the browser's time zone name, e.g. Asia/Kolkata
  nw        1 if this browser had never visited before
  lft       1 once the tab has closed (a later heartbeat removes it)
  ttl       DynamoDB deletes the item after KEEP_DAYS

Someone is online while their newest heartbeat is under ONLINE_SECONDS old and
the tab hasn't closed. Nothing here stores IP addresses, and the visitor and
tab ids are random, so no personal data is kept for visitors who aren't
signed in.
'''

import os
import re
import time
from concurrent.futures import ThreadPoolExecutor

import boto3
from boto3.dynamodb.conditions import Key

import stats

SLOT_SECONDS = 300
SLOTS_PER_DAY = 86400 // SLOT_SECONDS
ONLINE_SECONDS = 75          # two missed 30-second beats and you're gone
MAX_BEAT_SECONDS = 60        # a heartbeat reports at most this many active seconds
KEEP_DAYS = 400
ID_RE = re.compile(r'^[A-Za-z0-9_-]{8,40}$')
PAGE_RE = re.compile(r'^/[A-Za-z0-9/_:.-]{0,79}$')
TZ_RE = re.compile(r'^[A-Za-z0-9/_+-]{1,48}$')
HOST_RE = re.compile(r'^[a-z0-9.-]{1,80}$')
BOT_RE = re.compile(r'bot|crawl|spider|slurp|headless|phantom|lighthouse|preview|python|curl|wget|node-fetch|axios',
                    re.I)


def table():
    name = os.getenv('ANALYTICS_TABLE')
    return boto3.resource('dynamodb').Table(name) if name else None


def enabled():
    return bool(os.getenv('ANALYTICS_TABLE'))


def day_key(day):
    return 'D#' + day


# --- reading the User-Agent -------------------------------------------------------
def is_bot(user_agent):
    return not user_agent or bool(BOT_RE.search(user_agent))


def device(user_agent):
    ua = user_agent or ''
    if re.search(r'iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))', ua):
        return 'tablet'
    if re.search(r'Mobi|iPhone|iPod|Android|IEMobile|Opera Mini', ua):
        return 'mobile'
    return 'desktop'


def browser(user_agent):
    ua = user_agent or ''
    for name, pattern in (('Edge', r'Edg/'), ('Opera', r'OPR/|Opera'), ('Samsung Internet', r'SamsungBrowser'),
                          ('Firefox', r'Firefox/|FxiOS'), ('Chrome', r'Chrome/|CriOS'), ('Safari', r'Safari/')):
        if re.search(pattern, ua):
            return name
    return 'Other'


def operating_system(user_agent):
    ua = user_agent or ''
    for name, pattern in (('iOS', r'iPhone|iPad|iPod'), ('Android', r'Android'), ('Windows', r'Windows'),
                          ('macOS', r'Mac OS X|Macintosh'), ('ChromeOS', r'CrOS'), ('Linux', r'Linux')):
        if re.search(pattern, ua):
            return name
    return 'Other'


# --- cleaning what the browser sends ------------------------------------------------
def clean_page(page):
    '''A route path, with ids folded so pages group together.'''
    page = (page or '/').split('?', 1)[0].split('#', 1)[0]
    if not PAGE_RE.match(page):
        return None
    page = re.sub(r'^/admin/users/[^/]+', '/admin/users/:id', page)
    return page.rstrip('/') or '/'


def clean_ref(ref):
    ref = (ref or '').strip().lower()
    if ref in ('', 'direct'):
        return None
    ref = re.sub(r'^https?://', '', ref).split('/', 1)[0].split(':', 1)[0]
    ref = ref[4:] if ref.startswith('www.') else ref
    return ref if HOST_RE.match(ref) else None


def valid_id(value):
    return isinstance(value, str) and bool(ID_RE.match(value))


# --- writing --------------------------------------------------------------------------
def record(beat, user_id=None, user_agent='', now=None):
    '''Count one heartbeat. `beat` has been checked by the presence Lambda:
       {sid, vid, page, view, secs, leave, ref, new, tz}.'''
    now = int(time.time()) if now is None else int(now)
    slot = (now % 86400) // SLOT_SECONDS
    secs = max(0, min(MAX_BEAT_SECONDS, int(beat.get('secs') or 0)))
    page = beat['page']
    names = {'#ttl': 'ttl'}
    values = {':now': now, ':vid': beat['vid'], ':page': page, ':dev': device(user_agent),
              ':br': browser(user_agent), ':os': operating_system(user_agent),
              ':ttl': now + KEEP_DAYS * 86400}
    sets = ['last_at = :now', 'first_at = if_not_exists(first_at, :now)', 'vid = if_not_exists(vid, :vid)',
            'cur = :page', 'dev = if_not_exists(dev, :dev)', 'br = if_not_exists(br, :br)',
            'os = if_not_exists(os, :os)', '#ttl = if_not_exists(#ttl, :ttl)']
    adds = []
    if user_id:
        sets.append('uid = :uid')
        values[':uid'] = user_id
    if beat.get('ref'):
        sets.append('#ref = if_not_exists(#ref, :ref)')
        names['#ref'] = 'ref'
        values[':ref'] = beat['ref']
    if beat.get('tz'):
        sets.append('tz = if_not_exists(tz, :tz)')
        values[':tz'] = beat['tz']
    if beat.get('new'):
        sets.append('nw = if_not_exists(nw, :one)')
    if secs:
        names['#s'] = 's{0}'.format(slot)
        values[':secs'] = secs
        adds += ['secs :secs', '#s :secs']
    if beat.get('view'):
        names.update({'#v': 'v{0}'.format(slot), '#p': 'p:' + page})
        adds += ['pv :one', '#v :one', '#p :one']
        sets.append('lp = if_not_exists(lp, :page)')
    if beat.get('view') or beat.get('new'):
        values[':one'] = 1
    if beat.get('leave'):
        sets.append('lft = :lft')
        values[':lft'] = 1

    expression = 'SET ' + ', '.join(sets)
    if adds:
        expression += ' ADD ' + ', '.join(adds)
    if not beat.get('leave'):
        expression += ' REMOVE lft'
    table().update_item(Key={'pk': day_key(stats.day(now)), 'sk': beat['sid']}, UpdateExpression=expression,
                        ExpressionAttributeNames=names, ExpressionAttributeValues=values)


# --- reading --------------------------------------------------------------------------
def day_sessions(day):
    '''Every tab-session of one UTC day.'''
    tbl = table()
    if tbl is None:
        return []
    items, kwargs = [], {'KeyConditionExpression': Key('pk').eq(day_key(day))}
    while True:
        page = tbl.query(**kwargs)
        items.extend(page.get('Items', []))
        if 'LastEvaluatedKey' not in page:
            return items
        kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']


def sessions(days):
    '''{day: [sessions]} for several days, read in parallel.'''
    days = list(days)
    if not enabled() or not days:
        return {d: [] for d in days}
    with ThreadPoolExecutor(max_workers=min(8, len(days))) as pool:
        return dict(zip(days, pool.map(day_sessions, days), strict=True))


def is_online(item, now):
    return not item.get('lft') and int(item.get('last_at', 0)) >= now - ONLINE_SECONDS


def recent(now=None, days_back=0):
    '''Today's sessions (and yesterday's around midnight UTC, or `days_back`
       more days), newest first.'''
    now = int(time.time()) if now is None else int(now)
    days = [stats.day(now - k * 86400) for k in range(days_back + 1)]
    if not days_back and now % 86400 < ONLINE_SECONDS:
        days.append(stats.day(now - 86400))
    found = sessions(days)
    items = [item for d in days for item in found[d]]
    return sorted(items, key=lambda i: int(i.get('last_at', 0)), reverse=True)


def last_seen_by_user(items, now):
    '''{user_id: {"last_seen_at": ms, "online": bool}} from session items.'''
    seen = {}
    for item in items:
        uid = item.get('uid')
        if not uid:
            continue
        last = int(item.get('last_at', 0))
        entry = seen.setdefault(uid, {'last_seen_at': 0, 'online': False})
        entry['last_seen_at'] = max(entry['last_seen_at'], last * 1000)
        entry['online'] = entry['online'] or is_online(item, now)
    return seen
