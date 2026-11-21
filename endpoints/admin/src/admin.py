'''The admin panel's API: everything in DropVault, for admins only.

All routes are under /v1/admin (one Lambda behind a greedy {proxy+} route,
protected by the Lambda authorizer like every other route). The caller must
also be an admin: role "admin" on their account, or listed in ADMIN_EMAILS
(see accounts.py). That is checked against the users table on every request,
so taking away someone's admin role takes effect at once.

  GET    /overview                    totals, daily activity, storage by type, top users
  GET    /users                       every account with its files, storage and sign-ins
  GET    /users/{user_id}             one account: its files, links and activity
  PATCH  /users/{user_id}             {role?: "admin"|"user", suspended?: bool,
                                       quota_bytes?: bytes (0 = unlimited) | null (the default)}
  POST   /users/{user_id}/signout     end every session of the account
  POST   /users/{user_id}/password    new temporary password -> {temporary_password} (shown once)
  DELETE /users/{user_id}             delete the account and all of its files
  GET    /files                       every file, with its owner and links
  GET    /files/{file_id}/download    a 5-minute download URL
  DELETE /files/{file_id}             delete the file and its links
  DELETE /files/{file_id}/links       turn off every link to the file
  GET    /links                       every short link, with its status and downloads
  DELETE /links/{code}                turn off one link
  GET    /activity                    sign-ups, uploads, shares, downloads, admin actions
  GET    /system                      configuration and record counts
  GET    /health?range=1h|24h|7d      live checks, CloudWatch metrics, recent errors (health.py)

Admins can't demote, suspend, sign out, reset or delete their own account or
an owner admin's (ADMIN_EMAILS), so the panel can never lock everyone out.
Every change, and every download of someone's file, goes into the audit log
(AUDIT# items in the files table, kept for a year), shown under /activity.

These views read whole tables (Scan). That is fine at the size this app is
made for (tens of thousands of files); far beyond that they would need
pre-computed totals.
'''

import datetime
import os
import secrets
import time
from collections import Counter, defaultdict

import boto3

import accounts
import api
import auth
import deletion
import health
import links
import log
import stats
import storage
import usage

LOGGER = log.setup_logging()
AUDIT_PREFIX = 'AUDIT#'
AUDIT_KEEP_SECONDS = 365 * 86400
DOWNLOAD_TTL = 300
DAILY_DAYS = 90
ACTIVITY_LIMIT = 500
MAX_QUOTA = 1024 ** 5          # 1 PiB: a sanity cap on per-user limits
EDITABLE = ('role', 'suspended', 'quota_bytes')

KIND_EXTENSIONS = (
    ('image', {'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'}),
    ('video', {'mp4', 'mov', 'webm', 'mkv', 'avi'}),
    ('audio', {'mp3', 'wav', 'flac', 'ogg', 'm4a'}),
    ('pdf', {'pdf'}),
    ('archive', {'zip', 'rar', '7z', 'tar', 'gz', 'tgz'}),
    ('code', {'js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'java', 'rb', 'sh', 'json', 'yml', 'yaml',
              'html', 'css'}),
    ('document', {'doc', 'docx', 'txt', 'md', 'rtf', 'odt', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'}),
)
KIND_TYPES = {'image': 'image/', 'video': 'video/', 'audio': 'audio/'}


# --- small helpers --------------------------------------------------------------
def file_kind(name, content_type):
    '''Coarse kind of a file, the same buckets as the web app (lib/format.js).'''
    ext = (name or '').split('.')[-1].lower()
    content_type = content_type or ''
    for kind, extensions in KIND_EXTENSIONS:
        if ext in extensions or (kind in KIND_TYPES and content_type.startswith(KIND_TYPES[kind])) \
                or (kind == 'pdf' and content_type == 'application/pdf'):
            return kind
    return 'file'


def human_bytes(size):
    size = float(size or 0)
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if size < 1024 or unit == 'TB':
            text = '{0:.0f} {1}'.format(size, unit) if unit == 'B' else '{0:.1f} {1}'.format(size, unit)
            return text.replace('.0 ', ' ')
        size /= 1024
    return ''


def number(value):
    return int(value) if value is not None else None


def iso_ms(value):
    try:
        return int(datetime.datetime.fromisoformat(value).timestamp() * 1000)
    except (TypeError, ValueError):
        return None


def is_ready(item):
    return item.get('status', 'READY') == 'READY'


def who(user):
    return user.get('email') or user.get('user_id', 'unknown user')


# --- reading everything --------------------------------------------------------
class Snapshot:
    '''Both tables, read once per request and sorted into their kinds.'''

    def __init__(self):
        self.users = [u for u in storage.scan_all(accounts.users_table()) if u.get('user_id')]
        self.files, self.links, self.audit = [], [], []
        self.usage, self.stats = {}, {}
        for item in storage.scan_all(storage.table()):
            key = item['file_id']
            if item.get('kind') == 'qr_link':
                self.links.append(item)
            elif key.startswith(usage.PREFIX):
                self.usage[key[len(usage.PREFIX):]] = item
            elif key.startswith(AUDIT_PREFIX):
                self.audit.append(item)
            elif key.startswith(stats.PREFIX):
                self.stats[key[len(stats.PREFIX):]] = item
            elif item.get('user_id') and item.get('file_name'):
                self.files.append(item)
        self.users_by_id = {u['user_id']: u for u in self.users}
        self.files_by_id = {f['file_id']: f for f in self.files}
        self.files_by_owner = defaultdict(list)
        for item in self.files:
            self.files_by_owner[item['user_id']].append(item)
        self.links_by_owner, self.links_by_file = defaultdict(list), defaultdict(list)
        for link in self.links:
            self.links_by_owner[link.get('owner_id')].append(link)
            self.links_by_file[link.get('target_file_id')].append(link)

    def link_status(self, link):
        return links.status(link, self.files_by_id.get(link.get('target_file_id')))

    def brief(self, user_id):
        user = self.users_by_id.get(user_id) or {}
        return {'user_id': user_id, 'name': user.get('name'), 'email': user.get('email')}


def file_ref(item, file_id=None):
    if not item:
        return {'file_id': file_id, 'file_name': None, 'size': None}
    return {'file_id': item['file_id'], 'file_name': item['file_name'], 'size': int(item.get('size', 0))}


def user_row(user, snap):
    user_id = user['user_id']
    files = snap.files_by_owner.get(user_id, [])
    ready = [f for f in files if is_ready(f)]
    counter = snap.usage.get(user_id)
    owned_links = snap.links_by_owner.get(user_id, [])
    return {
        'user_id': user_id,
        'email': user.get('email'),
        'name': user.get('name'),
        'created_at': number(user.get('created_at')),
        'last_login_at': number(user.get('last_login_at')),
        'login_count': int(user.get('login_count', 0)),
        'role': accounts.role(user),
        'owner': accounts.is_owner(user),
        'suspended': accounts.is_suspended(user),
        'suspended_at': number(user.get('suspended_at')),
        'file_count': len(ready),
        'uploading_count': len(files) - len(ready),
        'used_bytes': int(counter.get('used_bytes', 0)) if counter else sum(int(f.get('size', 0)) for f in ready),
        'quota_bytes': usage.effective_quota(counter),
        'custom_quota': bool(counter and counter.get('quota_bytes') is not None),
        'link_count': len(owned_links),
        'active_links': sum(1 for link in owned_links if snap.link_status(link) == 'active'),
        'downloads': sum(int(f.get('download_count', 0)) for f in files),
    }


def file_row(item, snap):
    file_links = snap.links_by_file.get(item['file_id'], [])
    row = {
        'file_id': item['file_id'],
        'file_name': item['file_name'],
        'content_type': item.get('content_type', 'application/octet-stream'),
        'kind': file_kind(item['file_name'], item.get('content_type')),
        'size': int(item.get('size', 0)),
        'status': item.get('status', 'READY'),
        'uploaded_at': item.get('uploaded_at'),
        'download_count': int(item.get('download_count', 0)),
        'owner': snap.brief(item['user_id']),
        'link_count': len(file_links),
        'active_links': sum(1 for link in file_links if snap.link_status(link) == 'active'),
    }
    return row


def link_row(event, link, snap):
    item = snap.files_by_id.get(link.get('target_file_id'))
    row = links.describe(event, link, item)
    row.update(file=file_ref(item, link.get('target_file_id')), owner=snap.brief(link.get('owner_id')))
    return row


def by_newest(rows, key, missing=''):
    '''Newest first; `missing` stands in for an absent value (same type as the key).'''
    return sorted(rows, key=lambda row: row.get(key) or missing, reverse=True)


# --- activity ------------------------------------------------------------------
def activity(snap):
    '''Everything that happened, newest first: worked out from the records
       (sign-ups, uploads, shares, each link's latest download) plus the
       audit log of admin actions.'''
    events = []
    for user in snap.users:
        if user.get('created_at'):
            events.append({'type': 'signup', 'at': int(user['created_at']) * 1000,
                           'user': snap.brief(user['user_id'])})
    for item in snap.files:
        at = iso_ms(item.get('uploaded_at'))
        if at and is_ready(item):
            events.append({'type': 'upload', 'at': at, 'user': snap.brief(item['user_id']), 'file': file_ref(item)})
    for link in snap.links:
        base = {'user': snap.brief(link.get('owner_id')),
                'file': file_ref(snap.files_by_id.get(link.get('target_file_id')), link.get('target_file_id')),
                'channel': link.get('channel', 'link'), 'recipient': link.get('recipient')}
        if link.get('created_at'):
            events.append(dict(base, type='share', at=int(link['created_at'])))
        if link.get('last_downloaded_at'):
            events.append(dict(base, type='download', at=int(link['last_downloaded_at']) * 1000,
                               downloads=int(link.get('downloads', 0))))
    for entry in snap.audit:
        events.append({'type': 'admin', 'at': int(entry.get('at', 0)), 'action': entry.get('action'),
                       'summary': entry.get('summary'), 'subject_id': entry.get('subject_id'),
                       'actor': {'user_id': entry.get('actor_id'), 'email': entry.get('actor_email'),
                                 'name': entry.get('actor_name')}})
    events.sort(key=lambda e: e['at'], reverse=True)
    return events


def involves(event, user_id):
    if event['type'] == 'admin':
        return user_id in (event.get('subject_id'), event['actor'].get('user_id'))
    return (event.get('user') or {}).get('user_id') == user_id


def audit(admin, action, summary, subject_id=None):
    '''Record an admin action (kept for a year).'''
    now_ms = int(time.time() * 1000)
    item = {'file_id': '{0}{1:013d}#{2}'.format(AUDIT_PREFIX, now_ms, secrets.token_hex(4)),
            'kind': 'audit', 'at': now_ms, 'action': action, 'summary': summary,
            'actor_id': admin['user_id'], 'actor_email': admin.get('email'), 'actor_name': admin.get('name'),
            'subject_id': subject_id, 'ttl': int(time.time()) + AUDIT_KEEP_SECONDS}
    storage.table().put_item(Item={k: v for k, v in item.items() if v is not None})
    LOGGER.info('admin %s: %s', admin.get('email'), summary)


# --- who is calling --------------------------------------------------------------
def require_admin(event):
    '''The caller's account, if they are an admin (403 otherwise).'''
    user_id, name, email = auth.resolve_event_user(event)
    if not user_id:
        raise api.ApiError(401, 'Unauthorized')
    email = (email or '').lower()
    user = accounts.get_user(email)
    if user and user.get('user_id') != user_id:
        user = None
    if user is None and email in accounts.owner_emails():
        # an external auth service: no account record here, but listed as an owner admin
        return {'user_id': user_id, 'email': email, 'name': name}
    if not user or accounts.role(user) != 'admin' or accounts.is_suspended(user):
        raise api.ApiError(403, 'Only admins can use the admin panel')
    return user


def guard(admin, target, doing):
    '''Admins can't lock themselves (or the owner admins) out.'''
    if target['user_id'] == admin['user_id']:
        raise api.ApiError(400, "You can't {0} your own account.".format(doing))
    if accounts.is_owner(target):
        raise api.ApiError(403, "{0} is an owner admin (set in the deployment's admin_emails), so you can't "
                                "{1} this account here.".format(target['email'], doing))


def find_user(user_id):
    for user in storage.scan_all(accounts.users_table()):
        if user.get('user_id') == user_id:
            return user
    raise api.ApiError(404, 'User not found')


def find_file(file_id):
    item = storage.get_file(file_id) if file_id else None
    if not item or not item.get('user_id') or not item.get('file_name'):
        raise api.ApiError(404, 'File not found')
    return item


def owner_label(user_id):
    try:
        return who(find_user(user_id))
    except api.ApiError:
        return 'a deleted account'


# --- overview ------------------------------------------------------------------
def overview(event, snap):
    now = time.time()
    days = [stats.day(now - offset * 86400) for offset in range(DAILY_DAYS - 1, -1, -1)]
    daily = {d: {'date': d, 'signups': 0, 'uploads': 0, 'upload_bytes': 0, 'links': 0, 'downloads': 0}
             for d in days}

    def count(epoch_seconds, field, amount=1):
        bucket = daily.get(stats.day(epoch_seconds))
        if bucket is not None:
            bucket[field] += amount

    ready = [f for f in snap.files if is_ready(f)]
    for user in snap.users:
        if user.get('created_at'):
            count(int(user['created_at']), 'signups')
    for item in ready:
        at = iso_ms(item.get('uploaded_at'))
        if at:
            count(at / 1000, 'uploads')
            count(at / 1000, 'upload_bytes', int(item.get('size', 0)))
    for link in snap.links:
        if link.get('created_at'):
            count(int(link['created_at']) / 1000, 'links')
    for d, item in snap.stats.items():
        if d in daily:
            daily[d]['downloads'] = int(item.get('downloads', 0))

    kinds = defaultdict(lambda: {'files': 0, 'bytes': 0})
    for item in ready:
        bucket = kinds[file_kind(item['file_name'], item.get('content_type'))]
        bucket['files'] += 1
        bucket['bytes'] += int(item.get('size', 0))

    rows = [user_row(u, snap) for u in snap.users]
    statuses = Counter(snap.link_status(link) for link in snap.links)
    channels = Counter(link.get('channel', 'link') for link in snap.links)
    return {
        'totals': {
            'users': len(snap.users),
            'admins': sum(1 for r in rows if r['role'] == 'admin'),
            'suspended': sum(1 for r in rows if r['suspended']),
            'files': len(ready),
            'uploading': len(snap.files) - len(ready),
            'storage_bytes': sum(int(f.get('size', 0)) for f in ready),
            'links': len(snap.links),
            'active_links': statuses.get('active', 0),
            'downloads': sum(int(f.get('download_count', 0)) for f in snap.files),
        },
        'default_quota_bytes': usage.default_quota_bytes(),
        'daily': [daily[d] for d in days],
        'downloads_counted_since': min(snap.stats) if snap.stats else None,
        'storage_by_kind': sorted(({'kind': k, **v} for k, v in kinds.items()),
                                  key=lambda k: k['bytes'], reverse=True),
        'top_users': sorted((r for r in rows if r['used_bytes']), key=lambda r: r['used_bytes'], reverse=True)[:5],
        'links_by_status': {s: statuses.get(s, 0) for s in ('active', 'expired', 'limit_reached', 'revoked',
                                                              'file_missing')},
        'links_by_channel': {c: channels.get(c, 0) for c in links.CHANNELS},
        'recent': activity(snap)[:8],
    }


# --- users ---------------------------------------------------------------------
def user_detail(event, snap, user_id):
    user = snap.users_by_id.get(user_id)
    if not user:
        raise api.ApiError(404, 'User not found')
    return {
        'user': user_row(user, snap),
        'files': by_newest([file_row(f, snap) for f in snap.files_by_owner.get(user_id, [])], 'uploaded_at'),
        'links': by_newest([link_row(event, link, snap) for link in snap.links_by_owner.get(user_id, [])],
                           'created_at', 0),
        'activity': [e for e in activity(snap) if involves(e, user_id)][:100],
    }


def parse_changes(body):
    unknown = sorted(set(body) - set(EDITABLE))
    if unknown:
        raise api.ApiError(400, 'Unknown field: {0}'.format(unknown[0]))
    if not body:
        raise api.ApiError(400, 'Nothing to change')
    if 'role' in body and body['role'] not in ('admin', 'user'):
        raise api.ApiError(400, 'role must be "admin" or "user"')
    if 'suspended' in body and not isinstance(body['suspended'], bool):
        raise api.ApiError(400, 'suspended must be true or false')
    if 'quota_bytes' in body:
        quota = body['quota_bytes']
        if quota is not None and (not isinstance(quota, int) or isinstance(quota, bool)
                                  or not 0 <= quota <= MAX_QUOTA):
            raise api.ApiError(400, 'quota_bytes must be a number of bytes (0 = unlimited), or null for the default')
    return body


def update_user(event, admin, user_id):
    body = parse_changes(api.json_body(event))
    target = find_user(user_id)
    if 'role' in body:
        guard(admin, target, 'change the role of')
    if 'suspended' in body:
        guard(admin, target, 'suspend' if body['suspended'] else 'unsuspend')

    table, key, changed = accounts.users_table(), {'email': target['email']}, []
    if 'role' in body and body['role'] != (target.get('role') or 'user'):
        if body['role'] == 'admin':
            table.update_item(Key=key, UpdateExpression='SET #r = :admin',
                              ExpressionAttributeNames={'#r': 'role'}, ExpressionAttributeValues={':admin': 'admin'})
            changed.append(('user.role', 'Made {0} an admin'.format(who(target))))
        else:
            table.update_item(Key=key, UpdateExpression='REMOVE #r', ExpressionAttributeNames={'#r': 'role'})
            changed.append(('user.role', 'Removed the admin role from {0}'.format(who(target))))
    if 'suspended' in body and body['suspended'] != accounts.is_suspended(target):
        if body['suspended']:
            # bumping the token version also ends the sessions it already has
            table.update_item(Key=key, UpdateExpression='SET suspended_at = :now ADD token_version :one',
                              ExpressionAttributeValues={':now': int(time.time()), ':one': 1})
            changed.append(('user.suspend', 'Suspended {0}'.format(who(target))))
        else:
            table.update_item(Key=key, UpdateExpression='REMOVE suspended_at')
            changed.append(('user.unsuspend', 'Lifted the suspension of {0}'.format(who(target))))
    if 'quota_bytes' in body:
        quota = body['quota_bytes']
        usage.set_quota(user_id, quota)
        if quota is None:
            text = 'the default ({0})'.format(human_bytes(usage.default_quota_bytes())
                                              if usage.default_quota_bytes() else 'unlimited')
        else:
            text = human_bytes(quota) if quota else 'unlimited'
        changed.append(('user.quota', "Set {0}'s storage limit to {1}".format(who(target), text)))

    for action, summary in changed:
        audit(admin, action, summary, subject_id=user_id)
    return 200, {'user_id': user_id, 'changes': [summary for _action, summary in changed]}


def sign_out_user(admin, user_id):
    target = find_user(user_id)
    guard(admin, target, 'sign out')
    accounts.users_table().update_item(Key={'email': target['email']}, UpdateExpression='ADD token_version :one',
                                       ExpressionAttributeValues={':one': 1})
    audit(admin, 'user.signout', 'Signed {0} out everywhere'.format(who(target)), subject_id=user_id)
    return 200, {'user_id': user_id, 'signed_out': True}


def reset_password(admin, user_id):
    target = find_user(user_id)
    guard(admin, target, 'reset the password of')
    password = accounts.temporary_password()
    accounts.users_table().update_item(
        Key={'email': target['email']},
        UpdateExpression='SET password = :p, password_reset_at = :now ADD token_version :one',
        ExpressionAttributeValues={':p': accounts.hash_password(password), ':now': int(time.time()), ':one': 1})
    audit(admin, 'user.password', 'Reset the password of {0}'.format(who(target)), subject_id=user_id)
    return 200, {'user_id': user_id, 'temporary_password': password}


def forget_kms_key(user_id):
    '''per_user encryption: schedule the deleted account's KMS key for deletion.'''
    record = storage.get_file('USERKEY#' + user_id)
    if not record:
        return
    if record.get('kms_key_arn') and os.getenv('KMS_MODE') == 'per_user':
        try:
            boto3.client('kms', region_name=storage.region()).schedule_key_deletion(
                KeyId=record['kms_key_arn'], PendingWindowInDays=7)
        except Exception:  # pylint: disable=broad-except
            LOGGER.exception('could not schedule KMS key deletion for %s', user_id)
    storage.table().delete_item(Key={'file_id': 'USERKEY#' + user_id})


def delete_user(admin, user_id):
    target = find_user(user_id)
    guard(admin, target, 'delete')
    files = storage.user_files(user_id)
    for item in files:
        deletion.delete_file(item)
    with storage.table().batch_writer() as batch:   # links left behind by files deleted earlier
        for link in [lk for lk in storage.scan_all(storage.table()) if lk.get('owner_id') == user_id]:
            batch.delete_item(Key={'file_id': link['file_id']})
    storage.table().delete_item(Key={'file_id': usage.PREFIX + user_id})
    forget_kms_key(user_id)
    accounts.users_table().delete_item(Key={'email': target['email']})
    size = sum(int(f.get('size', 0)) for f in files if is_ready(f))
    audit(admin, 'user.delete', 'Deleted the account of {0} ({1} {2}, {3})'.format(
        who(target), len(files), 'file' if len(files) == 1 else 'files', human_bytes(size)), subject_id=user_id)
    return 200, {'user_id': user_id, 'deleted': True, 'files_deleted': len(files)}


# --- files and links -------------------------------------------------------------
def download_file(admin, file_id):
    item = find_file(file_id)
    if not is_ready(item):
        raise api.ApiError(409, 'File upload has not finished yet')
    url = storage.presigned_download(item, DOWNLOAD_TTL)
    audit(admin, 'file.download', 'Downloaded {0} (owned by {1})'.format(
        item['file_name'], owner_label(item['user_id'])), subject_id=item['user_id'])
    return 200, {'download_url': url, 'expires_in': DOWNLOAD_TTL}


def delete_file(admin, file_id):
    item = find_file(file_id)
    deletion.delete_file(item)
    audit(admin, 'file.delete', 'Deleted {0} (owned by {1})'.format(
        item['file_name'], owner_label(item['user_id'])), subject_id=item['user_id'])
    return 200, {'file_id': file_id, 'file_status': 'DELETED'}


def revoke_file_links(admin, file_id):
    item = find_file(file_id)
    revoked_at = int(time.time() * 1000)
    storage.table().update_item(Key={'file_id': file_id}, UpdateExpression='SET links_revoked_at = :t',
                                ExpressionAttributeValues={':t': revoked_at})
    audit(admin, 'file.links_off', 'Turned off every link to {0} (owned by {1})'.format(
        item['file_name'], owner_label(item['user_id'])), subject_id=item['user_id'])
    return 200, {'file_id': file_id, 'links_revoked_at': revoked_at}


def revoke_link(admin, code):
    link = storage.get_file('QR#' + code) if links.valid_code(code) else None
    if not link or link.get('kind') != 'qr_link':
        raise api.ApiError(404, 'Link not found')
    storage.table().update_item(Key={'file_id': link['file_id']}, UpdateExpression='SET revoked_at = :now',
                                ExpressionAttributeValues={':now': int(time.time())})
    item = storage.get_file(link.get('target_file_id')) or {}
    to = ' sent to {0}'.format(link['recipient']) if link.get('recipient') else ''
    audit(admin, 'link.off', 'Turned off a link{0} to {1} (owned by {2})'.format(
        to, item.get('file_name', 'a deleted file'), owner_label(link.get('owner_id'))),
        subject_id=link.get('owner_id'))
    return 200, {'code': code, 'status': 'revoked'}


# --- system --------------------------------------------------------------------
def system(snap):
    def env_int(name):
        try:
            return int(os.getenv(name)) if os.getenv(name) else None
        except ValueError:
            return None
    return {
        'config': {
            'region': storage.region(),
            'environment': os.getenv('APP_ENV'),
            'auth': os.getenv('AUTH_MODE', 'built-in'),
            'kms_mode': os.getenv('KMS_MODE', 's3'),
            'default_quota_bytes': usage.default_quota_bytes(),
            'owner_admins': sorted(accounts.owner_emails()),
            'authorizer_cache_seconds': env_int('AUTHORIZER_CACHE_SECONDS'),
            'api_rate_limit': env_int('API_THROTTLE_RATE'),
            'api_burst_limit': env_int('API_THROTTLE_BURST'),
            'alert_email': bool(os.getenv('ALERT_EMAIL_SET')),
            'files_bucket': storage.bucket(),
            'files_table': os.getenv('FILE_SHARING_TABLE'),
            'users_table': os.getenv('USERS_TABLE'),
        },
        'counts': {'users': len(snap.users), 'files': len(snap.files), 'links': len(snap.links),
                   'audit_entries': len(snap.audit), 'storage_counters': len(snap.usage),
                   'days_of_download_stats': len(snap.stats)},
    }


# --- routing -------------------------------------------------------------------
@api.route('GET, POST, PATCH, DELETE, OPTIONS')
def lambda_handler(event):
    admin = require_admin(event)
    method = event.get('httpMethod')
    parts = [p for p in (event.get('path') or '').split('/v1/admin', 1)[-1].split('/') if p]
    head, size = (parts[0] if parts else ''), len(parts)
    target = parts[1] if size > 1 else None

    if method == 'GET' and parts == ['overview']:
        return 200, overview(event, Snapshot())
    if method == 'GET' and parts == ['activity']:
        snap = Snapshot()
        events = activity(snap)
        return 200, {'events': events[:ACTIVITY_LIMIT], 'total': len(events)}
    if method == 'GET' and parts == ['system']:
        return 200, system(Snapshot())
    if method == 'GET' and parts == ['health']:
        range_key = api.query_param(event, 'range') or '24h'
        if range_key not in health.RANGES:
            raise api.ApiError(400, 'range must be one of: {0}'.format(', '.join(health.RANGES)))
        return 200, health.health(range_key)

    if head == 'users':
        if size == 1 and method == 'GET':
            snap = Snapshot()
            rows = sorted((user_row(u, snap) for u in snap.users), key=lambda r: r['created_at'] or 0, reverse=True)
            return 200, {'users': rows, 'default_quota_bytes': usage.default_quota_bytes()}
        if size == 2 and method == 'GET':
            return 200, user_detail(event, Snapshot(), target)
        if size == 2 and method == 'PATCH':
            return update_user(event, admin, target)
        if size == 2 and method == 'DELETE':
            return delete_user(admin, target)
        if size == 3 and method == 'POST' and parts[2] == 'signout':
            return sign_out_user(admin, target)
        if size == 3 and method == 'POST' and parts[2] == 'password':
            return reset_password(admin, target)

    if head == 'files':
        if size == 1 and method == 'GET':
            snap = Snapshot()
            return 200, {'files': by_newest([file_row(f, snap) for f in snap.files], 'uploaded_at')}
        if size == 2 and method == 'DELETE':
            return delete_file(admin, target)
        if size == 3 and method == 'GET' and parts[2] == 'download':
            return download_file(admin, target)
        if size == 3 and method == 'DELETE' and parts[2] == 'links':
            return revoke_file_links(admin, target)

    if head == 'links':
        if size == 1 and method == 'GET':
            snap = Snapshot()
            return 200, {'links': by_newest([link_row(event, link, snap) for link in snap.links], 'created_at', 0)}
        if size == 2 and method == 'DELETE':
            return revoke_link(admin, target)

    raise api.ApiError(404, 'Not found')
