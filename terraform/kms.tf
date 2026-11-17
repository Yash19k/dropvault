# Encryption modes:
#   s3       -> SSE-S3 (AES-256), no KMS, free.
#   shared   -> one customer-managed KMS key; set as the bucket default.
#   per_user -> one KMS key per user, created lazily by the upload Lambda and
#               specified per object at PUT time (nothing to create up front here).
resource "aws_kms_key" "shared" {
  count                   = var.kms_mode == "shared" ? 1 : 0
  description             = "${local.prefix} shared file-encryption key"
  enable_key_rotation     = true
  deletion_window_in_days = 7
}

resource "aws_kms_alias" "shared" {
  count         = var.kms_mode == "shared" ? 1 : 0
  name          = "alias/${local.prefix}-files"
  target_key_id = aws_kms_key.shared[0].key_id
}

# The per-user keys/aliases are created by the upload Lambda at runtime, so
# Terraform can't track them. This destroy-time provisioner deletes them on
# `terraform destroy` so nothing is orphaned. (Destroy provisioners may only
# reference self.triggers, so everything it needs is stored there.)
resource "null_resource" "kms_cleanup" {
  triggers = {
    region  = var.aws_region
    profile = var.aws_profile
    prefix  = local.prefix
    script  = abspath("${path.module}/cleanup_kms.sh")
    bash    = var.bash_bin
  }

  provisioner "local-exec" {
    when        = destroy
    interpreter = [self.triggers.bash, "-c"]
    command     = "PREFIX='${self.triggers.prefix}' REGION='${self.triggers.region}' PROFILE='${self.triggers.profile}' bash '${self.triggers.script}'"
  }
}
