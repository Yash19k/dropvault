#!/usr/bin/env bash
# Set up an owner admin's account (an address in admin_emails), or give it a
# new temporary password if it already exists (forgotten password, lost access).
#
#   bash terraform/admin-account.sh                    # the first address in admin_emails
#   bash terraform/admin-account.sh you@example.com "Your Name"
#
# Owner addresses can't be signed up for on the website: there is no email
# verification, so whoever registered the address first would become an admin.
# This script invokes the auth Lambda directly instead, which needs AWS
# credentials for the account (the same ones deploy.sh uses). It prints a
# temporary password: sign in with it, then change it under your name in the
# sidebar. Every existing session of the account is signed out.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"
REGION="$(awk -F'"' '/^aws_region/{print $2}' terraform.tfvars)"
PROFILE="$(awk -F'"' '/^aws_profile/{print $2}' terraform.tfvars)"
PYBIN="$(awk -F'"' '/^python_bin/{print $2}' terraform.tfvars)"; PYBIN="${PYBIN:-python3}"
AWS_ARGS=(--region "$REGION")
[ -n "$PROFILE" ] && AWS_ARGS+=(--profile "$PROFILE")

FUNCTION="$(terraform output -raw auth_function | tr -d '\r')"
OWNERS="$(terraform output -raw owner_admins | tr -d '\r')"
EMAIL="$(printf '%s' "${1:-${OWNERS%%,*}}" | tr '[:upper:]' '[:lower:]')"
NAME="${2:-}"
if [ -z "$EMAIL" ]; then
  echo "No owner admin: add your address to admin_emails in terraform.tfvars and run deploy.sh first." >&2
  exit 1
fi

OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT
PAYLOAD="$("$PYBIN" -c 'import json, sys; print(json.dumps({"action": "owner_password", "email": sys.argv[1], "name": sys.argv[2]}))' "$EMAIL" "$NAME")"
aws lambda invoke --function-name "$FUNCTION" --cli-binary-format raw-in-base64-out \
  --payload "$PAYLOAD" "$OUT" "${AWS_ARGS[@]}" >/dev/null

PYTHONIOENCODING=utf-8 "$PYBIN" - "$OUT" <<'PY'
import json, sys
result = json.load(open(sys.argv[1], encoding='utf-8'))
if 'temporary_password' not in result:
    sys.exit('Could not set up the account: {0}'.format(result.get('error') or result.get('errorMessage') or result))
print('{0} the account of {1}.'.format('Created' if result['created'] else 'Reset the password of', result['email']))
print('  Temporary password: {0}'.format(result['temporary_password']))
print('  Sign in with it, then change it under your name in the sidebar (Change password).')
PY
