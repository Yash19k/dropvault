# Built-in simple auth service (email + password), served from the SAME API as
# the file routes:  /v1/users (POST), /v1/login, /v1/userinfo, /v1/logout,
# /v1/refresh-token, /v1/password (change password). File routes are protected by the Lambda authorizer
# (authorizer.tf), which checks these tokens itself; pointing auth_endpoint at
# an external service instead makes it ask that service's /v1/userinfo.

locals {
  # The API's own stage URL, built from ids that don't depend on the Lambdas
  # (using aws_api_gateway_stage.invoke_url here would be a dependency cycle).
  self_api_url  = "https://${aws_api_gateway_rest_api.api.id}.execute-api.${var.aws_region}.amazonaws.com/${var.environment}"
  auth_endpoint = var.auth_endpoint != "" ? var.auth_endpoint : local.self_api_url
}

resource "aws_dynamodb_table" "users" {
  name         = "${var.app_name}-users-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"

  attribute {
    name = "email"
    type = "S"
  }

  # Restore the accounts to any second of the last 35 days (cents a month)
  point_in_time_recovery { enabled = true }
}

# HMAC key that signs the session tokens.
resource "random_password" "token_secret" {
  length  = 48
  special = false
}

data "archive_file" "auth" {
  type        = "zip"
  source_dir  = "${path.module}/../endpoints/auth-service/src"
  output_path = "${path.module}/build/functions/auth.zip"
  excludes    = ["**/__pycache__/**"]
}

resource "aws_iam_role_policy" "auth_users" {
  name = "${local.prefix}-auth-users"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"] # UpdateItem: logout revokes refresh tokens
      Resource = aws_dynamodb_table.users.arn
    }]
  })
}

resource "aws_lambda_function" "auth" {
  function_name    = "${local.prefix}-auth"
  filename         = data.archive_file.auth.output_path
  source_code_hash = data.archive_file.auth.output_base64sha256
  handler          = "auth_service.lambda_handler"
  runtime          = var.lambda_runtime
  role             = aws_iam_role.lambda.arn
  timeout          = 15
  memory_size      = 1024                                  # PBKDF2 is CPU-bound; more memory = more CPU = faster logins
  layers           = [aws_lambda_layer_version.common.arn] # tokens.py

  environment {
    variables = merge(local.auth_limits_env, {
      USERS_TABLE  = aws_dynamodb_table.users.name
      TOKEN_SECRET = random_password.token_secret.result
      ADMIN_EMAILS = join(",", var.admin_emails) # so sign-in can tell the web app who is an admin
    })
  }
  depends_on = [aws_cloudwatch_log_group.auth]
}

resource "aws_cloudwatch_log_group" "auth" {
  name              = "/aws/lambda/${local.prefix}-auth"
  retention_in_days = 14
}

# --- Resources under /v1 (/v1/users already exists in apigateway.tf) ---
resource "aws_api_gateway_resource" "auth" {
  for_each    = toset(["login", "userinfo", "logout", "refresh-token", "password"])
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.v1.id
  path_part   = each.key
}

locals {
  auth_routes = {
    signup   = { resource_id = aws_api_gateway_resource.users.id, method = "POST" }
    login    = { resource_id = aws_api_gateway_resource.auth["login"].id, method = "POST" }
    info     = { resource_id = aws_api_gateway_resource.auth["userinfo"].id, method = "GET" }
    logout   = { resource_id = aws_api_gateway_resource.auth["logout"].id, method = "POST" }
    refresh  = { resource_id = aws_api_gateway_resource.auth["refresh-token"].id, method = "POST" }
    password = { resource_id = aws_api_gateway_resource.auth["password"].id, method = "POST" }
  }
}

module "route_auth" {
  for_each             = local.auth_routes
  source               = "./modules/api-lambda-route"
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = each.value.resource_id
  http_method          = each.value.method
  lambda_invoke_arn    = aws_lambda_function.auth.invoke_arn
  lambda_function_name = aws_lambda_function.auth.function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}

module "cors_auth" {
  for_each = {
    users         = aws_api_gateway_resource.users.id
    login         = aws_api_gateway_resource.auth["login"].id
    userinfo      = aws_api_gateway_resource.auth["userinfo"].id
    logout        = aws_api_gateway_resource.auth["logout"].id
    refresh-token = aws_api_gateway_resource.auth["refresh-token"].id
    password      = aws_api_gateway_resource.auth["password"].id
  }
  source      = "./modules/cors-options"
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = each.value
}
