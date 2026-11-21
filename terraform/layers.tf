# Dependency layers need pip (for Linux/manylinux wheels), which Terraform can't
# do itself - so a null_resource runs build.sh during `terraform apply`. The
# layer versions depend on it, so a single `terraform apply` packages + deploys.
resource "null_resource" "layers_build" {
  triggers = {
    buildscript = filesha1("${path.module}/build.sh")
    runtime     = var.lambda_runtime
  }
  provisioner "local-exec" {
    interpreter = [var.bash_bin, "-c"]
    command     = "PYTHON='${var.python_bin}' PY_VERSION='${replace(var.lambda_runtime, "python", "")}' bash '${path.module}/build.sh'"
  }
}

resource "aws_lambda_layer_version" "layers" {
  for_each            = toset(["jsonschema"])
  layer_name          = "${local.prefix}-${each.key}"
  filename            = "${path.module}/build/layers/${each.key}.zip"
  source_code_hash    = null_resource.layers_build.triggers.buildscript
  compatible_runtimes = [var.lambda_runtime]
  depends_on          = [null_resource.layers_build]
}

# Code shared by every Lambda (endpoints/common/python: auth, api, storage,
# links, usage, tokens, ...). Lambda puts a layer's python/ folder on the
# import path, so the handlers simply `import storage`.
data "archive_file" "common" {
  type        = "zip"
  source_dir  = "${path.module}/../endpoints/common"
  output_path = "${path.module}/build/common/common.zip"
  excludes    = ["**/__pycache__/**"]
}

resource "aws_lambda_layer_version" "common" {
  layer_name          = "${local.prefix}-common"
  filename            = data.archive_file.common.output_path
  source_code_hash    = data.archive_file.common.output_base64sha256
  compatible_runtimes = [var.lambda_runtime]
}
