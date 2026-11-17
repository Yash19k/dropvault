#!/usr/bin/env bash
# One-command deploy of the whole stack:
#   1. terraform apply  (API, Lambdas, DynamoDB, S3, SES identity, CloudFront)
#   2. build web/ with the deployed API URL baked in
#   3. upload the build to the web bucket + invalidate CloudFront
# Usage (from anywhere):  bash terraform/deploy.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WEB="$HERE/../web"
cd "$HERE"

echo "==> terraform apply"
terraform init -input=false -upgrade >/dev/null
terraform apply -input=false -auto-approve -var-file=terraform.tfvars

API_URL="$(terraform output -raw api_url)"
WEB_URL="$(terraform output -raw web_url)"
HOSTING="$(terraform output -raw web_hosting)"
WEB_BUCKET="$(terraform output -raw web_bucket)"
DIST_ID="$(terraform output -raw cloudfront_distribution_id)"
AMPLIFY_APP="$(terraform output -raw amplify_app_id)"
PYBIN="$(awk -F'"' '/^python_bin/{print $2}' terraform.tfvars)"; PYBIN="${PYBIN:-python3}"
REGION="$(awk -F'"' '/^aws_region/{print $2}' terraform.tfvars)"
PROFILE="$(awk -F'"' '/^aws_profile/{print $2}' terraform.tfvars)"
AWS_ARGS=(--region "$REGION")
[ -n "$PROFILE" ] && AWS_ARGS+=(--profile "$PROFILE")
# aws.exe on Windows ends lines with \r\n - strip the \r from captured values
awsq() { aws "$@" "${AWS_ARGS[@]}" | tr -d '\r'; }

echo "==> building web app against $API_URL"
cd "$WEB"
[ -d node_modules ] || npm ci
VITE_AUTH_URL="$API_URL" VITE_FILE_URL="$API_URL" npx vite build --mode production

if [ "$HOSTING" = "amplify" ]; then
  echo "==> publishing to Amplify app $AMPLIFY_APP (branch main)"
  "$PYBIN" -c "import shutil; shutil.make_archive('site', 'zip', 'dist')"
  read -r JOB_ID UPLOAD_URL < <(awsq amplify create-deployment --app-id "$AMPLIFY_APP" \
    --branch-name main --query '[jobId, zipUploadUrl]' --output text)
  curl -sfg -X PUT -H "Content-Type: application/zip" --data-binary @site.zip "$UPLOAD_URL"
  rm -f site.zip
  aws amplify start-deployment --app-id "$AMPLIFY_APP" --branch-name main \
    --job-id "$JOB_ID" "${AWS_ARGS[@]}" >/dev/null
  for _ in $(seq 1 60); do
    STATUS="$(awsq amplify get-job --app-id "$AMPLIFY_APP" --branch-name main \
      --job-id "$JOB_ID" --query 'job.summary.status' --output text)"
    case "$STATUS" in
      SUCCEED) break ;;
      FAILED|CANCELLED) echo "Amplify deployment $STATUS"; exit 1 ;;
    esac
    sleep 5
  done
  echo "    Amplify job $JOB_ID: $STATUS"
else
  echo "==> uploading to s3://$WEB_BUCKET"
  # hashed assets: cache for a year; index.html: always revalidate
  aws s3 sync dist/assets "s3://$WEB_BUCKET/assets" --delete \
    --cache-control "public,max-age=31536000,immutable" "${AWS_ARGS[@]}"
  aws s3 sync dist "s3://$WEB_BUCKET" --delete --exclude "assets/*" \
    --cache-control "no-cache" "${AWS_ARGS[@]}"
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
    "${AWS_ARGS[@]}" >/dev/null
fi

echo
echo "Deployed."
echo "  Web app : $WEB_URL"
echo "  API     : $API_URL"
