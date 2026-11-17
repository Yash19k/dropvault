# Short, scannable download links for QR codes (endpoints/qr-link):
#   POST /v1/users/{user_id}/files/{file_id}/qr  -> create a short link (owner only)
#   GET  /v1/d/{code}                             -> public 302 to a fresh S3 download

data "archive_file" "qr" {
  type        = "zip"
  source_dir  = "${path.module}/../endpoints/qr-link/src"
  output_path = "${path.module}/build/functions/qr.zip"
}

resource "aws_cloudwatch_log_group" "qr" {
  name              = "/aws/lambda/${local.prefix}-qr"
  retention_in_days = 14
}

resource "aws_lambda_function" "qr" {
  function_name    = "${local.prefix}-qr"
  filename         = data.archive_file.qr.output_path
  source_code_hash = data.archive_file.qr.output_base64sha256
  handler          = "qr_link.lambda_handler"
  runtime          = var.lambda_runtime
  role             = aws_iam_role.lambda.arn # S3 get + files-table access already granted
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      AUTH_ENDPOINT      = local.auth_endpoint
      FILE_SHARING_TABLE = aws_dynamodb_table.files.name
      REGION             = var.aws_region
      USER_FILES_BUCKET  = aws_s3_bucket.files.bucket
      QR_LINK_TTL        = "3600"
    }
  }
  depends_on = [aws_cloudwatch_log_group.qr]
}

# /v1/users/{user_id}/files/{file_id}/qr
resource "aws_api_gateway_resource" "qr" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.file_id.id
  path_part   = "qr"
}

# /v1/d/{code}
resource "aws_api_gateway_resource" "d" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.v1.id
  path_part   = "d"
}
resource "aws_api_gateway_resource" "d_code" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.d.id
  path_part   = "{code}"
}

module "route_qr_create" {
  source               = "./modules/api-lambda-route"
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.qr.id
  http_method          = "POST"
  lambda_invoke_arn    = aws_lambda_function.qr.invoke_arn
  lambda_function_name = aws_lambda_function.qr.function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}

module "route_qr_follow" {
  source               = "./modules/api-lambda-route"
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.d_code.id
  http_method          = "GET"
  lambda_invoke_arn    = aws_lambda_function.qr.invoke_arn
  lambda_function_name = aws_lambda_function.qr.function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}

# Only the create call comes from the web app (needs CORS); /v1/d is opened directly.
module "cors_qr" {
  source      = "./modules/cors-options"
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.qr.id
}
