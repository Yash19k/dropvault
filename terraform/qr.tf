# Short download links (endpoints/qr-link), used for copy-link, QR codes and email:
#   POST   /v1/users/{user_id}/files/{file_id}/qr           create a short link (owner)
#   DELETE /v1/users/{user_id}/files/{file_id}/qr           turn off all links to the file (owner)
#   GET    /v1/users/{user_id}/files/{file_id}/links        list links + download stats (owner)
#   DELETE /v1/users/{user_id}/files/{file_id}/links/{code} turn off one link (owner)
#   GET    /v1/d/{code}  public: 302 to a fresh S3 download, or a Download button
#                        page for links with a download limit
#   POST   /v1/d/{code}  public: that button (counts the download, then redirects)
# Lifetime and download limit are chosen per link (endpoints/common/python/links.py).

data "archive_file" "qr" {
  type        = "zip"
  source_dir  = "${path.module}/../endpoints/qr-link/src"
  output_path = "${path.module}/build/functions/qr.zip"
  excludes    = ["**/__pycache__/**"]
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
  layers           = [aws_lambda_layer_version.common.arn]

  environment {
    variables = local.file_env
  }
  depends_on = [aws_cloudwatch_log_group.qr]
}

# /v1/users/{user_id}/files/{file_id}/qr
resource "aws_api_gateway_resource" "qr" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.file_id.id
  path_part   = "qr"
}

# /v1/users/{user_id}/files/{file_id}/links and .../links/{code}
resource "aws_api_gateway_resource" "links" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.file_id.id
  path_part   = "links"
}
resource "aws_api_gateway_resource" "link_code" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.links.id
  path_part   = "{code}"
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
  authorizer_id        = aws_api_gateway_authorizer.token.id
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.qr.id
  http_method          = "POST"
  lambda_invoke_arn    = aws_lambda_function.qr.invoke_arn
  lambda_function_name = aws_lambda_function.qr.function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}

module "route_qr_revoke" {
  source               = "./modules/api-lambda-route"
  authorizer_id        = aws_api_gateway_authorizer.token.id
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.qr.id
  http_method          = "DELETE"
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

# The Download button on the page for links with a download limit (public).
module "route_qr_press" {
  source               = "./modules/api-lambda-route"
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.d_code.id
  http_method          = "POST"
  lambda_invoke_arn    = aws_lambda_function.qr.invoke_arn
  lambda_function_name = aws_lambda_function.qr.function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}

module "route_links_list" {
  source               = "./modules/api-lambda-route"
  authorizer_id        = aws_api_gateway_authorizer.token.id
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.links.id
  http_method          = "GET"
  lambda_invoke_arn    = aws_lambda_function.qr.invoke_arn
  lambda_function_name = aws_lambda_function.qr.function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}

module "route_link_revoke" {
  source               = "./modules/api-lambda-route"
  authorizer_id        = aws_api_gateway_authorizer.token.id
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.link_code.id
  http_method          = "DELETE"
  lambda_invoke_arn    = aws_lambda_function.qr.invoke_arn
  lambda_function_name = aws_lambda_function.qr.function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}

# The owner routes are called from the web app (need CORS); /v1/d is opened directly.
module "cors_qr" {
  source      = "./modules/cors-options"
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.qr.id
}

module "cors_links" {
  source      = "./modules/cors-options"
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.links.id
}

module "cors_link_code" {
  source      = "./modules/cors-options"
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.link_code.id
}
