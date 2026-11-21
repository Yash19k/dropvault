'''System health for the admin panel.

  GET /v1/admin/health?range=1h|24h|7d

Live checks of every part of the deployment, run in parallel each time:
  api        the API Gateway stage is deployed (and how often it fails)
  functions  every Lambda function is active (and how often it errors)
  files_table, users_table   DynamoDB tables are active, with TTL and stream
  storage    the S3 bucket answers, is encrypted and blocks public access
  email      the SES sender is verified; sandbox or production; daily quota
  encryption the KMS key(s) for the chosen encryption mode
  cleanup    abandoned-upload cleanup is reading the table's stream
  alarms     no CloudWatch alarm is going off
plus CloudWatch metrics for the chosen range (requests, errors, latency,
per-function errors, throttles and timings) and recent errors from the
Lambda logs.

A check that fails to run (or isn't allowed) reports "unknown" with the
reason instead of breaking the page. The offline version (LocalStack) has no
API Gateway, Lambda, CloudWatch or logs, so only the checks it can answer run.
'''

import concurrent.futures
import datetime
import os
import re
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

import log
import storage

LOGGER = log.setup_logging()

OK, WARN, FAIL, UNKNOWN = 'ok', 'warning', 'error', 'unknown'
RANK = {UNKNOWN: 0, OK: 1, WARN: 2, FAIL: 3}
# range -> (seconds, chart period)
RANGES = {'1h': (3600, 120), '24h': (86400, 3600), '7d': (7 * 86400, 21600)}
OFFLINE = 'Not available in the offline version.'
SERVER_ERROR_WARN = 0.01      # 5xx share of requests that counts as degraded
ERRORS_SHOWN = 30
LOG_PAGES = 5                 # per function, newest errors are on the last pages
# What an error looks like in the Lambda logs (our logger prints "- ERROR -",
# the runtime prints "[ERROR]", "Task timed out", and exception lines).
ERROR_LINE = re.compile(r'\bERROR\b|\[ERROR\]|Task timed out|^\w*(Error|Exception)\b|Traceback', re.MULTILINE)
# Traceback scaffolding: the header, 'File "..."' frames, ^^^ markers, indented source lines.
NOISE = re.compile(r'^(\s*Traceback \(most recent call last\):|\s*File ".*|\s*\^+\s*|\s{4}.*)$')
LOG_PREFIX = re.compile(r'^\d{4}-\d\d-\d\d[ T][\d:,.]+\s+-\s+')
# The exception behind an error: "KeyError: 'x'", "botocore.errorfactory.MessageRejected: ...", a timeout.
CAUSE_LINE = re.compile(r'^(?:\[ERROR\]\s+)?(?:[A-Za-z_]\w*(?:Error|Exception|Exit|Interrupt)\b.*'
                        r'|[A-Za-z_]\w*(?:\.\w+)+: .+|Task timed out.*)$')
HAS_CAUSE = re.compile(r'\b\w+(?:Error|Exception)\b:|\b[A-Za-z_]\w*(?:\.\w+)+: |Task timed out')
CAUSES_LOOKED_UP = 10
# The authorizer turns a bad token away by raising "Unauthorized" (API Gateway's
# way of answering 401). Lambda counts each one as an error; they are not.
AUTHORIZER = 'authorizer'
REJECTION = re.compile(r'Exception: Unauthorized')


def tidy(message):
    '''One readable line from a log event that may hold a whole traceback.'''
    lines = [line.strip() for line in message.replace('\r', '\n').split('\n')]
    kept = [LOG_PREFIX.sub('', line) for line in lines if line and not NOISE.match(line)]
    return ' · '.join(kept)

CONFIG = Config(retries={'max_attempts': 2, 'mode': 'standard'}, connect_timeout=3, read_timeout=8)


def client(service):
    return boto3.client(service, region_name=storage.region(), config=CONFIG)


def offline():
    '''Terraform sets API_NAME; the offline server doesn't.'''
    return not os.getenv('API_NAME')


def lambda_names():
    return [n for n in (os.getenv('LAMBDA_NAMES') or '').split(',') if n]


def prefix():
    return os.getenv('ALARM_PREFIX', '')


def short_name(function_name):
    return function_name[len(prefix()):] if prefix() and function_name.startswith(prefix()) else function_name


def ms(moment):
    return int(moment.timestamp() * 1000) if moment else None


def reason(error):
    if isinstance(error, ClientError):
        info = error.response.get('Error', {})
        return '{0}: {1}'.format(info.get('Code'), info.get('Message') or '')[:200]
    return str(error)[:200] or type(error).__name__


def human_bytes(size):
    size = float(size or 0)
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if size < 1024 or unit == 'TB':
            return ('{0:.0f} {1}' if unit == 'B' else '{0:.1f} {1}').format(size, unit)
        size /= 1024
    return ''


class Outcome:
    '''What one fetch returned (or the exception it raised), and how long it took.'''

    def __init__(self, fn):
        started = time.perf_counter()
        self.value, self.error = None, None
        try:
            self.value = fn()
        except Exception as error:  # pylint: disable=broad-except
            LOGGER.warning('health: %s', reason(error))
            self.error = error
        self.ms = round((time.perf_counter() - started) * 1000)


def check(check_id, name, outcome, build):
    '''A check result: status, a one-line summary, details as [label, value] rows.'''
    result = {'id': check_id, 'name': name, 'ms': outcome.ms if outcome else None}
    if outcome is None:
        result.update(status=UNKNOWN, summary=OFFLINE, details=[])
    elif outcome.error is not None:
        result.update(status=UNKNOWN, summary='Could not check: ' + reason(outcome.error), details=[])
    else:
        status, summary, details = build(outcome.value)
        result.update(status=status, summary=summary, details=[[k, v] for k, v in details if v is not None])
    return result


# --- fetchers (each runs in its own thread) -----------------------------------
def fetch_stage():
    stage = client('apigateway').get_stage(restApiId=os.environ['API_ID'], stageName=os.environ['API_STAGE'])
    throttle = (stage.get('methodSettings') or {}).get('*/*') or {}
    return {'name': stage.get('stageName'), 'updated': ms(stage.get('lastUpdatedDate')),
            'rate': throttle.get('throttlingRateLimit'), 'burst': throttle.get('throttlingBurstLimit')}


def fetch_functions():
    lam = client('lambda')

    def one(name):
        try:
            cfg = lam.get_function_configuration(FunctionName=name)
        except ClientError as error:
            if error.response.get('Error', {}).get('Code') == 'ResourceNotFoundException':
                return {'name': name, 'state': 'Missing'}
            raise
        return {'name': name, 'state': cfg.get('State', 'Active'), 'update': cfg.get('LastUpdateStatus'),
                'reason': cfg.get('StateReason') or cfg.get('LastUpdateStatusReason'),
                'runtime': cfg.get('Runtime'), 'memory': cfg.get('MemorySize'), 'timeout': cfg.get('Timeout'),
                'code_size': cfg.get('CodeSize'), 'modified': cfg.get('LastModified')}

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(one, lambda_names()))


def fetch_table(name, key):
    ddb = client('dynamodb')
    table = ddb.describe_table(TableName=name)['Table']
    ttl = ddb.describe_time_to_live(TableName=name).get('TimeToLiveDescription', {}).get('TimeToLiveStatus')
    started = time.perf_counter()
    ddb.get_item(TableName=name, Key=key)          # a real read, to time it
    read_ms = round((time.perf_counter() - started) * 1000)
    stream = table.get('StreamSpecification') or {}
    return {'status': table.get('TableStatus'), 'items': table.get('ItemCount'), 'size': table.get('TableSizeBytes'),
            'ttl': ttl, 'stream': bool(stream.get('StreamEnabled')), 'read_ms': read_ms}


def fetch_bucket():
    s3, bucket = client('s3'), storage.bucket()
    started = time.perf_counter()
    s3.head_bucket(Bucket=bucket)
    info = {'read_ms': round((time.perf_counter() - started) * 1000), 'encryption': None, 'public_blocked': None}
    try:
        rules = s3.get_bucket_encryption(Bucket=bucket)['ServerSideEncryptionConfiguration']['Rules']
        info['encryption'] = rules[0]['ApplyServerSideEncryptionByDefault']['SSEAlgorithm']
    except ClientError as error:
        if 'NotFound' not in error.response.get('Error', {}).get('Code', ''):
            raise
    try:
        block = s3.get_public_access_block(Bucket=bucket)['PublicAccessBlockConfiguration']
        info['public_blocked'] = all(block.get(k) for k in ('BlockPublicAcls', 'IgnorePublicAcls',
                                                            'BlockPublicPolicy', 'RestrictPublicBuckets'))
    except ClientError as error:
        if 'NoSuchPublicAccessBlock' not in error.response.get('Error', {}).get('Code', ''):
            raise
        info['public_blocked'] = False
    return info


def fetch_email():
    sender = os.getenv('SENDER_EMAIL')
    if not sender:
        return None
    ses = client('ses')
    info = {'sender': sender}
    try:
        identity = client('sesv2').get_email_identity(EmailIdentity=sender)
        info['verified'] = bool(identity.get('VerifiedForSendingStatus')) \
            or identity.get('VerificationStatus') == 'SUCCESS'
    except Exception:  # pylint: disable=broad-except
        attrs = ses.get_identity_verification_attributes(Identities=[sender]).get('VerificationAttributes', {})
        info['verified'] = attrs.get(sender, {}).get('VerificationStatus') == 'Success'
    quota = ses.get_send_quota()
    info.update(max_24h=quota.get('Max24HourSend'), sent_24h=quota.get('SentLast24Hours'),
                rate=quota.get('MaxSendRate'))
    try:
        account = client('sesv2').get_account()
        info.update(production=bool(account.get('ProductionAccessEnabled')),
                    sending=bool(account.get('SendingEnabled', True)))
    except Exception:  # pylint: disable=broad-except
        # no GetAccount here: a 200-a-day quota is what the sandbox gives
        info.update(production=(info['max_24h'] or 0) > 200, sending=True)
    return info


def fetch_encryption():
    mode, alias_prefix = os.getenv('KMS_MODE', 's3'), os.getenv('KMS_ALIAS_PREFIX', 'enclave')
    if mode == 's3':
        return {'mode': mode}
    kms = client('kms')
    if mode == 'shared':
        key = kms.describe_key(KeyId='alias/{0}-files'.format(alias_prefix))['KeyMetadata']
        rotation = kms.get_key_rotation_status(KeyId=key['KeyId']).get('KeyRotationEnabled')
        return {'mode': mode, 'state': key.get('KeyState'), 'rotation': rotation}
    wanted = 'alias/{0}/user/'.format(alias_prefix)
    count = 0
    for page in kms.get_paginator('list_aliases').paginate():
        count += sum(1 for a in page.get('Aliases', []) if a.get('AliasName', '').startswith(wanted))
    return {'mode': mode, 'keys': count}


def fetch_cleanup():
    mappings = client('lambda').list_event_source_mappings(
        FunctionName=os.environ['CLEANUP_FUNCTION']).get('EventSourceMappings', [])
    if not mappings:
        return None
    m = mappings[0]
    return {'state': m.get('State'), 'result': m.get('LastProcessingResult'), 'modified': ms(m.get('LastModified'))}


def fetch_alarms():
    alarms = []
    for page in client('cloudwatch').get_paginator('describe_alarms').paginate(
            AlarmNamePrefix=prefix(), AlarmTypes=['MetricAlarm']):
        for a in page.get('MetricAlarms', []):
            alarms.append({'name': a['AlarmName'], 'state': a.get('StateValue'),
                           'description': a.get('AlarmDescription'), 'reason': a.get('StateReason'),
                           'updated_at': ms(a.get('StateUpdatedTimestamp'))})
    return sorted(alarms, key=lambda a: ({'ALARM': 0, 'INSUFFICIENT_DATA': 1}.get(a['state'], 2), a['name']))


def fetch_metrics(start, end, period):
    '''One GetMetricData call: API series for the chart, totals for the whole
       range (period = the range), per-function totals, and S3 storage.'''
    seconds = int((end - start).total_seconds())
    queries = []

    def metric(qid, namespace, name, dims, stat, query_period):
        queries.append({'Id': qid, 'ReturnData': True, 'MetricStat': {
            'Metric': {'Namespace': namespace, 'MetricName': name,
                       'Dimensions': [{'Name': k, 'Value': v} for k, v in dims.items()]},
            'Period': query_period, 'Stat': stat}})

    api = {'ApiName': os.environ['API_NAME'], 'Stage': os.getenv('API_STAGE', '')}
    for qid, name, stat in (('count', 'Count', 'Sum'), ('e4', '4XXError', 'Sum'), ('e5', '5XXError', 'Sum'),
                            ('lat', 'Latency', 'Average'), ('p90', 'Latency', 'p90')):
        metric('s_' + qid, 'AWS/ApiGateway', name, api, stat, period)
    for qid, name, stat in (('count', 'Count', 'Sum'), ('lat', 'Latency', 'Average'),
                            ('p90', 'Latency', 'p90'), ('p99', 'Latency', 'p99')):
        metric('t_' + qid, 'AWS/ApiGateway', name, api, stat, seconds)
    for i, fn in enumerate(lambda_names()):
        dims = {'FunctionName': fn}
        for qid, name, stat in (('inv', 'Invocations', 'Sum'), ('err', 'Errors', 'Sum'), ('thr', 'Throttles', 'Sum'),
                                ('dur', 'Duration', 'Average'), ('p90', 'Duration', 'p90'),
                                ('conc', 'ConcurrentExecutions', 'Maximum')):
            metric('f{0}_{1}'.format(i, qid), 'AWS/Lambda', name, dims, stat, seconds)
    for qid, storage_type, name in (('s3_size', 'StandardStorage', 'BucketSizeBytes'),
                                    ('s3_objects', 'AllStorageTypes', 'NumberOfObjects')):
        metric(qid, 'AWS/S3', name, {'BucketName': storage.bucket(), 'StorageType': storage_type}, 'Average', 86400)

    cloudwatch = client('cloudwatch')
    series = {}

    def run(batch, batch_start):
        kwargs = {'MetricDataQueries': batch, 'StartTime': batch_start, 'EndTime': end}
        while True:
            page = cloudwatch.get_metric_data(**kwargs)
            for result in page.get('MetricDataResults', []):
                points = series.setdefault(result['Id'], {})
                for stamp, value in zip(result.get('Timestamps', []), result.get('Values', []), strict=True):
                    points[ms(stamp)] = value
            if not page.get('NextToken'):
                return
            kwargs['NextToken'] = page['NextToken']

    regular = [q for q in queries if not q['Id'].startswith('s3_')]
    for chunk in range(0, len(regular), 500):
        run(regular[chunk:chunk + 500], start)
    # S3 storage metrics are daily: look back a few days for the latest one
    run([q for q in queries if q['Id'].startswith('s3_')], end - datetime.timedelta(days=3))
    return series


def fetch_errors(start):
    """The most recent errors in every function's log group."""
    logs = client('logs')
    since = ms(start)

    def one(name):
        group = '/aws/lambda/' + name
        found, kwargs = [], {'logGroupName': group, 'startTime': since,
                             'filterPattern': '?ERROR ?Error ?Exception ?"Task timed out"', 'limit': 100}
        try:
            for _ in range(LOG_PAGES):
                page = logs.filter_log_events(**kwargs)
                for event in page.get('events', []):
                    message = event.get('message', '').strip()
                    if REJECTION.search(message):
                        continue      # a turned-away sign-in, not a fault
                    if ERROR_LINE.search(message) and not NOISE.match(message):
                        found.append({'function': short_name(name), 'group': group,
                                      'stream': event.get('logStreamName'), 'at': event.get('timestamp'),
                                      'message': message})
                if not page.get('nextToken'):
                    break
                kwargs['nextToken'] = page['nextToken']
        except ClientError as error:
            if error.response.get('Error', {}).get('Code') != 'ResourceNotFoundException':
                raise
        return found

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        events = [e for group in pool.map(one, lambda_names()) for e in group]

    # One error usually spans a few lines a moment apart ("ERROR - unhandled
    # error", then the traceback, then "KeyError: 'x'"): join those.
    events.sort(key=lambda e: (e['function'], e['stream'] or '', e['at']))
    merged = []
    for event in events:
        text = tidy(event['message'])
        last = merged[-1] if merged else None
        same_stream = last and last['function'] == event['function'] and last['stream'] == event['stream']
        if same_stream and event['at'] - last['_last'] <= 2000:
            last['message'] = (last['message'] + ' · ' + text)[:600]
            last['_last'] = event['at']
        else:
            merged.append(dict(event, message=text[:600], _last=event['at']))
    merged.sort(key=lambda e: e['at'], reverse=True)
    newest = merged[:ERRORS_SHOWN]

    def add_cause(entry):
        """The filter only finds the "ERROR" line; the exception that caused
           it ("KeyError: 'x'") is a line or two later in the same stream."""
        if HAS_CAUSE.search(entry['message']) or not entry['stream']:
            return
        try:
            page = logs.get_log_events(logGroupName=entry['group'], logStreamName=entry['stream'],
                                       startTime=entry['at'], endTime=entry['at'] + 3000, startFromHead=True, limit=60)
        except ClientError:
            return
        lines = [e.get('message', '').strip() for e in page.get('events', [])]
        cause = next((line for line in reversed(lines) if CAUSE_LINE.match(line)), None)
        if cause:
            entry['message'] = (entry['message'] + ' · ' + cause)[:600]

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(add_cause, newest[:CAUSES_LOOKED_UP]))
    return [{'function': e['function'], 'at': e['at'], 'message': e['message']} for e in newest]


# --- turning fetched data into checks ------------------------------------------
def api_check(stage):
    return OK, 'Stage “{0}” is deployed and serving requests.'.format(stage['name']), [
        ('Last deployed', stage['updated']),
        ('Rate limit', '{0:g} requests/s, bursts of {1}'.format(stage['rate'], stage['burst'])
         if stage['rate'] else None),
    ]


def functions_check(functions):
    failed = [f for f in functions if f['state'] in ('Failed', 'Missing') or f.get('update') == 'Failed']
    pending = [f for f in functions if f['state'] == 'Pending' or f.get('update') == 'InProgress']
    details = [('Functions', len(functions)),
               ('Runtime', ', '.join(sorted({f['runtime'] for f in functions if f.get('runtime')})) or None)]
    if failed:
        names = ', '.join(short_name(f['name']) for f in failed)
        return FAIL, '{0} {1} not working: {2}.'.format(len(failed), 'function is' if len(failed) == 1
                                                        else 'functions are', names), details
    if pending:
        return WARN, 'Updating: ' + ', '.join(short_name(f['name']) for f in pending) + '.', details
    return OK, 'All {0} functions are ready.'.format(len(functions)), details


def table_check(info, needs_stream, purpose):
    details = [('Status', info['status'].title() if info['status'] else None),
               ('Items', None if info['items'] is None else '{0:,} (updated every few hours)'.format(info['items'])),
               ('Size', human_bytes(info['size'])),
               ('Expiring records (TTL)', (info['ttl'] or 'unknown').title()),
               ('Change stream', 'On' if info['stream'] else 'Off'),
               ('Read time', '{0} ms'.format(info['read_ms']))]
    if info['status'] != 'ACTIVE':
        return (WARN if info['status'] == 'UPDATING' else FAIL), 'The table is {0}.'.format(
            (info['status'] or 'unavailable').lower()), details
    if purpose == 'files' and info['ttl'] != 'ENABLED':
        return WARN, 'TTL is off: unfinished uploads and expired links are never removed.', details
    if needs_stream and not info['stream']:
        return WARN, 'The change stream is off: abandoned uploads won’t be cleaned out of S3.', details
    return OK, 'Active, answered a read in {0} ms.'.format(info['read_ms']), details


def storage_check(info, storage_stats, strict):
    algorithm = {'AES256': 'SSE-S3 (AES-256)', 'aws:kms': 'SSE-KMS', 'aws:kms:dsse': 'DSSE-KMS'}
    details = [('Bucket', storage.bucket()),
               ('Default encryption', algorithm.get(info['encryption'], info['encryption'] or 'None')),
               ('Public access', 'Blocked' if info['public_blocked'] else 'Not fully blocked'),
               ('Read time', '{0} ms'.format(info['read_ms']))]
    if storage_stats:
        details.insert(1, ('Stored', storage_stats))
    if strict and not info['public_blocked']:
        return FAIL, 'Public access isn’t fully blocked on the files bucket.', details
    if strict and not info['encryption']:
        return WARN, 'The bucket has no default encryption.', details
    return OK, 'Reachable in {0} ms, private{1}.'.format(
        info['read_ms'], ' and encrypted' if info['encryption'] else ''), details


def email_check(info, online=True):
    if info is None:
        return UNKNOWN, 'No sender email is set for this function.', []
    if not online:
        return OK, 'Emails are captured by LocalStack, not sent (open /_aws/ses to read them).', [
            ('Sender', info['sender']), ('Verified', 'Yes' if info['verified'] else 'No')]
    used = '{0:,.0f} of {1:,.0f}'.format(info['sent_24h'] or 0, info['max_24h'] or 0)
    details = [('Sender', info['sender']), ('Verified', 'Yes' if info['verified'] else 'No'),
               ('Mode', 'Production' if info['production'] else 'Sandbox (only verified recipients)'),
               ('Sent in the last 24 hours', used),
               ('Max send rate', '{0:g} per second'.format(info['rate']) if info.get('rate') else None)]
    if not info['verified']:
        return FAIL, 'The sender address isn’t verified, so share emails can’t be sent.', details
    if not info['sending']:
        return FAIL, 'Sending is paused for this AWS account.', details
    if info['max_24h'] and (info['sent_24h'] or 0) >= 0.8 * info['max_24h']:
        return WARN, 'Close to the daily sending limit ({0}).'.format(used), details
    if not info['production']:
        return WARN, 'In the SES sandbox: share emails only reach verified addresses.', details
    return OK, 'Verified sender, production access.', details


def encryption_check(info):
    if info['mode'] == 's3':
        return OK, 'Files are encrypted with Amazon S3 managed keys (SSE-S3).', [('Mode', 'SSE-S3')]
    if info['mode'] == 'shared':
        details = [('Mode', 'One KMS key for the app'), ('Key state', info['state']),
                   ('Automatic rotation', 'On' if info['rotation'] else 'Off')]
        if info['state'] != 'Enabled':
            return FAIL, 'The app’s KMS key is {0}: files can’t be read or written.'.format(info['state']), details
        return OK, 'The app’s KMS key is enabled.', details
    return OK, '{0} user {1} so far.'.format(info['keys'], 'key' if info['keys'] == 1 else 'keys'), [
        ('Mode', 'One KMS key per user'), ('Keys', info['keys'])]


def cleanup_check(info):
    if info is None:
        return FAIL, 'Not connected to the table’s stream: abandoned uploads aren’t cleaned up.', []
    details = [('Trigger', info['state']), ('Last run', info['result']), ('Changed', info['modified'])]
    if info['state'] not in ('Enabled', 'Enabling', 'Updating'):
        return FAIL, 'The trigger is {0}: abandoned uploads aren’t cleaned up.'.format(
            (info['state'] or 'off').lower()), details
    if (info['result'] or '').startswith('PROBLEM'):
        return WARN, info['result'], details
    return OK, 'Removing abandoned uploads from S3.', details


def alarms_check(alarms):
    firing = [a for a in alarms if a['state'] == 'ALARM']
    details = [('Alarms', len(alarms)), ('Going off', len(firing))]
    if firing:
        return FAIL, 'Going off: ' + ', '.join(short_name(a['name']) for a in firing) + '.', details
    return OK, 'None of the {0} alarms are going off.'.format(len(alarms)), details


# --- putting it together --------------------------------------------------------
def total(series, qid):
    return sum(series.get(qid, {}).values())


def single(series, qid, combine=max):
    values = list(series.get(qid, {}).values())
    return combine(values) if values else None


def weighted(series, avg_id, weight_id):
    '''A range-wide average from per-period averages and their counts.'''
    avgs, weights = series.get(avg_id, {}), series.get(weight_id, {})
    weight = sum(weights.get(t, 0) for t in avgs)
    if not avgs:
        return None
    if not weight:
        return sum(avgs.values()) / len(avgs)
    return sum(v * weights.get(t, 0) for t, v in avgs.items()) / weight


def latest(series, qid):
    points = series.get(qid, {})
    return (max(points), points[max(points)]) if points else None


def health(range_key):
    if range_key not in RANGES:
        raise ValueError('range must be one of ' + ', '.join(RANGES))
    seconds, period = RANGES[range_key]
    now = datetime.datetime.now(datetime.timezone.utc)
    end = now.replace(second=0, microsecond=0) + datetime.timedelta(minutes=1)
    start = end - datetime.timedelta(seconds=seconds)
    online = not offline()

    tasks = {
        'files_table': lambda: fetch_table(os.environ['FILE_SHARING_TABLE'], {'file_id': {'S': '__health__'}}),
        'users_table': lambda: fetch_table(os.environ['USERS_TABLE'], {'email': {'S': '__health__@health.invalid'}}),
        'storage': fetch_bucket,
        'email': fetch_email,
        'encryption': fetch_encryption,
    }
    if online:
        tasks.update(api=fetch_stage, functions=fetch_functions, cleanup=fetch_cleanup, alarms=fetch_alarms,
                     metrics=lambda: fetch_metrics(start, end, period), errors=lambda: fetch_errors(start))
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        futures = {key: pool.submit(Outcome, fn) for key, fn in tasks.items()}
        got = {key: future.result() for key, future in futures.items()}

    series = got['metrics'].value if online and got['metrics'].error is None else None
    storage_stats = None
    if series:
        size, objects = latest(series, 's3_size'), latest(series, 's3_objects')
        if size or objects:
            storage_stats = '{0} in {1:,.0f} objects'.format(human_bytes(size[1] if size else 0),
                                                              objects[1] if objects else 0)

    checks = [
        check('api', 'API', got.get('api'), api_check),
        check('functions', 'Lambda functions', got.get('functions'), functions_check),
        check('files_table', 'Files table', got['files_table'], lambda v: table_check(v, online, 'files')),
        check('users_table', 'Users table', got['users_table'], lambda v: table_check(v, False, 'users')),
        check('storage', 'File storage (S3)', got['storage'], lambda v: storage_check(v, storage_stats, online)),
        check('email', 'Email (SES)', got['email'], lambda v: email_check(v, online)),
        check('encryption', 'Encryption', got['encryption'], encryption_check),
        check('cleanup', 'Upload cleanup', got.get('cleanup'), cleanup_check),
        check('alarms', 'Alarms', got.get('alarms'), alarms_check),
    ]
    if not online:
        for c in checks:
            if c['id'] == 'cleanup':
                c['summary'] = 'Runs on AWS only (it reads the table’s change stream).'

    api, functions = None, []
    if series is not None:
        requests = total(series, 's_count')
        e5 = total(series, 's_e5')
        api = {
            'requests': int(requests), 'errors_4xx': int(total(series, 's_e4')), 'errors_5xx': int(e5),
            'latency_avg': weighted(series, 's_lat', 's_count'),
            'latency_p90': single(series, 't_p90'), 'latency_p99': single(series, 't_p99'),
            'period': period,
            'series': [{'t': int((start + datetime.timedelta(seconds=period * i)).timestamp() * 1000)}
                       for i in range(seconds // period)],
        }
        for point in api['series']:
            for key, qid in (('requests', 's_count'), ('errors_4xx', 's_e4'), ('errors_5xx', 's_e5'),
                             ('latency_p90', 's_p90')):
                point[key] = series.get(qid, {}).get(point['t'], 0)
        if requests and e5 / requests >= SERVER_ERROR_WARN:
            api_entry = checks[0]
            if api_entry['status'] == OK:
                api_entry.update(status=WARN, summary='{0:.1%} of requests failed with a server error.'.format(
                    e5 / requests))
    configs = {f['name']: f for f in (got['functions'].value or [])} if online and got['functions'].value else {}
    for i, name in enumerate(lambda_names()):
        row = dict(configs.get(name, {}), name=name, short=short_name(name))
        if series is not None:
            row.update(invocations=int(total(series, 'f{0}_inv'.format(i))),
                       errors=int(total(series, 'f{0}_err'.format(i))),
                       throttles=int(total(series, 'f{0}_thr'.format(i))),
                       duration_avg=weighted(series, 'f{0}_dur'.format(i), 'f{0}_inv'.format(i)),
                       duration_p90=single(series, 'f{0}_p90'.format(i)),
                       concurrency=single(series, 'f{0}_conc'.format(i)))
        if row['short'] == AUTHORIZER and row.get('errors') is not None:
            row['rejected'], row['errors'] = row['errors'], 0
        functions.append(row)
    if series is not None:
        erroring = [f['short'] for f in functions if f.get('errors') or f.get('throttles')]
        fn_check = checks[1]
        if erroring and fn_check['status'] == OK:
            fn_check.update(status=WARN, summary='Errors or throttling in the last {0}: {1}.'.format(
                {'1h': 'hour', '24h': '24 hours', '7d': '7 days'}[range_key], ', '.join(erroring)))

    known = [c['status'] for c in checks if c['status'] != UNKNOWN]
    overall = max(known, key=RANK.get) if known else UNKNOWN
    return {
        'status': overall,
        'checked_at': int(time.time() * 1000),
        'range': range_key,
        'offline': not online,
        'checks': checks,
        'alarms': got['alarms'].value if online and got['alarms'].error is None else None,
        'api': api,
        'functions': functions,
        'errors': got['errors'].value if online and got['errors'].error is None else None,
        'metrics_error': reason(got['metrics'].error) if online and got['metrics'].error else None,
        'errors_error': reason(got['errors'].error) if online and got['errors'].error else None,
    }
