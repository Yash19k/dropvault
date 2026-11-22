locals {
  account_id        = data.aws_caller_identity.current.account_id
  prefix            = "${var.app_name}-${var.environment}"
  table_name        = var.table_name != "" ? var.table_name : "${var.app_name}-files-${var.environment}"
  files_bucket_name = var.files_bucket_name != "" ? var.files_bucket_name : "${local.prefix}-files-${local.account_id}"

  # One entry per file Lambda. `dir` is the folder under ../endpoints, `module`
  # is the Python handler module, `layers` are the dependency layers it needs on
  # top of the shared code layer (endpoints/common), which every function gets.
  functions = {
    create-upload = { dir = "upload-file", module = "upload_file", layers = ["jsonschema"] }
    complete      = { dir = "complete-upload", module = "complete_upload", layers = [] }
    download      = { dir = "download-file", module = "download_file", layers = [] }
    list          = { dir = "get-user-files", module = "get_user_files", layers = [] }
    delete        = { dir = "delete-user-file", module = "delete_user_file", layers = [] }
    share         = { dir = "share-file", module = "share_file", layers = ["jsonschema"] }
    cleanup       = { dir = "cleanup", module = "cleanup", layers = [] }
    presence      = { dir = "presence", module = "presence", layers = [] }
  }

  # Environment every file Lambda (and the links Lambda) shares.
  file_env = merge(local.file_limits_env, {
    AUTH_ENDPOINT      = local.auth_endpoint
    FILE_SHARING_TABLE = aws_dynamodb_table.files.name
    REGION             = var.aws_region
    USER_FILES_BUCKET  = aws_s3_bucket.files.bucket
    KMS_MODE           = var.kms_mode
    KMS_ALIAS_PREFIX   = local.prefix
    USER_QUOTA_BYTES   = tostring(var.user_quota_bytes)
  })
}
