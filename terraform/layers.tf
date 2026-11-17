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
