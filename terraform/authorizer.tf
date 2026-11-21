# API Gateway Lambda authorizer (endpoints/authorizer): checks the caller's
# token once in front of every protected route, and API Gateway caches the
# answer per token, so the file Lambdas no longer call /v1/userinfo on every
# request. With the built-in auth service it verifies the token signature
# itself (TOKEN_SECRET); with an external auth_endpoint it asks /v1/userinfo.

data "archive_file" "authorizer" {
  type        = "zip"
  source_dir  = "${path.module}/../endpoints/authorizer/src"
  output_path = "${path.module}/build/functions/authorizer.zip"
  excludes    = ["**/__pycache__/**"]
}

resource "aws_cloudwatch_log_group" "authorizer" {
  name              = "/aws/lambda/${local.prefix}-authorizer"
  retention_in_days = 14
}

resource "aws_lambda_function" "authorizer" {
  function_name    = "${local.prefix}-authorizer"
  filename         = data.archive_file.authorizer.output_path
  source_code_hash = data.archive_file.authorizer.output_base64sha256
  handler          = "authorizer.lambda_handler"
  runtime          = var.lambda_runtime
  role             = aws_iam_role.lambda.arn
  timeout          = 10
  memory_size      = 256
  layers           = [aws_lambda_layer_version.common.arn]

  environment {
    variables = merge(
      { AUTH_ENDPOINT = local.auth_endpoint },
      # Only the built-in auth service's tokens (and accounts) can be checked here:
      # the signature, then that the account still exists, isn't suspended and
      # hasn't ended its sessions (logout, admin sign-out / password reset).
      var.auth_endpoint == "" ? {
        TOKEN_SECRET = random_password.token_secret.result
        USERS_TABLE  = aws_dynamodb_table.users.name
      } : {}
    )
  }
  depends_on = [aws_cloudwatch_log_group.authorizer]
}

resource "aws_api_gateway_authorizer" "token" {
  name                             = "${local.prefix}-token"
  rest_api_id                      = aws_api_gateway_rest_api.api.id
  type                             = "TOKEN"
  authorizer_uri                   = aws_lambda_function.authorizer.invoke_arn
  identity_source                  = "method.request.header.Authorization"
  identity_validation_expression   = "^Bearer [-0-9A-Za-z._~+/=]+$"
  authorizer_result_ttl_in_seconds = var.authorizer_cache_seconds
}

resource "aws_lambda_permission" "authorizer" {
  statement_id  = "apigw-authorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api.execution_arn}/authorizers/${aws_api_gateway_authorizer.token.id}"
}

# A rejected token is answered by API Gateway itself (401), not by a Lambda.
# Without CORS headers on those answers the browser hides the 401 from the web
# app, which then can't renew the session - so add them to every 4xx/5xx
# API Gateway generates.
resource "aws_api_gateway_gateway_response" "cors" {
  for_each      = toset(["DEFAULT_4XX", "DEFAULT_5XX"])
  rest_api_id   = aws_api_gateway_rest_api.api.id
  response_type = each.key
  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'*'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'GET,POST,PATCH,DELETE,OPTIONS'"
  }
}
