# Shared by deploy.ps1 and logs.ps1: which server to talk to.
# Uses -Server if given, else the reserved IP from Terraform (infra/), else
# the ER_ANGEL_SERVER environment variable.

function Get-ErAngelServer([string]$Server) {
  if ($Server) { return $Server }
  if ($env:ER_ANGEL_SERVER) { return $env:ER_ANGEL_SERVER }

  $tf = (Get-Command terraform -ErrorAction SilentlyContinue).Source
  if (-not $tf) {
    $tf = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter terraform.exe -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1).FullName
  }
  $infra = Join-Path (Split-Path -Parent $PSScriptRoot) "infra"
  if ($tf -and (Test-Path (Join-Path $infra "terraform.tfstate"))) {
    $ip = & $tf "-chdir=$infra" output -raw ip_address 2>$null
    if ($LASTEXITCODE -eq 0 -and $ip) { return $ip.Trim() }
  }
  throw "Don't know the server address. Pass -Server <ip> or set ER_ANGEL_SERVER."
}

function Get-ErAngelSite([string]$Ip) {
  return ($Ip -replace '\.', '-') + ".sslip.io"
}
