import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const pwsh=path.join(process.env.USERPROFILE!,'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe');
const helper=path.resolve('scripts/phone-inbound-recovery-rehearsal.review.ps1');
const run=(args:string[])=>spawnSync(pwsh,['-NoProfile','-NonInteractive','-File',helper,...args],{encoding:'utf8',timeout:15000,windowsHide:true,env:{...process.env,USERPROFILE:path.resolve('node_modules/.cache/no-real-key-test-profile')}});
it('parses the wrapper without executing authentication or commands',()=>{
 const cmd=`$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile('${helper.replaceAll("'","''")}',[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1}`;
 expect(spawnSync(pwsh,['-NoProfile','-NonInteractive','-Command',cmd],{encoding:'utf8',timeout:10000,windowsHide:true}).status).toBe(0);
});
it('defaults to non-authenticating review and describes clone-only rehearsal',()=>{
 const r=run(['-ReviewOnly']);expect(r.status).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({mode:'review_only',plaintextPrivateKeyFiles:false,liveCalling:false});expect(JSON.parse(r.stdout).remoteCommands).toContain('clone only');
});
it('denies absent or wrong package pins before authentication',()=>{
 for(const args of [['-ApprovedInboundRecoveryRehearsal'],['-ApprovedInboundRecoveryRehearsal','-ManifestSha256','a'.repeat(64)]]){const r=run(args);expect(r.status).toBe(1);expect(JSON.parse(r.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});expect(JSON.parse(r.stdout).agentProcessId).toBeUndefined();}
});
it('requires completed independent review and preserves strict key/host/owned cleanup boundaries',()=>{
 const m=JSON.parse(fs.readFileSync('docs/integrations/phone/PHONE_INBOUND_RECOVERY_REHEARSAL_V1.review.json','utf8'));expect(m.independentReviewComplete).toBe(false);
 const s=fs.readFileSync(helper,'utf8');expect(s.indexOf('$manifest.independentReviewComplete')).toBeLessThan(s.indexOf('Import-Clixml'));expect(s).toContain('StrictHostKeyChecking=yes');expect(s).toContain("@('-t','120','-')");expect(s).toContain("'python3 -B - --approved-inbound-backup-rehearsal'");expect(s).toContain('[IO.FileMode]::CreateNew');expect(s).not.toContain('ApprovedMigration');
});
