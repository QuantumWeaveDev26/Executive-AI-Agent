param(
  [Parameter(Mandatory = $true)][string]$ScriptPath,
  [string]$RemoteCommand = 'python3 -'
)
$ErrorActionPreference = 'Stop'
$gitBin = 'C:/Program Files/Git/usr/bin'
$identityDir = Join-Path $env:USERPROFILE '.codex/credentials/thaara-ai-v2-vps1871828'
$knownHosts = Join-Path $env:USERPROFILE '.ssh/known_hosts'

$work = Join-Path ([IO.Path]::GetTempPath()) ('vps-ssh-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
$socket = (Join-Path $work 'agent.sock').Replace('\', '/')
$agent = Start-Process -FilePath (Join-Path $gitBin 'ssh-agent.exe') -ArgumentList @('-D', '-a', $socket) -PassThru -WindowStyle Hidden
$ptr = [IntPtr]::Zero

try {
  Start-Sleep -Milliseconds 400
  $env:SSH_AUTH_SOCK = $socket
  $secure = Import-Clixml -LiteralPath (Join-Path $identityDir 'private-key.clixml')
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $pem = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $pem + "`n" | & (Join-Path $gitBin 'ssh-add.exe') -t 300 - 2>$null | Out-Null
  $ErrorActionPreference = $prev
  $pem = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $ptr = [IntPtr]::Zero

  $payload = (Get-Content -LiteralPath $ScriptPath -Raw).Replace("`r`n", "`n")
  $result = $payload | & (Join-Path $gitBin 'ssh.exe') -F none -i (Join-Path $identityDir 'identity.pub') `
    -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes `
    -o ("UserKnownHostsFile=" + $knownHosts) -o GlobalKnownHostsFile=/dev/null `
    -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=60 `
    root@76.13.217.50 $RemoteCommand

  Write-Output $result
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  if ($agent -and -not $agent.HasExited) { Stop-Process -Id $agent.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
