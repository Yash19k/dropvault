#! /usr/bin/env python
'''Delete one of the authenticated user's files (from S3 and DynamoDB).'''

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
    'Allow': 'DELETE, OPTIONS',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
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
    return auth.path_param(event, 'user_id', 3) == user_id


def delete_file(file_item, conf_values):
    '''Delete the object from S3 and its record from DynamoDB.'''
    try:
        key = '{0}/{1}/{2}'.format(file_item['user_id'], file_item['file_id'], file_item['file_name'])
        s3_client = boto3.client('s3', conf_values['REGION'])
        s3_client.delete_object(Bucket=os.environ['USER_FILES_BUCKET'], Key=key)
        dynamodb = boto3.resource('dynamodb')
        table = dynamodb.Table(os.environ['FILE_SHARING_TABLE'])
        table.delete_item(Key={'file_id': file_item['file_id']})
    except Exception as error:
        LOGGER.error(error)
        raise Exception('Internal server error')


def build_api_response(user_id, file_item):
    '''Build the API response.'''
    response_body = collections.OrderedDict()
    response_body['user_id'] = user_id
    response_body['file_id'] = file_item['file_id']
    response_body['file_name'] = file_item['file_name']
    response_body['file_status'] = 'DELETED'
    return response_body


def init_env_vars():
    '''Get all environment variables.'''
    return {'REGION': os.getenv('REGION')}


def lambda_handler(event, _):
    '''Lambda entrypoint.'''
    try:
        conf_values = init_env_vars()
        user_id, _name, _email = auth.resolve_event_user(event)
        if not user_id:
            return {'statusCode': 401, 'body': json.dumps({'message': 'Unauthorized'}),
                    'headers': CORS_HEADERS}
        file_id = auth.path_param(event, 'file_id', 5)
        if not is_user_authorized(user_id, event):
            return {'statusCode': 403,
                    'body': json.dumps({'message': 'User not authorized to perform this action'}),
                    'headers': CORS_HEADERS}
        file_item = get_file(user_id, file_id)
        if not file_item:
            return {'statusCode': 404, 'body': json.dumps({'error_message': 'File not found'}),
                    'headers': CORS_HEADERS}
        delete_file(file_item, conf_values)
        return {
            'statusCode': 200,
            'body': json.dumps(build_api_response(user_id, file_item)),
            'headers': CORS_HEADERS,
            'isBase64Encoded': False,
        }
    except Exception as error:
        LOGGER.error({'error_message': '{}'.format(error)})
        return {'statusCode': 500, 'body': json.dumps({'error_message': 'Internal server error'}),
                'headers': CORS_HEADERS, 'isBase64Encoded': False}
