import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import crypto from 'node:crypto';

const root=process.cwd();
const pwsh=path.join(process.env.USERPROFILE!,'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe');
const helper='scripts/phone-backup-restore.review.ps1';
const manifest='docs/integrations/phone/PHONE_BACKUP_RESTORE.review.json';
const payload='deploy/hostinger-pilot/phone-backup-restore.review.py';
const run=(file:string,args:string[]=[])=>spawnSync(pwsh,['-NoProfile','-NonInteractive','-File',file,...args],{
 encoding:'utf8',timeout:15000,windowsHide:true,env:{...process.env,USERPROFILE:path.join(root,'node_modules/.cache/no-real-key-test-profile')}});

describe('backup transport preparation — no real key/agent/server/database access',()=>{
 it('retains only allowlisted failure categories and steps from synthetic remote receipts',()=>{
  const file=path.join(root,helper).replaceAll("'","''");
  const command=`$t=$null;$e=$null;$a=[System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e);$f=$a.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-SafeBackupDiagnostic'},$true);if(-not $f){exit 2};. ([scriptblock]::Create($f.Extent.Text));@(@{category='container_identity';preflightStep='container_identity'},@{category='synthetic-private-secret';preflightStep='/private/path'},@{category='command_timeout';preflightStep='deadline_tool'})|ForEach-Object{Get-SafeBackupDiagnostic $_}|ConvertTo-Json -Compress`;
  const result=spawnSync(pwsh,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:15000,windowsHide:true});
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([{category:'container_identity',preflightStep:'container_identity'},
   {category:'unclassified_failure',preflightStep:'unknown'}, {category:'command_timeout',preflightStep:'deadline_tool'}]);
  expect(result.stdout).not.toContain('synthetic-private-secret');expect(result.stdout).not.toContain('/private/path');
 });
 it('keeps the host-only diagnostic mode locked before authentication',()=>{
  const result=run(path.join(root,helper),['-ApprovedHostDiagnostic']);expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
  expect(JSON.parse(fs.readFileSync('docs/integrations/phone/PHONE_BACKUP_DIAGNOSTIC.review.json','utf8')).remoteExecutionAllowed).toBe(false);
 });
 it('refuses combining diagnostic and backup modes before authentication',()=>{
  const result=run(path.join(root,helper),['-ApprovedHostDiagnostic','-ApprovedBackupRestore']);
  expect(result.status).toBe(1);expect(JSON.parse(result.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
 });
 it('keeps the persistent migration mode locked before authentication',()=>{
  const result=run(path.join(root,helper),['-ApprovedMigration']);expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
  const m=JSON.parse(fs.readFileSync('docs/integrations/phone/PHONE_MIGRATION_110.review.json','utf8'));
  expect(m.remoteExecutionAllowed).toBe(false);
  for(const a of m.artifacts)expect(crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')).toBe(a.sha256);
  expect(m.artifacts.map((a:{path:string})=>a.path)).toEqual(expect.arrayContaining(['docs/migrations/110a-phone-contacts.review.sql','docs/migrations/110b-phone-calls.review.sql','docs/migrations/110c-phone-live-mode.review.sql']));
 });
 it('builds a SQL prefix the real runner accepts against its pinned hashes',()=>{
  const file=path.join(root,helper).replaceAll("'","''");
  const command=`$t=$null;$e=$null;$a=[System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e);$f=$a.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-MigrationSqlPrefix'},$true);if(-not $f){exit 2};. ([scriptblock]::Create($f.Extent.Text));[Console]::Out.Write((Get-MigrationSqlPrefix '${root.replaceAll("'","''")}'))`;
  const prefix=spawnSync(pwsh,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:8*1024*1024});
  expect(prefix.status).toBe(0);expect(prefix.stdout.startsWith('MIGRATION_SQL_B64={')).toBe(true);
  const check="import sys;src=sys.stdin.read().replace(\"if __name__ == '__main__':\",'if False:');exec(src);print([s for s,_ in migration_inputs()])";
  const result=spawnSync('python',['-I','-B','-c',check],{input:prefix.stdout+fs.readFileSync(payload,'utf8').replaceAll('\r\n','\n'),encoding:'utf8',timeout:15000,windowsHide:true});
  expect(result.status).toBe(0);expect(result.stdout.trim()).toBe("['110a', '110b', '110c']");
 });
 it.each(['-ApprovedPhoneDeploy','-ApprovedPhoneLiveOn','-ApprovedPhoneLiveOff','-ApprovedPhoneUiUpdate','-ApprovedChatModelDeploy','-ApprovedChatModelOn','-ApprovedChatModelOff','-ApprovedPhoneCallDiagnostic','-ApprovedSarvamKeyCompare','-ApprovedGoogleOn','-ApprovedGoogleOff'])('keeps %s locked before authentication and conflicts refused',flag=>{
  const result=run(path.join(root,helper),[flag]);expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
  const conflict=run(path.join(root,helper),[flag,'-ApprovedMigration']);expect(conflict.status).toBe(1);
  expect(JSON.parse(conflict.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
 });
 it('pins the phone manifests with all gates off and an image archive only for deploy',()=>{
  for(const [name,withImage] of [['PHONE_DEPLOY_110',true],['PHONE_LIVE_ON_110',false],['PHONE_LIVE_OFF_110',false],['PHONE_UI_UPDATE_110',true],['CHAT_MODEL_DEPLOY',true],['CHAT_MODEL_ON',false],['CHAT_MODEL_OFF',false],['GOOGLE_ON',false],['GOOGLE_OFF',false]] as const){
   const m=JSON.parse(fs.readFileSync(`docs/integrations/phone/${name}.review.json`,'utf8'));
   expect(m.remoteExecutionAllowed).toBe(false);
   const paths=m.artifacts.map((a:{path:string})=>a.path);
   expect(paths).toEqual(expect.arrayContaining(['scripts/phone-backup-restore.review.ps1','deploy/hostinger-pilot/phone-publish.review.py']));
   expect(paths.includes('node_modules/.cache/phone110-image.tar.gz')||paths.includes('node_modules/.cache/phone110-ui-image.tar.gz')||paths.includes('node_modules/.cache/phone110-chat-image.tar.gz')).toBe(withImage);
   for(const a of m.artifacts)expect(crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')).toBe(a.sha256);
  }
 });
 it('streams a binary file byte for byte, and keeps phone receipts to the allowlist',()=>{
  const file=path.join(root,helper).replaceAll("'","''"),temp=fs.mkdtempSync(path.join(os.tmpdir(),'thaara-agent-review-test-'));
  try{
   const data=crypto.randomBytes(2*1024*1024);const source=path.join(temp,'payload.bin');fs.writeFileSync(source,data);
   const load=`$t=$null;$e=$null;$a=[System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e);foreach($n in 'Invoke-OwnedProcess','Get-SafePhoneReceipt'){$f=$a.Find({param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n},$true);. ([scriptblock]::Create($f.Extent.Text))};`;
   const stream=spawnSync(pwsh,['-NoProfile','-NonInteractive','-Command',load+`$r=Invoke-OwnedProcess 'C:/Program Files/Git/usr/bin/sha256sum.exe' @('-') $null @{} 30000 '${source.replaceAll("'","''")}';@{code=$r.Code;text=$r.Text}|ConvertTo-Json -Compress`],{encoding:'utf8',timeout:60000,windowsHide:true});
   const streamed=JSON.parse(stream.stdout);expect(streamed.code).toBe(0);expect(streamed.text.split(' ')[0]).toBe(crypto.createHash('sha256').update(data).digest('hex'));
   const receipt=spawnSync(pwsh,['-NoProfile','-NonInteractive','-Command',load+`Get-SafePhoneReceipt ([pscustomobject]@{status='failed';step='/private/step';category='synthetic private secret';providerCalls=0;callsPlaced=0;image='not-an-image';secret='synthetic-private-secret';callingEnabled=$false}) 'phone-deploy'|ConvertTo-Json -Compress`],{encoding:'utf8',timeout:15000,windowsHide:true});
   expect(JSON.parse(receipt.stdout)).toEqual({mode:'phone-deploy',status:'failed',step:'unknown',providerCalls:0,callsPlaced:0,callingEnabled:false});
   const called=spawnSync(pwsh,['-NoProfile','-NonInteractive','-Command',load+`Get-SafePhoneReceipt ([pscustomobject]@{status='verified';step='done';providerCalls=0;callsPlaced=1}) 'phone-deploy'`],{encoding:'utf8',timeout:15000,windowsHide:true});
   expect(called.status).not.toBe(0);
  }finally{
   const actual=fs.realpathSync(temp);expect(actual.startsWith(fs.realpathSync(os.tmpdir())+path.sep)&&path.basename(actual).startsWith('thaara-agent-review-test-')).toBe(true);fs.rmSync(actual,{recursive:true});
  }
 },120000);
 it('refuses combining the migration mode with any other mode before authentication',()=>{
  for(const other of ['-ApprovedBackupRestore','-ApprovedHostDiagnostic','-ReviewOnly']){
   const result=run(path.join(root,helper),['-ApprovedMigration',other]);expect(result.status).toBe(1);
   expect(JSON.parse(result.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
  }
 });
 it('parses the PowerShell helper without executing it',()=>{
  const file=path.join(root,helper).replaceAll("'","''");
  const command=`$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1}`;
  expect(spawnSync(pwsh,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:15000,windowsHide:true}).status).toBe(0);
 });
 it('defaults to a non-authenticating review plan and keeps remote execution locked',()=>{
  const result=run(path.join(root,helper));expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({mode:'review_only',temporaryAgent:true,plaintextPrivateKeyFiles:false,liveCalling:false});
  expect(JSON.parse(fs.readFileSync(manifest,'utf8')).remoteExecutionAllowed).toBe(false);
 });
 it('denies the remote flag while this package is review-only, before key/agent access',()=>{
  const r=run(path.join(root,helper),['-ApprovedBackupRestore']);expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
 });
 it('refuses conflicting modes before authentication',()=>{
  const r=run(path.join(root,helper),['-ReviewOnly','-ApprovedBackupRestore']);expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
 });
 it('checksum mismatch stops a copied package before authentication',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'thaara-agent-review-test-'));
  try{
   for(const relative of [helper,payload,manifest]){const target=path.join(temp,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,relative),target);}
   fs.appendFileSync(path.join(temp,payload),'\n# synthetic tampering\n');
   const r=run(path.join(temp,helper),['-ReviewOnly']);expect(r.status).toBe(1);
   expect(JSON.parse(r.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
  }finally{
   const actual=fs.realpathSync(temp);expect(actual.startsWith(fs.realpathSync(os.tmpdir())+path.sep)&&path.basename(actual).startsWith('thaara-agent-review-test-')).toBe(true);
   fs.rmSync(actual,{recursive:true});
  }
 });
 it.each(['true',1])('rejects non-Boolean authorization %s before starting authentication',value=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'thaara-agent-review-test-'));
  try{
   for(const relative of [helper,payload,manifest]){const target=path.join(temp,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,relative),target);}
   const m=JSON.parse(fs.readFileSync(path.join(temp,manifest),'utf8'));m.remoteExecutionAllowed=value;fs.writeFileSync(path.join(temp,manifest),JSON.stringify(m));
   const r=run(path.join(temp,helper),['-ApprovedBackupRestore']);expect(r.status).toBe(1);
   expect(JSON.parse(r.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
  }finally{
   const actual=fs.realpathSync(temp);expect(actual.startsWith(fs.realpathSync(os.tmpdir())+path.sep)&&path.basename(actual).startsWith('thaara-agent-review-test-')).toBe(true);fs.rmSync(actual,{recursive:true});
  }
 });
 it('pins every executable artifact without altering the previous preflight package',()=>{
  const m=JSON.parse(fs.readFileSync(manifest,'utf8'));
  for(const a of m.artifacts)expect(crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')).toBe(a.sha256);
  const old=JSON.parse(fs.readFileSync('docs/integrations/phone/PHONE_AGENT_PREFLIGHT.review.json','utf8'));
  for(const a of old.artifacts)expect(crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')).toBe(a.sha256);
  const diagnostic=JSON.parse(fs.readFileSync('docs/integrations/phone/PHONE_BACKUP_DIAGNOSTIC.review.json','utf8'));
  for(const a of diagnostic.artifacts)expect(crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')).toBe(a.sha256);
 });
});
