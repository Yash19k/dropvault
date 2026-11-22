# Function code is pure Python (shared code and deps live in the layers), so
# Terraform zips it directly at plan time - no external build step for it.
data "archive_file" "fn" {
  for_each    = local.functions
  type        = "zip"
  source_dir  = "${path.module}/../endpoints/${each.value.dir}/src"
  output_path = "${path.module}/build/functions/${each.key}.zip"
  excludes    = ["**/__pycache__/**"]
}

resource "aws_lambda_function" "fn" {
  for_each = local.functions

  function_name    = "${local.prefix}-${each.key}"
  filename         = data.archive_file.fn[each.key].output_path
  source_code_hash = data.archive_file.fn[each.key].output_base64sha256
  handler          = "${each.value.module}.lambda_handler"
  runtime          = var.lambda_runtime
  role             = aws_iam_role.lambda.arn
  timeout          = 30
  memory_size      = 512 # 2x the CPU of 256 MB: cold starts and boto3 calls about twice as fast, similar cost
  layers = concat([aws_lambda_layer_version.common.arn],
  [for l in each.value.layers : aws_lambda_layer_version.layers[l].arn])

  environment {
    variables = merge(
      local.file_env,
      each.key == "share" ? {
        SENDER_EMAIL   = var.sender_email
        SENDER_SES_ARN = local.sender_ses_arn
        APP_NAME       = var.display_name
      } : {},
      # Site heartbeats (analytics.tf). With the built-in auth service the
      # function checks session tokens itself, to link a visit to its account.
      each.key == "presence" ? merge(
        {
          ANALYTICS_TABLE = aws_dynamodb_table.analytics.name
          PRESENCE_PER_IP = tostring(var.presence_per_ip)
        },
        var.auth_endpoint == "" ? { TOKEN_SECRET = random_password.token_secret.result } : {}
      ) : {}
    )
  }
  depends_on = [aws_cloudwatch_log_group.fn]
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.functions
  name              = "/aws/lambda/${local.prefix}-${each.key}"
  retention_in_days = 14
}
