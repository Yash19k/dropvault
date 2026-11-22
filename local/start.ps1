# Start DropVault fully offline: LocalStack (Docker) + local API + web app.
#   powershell -ExecutionPolicy Bypass -File local\start.ps1            # kms_mode = s3
#   powershell -ExecutionPolicy Bypass -File local\start.ps1 per_user   # one KMS key per user
#   ... -AdminEmail you@example.com     # owner admin: created on start (temporary password in the API window)
param([string]$KmsMode = "s3", [string]$AdminEmail = "")
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

docker compose -f "$PSScriptRoot\docker-compose.yml" up -d
if (-not $?) { throw "Docker failed - is Docker Desktop running?" }

python -c "import boto3, jsonschema" 2>$null
if (-not $?) { python -m pip install --user boto3 jsonschema }

if (-not (Test-Path "$root\web\node_modules")) { Push-Location "$root\web"; npm install; Pop-Location }
"VITE_AUTH_URL=http://localhost:4000`nVITE_FILE_URL=http://localhost:4000" |
    Out-File -Encoding ascii "$root\web\.env.local"

# API in its own window (request log)
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "`$env:KMS_MODE='$KmsMode'; `$env:ADMIN_EMAILS='$($AdminEmail.ToLower())'; python -u '$PSScriptRoot\server.py'"

Push-Location "$root\web"
npx vite --port 3001
Pop-Location
