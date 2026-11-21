'''API Gateway TOKEN authorizer: checks the caller's sign-in once, in front of
every protected route, instead of each Lambda calling the auth service.

API Gateway caches the answer for each token (5 minutes by default), so most
requests skip this Lambda as well. The caller is passed to the route's Lambda
in requestContext.authorizer as {user_id, name, email}.

With the built-in auth service (TOKEN_SECRET set) the token's signature is
checked right here, and then the account itself (USERS_TABLE): it must still
exist, not be suspended, and not have ended its sessions since the token was
issued (logout, or an admin's suspend / password reset / sign out). So those
take effect within one cache period instead of when the token expires. With
an external auth service it asks that service's /v1/userinfo, so any
compatible auth provider still works.
'''

import os

import accounts
import auth
import log
import tokens

LOGGER = log.setup_logging()


def caller(token):
    '''(user_id, name, email) for a valid token, else None.'''
    if os.getenv('TOKEN_SECRET'):
        claims = tokens.verify(tokens.strip_bearer(token), ('id', 'access'))
        if not claims:
            return None
        if os.getenv('USERS_TABLE') and not accounts.session_valid(accounts.get_user(claims.get('email')), claims):
            return None
        return claims['sub'], claims.get('name', ''), claims.get('email', '')
    user_id, name, email = auth.resolve_user(token)
    return (user_id, name or '', email or '') if user_id else None


def api_wide_resource(method_arn):
    '''arn:...:api-id/stage/GET/path -> arn:...:api-id/stage/*  The cached
       policy is reused for every route the token calls, so it must cover all.'''
    arn, _, rest = method_arn.partition(':execute-api:')
    parts = rest.split('/')
    return '{0}:execute-api:{1}/{2}/*'.format(arn, parts[0], parts[1] if len(parts) > 1 else '*')


def lambda_handler(event, _context):
    user = caller((event or {}).get('authorizationToken'))
    if not user:
        # This exact message makes API Gateway answer 401 (any other is a 500).
        raise Exception('Unauthorized')
    user_id, name, email = user
    return {
        'principalId': user_id,
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [{'Action': 'execute-api:Invoke', 'Effect': 'Allow',
                           'Resource': api_wide_resource(event['methodArn'])}],
        },
        'context': {'user_id': user_id, 'name': name, 'email': email},
    }
