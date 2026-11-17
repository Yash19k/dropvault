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

# Lets the browser PUT (upload) and GET (download via presigned URL) directly.
resource "aws_s3_bucket_cors_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  cors_rule {
    allowed_methods = ["PUT", "GET"]
    # the hosted web app (web.tf) is always allowed, plus any extra origins
    allowed_origins = concat([local.web_url], var.allowed_origins)
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}
