'''Share one of the caller's files by emailing short download links.

  POST /v1/users/{user_id}/files/{file_id}/share
       {share_with: [emails], expires_in?, max_downloads?}

Each recipient gets their own link, so the file's link list shows who has
downloaded it, a download limit applies to each person separately, and one
person's link can be turned off without affecting the others.
'''

import html
import os

import boto3

import api
import links
import log
import storage
import validation

LOGGER = log.setup_logging()


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
    app_name = os.getenv('APP_NAME', 'DropVault')
    boto3.client('ses', region_name=storage.region()).send_email(
        Source=os.environ['SENDER_EMAIL'],
        Destination={'ToAddresses': [recipient]},
        Message={
            'Subject': {'Data': '{0} shared a file with you'.format(plain(sender) or app_name)},
            'Body': {'Html': {'Data': build_email_html(sender, file_name, url, app_name, ttl, max_downloads)}},
        },
        SourceArn=os.environ['SENDER_SES_ARN'])


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

    expires_at = None
    for recipient in body['share_with']:
        url, expires_at = links.create(storage.table(), event, item['file_id'], user_id, ttl,
                                       channel='email', max_downloads=max_downloads, recipient=recipient)
        send_email(name, recipient, item['file_name'], url, ttl, max_downloads)
    return 201, {'file_id': item['file_id'], 'file_name': item['file_name'], 'status': 'SHARED',
                 'expires_at': expires_at, 'max_downloads': max_downloads}
