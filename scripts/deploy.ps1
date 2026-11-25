<#
.SYNOPSIS
  Redeploy ER Angel to the server: check out and pull main, rebuild,
  reload Caddy, wait for /api/health.

.EXAMPLE
  .\scripts\deploy.ps1                                   # uses ER_ANGEL_* env vars (see _server.ps1)
  .\scripts\deploy.ps1 -Server 203.0.113.5 -User alice -Key ~\.ssh\id_ed25519
  .\scripts\deploy.ps1 -Site erangel.health              # health-check the real domain

.NOTES
  The server pulls main from GitHub, so push your commits first -- this
  script warns if main has commits that aren't on GitHub yet.
#>
param([string]$Server, [string]$User, [string]$Key, [string]$Site)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_server.ps1"
$repo = Split-Path -Parent $PSScriptRoot
$branch = "main" # must match DEPLOY_BRANCH in deploy/remote-deploy.sh
$ssh = Get-ErAngelSshArgs $Server $User $Key
$target = $ssh[-1]
$site = Get-ErAngelSite $Site $Server
$started = Get-Date

$serverBranch = (& ssh @ssh "git -C /opt/er-angel branch --show-current").Trim()
if ($LASTEXITCODE -ne 0 -or -not $serverBranch) { throw "Can't reach the server over SSH ($target), or /opt/er-angel isn't a git checkout." }
$note = if ($serverBranch -ne $branch) { " (server is on '$serverBranch' -- switching it to $branch)" } else { "" }
Write-Host "Deploying ER Angel ($branch) to $site via $target$note" -ForegroundColor Cyan

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
Write-Host "The server printed its recent backend/web logs above. More: ssh $target 'cd /opt/er-angel && docker compose logs --tail 200 backend'"
exit 1
