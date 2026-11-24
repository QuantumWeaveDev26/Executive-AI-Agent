param([switch]$Approved)
$ErrorActionPreference='Stop'
if(-not $Approved){throw 'Explicit approval for the dedicated VPS administrator SSH identity is required.'}
$taskIdentityDirectory=Join-Path $env:USERPROFILE '.codex/credentials/thaara-ai-v2-vps1871828'
$taskIdentityDirectory=[IO.Path]::GetFullPath($taskIdentityDirectory)
$taskExpectedDirectory=[IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.codex/credentials/thaara-ai-v2-vps1871828'))
if($taskIdentityDirectory -ne $taskExpectedDirectory){throw 'Identity path mismatch.'}
$taskPrivatePath=Join-Path $taskIdentityDirectory 'private-key.clixml'
$taskPublicPath=Join-Path $taskIdentityDirectory 'identity.pub'
$taskMetadataPath=Join-Path $taskIdentityDirectory 'identity.json'
if(Test-Path -LiteralPath $taskIdentityDirectory){throw 'Identity directory already exists; verify it without overwriting or regenerating keys.'}
$taskSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
[IO.Directory]::CreateDirectory($taskIdentityDirectory) | Out-Null
$taskAcl=[Security.AccessControl.DirectorySecurity]::new()
$taskAcl.SetAccessRuleProtection($true,$false)
$taskAcl.SetOwner($taskSid)
$taskInheritance=[Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$taskPropagation=[Security.AccessControl.PropagationFlags]::None
$taskAllow=[Security.AccessControl.AccessControlType]::Allow
$taskAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($taskSid,'FullControl',$taskInheritance,$taskPropagation,$taskAllow))
$taskAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-18'),'FullControl',$taskInheritance,$taskPropagation,$taskAllow))
Set-Acl -LiteralPath $taskIdentityDirectory -AclObject $taskAcl
$taskActualAcl=Get-Acl -LiteralPath $taskIdentityDirectory
if(-not $taskActualAcl.AreAccessRulesProtected -or $taskActualAcl.Access.Count -ne 2){throw 'Identity storage permissions could not be protected.'}
$taskRsa=$null;$taskPublicRsa=$null;$taskPem=$null;$taskSecurePem=$null;$taskStream=$null;$taskPointer=[IntPtr]::Zero
try {
 $taskRsa=[Security.Cryptography.RSA]::Create(3072)
 $taskPublic=$taskRsa.ExportParameters($false)
 $taskStream=[IO.MemoryStream]::new()
 function Add-SshField([byte[]]$Field){$length=[BitConverter]::GetBytes([uint32]$Field.Length);if([BitConverter]::IsLittleEndian){[array]::Reverse($length)};$taskStream.Write($length,0,$length.Length);$taskStream.Write($Field,0,$Field.Length)}
 function Positive-SshInteger([byte[]]$Field){if($Field[0] -ge 128){return [byte[]](@(0)+$Field)};return $Field}
 Add-SshField ([Text.Encoding]::ASCII.GetBytes('ssh-rsa'))
 Add-SshField (Positive-SshInteger $taskPublic.Exponent)
 Add-SshField (Positive-SshInteger $taskPublic.Modulus)
 $taskBlob=$taskStream.ToArray()
 $taskPublicKey='ssh-rsa '+[Convert]::ToBase64String($taskBlob)+' THAARA AI V2'
 $taskFingerprint='SHA256:'+([Convert]::ToBase64String([Security.Cryptography.SHA256]::HashData($taskBlob))).TrimEnd('=')
 $taskChallenge=New-Object byte[] 32;[Security.Cryptography.RandomNumberGenerator]::Fill($taskChallenge)
 $taskSignature=$taskRsa.SignData($taskChallenge,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
 $taskPublicRsa=[Security.Cryptography.RSA]::Create();$taskPublicRsa.ImportParameters($taskPublic)
 if(-not $taskPublicRsa.VerifyData($taskChallenge,$taskSignature,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)){throw 'SSH key consistency check failed.'}
 $taskPem=$taskRsa.ExportRSAPrivateKeyPem()
 $taskSecurePem=ConvertTo-SecureString $taskPem -AsPlainText -Force
 $taskSecurePem | Export-Clixml -LiteralPath $taskPrivatePath
 $taskReloaded=Import-Clixml -LiteralPath $taskPrivatePath
 $taskPointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskReloaded)
 if([Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer) -cne $taskPem){throw 'Protected key round-trip verification failed.'}
 [IO.File]::WriteAllText($taskPublicPath,$taskPublicKey+"`n",[Text.UTF8Encoding]::new($false))
 $taskMetadata=[ordered]@{label='THAARA AI V2';virtualMachineId=1871828;hostname='srv1871828.hstgr.cloud';address='76.13.217.50';port=22;keyType='RSA3072';requiredSignature='rsa-sha2-256-or-512';fingerprint=$taskFingerprint;privateStorage='Windows DPAPI CurrentUser plus protected user/SYSTEM ACL';createdAt=[DateTime]::UtcNow.ToString('o');enrolled=$false}
 [IO.File]::WriteAllText($taskMetadataPath,($taskMetadata|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
 & ssh-keygen -lf $taskPublicPath
 if($LASTEXITCODE -ne 0){throw 'OpenSSH public-key verification failed.'}
 'Dedicated identity created; private key stored only as DPAPI-encrypted data.'
 'Key consistency, encryption round-trip and protected ACL checks passed.'
 'No remote enrollment or SSH authentication performed by this script.'
} finally {
 if($taskPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)}
 if($taskRsa){$taskRsa.Dispose()};if($taskPublicRsa){$taskPublicRsa.Dispose()};if($taskStream){$taskStream.Dispose()}
 $taskPem=$null;$taskSecurePem=$null;$taskReloaded=$null
}
