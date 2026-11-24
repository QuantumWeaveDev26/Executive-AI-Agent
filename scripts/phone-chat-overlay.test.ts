import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {reconcilePhoneChat,prepareOverlay,sha} from './phone-chat-overlay.mjs';
const baseline=JSON.parse(fs.readFileSync('node_modules/.cache/phone-chat-current-baseline-complete-20261105.json','utf8'));
const original=Object.fromEntries(Object.entries(baseline.files).map(([p,f]:[string,any])=>[p,Buffer.from(f.base64,'base64').toString('utf8')]));
it('changes exactly four pinned files and preserves every WhatsApp route statement',()=>{
 const candidate=reconcilePhoneChat(original);
 expect(Object.keys(candidate).sort()).toEqual(Object.keys(original).sort());
 const whatsAppLines=(s:string)=>s.split('\n').filter(l=>/whatsapp|WhatsApp/.test(l)&&!l.includes('const phoneCallingIntent'));
 expect(whatsAppLines(candidate['routes/conversations.js'])).toEqual(whatsAppLines(original['routes/conversations.js']));
});
it('rejects changed or repeated patch contexts',()=>{
 expect(()=>reconcilePhoneChat({...original,'services/chat-phone-calling.js':original['services/chat-phone-calling.js']+'\n'+original['services/chat-phone-calling.js']})).toThrow('context_mismatch');
});
it('rejects tampered source evidence',()=>{
 const changed=structuredClone(baseline);changed.files['routes/conversations.js'].sha256='0'.repeat(64);
 expect(()=>prepareOverlay(changed,'unused')).toThrow('baseline_hash_mismatch');
});
it('binds all 360 hashes with only four file changes and no web replacement',()=>{
 const m=JSON.parse(fs.readFileSync('node_modules/.cache/phone-chat-overlay-20261105/package/manifest.json','utf8'));
 expect(m.changes).toHaveLength(4);expect(m.expectedInventory).toHaveLength(360);
 for(const [p,h] of baseline.inventory){const change=m.changes.find((x:any)=>x.path===p);expect(m.expectedInventory.find((x:any)=>x[0]===p)[1]).toBe(change?.after??h);}
 for(const c of m.changes){expect(c.path).not.toContain('whatsapp');expect(c.path).not.toContain('/web/');const rel=c.path.replace('/app/apps/api/dist/','');expect(sha(fs.readFileSync(path.join('node_modules/.cache/phone-chat-overlay-20261105/package/overlay',rel)))).toBe(c.after);}
});
const pwsh=path.join(process.env.USERPROFILE!,'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe');
it('deployment wrapper parses without authentication',()=>{
 const r=spawnSync(pwsh,['-NoProfile','-NonInteractive','-Command',"$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile('scripts/phone-chat-deploy.review.ps1',[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1}"],{encoding:'utf8',windowsHide:true,timeout:15000});expect(r.status,r.stderr).toBe(0);
});
it('deployment wrapper rejects an unpinned approval before credentials or one-use marker',()=>{
 const r=spawnSync(pwsh,['-NoProfile','-NonInteractive','-File','scripts/phone-chat-deploy.review.ps1','-ApprovedPhoneChatDeploy','-ManifestSha256','0'.repeat(64)],{encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,USERPROFILE:path.join(os.tmpdir(),'synthetic-no-phone-credentials')}});
 expect(r.status).toBe(1);expect(JSON.parse(r.stdout)).toMatchObject({status:'stopped',phase:'review',cleanupVerified:true});
});
