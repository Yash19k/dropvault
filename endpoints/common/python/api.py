'''The request/response plumbing every file Lambda used to copy: CORS headers,
JSON bodies, errors, and "is this the caller's own file?".

A handler is written as `@api.route('GET, OPTIONS')` over a function that takes
the event and returns (status, body), or a complete response dict (for HTML
pages and redirects). Raising ApiError returns that status and message.
'''

import functools
import json

import auth
import log
import ratelimit
import storage

LOGGER = log.setup_logging()


class ApiError(Exception):
    '''An expected failure that becomes an HTTP error response.'''

    def __init__(self, status, message, headers=None, **extra):
        super().__init__(message)
        self.status = status
        self.headers = headers or {}
        self.body = dict({'message': message}, **extra)


def cors_headers(methods):
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': methods,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Expose-Headers': 'Retry-After',
        # API answers carry tokens and private file data: never cache them,
        # and never let a browser guess a different content type.
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    }


def json_response(status, body, headers):
    return {'statusCode': status, 'headers': headers, 'body': json.dumps(body, default=_json_default),
            'isBase64Encoded': False}


def _json_default(value):
    '''DynamoDB returns numbers as Decimal.'''
    try:
        return int(value) if value == int(value) else float(value)
    except (TypeError, ValueError):
        return str(value)


def route(methods):
    '''Decorator: turns (status, body) / ApiError / crashes into API responses.'''
    headers = cors_headers(methods)

    def wrap(fn):
        @functools.wraps(fn)
        def handler(event, context):
            try:
                result = fn(event or {})
                if isinstance(result, dict) and 'statusCode' in result:
                    return result
                status, body = result
                return json_response(status, body, headers)
            except ApiError as error:
                return json_response(error.status, error.body, dict(headers, **error.headers))
            except ratelimit.Limited as limited:
                return too_many(limited, headers)
            except Exception:  # pylint: disable=broad-except
                LOGGER.exception('unhandled error')
                return json_response(500, {'message': 'Internal server error'}, headers)
        return handler
    return wrap


def too_many(limited, headers, message=None):
    '''429 with Retry-After, for a request over one of the rate limits.'''
    text = message or 'Too many requests. Try again in {0}.'.format(ratelimit.wait_text(limited.retry_after))
    return json_response(429, {'message': text, 'retry_after': limited.retry_after},
                         dict(headers, **{'Retry-After': str(limited.retry_after)}))


def json_body(event):
    '''The request body as a dict ({} when empty).'''
    try:
        body = json.loads(event.get('body') or '{}')
    except ValueError:
        raise ApiError(400, 'Body must be JSON') from None
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise ApiError(400, 'Body must be a JSON object')
    return body


def query_param(event, name):
    return ((event.get('queryStringParameters') or {}).get(name))


def require_user(event):
    '''(user_id, name, email) of the caller, whose id must match the path.'''
    user_id, name, email = auth.resolve_event_user(event)
    if not user_id:
        raise ApiError(401, 'Unauthorized')
    if auth.path_param(event, 'user_id', 3) != user_id:
        raise ApiError(403, 'User not authorized to perform this action')
    return user_id, name, email


def owned_file(event, ready=False):
    '''((user_id, name, email), file item) for the file in the path, which must
       belong to the caller. ready=True also requires a finished upload.'''
    user = require_user(event)
    file_id = auth.path_param(event, 'file_id', 5)
    item = storage.get_file(file_id) if file_id else None
    if not item or item.get('user_id') != user[0]:
        raise ApiError(404, 'File not found')
    if ready and item.get('status', 'READY') != 'READY':
        raise ApiError(409, 'File upload has not finished yet')
    return user, item
