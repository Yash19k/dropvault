# Alerts: an SNS topic that CloudWatch alarms publish to when something breaks.
# Set alert_email to get them by email (AWS sends a confirmation link first).
#
#   - any Lambda reporting errors (crashes, timeouts) in a 5-minute window
#   - the API answering with 5xx errors
#   - a spike of 4xx answers (throttling 429s, or someone probing the API)

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
  all_lambda_names = concat(
    [for f in aws_lambda_function.fn : f.function_name],
    [aws_lambda_function.auth.function_name, aws_lambda_function.qr.function_name,
    aws_lambda_function.authorizer.function_name, aws_lambda_function.admin.function_name],
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
