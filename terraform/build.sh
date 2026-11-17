#!/usr/bin/env bash
# Build ONLY the shared dependency layers (pyjwt, jsonschema) into build/layers/.
# Invoked automatically by Terraform (null_resource.layers_build) during apply -
# you don't run this by hand. Function code is zipped by Terraform's archive_file.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD="$HERE/build"
PYBIN="${PYTHON:-python3}"
PY_VERSION="${PY_VERSION:-3.13}"   # must match lambda_runtime (x86_64 Lambdas)

mkdir -p "$BUILD/layers"
rm -f "$BUILD/layers"/*.zip

# Install Linux (manylinux) wheels regardless of the build host, so compiled
# deps like rpds-py (a jsonschema dependency) run on AWS Lambda.
build_layer() {
  local name="$1" pkg="$2"
  local dir="$BUILD/_layer_${name}"
  rm -rf "$dir"
  mkdir -p "$dir/python"
  "$PYBIN" -m pip install --quiet --target "$dir/python" \
    --platform manylinux2014_x86_64 --implementation cp \
    --python-version "$PY_VERSION" --only-binary=:all: "$pkg"
  if command -v zip >/dev/null 2>&1; then
    (cd "$dir" && zip -qr "$BUILD/layers/${name}.zip" python)
  else  # e.g. Git Bash on Windows has no zip
    "$PYBIN" -c "import shutil,sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2], 'python')"       "$BUILD/layers/${name}" "$dir"
  fi
  echo "  layer: ${name}.zip"
}

echo "Building layers (python ${PY_VERSION})..."
build_layer jsonschema jsonschema
echo "Layers built -> $BUILD/layers"
