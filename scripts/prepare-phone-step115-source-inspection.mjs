import fs from 'node:fs';
import crypto from 'node:crypto';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const baseline = JSON.parse(fs.readFileSync('node_modules/.cache/phone-step115-runtime-hashes-20261111.result.json'));
const paths = ['/app/apps/api/dist/app.js', '/app/apps/api/pilot-start.mjs', '/app/apps/api/dist/services/phone-pilot-startup.js',
  '/app/apps/api/node_modules/@thaara/contracts/dist/index.js', '/app/apps/api/dist/services/phone-calling.js', '/app/apps/api/dist/routes/phone-sarvam-webhook.js'];
const expected = Object.fromEntries(paths.map(path => [path, baseline.hashes[path]]));
if (baseline.status !== 'verified' || Object.values(expected).some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw Error('Verified baseline required');
const probe = String.raw`const fs=require('node:fs'),crypto=require('node:crypto');
const expected=EXPECTED,files={};let total=0;
for(const [path,hash] of Object.entries(expected)){
 const resolved=fs.realpathSync(path);
 if(path.endsWith('/@thaara/contracts/dist/index.js')){if(!resolved.startsWith('/app/apps/api/node_modules/')||!resolved.endsWith('/dist/index.js'))throw Error('path');}
 else if(resolved!==path)throw Error('path');
 const fd=fs.openSync(resolved,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  const before=fs.fstatSync(fd);if(!before.isFile()||before.size<1||before.size>700000||(total+=before.size)>600000)throw Error('size');
  const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);
  if(['ino','dev','size','ctimeMs','mtimeMs'].some(key=>before[key]!==after[key])||crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('drift');
  const text=bytes.toString('utf8');
  if(/-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|\bre_[A-Za-z0-9_-]{24,}|\bAKIA[A-Z0-9]{16}|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/.test(text))throw Error('sensitive_literal');
  if(/(?:password|api_?key|secret|access_?token)\s*[:=]\s*['"][A-Za-z0-9_+/=-]{20,}['"]/i.test(text))throw Error('sensitive_literal');
  if(/postgres(?:ql)?:\/\/[A-Za-z0-9_%.-]+:[^\\s'"\x24{}]+@/i.test(text))throw Error('sensitive_literal');
  files[path]={sha256:hash,contentBase64:bytes.toString('base64')};
 }finally{fs.closeSync(fd);}
}
console.log(JSON.stringify(files));`.replace('EXPECTED', JSON.stringify(expected)).replaceAll('\\\\', '\\');
const py = `"""Six fixed application modules only, owner-approved inspection; no runtime mutation."""
import json,subprocess
IMAGE=${JSON.stringify(baseline.imageId)}
CONTAINER=${JSON.stringify(baseline.containerId)}
EXPECTED=${JSON.stringify(expected)}
PROBE=${JSON.stringify(probe)}
def docker(*args):
    result=subprocess.run(['docker',*args],capture_output=True,timeout=20)
    if result.returncode or len(result.stdout)>900000: raise RuntimeError('inspection_refused')
    return result.stdout.decode()
def main():
    args=('inspect','--format','{{.Id}}|{{.Image}}|{{.State.Health.Status}}','thaara-v2-pilot-api-1')
    initial=docker(*args).strip()
    if initial!=CONTAINER+'|'+IMAGE+'|healthy': raise RuntimeError('target_drift')
    files=json.loads(docker('exec',CONTAINER,'node','-e',PROBE))
    if set(files)!=set(EXPECTED) or any(files[p]['sha256']!=EXPECTED[p] for p in EXPECTED): raise RuntimeError('source_drift')
    if docker(*args).strip()!=initial: raise RuntimeError('target_drift')
    print(json.dumps({'status':'verified','imageId':IMAGE,'containerId':CONTAINER,'files':files}))
if __name__=='__main__':
    try: main()
    except Exception: print(json.dumps({'status':'stopped','category':'source_inspection_refused_no_retry'}))
`;
const pyPath = 'deploy/hostinger-pilot/phone-step115-source-inspection-20261111.readonly.py';
fs.writeFileSync(pyPath, py);
let ps = fs.readFileSync('scripts/phone-step115-schema-20261111.readonly.ps1', 'utf8')
  .replaceAll('phone-step115-schema-20261111', 'phone-step115-source-inspection-20261111')
  .replaceAll('PHONE_STEP115_SCHEMA_20261111', 'PHONE_STEP115_SOURCE_INSPECTION_20261111')
  .replaceAll('ApprovedPhoneRuntimeReadOnly', 'ApprovedSourceInspectionReadOnly')
  .replaceAll('one_readonly_phone_step115_schema_metadata', 'one_owner_approved_six_file_source_inspection')
  .replaceAll('fixed read-only catalog SQL; schema/role metadata and function hashes only; no application rows or source definitions', 'six pinned compiled application modules only; no credentials, database or server changes');
const start = ps.indexOf('  $facts=$remote.Text|ConvertFrom-Json'), end = ps.indexOf('\n\n }\n}catch{', start);
if (start < 0 || end < 0) throw Error('Wrapper changed');
ps = ps.slice(0, start) + `  $facts=$remote.Text|ConvertFrom-Json
  if($facts.status -cne 'verified' -or $facts.imageId -cne '${baseline.imageId}' -or $facts.containerId -cne '${baseline.containerId}'){throw 'source_inspection_refused'}
  $expected='${JSON.stringify(expected)}'|ConvertFrom-Json
  if((@($facts.files.PSObject.Properties.Name|Sort-Object)-join ',') -cne (@($expected.PSObject.Properties.Name|Sort-Object)-join ',')){throw 'source_paths_denied'}
  $destination=Join-Path $repo 'node_modules/.cache/phone-step115-current-runtime-source-20261111'
  if(Test-Path -LiteralPath $destination){throw 'inspection_directory_exists'}
  $validated=@()
  foreach($item in $facts.files.PSObject.Properties){
    $bytes=[Convert]::FromBase64String($item.Value.contentBase64)
    $digest=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    if($digest -cne $expected.($item.Name) -or $digest -cne $item.Value.sha256){throw 'source_hash_denied'}
    $validated+=@{name=[IO.Path]::GetFileName($item.Name);bytes=$bytes}
  }
  $null=New-Item -ItemType Directory -Path $destination -ErrorAction Stop
  foreach($item in $validated){$file=[IO.File]::Open((Join-Path $destination $item.name),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write);try{$file.Write($item.bytes,0,$item.bytes.Length)}finally{$file.Dispose()}}
  $safe=@{status='verified';imageId=$facts.imageId;containerId=$facts.containerId;hashes=$expected;sourceDirectory=$destination;serverChanges=$false}
  [IO.File]::WriteAllText($receipt,($safe|ConvertTo-Json -Depth 4 -Compress),$utf8)
  $output=@{status='verified';mode='readonly_source_inspection';sourceFiles=6;receiptPath=$receipt}
` + ps.slice(end);
const psPath = 'scripts/phone-step115-source-inspection-20261111.readonly.ps1';
fs.writeFileSync(psPath, ps);
const manifestPath = 'docs/integrations/phone/PHONE_STEP115_SOURCE_INSPECTION_20261111.review.json';
fs.writeFileSync(manifestPath, JSON.stringify({ readOnly: true, remoteExecutionAllowed: process.argv.includes('--owner-approved'),
  authorization: 'Separate owner approval required for the exact six-file runtime inspection scope', expected,
  artifacts: [psPath, pyPath, 'docs/integrations/phone/STEP115_RUNTIME_RECONCILIATION_SCOPE_20261111.md']
    .map(path => ({ path, sha256: sha(fs.readFileSync(path)) })) }, null, 2) + '\n');
console.log(JSON.stringify({ runner: psPath, manifestSha256: sha(fs.readFileSync(manifestPath)) }));
