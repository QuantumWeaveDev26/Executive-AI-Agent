#requires -Version 7.0
# Privately copies the existing VPS Phone Step 115 inbound token to your Windows Clipboard
# so you can paste it into Sarvam Settings -> Secrets without ever printing or exposing it.
$ErrorActionPreference = 'Stop'
$gitBin = 'C:/Program Files/Git/usr/bin'
$identityDir = Join-Path $env:USERPROFILE '.codex/credentials/thaara-ai-v2-vps1871828'
$knownHosts = 'C:/Users/Admin/.codex/worktrees/f6fc/thaara-ai-agent-v2/node_modules/.cache/thaara-10816-control/known_hosts'
$work = Join-Path ([IO.Path]::GetTempPath()) ('thaara-clip-' + [guid]::NewGuid().ToString('N'))
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
  $pem + "`n" | & (Join-Path $gitBin 'ssh-add.exe') -t 60 - 2>$null | Out-Null
  $pem = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $ptr = [IntPtr]::Zero

  $token = & (Join-Path $gitBin 'ssh.exe') -F none -i (Join-Path $identityDir 'identity.pub') `
    -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes `
    -o ("UserKnownHostsFile=" + $knownHosts) -o GlobalKnownHostsFile=/dev/null `
    root@76.13.217.50 "tr -d '\r\n' < /opt/thaara-v2-pilot-private/secrets/phone_callback_inbound_token"
  if (-not $token -or $token.Length -lt 32) { throw 'Token read failed.' }
  Set-Clipboard -Value $token.Trim()
  $token = $null
  Write-Host 'SUCCESS: Inbound token copied privately to your Clipboard (nothing printed). Paste (Ctrl+V) into Sarvam Settings -> Secrets as thaara_phone_inbound_callback_token.' -ForegroundColor Green
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  if ($agent -and -not $agent.HasExited) { Stop-Process -Id $agent.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
