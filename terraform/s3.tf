resource "aws_s3_bucket" "files" {
  bucket = local.files_bucket_name
  # Empty + delete the bucket (incl. all stored files) on `terraform destroy`.
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "files" {
  bucket = aws_s3_bucket.files.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    apply_server_side_encryption_by_default {
      # shared mode -> bucket default is the shared KMS key; otherwise AES-256.
      # per_user mode keeps the default AES-256 and specifies the user's key per
      # object at upload time.
      sse_algorithm     = var.kms_mode == "shared" ? "aws:kms" : "AES256"
      kms_master_key_id = var.kms_mode == "shared" ? aws_kms_key.shared[0].arn : null
    }
    bucket_key_enabled = var.kms_mode == "shared" ? true : null
  }
}

# Parts of a multipart upload that is never completed are invisible but still
# stored (and billed). Throw them away after a day. (The cleanup Lambda usually
# does this sooner, when the upload's record expires: see cleanup.tf.)
resource "aws_s3_bucket_lifecycle_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    id     = "abort-incomplete-multipart-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}

# Lets the browser PUT (upload) and GET (download via presigned URL) directly.
# ETag is exposed for multipart uploads.
resource "aws_s3_bucket_cors_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  cors_rule {
    allowed_methods = ["PUT", "GET"]
    # the hosted web app (web.tf) is always allowed, plus its custom domain and any extra origins
    allowed_origins = distinct(compact(concat(
      [local.web_url, var.web_domain != "" ? "https://${var.web_domain}" : ""],
      var.allowed_origins,
    )))
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# Refuse any request to the files bucket that isn't over HTTPS. (A Deny-only
# policy is not "public", so it works with the public access block above.)
resource "aws_s3_bucket_policy" "files_tls_only" {
  bucket = aws_s3_bucket.files.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.files.arn, "${aws_s3_bucket.files.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.files]
}
