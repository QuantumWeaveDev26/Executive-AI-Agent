# Local synthetic child-process tests; extracts only the process function, never authentication/main.
#requires -Version 7.0
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$helper=Join-Path $PSScriptRoot 'phone-backup-restore.review.ps1'
$ast=[Management.Automation.Language.Parser]::ParseFile($helper,[ref]$tokens,[ref]$errors)
if($errors.Count){throw 'helper_syntax_failed'}
$function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-OwnedProcess'},$true)
if(-not $function){throw 'process_function_missing'}
. ([scriptblock]::Create($function.Extent.Text))
$pwsh=(Get-Process -Id $PID).Path
$passed=0
$r=Invoke-OwnedProcess $pwsh @('-NoProfile','-NonInteractive','-Command','[Console]::Out.Write("synthetic")') $null @{} 5000
if($r.Code -ne 0 -or $r.Text -cne 'synthetic'){throw 'small_output_failed'};$passed++
foreach($command in @('[Console]::Out.Write("x" * 40000)','[Console]::Error.Write("x" * 10000)')){
 $refused=$false
 try{$null=Invoke-OwnedProcess $pwsh @('-NoProfile','-NonInteractive','-Command',$command) $null @{} 5000}
 catch{if($_.Exception.Message -cne 'child_output_limit'){throw 'unexpected_stream_failure'};$refused=$true}
 if(-not $refused){throw 'output_cap_missing'};$passed++
}
$refused=$false;$watch=[Diagnostics.Stopwatch]::StartNew()
try{$null=Invoke-OwnedProcess $pwsh @('-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 10') $null @{} 300}
catch{if($_.Exception.Message -cne 'child_timeout'){throw 'unexpected_timeout_failure'};$refused=$true}
if(-not $refused -or $watch.ElapsedMilliseconds -gt 6000){throw 'child_timeout_missing'};$passed++
$inputText='synthetic'*6000
$r=Invoke-OwnedProcess $pwsh @('-NoProfile','-NonInteractive','-Command','[Console]::Out.Write([Console]::In.ReadToEnd().Length)') $inputText @{} 5000
if($r.Code -ne 0 -or $r.Text -cne ([string]$inputText.Length)){throw 'async_stdin_failed'};$passed++
@{passed=$passed;failed=0;credentialsRead=$false;remoteAccess=$false}|ConvertTo-Json -Compress
