# Web app hosting. Two options (var.web_hosting):
#   amplify    -> AWS Amplify Hosting (HTTPS at https://main.<app-id>.amplifyapp.com).
#                 Works on brand-new accounts. deploy.sh uploads the build as a zip.
#   cloudfront -> private S3 bucket + CloudFront with Origin Access Control.
#                 New AWS accounts must be verified by AWS Support before they
#                 can create CloudFront distributions.

locals {
  use_cloudfront = var.web_hosting == "cloudfront"
  use_amplify    = var.web_hosting == "amplify"
  web_url = (local.use_cloudfront
    ? "https://${aws_cloudfront_distribution.web[0].domain_name}"
  : "https://main.${aws_amplify_app.web[0].default_domain}")
}

# --- Amplify Hosting ----------------------------------------------------------
resource "aws_amplify_app" "web" {
  count    = local.use_amplify ? 1 : 0
  name     = "${local.prefix}-web"
  platform = "WEB"

  # SPA routing: any path without a file extension serves index.html
  custom_rule {
    source = "</^[^.]+$|\\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>"
    target = "/index.html"
    status = "200"
  }
}

resource "aws_amplify_branch" "main" {
  count       = local.use_amplify ? 1 : 0
  app_id      = aws_amplify_app.web[0].id
  branch_name = "main"
  stage       = "PRODUCTION"
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
    target_origin_id       = "web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # managed CachingOptimized
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
