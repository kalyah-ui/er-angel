# Shared by deploy.ps1 and logs.ps1: which server to talk to, as whom, and
# which public hostname to health-check. Each value comes from the parameter
# if given, else an environment variable (set them once in your profile):
#
#   ER_ANGEL_SERVER   server IP or hostname            (required)
#   ER_ANGEL_USER     SSH user on the server           (default: your Windows username, lowercased)
#   ER_ANGEL_SSH_KEY  private key file for that user   (default: ssh's own defaults, e.g. ~/.ssh/id_ed25519)
#   ER_ANGEL_SITE     public hostname for /api/health  (default: <ip-with-dashes>.sslip.io)

function Get-ErAngelServer([string]$Server) {
  if ($Server) { return $Server }
  if ($env:ER_ANGEL_SERVER) { return $env:ER_ANGEL_SERVER }
  throw "Don't know the server address. Pass -Server <ip> or set ER_ANGEL_SERVER."
}

function Get-ErAngelUser([string]$User) {
  if ($User) { return $User }
  if ($env:ER_ANGEL_USER) { return $env:ER_ANGEL_USER }
  return $env:USERNAME.ToLower()
}

# ssh options + user@host, ready to splat: & ssh @args "command"
function Get-ErAngelSshArgs([string]$Server, [string]$User, [string]$Key) {
  $sshArgs = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=10")
  if (-not $Key) { $Key = $env:ER_ANGEL_SSH_KEY }
  if ($Key) { $sshArgs += @("-i", $Key) }
  return $sshArgs + "$(Get-ErAngelUser $User)@$(Get-ErAngelServer $Server)"
}

function Get-ErAngelSite([string]$Site, [string]$Server) {
  if ($Site) { return $Site }
  if ($env:ER_ANGEL_SITE) { return $env:ER_ANGEL_SITE }
  return ((Get-ErAngelServer $Server) -replace '\.', '-') + ".sslip.io"
}
