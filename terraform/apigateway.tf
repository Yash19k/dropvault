resource "aws_api_gateway_rest_api" "api" {
  name        = "${local.prefix}-api"
  description = "${var.app_name} file sharing API (${var.environment})"
  endpoint_configuration { types = ["REGIONAL"] }
}

# --- Resource tree: /v1/users/{user_id}/files/{file_id}/{complete,download,share}
resource "aws_api_gateway_resource" "v1" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_rest_api.api.root_resource_id
  path_part   = "v1"
}
resource "aws_api_gateway_resource" "users" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.v1.id
  path_part   = "users"
}
resource "aws_api_gateway_resource" "user_id" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.users.id
  path_part   = "{user_id}"
}
resource "aws_api_gateway_resource" "files" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.user_id.id
  path_part   = "files"
}
resource "aws_api_gateway_resource" "file_id" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.files.id
  path_part   = "{file_id}"
}
resource "aws_api_gateway_resource" "complete" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.file_id.id
  path_part   = "complete"
}
resource "aws_api_gateway_resource" "download" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.file_id.id
  path_part   = "download"
}
resource "aws_api_gateway_resource" "share" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  parent_id   = aws_api_gateway_resource.file_id.id
  path_part   = "share"
}

# --- Routes (method + integration + lambda permission) ---
module "route_list" {
  source               = "./modules/api-lambda-route"
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.files.id
  http_method          = "GET"
  lambda_invoke_arn    = aws_lambda_function.fn["list"].invoke_arn
  lambda_function_name = aws_lambda_function.fn["list"].function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}
module "route_create" {
  source               = "./modules/api-lambda-route"
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.files.id
  http_method          = "POST"
  lambda_invoke_arn    = aws_lambda_function.fn["create-upload"].invoke_arn
  lambda_function_name = aws_lambda_function.fn["create-upload"].function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}
module "route_delete" {
  source               = "./modules/api-lambda-route"
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.file_id.id
  http_method          = "DELETE"
  lambda_invoke_arn    = aws_lambda_function.fn["delete"].invoke_arn
  lambda_function_name = aws_lambda_function.fn["delete"].function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}
module "route_complete" {
  source               = "./modules/api-lambda-route"
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.complete.id
  http_method          = "POST"
  lambda_invoke_arn    = aws_lambda_function.fn["complete"].invoke_arn
  lambda_function_name = aws_lambda_function.fn["complete"].function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}
module "route_download" {
  source               = "./modules/api-lambda-route"
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.download.id
  http_method          = "GET"
  lambda_invoke_arn    = aws_lambda_function.fn["download"].invoke_arn
  lambda_function_name = aws_lambda_function.fn["download"].function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}
module "route_share" {
  source               = "./modules/api-lambda-route"
  rest_api_id          = aws_api_gateway_rest_api.api.id
  resource_id          = aws_api_gateway_resource.share.id
  http_method          = "POST"
  lambda_invoke_arn    = aws_lambda_function.fn["share"].invoke_arn
  lambda_function_name = aws_lambda_function.fn["share"].function_name
  execution_arn        = aws_api_gateway_rest_api.api.execution_arn
}

# --- CORS preflight on every browser-facing resource ---
module "cors_files" {
  source      = "./modules/cors-options"
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.files.id
}
module "cors_file_id" {
  source      = "./modules/cors-options"
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.file_id.id
}
module "cors_complete" {
  source      = "./modules/cors-options"
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.complete.id
}
module "cors_download" {
  source      = "./modules/cors-options"
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.download.id
}
module "cors_share" {
  source      = "./modules/cors-options"
  rest_api_id = aws_api_gateway_rest_api.api.id
  resource_id = aws_api_gateway_resource.share.id
}

# --- Deployment + stage ---
resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  # Redeploy whenever the API definition (routes, methods, authorizer, CORS) or
  # any integration changes - hashing the defining files catches method/auth
  # changes that don't alter integration ids.
  triggers = {
    redeploy = sha1(join(",", concat(
      [
        filesha1("${path.module}/apigateway.tf"),
        filesha1("${path.module}/auth.tf"),
        filesha1("${path.module}/qr.tf"),
        filesha1("${path.module}/modules/api-lambda-route/main.tf"),
        filesha1("${path.module}/modules/cors-options/main.tf"),
      ],
      [
        module.route_list.integration_id, module.route_create.integration_id,
        module.route_delete.integration_id, module.route_complete.integration_id,
        module.route_download.integration_id, module.route_share.integration_id,
        module.cors_files.integration_id, module.cors_file_id.integration_id,
        module.cors_complete.integration_id, module.cors_download.integration_id,
        module.cors_share.integration_id,
      ],
      [for r in module.route_auth : r.integration_id],
      [for c in module.cors_auth : c.integration_id],
      [module.route_qr_create.integration_id, module.route_qr_follow.integration_id,
        module.route_qr_revoke.integration_id,
      module.cors_qr.integration_id],
    )))
  }
  lifecycle { create_before_destroy = true }
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id   = aws_api_gateway_rest_api.api.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = var.environment
}


# Stage-wide throttling: caps password guessing on /v1/login, share-email spam
# and runaway Lambda/S3 costs. Excess requests get 429 Too Many Requests.
resource "aws_api_gateway_method_settings" "throttle" {
  rest_api_id = aws_api_gateway_rest_api.api.id
  stage_name  = aws_api_gateway_stage.this.stage_name
  method_path = "*/*"
  settings {
    throttling_burst_limit = var.api_throttle_burst
    throttling_rate_limit  = var.api_throttle_rate
  }
}
