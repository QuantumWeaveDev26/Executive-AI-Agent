import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const pwsh=path.join(process.env.USERPROFILE!,'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe');
const helper=path.resolve('scripts/phone-inbound-host-inventory.review.ps1');
const run=(args:string[])=>spawnSync(pwsh,['-NoProfile','-NonInteractive','-File',helper,...args],{encoding:'utf8',timeout:15000,windowsHide:true,env:{...process.env,USERPROFILE:path.resolve('node_modules/.cache/no-real-key-test-profile')}});
it('parses the SSH wrapper without executing it',()=>{
 const command=`$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile('${helper.replaceAll("'","''")}',[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1}`;
 expect(spawnSync(pwsh,['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',timeout:10000,windowsHide:true}).status).toBe(0);
});
it('defaults to review-only without reading credentials or starting an agent',()=>{
 const r=run(['-ReviewOnly']);expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({mode:'review_only',plaintextPrivateKeyFiles:false,liveCalling:false});
});
it('refuses absent or incorrect manifest pin before authentication',()=>{
 for(const args of [['-ApprovedInboundInventory'],['-ApprovedInboundInventory','-ManifestSha256','a'.repeat(64)]]){
  const r=run(args);expect(r.status).toBe(1);expect(JSON.parse(r.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});expect(JSON.parse(r.stdout).agentProcessId).toBeUndefined();
 }
});
it('preserves strict host validation, isolated agent, no plaintext key files and fixed reviewed payload',()=>{
 const s=fs.readFileSync(helper,'utf8');expect(s).toContain('StrictHostKeyChecking=yes');expect(s).toContain('ForwardAgent=no');expect(s).toContain("@('-t','120','-')");expect(s).toContain("[IO.FileMode]::CreateNew");
 expect(s).not.toMatch(/StrictHostKeyChecking=no|accept-new|Set-Content.*pem|WriteAllText.*pem/);
 expect(s).toContain("'python3 -B -'");expect(s).toContain('remoteDiagnostic');
});
