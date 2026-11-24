$ErrorActionPreference = 'Stop'

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseDir = Join-Path $root 'deploy/hostinger-pilot/ui-cleanup-release'
$stagedArchive = 'C:/Users/Admin/.gemini/antigravity-cli/brain/2c31584e-7318-4c35-9f32-ee827493e891/scratch/ui-cleanup-release/publication.tar.gz'
$localArchive = Join-Path $releaseDir 'publication.tar.gz'

if (-not (Test-Path -LiteralPath $localArchive)) {
  if (-not (Test-Path -LiteralPath $stagedArchive)) {
    throw "Missing prepared release archive at $stagedArchive"
  }
  Copy-Item -LiteralPath $stagedArchive -Destination $localArchive -Force
}

$expectedHashes = [ordered]@{
  'deploy-ui-cleanup.py' = 'f3c25c1c1310d0136566a39db3a14234c9cbf2e85d732fcf4eb1823fdf0c1955'
  'publication.tar.gz'   = '6c7fa6b33d4da39341b5b621fa4ebac8c6f704502f78ef814dbc2e3e49de5ebd'
  'Dockerfile'           = '9ffae7d12c9953217e31a824e0ddb9eb6bd886b2901d946d242900f1e3d0b236'
}

foreach ($entry in $expectedHashes.GetEnumerator()) {
  $filePath = Join-Path $releaseDir $entry.Key
  if (-not (Test-Path -LiteralPath $filePath)) {
    throw "Missing required release file: $filePath"
  }
  $actualHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $entry.Value) {
    throw "SHA-256 mismatch for $($entry.Key): expected $($entry.Value), got $actualHash"
  }
}

$sumsPath = Join-Path $releaseDir 'SHA256SUMS.txt'
if (-not (Test-Path -LiteralPath $sumsPath)) {
  throw "Missing SHA256SUMS.txt at $sumsPath"
}

$gitBin = 'C:/Program Files/Git/usr/bin'
$sshExe = Join-Path $gitBin 'ssh.exe'
$scpExe = Join-Path $gitBin 'scp.exe'
$knownHosts = (Join-Path $root 'node_modules/.cache/thaara-10816-control/known_hosts').Replace('\', '/')
if (-not (Test-Path -LiteralPath $knownHosts)) {
  $knownHosts = 'C:/Users/Admin/.codex/worktrees/f6fc/thaara-ai-agent-v2/node_modules/.cache/thaara-10816-control/known_hosts'
}
if (-not (Test-Path -LiteralPath $knownHosts)) {
  throw 'Pinned known_hosts file not found.'
}

$commonSshArgs = @(
  '-F', 'none',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=yes',
  '-o', ("UserKnownHostsFile=" + $knownHosts),
  '-o', 'GlobalKnownHostsFile=/dev/null',
  '-o', 'ConnectTimeout=15',
  '-o', 'ServerAliveInterval=10',
  '-o', 'ServerAliveCountMax=6'
)

$uiKeyPath = (Join-Path $env:USERPROFILE '.ssh/thaara_ui_deploy').Replace('\', '/')
$identityDir = Join-Path $env:USERPROFILE '.codex/credentials/thaara-ai-v2-vps1871828'
$clixmlPath = Join-Path $identityDir 'private-key.clixml'
$pubKeyPath = (Join-Path $identityDir 'identity.pub').Replace('\', '/')

$work = Join-Path ([IO.Path]::GetTempPath()) ('thaara-ui-cleanup-ssh-' + [guid]::NewGuid().ToString('N'))
$agent = $null
$ptr = [IntPtr]::Zero
$identityArg = $null

try {
  if (Test-Path -LiteralPath $uiKeyPath) {
    $ErrorActionPreference = 'Continue'
    & $sshExe @commonSshArgs -i $uiKeyPath 'root@76.13.217.50' 'true' *> $null
    $probeExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($probeExit -eq 0) {
      $identityArg = $uiKeyPath
    }
  }
  if (-not $identityArg) {
    if ((Test-Path -LiteralPath $clixmlPath) -and (Test-Path -LiteralPath $pubKeyPath)) {
      New-Item -ItemType Directory -Path $work -Force | Out-Null
      $socket = (Join-Path $work 'agent.sock').Replace('\', '/')
      $agent = Start-Process -FilePath (Join-Path $gitBin 'ssh-agent.exe') -ArgumentList @('-D', '-a', $socket) -PassThru -WindowStyle Hidden
      Start-Sleep -Milliseconds 400
      $env:SSH_AUTH_SOCK = $socket
      $secure = Import-Clixml -LiteralPath $clixmlPath
      $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
      $pem = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
      $ErrorActionPreference = 'Continue'
      $pem + "`n" | & (Join-Path $gitBin 'ssh-add.exe') -t 300 - *> $null
      $addExit = $LASTEXITCODE
      $ErrorActionPreference = 'Stop'
      $pem = $null
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
      $ptr = [IntPtr]::Zero
      if ($addExit -ne 0) {
        throw "ssh-add failed with exit code $addExit"
      }
      $identityArg = $pubKeyPath
    } else {
      throw 'No enrolled SSH key found at ~/.ssh/thaara_ui_deploy or ~/.codex/credentials/thaara-ai-v2-vps1871828.'
    }
  }

  $ErrorActionPreference = 'Continue'
  & $sshExe @commonSshArgs -i $identityArg 'root@76.13.217.50' 'mkdir -p /opt/thaara-v2-pilot/ui-cleanup-release && chmod 700 /opt/thaara-v2-pilot/ui-cleanup-release'
  $prepExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($prepExit -ne 0) {
    throw "Remote staging directory preparation failed with exit code $prepExit"
  }

  Push-Location $releaseDir
  try {
    $ErrorActionPreference = 'Continue'
    & $scpExe @commonSshArgs -i $identityArg './deploy-ui-cleanup.py' './publication.tar.gz' './Dockerfile' './SHA256SUMS.txt' 'root@76.13.217.50:/opt/thaara-v2-pilot/ui-cleanup-release/'
    $scpExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($scpExit -ne 0) {
      throw "SCP file transfer failed with exit code $scpExit"
    }
  } finally {
    Pop-Location
  }

  $ErrorActionPreference = 'Continue'
  $deployOutput = & $sshExe @commonSshArgs -i $identityArg 'root@76.13.217.50' 'cd /opt/thaara-v2-pilot/ui-cleanup-release && sha256sum -c SHA256SUMS.txt && python3 deploy-ui-cleanup.py'
  $deployExit = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'

  $outputText = ($deployOutput | Out-String).Trim()
  Write-Output $outputText

  if ($deployExit -ne 0) {
    throw "Remote deployment command exited with code $deployExit"
  }

  $receiptLines = $deployOutput | Where-Object { $_ -notmatch ':\s+OK$' }
  $receiptJson = ($receiptLines -join "`n").Trim()
  if ($receiptJson.StartsWith('{')) {
    $receiptPath = Join-Path $releaseDir 'deployment-receipt-20261115.json'
    [IO.File]::WriteAllText($receiptPath, $receiptJson + "`n", [Text.UTF8Encoding]::new($false))
  }
} finally {
  if ($ptr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
  if ($agent -and -not $agent.HasExited) {
    Stop-Process -Id $agent.Id -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $work) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}
