# Rate limits (endpoints/common/python/ratelimit.py): password guessing,
# sign-up floods, share-email spam and runaway record creation. One small
# on-demand table of fixed-window counters; DynamoDB TTL deletes each window
# once it's over, so it stays tiny. API Gateway's stage throttling
# (apigateway.tf) caps the whole API; these limits are per account / per IP,
# so one abuser can't use up everyone's share.

resource "aws_dynamodb_table" "rate_limits" {
  name         = "${var.app_name}-ratelimits-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}

resource "aws_iam_role_policy" "rate_limits" {
  name = "${local.prefix}-rate-limits"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
      Resource = aws_dynamodb_table.rate_limits.arn
    }]
  })
}

locals {
  # Limits the auth service applies (sign-in, sign-up, password change)
  auth_limits_env = {
    RATE_LIMIT_TABLE = aws_dynamodb_table.rate_limits.name
    LOGIN_PER_IP     = tostring(var.login_attempts_per_ip)
    LOGIN_FAILURES   = tostring(var.login_failures_per_account)
    SIGNUPS_PER_IP   = tostring(var.signups_per_ip)
  }
  # Limits the file and link Lambdas apply (merged into local.file_env)
  file_limits_env = {
    RATE_LIMIT_TABLE     = aws_dynamodb_table.rate_limits.name
    UPLOADS_PER_HOUR     = tostring(var.uploads_per_hour)
    MAX_PENDING_UPLOADS  = tostring(var.max_pending_uploads)
    SHARE_EMAILS_PER_DAY = tostring(var.share_emails_per_day)
    LINKS_PER_HOUR       = tostring(var.links_per_hour)
  }
}
