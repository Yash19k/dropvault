variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "eu-west-1"
}

variable "aws_profile" {
  description = "Optional AWS CLI profile name (leave empty to use the default credential chain)"
  type        = string
  default     = ""
}

variable "app_name" {
  description = "Product / resource name prefix"
  type        = string
  default     = "enclave"
}

variable "display_name" {
  description = "Product name shown to people (e.g. in share emails). Separate from app_name, which prefixes AWS resource names."
  type        = string
  default     = "DropVault"
}

variable "environment" {
  description = "Deployment environment (also the API Gateway stage name)"
  type        = string
  default     = "dev"
}

variable "lambda_runtime" {
  description = "Python runtime for the function code"
  type        = string
  default     = "python3.13"
}

variable "bash_bin" {
  description = "bash used for the build/cleanup scripts. On Windows: the Git Bash path, e.g. C:/Program Files/Git/bin/bash.exe"
  type        = string
  default     = "/bin/bash"
}

variable "python_bin" {
  description = "Local python executable used to build the dependency layers"
  type        = string
  default     = "python3"
}

# --- Encryption ---
variable "kms_mode" {
  description = "File encryption mode: 's3' (SSE-S3, free), 'shared' (one customer-managed KMS key), or 'per_user' (one KMS key per user - strongest isolation, ~$1/user/mo)"
  type        = string
  default     = "s3"
  validation {
    condition     = contains(["s3", "shared", "per_user"], var.kms_mode)
    error_message = "kms_mode must be one of: s3, shared, per_user."
  }
}

# --- Auth microservice (external, independent) ---
# DropVault knows the auth service ONLY by its endpoint. It validates and
# resolves callers via {auth_endpoint}/v1/userinfo - never touching the auth
# implementation, its identity store, or its infrastructure.
variable "auth_endpoint" {
  description = "Base URL of an external auth microservice. Empty = use the built-in simple auth service (auth.tf) on this same API."
  type        = string
  default     = ""
}

# --- Custom domain (optional; DropVault creates its OWN ACM cert) ---
variable "api_domain_name" {
  description = "Custom domain for this API, e.g. files.example.com. Empty = use the default execute-api URL."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Route53 hosted zone id for api_domain_name (required when api_domain_name is set)"
  type        = string
  default     = ""
}

# --- Storage ---
variable "files_bucket_name" {
  description = "Globally-unique S3 bucket name for stored files. Empty = <app>-files-<env>-<account id>."
  type        = string
  default     = ""
}

variable "table_name" {
  description = "DynamoDB table name (partition key: file_id)"
  type        = string
  default     = ""
}

# --- Email sharing (Amazon SES) ---
variable "sender_email" {
  description = "Verified SES sender address used for share emails"
  type        = string
}

variable "sender_ses_arn" {
  description = "ARN of an already-verified SES identity for the sender. Empty = Terraform creates an email identity for sender_email (see ses.tf)."
  type        = string
  default     = ""
}

# --- CORS ---
variable "allowed_origins" {
  description = "Origins allowed to PUT/GET directly against S3 (your frontend URLs)"
  type        = list(string)
  default     = ["http://localhost:3001"]
}

# --- Web app hosting ---
variable "web_hosting" {
  description = "'amplify' (works on new accounts) or 'cloudfront' (S3 + CloudFront; new accounts need AWS Support verification first)"
  type        = string
  default     = "amplify"
  validation {
    condition     = contains(["amplify", "cloudfront"], var.web_hosting)
    error_message = "web_hosting must be 'amplify' or 'cloudfront'."
  }
}

variable "amplify_branch" {
  description = "Amplify branch that serves the web app. It is the first part of the address: https://<branch>.<app-id>.amplifyapp.com"
  type        = string
  default     = "main"
}

variable "amplify_redirect_branches" {
  description = "Old Amplify branches whose addresses should send visitors to the app (e.g. [\"main\"] after renaming amplify_branch)"
  type        = list(string)
  default     = []
}

variable "api_throttle_rate" {
  description = "Steady-state requests per second allowed across the whole API stage"
  type        = number
  default     = 50
}

variable "api_throttle_burst" {
  description = "Burst of requests allowed across the whole API stage"
  type        = number
  default     = 100
}

# --- Storage quota ---
variable "user_quota_bytes" {
  description = "Storage each user may use, in bytes (finished uploads only). 0 = unlimited. Default 10 GiB."
  type        = number
  default     = 10737418240
  validation {
    condition     = var.user_quota_bytes >= 0
    error_message = "user_quota_bytes must be 0 (unlimited) or more."
  }
}

# --- Authorizer ---
variable "authorizer_cache_seconds" {
  description = "How long API Gateway remembers that a token is valid (0-3600). Higher = fewer authorizer calls; a signed-out token keeps working at most this long."
  type        = number
  default     = 300
}

# --- Admin panel ---
variable "admin_emails" {
  description = "Emails of the owner admins: they can open the admin panel (/admin) and can't be demoted, suspended or deleted from it. They can make other users admins there."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for e in var.admin_emails : e == lower(trimspace(e)) && can(regex("^[^@ ]+@[^@ ]+$", e))])
    error_message = "admin_emails must be lowercase email addresses without spaces."
  }
}

# --- Alerts ---
variable "alert_email" {
  description = "Email address for alerts: errors in the logs, health check problems, CloudWatch alarms and failed deploys. AWS emails it a confirmation link first. Empty = alerts only go to the SNS topic."
  type        = string
  default     = ""
}

variable "health_check_minutes" {
  description = "How often the monitor runs the health check (the Health page's checks plus requests to the website and API) and emails problems. 0 = off."
  type        = number
  default     = 5
  validation {
    condition     = var.health_check_minutes >= 0 && var.health_check_minutes <= 1440 && floor(var.health_check_minutes) == var.health_check_minutes
    error_message = "health_check_minutes must be a whole number from 0 to 1440."
  }
}

variable "alert_cooldown_minutes" {
  description = "At most one error email per function in this many minutes; the next email says how many errors were held back."
  type        = number
  default     = 15
  validation {
    condition     = var.alert_cooldown_minutes >= 0 && floor(var.alert_cooldown_minutes) == var.alert_cooldown_minutes
    error_message = "alert_cooldown_minutes must be a whole number, 0 or more."
  }
}

variable "alert_utc_offset" {
  description = "Time zone for the times in alert emails, as an offset from UTC (e.g. \"+05:30\")."
  type        = string
  default     = "+00:00"
  validation {
    condition     = can(regex("^[+-]\\d\\d:\\d\\d$", var.alert_utc_offset))
    error_message = "alert_utc_offset must look like +05:30 or -04:00."
  }
}

# --- Rate limits (ratelimit.tf). 0 = no limit. ---
variable "login_attempts_per_ip" {
  description = "Sign-in attempts allowed from one IP address per 15 minutes (generous: offices and campuses share one IP)"
  type        = number
  default     = 100
}

variable "login_failures_per_account" {
  description = "Wrong passwords allowed for one account per 15 minutes; then sign-in waits until the window ends"
  type        = number
  default     = 10
}

variable "signups_per_ip" {
  description = "New accounts allowed from one IP address per hour"
  type        = number
  default     = 20
}

variable "uploads_per_hour" {
  description = "Uploads one user may start per hour"
  type        = number
  default     = 300
}

variable "max_pending_uploads" {
  description = "Unfinished uploads one user may have at once (each also reserves its size against the quota)"
  type        = number
  default     = 50
}

variable "share_emails_per_day" {
  description = "Share emails one user may send per day (UTC). Protects the SES sender's reputation; the SES sandbox allows 200 a day in total"
  type        = number
  default     = 50
}

variable "links_per_hour" {
  description = "Short links (copy link / QR) one user may create per hour"
  type        = number
  default     = 200
}
