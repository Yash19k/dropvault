#! /usr/bin/env python
'''Mark a file upload as complete (status READY) once the browser has finished
   the presigned S3 PUT. Confirms the object exists and records its real size.'''

import os
import json
import collections
import boto3
import auth
import log


LOGGER = log.setup_logging()

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Allow': 'POST, OPTIONS',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    url_user_id = event['path'].split('/')[3]
    return url_user_id == user_id


def mark_ready(file_item, conf_values):
    '''Confirm the object exists in S3, store its real size and flip to READY.'''
    key = '{0}/{1}/{2}'.format(file_item['user_id'], file_item['file_id'], file_item['file_name'])
    s3_client = boto3.client('s3', conf_values['REGION'])
    head = s3_client.head_object(Bucket=os.environ['USER_FILES_BUCKET'], Key=key)
    size = head.get('ContentLength', file_item.get('size', 0))

    dynamodb = boto3.resource('dynamodb')
    table = dynamodb.Table(os.environ['FILE_SHARING_TABLE'])
    table.update_item(
        Key={'file_id': file_item['file_id']},
        UpdateExpression='SET #s = :ready, size = :size',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':ready': 'READY', ':size': int(size)}
    )
    return int(size)


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
        size = mark_ready(file_item, conf_values)
        body = collections.OrderedDict()
        body['file_id'] = file_id
        body['size'] = size
        body['status'] = 'READY'
        return {'statusCode': 200, 'body': json.dumps(body),
                'headers': CORS_HEADERS, 'isBase64Encoded': False}
    except Exception as error:
        LOGGER.error({'error_message': '{}'.format(error)})
        return {'statusCode': 400, 'body': json.dumps({'error_message': 'Internal server error'}),
                'headers': CORS_HEADERS, 'isBase64Encoded': False}
