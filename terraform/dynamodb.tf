resource "aws_dynamodb_table" "files" {
  name         = local.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "file_id"

  attribute {
    name = "file_id"
    type = "S"
  }
  attribute {
    name = "user_id"
    type = "S"
  }
  attribute {
    name = "uploaded_at"
    type = "S"
  }
  attribute {
    name = "target_file_id"
    type = "S"
  }
  attribute {
    name = "created_at"
    type = "N"
  }

  # A user's files, newest first. Sparse: only file items have user_id, so
  # link, usage and key items never appear. Replaces a full-table Scan.
  global_secondary_index {
    name            = "user-files"
    hash_key        = "user_id"
    range_key       = "uploaded_at"
    projection_type = "ALL"
  }

  # A file's short links, newest first (link list, stats, delete-file cleanup).
  # Sparse: only link items have target_file_id.
  global_secondary_index {
    name            = "file-links"
    hash_key        = "target_file_id"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  # Link records and unfinished uploads carry a `ttl` epoch; DynamoDB deletes
  # them after it. Unfinished uploads are then cleaned out of S3 by the cleanup
  # Lambda, which reads those deletions from the stream (cleanup.tf).
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  stream_enabled   = true
  stream_view_type = "OLD_IMAGE"

  # Restore files, links and usage records to any second of the last 35 days
  point_in_time_recovery { enabled = true }
}
