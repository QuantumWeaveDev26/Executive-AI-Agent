#requires -Version 7.0
param([switch]$ReviewOnly,[switch]$ApprovedPhoneRuntimeReadOnly,[string]$ManifestSha256)
$TestEmptyAgent=$false
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$payload=Join-Path $repo 'deploy/hostinger-pilot/phone-sarvam-v19-mount-preflight-20261108.readonly.py'
$manifestPath=Join-Path $repo 'docs/integrations/phone/PHONE_SARVAM_V19_MOUNT_PREFLIGHT_20261108.review.json'
$pin='SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4'
$gitBin='C:/Program Files/Git/usr/bin'
$identityDir=Join-Path $env:USERPROFILE '.codex/credentials/thaara-ai-v2-vps1871828'
$publicHosts=Join-Path $repo 'node_modules/.cache/thaara-10816-control/known_hosts'
$phase='review';$work=$null;$agent=$null;$agentPid=$null;$pointer=[IntPtr]::Zero;$pem=$null;$output=$null;$cleanup=$false

function Invoke-OwnedProcess([string]$Exe,[string[]]$Arguments,[string]$InputText,[hashtable]$Environment=@{},[int]$Timeout=15000){
 if($Timeout -lt 1){throw 'child_timeout_invalid'}
 $clock=[Diagnostics.Stopwatch]::StartNew()
 function Get-ChildRemaining {
  $remaining=[long]$Timeout-$clock.ElapsedMilliseconds
  if($remaining -lt 1){throw 'child_timeout'}
  return [int][Math]::Min([int]::MaxValue,$remaining)
 }
 function Wait-ChildTask($Task){
  if(-not $Task.Wait((Get-ChildRemaining))){throw 'child_timeout'}
  return $Task.GetAwaiter().GetResult()
 }
 $info=[Diagnostics.ProcessStartInfo]::new($Exe)
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 foreach($argument in $Arguments){$info.ArgumentList.Add($argument)}
 foreach($key in $Environment.Keys){$info.Environment[$key]=[string]$Environment[$key]}
 $child=[Diagnostics.Process]::new();$child.StartInfo=$info;$started=$false;$inputTask=$null;$stdout=$null;$stderr=$null
 try{
  if(-not $child.Start()){throw 'child_start_failed'}
  $started=$true
  $stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
  if($null -ne $InputText){
   $inputTask=$child.StandardInput.WriteAsync($InputText);Wait-ChildTask $inputTask
   $inputTask=$child.StandardInput.FlushAsync();Wait-ChildTask $inputTask
  }
  $child.StandardInput.Close()
  if(-not $child.WaitForExit((Get-ChildRemaining))){throw 'child_timeout'}
  $text=Wait-ChildTask $stdout;$errorText=Wait-ChildTask $stderr
  if($text.Length -gt 1048576){throw 'child_output_limit'}
  $category='unclassified_stderr'
  foreach($phrase in @('Permission denied (publickey)','Connection timed out','Connection refused','REMOTE HOST IDENTIFICATION HAS CHANGED','No such container','No such object','SyntaxError','AssertionError')){if($errorText.Contains($phrase)){$category=$phrase;break}}
  return @{Code=$child.ExitCode;Text=$text;ErrorCategory=$category}
 }finally{
  $cleanupUncertain=$false
  try{
   if($started -and -not $child.HasExited){$child.Kill($true);if(-not $child.WaitForExit(5000)){throw 'child_cleanup_unverified'}}
   # Killing the owned process closes its pipes; settle pending I/O before disposing the writer.
   foreach($task in @($inputTask,$stdout,$stderr)){
    if($null -ne $task -and -not $task.IsCompleted){try{$null=$task.Wait(1000)}catch{};if(-not $task.IsCompleted){$cleanupUncertain=$true}}
   }
  }catch{$cleanupUncertain=$true}
  # Avoid a synchronous writer disposal while an unverified child may still hold its input pipe.
  finally{if(-not $cleanupUncertain){try{$child.Dispose()}catch{$cleanupUncertain=$true}}}
  if($cleanupUncertain){$childCleanupError=[Exception]::new('child_cleanup_unverified');$childCleanupError.Data['OwnedChildCleanupVerified']=$false;throw $childCleanupError}
 }
}

try{
 $manifestBytes=[IO.File]::ReadAllBytes($manifestPath)
 $utf8=[Text.UTF8Encoding]::new($false,$true)
 $manifestDigest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($manifestBytes)).ToLowerInvariant()
 if($ApprovedPhoneRuntimeReadOnly -and ($ManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or $manifestDigest -cne $ManifestSha256)){throw 'manifest_checksum_mismatch'}
 $manifest=$utf8.GetString($manifestBytes)|ConvertFrom-Json
 foreach($artifact in $manifest.artifacts){
  $actual=(Get-FileHash -LiteralPath (Join-Path $repo $artifact.path) -Algorithm SHA256).Hash.ToLowerInvariant()
  if($actual -cne $artifact.sha256){throw 'artifact_checksum_mismatch'}
 }
 $payloadBytes=[IO.File]::ReadAllBytes($payload)
 $payloadDigest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($payloadBytes)).ToLowerInvariant()
 $payloadPins=@($manifest.artifacts|Where-Object path -CEQ 'deploy/hostinger-pilot/phone-sarvam-v19-mount-preflight-20261108.readonly.py')
 if($payloadPins.Count -ne 1 -or $payloadDigest -cne $payloadPins[0].sha256){throw 'payload_snapshot_checksum_mismatch'}
 $verifiedPayload=$utf8.GetString($payloadBytes)
 if(($TestEmptyAgent -and $ApprovedPhoneRuntimeReadOnly) -or ($ReviewOnly -and ($TestEmptyAgent -or $ApprovedPhoneRuntimeReadOnly))){throw 'mode_conflict'}
 if($ReviewOnly -or (-not $TestEmptyAgent -and -not $ApprovedPhoneRuntimeReadOnly)){
  @{mode='review_only';temporaryAgent=$true;plaintextPrivateKeyFiles=$false;remoteCommands='verify V4, exact outbound profile mount, v2 rollback checksum, parser support and the private relay';liveCalling=$false}|ConvertTo-Json -Compress
  exit 0
 }
 if($ApprovedPhoneRuntimeReadOnly -and ($manifest.remoteExecutionAllowed -isnot [bool] -or $manifest.remoteExecutionAllowed -ne $true)){throw 'remote_execution_not_approved'}
 $used=Join-Path $repo 'node_modules/.cache/phone-sarvam-v19-mount-preflight-20261108.used.json'
 $receipt=Join-Path $repo 'node_modules/.cache/phone-sarvam-v19-mount-preflight-20261108.result.json'
 if(Test-Path -LiteralPath $receipt){throw 'baseline_receipt_exists'}
 $gate=[IO.File]::Open($used,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{$bytes=[Text.Encoding]::UTF8.GetBytes('{"consumed":true,"scope":"one_readonly_phone_v19_mount_preflight"}');$gate.Write($bytes,0,$bytes.Length)}finally{$gate.Dispose()}
 $phase='public_pin_check'
 $lines=@([IO.File]::ReadAllLines($publicHosts)|Where-Object{$_ -and -not $_.StartsWith('#')})
 if($lines.Count -ne 1){throw 'host_record_ambiguous'}
 $fields=$lines[0].Split(' ',[StringSplitOptions]::RemoveEmptyEntries)
 if($fields.Count -ne 3 -or $fields[0] -cne '76.13.217.50' -or $fields[1] -cne 'ssh-ed25519'){throw 'host_record_denied'}
 $hostHash='SHA256:'+([Convert]::ToBase64String([Security.Cryptography.SHA256]::HashData([Convert]::FromBase64String($fields[2])))).TrimEnd('=')
 if($hostHash -cne $pin){throw 'host_pin_mismatch'}
 foreach($binary in @('ssh-agent.exe','ssh-add.exe','ssh.exe')){if(-not (Test-Path -LiteralPath (Join-Path $gitBin $binary))){throw 'reviewed_tool_missing'}}
 $phase='protected_temp_directory'
 $work=Join-Path ([IO.Path]::GetTempPath()) ('thaara-phone-agent-'+[guid]::NewGuid().ToString('N'))
 $null=New-Item -ItemType Directory -Path $work -ErrorAction Stop
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
 $acl=[Security.AccessControl.DirectorySecurity]::new();$acl.SetAccessRuleProtection($true,$false);$acl.SetOwner($sid)
 $inherit=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
 foreach($principal in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))){
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($principal,'FullControl',$inherit,'None','Allow'))
 }
 Set-Acl -LiteralPath $work -AclObject $acl
 $actualAcl=Get-Acl -LiteralPath $work
 $allowedSids=@($sid.Value,'S-1-5-18')
 if(-not $actualAcl.AreAccessRulesProtected -or $actualAcl.Access.Count -ne 2 -or
  @($actualAcl.Access|Where-Object{$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowedSids -or $_.AccessControlType -ne 'Allow'}).Count){throw 'temp_acl_unverified'}
 $known=Join-Path $work 'known_hosts'
 [IO.File]::WriteAllText($known,$lines[0]+"`n",[Text.UTF8Encoding]::new($false)) # PUBLIC host record only.
 $socket=(Join-Path $work 'agent.sock').Replace('\','/')
 $agentInfo=[Diagnostics.ProcessStartInfo]::new((Join-Path $gitBin 'ssh-agent.exe'))
 $agentInfo.UseShellExecute=$false;$agentInfo.CreateNoWindow=$true
 $agentInfo.RedirectStandardOutput=$true;$agentInfo.RedirectStandardError=$true
 foreach($argument in @('-D','-a',$socket)){$agentInfo.ArgumentList.Add($argument)}
 $agent=[Diagnostics.Process]::new();$agent.StartInfo=$agentInfo
 if(-not $agent.Start()){throw 'agent_start_failed'}
 $agentPid=$agent.Id
 $agentOut=$agent.StandardOutput.ReadToEndAsync();$agentErr=$agent.StandardError.ReadToEndAsync()
 $agentEnv=@{SSH_AUTH_SOCK=$socket;SSH_AGENT_PID=[string]$agentPid}
 $phase='empty_agent_check';$ready=$false
 for($i=0;$i -lt 15;$i++){
  if($agent.HasExited){throw 'agent_exited'}
  $check=Invoke-OwnedProcess (Join-Path $gitBin 'ssh-add.exe') @('-l') $null $agentEnv 3000
  if($check.Code -eq 1){$ready=$true;break}
  if($check.Code -eq 0){throw 'agent_not_empty'}
  Start-Sleep -Milliseconds 100
 }
 if(-not $ready){throw 'agent_unavailable'}
 if($TestEmptyAgent){$output=@{mode='empty_agent_test';hostRecordMatched=$true;keyLoaded=$false;remoteConnected=$false}}
 else{
  $phase='memory_only_key_load'
  $identity=Get-Content -LiteralPath (Join-Path $identityDir 'identity.json') -Raw | ConvertFrom-Json
  if($identity.hostname -cne 'srv1871828.hstgr.cloud' -or $identity.port -ne 22 -or $identity.enrolled -isnot [bool] -or $identity.enrolled -ne $true -or
   $identity.fingerprint -isnot [string] -or $identity.fingerprint -cnotmatch '^SHA256:[A-Za-z0-9+/]{43}$'){throw 'identity_metadata_mismatch'}
  $keyDirectory=Get-Item -LiteralPath $identityDir
  $keyAcl=Get-Acl -LiteralPath $identityDir
  if($keyDirectory.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) -or -not $keyAcl.AreAccessRulesProtected -or
   @($keyAcl.Access|Where-Object{$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin $allowedSids -or $_.AccessControlType -ne 'Allow'}).Count){throw 'identity_permissions_denied'}
  foreach($leaf in @('private-key.clixml','identity.pub')){if((Get-Item -LiteralPath (Join-Path $identityDir $leaf)).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){throw 'identity_file_redirected'}}
  $secure=Import-Clixml -LiteralPath (Join-Path $identityDir 'private-key.clixml')
  $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $pem=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $add=Invoke-OwnedProcess (Join-Path $gitBin 'ssh-add.exe') @('-t','120','-') ($pem+"`n") $agentEnv 10000
  $pem=$null;[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$pointer=[IntPtr]::Zero
  if($add.Code -ne 0){throw 'agent_key_load_failed'}
  $loaded=Invoke-OwnedProcess (Join-Path $gitBin 'ssh-add.exe') @('-l') $null $agentEnv 3000
  $loadedLines=@($loaded.Text.Trim().Split("`n")|Where-Object{$_})
  $loadedFields=$loaded.Text.Trim().Split(' ',[StringSplitOptions]::RemoveEmptyEntries)
  if($loaded.Code -ne 0 -or $loadedLines.Count -ne 1 -or $loadedFields.Count -lt 2 -or $loadedFields[1] -cne $identity.fingerprint){throw 'agent_identity_mismatch'}
  $phase='pinned_readonly_ssh'
  $sshArgs=@('-F','none','-i',(Join-Path $identityDir 'identity.pub'),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
   '-o',('UserKnownHostsFile='+$known),'-o','GlobalKnownHostsFile=/dev/null','-o','UpdateHostKeys=no','-o','HostKeyAlgorithms=ssh-ed25519',
   '-o','KexAlgorithms=curve25519-sha256','-o','PubkeyAcceptedAlgorithms=rsa-sha2-512,rsa-sha2-256','-o','ForwardAgent=no','-o','ClearAllForwardings=yes',
   '-o','PermitLocalCommand=no','-o','ConnectionAttempts=1','-o','ConnectTimeout=12','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','root@76.13.217.50','python3 -')
  $remote=Invoke-OwnedProcess (Join-Path $gitBin 'ssh.exe') $sshArgs ($verifiedPayload.Replace("`r`n","`n")) $agentEnv 90000
  if(Test-Path -LiteralPath $receipt){throw 'baseline_receipt_exists'}
  if($remote.Code -ne 0){
   $failure=@{status='stopped';category='ssh_or_remote_command_failed';returnCode=$remote.Code;sanitizedError=$remote.ErrorCategory}
   [IO.File]::WriteAllText($receipt,($failure|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
   throw 'readonly_preflight_failed'
  }
  $facts=$remote.Text|ConvertFrom-Json
  if($facts.status -cne 'verified' -or $facts.containerId -cnotmatch '^[a-f0-9]{64}$' -or $facts.imageId -cnotmatch '^sha256:[a-f0-9]{64}$' -or $facts.sourceHealthy -ne $true){throw 'baseline_output_denied'}
  if($facts.profileMountVerified -isnot [bool] -or $facts.relayHealthy -isnot [bool]){throw 'mount_or_relay_output_denied'}
  $p=$facts.phoneRuntime
  if($facts.changesMade -isnot [bool] -or $facts.changesMade -or $facts.providerRequests -ne 0 -or
     ($p.appVersion -isnot [int] -and $p.appVersion -isnot [long]) -or $p.appVersion -lt 1 -or $p.appVersion -gt 10000 -or
     $p.profileSha256 -cnotmatch '^[a-f0-9]{64}$' -or $p.linktreeSupported -isnot [bool]){throw 'runtime_output_denied'}
  $safe=[ordered]@{status='verified';containerId=$facts.containerId;imageId=$facts.imageId;sourceHealthy=$true;changesMade=$false;providerRequests=0;
   profileMountVerified=$facts.profileMountVerified;relayHealthy=$facts.relayHealthy;phoneRuntime=@{appVersion=$p.appVersion;profileSha256=$p.profileSha256;linktreeSupported=$p.linktreeSupported}}
  $stream=[IO.File]::Open($receipt,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$bytes=$utf8.GetBytes(($safe|ConvertTo-Json -Depth 4 -Compress));$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
  $output=@{mode='readonly_phone_runtime_metadata';containerId=$facts.containerId;imageId=$facts.imageId;sourceHealthy=$true;phoneRuntime=$safe.phoneRuntime;profileMountVerified=$safe.profileMountVerified;relayHealthy=$safe.relayHealthy;hostRecordMatched=$true;hostHandshakeVerified=$true;receiptPath=$receipt}

 }
}catch{
 # No raw exception, child stderr, key, connection string or remote payload is printed.
 $output=@{status='stopped';phase=$phase};$global:LASTEXITCODE=1
}finally{
 $pem=$null;if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
 try{
  if($agent){if($agent.Id -ne $agentPid){throw 'agent_identity_changed'};if(-not $agent.HasExited){$agent.Kill($true);if(-not $agent.WaitForExit(5000)){throw 'agent_cleanup_failed'}};$agent.Dispose()}
  if($work){
   $expected=[IO.Path]::GetFullPath($work)
   if((Split-Path $work -Leaf) -notmatch '^thaara-phone-agent-[a-f0-9]{32}$' -or (Get-Item -LiteralPath $work).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){throw 'temp_identity_changed'}
   foreach($entry in @(Get-ChildItem -LiteralPath $work -Force)){
    if($entry.Name -notin @('known_hosts','agent.sock') -or $entry.PSIsContainer -or $entry.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){throw 'unexpected_auth_artifact'}
    if([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($entry.FullName)) -cne $expected){throw 'unsafe_cleanup_path'}
    Remove-Item -LiteralPath $entry.FullName -Force
   }
   Remove-Item -LiteralPath $work -Force
   if(Test-Path -LiteralPath $work){throw 'temp_cleanup_failed'}
  }
  $cleanup=$true
 }catch{$cleanup=$false;$global:LASTEXITCODE=1}
}
$output.cleanupVerified=$cleanup
if($agentPid){$output.agentProcessId=$agentPid}
if($work){$output.temporaryDirectoryName=Split-Path $work -Leaf}
$output|ConvertTo-Json -Compress
if($output.status -eq 'stopped' -or -not $cleanup){exit 1}
