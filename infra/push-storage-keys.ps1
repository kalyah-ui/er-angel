# Copies the Object Storage settings from Terraform outputs into the server's
# /opt/er-angel/.env (S3_* lines) over SSH. The keys go straight from
# Terraform to the server: never printed, never written to a file here.
#
#   cd infra; .\push-storage-keys.ps1
$ErrorActionPreference = "Stop"
# Pipe plain UTF-8 to ssh: PowerShell's default here prepends a byte-order mark.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false

$tf = (Get-Command terraform -ErrorAction SilentlyContinue).Source
if (-not $tf) {
  $tf = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter terraform.exe -Recurse | Select-Object -First 1).FullName
}

Push-Location $PSScriptRoot
try {
  $server = & $tf output -raw ip_address
  $lines = @(
    "S3_ENDPOINT=$(& $tf output -raw s3_endpoint)"
    "S3_BUCKET=$(& $tf output -raw s3_bucket)"
    "S3_ACCESS_KEY_ID=$(& $tf output -raw s3_access_key)"
    "S3_SECRET_ACCESS_KEY=$(& $tf output -raw s3_secret_key)"
  ) -join "`n"
  $lines | ssh -o BatchMode=yes "root@$server" bash /opt/er-angel/deploy/set-storage-env.sh
  if ($LASTEXITCODE -ne 0) { throw "set-storage-env.sh failed (exit $LASTEXITCODE)" }
}
finally {
  Remove-Variable lines -ErrorAction SilentlyContinue
  Pop-Location
}
