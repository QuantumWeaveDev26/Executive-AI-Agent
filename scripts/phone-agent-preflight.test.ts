import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import crypto from 'node:crypto';

const root=process.cwd();
const pwsh=path.join(process.env.USERPROFILE!,'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe');
const helper='scripts/phone-agent-preflight.review.ps1';
const manifest='docs/integrations/phone/PHONE_AGENT_PREFLIGHT.review.json';
const payload='deploy/hostinger-pilot/phone-host-preflight.review.sh';
const run=(file:string,args:string[]=[])=>spawnSync(pwsh,['-NoProfile','-NonInteractive','-File',file,...args],{
 encoding:'utf8',timeout:15000,windowsHide:true,env:{...process.env,USERPROFILE:path.join(root,'node_modules/.cache/no-real-key-test-profile')}});

describe('agent-only preflight preparation — no real key/agent/server access',()=>{
 it('parses the PowerShell helper without executing it',()=>{
  const file=path.join(root,helper).replaceAll("'","''");
  const command=`$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile('${file}',[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1}`;
  expect(spawnSync(pwsh,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:15000,windowsHide:true}).status).toBe(0);
 });
 it('parses the shell payload without running a remote command',()=>{
  expect(spawnSync('C:/Program Files/Git/bin/bash.exe',['--noprofile','--norc','-n',path.join(root,payload)],{encoding:'utf8',timeout:10000,windowsHide:true}).status).toBe(0);
 });
 it('defaults to a non-authenticating review plan and keeps remote execution locked',()=>{
  const result=run(path.join(root,helper));expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({mode:'review_only',temporaryAgent:true,plaintextPrivateKeyFiles:false,liveCalling:false});
  expect(JSON.parse(fs.readFileSync(manifest,'utf8')).remoteExecutionAllowed).toBe(false);
 });
 it('denies the remote flag while this package is review-only, before key/agent access',()=>{
  const r=run(path.join(root,helper),['-ApprovedAgentOnlyPreflight']);expect(r.status).toBe(1);
  expect(JSON.parse(r.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
 });
 it('refuses conflicting modes before authentication',()=>{
  const r=run(path.join(root,helper),['-ReviewOnly','-ApprovedAgentOnlyPreflight']);expect(r.status).toBe(1);
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
   const r=run(path.join(temp,helper),['-ApprovedAgentOnlyPreflight']);expect(r.status).toBe(1);
   expect(JSON.parse(r.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
  }finally{
   const actual=fs.realpathSync(temp);expect(actual.startsWith(fs.realpathSync(os.tmpdir())+path.sep)&&path.basename(actual).startsWith('thaara-agent-review-test-')).toBe(true);fs.rmSync(actual,{recursive:true});
  }
 });
 it('pins the exact reviewed artifacts and contains no database/restore/mutation command in its shell payload',()=>{
  const m=JSON.parse(fs.readFileSync(manifest,'utf8'));
  for(const a of m.artifacts)expect(crypto.createHash('sha256').update(fs.readFileSync(a.path)).digest('hex')).toBe(a.sha256);
  const text=fs.readFileSync(payload,'utf8').split('\n').filter(line=>!line.trim().startsWith('#')).join('\n');
  expect(text).not.toMatch(/\b(psql|pg_dump|pg_restore|pg_dumpall|curl|wget|rm|mkdir|chmod|chown|systemctl)\b|docker\s+(exec|run|create|stop|restart|rm|pull|network|volume)/);
 });
});
