#requires -Version 7.0
param([ValidatePattern('^[a-z0-9-]{1,24}$')][string]$Revision='r5')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cache=Join-Path $repo 'node_modules/.cache'
$baselinePath=Join-Path $cache 'phone-step115-install-verification-20261111.result.json'
$baseline=Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json
if($baseline.status -ne 'verified' -or $baseline.sourceHealthy -ne $true -or
   $baseline.changesMade -ne $false -or $baseline.providerRequests -ne 0 -or
   $baseline.imageId -notmatch '^sha256:[a-f0-9]{64}$'){throw 'Verified read-only baseline receipt required.'}
$evidencePath=Join-Path $cache 'phone-step115-r3-tests.result.json'
$evidence=Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
if($evidence.success -ne $true -or $evidence.numFailedTests -ne 0 -or $evidence.numPendingTests -ne 0 -or
 $evidence.numPassedTests -ne 97 -or $evidence.testResults.Count -ne 13){throw 'Final Step 115 acceptance evidence is incomplete.'}
$uiEvidencePath=Join-Path $cache 'phone-step115-ui-tests.result.json'
$uiEvidence=Get-Content -LiteralPath $uiEvidencePath -Raw | ConvertFrom-Json
if($uiEvidence.success -ne $true -or $uiEvidence.numPassedTests -ne 86 -or $uiEvidence.numFailedTests -ne 0 -or
 $uiEvidence.testResults.Count -ne 6){throw 'Phone UI acceptance evidence is incomplete.'}
$pg16EvidencePath=Join-Path $cache 'phone-step115-pg16-local-rehearsal.result.json'
$pg16Evidence=Get-Content -LiteralPath $pg16EvidencePath -Raw | ConvertFrom-Json
if($pg16Evidence.status -ne 'verified' -or $pg16Evidence.serverVersion -ne '160015' -or
 $pg16Evidence.sqlSha256 -ne 'c809ba7c0a44f9bdf3b76a1566edf1fbe6fc33e39a1d0c1d25e58a53025dcf8e' -or
 $pg16Evidence.rollbackVerified -ne $true -or $pg16Evidence.sharedRowsUnchanged -ne $true -or
 $pg16Evidence.forcedRlsVerified -ne $true -or $pg16Evidence.newTablesEmpty -ne $true -or
 $pg16Evidence.beforeBackupRestore.membershipsAndDatabaseAccessMatch -ne $true -or
 $pg16Evidence.afterBackupRestore.membershipsAndDatabaseAccessMatch -ne $true -or
 $pg16Evidence.cleanupVerified -ne $true -or $pg16Evidence.productionAccess -ne $false){throw 'Real PG16 isolated acceptance is incomplete.'}
$installPath=Join-Path $repo 'docs/integrations/phone/PHONE_STEP115_INSTALL_20261111_R3.review.json'
$install=Get-Content -LiteralPath $installPath -Raw|ConvertFrom-Json
if($install.reviewOnly -ne $true -or $install.executionAuthorized -ne $false -or
 $install.target.observedApiImage -ne $baseline.imageId -or $install.provisionsLoginOrSecrets -ne $false){throw 'Installation review context changed.'}
foreach($inputFile in @($install.inputs)+@($install.sql)){
 if((Get-FileHash -LiteralPath (Join-Path $repo $inputFile.path) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $inputFile.sha256){throw 'Installation input checksum changed.'}
}
$paths=@(
 'scripts/prepare-phone-step115-review-20261111.ps1',
 'scripts/prepare-phone-step115-install-review.mjs',
 'scripts/prepare-phone-step115-disabled-install.mjs',
 'scripts/prepare-phone-step115-install-verification.mjs',
 'scripts/phone_step115_disabled_install_test.py',
 'scripts/phone_step115_pg16_local_rehearsal.py',
 'scripts/phone_step115_pg16_local_rehearsal_test.py',
 'deploy/hostinger-pilot/phone-backup-restore.review.py',
 'scripts/phone-step115-disabled-install-20261111-r2.ps1',
 'deploy/hostinger-pilot/phone-step115-disabled-install-20261111-r2.py',
 'docs/integrations/phone/PHONE_STEP115_DISABLED_INSTALL_20261111_R2.review.json',
 'apps/web/src/phone-callback-reports.ts',
 'apps/web/src/PhoneCallbackReports.tsx',
 'apps/web/test/phone-callback-reports.test.tsx',
 'apps/web/test/phone-calling-panel.test.tsx',
 'docs/integrations/phone/STEP115_SQL_EFFECTS_AND_RECOVERY_20261111.md',
 'docs/integrations/phone/STEP115_PG16_REHEARSAL_20261111.md',
 'docs/integrations/phone/STEP115_NEXT_INSTALLATION_SCOPE_20261111.md',
 'packages/contracts/src/phone-callback-notification.ts',
 'packages/contracts/dist/phone-callback-notification.js',
 'apps/api/src/routes/phone-callback-reports.ts',
 'apps/api/src/routes/phone-callback-authorization.ts',
 'apps/api/src/routes/phone-sarvam-webhook.ts',
 'apps/api/src/services/phone-callback-mail.ts',
 'apps/api/src/services/phone-callback-grant-policy.ts',
 'apps/api/src/services/phone-callback-worker.ts',
 'apps/api/src/services/phone-callback-inbound-store.ts',
 'apps/api/src/services/phone-callback-outbound-store.ts',
 'apps/api/src/services/phone-structured-callback-store.ts',
 'apps/api/src/phone-callback-worker-start.ts',
 'apps/api/src/services/phone-callback-notification.ts',
 'apps/api/src/services/phone-callback-notification-store.ts',
 'apps/api/src/services/phone-callback-queue.ts',
 'apps/api/src/services/phone-callback-reports.ts',
 'apps/api/src/services/phone-callback-runtime.ts',
 'apps/api/src/services/phone-inbound-principal-journal.ts',
 'apps/api/src/services/phone-sarvam-callback-completion.ts',
 'apps/api/src/services/phone-sarvam-inbound-service.ts',
 'apps/api/test/phone-callback-mail.test.ts',
 'apps/api/test/phone-callback-authorization.test.ts',
 'apps/api/test/phone-callback-worker.test.ts',
 'apps/api/test/phone-callback-worker-start.test.ts',
 'apps/api/test/phone-callback-outbound.test.ts',
 'apps/api/test/phone-step115-install-review.test.ts',
 'apps/api/test/phone-callback-notification.test.ts',
 'apps/api/test/phone-callback-notification-store.test.ts',
 'apps/api/test/phone-callback-reports.test.ts',
 'apps/api/test/phone-sarvam-inbound-service.test.ts',
 'docs/migrations/115-phone-callback-notification.review.sql',
 'docs/migrations/115g-phone-callback-grants.review.sql',
 'docs/migrations/115w-phone-callback-worker.review.sql',
 'docs/migrations/115i-phone-callback-inbound-save.review.sql',
 'docs/migrations/115o-phone-callback-outbound.review.sql',
 'docs/migrations/114-phone-structured-report.review.sql',
 'docs/migrations/112-phone-inbound-events.review.sql',
 'docs/migrations/113-phone-inbound-principals.review.sql',
 'docs/migrations/115-step115-hosted-install-20261111-r2.review.sql',
 'docs/integrations/phone/PHONE_STEP115_INSTALL_20261111_R3.review.json',
 'docs/integrations/phone/PHONE_STEP115_SCHEMA_20261111.review.json',
 'docs/tasks/115-phone-callback-notification.md',
 'docs/integrations/phone/STEP115_RELEASE_20261111.md',
 'docs/integrations/phone/STEP115_INTEGRATION_POINTS.review.md',
 'docs/integrations/phone/STEP115_PRODUCTION_SCHEMA_PREFLIGHT.review.sql',
 'docs/integrations/phone/STEP115_INSTALLATION_SCOPE_20261111.md',
 'docs/integrations/phone/knowledge/runtime-v19-v21-20261108-review/CALLBACK_COLLECTION.review.md',
 'node_modules/.cache/phone-step115-r3-tests.result.json',
 'node_modules/.cache/phone-step115-schema-20261111.result.json',
 'node_modules/.cache/phone-step115-install-verification-20261111.result.json',
 'node_modules/.cache/phone-step115-disabled-install-20261111.result.json',
 'node_modules/.cache/phone-step115-ui-tests.result.json',
 'node_modules/.cache/phone-step115-rollback-isolation-tests.result.json',
 'node_modules/.cache/phone-step115-pg16-local-rehearsal.result.json',
 'node_modules/.cache/phone-step115-local-baseline-functions.result.json'
)
$paths+=@('phone-callback-mail','phone-callback-grant-policy','phone-callback-worker','phone-callback-inbound-store',
 'phone-callback-outbound-store','phone-structured-callback-store','phone-callback-notification','phone-callback-notification-store',
 'phone-callback-queue','phone-callback-reports','phone-callback-runtime','phone-inbound-principal-journal',
 'phone-sarvam-callback-completion','phone-sarvam-inbound-service') | ForEach-Object { 'apps/api/dist/services/'+$_+'.js' }
$paths+=@('apps/api/dist/routes/phone-callback-reports.js','apps/api/dist/routes/phone-callback-authorization.js','apps/api/dist/routes/phone-sarvam-webhook.js')
$paths+=@('apps/api/dist/phone-callback-worker-start.js')
$files=[ordered]@{}
foreach($path in $paths){$files[$path]=(Get-FileHash -LiteralPath (Join-Path $repo $path) -Algorithm SHA256).Hash.ToLowerInvariant()}
$manifest=[ordered]@{
 schemaVersion=1; task='phone-step-115'; reviewOnly=$true; deployable=$false
 baseImage=$baseline.imageId
 baselineReceiptSha256=(Get-FileHash -LiteralPath $baselinePath -Algorithm SHA256).Hash.ToLowerInvariant()
 baselineObservedAt=(Get-Item -LiteralPath $baselinePath).LastWriteTimeUtc.ToString('o')
 sourceCommit=(git -C $repo rev-parse HEAD).Trim(); sourceKind='selected uncommitted worktree files'
 sender='notifications@brandmintai.io';recipient='connect@brandmintai.io'
 activation='disabled'; sharedFilesReplaced=$false
 validation=@{passed=$evidence.numPassedTests;failed=$evidence.numFailedTests;pending=$evidence.numPendingTests;
  files=$evidence.testResults.Count;apiBuild='previously passed, runtime TypeScript unchanged';compiledImports=14;
  offlineInspectionTests=6;offlineInstallerTests=6;backupSafetyMockTests=41;isolatedInstallRollbackTests=3;
  realPostgresVersion=$pg16Evidence.serverVersion;realInstallRollbackAndRestore='passed';rehearsalBoundaryTests=7;
  apiAcceptanceEvidence='97 historical tests; unchanged runtime TypeScript; installer tests subsequently expanded and passed separately';
  uiTests=86;uiFiles=6;webTypecheck='passed';webBuild='passed';securityReview='findings corrected; installer and UI read-only reviews passed'}
 installationReview=@{manifestSha256=(Get-FileHash -LiteralPath $installPath -Algorithm SHA256).Hash.ToLowerInvariant();sql=$install.sql;authorized=$false}
 sharedIntegrationInputs=@('apps/api/src/app.ts','apps/api/src/services/phone-calling.ts','packages/contracts/src/index.ts',
  'apps/web/src/PhonePages.tsx','apps/web/src/PhoneInboundPage.tsx','apps/web/src/PhoneCallChatCard.tsx') | ForEach-Object {
  @{path=$_;localSha256=(Get-FileHash -LiteralPath (Join-Path $repo $_) -Algorithm SHA256).Hash.ToLowerInvariant();requiresReviewedMerge=$true}
 }
 remainingGates=@('new owner approval for protected production backup and disabled SQL installation',
  'baseline source reconciliation','production provider and worker storage admission',
  'automatic Chat report insertion','dedicated Resend and worker secret configuration','separate live acceptance and deployment approval')
 files=$files
}
$target=Join-Path $cache ('PHONE_STEP115_RELEASE_REVIEW_20261111_'+$Revision+'.zip')
$stream=[IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
$stamp=[DateTimeOffset]::Parse('2026-11-11T00:00:00Z')
try{
 foreach($path in $paths){
  $entry=$archive.CreateEntry($path);$entry.LastWriteTime=$stamp
  $output=$entry.Open()
  try{$bytes=[IO.File]::ReadAllBytes((Join-Path $repo $path));$output.Write($bytes,0,$bytes.Length)}finally{$output.Dispose()}
 }
 $entry=$archive.CreateEntry('MANIFEST.review.json');$entry.LastWriteTime=$stamp
 $writer=[IO.StreamWriter]::new($entry.Open())
 try{$writer.WriteLine(($manifest|ConvertTo-Json -Depth 6))}finally{$writer.Dispose()}
}finally{$archive.Dispose()}
$archive=[IO.Compression.ZipFile]::OpenRead($target)
try{
 if($archive.Entries.Count -ne $paths.Count+1){throw 'Archive entry count mismatch.'}
 foreach($path in $paths){
  $inputStream=$archive.GetEntry($path).Open()
  try{$hash=(Get-FileHash -InputStream $inputStream -Algorithm SHA256).Hash.ToLowerInvariant()}finally{$inputStream.Dispose()}
  if($hash -ne $files[$path]){throw 'Archive entry checksum mismatch.'}
 }
}finally{$archive.Dispose()}
[ordered]@{path=$target;sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant();
 verifiedEntries=$paths.Count;reviewOnly=$true;baseImage=$baseline.imageId}|ConvertTo-Json -Compress
