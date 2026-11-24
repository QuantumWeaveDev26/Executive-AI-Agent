import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {deriveHostedInboundSql,makeHostedInboundReview} from './phone-inbound-hosted-install-review.mjs';
import {INBOUND_SQL_SOURCES} from './phone-inbound-runtime-sql.mjs';
for(const step of [112,113] as const){
 it(`preserves tested schema body while requiring exact target and new step${step} approval`,()=>{
  const source=readFileSync(INBOUND_SQL_SOURCES[step].path,'utf8'),draft=deriveHostedInboundSql(step,source);
  expect(draft.slice(draft.indexOf(' IF to_reg'))).toBe(source.slice(source.indexOf(' IF to_reg')));
  expect(draft).toContain("current_database() IS DISTINCT FROM 'thaara_vps_pilot'");
  expect(draft).toContain(`thaara.step${step}_hosted_install_approved`);expect(draft).toContain('owner-approved-inbound-hosted-install-v1');
  expect(draft).toContain('SET LOCAL search_path=pg_catalog;');expect(draft).toContain("session_user IS DISTINCT FROM 'postgres'");
  expect(draft).toContain('base security preconditions failed');expect(draft).toContain('policy name collision');
  expect(draft).not.toContain('isolated-runtime-only');expect(draft).not.toContain('in-memory-only');
 });
 it(`refuses modified schema source for step${step}`,()=>{const source=readFileSync(INBOUND_SQL_SOURCES[step].path,'utf8');expect(()=>deriveHostedInboundSql(step,source+'\n')).toThrow();});
}
const receipt=()=>({mode:'readonly_inbound_inventory',sourceHealthy:true,imageMatched:true,catalogReadOnly:true,hostRecordMatched:true,hostHandshakeVerified:true,cleanupVerified:true,inventory:{databaseMatched:true,postgres16:true,baseSchemaPresent:true,journalPresent:false,principalTablePresent:false,ingestRolePresent:false,guardRolePresent:false,appendFunctionPresent:false,resolveGrantFunctionPresent:false,scopeMatchFunctionPresent:false}});
it('binds historical inventory evidence but never grants installation or runtime authority',()=>{
 const p=makeHostedInboundReview(receipt(),'a'.repeat(64));expect(p).toMatchObject({reviewOnly:true,installationAllowed:false,runtimeEnabled:false,targetDatabase:'thaara_vps_pilot',inventoryReceiptSha256:'a'.repeat(64)});
 expect(p.ownerIdentity).toBeNull();expect(p.backupVerification).toBeNull();expect(p.hostingExceptionApproval).toBeNull();
});
it('rejects uncertain targets, existing inbound objects and unverified authentication/cleanup',()=>{
 for(const key of Object.keys(receipt().inventory)){const r=receipt();(r.inventory as any)[key]=!r.inventory[key as keyof typeof r.inventory];expect(()=>makeHostedInboundReview(r,'a'.repeat(64))).toThrow();}
 for(const key of ['sourceHealthy','imageMatched','catalogReadOnly','hostRecordMatched','hostHandshakeVerified','cleanupVerified']){const r=receipt();(r as any)[key]=false;expect(()=>makeHostedInboundReview(r,'a'.repeat(64))).toThrow();}
 expect(()=>makeHostedInboundReview(receipt(),'not-a-hash')).toThrow();
});
