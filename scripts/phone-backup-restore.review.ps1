#requires -Version 7.0
param([switch]$ReviewOnly,[switch]$TestEmptyAgent,[switch]$ApprovedBackupRestore,[switch]$ApprovedHostDiagnostic,[switch]$ApprovedMigration,[switch]$ApprovedPhoneDeploy,[switch]$ApprovedPhoneLiveOn,[switch]$ApprovedPhoneLiveOff,[switch]$ApprovedPhoneUiUpdate,[switch]$ApprovedChatModelDeploy,[switch]$ApprovedChatModelOn,[switch]$ApprovedChatModelOff,[switch]$ApprovedPhoneCallDiagnostic,[switch]$ApprovedSarvamKeyCompare,[switch]$ApprovedGoogleOn,[switch]$ApprovedGoogleOff)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$payload=Join-Path $repo 'deploy/hostinger-pilot/phone-backup-restore.review.py'
$manifestPath=Join-Path $repo 'docs/integrations/phone/PHONE_BACKUP_RESTORE.review.json'
if($ApprovedHostDiagnostic){$manifestPath=Join-Path $repo 'docs/integrations/phone/PHONE_BACKUP_DIAGNOSTIC.review.json'}
if($ApprovedMigration){$manifestPath=Join-Path $repo 'docs/integrations/phone/PHONE_MIGRATION_110.review.json'}
$phoneMode=$ApprovedPhoneDeploy -or $ApprovedPhoneLiveOn -or $ApprovedPhoneLiveOff -or $ApprovedPhoneUiUpdate -or $ApprovedChatModelDeploy -or $ApprovedChatModelOn -or $ApprovedChatModelOff -or $ApprovedGoogleOn -or $ApprovedGoogleOff
if($ApprovedPhoneDeploy){$manifestPath=Join-Path $repo 'docs/integrations/phone/PHONE_DEPLOY_110.review.json'}
if($ApprovedPhoneLiveOn){$manifestPath=Join-Path $repo 'docs/integrations/phone/PHONE_LIVE_ON_110.review.json'}
if($ApprovedPhoneLiveOff){$manifestPath=Join-Path $repo 'docs/integrations/phone/PHONE_LIVE_OFF_110.review.json'}
if($ApprovedPhoneUiUpdate){$manifestPath=Join-Path $repo 'docs/integrations/phone/PHONE_UI_UPDATE_110.review.json'}
if($ApprovedChatModelDeploy){$manifestPath=Join-Path $repo 'docs/integrations/phone/CHAT_MODEL_DEPLOY.review.json'}
if($ApprovedChatModelOn){$manifestPath=Join-Path $repo 'docs/integrations/phone/CHAT_MODEL_ON.review.json'}
if($ApprovedChatModelOff){$manifestPath=Join-Path $repo 'docs/integrations/phone/CHAT_MODEL_OFF.review.json'}
if($ApprovedGoogleOn){$manifestPath=Join-Path $repo 'docs/integrations/phone/GOOGLE_ON.review.json'}
if($ApprovedGoogleOff){$manifestPath=Join-Path $repo 'docs/integrations/phone/GOOGLE_OFF.review.json'}
if($ApprovedPhoneCallDiagnostic){$manifestPath=Join-Path $repo 'docs/integrations/phone/PHONE_CALL_DIAGNOSTIC.review.json'}
if($ApprovedSarvamKeyCompare){$manifestPath=Join-Path $repo 'docs/integrations/phone/PHONE_SARVAM_KEY_COMPARE.review.json'}
$pin='SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4'
$gitBin='C:/Program Files/Git/usr/bin'
$identityDir=Join-Path $env:USERPROFILE '.codex/credentials/thaara-ai-v2-vps1871828'
$publicHosts=Join-Path $repo 'node_modules/.cache/thaara-10816-control/known_hosts'
$phase='review';$work=$null;$agent=$null;$agentPid=$null;$pointer=[IntPtr]::Zero;$pem=$null;$output=$null;$cleanup=$false

function Get-SafeBackupDiagnostic($Facts){
 $categories=@('container_identity','filesystem_permissions','disk_availability','memory_availability','missing_path_or_tool',
  'docker_metadata','command_timeout','command_failed','runtime_requirements','database_preflight','migration_failed','unclassified_failure')
 $steps=@('runtime_requirements','container_identity','cached_image','deadline_tool','protected_paths','disk_availability',
  'memory_availability','identity_recheck','database_metadata')
 # Exact case-sensitive enums only. Never return raw exception strings or arbitrary receipt fields.
 @{category=$(if($Facts.category -is [string] -and $Facts.category -cin $categories){$Facts.category}else{'unclassified_failure'});
   preflightStep=$(if($Facts.preflightStep -is [string] -and $Facts.preflightStep -cin $steps){$Facts.preflightStep}else{'unknown'})}
}

function Get-MigrationSqlPrefix([string]$Root){
 $sqlFiles=[ordered]@{'110a'='110a-phone-contacts';'110b'='110b-phone-calls';'110c'='110c-phone-live-mode'}
 $sqlParts=foreach($step in $sqlFiles.Keys){"'$step':'"+[Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $Root "docs/migrations/$($sqlFiles[$step]).review.sql")))+"'"}
 'MIGRATION_SQL_B64={'+($sqlParts -join ',')+"}`n"
}

function Get-PhoneOwnerFilesPrefix([string]$Root){
 $parts=foreach($item in @(@('pilot-sarvam-key-entry.sh','deploy/hostinger-pilot/pilot-sarvam-key-entry.sh'),@('sarvam-runtime-profile.pilot.json','docs/integrations/phone/sarvam-runtime-profile.pilot.json'))){"'$($item[0])':'"+[Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $Root $item[1])))+"'"}
 'OWNER_FILES_B64={'+($parts -join ',')+"}`n"
}

function Get-ChatOwnerFilesPrefix([string]$Root){
 $parts=foreach($name in @('pilot-openai-key-entry.sh','pilot-google-entry.sh')){"'$name':'"+[Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $Root "deploy/hostinger-pilot/$name")))+"'"}
 'CHAT_OWNER_FILES_B64={'+($parts -join ',')+"}`n"
}

function Get-KeyComparePrefix([string]$KeysFile){
 # Keyed, one-time comparison input: a fresh random nonce and HMAC-SHA256(nonce, local key). The key itself never leaves this function.
 $entries=@([IO.File]::ReadAllLines($KeysFile)|Where-Object{$_ -cmatch '^\s*SARVAM_API_KEY\s*='})
 if($entries.Count -ne 1){throw 'local_key_ambiguous'}
 $value=($entries[0] -replace '^\s*SARVAM_API_KEY\s*=\s*','').Trim().Trim('"').Trim("'")
 if($value.Length -lt 8 -or $value.Length -gt 4096 -or $value -match '\s'){throw 'local_key_invalid'}
 $nonce=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
 $hmac=[Security.Cryptography.HMACSHA256]::new($nonce)
 try{$tag=$hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))}finally{$hmac.Dispose();$value=$null;$entries=$null}
 "KEY_COMPARE={'nonce':'"+[Convert]::ToBase64String($nonce)+"','tag':'"+[Convert]::ToHexString($tag).ToLowerInvariant()+"'}`n"
}

function Get-SafeKeyCompare($Facts){
 if($Facts.readOnly -ne $true -or $Facts.fileWrites -ne 0 -or $Facts.providerCalls -ne 0 -or $Facts.callsPlaced -ne 0){throw 'key_compare_receipt_denied'}
 $safe=@{mode='sarvam-key-compare';status=$(if($Facts.status -cin @('verified','failed')){$Facts.status}else{'unverified'});readOnly=$true;fileWrites=0;providerCalls=0;callsPlaced=0}
 if($Facts.category -is [string] -and $Facts.category -cmatch '^[a-z0-9_]{1,64}$'){$safe.category=$Facts.category}
 if($Facts.status -eq 'verified'){if($Facts.keysMatch -isnot [bool]){throw 'key_compare_receipt_denied'};$safe.keysMatch=$Facts.keysMatch}
 $safe
}

function Get-SafeCallDiagnostic($Facts){
 # Read-only diagnostic receipt: exact enums and patterns only; any other field or value is dropped or refused.
 if($Facts.readOnly -ne $true -or $Facts.databaseWrites -ne 0 -or $Facts.providerCalls -ne 0 -or $Facts.callsPlaced -ne 0){throw 'diagnostic_receipt_denied'}
 $states=@('queued','ringing','answered','completed','failed','cancelled','busy','no_answer')
 $safe=@{mode='phone-call-diagnostic';status=$(if($Facts.status -cin @('verified','failed')){$Facts.status}else{'unverified'});readOnly=$true;databaseWrites=0;providerCalls=0;callsPlaced=0}
 if($Facts.category -is [string] -and $Facts.category -cmatch '^[a-z0-9_]{1,64}$'){$safe.category=$Facts.category}
 if($Facts.status -eq 'verified'){
  $safe.calls=@(foreach($c in @($Facts.calls)){
   if($c.createdIst -cnotmatch '^2026-11-02 13:54:[0-5][0-9] IST$' -or $c.state -cnotin $states -or $c.dispatchStatus -cnotin @('not_applicable','pending','claimed','unverified','failed','unknown') -or
    ($null -ne $c.dispatchCode -and $c.dispatchCode -cnotmatch '^[A-Z0-9_]{1,64}$') -or $c.hasProviderRequestId -isnot [bool]){throw 'diagnostic_receipt_denied'}
   @{createdIst=$c.createdIst;state=$c.state;dispatchStatus=$c.dispatchStatus;dispatchCode=$c.dispatchCode;hasProviderRequestId=$c.hasProviderRequestId;
     events=@(foreach($e in @($c.events)){if($e.kind -cnotin @('state','recipient_final','interruption') -or ($null -ne $e.state -and $e.state -cnotin $states)){throw 'diagnostic_receipt_denied'};@{sequence=[int]$e.sequence;kind=$e.kind;state=$e.state}})}
  })
 }
 $safe
}

function Get-SafePhoneReceipt($Facts,[string]$Mode){
 $steps=@('preconditions','load_image','recreate_api','owner_files','live_checks','post_checks','done')
 $safe=@{mode=$Mode;status=$(if($Facts.status -cin @('verified','failed')){$Facts.status}else{'unverified'});step=$(if($Facts.step -cin $steps){$Facts.step}else{'unknown'});providerCalls=0;callsPlaced=0}
 if($Facts.providerCalls -ne 0 -or $Facts.callsPlaced -ne 0){throw 'phone_receipt_denied'}
 if($Facts.category -is [string] -and $Facts.category -cmatch '^[a-z0-9_]{1,64}$'){$safe.category=$Facts.category}
 if($Facts.image -is [string] -and $Facts.image -cmatch '^sha256:[a-f0-9]{64}$'){$safe.image=$Facts.image}
 if($Facts.rollbackImage -is [string] -and $Facts.rollbackImage -cmatch '^sha256:[a-f0-9]{64}$'){$safe.rollbackImage=$Facts.rollbackImage}
 foreach($flag in @('callingEnabled','chatEnabled','googleEnabled','sendStatePreserved','otherServicesUnchanged','traefikAccessLog')){if($Facts.$flag -is [bool]){$safe.$flag=$Facts.$flag}}
 $safe
}

function Invoke-OwnedProcess([string]$Exe,[string[]]$Arguments,[string]$InputText,[hashtable]$Environment=@{},[int]$Timeout=15000,[string]$InputFile=''){
 $info=[Diagnostics.ProcessStartInfo]::new($Exe)
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 foreach($argument in $Arguments){$info.ArgumentList.Add($argument)}
 foreach($key in $Environment.Keys){$info.Environment[$key]=[string]$Environment[$key]}
 $child=[Diagnostics.Process]::new();$child.StartInfo=$info;$started=$false
 try{
  if(-not $child.Start()){throw 'child_start_failed'};$started=$true
  $outBuffer=[char[]]::new(1024);$errBuffer=[char[]]::new(1024)
  $stdout=$child.StandardOutput.ReadAsync($outBuffer,0,$outBuffer.Length)
  $stderr=$child.StandardError.ReadAsync($errBuffer,0,$errBuffer.Length)
  $text=[Text.StringBuilder]::new();$errCount=0;$outDone=$false;$errDone=$false
  $watch=[Diagnostics.Stopwatch]::StartNew()
  $inputPending=$null
  $inputStream=$null
  if($InputFile){$inputStream=[IO.File]::OpenRead($InputFile);$inputPending=$inputStream.CopyToAsync($child.StandardInput.BaseStream)}
  elseif($null -ne $InputText){$inputPending=$child.StandardInput.WriteAsync($InputText)}else{$child.StandardInput.Close()}
  while(-not $outDone -or -not $errDone -or $null -ne $inputPending){
   if($watch.ElapsedMilliseconds -ge $Timeout){throw 'child_timeout'}
   $progressed=$false
   if($null -ne $inputPending -and $inputPending.IsCompleted){$inputPending.GetAwaiter().GetResult();$child.StandardInput.Close();$inputPending=$null;$progressed=$true}
   if(-not $outDone -and $stdout.IsCompleted){
    $n=$stdout.GetAwaiter().GetResult();$progressed=$true
    if($n -eq 0){$outDone=$true}else{
     if($text.Length+$n -gt 32768){throw 'child_output_limit'}
     $null=$text.Append($outBuffer,0,$n);$stdout=$child.StandardOutput.ReadAsync($outBuffer,0,$outBuffer.Length)
    }
   }
   if(-not $errDone -and $stderr.IsCompleted){
    $n=$stderr.GetAwaiter().GetResult();$progressed=$true
    if($n -eq 0){$errDone=$true}else{
     $errCount+=$n;if($errCount -gt 8192){throw 'child_output_limit'}
     $stderr=$child.StandardError.ReadAsync($errBuffer,0,$errBuffer.Length)
    }
   }
   if(-not $progressed){Start-Sleep -Milliseconds 5}
  }
  $remaining=[Math]::Max(1,$Timeout-[int]$watch.ElapsedMilliseconds)
  if(-not $child.WaitForExit($remaining)){throw 'child_timeout'}
  return @{Code=$child.ExitCode;Text=$text.ToString()}
 }finally{
  if($started -and -not $child.HasExited){$child.Kill($true);if(-not $child.WaitForExit(5000)){throw 'owned_child_cleanup_failed'}}
  if($inputStream){$inputStream.Dispose()}
  $child.Dispose()
 }
}

try{
 $manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
 foreach($artifact in $manifest.artifacts){
  $actual=(Get-FileHash -LiteralPath (Join-Path $repo $artifact.path) -Algorithm SHA256).Hash.ToLowerInvariant()
  if($actual -cne $artifact.sha256){throw 'artifact_checksum_mismatch'}
 }
 if(@(@($ReviewOnly,$TestEmptyAgent,$ApprovedBackupRestore,$ApprovedHostDiagnostic,$ApprovedMigration,$ApprovedPhoneDeploy,$ApprovedPhoneLiveOn,$ApprovedPhoneLiveOff,$ApprovedPhoneUiUpdate,$ApprovedChatModelDeploy,$ApprovedChatModelOn,$ApprovedChatModelOff,$ApprovedPhoneCallDiagnostic,$ApprovedSarvamKeyCompare,$ApprovedGoogleOn,$ApprovedGoogleOff)|Where-Object{$_}).Count -gt 1){throw 'mode_conflict'}
 if($ReviewOnly -or (-not $TestEmptyAgent -and -not $ApprovedBackupRestore -and -not $ApprovedHostDiagnostic -and -not $ApprovedMigration -and -not $phoneMode -and -not $ApprovedPhoneCallDiagnostic -and -not $ApprovedSarvamKeyCompare)){
  @{mode='review_only';temporaryAgent=$true;plaintextPrivateKeyFiles=$false;remoteCommands='pinned pilot backup and isolated restore only; no source mutation or phone migrations';liveCalling=$false}|ConvertTo-Json -Compress
  exit 0
 }
 if(($ApprovedBackupRestore -or $ApprovedHostDiagnostic -or $ApprovedMigration -or $phoneMode -or $ApprovedPhoneCallDiagnostic -or $ApprovedSarvamKeyCompare) -and ($manifest.remoteExecutionAllowed -isnot [bool] -or $manifest.remoteExecutionAllowed -ne $true)){throw 'remote_execution_not_approved'}
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
 $agentOut=$agent.StandardOutput.BaseStream.CopyToAsync([IO.Stream]::Null)
 $agentErr=$agent.StandardError.BaseStream.CopyToAsync([IO.Stream]::Null)
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
  # Deploy opens a second connection after the image upload, so its key stays loaded longer; this run's agent is removed in finally.
  $keySeconds=if($ApprovedPhoneDeploy -or $ApprovedPhoneUiUpdate -or $ApprovedChatModelDeploy){'1200'}else{'120'}
  $add=Invoke-OwnedProcess (Join-Path $gitBin 'ssh-add.exe') @('-t',$keySeconds,'-') ($pem+"`n") $agentEnv 10000
  $pem=$null;[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$pointer=[IntPtr]::Zero
  if($add.Code -ne 0){throw 'agent_key_load_failed'}
  $loaded=Invoke-OwnedProcess (Join-Path $gitBin 'ssh-add.exe') @('-l') $null $agentEnv 3000
  $loadedLines=@($loaded.Text.Trim().Split("`n")|Where-Object{$_})
  $loadedFields=$loaded.Text.Trim().Split(' ',[StringSplitOptions]::RemoveEmptyEntries)
  if($loaded.Code -ne 0 -or $loadedLines.Count -ne 1 -or $loadedFields.Count -lt 2 -or $loadedFields[1] -cne $identity.fingerprint){throw 'agent_identity_mismatch'}
  $phase='pinned_backup_restore_ssh'
  $sshArgs=@('-F','none','-i',(Join-Path $identityDir 'identity.pub'),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
   '-o',('UserKnownHostsFile='+$known),'-o','GlobalKnownHostsFile=/dev/null','-o','UpdateHostKeys=no','-o','HostKeyAlgorithms=ssh-ed25519',
   '-o','KexAlgorithms=curve25519-sha256','-o','PubkeyAcceptedAlgorithms=rsa-sha2-512,rsa-sha2-256','-o','ForwardAgent=no','-o','ClearAllForwardings=yes',
   '-o','PermitLocalCommand=no','-o','ConnectionAttempts=1','-o','ConnectTimeout=12','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','root@76.13.217.50','python3 -I -S -B - --approved-phone-backup-restore')
  if($ApprovedHostDiagnostic){$sshArgs[-1]='python3 -I -S -B - --approved-phone-host-diagnostic'}
  if($ApprovedSarvamKeyCompare){
   $phase='sarvam_key_compare'
   $comparePrefix=Get-KeyComparePrefix 'C:/ThaaraProjects/thaara-speech-test/keys.env'
   $sshArgs[-1]='python3 -I -S -B - --approved-sarvam-key-compare'
   $compare=Join-Path $repo 'deploy/hostinger-pilot/sarvam-key-compare.review.py'
   $remote=Invoke-OwnedProcess (Join-Path $gitBin 'ssh.exe') $sshArgs ($comparePrefix+[IO.File]::ReadAllText($compare).Replace("`r`n","`n")) $agentEnv 120000
   $comparePrefix=$null
   $output=Get-SafeKeyCompare ($remote.Text|ConvertFrom-Json)
   $output.hostHandshakeVerified=$true
   if($remote.Code -ne 0 -and $output.status -eq 'verified'){$output.status='unverified'}
  }elseif($ApprovedPhoneCallDiagnostic){
   $phase='phone_call_diagnostic'
   $sshArgs[-1]='python3 -I -S -B - --approved-phone-call-diagnostic'
   $diagnostic=Join-Path $repo 'deploy/hostinger-pilot/phone-call-diagnostic.review.py'
   $remote=Invoke-OwnedProcess (Join-Path $gitBin 'ssh.exe') $sshArgs ([IO.File]::ReadAllText($diagnostic).Replace("`r`n","`n")) $agentEnv 120000
   $output=Get-SafeCallDiagnostic ($remote.Text|ConvertFrom-Json)
   $output.hostHandshakeVerified=$true
   if($remote.Code -ne 0 -and $output.status -eq 'verified'){$output.status='unverified'}
  }elseif($phoneMode){
   $publisher=Join-Path $repo 'deploy/hostinger-pilot/phone-publish.review.py'
   $phoneFlag=if($ApprovedPhoneDeploy){'--approved-phone-deploy'}elseif($ApprovedPhoneLiveOn){'--approved-phone-live-on'}elseif($ApprovedPhoneUiUpdate){'--approved-phone-ui-update'}elseif($ApprovedChatModelDeploy){'--approved-chat-model-deploy'}elseif($ApprovedChatModelOn){'--approved-chat-model-on'}elseif($ApprovedChatModelOff){'--approved-chat-model-off'}elseif($ApprovedGoogleOn){'--approved-google-on'}elseif($ApprovedGoogleOff){'--approved-google-off'}else{'--approved-phone-live-off'}
   $prefix=''
   if($ApprovedPhoneDeploy){
    $phase='phone_image_upload'
    $sshArgs[-1]='umask 077; cat > /opt/thaara-v2-pilot-private/handoff/phone110-image.tar.gz'
    $upload=Invoke-OwnedProcess (Join-Path $gitBin 'ssh.exe') $sshArgs $null $agentEnv 900000 (Join-Path $repo 'node_modules/.cache/phone110-image.tar.gz')
    if($upload.Code -ne 0){throw 'phone_image_upload_failed'}
    $prefix=Get-PhoneOwnerFilesPrefix $repo
   }
   if($ApprovedPhoneUiUpdate){
    # Image only: no owner files, no environment or secret change.
    $phase='phone_image_upload'
    $sshArgs[-1]='umask 077; cat > /opt/thaara-v2-pilot-private/handoff/phone110-ui-image.tar.gz'
    $upload=Invoke-OwnedProcess (Join-Path $gitBin 'ssh.exe') $sshArgs $null $agentEnv 900000 (Join-Path $repo 'node_modules/.cache/phone110-ui-image.tar.gz')
    if($upload.Code -ne 0){throw 'phone_image_upload_failed'}
   }
   if($ApprovedChatModelDeploy){
    # Image plus the owner's key-entry script only; no key, environment or secret change.
    $phase='phone_image_upload'
    $sshArgs[-1]='umask 077; cat > /opt/thaara-v2-pilot-private/handoff/phone110-chat-image.tar.gz'
    $upload=Invoke-OwnedProcess (Join-Path $gitBin 'ssh.exe') $sshArgs $null $agentEnv 900000 (Join-Path $repo 'node_modules/.cache/phone110-chat-image.tar.gz')
    if($upload.Code -ne 0){throw 'phone_image_upload_failed'}
    $prefix=Get-ChatOwnerFilesPrefix $repo
   }
   $phase='phone_publish'
   $sshArgs[-1]="python3 -I -S -B - $phoneFlag"
   $remote=Invoke-OwnedProcess (Join-Path $gitBin 'ssh.exe') $sshArgs ($prefix+[IO.File]::ReadAllText($publisher).Replace("`r`n","`n")) $agentEnv 900000
   $output=Get-SafePhoneReceipt ($remote.Text|ConvertFrom-Json) $phoneFlag.Replace('--approved-','')
   $output.hostHandshakeVerified=$true
   if($remote.Code -ne 0 -and $output.status -eq 'verified'){$output.status='unverified'}
  }else{
  if($ApprovedMigration){$sshArgs[-1]='python3 -I -S -B - --approved-phone-migration-110'}
  $remoteTimeout=if($ApprovedHostDiagnostic){180000}elseif($ApprovedMigration){900000}else{720000}
  $sqlPrefix=if($ApprovedMigration){Get-MigrationSqlPrefix $repo}else{''}
  $remote=Invoke-OwnedProcess (Join-Path $gitBin 'ssh.exe') $sshArgs ($sqlPrefix+[IO.File]::ReadAllText($payload).Replace("`r`n","`n")) $agentEnv $remoteTimeout
  $facts=$remote.Text|ConvertFrom-Json
  # Only the migration mode may report a mutated source, and only after a verified fresh backup.
  $mutationAllowed=$ApprovedMigration -and $facts.archiveSha256 -cmatch '^[a-f0-9]{64}$'
  if($facts.status -notin @('verified','failed') -or $facts.cleanupVerified -isnot [bool] -or $facts.sourceMutated -isnot [bool] -or ($facts.sourceMutated -ne $false -and -not $mutationAllowed) -or $facts.providerCalls -ne 0){throw 'backup_receipt_denied'}
  $output=@{mode='backup_restore';status=$facts.status;restoreCleanupVerified=$facts.cleanupVerified;sourceMutated=$facts.sourceMutated;providerCalls=0;hostHandshakeVerified=$true}
  if($ApprovedMigration){
   $output.mode='persistent_migration'
   $output.migrationStatus=if($facts.migrationStatus -cin @('not_started','failed','verified')){$facts.migrationStatus}else{'unverified'}
   $output.migrationApplied=@(@($facts.migrationApplied)|Where-Object{$_ -cin @('110a','110b','110c')})
   $output.migrationStep=if($facts.migrationStep -cin @('precheck','110a','110b','110c','postcheck')){$facts.migrationStep}else{'unknown'}
   if($facts.migrationObserved){$output.migrationObserved=if($facts.migrationObserved -is [string]){'unverified'}else{@{contacts=$facts.migrationObserved.contacts -eq $true;calls=$facts.migrationObserved.calls -eq $true;events=$facts.migrationObserved.events -eq $true;guard=$facts.migrationObserved.guard -eq $true;dispatch=$facts.migrationObserved.dispatch -eq $true}}}
   if($facts.status -eq 'verified' -and ($facts.migrationStatus -cne 'verified' -or $facts.migrationPostVerified -ne $true -or @($output.migrationApplied).Count -ne 3)){throw 'migration_receipt_denied'}
   if($facts.status -eq 'verified'){$output.migrationPostVerified=$true}
  }
  if($ApprovedHostDiagnostic){
   if($facts.databaseAccessed -isnot [bool] -or $facts.databaseAccessed -ne $false -or $facts.resourcesCreated -isnot [bool] -or $facts.resourcesCreated -ne $false){throw 'host_diagnostic_scope_denied'}
   if($facts.PSObject.Properties.Name -contains 'backupDirectory' -or $facts.PSObject.Properties.Name -contains 'restoreContainerId'){throw 'host_diagnostic_scope_denied'}
   $output.mode='host_diagnostic';$output.databaseAccessed=$false;$output.resourcesCreated=$false
   if($facts.status -eq 'verified'){
    if($remote.Code -ne 0 -or $facts.cleanupVerified -ne $true -or $facts.sourceIdentityUnchanged -isnot [bool] -or $facts.sourceIdentityUnchanged -ne $true){throw 'host_diagnostic_result_denied'}
    $output.sourceIdentityUnchanged=$true
   }
  }
  if($facts.backupDirectory){
   if($facts.backupDirectory -cnotmatch '^/opt/thaara-v2-pilot-private/phone-backups/phone110-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{32}$'){throw 'backup_path_receipt_denied'}
   $output.backupDirectory=$facts.backupDirectory
  }
  if($facts.restoreContainerId){
   if($facts.restoreContainerId -cnotmatch '^[a-f0-9]{64}$' -or $facts.restoreContainerId -ceq '340a0ab86ef4156d87651433676978473f58c82b32e1fa4c279664261ace7893'){throw 'restore_id_receipt_denied'}
   $output.restoreContainerId=$facts.restoreContainerId
  }
  if($facts.status -eq 'verified' -and -not $ApprovedHostDiagnostic){
   foreach($flag in @('countsVerified','schemaOwnersAclVerified','rolesVerified','sourceIdentityUnchanged','restoreContainerRemoved','destructionObserved')){
    if($facts.$flag -isnot [bool] -or $facts.$flag -ne $true){throw 'backup_verification_flag_denied'}
   }
   if(-not $output.ContainsKey('backupDirectory') -or -not $output.ContainsKey('restoreContainerId') -or ($facts.tableCount -isnot [int] -and $facts.tableCount -isnot [long])){throw 'backup_receipt_identity_missing'}
   if($remote.Code -ne 0 -or -not $facts.cleanupVerified -or $facts.countsVerified -ne $true -or $facts.schemaOwnersAclVerified -ne $true -or $facts.rolesVerified -ne $true -or $facts.sourceIdentityUnchanged -ne $true -or $facts.restoreContainerRemoved -ne $true -or $facts.destructionObserved -ne $true -or $facts.archiveSha256 -cnotmatch '^[a-f0-9]{64}$' -or $facts.globalsSha256 -cnotmatch '^[a-f0-9]{64}$' -or $facts.tableCount -lt 1 -or $facts.tableCount -gt 300){throw 'verified_backup_receipt_denied'}
   $output.archiveSha256=$facts.archiveSha256;$output.globalsSha256=$facts.globalsSha256;$output.tableCount=$facts.tableCount
   $output.countsVerified=$true;$output.schemaOwnersAclVerified=$true;$output.rolesVerified=$true;$output.sourceIdentityUnchanged=$true;$output.restoreContainerRemoved=$true;$output.destructionObserved=$true
  }elseif($facts.status -eq 'failed'){
   $knownPhases=@('preflight','snapshot_backup','new_isolated_restore','restore_globals_and_database','verify_restored_snapshot','persistent_migration')
   if($ApprovedMigration -and $facts.archiveSha256 -cmatch '^[a-f0-9]{64}$'){$output.archiveSha256=$facts.archiveSha256;$output.globalsSha256=$facts.globalsSha256}
   $output.phase=if($facts.phase -in $knownPhases){$facts.phase}else{'remote_backup_failed'}
   $diagnostic=Get-SafeBackupDiagnostic $facts
   $output.category=$diagnostic.category;$output.preflightStep=$diagnostic.preflightStep
  }
  }
 }
}catch{
 # No raw exception, child stderr, key, connection string or remote payload is printed.
 $localCategory=if($_.Exception.Message -ceq 'child_timeout'){'command_timeout'}else{'unclassified_failure'}
 $output=@{status='stopped';phase=$phase;category=$localCategory};$global:LASTEXITCODE=1
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
$output|ConvertTo-Json -Compress -Depth 6
if($output.status -in @('stopped','failed') -or -not $cleanup -or $output.restoreCleanupVerified -eq $false){exit 1}
