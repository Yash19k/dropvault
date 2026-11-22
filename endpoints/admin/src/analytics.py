'''The admin panel's Analytics page: traffic, engagement and product numbers.

  GET /analytics?range=24h|7d|30d|90d&tz=<minutes east of UTC>
  GET /analytics/live

Traffic comes from the site heartbeats (visits.py in the shared layer): every
browser tab's visible, in-use seconds and page views per 5-minute slot, so the
numbers can be bucketed by the admin's own time zone. Product numbers
(sign-ups, uploads, links, downloads) come from the records themselves, read
by admin.Snapshot, plus the daily/hourly download counters (stats.py).

Every figure on the page comes with the same figure for the period before, so
the page can show the change.
'''

import datetime
import time
from collections import Counter, defaultdict

import stats
import visits

RANGES = {'24h': ('hour', 24), '7d': ('day', 7), '30d': ('day', 30), '90d': ('day', 90)}
MIN_HISTORY_DAYS = 57          # 8 weeks of retention cohorts + DAU/WAU/MAU
COHORT_WEEKS = 8
SIZE_BUCKETS = (('Under 1 MB', 1024 ** 2), ('1–10 MB', 10 * 1024 ** 2), ('10–100 MB', 100 * 1024 ** 2),
                ('100 MB–1 GB', 1024 ** 3), ('Over 1 GB', None))
TOP = 8


def parse_tz(value):
    try:
        return max(-840, min(840, int(value or 0)))
    except (TypeError, ValueError):
        return 0


def day_start(day):
    return int(datetime.datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=datetime.timezone.utc).timestamp())


class Clock:
    '''Buckets (hours or days) in the admin's time zone, ending now.'''

    def __init__(self, range_key, tz_minutes, now):
        self.unit, self.count = RANGES[range_key]
        self.offset = tz_minutes * 60
        self.size = 3600 if self.unit == 'hour' else 86400
        local_now = now + self.offset
        end_local = local_now - local_now % self.size + self.size      # end of the current bucket
        self.start = end_local - self.count * self.size - self.offset  # epoch seconds (UTC)
        self.end = now
        self.length = self.count * self.size
        self.prev_start = self.start - self.length

    def index(self, ts):
        if ts < self.start or ts >= self.start + self.length:
            return None
        return int((ts - self.start) // self.size)

    def period(self, ts):
        '''"cur", "prev" or None.'''
        if self.start <= ts < self.start + self.length:
            return 'cur'
        if self.prev_start <= ts < self.start:
            return 'prev'
        return None

    def buckets(self):
        return [{'start': (self.start + i * self.size) * 1000} for i in range(self.count)]


def slot_activity(item):
    '''[(epoch seconds, active seconds, page views)] for each used 5-minute slot.'''
    base = day_start(item['pk'][2:])
    slots = defaultdict(lambda: [0, 0])
    for key, value in item.items():
        if len(key) > 1 and key[0] in 'sv' and key[1:].isdigit():
            slots[int(key[1:])][0 if key[0] == 's' else 1] += int(value)
    out = [(base + n * visits.SLOT_SECONDS + visits.SLOT_SECONDS // 2, s, v) for n, (s, v) in slots.items()]
    if not out and item.get('first_at'):
        out = [(int(item['first_at']), 0, 0)]
    return out


def pages_of(item):
    return {key[2:]: int(value) for key, value in item.items() if key.startswith('p:')}


# --- traffic ---------------------------------------------------------------------
class Traffic:
    '''Everything worked out from the session items.'''

    def __init__(self, items, clock, now):
        n = clock.count
        self.clock = clock
        self.series = {k: [0] * n for k in ('pageviews', 'active_seconds')}
        self._bucket_sets = {k: [set() for _ in range(n)] for k in ('visitors', 'sessions', 'signed_in')}
        self.periods = {p: {'visitors': set(), 'sessions': {}, 'users': set(), 'new': set(), 'pageviews': 0,
                            'secs': 0} for p in ('cur', 'prev')}
        self.heatmap = [[0] * 24 for _ in range(7)]
        self.pages, self.page_visitors = Counter(), defaultdict(set)
        self.landing, self.referrers = Counter(), Counter()
        self.devices, self.browsers, self.systems, self.zones = Counter(), Counter(), Counter(), Counter()
        self.user_activity = defaultdict(lambda: {'secs': 0, 'sessions': set(), 'pageviews': 0, 'last_at': 0})
        self.user_days = defaultdict(set)      # uid -> set of UTC day numbers they were active
        self.now = now
        for item in items:
            self._add(item)

    def _add(self, item):
        sid, vid, uid = item['sk'], item.get('vid', item['sk']), item.get('uid')
        clock = self.clock
        in_period = set()
        for ts, secs, views in slot_activity(item):
            if uid:
                self.user_days[uid].add(int(ts // 86400))
            period = clock.period(ts)
            if not period:
                continue
            in_period.add(period)
            p = self.periods[period]
            p['pageviews'] += views
            p['secs'] += secs
            p['visitors'].add(vid)
            sess = p['sessions'].setdefault(sid, {'pv': 0, 'secs': 0})
            sess['pv'] += views
            sess['secs'] += secs
            if uid:
                p['users'].add(uid)
            if item.get('nw'):
                p['new'].add(vid)
            if period != 'cur':
                continue
            i = clock.index(ts)
            self.series['pageviews'][i] += views
            self.series['active_seconds'][i] += secs
            self._bucket_sets['visitors'][i].add(vid)
            self._bucket_sets['sessions'][i].add(sid)
            if uid:
                self._bucket_sets['signed_in'][i].add(uid)
            local = datetime.datetime.fromtimestamp(ts + clock.offset, tz=datetime.timezone.utc)
            self.heatmap[local.weekday()][local.hour] += secs
            if uid:
                ua = self.user_activity[uid]
                ua['secs'] += secs
                ua['pageviews'] += views
                ua['sessions'].add(sid)
        if uid and 'cur' in in_period:
            ua = self.user_activity[uid]
            ua['last_at'] = max(ua['last_at'], int(item.get('last_at', 0)))
        if 'cur' not in in_period:
            return
        for page, views in pages_of(item).items():
            self.pages[page] += views
            self.page_visitors[page].add(vid)
        if item.get('lp'):
            self.landing[item['lp']] += 1
        self.referrers[item.get('ref') or 'direct'] += 1
        self.devices[item.get('dev', 'desktop')] += 1
        self.browsers[item.get('br', 'Other')] += 1
        self.systems[item.get('os', 'Other')] += 1
        if item.get('tz'):
            self.zones[item['tz']] += 1

    def bucket_series(self):
        out = dict(self.series)
        for key, sets in self._bucket_sets.items():
            out[key] = [len(s) for s in sets]
        return out

    def kpis(self, period):
        p = self.periods[period]
        sessions = p['sessions']
        count = len(sessions)
        return {
            'visitors': len(p['visitors']),
            'sessions': count,
            'pageviews': p['pageviews'],
            'active_users': len(p['users']),
            'new_visitors': len(p['new']),
            'avg_session_seconds': round(p['secs'] / count) if count else 0,
            'bounce_rate': round(100 * sum(1 for s in sessions.values() if s['pv'] <= 1) / count, 1)
            if count else 0,
        }

    def engagement(self):
        '''Signed-in accounts active in the last 1, 7 and 30 days.'''
        today = int(self.now // 86400)

        def active(days):
            return sum(1 for d in self.user_days.values() if any(today - days < x <= today for x in d))
        dau, wau, mau = active(1), active(7), active(30)
        return {'dau': dau, 'wau': wau, 'mau': mau, 'stickiness': round(100 * dau / mau, 1) if mau else 0}


def ranked(counter, key, limit=TOP, extra=None):
    rows = []
    for name, value in counter.most_common(limit):
        row = {'name': name, key: value}
        if extra:
            row.update(extra(name))
        rows.append(row)
    return rows


# --- product numbers -------------------------------------------------------------
def product(snap, clock, helpers):
    '''Sign-ups, uploads, links and downloads per bucket and per period.'''
    n = clock.count
    series = {k: [0] * n for k in ('signups', 'uploads', 'upload_bytes', 'links', 'downloads', 'videos')}
    totals = {p: Counter() for p in ('cur', 'prev')}

    def count(ts, field, amount=1):
        period = clock.period(ts)
        if not period:
            return
        totals[period][field] += amount
        if period == 'cur':
            series[field][clock.index(ts)] += amount

    for user in snap.users:
        if user.get('created_at'):
            count(int(user['created_at']), 'signups')
    ready = [f for f in snap.files if helpers.is_ready(f)]
    kinds_in_period = Counter()
    for item in ready:
        at = helpers.iso_ms(item.get('uploaded_at'))
        if not at:
            continue
        ts = at / 1000
        size = int(item.get('size', 0))
        kind = helpers.file_kind(item['file_name'], item.get('content_type'))
        count(ts, 'uploads')
        count(ts, 'upload_bytes', size)
        if kind == 'video':
            count(ts, 'videos')
        if clock.period(ts) == 'cur':
            kinds_in_period[kind] += 1
    for link in snap.links:
        if link.get('created_at'):
            count(int(link['created_at']) / 1000, 'links')
    for day, item in snap.stats.items():
        base = day_start(day)
        hourly = {int(k.rsplit('_h', 1)[1]): int(v) for k, v in item.items()
                  if k.startswith('downloads_h') and k.rsplit('_h', 1)[1].isdigit()}
        if clock.unit == 'hour' and hourly:
            for hour, value in hourly.items():
                count(base + hour * 3600 + 1800, 'downloads', value)
        else:
            # one count per UTC day: put it at the day's midpoint
            count(base + 43200, 'downloads', int(item.get('downloads', 0)))

    # storage still held, at the end of each bucket (files deleted since aren't counted)
    sizes = sorted((helpers.iso_ms(f.get('uploaded_at')) or 0, int(f.get('size', 0))) for f in ready)
    storage, total, j = [], 0, 0
    for i in range(n):
        edge_ms = (clock.start + (i + 1) * clock.size) * 1000
        while j < len(sizes) and sizes[j][0] < edge_ms:
            total += sizes[j][1]
            j += 1
        storage.append(total)
    series['storage_bytes'] = storage
    return series, totals, kinds_in_period


def files_breakdown(snap, helpers, kinds_in_period):
    ready = [f for f in snap.files if helpers.is_ready(f)]
    kinds = defaultdict(lambda: {'files': 0, 'bytes': 0})
    hist = [0] * len(SIZE_BUCKETS)
    for item in ready:
        size = int(item.get('size', 0))
        bucket = kinds[helpers.file_kind(item['file_name'], item.get('content_type'))]
        bucket['files'] += 1
        bucket['bytes'] += size
        for i, (_label, limit) in enumerate(SIZE_BUCKETS):
            if limit is None or size < limit:
                hist[i] += 1
                break
    top = sorted((f for f in ready if int(f.get('download_count', 0))),
                 key=lambda f: int(f.get('download_count', 0)), reverse=True)[:5]
    video = kinds.get('video', {'files': 0, 'bytes': 0})
    return {
        'by_kind': sorted(({'kind': k, 'files': v['files'], 'bytes': v['bytes'], 'new': kinds_in_period.get(k, 0)}
                           for k, v in kinds.items()), key=lambda k: k['bytes'], reverse=True),
        'sizes': [{'label': label, 'files': hist[i]} for i, (label, _limit) in enumerate(SIZE_BUCKETS)],
        'top_downloaded': [{'file_id': f['file_id'], 'file_name': f['file_name'], 'size': int(f.get('size', 0)),
                            'kind': helpers.file_kind(f['file_name'], f.get('content_type')),
                            'downloads': int(f.get('download_count', 0)), 'owner': snap.brief(f['user_id'])}
                           for f in top],
        'videos': {'files': video['files'], 'bytes': video['bytes']},
        'total_files': len(ready),
        'total_bytes': sum(v['bytes'] for v in kinds.values()),
    }


def funnel(snap, clock, traffic, helpers):
    '''Visitors in the period -> accounts made in it -> how far those got.'''
    new_users = [u for u in snap.users if u.get('created_at') and clock.period(int(u['created_at'])) == 'cur']
    ids = {u['user_id'] for u in new_users}
    uploaded = {f['user_id'] for f in snap.files if f['user_id'] in ids and helpers.is_ready(f)}
    shared = {link.get('owner_id') for link in snap.links if link.get('owner_id') in ids}
    downloaded = {f['user_id'] for f in snap.files if f['user_id'] in ids and int(f.get('download_count', 0))}
    return [
        {'step': 'Visited', 'count': len(traffic.periods['cur']['visitors'])},
        {'step': 'Signed up', 'count': len(ids)},
        {'step': 'Uploaded a file', 'count': len(uploaded)},
        {'step': 'Shared a link', 'count': len(shared)},
        {'step': 'Got a download', 'count': len(downloaded)},
    ]


def retention(snap, traffic, tz_seconds, now):
    '''Weekly cohorts by sign-up week: share of each cohort active in each later,
       complete week (Monday to Sunday in the admin's time zone).'''
    def week_of(ts):
        local = datetime.datetime.fromtimestamp(ts + tz_seconds, tz=datetime.timezone.utc)
        monday = (local - datetime.timedelta(days=local.weekday())).date()
        return monday

    this_week = week_of(now)
    weeks = [this_week - datetime.timedelta(weeks=w) for w in range(COHORT_WEEKS - 1, -1, -1)]
    cohorts = {w: [] for w in weeks}
    for user in snap.users:
        if user.get('created_at'):
            w = week_of(int(user['created_at']))
            if w in cohorts:
                cohorts[w].append(user['user_id'])
    active_weeks = defaultdict(set)
    for uid, days in traffic.user_days.items():
        for d in days:
            active_weeks[uid].add(week_of(d * 86400 + 43200))
    rows = []
    for w in weeks:
        members = cohorts[w]
        later = (this_week - w).days // 7
        cells = []
        for k in range(1, later):   # complete weeks only: the current one isn't over yet
            target = w + datetime.timedelta(weeks=k)
            back = sum(1 for uid in members if target in active_weeks[uid])
            cells.append(round(100 * back / len(members), 1) if members else None)
        rows.append({'week': w.isoformat(), 'size': len(members), 'weeks': cells})
    return rows


def analytics(snap, range_key, tz_minutes, helpers, now=None):
    now = int(time.time()) if now is None else int(now)
    clock = Clock(range_key, tz_minutes, now)
    history_start = min(clock.prev_start, now - MIN_HISTORY_DAYS * 86400)
    days, cursor = [], history_start - history_start % 86400
    while cursor <= now:
        days.append(stats.day(cursor))
        cursor += 86400
    found = visits.sessions(days)
    items = [item for d in days for item in found[d]]
    traffic = Traffic(items, clock, now)
    prod_series, prod_totals, kinds_in_period = product(snap, clock, helpers)

    def totals(period):
        out = traffic.kpis(period)
        out.update({k: prod_totals[period].get(k, 0)
                    for k in ('signups', 'uploads', 'upload_bytes', 'links', 'downloads', 'videos')})
        return out

    top_users = sorted(traffic.user_activity.items(), key=lambda kv: kv[1]['secs'], reverse=True)[:TOP]
    return {
        'range': range_key,
        'unit': clock.unit,
        'tz': tz_minutes,
        'generated_at': now * 1000,
        'tracking': visits.enabled(),
        'tracking_since': min((d for d, day_items in found.items() if day_items), default=None),
        'buckets': clock.buckets(),
        'series': dict(traffic.bucket_series(), **prod_series),
        'kpis': {'cur': totals('cur'), 'prev': totals('prev')},
        'heatmap': traffic.heatmap,
        'pages': ranked(traffic.pages, 'views', extra=lambda p: {'visitors': len(traffic.page_visitors[p])}),
        'landing': ranked(traffic.landing, 'sessions'),
        'referrers': ranked(traffic.referrers, 'sessions'),
        'devices': ranked(traffic.devices, 'sessions'),
        'browsers': ranked(traffic.browsers, 'sessions'),
        'systems': ranked(traffic.systems, 'sessions'),
        'zones': ranked(traffic.zones, 'sessions'),
        'engagement': traffic.engagement(),
        'funnel': funnel(snap, clock, traffic, helpers),
        'retention': retention(snap, traffic, clock.offset, now),
        'files': files_breakdown(snap, helpers, kinds_in_period),
        'top_users': [dict(snap.brief(uid), active_seconds=a['secs'], sessions=len(a['sessions']),
                           pageviews=a['pageviews'], last_seen_at=a['last_at'] * 1000)
                      for uid, a in top_users if a['secs'] or a['pageviews']],
    }


# --- live --------------------------------------------------------------------------
def live(snap, now=None):
    '''Who is on the site right now, and the last hour in 5-minute slots.'''
    now = int(time.time()) if now is None else int(now)
    items = visits.recent(now)
    slot_now = now - now % visits.SLOT_SECONDS
    slots = [slot_now - k * visits.SLOT_SECONDS for k in range(11, -1, -1)]
    per_slot = {s: set() for s in slots}
    today = {'visitors': set(), 'pageviews': 0, 'secs': 0}
    online, pages = [], Counter()
    for item in items:
        vid = item.get('vid', item['sk'])
        for ts, secs, views in slot_activity(item):
            start = ts - ts % visits.SLOT_SECONDS
            if start in per_slot and (secs or views):
                per_slot[start].add(vid)
            if item['pk'] == visits.day_key(stats.day(now)):
                today['visitors'].add(vid)
                today['pageviews'] += views
                today['secs'] += secs
        if not visits.is_online(item, now):
            continue
        uid = item.get('uid')
        pages[item.get('cur', '/')] += 1
        online.append({
            'sid': item['sk'], 'vid': vid, 'user': snap.brief(uid) if uid else None,
            'page': item.get('cur', '/'), 'device': item.get('dev'), 'browser': item.get('br'), 'os': item.get('os'),
            'zone': item.get('tz'), 'since': int(item.get('first_at', now)) * 1000,
            'last_at': int(item.get('last_at', now)) * 1000, 'active_seconds': int(item.get('secs', 0)),
            'pageviews': int(item.get('pv', 0)), 'ref': item.get('ref') or 'direct',
        })
    # one row per person: a user (or browser) with several tabs counts once
    people = {}
    for row in online:
        key = ('u', row['user']['user_id']) if row['user'] else ('v', row['vid'])
        if key in people:
            people[key]['tabs'] += 1
            people[key]['active_seconds'] += row['active_seconds']
            people[key]['since'] = min(people[key]['since'], row['since'])
        else:
            people[key] = dict(row, tabs=1)
    rows = sorted(people.values(), key=lambda r: (r['user'] is None, -r['last_at']))
    return {
        'generated_at': now * 1000,
        'tracking': visits.enabled(),
        'online_seconds': visits.ONLINE_SECONDS,
        'online': rows,
        'counts': {'online': len(rows), 'signed_in': sum(1 for r in rows if r['user']),
                   'guests': sum(1 for r in rows if not r['user'])},
        'pages_now': [{'name': p, 'tabs': n} for p, n in pages.most_common(TOP)],
        'last_hour': [{'start': s * 1000, 'visitors': len(per_slot[s])} for s in slots],
        'today': {'visitors': len(today['visitors']), 'pageviews': today['pageviews'],
                  'active_seconds': today['secs']},
        'users': visits.last_seen_by_user(items, now),
    }
