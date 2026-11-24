param([switch]$ApprovedInMemoryPhone113RetryV2)
$ErrorActionPreference='Stop'
if(-not $ApprovedInMemoryPhone113RetryV2){throw 'PHONE113_EXPLICIT_APPROVAL_REQUIRED'}
$phone113Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$phone113Manifest=Join-Path $phone113Root 'docs/integrations/phone/PHONE113_RETRY_V2_APPROVAL.review.json'
$phone113Config=Get-Content -LiteralPath $phone113Manifest -Raw | ConvertFrom-Json
if($phone113Config.reviewOnly -ne $true -or $phone113Config.environment -ne 'new-in-memory-PGlite-only'){throw 'PHONE113_MANIFEST_INVALID'}
if($phone113Config.purpose -ne 'one-acceptance-retry-v2' -or $phone113Config.acceptanceTests -ne 10){throw 'PHONE113_RETRY_V2_SCOPE_INVALID'}
foreach($phone113Entry in $phone113Config.files.PSObject.Properties){
 $phone113Path=[IO.Path]::GetFullPath((Join-Path $phone113Root $phone113Entry.Name))
 if(-not $phone113Path.StartsWith($phone113Root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'PHONE113_PATH_OUTSIDE_WORKSPACE'}
 if((Get-FileHash -LiteralPath $phone113Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $phone113Entry.Value){throw 'PHONE113_CHECKSUM_MISMATCH'}
}
if(Test-Path Env:\THAARA_PHONE113_SQL_TEST_APPROVED){throw 'PHONE113_OLD_SQL_GATE_REFUSED'}
if(Test-Path Env:\THAARA_PHONE113_DIAGNOSTIC_APPROVED){throw 'PHONE113_OLD_DIAGNOSTIC_GATE_REFUSED'}
if(Test-Path Env:\THAARA_PHONE113_RETRY_V2_APPROVED){throw 'PHONE113_EXISTING_GATE_REFUSED'}
$phone113Cache=Join-Path $phone113Root 'node_modules/.cache'
if(-not(Test-Path -LiteralPath $phone113Cache -PathType Container)){throw 'PHONE113_EXPECTED_CACHE_MISSING'}
if((Get-Item -LiteralPath $phone113Cache).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'PHONE113_CACHE_REPARSE_POINT_REFUSED'}
$phone113Marker=Join-Path $phone113Cache 'phone113-retry-v2-used.json'
foreach($phone113Artifact in @('phone113-retry-v2-execution.json','phone113-retry-v2-evidence.json')){
 if(Test-Path -LiteralPath (Join-Path $phone113Cache $phone113Artifact)){throw 'PHONE113_EXISTING_RETRY_V2_ARTIFACT_REFUSED'}
}
# CreateNew consumes exactly one attempt. Never delete/reset an existing guard, including on failure.
$phone113Stream=[IO.File]::Open($phone113Marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{
 $phone113Record=@{scope='in-memory-only';startedAt=[DateTime]::UtcNow.ToString('o');manifestSha256=(Get-FileHash -LiteralPath $phone113Manifest -Algorithm SHA256).Hash.ToLowerInvariant()}
 $phone113Bytes=[Text.Encoding]::UTF8.GetBytes(($phone113Record|ConvertTo-Json -Compress));$phone113Stream.Write($phone113Bytes,0,$phone113Bytes.Length)
}finally{$phone113Stream.Dispose()}
$phone113Location=Get-Location
try{
 Set-Location -LiteralPath $phone113Root
 $env:THAARA_PHONE113_RETRY_V2_APPROVED='in-memory-only'
 & pnpm exec vitest run apps/api/test/phone-inbound-principal-retry-v2.test.ts --pool=threads --poolOptions.threads.singleThread --bail=1 --reporter=default --reporter=json --outputFile=node_modules/.cache/phone113-retry-v2-execution.json
 if($LASTEXITCODE -ne 0){throw 'PHONE113_ACCEPTANCE_FAILED_NO_AUTOMATIC_RETRY'}
}finally{
 Remove-Item Env:\THAARA_PHONE113_RETRY_V2_APPROVED -ErrorAction SilentlyContinue
 Set-Location -LiteralPath $phone113Location.Path
}
