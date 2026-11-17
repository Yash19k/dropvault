variable "rest_api_id" { type = string }
variable "resource_id" { type = string }
variable "http_method" { type = string }
variable "lambda_invoke_arn" { type = string }
variable "lambda_function_name" { type = string }
variable "execution_arn" { type = string }

# Open method -> Lambda proxy integration. The bearer token is validated
# by the Lambda via the external auth service (/userinfo), keeping this API fully
# decoupled from the auth implementation.
resource "aws_api_gateway_method" "this" {
  rest_api_id      = var.rest_api_id
  resource_id      = var.resource_id
  http_method      = var.http_method
  authorization    = "NONE"
  api_key_required = false
}

resource "aws_api_gateway_integration" "this" {
  rest_api_id             = var.rest_api_id
  resource_id             = var.resource_id
  http_method             = aws_api_gateway_method.this.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = var.lambda_invoke_arn
}

resource "aws_lambda_permission" "this" {
  statement_id  = "apigw-${var.http_method}-${replace(var.resource_id, "/", "")}"
  action        = "lambda:InvokeFunction"
  function_name = var.lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${var.execution_arn}/*/*"
}

output "integration_id" { value = aws_api_gateway_integration.this.id }
