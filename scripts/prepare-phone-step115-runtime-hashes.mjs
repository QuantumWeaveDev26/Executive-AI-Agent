import fs from 'node:fs';
import crypto from 'node:crypto';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const proof = JSON.parse(fs.readFileSync('node_modules/.cache/phone-step115-disabled-install-20261111-r2.result.json'));
if (proof.status !== 'verified' || proof.schemaInstalled !== true) throw Error('Verified schema receipt required');
const paths = ['/app/apps/api/dist/app.js', '/app/apps/api/pilot-start.mjs',
  '/app/apps/api/dist/services/phone-pilot-startup.js', '/app/apps/api/node_modules/@thaara/contracts/dist/index.js',
  '/app/apps/api/dist/services/whatsapp-durable.js', '/app/apps/api/dist/services/whatsapp-enquiries.js',
  '/app/apps/api/dist/services/phone-calling.js', '/app/apps/api/dist/routes/phone-sarvam-webhook.js',
  '/app/apps/web/dist/index.html'];
let py = fs.readFileSync('deploy/hostinger-pilot/phone-baseline-hashes-stable-post-v8.readonly.py', 'utf8')
  .replace(/^IMAGE = .*$/m, `IMAGE = '${proof.imageId}'`).replace(/^CONTAINER_ID = .*$/m, `CONTAINER_ID = '${proof.containerId}'`)
  .replace(/PATHS = \([\s\S]*?\n\)/, 'PATHS = (' + paths.map(path => JSON.stringify(path)).join(',') + ',)');
const pyPath = 'deploy/hostinger-pilot/phone-step115-runtime-hashes-20261111.readonly.py';
fs.writeFileSync(pyPath, py);
let ps = fs.readFileSync('scripts/phone-step115-schema-20261111.readonly.ps1', 'utf8')
  .replaceAll('phone-step115-schema-20261111', 'phone-step115-runtime-hashes-20261111')
  .replaceAll('PHONE_STEP115_SCHEMA_20261111', 'PHONE_STEP115_RUNTIME_HASHES_20261111')
  .replaceAll('ApprovedPhoneRuntimeReadOnly', 'ApprovedRuntimeHashesReadOnly')
  .replaceAll('one_readonly_phone_step115_schema_metadata', 'one_readonly_nine_runtime_sha256_checksums')
  .replaceAll('fixed read-only catalog SQL; schema/role metadata and function hashes only; no application rows or source definitions', 'nine fixed release-file SHA256 checksums only; no source, credentials or database access');
const start = ps.indexOf('  $facts=$remote.Text|ConvertFrom-Json');
const end = ps.indexOf('\n\n }\n}catch{', start);
if (start < 0 || end < 0) throw Error('Wrapper integration point changed');
ps = ps.slice(0, start) + `  $facts=$remote.Text|ConvertFrom-Json
  if($facts.status -cne 'verified' -or $facts.imageId -cne '${proof.imageId}' -or $facts.containerId -cne '${proof.containerId}') {throw 'runtime_hash_identity_denied'}
  $allowed=@(${paths.map(path => "'" + path + "'").join(',')})
  if((@($facts.hashes.PSObject.Properties.Name|Sort-Object)-join ',') -cne (@($allowed|Sort-Object)-join ',')){throw 'runtime_hash_paths_denied'}
  foreach($field in $facts.hashes.PSObject.Properties){if($field.Value -cnotmatch '^[a-f0-9]{64}$'){throw 'runtime_hash_value_denied'}}
  $safe=@{status='verified';imageId=$facts.imageId;containerId=$facts.containerId;hashes=$facts.hashes;changesMade=$false;sourceExported=$false}
  $stream=[IO.File]::Open($receipt,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$bytes=$utf8.GetBytes(($safe|ConvertTo-Json -Depth 4 -Compress));$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()}
  $output=@{mode='readonly_runtime_hashes';status='verified';receiptPath=$receipt;hashCount=9;imageId=$facts.imageId}
` + ps.slice(end);
const psPath = 'scripts/phone-step115-runtime-hashes-20261111.readonly.ps1';
fs.writeFileSync(psPath, ps);
const manifestPath = 'docs/integrations/phone/PHONE_STEP115_RUNTIME_HASHES_20261111.review.json';
fs.writeFileSync(manifestPath, JSON.stringify({ readOnly: true, remoteExecutionAllowed: process.argv.includes('--owner-approved'),
  authorization: 'Prepared for one separate owner-approved read-only nine-file checksum comparison; no source export or server changes',
  output: 'node_modules/.cache/phone-step115-runtime-hashes-20261111.result.json', paths,
  artifacts: [psPath, pyPath].map(path => ({ path, sha256: hash(fs.readFileSync(path)) })) }, null, 2) + '\n');
console.log(JSON.stringify({ runner: psPath, manifestSha256: hash(fs.readFileSync(manifestPath)) }));
