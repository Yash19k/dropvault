#!/usr/bin/env bash
# Delete the per-user KMS keys + aliases that the upload Lambda creates at
# RUNTIME (Terraform doesn't manage them, so they'd be orphaned on destroy).
# Invoked by a destroy-time provisioner on `terraform destroy` / `make destroy`.
# Env: PREFIX (required, = app-env), REGION, PROFILE (optional).
set -uo pipefail

REGION="${REGION:-eu-west-1}"
PREFIX="${PREFIX:?PREFIX is required}"
PROFILE_ARG=""
[ -n "${PROFILE:-}" ] && PROFILE_ARG="--profile ${PROFILE}"

echo "Cleaning up runtime KMS keys/aliases tagged app=${PREFIX} in ${REGION}..."

# 1) Delete per-user aliases: alias/<prefix>/user/*
for alias_name in $(aws kms list-aliases $PROFILE_ARG --region "$REGION" \
    --query "Aliases[?starts_with(AliasName, 'alias/${PREFIX}/user/')].AliasName" \
    --output text 2>/dev/null); do
  aws kms delete-alias --alias-name "$alias_name" $PROFILE_ARG --region "$REGION" 2>/dev/null \
    && echo "  deleted alias $alias_name"
done

# 2) Schedule deletion of every customer key tagged app=<prefix> (stops billing
#    immediately; AWS enforces a 7-day minimum window).
for kid in $(aws kms list-keys $PROFILE_ARG --region "$REGION" --query 'Keys[].KeyId' --output text 2>/dev/null); do
  app=$(aws kms list-resource-tags --key-id "$kid" $PROFILE_ARG --region "$REGION" \
        --query "Tags[?TagKey=='app'].TagValue | [0]" --output text 2>/dev/null || echo "")
  [ "$app" != "$PREFIX" ] && continue
  state=$(aws kms describe-key --key-id "$kid" $PROFILE_ARG --region "$REGION" \
          --query 'KeyMetadata.KeyState' --output text 2>/dev/null || echo "")
  if [ "$state" = "Enabled" ] || [ "$state" = "Disabled" ]; then
    aws kms schedule-key-deletion --key-id "$kid" --pending-window-in-days 7 \
      $PROFILE_ARG --region "$REGION" >/dev/null 2>&1 \
      && echo "  scheduled deletion of key $kid"
  fi
done

echo "KMS cleanup done."
