#! /usr/bin/env python
'''Share one of the user's files by emailing a short-lived presigned link.'''

import os
import json
import collections
from os.path import join, dirname
from jsonschema import validate
import jsonschema
import boto3
from botocore.config import Config
import auth
import constants
import log


def s3_client(region):
    '''Regional, SigV4, virtual-hosted S3 client (works with SSE-KMS + browser CORS).'''
    return boto3.client(
        's3',
        region_name=region,
        endpoint_url='https://s3.{0}.amazonaws.com'.format(region),
        config=Config(signature_version='s3v4', s3={'addressing_style': 'virtual'})
    )


LOGGER = log.setup_logging()

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Allow': 'POST, OPTIONS',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*'
}


def _load_json_schema(filename):
    '''Loads the given schema file'''
    relative_path = join(constants.SCHEMAS_FOLDER, filename)
    absolute_path = join(dirname(__file__), relative_path)
    with open(absolute_path) as schema_file:
        return json.loads(schema_file.read())


def assert_valid_schema(data, schema_file):
    '''Checks whether the given data matches the schema'''
    schema = _load_json_schema(schema_file)
    try:
        validate(data, schema)
        return True, None
    except jsonschema.exceptions.ValidationError as error:
        return False, error.message


def check_inputs(req_body):
    '''Validate inputs'''
    return assert_valid_schema(req_body, constants.SHARE_FILE_JSON_SCHEMA)


def get_file(user_id, file_id):
    '''Fetch the file record and confirm ownership.'''
    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(os.environ['FILE_SHARING_TABLE'])
    item = table.get_item(Key={'file_id': file_id}).get('Item')
    if not item or item.get('user_id') != user_id:
        return None
    return item


def is_user_authorized(user_id, event):
    '''The {user_id} in the path must match the token's user.'''
    return event['path'].split('/')[3] == user_id


def build_email_html(sender, file_name, download_url, app_name):
    '''A clean, generic, branded HTML email.'''
    sender_label = sender or 'A {0} user'.format(app_name)
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
        This link works for <strong style="color:#5c5c55;">one hour</strong>. If you weren't expecting this file, you can ignore this email.
      </p>
    </div>
    <p style="margin:20px 0 0;color:#8b8b83;font-size:12px;">Sent with {app_name}.</p>
  </div>
</body></html>'''.format(app_name=app_name, sender=sender_label, file_name=file_name, url=download_url)


def send_file_link(sender, email, file_name, download_url, app_name):
    '''Send the download link by email through SES.'''
    message = {
        'Subject': {'Data': '{0} shared a file with you'.format(sender or app_name)},
        'Body': {'Html': {'Data': build_email_html(sender, file_name, download_url, app_name)}}
    }
    ses_client = boto3.client('ses')
    ses_client.send_email(
        Source=os.environ['SENDER_EMAIL'],
        Destination={'ToAddresses': [email]},
        Message=message,
        SourceArn=os.environ['SENDER_SES_ARN'],
    )


def share_file(file_item, sender, req_body, conf_values):
    '''Generate a presigned link and email it to every recipient.'''
    try:
        key = '{0}/{1}/{2}'.format(file_item['user_id'], file_item['file_id'], file_item['file_name'])
        download_url = s3_client(conf_values['REGION']).generate_presigned_url(
            'get_object',
            Params={
                'Bucket': os.environ['USER_FILES_BUCKET'],
                'Key': key,
                'ResponseContentDisposition': 'attachment; filename="{0}"'.format(file_item['file_name'])
            },
            ExpiresIn=3600
        )
        app_name = os.getenv('APP_NAME', 'DropVault')
        for email in req_body['share_with']:
            send_file_link(sender, email, file_item['file_name'], download_url, app_name)
    except Exception as error:
        LOGGER.error(error)
        raise Exception('Internal server error')


def build_api_response(file_item):
    '''Build the API response.'''
    response_body = collections.OrderedDict()
    response_body['file_id'] = file_item['file_id']
    response_body['file_name'] = file_item['file_name']
    response_body['status'] = 'SHARED'
    return response_body


def init_env_vars():
    '''Get all environment variables.'''
    return {'REGION': os.getenv('REGION')}


def lambda_handler(event, _):
    '''Lambda entrypoint.'''
    try:
        req_body = json.loads(event['body'])
        is_valid, error_msg = check_inputs(req_body)
        if not is_valid:
            return {'statusCode': 400, 'body': json.dumps({'message': error_msg}),
                    'headers': CORS_HEADERS}
        conf_values = init_env_vars()
        user_id, name, _email = auth.resolve_user(event['headers'].get('Authorization'))
        if not user_id:
            return {'statusCode': 401, 'body': json.dumps({'message': 'Unauthorized'}),
                    'headers': CORS_HEADERS}
        file_id = event['path'].split('/')[5]
        if not is_user_authorized(user_id, event):
            return {'statusCode': 401,
                    'body': json.dumps({'message': 'User not authorized to perform this action'}),
                    'headers': CORS_HEADERS}
        file_item = get_file(user_id, file_id)
        if not file_item:
            return {'statusCode': 404, 'body': json.dumps({'error_message': 'File not found'}),
                    'headers': CORS_HEADERS}
        share_file(file_item, name, req_body, conf_values)
        return {
            'statusCode': 201,
            'body': json.dumps(build_api_response(file_item)),
            'headers': CORS_HEADERS,
            'isBase64Encoded': False,
        }
    except Exception as error:
        LOGGER.error({'error_message': '{}'.format(error)})
        return {'statusCode': 400, 'body': json.dumps({'error_message': 'Internal server error'}),
                'headers': CORS_HEADERS, 'isBase64Encoded': False}
