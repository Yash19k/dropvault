# Admin panel API (endpoints/admin): everything in the app, for admins only.
#   ANY /v1/admin/{proxy+}   overview, users, files, links, activity, system
# It runs the Lambda authorizer like every other protected route, and the
# Lambda then checks that the caller is an admin (role "admin" on their
# account, or listed in var.admin_emails).
#
# It has its own IAM role: it is the only function that reads whole tables
# (Scan), changes other people's accounts and reads CloudWatch. The health
# page's checks only read (describe / get / list) this app's own resources.

locals {
  # Every Lambda in the app, for the admin panel's health page. Built from
  # names, not resources, so the admin Lambda doesn't depend on itself.
  admin_lambda_names = concat(
    [for k, _ in local.functions : "${local.prefix}-${k}"],
    ["${local.prefix}-auth", "${local.prefix}-qr", "${local.prefix}-authorizer", "${local.prefix}-admin"],
  )
}

data "archive_file" "admin" {
  type        = "zip"
  source_dir  = "${path.module}/../endpoints/admin/src"
  output_path = "${path.module}/build/functions/admin.zip"
  excludes    = ["**/__pycache__/**"]
}

resource "aws_cloudwatch_log_group" "admin" {
  name              = "/aws/lambda/${local.prefix}-admin"
  retention_in_days = 14
}

resource "aws_iam_role" "admin" {
  name = "${local.prefix}-admin-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "admin_basic" {
  role       = aws_iam_role.admin.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "admin" {
  name = "${local.prefix}-admin-policy"
  role = aws_iam_role.admin.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        # download (presigned GET) and delete any file, abort unfinished uploads
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
        Resource = "${aws_s3_bucket.files.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:Scan", "dynamodb:Query", "dynamodb:GetItem", "dynamodb:PutItem",
          "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"
        ]
        Resource = [aws_dynamodb_table.files.arn, "${aws_dynamodb_table.files.arn}/index/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["dynamodb:Scan", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"]
        Resource = aws_dynamodb_table.users.arn
      },
      {
        # health: table status, TTL and stream
        Effect   = "Allow"
        Action   = ["dynamodb:DescribeTable", "dynamodb:DescribeTimeToLive"]
        Resource = [aws_dynamodb_table.files.arn, aws_dynamodb_table.users.arn]
      },
      {
        # health: the bucket answers, is encrypted and blocks public access
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetEncryptionConfiguration", "s3:GetBucketPublicAccessBlock"]
        Resource = aws_s3_bucket.files.arn
      },
      {
        # health: the API stage
        Effect   = "Allow"
        Action   = ["apigateway:GET"]
        Resource = "arn:aws:apigateway:${var.aws_region}::/restapis/${aws_api_gateway_rest_api.api.id}/stages/${var.environment}"
      },
      {
        # health: this app's functions
        Effect   = "Allow"
        Action   = ["lambda:GetFunctionConfiguration"]
        Resource = "arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${local.prefix}-*"
      },
      {
        # health: the cleanup trigger (this call can't be limited to resources)
        Effect   = "Allow"
        Action   = ["lambda:ListEventSourceMappings"]
        Resource = "*"
      },
      {
        # health: recent errors from this app's function logs
        Effect   = "Allow"
        Action   = ["logs:FilterLogEvents", "logs:GetLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/${local.prefix}-*"
      },
      {
        # health: sender verification, sandbox status and quota (account-level reads)
        Effect   = "Allow"
        Action   = ["ses:GetAccount", "ses:GetEmailIdentity", "ses:GetIdentityVerificationAttributes", "ses:GetSendQuota"]
        Resource = "*"
      },
      {
        # alarm states (read-only). Listing alarms by name prefix can't be
        # limited to resources: IAM checks it against "*" and denies otherwise.
        Effect   = "Allow"
        Action   = ["cloudwatch:DescribeAlarms"]
        Resource = "*"
      },
      {
        # GetMetricData can't be limited to resources
        Effect   = "Allow"
        Action   = ["cloudwatch:GetMetricData"]
        Resource = "*"
      },
      ],
      # Encrypted files: decrypt to download them; per_user also schedules a
      # deleted account's key for deletion. The health page reads the key's
      # state and rotation (shared) or counts the user keys (per_user).
      var.kms_mode == "s3" ? [] : [{
        Effect = "Allow"
        Action = concat(["kms:Decrypt", "kms:DescribeKey"],
          var.kms_mode == "shared" ? ["kms:GetKeyRotationStatus"] : [],
        var.kms_mode == "per_user" ? ["kms:ScheduleKeyDeletion", "kms:ListAliases"] : [])
        Resource = "*"
      }]
    )
  })
}

resource "aws_lambda_function" "admin" {
  function_name    = "${local.prefix}-admin"
  filename         = data.archive_file.admin.output_path
  source_code_hash = data.archive_file.admin.output_base64sha256
  handler          = "admin.lambda_handler"
  runtime          = var.lambda_runtime
  role             = aws_iam_role.admin.arn
  timeout          = 30
  memory_size      = 512 # password resets hash with PBKDF2; scans of big tables
  layers           = [aws_lambda_layer_version.common.arn]

  environment {
    variables = merge(local.file_env, {
      USERS_TABLE              = aws_dynamodb_table.users.name
      ADMIN_EMAILS             = join(",", var.admin_emails)
      APP_ENV                  = var.environment
      AUTH_MODE                = var.auth_endpoint == "" ? "built-in" : "external"
      AUTHORIZER_CACHE_SECONDS = tostring(var.authorizer_cache_seconds)
      API_THROTTLE_RATE        = tostring(var.api_throttle_rate)
      API_THROTTLE_BURST       = tostring(var.api_throttle_burst)
      ALERT_EMAIL_SET          = var.alert_email == "" ? "" : "1"
      API_NAME                 = "${local.prefix}-api"
      API_ID                   = aws_api_gateway_rest_api.api.id
      API_STAGE                = var.environment
      SENDER_EMAIL             = var.sender_email
      CLEANUP_FUNCTION         = "${local.prefix}-cleanup"
      ALARM_PREFIX             = "${local.prefix}-"
      LAMBDA_NAMES             = join(",", local.admin_lambda_names)
    })
  }
  depends_on = [aws_cloudwatch_log_group.admin, aws_iam_role_policy.admin]
}

# /v1/admin/{proxy+}
resource "aws_api_gateway_resource" "admin" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.v1.id
  path_part   = "admin"
}
resource "aws_api_gateway_resource" "admin_proxy" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.admin.id
  path_part   = "{proxy+}"
}

module "route_admin" {
  source               = "./modules/api-lambda-route"
  authorizer_id        = aws_api_gateway_authorizer.token.id
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.admin_proxy.id
  http_method          = "ANY"
  lambda_invoke_arn    = aws_lambda_function.admin.invoke_arn
  lambda_function_name = aws_lambda_function.admin.function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}

# The explicit OPTIONS method wins over ANY, so preflights skip the authorizer.
module "cors_admin" {
  source      = "./modules/cors-options"
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.admin_proxy.id
}
