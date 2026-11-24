import {it,expect} from 'vitest';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const read=(p:string)=>fs.readFileSync(p,'utf8');
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
it('preserves every reviewed authentication and remote command byte outside fresh paths and the additional manifest check',()=>{
 const original=read('scripts/phone-runtime-metadata-final-20261106.readonly.ps1');
 expect(sha(original)).toBe('25a14aee012a90eb87f2954c18b02f5e5ccb8bf1f0c0b7fc43be8d04d3a8189d');
 let candidate=read('scripts/phone-owner-calendar-preflight-20261107.readonly.ps1');
 const replace=(a:string,b:string)=>{expect(candidate.split(a)).toHaveLength(2);candidate=candidate.replace(a,()=>b);};
 replace('param([switch]$ReviewOnly,[switch]$ApprovedPhoneRuntimeReadOnly,[string]$ManifestSha256)','param([switch]$ReviewOnly,[switch]$ApprovedPhoneRuntimeReadOnly)');
 replace('docs/integrations/phone/PHONE_OWNER_CALENDAR_PREFLIGHT_20261107.review.json','docs/integrations/phone/PHONE_RUNTIME_METADATA_FINAL_20261106.review.json');
 replace('node_modules/.cache/phone-owner-calendar-preflight-20261107.used.json','node_modules/.cache/phone-runtime-metadata-final-20261106.used.json');
 replace('node_modules/.cache/phone-owner-calendar-preflight-20261107.result.json','node_modules/.cache/phone-runtime-metadata-final-20261106.result.json');
 replace(" if($ApprovedPhoneRuntimeReadOnly -and ($ManifestSha256 -cnotmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ManifestSha256)){throw 'manifest_checksum_mismatch'}\n",'');
 expect(candidate).toBe(original);
});
it('pins the exact fresh wrapper and unchanged read-only payload without authorizing SQL or provider calls',()=>{
 const m=JSON.parse(read('docs/integrations/phone/PHONE_OWNER_CALENDAR_PREFLIGHT_20261107.review.json'));
 expect(m.readOnly).toBe(true);expect(m.scope).toMatchObject({providerRequests:0,databaseCommands:0,serviceChanges:false,readApiKeyFiles:false});
 expect(m.artifacts.map((a:any)=>a.path)).toEqual(['scripts/phone-owner-calendar-preflight-20261107.readonly.ps1','deploy/hostinger-pilot/phone-runtime-metadata-final-20261106.readonly.py']);
 for(const a of m.artifacts)expect(sha(read(a.path))).toBe(a.sha256);
});
