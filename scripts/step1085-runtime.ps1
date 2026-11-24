param([Parameter(Mandatory=$true)][ValidateSet('initialize','test')][string]$Mode,[switch]$Approved)
$ErrorActionPreference='Stop'
if(-not $Approved){throw 'Explicit Step1085 isolated setup/SQL/test approval is required.'}
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskCache=Join-Path $taskRoot 'node_modules/.cache/step1085'
$credentialPath=Join-Path $taskCache 'credentials.clixml'
if(-not (Test-Path -LiteralPath $credentialPath)){
  if($Mode -ne 'initialize'){throw 'No Step1085 fixture credentials exist.'}
  New-Item -ItemType Directory -Path $taskCache -Force | Out-Null
  function New-FixtureSecret { $bytes=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes); return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_') }
  $privateFixture=[pscustomobject]@{Admin=(ConvertTo-SecureString (New-FixtureSecret) -AsPlainText -Force);App=(ConvertTo-SecureString (New-FixtureSecret) -AsPlainText -Force)}
  $privateFixture | Export-Clixml -LiteralPath $credentialPath
}
$privateFixture=Import-Clixml -LiteralPath $credentialPath
function Get-FixturePlain([Security.SecureString]$Secret){$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret);try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}}
$previousAdmin=$env:THAARA_1085_ADMIN_PASSWORD;$previousApp=$env:THAARA_1085_APP_PASSWORD
try{
  $env:THAARA_1085_ADMIN_PASSWORD=Get-FixturePlain $privateFixture.Admin
  $env:THAARA_1085_APP_PASSWORD=Get-FixturePlain $privateFixture.App
  Push-Location -LiteralPath $taskRoot
  try { & node (Join-Path $PSScriptRoot 'step1085-runtime.mjs') $Mode --approved; if($LASTEXITCODE -ne 0){throw 'Step1085 runner failed. Existing resources were not selected as a fallback.'} }
  finally { Pop-Location }
} finally {$env:THAARA_1085_ADMIN_PASSWORD=$previousAdmin;$env:THAARA_1085_APP_PASSWORD=$previousApp;$privateFixture=$null}
