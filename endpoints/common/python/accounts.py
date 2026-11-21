'''User accounts of the built-in auth service, and who is an admin.

Users live in USERS_TABLE (key: email):
  user_id, name, password (PBKDF2), created_at
  token_version   bumped to end every session (logout, suspend, password reset,
                  an admin's "sign out everywhere"); tokens carry it as `ver`
  role            'admin' for admins (absent for everyone else)
  suspended_at    set while an admin has suspended the account
  last_login_at, login_count

Admins are users with role 'admin', plus everyone listed in ADMIN_EMAILS
(comma-separated, from Terraform's admin_emails). Those listed are "owner"
admins: the admin panel can't demote, suspend or delete them, so there is
always a way back in.
'''

import hashlib
import hmac
import os
import secrets

import boto3

PBKDF2_ROUNDS = 200000


def users_table():
    return boto3.resource('dynamodb').Table(os.environ['USERS_TABLE'])


def get_user(email):
    if not email:
        return None
    return users_table().get_item(Key={'email': email}).get('Item')


def owner_emails():
    return {e.strip().lower() for e in (os.getenv('ADMIN_EMAILS') or '').split(',') if e.strip()}


def is_owner(user):
    return bool(user) and (user.get('email') or '').lower() in owner_emails()


def role(user):
    '''"admin" or "user".'''
    if user and (user.get('role') == 'admin' or is_owner(user)):
        return 'admin'
    return 'user'


def is_suspended(user):
    return bool(user and user.get('suspended_at'))


def session_valid(user, claims):
    '''A signed, unexpired token still belongs to a live session: the account
       exists, isn't suspended, and hasn't ended its sessions since then.'''
    return (bool(user) and user.get('user_id') == claims.get('sub')
            and not is_suspended(user)
            and int(claims.get('ver', 0)) == int(user.get('token_version', 0)))


# --- passwords ---------------------------------------------------------------
def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), PBKDF2_ROUNDS).hex()
    return '{0}${1}'.format(salt, digest)


def check_password(password, stored):
    salt = stored.split('$', 1)[0]
    return hmac.compare_digest(hash_password(password, salt), stored)


def temporary_password():
    '''12 characters people can read out and type: no 0/O, 1/l/I.'''
    alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    return ''.join(secrets.choice(alphabet) for _ in range(12))
