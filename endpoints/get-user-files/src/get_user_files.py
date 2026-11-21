#! /usr/bin/env python
'''Get the list of files owned by the authenticated user (with metadata).'''

import os
import json
import collections
import boto3
from boto3.dynamodb.conditions import Attr
import auth
import log


LOGGER = log.setup_logging()

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Allow': 'GET, OPTIONS',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*'
}


def get_user_files(user_id):
    '''Return the user's files with their metadata.'''
    try:
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table(os.environ['FILE_SHARING_TABLE'])
        # A Scan returns at most 1 MB per call: follow LastEvaluatedKey, or
        # files beyond the first page silently disappear from the list.
        items = []
        kwargs = {'FilterExpression': Attr('user_id').eq(user_id)}
        while True:
            response = table.scan(**kwargs)
            items.extend(response.get('Items', []))
            if 'LastEvaluatedKey' not in response:
                break
            kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
        user_files = []
        for item in items:
            user_files.append({
                'file_id': item['file_id'],
                'file_name': item['file_name'],
                'content_type': item.get('content_type', 'application/octet-stream'),
                'size': int(item.get('size', 0)),
                'uploaded_at': item.get('uploaded_at'),
                'status': item.get('status', 'READY')
            })
        # newest first when we have a timestamp
        user_files.sort(key=lambda f: f.get('uploaded_at') or '', reverse=True)
        return user_files
    except Exception as error:
        LOGGER.error(error)
        raise Exception('Internal server error')


def build_api_response(user_id, user_files):
    '''Build the API response.'''
    response_body = collections.OrderedDict()
    response_body['user_id'] = user_id
    response_body['user_files'] = user_files
    return response_body


def init_env_vars():
    '''Get all environment variables.'''
    return {'REGION': os.getenv('REGION')}


def lambda_handler(event, _):
    '''Lambda entrypoint.'''
    try:
        user_id, _name, _email = auth.resolve_event_user(event)
        if not user_id:
            return {'statusCode': 401, 'body': json.dumps({'message': 'Unauthorized'}),
                    'headers': CORS_HEADERS}
        if auth.path_param(event, 'user_id', 3) != user_id:
            return {'statusCode': 403,
                    'body': json.dumps({'message': 'User not authorized to perform this action'}),
                    'headers': CORS_HEADERS}
        user_files = get_user_files(user_id)
        return {
            'statusCode': 200,
            'body': json.dumps(build_api_response(user_id, user_files)),
            'headers': CORS_HEADERS,
            'isBase64Encoded': False,
        }
    except Exception as error:
        LOGGER.error({'error_message': '{}'.format(error)})
        return {'statusCode': 500, 'body': json.dumps({'error_message': 'Internal server error'}),
                'headers': CORS_HEADERS, 'isBase64Encoded': False}
