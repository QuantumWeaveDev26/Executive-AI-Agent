#requires -Version 7.0
param([switch]$ReviewOnly,[switch]$ApprovedReadOnly409)
$TestEmptyAgent=$false # No empty-agent execution mode is exposed by this package.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$payload=Join-Path $repo 'deploy/hostinger-pilot/phone-sarvam-409-readonly.review.py'
$manifestPath=Join-Path $repo 'docs/integrations/phone/PHONE_SARVAM_409_READONLY.review.json'
$pin='SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4'
$gitBin='C:/Program Files/Git/usr/bin'
$identityDir=Join-Path $env:USERPROFILE '.codex/credentials/thaara-ai-v2-vps1871828'
$publicHosts=Join-Path $repo 'node_modules/.cache/thaara-10816-control/known_hosts'
$phase='review';$work=$null;$agent=$null;$agentPid=$null;$pointer=[IntPtr]::Zero;$pem=$null;$output=$null;$cleanup=$false

function Invoke-OwnedProcess([string]$Exe,[string[]]$Arguments,[string]$InputText,[hashtable]$Environment=@{},[int]$Timeout=15000){
 $info=[Diagnostics.ProcessStartInfo]::new($Exe)
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 foreach($argument in $Arguments){$info.ArgumentList.Add($argument)}
 foreach($key in $Environment.Keys){$info.Environment[$key]=[string]$Environment[$key]}
 $child=[Diagnostics.Process]::new();$child.StartInfo=$info
 try{
  if(-not $child.Start()){throw 'child_start_failed'}
  $stdout=$child.StandardOutput.ReadToEndAsync();$stderr=$child.StandardError.ReadToEndAsync()
  if($null -ne $InputText){$child.StandardInput.Write($InputText)}
  $child.StandardInput.Close()
  if(-not $child.WaitForExit($Timeout)){throw 'child_timeout'}
  $text=$stdout.GetAwaiter().GetResult();$null=$stderr.GetAwaiter().GetResult()
  if($text.Length -gt 32768){throw 'child_output_limit'}
  return @{Code=$child.ExitCode;Text=$text}
 }finally{if($child.Id -and -not $child.HasExited){$child.Kill($true);$child.WaitForExit()};$child.Dispose()}
}

try{
 $manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
 $expectedArtifacts=@('scripts/phone-sarvam-409-readonly.review.ps1','deploy/hostinger-pilot/phone-sarvam-409-readonly.review.py')
 if(@($manifest.artifacts).Count -ne 2 -or @($manifest.artifacts.path|Select-Object -Unique).Count -ne 2 -or
  @($manifest.artifacts|Where-Object{$_.path -cnotin $expectedArtifacts -or $_.sha256 -cnotmatch '^[a-f0-9]{64}$'}).Count -or
  $manifest.remoteExecutionAllowed -isnot [bool]){throw 'artifact_set_rejected'}
 foreach($artifact in $manifest.artifacts){
  $actual=(Get-FileHash -LiteralPath (Join-Path $repo $artifact.path) -Algorithm SHA256).Hash.ToLowerInvariant()
  if($actual -cne $artifact.sha256){throw 'artifact_checksum_mismatch'}
 }
 if(($TestEmptyAgent -and $ApprovedReadOnly409) -or ($ReviewOnly -and ($TestEmptyAgent -or $ApprovedReadOnly409))){throw 'mode_conflict'}
 if($ReviewOnly -or (-not $TestEmptyAgent -and -not $ApprovedReadOnly409)){
  @{mode='review_only';temporaryAgent=$true;plaintextPrivateKeyFiles=$false;remoteCommands='read retained receipt phases only; no provider requests, remote writes or database commands';liveCalling=$false}|ConvertTo-Json -Compress
  exit 0
 }
 if($ApprovedReadOnly409 -and ($manifest.remoteExecutionAllowed -isnot [bool] -or $manifest.remoteExecutionAllowed -ne $true)){throw 'remote_execution_not_approved'}
 # Consume only this NEW diagnostic approval gate; never alter the simulation gate or remote guard.
 $manifest.remoteExecutionAllowed=$false
 [IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json -Depth 12)+"`n",[Text.UTF8Encoding]::new($false))
 if((Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json).remoteExecutionAllowed -ne $false){throw 'gate_consume_failed'}
 $phase='public_pin_check'
 $lines=@([IO.File]::ReadAllLines($publicHosts)|Where-Object{$_ -and -not $_.StartsWith('#')})
 if($lines.Count -ne 1){throw 'host_record_ambiguous'}
 $fields=$lines[0].Split(' ',[StringSplitOptions]::RemoveEmptyEntries)
 if($fields.Count -ne 3 -or $fields[0] -cne '76.13.217.50' -or $fields[1] -cne 'ssh-ed25519'){throw 'host_record_denied'}
 $hostHash='SHA256:'+([Convert]::ToBase64String([Security.Cryptography.SHA256]::HashData([Convert]::FromBase64String($fields[2])))).TrimEnd('=')
 if($hostHash -cne $pin){throw 'host_pin_mismatch'}
 foreach($binary in @('ssh-agent.exe','ssh-add.exe','ssh.exe')){if(-not (Test-Path -LiteralPath (Join-Path $gitBin $binary))){throw 'reviewed_tool_missing'}}
 $phase='protected_temp_directory'
 $work=Join-Path ([IO.Path]::GetTempPath()) ('thaara-phone-409-read-'+[guid]::NewGuid().ToString('N'))
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
  $phase='pinned_receipt_readonly_ssh'
  $sshArgs=@('-F','none','-i',(Join-Path $identityDir 'identity.pub'),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
   '-o',('UserKnownHostsFile='+$known),'-o','GlobalKnownHostsFile=/dev/null','-o','UpdateHostKeys=no','-o','HostKeyAlgorithms=ssh-ed25519',
   '-o','KexAlgorithms=curve25519-sha256','-o','PubkeyAcceptedAlgorithms=rsa-sha2-512,rsa-sha2-256','-o','ForwardAgent=no','-o','ClearAllForwardings=yes',
   '-o','PermitLocalCommand=no','-o','ConnectionAttempts=1','-o','ConnectTimeout=12','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','root@76.13.217.50','python3 -B - --approved-readonly-409')
  $remote=Invoke-OwnedProcess (Join-Path $gitBin 'ssh.exe') $sshArgs ([IO.File]::ReadAllText($payload).Replace("`r`n","`n")) $agentEnv 30000
  $facts=$remote.Text|ConvertFrom-Json
  if($facts.status -eq 'stopped'){
   if(@($facts.PSObject.Properties.Name).Count -ne 4 -or $facts.category -cne 'receipt_snapshot_rejected' -or
    $facts.providerQueried -isnot [bool] -or $facts.providerQueried -ne $false -or $facts.remoteWrites -ne 0){throw 'receipt_output_denied'}
   $output=@{status='stopped';category='receipt_snapshot_rejected';phase=$phase;hostRecordMatched=$true;hostHandshakeVerified=$true;providerQueried=$false;remoteWrites=0}
  }else{
   $expected=@('status','receiptCount','lastPhase','hasSuiteId','hasMappingId','hasRunId','runSubmissionFencePresent','candidateOperations','providerQueried','billingReconciled','snapshotStable')
   $phases=@('claimed','suite_created','mapping_created','before_run','run_id_received_unverified','run_created')
   $candidateTable=@{claimed=@('create_suite');suite_created=@('read_suite','create_mapping');mapping_created=@('read_mapping');
    before_run=@('submit_run');run_id_received_unverified=@('inconsistent_with_http_409_sequence');run_created=@('poll_run','read_results')}
   if($remote.Code -ne 0 -or $facts.status -cne 'readonly_complete' -or
    @($facts.PSObject.Properties.Name).Count -ne $expected.Count -or @($facts.PSObject.Properties.Name|Where-Object{$_ -notin $expected}).Count -or
    $facts.receiptCount -isnot [long] -and $facts.receiptCount -isnot [int]){throw 'receipt_output_denied'}
   if($facts.receiptCount -lt 1 -or $facts.receiptCount -gt 6 -or $facts.lastPhase -cne $phases[$facts.receiptCount-1]){throw 'receipt_output_denied'}
   foreach($field in @('hasSuiteId','hasMappingId','hasRunId','runSubmissionFencePresent','providerQueried','billingReconciled','snapshotStable')){
    if($facts.$field -isnot [bool]){throw 'receipt_output_denied'}
   }
   if($facts.providerQueried -ne $false -or $facts.billingReconciled -ne $false -or $facts.snapshotStable -ne $true -or
    (@($facts.candidateOperations)-join '|') -cne ($candidateTable[$facts.lastPhase]-join '|')){throw 'receipt_output_denied'}
   if($facts.hasSuiteId -ne ($facts.receiptCount -ge 2) -or $facts.hasMappingId -ne ($facts.receiptCount -ge 3) -or
    $facts.hasRunId -ne ($facts.receiptCount -ge 5) -or $facts.runSubmissionFencePresent -ne ($facts.receiptCount -ge 4)){throw 'receipt_output_denied'}
   $output=@{status='readonly_complete';receiptCount=$facts.receiptCount;lastPhase=$facts.lastPhase;
    hasSuiteId=$facts.hasSuiteId;hasMappingId=$facts.hasMappingId;hasRunId=$facts.hasRunId;runSubmissionFencePresent=$facts.runSubmissionFencePresent;
    candidateOperations=@($facts.candidateOperations);snapshotStable=$true;providerQueried=$false;billingReconciled=$false;remoteWrites=0;
    hostRecordMatched=$true;hostHandshakeVerified=$true}
  }

 }
}catch{
 # No raw exception, child stderr, key, connection string or remote payload is printed.
 $output=@{status='stopped';phase=$phase};$global:LASTEXITCODE=1
}finally{
 if($ApprovedReadOnly409){
  $gateResetVerified=$false
  try{
   $resetManifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
   $resetManifest.remoteExecutionAllowed=$false
   [IO.File]::WriteAllText($manifestPath,($resetManifest|ConvertTo-Json -Depth 12)+"`n",[Text.UTF8Encoding]::new($false))
   $resetGate=(Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json).remoteExecutionAllowed
   $gateResetVerified=($resetGate -is [bool] -and $resetGate -eq $false)
  }catch{$gateResetVerified=$false}
  if($output){$output.gateResetVerified=$gateResetVerified;if(-not $gateResetVerified){$output.status='stopped'}}
 }
 $pem=$null;if($pointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
 try{
  if($agent){if($agent.Id -ne $agentPid){throw 'agent_identity_changed'};if(-not $agent.HasExited){$agent.Kill($true);if(-not $agent.WaitForExit(5000)){throw 'agent_cleanup_failed'}};$agent.Dispose()}
  if($work){
   $expected=[IO.Path]::GetFullPath($work)
   if((Split-Path $work -Leaf) -notmatch '^thaara-phone-409-read-[a-f0-9]{32}$' -or (Get-Item -LiteralPath $work).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){throw 'temp_identity_changed'}
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
