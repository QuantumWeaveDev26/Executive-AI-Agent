import {it,expect} from 'vitest';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const read=(path:string)=>fs.readFileSync(path,'utf8');
const sha=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
it('parses the exact approved manifest snapshot despite replacement after its hash check',()=>{
 const candidate=read('scripts/phone-release-source-20261107.readonly.ps1');
 const begin=candidate.indexOf(' # BEGIN VERIFIED MANIFEST SNAPSHOT');
 const end=candidate.indexOf(' # END VERIFIED MANIFEST SNAPSHOT');
 expect(begin).toBeGreaterThan(0);expect(end).toBeGreaterThan(begin);
 const root=fs.mkdtempSync('node_modules/.cache/phone-manifest-snapshot-');
 const path=`${root}/manifest.json`;
 try{
  const bytes=Buffer.from('{"scope":"approved-fixture"}');fs.writeFileSync(path,bytes);
  let block=candidate.slice(begin,end);
  block=block.replace(' $manifest=',()=>" [IO.File]::WriteAllText($manifestPath,'{\"scope\":\"replaced-fixture\"}');\n $manifest=");
  const script=`$ErrorActionPreference='Stop';$ApprovedPhoneSourceReadOnly=$true;$manifestPath='${path}';$ManifestSha256='${sha(bytes)}';\n${block}\n$manifest.scope`;
  expect(execFileSync('pwsh',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:10000}).trim()).toBe('approved-fixture');
  expect(candidate).not.toContain('Get-Content -LiteralPath $manifestPath');
 }finally{fs.unlinkSync(path);fs.rmdirSync(root);}
});
it('uses the retained verified payload even when its source file changes before authentication',()=>{
 const candidate=read('scripts/phone-release-source-20261107.readonly.ps1');
 const begin=candidate.indexOf(' # BEGIN VERIFIED PAYLOAD SNAPSHOT');
 const end=candidate.indexOf(' # END VERIFIED PAYLOAD SNAPSHOT');
 expect(begin).toBeGreaterThan(0);expect(end).toBeGreaterThan(begin);
 const block=candidate.slice(begin,end);
 const root=fs.mkdtempSync('node_modules/.cache/phone-source-snapshot-');
 const path=`${root}/payload.py`;
 try{
  const bytes=Buffer.from('print("synthetic-only")\n');fs.writeFileSync(path,bytes);
  const quoted=path.replaceAll("'","''");
  const script=`$ErrorActionPreference='Stop';$payload='${quoted}';$manifest=@{artifacts=@(@{path='deploy/hostinger-pilot/phone-release-source-20261107.readonly.py';sha256='${sha(bytes)}'})};\n${block}\n[IO.File]::WriteAllText($payload,'changed-after-verification');[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($verifiedPayload))`;
  const result=execFileSync('pwsh',['-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:10000}).trim();
  expect(Buffer.from(result,'base64')).toEqual(bytes);
  expect(candidate).toContain('$sshArgs ($verifiedPayload.Replace(');
  expect(candidate).not.toContain('[IO.File]::ReadAllText($payload)');
 }finally{fs.unlinkSync(path);fs.rmdirSync(root);}
});
it('retains the reviewed agent-only authentication, timeout and cleanup implementation byte for byte',()=>{
 const original=read('scripts/phone-owner-calendar-preflight-20261107.readonly.ps1');
 expect(sha(original)).toBe('50cedd99face95868ad0b312773caceaff5641f696dac1933d1490d11c03c66f');
 let candidate=read('scripts/phone-release-source-20261107.readonly.ps1').replaceAll('ApprovedPhoneSourceReadOnly','ApprovedPhoneRuntimeReadOnly');
 const begin=candidate.indexOf(' # BEGIN VERIFIED PAYLOAD SNAPSHOT');
 const after=candidate.indexOf('\n',candidate.indexOf(' # END VERIFIED PAYLOAD SNAPSHOT'))+1;
 expect(begin).toBeGreaterThan(0);expect(after).toBeGreaterThan(begin);
 candidate=candidate.slice(0,begin)+candidate.slice(after);
 const manifestBegin=candidate.indexOf(' # BEGIN VERIFIED MANIFEST SNAPSHOT');
 const manifestEnd=candidate.indexOf('\n',candidate.indexOf(' # END VERIFIED MANIFEST SNAPSHOT'))+1;
 expect(manifestBegin).toBeGreaterThan(0);
 const oldManifest=" if($ApprovedPhoneRuntimeReadOnly -and ($ManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ManifestSha256)){throw 'manifest_checksum_mismatch'}\n $manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json\r\n";
 candidate=candidate.slice(0,manifestBegin)+oldManifest+candidate.slice(manifestEnd);
 const undo=(a:string,b:string)=>{expect(candidate.split(a)).toHaveLength(2);candidate=candidate.replace(a,()=>b);};
 undo('deploy/hostinger-pilot/phone-release-source-20261107.readonly.py','deploy/hostinger-pilot/phone-runtime-metadata-final-20261106.readonly.py');
 undo('docs/integrations/phone/PHONE_RELEASE_SOURCE_20261107.review.json','docs/integrations/phone/PHONE_OWNER_CALENDAR_PREFLIGHT_20261107.review.json');
 undo('node_modules/.cache/phone-release-source-20261107.used.json','node_modules/.cache/phone-owner-calendar-preflight-20261107.used.json');
 undo('node_modules/.cache/phone-release-source-20261107.result.json','node_modules/.cache/phone-owner-calendar-preflight-20261107.result.json');
 undo('fixed current image identity and four bounded compiled-code files only; no provider, SQL, profile or credential-file reads','fixed API identity and non-secret Sarvam profile metadata only; no provider, SQL or credential-file reads');
 undo('one_readonly_phone_release_source','one_readonly_phone_runtime_metadata');
 undo('files=@($facts.files|Select-Object name,bytes,sha256);','phoneRuntime=$facts.phoneRuntime;');
 undo("mode='readonly_phone_release_source'","mode='readonly_phone_runtime_metadata'");
 undo('$sshArgs ($verifiedPayload.Replace(', '$sshArgs ([IO.File]::ReadAllText($payload).Replace(');
 expect(candidate).toBe(original);
});
it('pins the four-file scope and exact new sources without enabling deployment or provider access',()=>{
 const m=JSON.parse(read('docs/integrations/phone/PHONE_RELEASE_SOURCE_20261107.review.json'));
 expect(m.requiredImage).toBe('sha256:44387266137de5747b3bd68a647af0cbbbce9387cd66239dcfcdfb0dd6aab927');
 expect(m.readOnly).toBe(true);
 expect(m.scope).toMatchObject({providerRequests:0,databaseCommands:0,serviceChanges:false,readApiKeyFiles:false,readProfile:false,fileLimitBytes:196608,totalLimitBytes:524288});
 expect(m.scope.files).toHaveLength(4);
 for(const a of m.artifacts)expect(sha(fs.readFileSync(a.path))).toBe(a.sha256);
 const payload=read(m.artifacts[1].path);
 expect(payload).toContain(m.requiredImage);
 expect(payload).not.toMatch(/ssh|os\.environ|requests\.|urllib|psql/);
});
