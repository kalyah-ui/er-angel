<#
.SYNOPSIS
  Show the last N requests the ER Angel server handled (from Caddy's redacted
  access log): time, status, method, path, origin, whether a kiosk token was
  sent, client IP, basic-auth user, duration. Token values are never logged.

.EXAMPLE
  .\scripts\logs.ps1                 # last 50 requests
  .\scripts\logs.ps1 -N 200
  .\scripts\logs.ps1 -Status 401     # last 50 401s (e.g. a kiosk that can't connect)
  .\scripts\logs.ps1 -Path /api/calls
#>
param(
  [int]$N = 50,
  [int]$Status,
  [string]$Path,
  [string]$Server
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_server.ps1"
$ip = Get-ErAngelServer $Server

# When filtering, read further back so N matches can still be found.
$tail = if ($Status -or $Path) { [Math]::Max($N * 40, 2000) } else { $N }
$lines = & ssh -o BatchMode=yes -o ConnectTimeout=10 "root@$ip" "cd /opt/er-angel && docker compose exec -T web tail -n $tail /data/logs/access.log"
if ($LASTEXITCODE -ne 0) { throw "Couldn't read the access log on root@$ip." }

$rows = foreach ($line in $lines) {
  try { $e = $line | ConvertFrom-Json } catch { continue }
  [pscustomobject]@{
    Time   = [DateTimeOffset]::FromUnixTimeMilliseconds([long]($e.ts * 1000)).LocalDateTime.ToString("MM-dd HH:mm:ss")
    Status = [int]$e.status
    Method = $e.request.method
    Path   = $e.request.uri
    Origin = if ($e.origin) { $e.origin } else { "-" }
    Token  = $e.kiosk_token_sent
    Client = $e.request.client_ip
    User   = if ($e.user_id) { $e.user_id } else { "-" }
    Ms     = [int]($e.duration * 1000)
  }
}
if ($Status) { $rows = $rows | Where-Object Status -eq $Status }
if ($Path) { $rows = $rows | Where-Object { $_.Path -like "*$Path*" } }
$rows = @($rows | Select-Object -Last $N)

if (-not $rows.Count) { Write-Host "No matching requests."; exit 0 }
$rows | Format-Table -AutoSize

# Read a 401 as: Token=no -> the kiosk isn't sending VITE_KIOSK_TOKEN;
# Token=yes on an /api/ kiosk path -> wrong token value; path without /api ->
# VITE_API_URL is missing /api; odd Origin -> kiosk isn't on http://localhost:5173.
