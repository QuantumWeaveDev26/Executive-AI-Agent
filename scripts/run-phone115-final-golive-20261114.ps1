#requires -Version 7.0
param([Parameter(Mandatory = $true)][int]$TargetAppVersion)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pkgDir = Join-Path $root 'artifacts/phone115-sarvam-live-release-20261114-r3'
$cfgSqlPath = 'C:/Users/Admin/.codex/worktrees/f6fc/thaara-ai-agent-v2/artifacts/phone115-standing-service-20261114-r5/115s-callback-standing-service.configure.review.sql'
$pyTemplate = Get-Content -LiteralPath (Join-Path $root 'deploy/hostinger-pilot/phone115-final-golive-20261114.py') -Raw

# Build deterministic in-memory zip of receiver overlay package
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ms = [IO.MemoryStream]::new()
$zip = [IO.Compression.ZipArchive]::new($ms, [IO.Compression.ZipArchiveMode]::Create, $true)
$relFiles = @(
  'REVIEW_MANIFEST.json',
  'Dockerfile.receiver.review',
  'apps/api/phone-callback-receiver.mjs',
  'apps/api/phone-callback-intake.mjs',
  'apps/api/phone-callback-intake-runtime.mjs',
  'apps/api/phone-callback-completion-route.mjs',
  'apps/api/dist/services/phone-sarvam-inbound-normalize.js',
  'apps/api/node_modules/@thaara/contracts/dist/phone-callback-intake.js'
)
foreach ($rel in $relFiles) {
  $entry = $zip.CreateEntry($rel)
  $s = $entry.Open()
  $bytes = [IO.File]::ReadAllBytes((Join-Path $pkgDir $rel))
  $s.Write($bytes, 0, $bytes.Length)
  $s.Dispose()
}
$zip.Dispose()
$zipB64 = [Convert]::ToBase64String($ms.ToArray())
$manifestSha = (Get-FileHash -LiteralPath (Join-Path $pkgDir 'REVIEW_MANIFEST.json') -Algorithm SHA256).Hash.ToLowerInvariant()
$cfgBytes = [IO.File]::ReadAllBytes($cfgSqlPath)
$cfgSha = ([Security.Cryptography.SHA256]::HashData($cfgBytes) | ForEach-Object { $_.ToString('x2') }) -join ''
$cfgB64 = [Convert]::ToBase64String($cfgBytes)

$payloadJson = @{
  receiverPackageZipBase64 = $zipB64
  receiverManifestSha256   = $manifestSha
  configureSqlBase64       = $cfgB64
  configureSqlSha256       = $cfgSha
} | ConvertTo-Json -Compress

$remoteScript = $pyTemplate.Replace('PAYLOAD = {}  # PAYLOAD_PLACEHOLDER', "PAYLOAD = json.loads(r'''$payloadJson''')").Replace("`r`n", "`n")

$gitBin = 'C:/Program Files/Git/usr/bin'
$identityDir = Join-Path $env:USERPROFILE '.codex/credentials/thaara-ai-v2-vps1871828'
$knownHosts = 'C:/Users/Admin/.codex/worktrees/f6fc/thaara-ai-agent-v2/node_modules/.cache/thaara-10816-control/known_hosts'
$work = Join-Path ([IO.Path]::GetTempPath()) ('thaara-golive-ssh-' + [guid]::NewGuid().ToString('N'))
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
  $pem + "`n" | & (Join-Path $gitBin 'ssh-add.exe') -t 300 - 2>$null | Out-Null
  $pem = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $ptr = [IntPtr]::Zero

  $result = $remoteScript | & (Join-Path $gitBin 'ssh.exe') -F none -i (Join-Path $identityDir 'identity.pub') `
    -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes `
    -o ("UserKnownHostsFile=" + $knownHosts) -o GlobalKnownHostsFile=/dev/null `
    -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=6 `
    root@76.13.217.50 "python3 - --approved-phone115-final-golive $TargetAppVersion"
  Write-Output $result
} finally {
  if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  if ($agent -and -not $agent.HasExited) { Stop-Process -Id $agent.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
