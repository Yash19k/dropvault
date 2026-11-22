# Site analytics for the admin panel's Analytics page and "online now"
# (endpoints/presence + endpoints/common/python/visits.py):
#   POST /v1/presence   public heartbeat from the web app, every 30 s while a
#                       tab is open, visible and in use
# The admin API reads the table (GET /v1/admin/analytics, /analytics/live).
# The presence function itself is in local.functions (locals.tf), so it gets
# the shared role, logs, alarms and a place on the health page like the rest.

# One item per browser tab per UTC day: pk "D#<day>", sk <tab id>.
resource "aws_dynamodb_table" "analytics" {
  name         = "${local.prefix}-analytics"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  # Visits are deleted after about 13 months
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

# The presence function writes heartbeats (shared Lambda role, write only).
resource "aws_iam_role_policy" "analytics_write" {
  name = "${local.prefix}-analytics-write"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:UpdateItem"]
      Resource = aws_dynamodb_table.analytics.arn
    }]
  })
}

# The admin API reads them (one Query per day).
resource "aws_iam_role_policy" "analytics_read" {
  name = "${local.prefix}-analytics-read"
  role = aws_iam_role.admin.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:Query"]
      Resource = aws_dynamodb_table.analytics.arn
    }]
  })
}

# /v1/presence (public: visitors who aren't signed in count too; the function
# links the visit to an account itself when a session token comes along)
resource "aws_api_gateway_resource" "presence" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.v1.id
  path_part   = "presence"
}

module "route_presence" {
  source               = "./modules/api-lambda-route"
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.presence.id
  http_method          = "POST"
  lambda_invoke_arn    = aws_lambda_function.fn["presence"].invoke_arn
  lambda_function_name = aws_lambda_function.fn["presence"].function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}

module "cors_presence" {
  source      = "./modules/cors-options"
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.presence.id
}
