resource "aws_dynamodb_table" "files" {
  name         = local.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "file_id"

  attribute {
    name = "file_id"
    type = "S"
  }

  # Short-link records (qr.tf) carry a `ttl` epoch; DynamoDB deletes them after it.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}
