# Web app hosting. Two options (var.web_hosting):
#   amplify    -> AWS Amplify Hosting (HTTPS at https://<amplify_branch>.<app-id>.amplifyapp.com).
#                 Works on brand-new accounts. deploy.sh uploads the build as a zip.
#   cloudfront -> private S3 bucket + CloudFront with Origin Access Control.
#                 New AWS accounts must be verified by AWS Support before they
#                 can create CloudFront distributions.

locals {
  use_cloudfront = var.web_hosting == "cloudfront"
  use_amplify    = var.web_hosting == "amplify"
  web_url = (local.use_cloudfront
    ? "https://${aws_cloudfront_distribution.web[0].domain_name}"
  : "https://${var.amplify_branch}.${aws_amplify_app.web[0].default_domain}")

  # Content Security Policy of the web app: scripts only from the app itself
  # (no inline scripts, so injected markup can't run code or steal the session
  # from localStorage), network calls only to this API and the files bucket
  # (direct uploads), fonts from Google Fonts, and no framing (clickjacking).
  web_connect_src = distinct(compact([
    "'self'",
    "https://${aws_api_gateway_rest_api.api.id}.execute-api.${var.aws_region}.amazonaws.com",
    var.api_domain_name != "" ? "https://${var.api_domain_name}" : "",
    var.auth_endpoint != "" ? regex("^https?://[^/]+", var.auth_endpoint) : "",
    "https://${aws_s3_bucket.files.bucket_regional_domain_name}",
  ]))
  web_csp = join("; ", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src ${join(" ", local.web_connect_src)}",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ])
  web_security_headers = {
    "Strict-Transport-Security" = "max-age=31536000; includeSubDomains"
    "X-Content-Type-Options"    = "nosniff"
    "X-Frame-Options"           = "DENY"
    "Referrer-Policy"           = "strict-origin-when-cross-origin"
    "Permissions-Policy"        = "camera=(), microphone=(), geolocation=(), payment=()"
    "Content-Security-Policy"   = local.web_csp
  }
}

# --- Amplify Hosting ----------------------------------------------------------
resource "aws_amplify_app" "web" {
  count    = local.use_amplify ? 1 : 0
  name     = "${local.prefix}-web"
  platform = "WEB"

  # Security headers on every response (all branches, including redirects)
  custom_headers = yamlencode({
    customHeaders = [{
      pattern = "**"
      headers = [for key, value in local.web_security_headers : { key = key, value = value }]
    }]
  })

  # SPA routing: any path without a file extension serves index.html
  custom_rule {
    source = "</^[^.]+$|\\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>"
    target = "/index.html"
    status = "200"
  }
}

resource "aws_amplify_branch" "app" {
  count       = local.use_amplify ? 1 : 0
  app_id      = aws_amplify_app.web[0].id
  branch_name = var.amplify_branch
  stage       = "PRODUCTION"
}

# Old branch addresses, kept so old links still work: deploy.sh publishes a
# small page to each that sends visitors to the same path on the app's address.
resource "aws_amplify_branch" "redirect" {
  for_each    = local.use_amplify ? toset(var.amplify_redirect_branches) : toset([])
  app_id      = aws_amplify_app.web[0].id
  branch_name = each.key
  stage       = "PRODUCTION"
}

# The app used to be served from the "main" branch. Keep that branch (it becomes
# a redirect) instead of deleting it, so the old address never goes down.
moved {
  from = aws_amplify_branch.main[0]
  to   = aws_amplify_branch.redirect["main"]
}

# --- S3 + CloudFront ----------------------------------------------------------
resource "aws_s3_bucket" "web" {
  count         = local.use_cloudfront ? 1 : 0
  bucket        = "${local.prefix}-web-${local.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web" {
  count                   = local.use_cloudfront ? 1 : 0
  bucket                  = aws_s3_bucket.web[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "web" {
  count  = local.use_cloudfront ? 1 : 0
  bucket = aws_s3_bucket.web[0].id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_cloudfront_origin_access_control" "web" {
  count                             = local.use_cloudfront ? 1 : 0
  name                              = "${local.prefix}-web-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "web" {
  count               = local.use_cloudfront ? 1 : 0
  enabled             = true
  comment             = "${local.prefix} web app"
  default_root_object = "index.html"
  price_class         = "PriceClass_200" # includes India; excludes the priciest edges
  http_version        = "http2and3"

  origin {
    domain_name              = aws_s3_bucket.web[0].bucket_regional_domain_name
    origin_id                = "web"
    origin_access_control_id = aws_cloudfront_origin_access_control.web[0].id
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = "658327ea-f89d-4fab-a63d-7e88639e58f6" # managed CachingOptimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web[0].id
  }

  # SPA routing: unknown paths (e.g. /app, /login) serve index.html
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# The same security headers as the Amplify option.
resource "aws_cloudfront_response_headers_policy" "web" {
  count = local.use_cloudfront ? 1 : 0
  name  = "${local.prefix}-web-security"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }
    content_type_options { override = true }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    content_security_policy {
      content_security_policy = local.web_csp
      override                = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = local.web_security_headers["Permissions-Policy"]
      override = true
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  count  = local.use_cloudfront ? 1 : 0
  bucket = aws_s3_bucket.web[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "CloudFrontRead"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.web[0].arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.web[0].arn }
      }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.web]
}
