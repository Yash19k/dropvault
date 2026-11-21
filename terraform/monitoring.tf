# Alerts: everything that goes wrong ends up on one SNS topic, which emails
# alert_email (AWS sends a confirmation link first). Three sources:
#
#   1. Errors in the logs. Every function's log group sends its ERROR lines to
#      the monitor Lambda, which emails the error itself. This also catches
#      errors the code handled by answering 500, which Lambda doesn't count as
#      errors (so the alarms below never see them).
#   2. A health check every health_check_minutes: the admin Health page's
#      checks plus requests from outside (website, API, a public link). Emails
#      when something breaks and when it is fixed.
#   3. CloudWatch alarms:
#      - any Lambda reporting errors (crashes, timeouts) in a 5-minute window
#      - the API answering with 5xx errors
#      - a spike of 4xx answers (throttling 429s, or someone probing the API)
#
# deploy.sh also runs the health check right after a deploy, and emails the
# topic when a deploy fails.

resource "aws_sns_topic" "alerts" {
  name = "${local.prefix}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  # Not the authorizer: it answers every expired or invalid token by raising
  # "Unauthorized" (how API Gateway is told to reply 401), which Lambda counts
  # as an error, so its alarm would go off on ordinary sign-outs. If it really
  # breaks, API Gateway answers 500 and the api_5xx alarm below catches it.
  all_lambda_names = concat(
    [for f in aws_lambda_function.fn : f.function_name],
    [aws_lambda_function.auth.function_name, aws_lambda_function.qr.function_name,
    aws_lambda_function.admin.function_name, aws_lambda_function.monitor.function_name],
  )

  # Log groups whose errors are emailed: every function but the monitor itself
  # (an error in it would email about itself in a loop; its alarm covers it).
  # The authorizer is included: the monitor skips its "Unauthorized" answers.
  watched_log_groups = merge(
    { for k, g in aws_cloudwatch_log_group.fn : k => g.name },
    {
      auth       = aws_cloudwatch_log_group.auth.name
      authorizer = aws_cloudwatch_log_group.authorizer.name
      qr         = aws_cloudwatch_log_group.qr.name
      admin      = aws_cloudwatch_log_group.admin.name
    },
  )
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each            = toset(local.all_lambda_names)
  alarm_name          = "${each.key}-errors"
  alarm_description   = "Lambda ${each.key} reported errors (crashes or timeouts). Check its CloudWatch logs."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.key }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.prefix}-api-5xx"
  alarm_description   = "The API answered with server errors (5xx)."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5XXError"
  dimensions          = { ApiName = aws_api_gateway_rest_api.api.name, Stage = aws_api_gateway_stage.this.stage_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "api_4xx_spike" {
  alarm_name          = "${local.prefix}-api-4xx-spike"
  alarm_description   = "Unusually many 4xx answers: throttling (429, see api_throttle_rate / api_throttle_burst) or someone probing the API."
  namespace           = "AWS/ApiGateway"
  metric_name         = "4XXError"
  dimensions          = { ApiName = aws_api_gateway_rest_api.api.name, Stage = aws_api_gateway_stage.this.stage_name }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 200
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

# --- the monitor Lambda (endpoints/admin/src/monitor.py) ----------------------
# Same code package as the admin Lambda (it reuses health.py), its own role:
# read-only health checks, plus publishing to the topic and its state table.

# What was last emailed: per-function cooldowns and the last health check.
resource "aws_dynamodb_table" "monitor" {
  name         = "${local.prefix}-monitor"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }
}

resource "aws_cloudwatch_log_group" "monitor" {
  name              = "/aws/lambda/${local.prefix}-monitor"
  retention_in_days = 14
}

resource "aws_iam_role" "monitor" {
  name = "${local.prefix}-monitor-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "monitor_basic" {
  role       = aws_iam_role.monitor.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "monitor" {
  name = "${local.prefix}-monitor-policy"
  role = aws_iam_role.monitor.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      local.health_read_statements,
      [
        {
          Effect   = "Allow"
          Action   = ["sns:Publish"]
          Resource = aws_sns_topic.alerts.arn
        },
        {
          Effect   = "Allow"
          Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
          Resource = aws_dynamodb_table.monitor.arn
        },
        {
          # the health checks time one read of each table
          Effect   = "Allow"
          Action   = ["dynamodb:GetItem"]
          Resource = [aws_dynamodb_table.files.arn, aws_dynamodb_table.users.arn]
        },
      ],
      # the encryption check reads the key's state and rotation, or counts user keys
      var.kms_mode == "s3" ? [] : [{
        Effect   = "Allow"
        Action   = var.kms_mode == "shared" ? ["kms:DescribeKey", "kms:GetKeyRotationStatus"] : ["kms:ListAliases"]
        Resource = "*"
      }],
    )
  })
}

resource "aws_lambda_function" "monitor" {
  function_name    = "${local.prefix}-monitor"
  filename         = data.archive_file.admin.output_path
  source_code_hash = data.archive_file.admin.output_base64sha256
  handler          = "monitor.lambda_handler"
  runtime          = var.lambda_runtime
  role             = aws_iam_role.monitor.arn
  timeout          = 60
  memory_size      = 256
  layers           = [aws_lambda_layer_version.common.arn]

  environment {
    variables = merge(local.file_env, {
      USERS_TABLE            = aws_dynamodb_table.users.name
      APP_NAME               = var.display_name
      API_NAME               = "${local.prefix}-api"
      API_ID                 = aws_api_gateway_rest_api.api.id
      API_STAGE              = var.environment
      API_URL                = local.domain_enabled ? "https://${var.api_domain_name}" : aws_api_gateway_stage.this.invoke_url
      WEB_URL                = local.web_url
      SENDER_EMAIL           = var.sender_email
      CLEANUP_FUNCTION       = "${local.prefix}-cleanup"
      ALARM_PREFIX           = "${local.prefix}-"
      LAMBDA_NAMES           = join(",", local.admin_lambda_names)
      ALERTS_TOPIC_ARN       = aws_sns_topic.alerts.arn
      MONITOR_TABLE          = aws_dynamodb_table.monitor.name
      ALERT_COOLDOWN_MINUTES = tostring(var.alert_cooldown_minutes)
      HEALTH_CHECK_MINUTES   = tostring(var.health_check_minutes)
      ALERT_UTC_OFFSET       = var.alert_utc_offset
    })
  }
  depends_on = [aws_cloudwatch_log_group.monitor, aws_iam_role_policy.monitor]
}

# Errors in the logs -> monitor
resource "aws_lambda_permission" "monitor_logs" {
  statement_id  = "AllowCloudWatchLogs"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.monitor.function_name
  principal     = "logs.amazonaws.com"
  source_arn    = "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/${local.prefix}-*:*"
}

resource "aws_cloudwatch_log_subscription_filter" "errors" {
  for_each        = local.watched_log_groups
  name            = "${local.prefix}-errors-to-monitor"
  log_group_name  = each.value
  filter_pattern  = "?ERROR ?\"Task timed out\" ?\"Runtime exited\""
  destination_arn = aws_lambda_function.monitor.arn
  depends_on      = [aws_lambda_permission.monitor_logs]
}

# The health check schedule -> monitor
resource "aws_cloudwatch_event_rule" "health_check" {
  count               = var.health_check_minutes > 0 ? 1 : 0
  name                = "${local.prefix}-health-check"
  description         = "Runs the ${var.display_name} health check and emails problems."
  schedule_expression = var.health_check_minutes == 1 ? "rate(1 minute)" : "rate(${var.health_check_minutes} minutes)"
}

resource "aws_cloudwatch_event_target" "health_check" {
  count = var.health_check_minutes > 0 ? 1 : 0
  rule  = aws_cloudwatch_event_rule.health_check[0].name
  arn   = aws_lambda_function.monitor.arn
}

resource "aws_lambda_permission" "monitor_schedule" {
  count         = var.health_check_minutes > 0 ? 1 : 0
  statement_id  = "AllowHealthCheckSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.monitor.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.health_check[0].arn
}
