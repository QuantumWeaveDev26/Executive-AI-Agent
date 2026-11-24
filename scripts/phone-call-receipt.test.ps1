# Local pure receipt tests. Extracts ONLY the sanitizer; never authentication or remote main.
#requires -Version 7.0
$ErrorActionPreference='Stop'
$t=$null;$e=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'phone-backup-restore.review.ps1'),[ref]$t,[ref]$e)
if($e.Count){throw 'syntax_failed'}
$f=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-SafeCallDiagnostic'},$true)
. ([scriptblock]::Create($f.Extent.Text))
$row=@{createdIst='2026-11-02 13:54:10 IST';state='failed';dispatchStatus='failed';dispatchCode='PHONE_DISPATCH_HTTP_401';hasProviderRequestId=$false;events=@();privateText='synthetic-private'}
$facts=@{status='verified';readOnly=$true;databaseWrites=0;providerCalls=0;callsPlaced=0;calls=@($row)}
$result=Get-SafeCallDiagnostic $facts
if($result.calls[0].dispatchCode -cne 'PHONE_DISPATCH_HTTP_401' -or ($result|ConvertTo-Json -Depth 5) -match 'synthetic-private'){throw 'sanitization_failed'}
$passed=1
foreach($date in @('2026-10-31 13:54:10 IST','2026-11-02 13:55:10 IST','2026-11-02 13:54:99 IST')){
 $row.createdIst=$date;$denied=$false
 try{$null=Get-SafeCallDiagnostic $facts}catch{if($_.Exception.Message -cne 'diagnostic_receipt_denied'){throw};$denied=$true}
 if(-not $denied){throw 'window_not_restricted'};$passed++
}
@{passed=$passed;failed=0;remoteAccess=$false;credentialsRead=$false}|ConvertTo-Json -Compress
