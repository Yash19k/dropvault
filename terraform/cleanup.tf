# Abandoned uploads. Each new file record carries a `ttl` one day out, which
# complete-upload removes. When DynamoDB's TTL deletes a record that never
# finished, the deletion appears on the table stream and the cleanup Lambda
# (endpoints/cleanup, defined with the other functions in locals.tf) aborts
# the multipart upload or deletes the partial object.
#
# The filter means the Lambda only runs for exactly those deletions, not for
# every write to the table. (S3 also aborts any multipart upload left
# incomplete for a day: see the lifecycle rule in s3.tf.)
resource "aws_lambda_event_source_mapping" "cleanup" {
  event_source_arn                   = aws_dynamodb_table.files.stream_arn
  function_name                      = aws_lambda_function.fn["cleanup"].arn
  starting_position                  = "LATEST"
  batch_size                         = 25
  maximum_batching_window_in_seconds = 60
  maximum_retry_attempts             = 3
  bisect_batch_on_function_error     = true

  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName    = ["REMOVE"]
        userIdentity = { type = ["Service"], principalId = ["dynamodb.amazonaws.com"] }
        dynamodb     = { OldImage = { status = { S = ["UPLOADING"] } } }
      })
    }
  }
  depends_on = [aws_iam_role_policy.app]
}
