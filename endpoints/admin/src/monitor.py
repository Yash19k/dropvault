'''Email alerts for the deployed app: errors in the logs, and a health check
every few minutes.

One Lambda (terraform/monitoring.tf), several ways in:

  CloudWatch Logs  Each function's log group sends its error lines here (a
                   subscription filter), so an error is emailed within a
                   minute. That includes errors the code caught and answered
                   with a 500, which Lambda's own Errors metric (and so its
                   alarm) never counts.
  EventBridge      Every HEALTH_CHECK_MINUTES: the Health page's checks
                   (health.py) plus requests from outside to the website, the
                   API and a public link. Emails when something breaks and
                   again when it recovers.
  deploy.sh        {"source": "deploy"}: the same health check, right after a
                   deploy; the result is printed.
  by hand          {"action": "test"}: sends a test email.

Emails go out through the alerts SNS topic, which the CloudWatch alarms use
too. So that a broken deploy can't send hundreds of emails, each function's
errors are emailed at most once per ALERT_COOLDOWN_MINUTES (the next email
says how many were held back), and a warning has to show up in two health
checks in a row before it is emailed (a failure is emailed at once). What was
emailed is kept in a small DynamoDB table (MONITOR_TABLE).
'''

import base64
import datetime
import gzip
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

import boto3
from botocore.exceptions import ClientError

import health
import log
import storage

LOGGER = log.setup_logging()

OK, WARN, FAIL, UNKNOWN = health.OK, health.WARN, health.FAIL, health.UNKNOWN
LABEL = {FAIL: 'FAILING', WARN: 'WARNING', UNKNOWN: "CAN'T CHECK", OK: 'OK'}
INCIDENTS_SHOWN = 5
PROBE_TIMEOUT = 10            # seconds per request
PROBE_TRIES = 2               # a request that gets no answer is tried once more
PROBE_CODE = 'health-check-probe'   # a well-formed short-link code that doesn't exist
KEEP_STATE_SECONDS = 30 * 86400
# The runtime's own faults too: out of memory, a crash at start-up.
FAULT = re.compile(health.ERROR_LINE.pattern + r'|Runtime exited', re.MULTILINE)
BOTO_PREAMBLE = re.compile(r'An error occurred \(\w+\) when calling the \w+ operation: ')
MODULE_PATH = re.compile(r'^(?:[A-Za-z_]\w*\.)+(?=[A-Za-z_]\w*:)')
LOG_LEVEL = re.compile(r'^(?:\[ERROR\]\s*|\w+ - ERROR - )')


def lambda_handler(event, context):
    event = event if isinstance(event, dict) else {}
    if 'awslogs' in event:
        return log_alert(event)
    if event.get('action') == 'test':
        return {'emailed': send('{0}: test alert'.format(app_name()), test_email())}
    return watchdog()


# --- settings ---------------------------------------------------------------------
def app_name():
    return os.getenv('APP_NAME') or 'DropVault'


def cooldown_seconds():
    return int(os.getenv('ALERT_COOLDOWN_MINUTES') or 15) * 60


def check_minutes():
    return int(os.getenv('HEALTH_CHECK_MINUTES') or 0)


def health_page():
    web = (os.getenv('WEB_URL') or '').rstrip('/')
    return web + '/admin/health' if web else None


def utc_offset():
    '''ALERT_UTC_OFFSET ("+05:30") as (timedelta, label); UTC when unset.'''
    match = re.fullmatch(r'([+-])(\d\d):(\d\d)', (os.getenv('ALERT_UTC_OFFSET') or '').strip())
    if not match:
        return datetime.timedelta(0), 'UTC'
    delta = datetime.timedelta(hours=int(match.group(2)), minutes=int(match.group(3)))
    delta = -delta if match.group(1) == '-' else delta
    return delta, 'UTC' if not delta else 'UTC' + match.group(0)


def when(at_ms):
    delta, label = utc_offset()
    moment = datetime.datetime.fromtimestamp(at_ms / 1000, datetime.timezone(delta))
    return moment.strftime('%d %b %Y, %H:%M:%S ') + label


# --- sending ----------------------------------------------------------------------
def subject_line(text):
    '''SNS email subjects must be ASCII, one line and under 100 characters.'''
    for fancy, plain in (('·', '-'), ('’', "'"), ('‘', "'"), ('“', '"'), ('”', '"'), ('…', '...')):
        text = text.replace(fancy, plain)
    text = ' '.join(''.join(c if 32 <= ord(c) < 127 else ' ' for c in text).split())
    return text if len(text) < 100 else text[:96].rstrip() + '...'


def send(subject, body):
    topic = os.getenv('ALERTS_TOPIC_ARN')
    if not topic:
        LOGGER.warning('no ALERTS_TOPIC_ARN, not sent: %s', subject)
        return False
    boto3.client('sns', region_name=storage.region()).publish(
        TopicArn=topic, Subject=subject_line(subject), Message=body)
    LOGGER.info('alert sent: %s', subject)
    return True


def footer(lines):
    page = health_page()
    if page:
        lines.append('Health page:  ' + page)
    return '\n'.join(lines) + '\n'


def test_email():
    return footer(['This is a test from the {0} monitor: alert emails reach you.'.format(app_name()), '',
                   'You will get an email when a function logs an error, when the health check every {0} '
                   'minutes finds a problem (and when it is fixed), and when a CloudWatch alarm goes off.'
                   .format(check_minutes() or '?'), ''])


def state_table():
    return boto3.resource('dynamodb', region_name=storage.region()).Table(os.environ['MONITOR_TABLE'])


# --- errors in the logs -------------------------------------------------------------
def decode(event):
    '''CloudWatch Logs hands a subscription its events gzipped and base64-encoded.'''
    return json.loads(gzip.decompress(base64.b64decode(event['awslogs']['data'])))


def incidents_in(batch):
    '''The fault lines in a batch of log events, joined into incidents (one error
       is often a few lines a moment apart), oldest first.'''
    incidents = []
    for event in sorted(batch.get('logEvents') or [], key=lambda e: e.get('timestamp', 0)):
        message = (event.get('message') or '').strip()
        if not message or health.REJECTION.search(message) or health.NOISE.match(message):
            continue          # a turned-away sign-in, or a bare traceback line
        if not FAULT.search(message):
            continue
        at, text = event.get('timestamp', 0), health.tidy(message)
        last = incidents[-1] if incidents else None
        if last and at - last['last'] <= 2000:
            last['message'] = (last['message'] + ' · ' + text)[:600]
            last['last'] = at
        else:
            incidents.append({'at': at, 'last': at, 'message': text[:600]})
    return incidents


def headline(message):
    '''The most telling part of an error for a subject line: its cause, without
       the log prefix, module path or boto3's preamble.'''
    part = message.split(' · ')[-1]
    part = MODULE_PATH.sub('', LOG_LEVEL.sub('', part.strip()))
    return BOTO_PREAMBLE.sub('', part)


def console_link(group, stream, at_ms):
    '''The log stream in the CloudWatch console, starting a minute before the error.'''
    def enc(value):           # the console double-encodes, then writes % as $
        return urllib.parse.quote(urllib.parse.quote(value, safe=''), safe='').replace('%', '$')
    region = storage.region()
    return ('https://{0}.console.aws.amazon.com/cloudwatch/home?region={0}#logsV2:log-groups/log-group/{1}'
            '/log-events/{2}$3Fstart$3D{3}').format(region, enc(group), enc(stream), at_ms - 60000)


def claim(key, count):
    '''May this alert be emailed now (nothing sent for `key` within the
       cooldown)? Returns (send, held_back): when not, the `count` errors are
       added to those held back, which the next email reports.'''
    now, table = int(time.time()), state_table()
    try:
        old = table.update_item(
            Key={'id': key},
            UpdateExpression='SET sent_at = :now, held = :zero, expires_at = :expires',
            ConditionExpression='attribute_not_exists(sent_at) OR sent_at <= :cutoff',
            ExpressionAttributeValues={':now': now, ':zero': 0, ':cutoff': now - cooldown_seconds(),
                                       ':expires': now + KEEP_STATE_SECONDS},
            ReturnValues='ALL_OLD').get('Attributes') or {}
        return True, int(old.get('held') or 0)
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
            raise
    table.update_item(Key={'id': key}, UpdateExpression='ADD held :n', ExpressionAttributeValues={':n': count})
    return False, 0


def log_alert(event):
    batch = decode(event)
    if batch.get('messageType') != 'DATA_MESSAGE':
        return {'emailed': False, 'errors': 0}
    group, stream = batch.get('logGroup', ''), batch.get('logStream', '')
    incidents = incidents_in(batch)
    if not incidents:
        return {'emailed': False, 'errors': 0}
    function = health.short_name(group.rsplit('/', 1)[-1])
    allowed, held = claim('log#' + function, len(incidents))
    if not allowed:
        LOGGER.info('%d error(s) in %s held back (cooldown)', len(incidents), function)
        return {'emailed': False, 'errors': len(incidents), 'held_back': True}

    logs = health.client('logs')
    shown = incidents[:INCIDENTS_SHOWN]
    for incident in shown:
        cause = health.find_cause(logs, group, stream, incident['at'], incident['message'])
        if cause:
            incident['message'] = (incident['message'] + ' · ' + cause)[:600]

    count = len(incidents)
    lines = ['The "{0}" function of {1} logged {2}.'.format(
        function, app_name(), 'an error' if count == 1 else '{0} errors'.format(count)), '']
    for incident in shown:
        lines += [when(incident['at']), '  ' + incident['message'], '']
    if count > len(shown):
        lines += ['...and {0} more in the same minute.'.format(count - len(shown)), '']
    if held:
        lines += ['{0} more {1} from this function {2} held back since the last email.'.format(
            held, 'error' if held == 1 else 'errors', 'was' if held == 1 else 'were'), '']
    lines.append('Logs:         ' + console_link(group, stream, incidents[0]['at']))
    body = footer(lines) + '\nYou get at most one email per function every {0} minutes.\n'.format(
        cooldown_seconds() // 60)
    subject = '{0}: error in {1} - {2}'.format(app_name(), function, headline(shown[0]['message']))
    return {'emailed': send(subject, body), 'errors': count}


# --- the scheduled health check ---------------------------------------------------
def probe(url, expected, what):
    '''Request `url` from outside, as a visitor would. `expected(status)` says
       whether the answer is right; `what` describes it for the summary.'''
    problem = None
    for attempt in range(PROBE_TRIES):
        if attempt:
            time.sleep(2)
        started = time.perf_counter()
        request = urllib.request.Request(url, headers={'User-Agent': 'health-check'})
        try:
            with urllib.request.urlopen(request, timeout=PROBE_TIMEOUT) as response:
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
        except Exception as error:  # pylint: disable=broad-except
            problem = 'No answer: {0}.'.format(getattr(error, 'reason', None) or error)
            continue
        took = round((time.perf_counter() - started) * 1000)
        details = [('URL', url), ('Answer', '{0} in {1} ms'.format(status, took))]
        if expected(status):
            return OK, 'Answered in {0} ms.'.format(took), details
        problem = 'Answered {0} instead of {1}.'.format(status, what)
        if status < 500:
            break             # a wrong answer won't change on a retry
    return FAIL, problem, [('URL', url)]


def probe_tasks():
    tasks = {}
    web, api_url = os.getenv('WEB_URL'), (os.getenv('API_URL') or '').rstrip('/')
    if web:
        tasks['website'] = lambda: probe(web, lambda s: 200 <= s < 400, 'the page')
    if api_url:
        # A signed-in route without a token: API Gateway itself says 401.
        tasks['api_probe'] = lambda: probe(api_url + '/v1/users/health-check/files', lambda s: s == 401, '401')
        # A link that doesn't exist: the links Lambda looks it up in DynamoDB, says 404.
        tasks['links'] = lambda: probe(api_url + '/v1/d/' + PROBE_CODE, lambda s: s == 404, '404')
    return tasks


PROBES = (('website', 'Website'), ('api_probe', 'API from outside'), ('links', 'Download links'))


def run_checks():
    tasks = health.check_tasks(online=True)
    tasks.pop('alarms')       # alarms email by themselves
    tasks.update(probe_tasks())
    got = health.run_tasks(tasks)
    checks = [c for c in health.build_checks(got, online=True) if c['id'] != 'alarms']
    checks += [health.check(key, name, got[key], lambda v: v) for key, name in PROBES if key in got]
    return checks


def watchdog():
    checks = run_checks()
    now_ms = int(time.time() * 1000)
    names = {c['id']: c['name'] for c in checks}
    problems = {c['id']: c for c in checks if c['status'] != OK}

    table = state_table()
    state = table.get_item(Key={'id': 'health'}).get('Item') or {}
    seen, emailed_before = state.get('seen') or {}, state.get('open') or {}
    # A failure counts at once; a warning (or a check that couldn't run) once it shows up twice in a row.
    confirmed = {key: c for key, c in problems.items()
                 if c['status'] == FAIL or key in seen or key in emailed_before}
    new = [c for key, c in confirmed.items()
           if key not in emailed_before or health.RANK[c['status']] > health.RANK.get(emailed_before[key], 0)]
    fixed = [key for key in emailed_before if key not in problems]
    still = [c for c in confirmed.values() if c not in new]

    emailed = False
    if new or fixed:
        emailed = send(*health_email(new, fixed, still, names, now_ms))
    table.put_item(Item={
        'id': 'health', 'checked_at': now_ms, 'expires_at': int(time.time()) + KEEP_STATE_SECONDS,
        'seen': {key: c['status'] for key, c in problems.items()},
        'open': {key: c['status'] for key, c in confirmed.items()},
    })
    known = [c['status'] for c in checks if c['status'] != UNKNOWN]
    return {
        'status': max(known, key=health.RANK.get) if known else UNKNOWN,
        'emailed': emailed,
        'checks': [{'id': c['id'], 'name': c['name'], 'status': c['status'], 'summary': c['summary']}
                   for c in checks],
    }


def health_email(new, fixed, still, names, now_ms):
    app = app_name()
    fixed_names = [names.get(key, key) for key in fixed]
    if new:
        verb = 'is having problems' if any(c['status'] == FAIL for c in new) else 'needs attention'
        subject = '{0} {1}: {2}'.format(app, verb, ', '.join(c['name'] for c in new))
        if fixed_names:
            subject += '; fixed: ' + ', '.join(fixed_names)
    elif still:
        subject = '{0}: {1} fixed, {2} still not right'.format(app, ', '.join(fixed_names), len(still))
    else:
        subject = '{0} is back to normal'.format(app)

    def rows(checks):
        return ['  {0:<12} {1}: {2}'.format(LABEL[c['status']], c['name'], c['summary']) for c in checks]

    lines = ['{0} health check, {1}'.format(app, when(now_ms)), '']
    if new:
        lines += ['New problems'] + rows(new) + ['']
    if fixed_names:
        lines += ['Back to normal'] + ['  ' + name for name in fixed_names] + ['']
    if still:
        lines += ['Still not right'] + rows(still) + ['']
    every = check_minutes()
    return subject, footer(lines) + '\n{0}You will get another email when this changes.\n'.format(
        'The check runs every {0} minutes. '.format(every) if every else '')
