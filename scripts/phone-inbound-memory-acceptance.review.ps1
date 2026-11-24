param([switch]$ApprovedInMemoryPhone111)
$ErrorActionPreference='Stop'
if(-not $ApprovedInMemoryPhone111){throw 'PHONE111_EXPLICIT_APPROVAL_REQUIRED'}
$phone111Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$phone111Manifest=Join-Path $phone111Root 'docs/integrations/phone/PHONE111_IN_MEMORY_APPROVAL.review.json'
$phone111Config=Get-Content -LiteralPath $phone111Manifest -Raw | ConvertFrom-Json
if($phone111Config.reviewOnly -ne $true -or $phone111Config.environment -ne 'new-in-memory-PGlite-only'){throw 'PHONE111_MANIFEST_INVALID'}
foreach($phone111Entry in $phone111Config.files.PSObject.Properties){
 $phone111Path=[IO.Path]::GetFullPath((Join-Path $phone111Root $phone111Entry.Name))
 if(-not $phone111Path.StartsWith($phone111Root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'PHONE111_PATH_OUTSIDE_WORKSPACE'}
 if((Get-FileHash -LiteralPath $phone111Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $phone111Entry.Value){throw 'PHONE111_CHECKSUM_MISMATCH'}
}
if(Test-Path Env:\THAARA_PHONE111_SQL_TEST_APPROVED){throw 'PHONE111_EXISTING_GATE_REFUSED'}
$phone111Cache=Join-Path $phone111Root 'node_modules/.cache'
if(-not(Test-Path -LiteralPath $phone111Cache -PathType Container)){throw 'PHONE111_EXPECTED_CACHE_MISSING'}
if((Get-Item -LiteralPath $phone111Cache).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'PHONE111_CACHE_REPARSE_POINT_REFUSED'}
$phone111Marker=Join-Path $phone111Cache 'phone111-in-memory-v1-used.json'
# CreateNew consumes exactly one attempt. Never delete/reset an existing guard, including on failure.
$phone111Stream=[IO.File]::Open($phone111Marker,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try{
 $phone111Record=@{scope='in-memory-only';startedAt=[DateTime]::UtcNow.ToString('o');manifestSha256=(Get-FileHash -LiteralPath $phone111Manifest -Algorithm SHA256).Hash.ToLowerInvariant()}
 $phone111Bytes=[Text.Encoding]::UTF8.GetBytes(($phone111Record|ConvertTo-Json -Compress));$phone111Stream.Write($phone111Bytes,0,$phone111Bytes.Length)
}finally{$phone111Stream.Dispose()}
$phone111Location=Get-Location
try{
 Set-Location -LiteralPath $phone111Root
 $env:THAARA_PHONE111_SQL_TEST_APPROVED='in-memory-only'
 & pnpm exec vitest run apps/api/test/phone-inbound-storage-acceptance.test.ts --pool=threads --poolOptions.threads.singleThread --bail=1 --reporter=default --reporter=json --outputFile=node_modules/.cache/phone111-in-memory-acceptance.json
 if($LASTEXITCODE -ne 0){throw 'PHONE111_ACCEPTANCE_FAILED_NO_AUTOMATIC_RETRY'}
}finally{
 Remove-Item Env:\THAARA_PHONE111_SQL_TEST_APPROVED -ErrorAction SilentlyContinue
 Set-Location -LiteralPath $phone111Location.Path
}
