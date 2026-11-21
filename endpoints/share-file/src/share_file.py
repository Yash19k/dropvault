'''Share one of the caller's files by emailing short download links.

  POST /v1/users/{user_id}/files/{file_id}/share
       {share_with: [emails], expires_in?, max_downloads?}

Each recipient gets their own link, so the file's link list shows who has
downloaded it, a download limit applies to each person separately, and one
person's link can be turned off without affecting the others.

An email that can't be sent doesn't stop the others. Its link is removed and
the answer lists it under `failed` with a reason the sender can read:
  some sent   201 {..., sent: [emails], failed: [{email, reason}]}
  none sent   422 when SES refused the recipients (e.g. unverified addresses
              while the account is in the SES sandbox), 502 when SES itself
              couldn't send; both {message, failed}
'''

import html
import os

import boto3
from botocore.exceptions import BotoCoreError, ClientError

import api
import links
import log
import storage
import validation

LOGGER = log.setup_logging()

SANDBOX_REASON = ('While {0}’s email is in test mode (the Amazon SES sandbox), it can only send to addresses '
                  'verified in SES. Use Copy link and send the link yourself instead.')
REFUSED_REASON = 'The email service refused to send to this address.'
SERVICE_REASON = 'The email service couldn’t send it right now. Try again in a few minutes.'


class NotSent(Exception):
    '''An email that didn't go out. `recipient_problem` is True when SES
       refused that address (the sender can fix it), False when SES itself
       failed (an admin has to).'''

    def __init__(self, reason, recipient_problem):
        super().__init__(reason)
        self.reason = reason
        self.recipient_problem = recipient_problem


def plain(text, limit=100):
    '''One line of user-supplied text, safe for an email subject.'''
    cleaned = ''.join(' ' if ord(c) < 32 or ord(c) == 127 else c for c in (text or ''))
    return ' '.join(cleaned.split())[:limit]


def limit_sentence(max_downloads):
    if not max_downloads:
        return ''
    if max_downloads == 1:
        return ' It can be downloaded <strong style="color:#5c5c55;">once</strong>.'
    return ' It can be downloaded <strong style="color:#5c5c55;">{0} times</strong>.'.format(max_downloads)


def lifetime_sentence(ttl):
    '''The "how long does this work" line in the email.'''
    if ttl == links.NEVER:
        return 'This link doesn&rsquo;t expire. It works until the sender deletes the file or turns the link off.'
    return 'This link works for <strong style="color:#5c5c55;">{0}</strong>.'.format(links.describe_ttl(ttl))


def build_email_html(sender, file_name, download_url, app_name, ttl, max_downloads=None):
    '''A clean, branded HTML email. Everything user-controlled (the sender's
       name, the file name) is escaped so nobody can inject markup or phishing
       links into mail sent from this app's verified SES identity.'''
    sender_label = html.escape(plain(sender) or 'A {0} user'.format(app_name))
    return '''\
<!doctype html><html><body style="margin:0;background:#f7f7f5;font-family:'IBM Plex Sans',Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
    <div style="font-size:15px;font-weight:600;color:#1b1b18;margin:0 0 24px;">{app_name}</div>
    <div style="background:#ffffff;border:1px solid #e5e5e0;border-radius:8px;padding:28px;">
      <p style="margin:0;color:#5c5c55;font-size:14px;line-height:1.6;">
        <strong style="color:#1b1b18;">{sender}</strong> shared a file with you:
      </p>
      <p style="margin:10px 0 24px;color:#1b1b18;font-size:17px;font-weight:600;word-break:break-all;">{file_name}</p>
      <a href="{url}" style="display:inline-block;background:#0e6b5e;color:#ffffff;text-decoration:none;
         padding:11px 20px;border-radius:6px;font-size:14px;font-weight:600;">Download file</a>
      <p style="margin:24px 0 0;color:#8b8b83;font-size:13px;line-height:1.6;">
        {lifetime}{limit} If you weren't expecting this file, you can ignore this email.
      </p>
    </div>
    <p style="margin:20px 0 0;color:#8b8b83;font-size:12px;">Sent with {app_name}.</p>
  </div>
</body></html>'''.format(app_name=html.escape(app_name), sender=sender_label, file_name=html.escape(file_name),
                         url=html.escape(download_url, quote=True), lifetime=lifetime_sentence(ttl),
                         limit=limit_sentence(max_downloads))


def send_email(sender, recipient, file_name, url, ttl, max_downloads):
    '''Send one share email; raises NotSent when SES won't.'''
    app_name = os.getenv('APP_NAME', 'DropVault')
    try:
        boto3.client('ses', region_name=storage.region()).send_email(
            Source=os.environ['SENDER_EMAIL'],
            Destination={'ToAddresses': [recipient]},
            Message={
                'Subject': {'Data': '{0} shared a file with you'.format(plain(sender) or app_name)},
                'Body': {'Html': {'Data': build_email_html(sender, file_name, url, app_name, ttl, max_downloads)}},
            },
            SourceArn=os.environ['SENDER_SES_ARN'])
    except ClientError as error:
        info = error.response.get('Error', {})
        code, message = info.get('Code', ''), info.get('Message', '')
        # SES names the address it refused; when that's the recipient, the sender can act on it.
        if code == 'MessageRejected' and recipient.lower() in message.lower():
            sandbox = 'not verified' in message.lower()
            LOGGER.warning('share: SES refused a recipient (%s)', 'sandbox, unverified' if sandbox else code)
            raise NotSent(SANDBOX_REASON.format(app_name) if sandbox else REFUSED_REASON, True) from None
        # Anything else (sender not verified, sending paused, throttled) needs an admin: log it as an error.
        LOGGER.error('share: SES could not send: %s: %s', code, message)
        raise NotSent(SERVICE_REASON, False) from None
    except BotoCoreError as error:
        LOGGER.error('share: could not reach SES: %s', error)
        raise NotSent(SERVICE_REASON, False) from None


def nothing_sent_message(failed):
    reasons = {f['reason'] for f in failed}
    who = failed[0]['email'] if len(failed) == 1 else 'any of the {0} recipients'.format(len(failed))
    return 'Couldn’t email {0}.{1}'.format(who, ' ' + reasons.pop() if len(reasons) == 1 else '')


@api.route('POST, OPTIONS')
def lambda_handler(event):
    body = api.json_body(event)
    ok, error = validation.validate_body(body, __file__, 'share_file.json')
    if not ok:
        raise api.ApiError(400, error)
    ttl, error = links.parse_expires_in(body.get('expires_in'))
    if error:
        raise api.ApiError(400, error)
    max_downloads, error = links.parse_max_downloads(body.get('max_downloads'))
    if error:
        raise api.ApiError(400, error)
    (user_id, name, _email), item = api.owned_file(event, ready=True)

    table, expires_at = storage.table(), None
    sent, failed, service_failed = [], [], False
    for recipient in body['share_with']:
        url, link_expires = links.create(table, event, item['file_id'], user_id, ttl,
                                         channel='email', max_downloads=max_downloads, recipient=recipient)
        try:
            send_email(name, recipient, item['file_name'], url, ttl, max_downloads)
        except NotSent as problem:
            links.discard(table, url)
            failed.append({'email': recipient, 'reason': problem.reason})
            service_failed = service_failed or not problem.recipient_problem
            continue
        sent.append(recipient)
        expires_at = link_expires
    if not sent:
        raise api.ApiError(502 if service_failed else 422, nothing_sent_message(failed), failed=failed)
    return 201, {'file_id': item['file_id'], 'file_name': item['file_name'], 'status': 'SHARED',
                 'expires_at': expires_at, 'max_downloads': max_downloads, 'sent': sent, 'failed': failed}
