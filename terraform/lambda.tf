# Function code is pure Python (deps live in the layers), so Terraform zips it
# directly at plan time - no external build step for the functions.
data "archive_file" "fn" {
  for_each    = local.functions
  type        = "zip"
  source_dir  = "${path.module}/../endpoints/${each.value.dir}/src"
  output_path = "${path.module}/build/functions/${each.key}.zip"
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
  memory_size      = 256
  layers           = [for l in each.value.layers : aws_lambda_layer_version.layers[l].arn]

  environment {
    variables = merge(
      {
        AUTH_ENDPOINT      = local.auth_endpoint
        FILE_SHARING_TABLE = aws_dynamodb_table.files.name
        REGION             = var.aws_region
        USER_FILES_BUCKET  = aws_s3_bucket.files.bucket
        KMS_MODE           = var.kms_mode
        KMS_ALIAS_PREFIX   = local.prefix
      },
      each.key == "share" ? {
        SENDER_EMAIL   = var.sender_email
        SENDER_SES_ARN = local.sender_ses_arn
        APP_NAME       = var.app_name
      } : {}
    )
  }
}

resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.functions
  name              = "/aws/lambda/${local.prefix}-${each.key}"
  retention_in_days = 14
}
