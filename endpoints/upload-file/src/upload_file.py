#! /usr/bin/env python
'''Start a file upload: create the DynamoDB record and return a presigned
   S3 PUT URL so the browser uploads directly to S3 (no size cap, with progress).'''

import os
import json
import uuid
import time
import collections
from datetime import datetime, timezone
from os.path import join, dirname
from jsonschema import validate
import jsonschema
import boto3
from botocore.config import Config
import auth
import constants
import log


def s3_client(region):
    '''S3 client that signs presigned URLs with SigV4 against the REGIONAL,
       virtual-hosted endpoint - required for SSE-KMS and to avoid the global
       endpoint's 307 redirect (which breaks browser CORS uploads).'''
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
    return assert_valid_schema(req_body, constants.NEW_FILE_JSON_SCHEMA)


def s3_key(user_id, file_id, file_name):
    '''Object key: namespaced by user and file id to avoid collisions.'''
    return '{0}/{1}/{2}'.format(user_id, file_id, file_name)


def ensure_user_kms_key(user_id, conf_values):
    '''In per_user mode, return the user's KMS key, creating it EXACTLY ONCE.

    A DynamoDB conditional write (one sentinel item per user) is the lock: only
    the single winner calls kms:CreateKey; every concurrent upload waits for the
    winner to publish the ARN. No races, no orphaned keys. Returns the key ARN,
    or None when per-user mode is off.'''
    if conf_values['KMS_MODE'] != 'per_user':
        return None

    region = conf_values['REGION']
    alias = 'alias/{0}/user/{1}'.format(conf_values['KMS_ALIAS_PREFIX'], user_id)
    table = boto3.resource('dynamodb').Table(os.environ['FILE_SHARING_TABLE'])
    lock_id = 'USERKEY#{0}'.format(user_id)

    # Already provisioned (sentinel has the ARN)?
    record = table.get_item(Key={'file_id': lock_id}).get('Item')
    if record and record.get('kms_key_arn'):
        return record['kms_key_arn']

    kms = boto3.client('kms', region_name=region)

    # The alias may already exist (e.g. a user created before this lock existed):
    # adopt it and backfill the sentinel - never create a duplicate key.
    try:
        key_arn = kms.describe_key(KeyId=alias)['KeyMetadata']['Arn']
        table.put_item(Item={'file_id': lock_id, 'kind': 'user_key',
                             'status': 'READY', 'kms_key_arn': key_arn})
        return key_arn
    except kms.exceptions.NotFoundException:
        pass

    # Claim the right to create the key (atomic; only one invocation wins).
    try:
        table.put_item(
            Item={'file_id': lock_id, 'kind': 'user_key', 'status': 'CREATING'},
            ConditionExpression='attribute_not_exists(file_id)'
        )
    except table.meta.client.exceptions.ConditionalCheckFailedException:
        # Another upload is creating it - wait for the ARN to be published.
        for _ in range(40):
            record = table.get_item(Key={'file_id': lock_id}).get('Item')
            if record and record.get('kms_key_arn'):
                return record['kms_key_arn']
            time.sleep(0.25)
        return kms.describe_key(KeyId=alias)['KeyMetadata']['Arn']

    # We won the claim: create the single key + alias and publish the ARN.
    key_arn = kms.create_key(
        Description='Enclave per-user file key ({0})'.format(user_id),
        Tags=[{'TagKey': 'app', 'TagValue': conf_values['KMS_ALIAS_PREFIX']},
              {'TagKey': 'user_id', 'TagValue': user_id}]
    )['KeyMetadata']['Arn']
    kms.create_alias(AliasName=alias, TargetKeyId=key_arn)
    table.update_item(
        Key={'file_id': lock_id},
        UpdateExpression='SET kms_key_arn = :a, #s = :r',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':a': key_arn, ':r': 'READY'}
    )
    return key_arn


def create_upload(user_id, req_body, conf_values):
    '''Create the file record and return a presigned PUT URL (KMS-aware).'''
    try:
        file_id = str(uuid.uuid4())
        file_name = req_body['file_name']
        content_type = req_body.get('content_type') or 'application/octet-stream'
        size = int(req_body.get('size') or 0)
        key = s3_key(user_id, file_id, file_name)

        params = {
            'Bucket': os.environ['USER_FILES_BUCKET'],
            'Key': key,
            'ContentType': content_type
        }
        # per_user: encrypt this object under the user's own KMS key. The browser
        # must echo the matching SSE headers on the PUT, so we return them.
        upload_headers = {}
        kms_key_arn = ensure_user_kms_key(user_id, conf_values)
        if kms_key_arn:
            params['ServerSideEncryption'] = 'aws:kms'
            params['SSEKMSKeyId'] = kms_key_arn
            upload_headers = {
                'x-amz-server-side-encryption': 'aws:kms',
                'x-amz-server-side-encryption-aws-kms-key-id': kms_key_arn,
            }

        upload_url = s3_client(conf_values['REGION']).generate_presigned_url(
            'put_object', Params=params, ExpiresIn=3600)

        item = {
            'file_id': file_id,
            'user_id': user_id,
            'file_name': file_name,
            'content_type': content_type,
            'size': size,
            'uploaded_at': datetime.now(timezone.utc).isoformat(),
            'status': 'UPLOADING'
        }
        if kms_key_arn:
            item['kms_key_arn'] = kms_key_arn
        boto3.resource('dynamodb').Table(os.environ['FILE_SHARING_TABLE']).put_item(Item=item)
        return file_id, upload_url, upload_headers
    except Exception as error:
        LOGGER.error(error)
        raise Exception('Internal server error')


def build_api_response(file_id, upload_url, upload_headers):
    '''Build the API response.'''
    response_body = collections.OrderedDict()
    response_body['file_id'] = file_id
    response_body['upload_url'] = upload_url
    response_body['upload_headers'] = upload_headers
    response_body['status'] = 'UPLOADING'
    return response_body


def init_env_vars():
    '''Get all environment variables.'''
    return {
        'REGION': os.getenv('REGION'),
        'KMS_MODE': os.getenv('KMS_MODE', 's3'),
        'KMS_ALIAS_PREFIX': os.getenv('KMS_ALIAS_PREFIX', 'enclave')
    }


def lambda_handler(event, _):
    '''Lambda entrypoint.'''
    try:
        req_body = json.loads(event['body'])
        is_valid, error_msg = check_inputs(req_body)
        if not is_valid:
            return {'statusCode': 400, 'body': json.dumps({'message': error_msg}),
                    'headers': CORS_HEADERS}
        conf_values = init_env_vars()
        user_id, _name, _email = auth.resolve_user(event['headers'].get('Authorization'))
        if not user_id:
            return {'statusCode': 401, 'body': json.dumps({'message': 'Unauthorized'}),
                    'headers': CORS_HEADERS}
        file_id, upload_url, upload_headers = create_upload(user_id, req_body, conf_values)
        return {
            'statusCode': 201,
            'body': json.dumps(build_api_response(file_id, upload_url, upload_headers)),
            'headers': CORS_HEADERS,
            'isBase64Encoded': False,
        }
    except Exception as error:
        LOGGER.error({'error_message': '{}'.format(error)})
        return {'statusCode': 400, 'body': json.dumps({'error_message': 'Internal server error'}),
                'headers': CORS_HEADERS, 'isBase64Encoded': False}
