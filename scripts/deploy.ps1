<#
.SYNOPSIS
  Redeploy ER Angel to the Vultr server: check out and pull main, rebuild,
  reload Caddy, wait for /api/health.

.EXAMPLE
  .\scripts\deploy.ps1
  .\scripts\deploy.ps1 -Server 149.248.60.145

.NOTES
  The server pulls main from GitHub, so push your commits first -- this
  script warns if main has commits that aren't on GitHub yet.
#>
param([string]$Server)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_server.ps1"
$repo = Split-Path -Parent $PSScriptRoot
$branch = "main" # must match DEPLOY_BRANCH in deploy/remote-deploy.sh
$ip = Get-ErAngelServer $Server
$site = Get-ErAngelSite $ip
$ssh = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "root@$ip")
$started = Get-Date

$serverBranch = (& ssh @ssh "git -C /opt/er-angel branch --show-current").Trim()
if ($LASTEXITCODE -ne 0 -or -not $serverBranch) { throw "Can't reach the server over SSH (root@$ip)." }
$note = if ($serverBranch -ne $branch) { " (server is on '$serverBranch' -- switching it to $branch)" } else { "" }
Write-Host "Deploying ER Angel ($branch) to $site$note" -ForegroundColor Cyan

# Warn about work that won't be deployed.
git -C $repo fetch -q origin $branch 2>$null
$unpushed = git -C $repo rev-list --count "origin/$branch..$branch" 2>$null
if ($LASTEXITCODE -eq 0 -and [int]$unpushed -gt 0) {
  Write-Warning "$unpushed local commit(s) on '$branch' aren't pushed -- they won't be deployed. Run: git push origin $branch"
}
if ((git -C $repo branch --show-current) -ne $branch) {
  Write-Warning "Your local branch isn't '$branch'. The server deploys origin/$branch regardless."
}

# Get main's copy of remote-deploy.sh first (this also moves a server that's
# still on another branch), then run it.
& ssh @ssh "cd /opt/er-angel && git fetch -q origin $branch && git checkout -q $branch && git merge -q --ff-only origin/$branch && bash deploy/remote-deploy.sh"
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
