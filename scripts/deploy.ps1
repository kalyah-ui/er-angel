<#
.SYNOPSIS
  Redeploy ER Angel to the Vultr server: pull the branch the server is on,
  rebuild, reload Caddy, wait for /api/health.

.EXAMPLE
  .\scripts\deploy.ps1
  .\scripts\deploy.ps1 -Server 149.248.60.145

.NOTES
  The server pulls from GitHub, so push your commits first -- this script
  warns if the server's branch has commits that aren't on GitHub yet.
#>
param([string]$Server)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_server.ps1"
$repo = Split-Path -Parent $PSScriptRoot
$ip = Get-ErAngelServer $Server
$site = Get-ErAngelSite $ip
$ssh = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "root@$ip")
$started = Get-Date

$branch = (& ssh @ssh "git -C /opt/er-angel branch --show-current").Trim()
if ($LASTEXITCODE -ne 0 -or -not $branch) { throw "Can't reach the server over SSH (root@$ip)." }
Write-Host "Deploying ER Angel to $site (server branch: $branch)" -ForegroundColor Cyan

# Warn about work that won't be deployed.
git -C $repo fetch -q origin $branch 2>$null
$unpushed = git -C $repo rev-list --count "origin/$branch..$branch" 2>$null
if ($LASTEXITCODE -eq 0 -and [int]$unpushed -gt 0) {
  Write-Warning "$unpushed local commit(s) on '$branch' aren't pushed -- they won't be deployed. Run: git push origin $branch"
}
if ((git -C $repo branch --show-current) -ne $branch) {
  Write-Warning "Your local branch isn't '$branch'. The server deploys origin/$branch regardless."
}

# Pull first so the newest remote-deploy.sh runs (it also bootstraps a server
# that doesn't have the script yet).
& ssh @ssh "cd /opt/er-angel && git pull -q --ff-only && bash deploy/remote-deploy.sh"
$remoteExit = $LASTEXITCODE

# Independent check from this laptop.
$healthy = $false
try { $healthy = (Invoke-RestMethod "https://$site/api/health" -TimeoutSec 10).ok -eq $true } catch { }

$took = [int]((Get-Date) - $started).TotalSeconds
if ($remoteExit -eq 0 -and $healthy) {
  Write-Host ""
  Write-Host "SUCCESS: https://$site is up and healthy ($took s)." -ForegroundColor Green
  exit 0
}
Write-Host ""
Write-Host "FAILURE: deploy did not finish healthy (server exit $remoteExit, health from laptop: $healthy, $took s)." -ForegroundColor Red
Write-Host "The server printed its recent backend/web logs above. More: ssh root@$ip 'cd /opt/er-angel && docker compose logs --tail 200 backend'"
exit 1
