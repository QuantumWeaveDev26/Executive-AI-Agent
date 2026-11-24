param([switch]$ApprovedInMemoryPhone112)
$ErrorActionPreference='Stop'
if(-not $ApprovedInMemoryPhone112){throw 'PHONE112_EXPLICIT_APPROVAL_REQUIRED'}
$phone112Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$phone112Manifest=Join-Path $phone112Root 'docs/integrations/phone/PHONE112_IN_MEMORY_APPROVAL.review.json'
$phone112Config=Get-Content -LiteralPath $phone112Manifest -Raw | ConvertFrom-Json
if($phone112Config.reviewOnly -ne $true -or $phone112Config.environment -ne 'new-in-memory-PGlite-only'){throw 'PHONE112_MANIFEST_INVALID'}
foreach($phone112Entry in $phone112Config.files.PSObject.Properties){
 $phone112Path=[IO.Path]::GetFullPath((Join-Path $phone112Root $phone112Entry.Name))
 if(-not $phone112Path.StartsWith($phone112Root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'PHONE112_PATH_OUTSIDE_WORKSPACE'}
 if((Get-FileHash -LiteralPath $phone112Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $phone112Entry.Value){throw 'PHONE112_CHECKSUM_MISMATCH'}
}
if(Test-Path Env:\THAARA_PHONE112_SQL_TEST_APPROVED){throw 'PHONE112_EXISTING_GATE_REFUSED'}
$phone112Cache=Join-Path $phone112Root 'node_modules/.cache'
if(-not(Test-Path -LiteralPath $phone112Cache -PathType Container)){throw 'PHONE112_EXPECTED_CACHE_MISSING'}
if((Get-Item -LiteralPath $phone112Cache).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'PHONE112_CACHE_REPARSE_POINT_REFUSED'}
$phone112Marker=Join-Path $phone112Cache 'phone112-in-memory-v1-used.json'
# CreateNew consumes exactly one attempt. Never delete/reset an existing guard, including on failure.
$phone112Stream=[IO.File]::Open($phone112Marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{
 $phone112Record=@{scope='in-memory-only';startedAt=[DateTime]::UtcNow.ToString('o');manifestSha256=(Get-FileHash -LiteralPath $phone112Manifest -Algorithm SHA256).Hash.ToLowerInvariant()}
 $phone112Bytes=[Text.Encoding]::UTF8.GetBytes(($phone112Record|ConvertTo-Json -Compress));$phone112Stream.Write($phone112Bytes,0,$phone112Bytes.Length)
}finally{$phone112Stream.Dispose()}
$phone112Location=Get-Location
try{
 Set-Location -LiteralPath $phone112Root
 $env:THAARA_PHONE112_SQL_TEST_APPROVED='in-memory-only'
 & pnpm exec vitest run apps/api/test/phone-inbound-event-acceptance.test.ts --pool=threads --poolOptions.threads.singleThread --bail=1 --reporter=default --reporter=json --outputFile=node_modules/.cache/phone112-in-memory-acceptance.json
 if($LASTEXITCODE -ne 0){throw 'PHONE112_ACCEPTANCE_FAILED_NO_AUTOMATIC_RETRY'}
}finally{
 Remove-Item Env:\THAARA_PHONE112_SQL_TEST_APPROVED -ErrorAction SilentlyContinue
 Set-Location -LiteralPath $phone112Location.Path
}
