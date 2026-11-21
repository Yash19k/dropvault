'''The monitor Lambda: emails for errors in the logs, the scheduled health
check, and the probes it makes from outside.'''

import base64
import gzip
import http.server
import json
import threading
import time

import boto3
import pytest

from conftest import load

GROUP = '/aws/lambda/enclave-dev-share'
STREAM = '2026/11/21/[$LATEST]0123456789abcdef'
CAUSE = ('botocore.errorfactory.MessageRejected: An error occurred (MessageRejected) when calling the '
         'SendEmail operation: Email address is not verified.')


@pytest.fixture
def mon(aws, monkeypatch):
    monkeypatch.setenv('MONITOR_TABLE', 'monitor-test')
    monkeypatch.setenv('ALARM_PREFIX', 'enclave-dev-')
    monkeypatch.setenv('APP_NAME', 'DropVault')
    monkeypatch.setenv('WEB_URL', 'https://app.example.com')
    monkeypatch.setenv('ALERT_UTC_OFFSET', '+05:30')
    monkeypatch.setenv('HEALTH_CHECK_MINUTES', '5')
    monkeypatch.setenv('ALERT_COOLDOWN_MINUTES', '15')
    boto3.client('dynamodb').create_table(
        TableName='monitor-test', BillingMode='PAY_PER_REQUEST',
        KeySchema=[{'AttributeName': 'id', 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': 'id', 'AttributeType': 'S'}])
    sns, sqs = boto3.client('sns'), boto3.client('sqs')
    topic = sns.create_topic(Name='alerts-test')['TopicArn']
    queue = sqs.create_queue(QueueName='alerts-inbox')['QueueUrl']
    queue_arn = sqs.get_queue_attributes(QueueUrl=queue, AttributeNames=['QueueArn'])['Attributes']['QueueArn']
    sns.subscribe(TopicArn=topic, Protocol='sqs', Endpoint=queue_arn)
    monkeypatch.setenv('ALERTS_TOPIC_ARN', topic)
    module = load('admin', 'monitor')
    module.inbox = queue
    return module


def emails(mon):
    '''Every alert published since the last call, as (subject, body).'''
    sqs, found = boto3.client('sqs'), []
    while True:
        got = sqs.receive_message(QueueUrl=mon.inbox, MaxNumberOfMessages=10).get('Messages', [])
        if not got:
            return found
        for message in got:
            envelope = json.loads(message['Body'])
            found.append((envelope.get('Subject'), envelope['Message']))
            sqs.delete_message(QueueUrl=mon.inbox, ReceiptHandle=message['ReceiptHandle'])


def logs_event(lines, group=GROUP, stream=STREAM, at=None, gap=1, kind='DATA_MESSAGE'):
    '''What a CloudWatch Logs subscription hands the Lambda (lines `gap` ms apart).'''
    at = at or int(time.time() * 1000)
    batch = {'messageType': kind, 'logGroup': group, 'logStream': stream,
             'logEvents': [{'id': str(i), 'timestamp': at + i * gap, 'message': line}
                           for i, line in enumerate(lines)]}
    return {'awslogs': {'data': base64.b64encode(gzip.compress(json.dumps(batch).encode())).decode()}}


def write_logs(lines, at):
    '''The same lines in the real log stream, where the monitor looks up causes.'''
    logs = boto3.client('logs')
    logs.create_log_group(logGroupName=GROUP)
    logs.create_log_stream(logGroupName=GROUP, logStreamName=STREAM)
    logs.put_log_events(logGroupName=GROUP, logStreamName=STREAM,
                        logEvents=[{'timestamp': at + i, 'message': line} for i, line in enumerate(lines)])


class Clock:
    '''Stands in for the time module inside monitor.py.'''

    def __init__(self):
        self.now = time.time()
        self.perf_counter = time.perf_counter

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


# --- errors in the logs ------------------------------------------------------------
def test_an_error_is_emailed_with_its_cause_and_a_link_to_the_logs(mon):
    at = int(time.time() * 1000)
    error = '2026-11-21 08:46:23,419 - handler - ERROR - unhandled error'
    write_logs([error, 'Traceback (most recent call last):', '  File "/var/task/share_file.py", line 9', CAUSE], at)

    # The subscription filter only passes on the ERROR line.
    result = mon.lambda_handler(logs_event([error], at=at), None)

    assert result == {'emailed': True, 'errors': 1}
    [(subject, body)] = emails(mon)
    assert subject == 'DropVault: error in share - MessageRejected: Email address is not verified.'
    assert 'The "share" function of DropVault logged an error.' in body
    assert 'handler - ERROR - unhandled error · ' + CAUSE in body
    assert 'UTC+05:30' in body
    assert ('#logsV2:log-groups/log-group/$252Faws$252Flambda$252Fenclave-dev-share/log-events/'
            '2026$252F11$252F21$252F$255B$2524LATEST$255D0123456789abcdef$3Fstart$3D') in body
    assert 'Health page:  https://app.example.com/admin/health' in body


def test_errors_are_held_back_during_the_cooldown_then_counted(mon, monkeypatch):
    clock = Clock()
    monkeypatch.setattr(mon, 'time', clock)
    line = '2026-11-21 08:46:23,419 - share_file - ERROR - ' + CAUSE

    assert mon.lambda_handler(logs_event([line]), None)['emailed'] is True
    clock.now += 60
    held = mon.lambda_handler(logs_event([line, line.replace('08:46:23', '08:47:30')], gap=60000), None)
    assert held == {'emailed': False, 'errors': 2, 'held_back': True}
    assert len(emails(mon)) == 1

    # Another function has its own cooldown.
    other = mon.lambda_handler(logs_event([line], group='/aws/lambda/enclave-dev-download'), None)
    assert other['emailed'] is True
    assert emails(mon)[0][0].startswith('DropVault: error in download - ')

    clock.now += 15 * 60
    assert mon.lambda_handler(logs_event([line]), None)['emailed'] is True
    [(_, body)] = emails(mon)
    assert '2 more errors from this function were held back since the last email.' in body


def test_lines_close_together_are_one_error_and_far_apart_are_two(mon):
    at = int(time.time() * 1000)
    batch = {'messageType': 'DATA_MESSAGE', 'logGroup': GROUP, 'logStream': STREAM, 'logEvents': [
        {'id': '1', 'timestamp': at, 'message': 'x - handler - ERROR - unhandled error'},
        {'id': '2', 'timestamp': at + 5, 'message': '[ERROR] KeyError: \'name\''},
        {'id': '3', 'timestamp': at + 9000, 'message': 'Task timed out after 30.03 seconds'},
    ]}
    incidents = mon.incidents_in(batch)
    assert [i['message'] for i in incidents] == [
        "x - handler - ERROR - unhandled error · [ERROR] KeyError: 'name'", 'Task timed out after 30.03 seconds']


def test_turned_away_sign_ins_and_control_messages_send_nothing(mon):
    rejection = '[ERROR] Exception: Unauthorized\rTraceback (most recent call last):\r  File "/var/task/x.py"'
    group = '/aws/lambda/enclave-dev-authorizer'
    assert mon.lambda_handler(logs_event([rejection], group=group), None) == {'emailed': False, 'errors': 0}
    assert mon.lambda_handler(logs_event([], kind='CONTROL_MESSAGE'), None) == {'emailed': False, 'errors': 0}
    assert emails(mon) == []
    assert 'Item' not in boto3.client('dynamodb').get_item(TableName='monitor-test',
                                                           Key={'id': {'S': 'log#authorizer'}})


def test_subject_lines_suit_sns(mon):
    subject = mon.subject_line('DropVault: error in share - “quoted” · ünïcode\nnext line ' + 'x' * 200)
    assert subject.isascii() and '\n' not in subject and len(subject) < 100
    assert subject.startswith('DropVault: error in share - "quoted" - n code next line')
    assert mon.headline('handler - ERROR - unhandled error · ' + CAUSE) == \
        'MessageRejected: Email address is not verified.'
    assert mon.headline('[ERROR] KeyError: \'name\'') == "KeyError: 'name'"


def test_a_test_email(mon):
    assert mon.lambda_handler({'action': 'test'}, None) == {'emailed': True}
    [(subject, body)] = emails(mon)
    assert subject == 'DropVault: test alert'
    assert 'every 5 minutes' in body


# --- the scheduled health check ------------------------------------------------------
def checks(**statuses):
    names = {'website': 'Website', 'email': 'Email (SES)', 'api': 'API'}
    return [{'id': key, 'name': names[key], 'status': status, 'summary': '{0} is {1}.'.format(key, status)}
            for key, status in statuses.items()]


def test_health_check_emails_failures_at_once_warnings_when_they_stay_and_recovery(mon, monkeypatch):
    now = {}
    monkeypatch.setattr(mon, 'run_checks', lambda: now['checks'])

    def run(**statuses):
        now['checks'] = checks(**statuses)
        result = mon.lambda_handler({'source': 'aws.events'}, None)
        return result, emails(mon)

    result, sent = run(api='ok', website='error', email='warning')
    assert result['status'] == 'error' and result['emailed'] is True
    [(subject, body)] = sent
    assert subject == 'DropVault is having problems: Website'
    assert 'New problems\n  FAILING      Website: website is error.' in body
    assert 'Email' not in body          # a warning waits for a second sighting

    _, sent = run(api='ok', website='error', email='warning')
    [(subject, body)] = sent
    assert subject == 'DropVault needs attention: Email (SES)'
    assert 'Still not right\n  FAILING      Website: website is error.' in body

    assert run(api='ok', website='error', email='warning')[1] == []        # nothing changed

    _, sent = run(api='ok', website='ok', email='warning')
    [(subject, body)] = sent
    assert subject == 'DropVault: Website fixed, 1 still not right'
    assert 'Back to normal\n  Website' in body

    _, sent = run(api='ok', website='ok', email='ok')
    [(subject, body)] = sent
    assert subject == 'DropVault is back to normal'
    assert 'The check runs every 5 minutes.' in body

    assert run(api='ok', website='ok', email='ok')[1] == []


def test_a_warning_seen_once_is_not_emailed(mon, monkeypatch):
    sequence = iter([checks(api='warning'), checks(api='ok'), checks(api='warning'), checks(api='ok')])
    monkeypatch.setattr(mon, 'run_checks', lambda: next(sequence))
    for _ in range(4):
        assert mon.lambda_handler({}, None)['emailed'] is False
    assert emails(mon) == []


def test_getting_worse_is_emailed_again(mon, monkeypatch):
    sequence = iter([checks(api='warning'), checks(api='warning'), checks(api='error')])
    monkeypatch.setattr(mon, 'run_checks', lambda: next(sequence))
    mon.lambda_handler({}, None)
    mon.lambda_handler({}, None)
    mon.lambda_handler({}, None)
    assert [s for s, _ in emails(mon)] == ['DropVault needs attention: API', 'DropVault is having problems: API']


# --- probes from outside ---------------------------------------------------------------
@pytest.fixture
def site():
    '''A local web server: /ok -> 200, /missing -> 404, /broken -> 500.'''
    hits = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            hits.append(self.path)
            status = {'/ok': 200, '/missing': 404, '/broken': 500}.get(self.path.split('?')[0], 404)
            self.send_response(status)
            self.end_headers()
            self.wfile.write(b'hi')

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield 'http://127.0.0.1:{0}'.format(server.server_address[1]), hits
    server.shutdown()


def test_probes(mon, site, monkeypatch):
    base, hits = site
    monkeypatch.setattr(mon, 'time', Clock())     # no real sleep between tries
    assert mon.probe(base + '/ok', lambda s: s == 200, '200')[0] == 'ok'
    assert mon.probe(base + '/missing', lambda s: s == 404, '404')[0] == 'ok'

    hits.clear()
    status, summary, _ = mon.probe(base + '/broken', lambda s: s == 200, 'the page')
    assert (status, summary) == ('error', 'Answered 500 instead of the page.')
    assert len(hits) == 2               # a server error is tried once more

    hits.clear()
    status, summary, _ = mon.probe(base + '/missing', lambda s: s == 200, 'the page')
    assert summary == 'Answered 404 instead of the page.' and len(hits) == 1

    status, summary, _ = mon.probe('http://127.0.0.1:1/', lambda s: True, 'anything')
    assert status == 'error' and summary.startswith('No answer:')


def test_run_checks_adds_the_probes_and_leaves_out_alarms(mon, site, monkeypatch):
    base, hits = site
    monkeypatch.setenv('WEB_URL', base + '/ok')
    monkeypatch.setenv('API_URL', base + '/api/')
    result = {c['id']: c for c in mon.run_checks()}
    assert 'alarms' not in result
    assert {'api', 'functions', 'files_table', 'users_table', 'storage', 'email', 'encryption', 'cleanup',
            'website', 'api_probe', 'links'} == set(result)
    assert result['website']['status'] == 'ok'
    assert result['links']['status'] == 'ok'           # the local server says 404, as the real one does
    assert result['api_probe']['status'] == 'error'    # ...but 404 where API Gateway would say 401
    assert '/api/v1/users/health-check/files' in hits and '/api/v1/d/health-check-probe' in hits
