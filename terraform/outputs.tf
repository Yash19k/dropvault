output "api_url" {
  description = "Use this as VITE_FILE_URL in the web app (custom domain if set, else the default execute-api URL)"
  value       = local.domain_enabled ? "https://${var.api_domain_name}" : aws_api_gateway_stage.this.invoke_url
}

output "api_base_url" {
  description = "The raw execute-api stage URL"
  value       = aws_api_gateway_stage.this.invoke_url
}


output "files_bucket" {
  value = aws_s3_bucket.files.bucket
}

output "dynamodb_table" {
  value = aws_dynamodb_table.files.name
}

output "web_url" {
  description = "The deployed web app"
  value       = local.web_url
}

output "admin_url" {
  description = "The admin panel (sign in with an account listed in admin_emails)"
  value       = "${local.web_url}/admin"
}

output "web_hosting" {
  value = var.web_hosting
}

output "web_bucket" {
  value = local.use_cloudfront ? aws_s3_bucket.web[0].bucket : ""
}

output "cloudfront_distribution_id" {
  value = local.use_cloudfront ? aws_cloudfront_distribution.web[0].id : ""
}

output "amplify_app_id" {
  value = local.use_amplify ? aws_amplify_app.web[0].id : ""
}

output "amplify_branch" {
  value = local.use_amplify ? aws_amplify_branch.app[0].branch_name : ""
}

output "amplify_redirect_branches" {
  description = "Space-separated; deploy.sh publishes the redirect page to each"
  value       = join(" ", [for b in aws_amplify_branch.redirect : b.branch_name])
}

output "users_table" {
  value = aws_dynamodb_table.users.name
}

output "alerts_topic_arn" {
  description = "SNS topic the CloudWatch alarms publish to (subscribe more endpoints if you like)"
  value       = aws_sns_topic.alerts.arn
}

output "monitor_function" {
  description = "The monitor Lambda (log-error emails + scheduled health check). deploy.sh runs it after a deploy."
  value       = aws_lambda_function.monitor.function_name
}

output "owner_admins" {
  description = "Owner admins (admin_emails), comma-separated. Set up or recover their accounts with admin-account.sh"
  value       = join(",", var.admin_emails)
}

output "auth_function" {
  description = "The auth Lambda; admin-account.sh invokes it directly to set up an owner admin's account"
  value       = aws_lambda_function.auth.function_name
}
