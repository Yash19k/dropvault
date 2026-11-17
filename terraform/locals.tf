locals {
  account_id        = data.aws_caller_identity.current.account_id
  prefix            = "${var.app_name}-${var.environment}"
  table_name        = var.table_name != "" ? var.table_name : "${var.app_name}-files-${var.environment}"
  files_bucket_name = var.files_bucket_name != "" ? var.files_bucket_name : "${local.prefix}-files-${local.account_id}"

  # One entry per Lambda. `dir` is the folder under ../endpoints, `module` is the
  # Python handler module, `layers` are the shared dependency layers it needs.
  functions = {
    create-upload = { dir = "upload-file", module = "upload_file", layers = ["jsonschema"] }
    complete      = { dir = "complete-upload", module = "complete_upload", layers = [] }
    download      = { dir = "download-file", module = "download_file", layers = [] }
    list          = { dir = "get-user-files", module = "get_user_files", layers = [] }
    delete        = { dir = "delete-user-file", module = "delete_user_file", layers = [] }
    share         = { dir = "share-file", module = "share_file", layers = ["jsonschema"] }
  }
}
