#! /usr/bin/env python
'''Return a short-lived presigned download URL for one of the user's own files.'''

import os
import json
import collections
import boto3
from botocore.config import Config
import auth
import log


LOGGER = log.setup_logging()


def s3_client(region):
    '''Regional, SigV4, virtual-hosted S3 client (works with SSE-KMS + browser CORS).'''
    return boto3.client(
        's3',
        region_name=region,
        endpoint_url='https://s3.{0}.amazonaws.com'.format(region),
        config=Config(signature_version='s3v4', s3={'addressing_style': 'virtual'})
    )

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Allow': 'GET, OPTIONS',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*'
}


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


def presigned_download(file_item, conf_values):
    '''Generate a 1-hour presigned GET that downloads with the original filename.'''
    key = '{0}/{1}/{2}'.format(file_item['user_id'], file_item['file_id'], file_item['file_name'])
    return s3_client(conf_values['REGION']).generate_presigned_url(
        'get_object',
        Params={
            'Bucket': os.environ['USER_FILES_BUCKET'],
            'Key': key,
            'ResponseContentDisposition': 'attachment; filename="{0}"'.format(file_item['file_name'])
        },
        ExpiresIn=3600
    )


def init_env_vars():
    '''Get all environment variables.'''
    return {'REGION': os.getenv('REGION')}


def lambda_handler(event, _):
    '''Lambda entrypoint.'''
    try:
        conf_values = init_env_vars()
        user_id, _name, _email = auth.resolve_user(event['headers'].get('Authorization'))
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
        body = collections.OrderedDict()
        body['file_id'] = file_id
        body['file_name'] = file_item['file_name']
        body['download_url'] = presigned_download(file_item, conf_values)
        return {'statusCode': 200, 'body': json.dumps(body),
                'headers': CORS_HEADERS, 'isBase64Encoded': False}
    except Exception as error:
        LOGGER.error({'error_message': '{}'.format(error)})
        return {'statusCode': 400, 'body': json.dumps({'error_message': 'Internal server error'}),
                'headers': CORS_HEADERS, 'isBase64Encoded': False}
