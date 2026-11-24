import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createInboundPrincipalGate,type InboundPrincipalGrant} from '../src/services/phone-inbound-principal.js';
const credential='synthetic-inbound-principal-token-0000000000';
const tokenHash=createHash('sha256').update(credential).digest('hex');
const profile={routeId:'inbound-a',workspaceId:'workspace-a',ownerUserId:'owner-a',principalId:'principal-a',revision:1,profileFingerprint:'a'.repeat(64)};
const now=Date.parse('2026-11-03T12:00:00Z');
const valid=():InboundPrincipalGrant=>({...profile,tokenHash,activeOwner:true,revokedAt:null,expiresAt:'2026-11-04T12:00:00Z',operations:['callback','completion']});
function fixture(change:Partial<InboundPrincipalGrant>={},broken=false){
 const tx={tag:'synthetic-transaction'};
 const withGrant=vi.fn(async(_request:any,work:any)=>{if(broken)throw Error('PRIVATE storage detail');return work({...valid(),...change},tx);});
 const work=vi.fn(async(scope:any,transaction:any)=>({scope,transaction}));
 const gate=createInboundPrincipalGate({profile,transactions:{withGrant},now:()=>now});
 return {gate,withGrant,work,tx};
}
it('admits only a distinct bound service scope inside the supplied transaction',async()=>{
 const f=fixture();const r=await f.gate.run('inbound-a','Bearer '+credential,'callback',f.work);
 expect(r.scope).toEqual({...profile,authKind:'phone_inbound',operation:'callback'});expect(r.transaction).toBe(f.tx);
 expect(r.scope).not.toHaveProperty('sessionTokenHash');expect(r.scope).not.toHaveProperty('role');expect(r.scope).not.toHaveProperty('tokenHash');
 expect(f.withGrant.mock.calls[0]?.[0]).toEqual({routeId:'inbound-a',tokenHash,operation:'callback'});
 expect(JSON.stringify(f.withGrant.mock.calls)).not.toContain(credential);
});
it('rejects absent, malformed and oversized credentials and unknown routes before storage',async()=>{
 const f=fixture();for(const auth of [undefined,'Basic abc','Bearer short','Bearer '+'x'.repeat(257),'Bearer '+credential+'\n'])await expect(f.gate.run('inbound-a',auth,'callback',f.work)).rejects.toThrow();
 await expect(f.gate.run('other','Bearer '+credential,'callback',f.work)).rejects.toThrow();expect(f.withGrant).not.toHaveBeenCalled();
});
it('rejects missing grants and credential mismatches without invoking report work',async()=>{
 for(const grant of [null,{...valid(),tokenHash:'b'.repeat(64)}]){
  const work=vi.fn();const gate=createInboundPrincipalGate({profile,now:()=>now,transactions:{withGrant:async(_r,fn)=>fn(grant,{} as never)}});
  await expect(gate.run('inbound-a','Bearer '+credential,'callback',work)).rejects.toThrow();expect(work).not.toHaveBeenCalled();
 }
});
it('rejects cross-tenant, owner, principal, revision and exact-profile mismatches',async()=>{
 for(const change of [{workspaceId:'other'},{ownerUserId:'other'},{principalId:'other'},{routeId:'other'},{revision:2},{profileFingerprint:'b'.repeat(64)}]){
  const f=fixture(change);await expect(f.gate.run('inbound-a','Bearer '+credential,'callback',f.work)).rejects.toThrow();expect(f.work).not.toHaveBeenCalled();
 }
});
it('rejects revoked, expired, malformed expiry and inactive-owner grants',async()=>{
 for(const change of [{revokedAt:'2026-11-03T11:00:00Z'},{expiresAt:'2026-11-03T12:00:00Z'},{expiresAt:'not-a-date'},{activeOwner:false}]){
  const f=fixture(change);await expect(f.gate.run('inbound-a','Bearer '+credential,'callback',f.work)).rejects.toThrow();expect(f.work).not.toHaveBeenCalled();
 }
});
it('allows completion only when that exact operation is granted',async()=>{
 const f=fixture({operations:['callback']});await expect(f.gate.run('inbound-a','Bearer '+credential,'completion',f.work)).rejects.toThrow();expect(f.work).not.toHaveBeenCalled();
 const allowed=fixture();expect((await allowed.gate.run('inbound-a','Bearer '+credential,'completion',allowed.work)).scope.operation).toBe('completion');
});
it('rejects general owner privileges and unexpected operations rather than broadening them',async()=>{
 const f=fixture({operations:['callback','dial'] as never});await expect(f.gate.run('inbound-a','Bearer '+credential,'callback',f.work)).rejects.toThrow();
 await expect(f.gate.run('inbound-a','Bearer '+credential,'dial' as never,f.work)).rejects.toThrow();expect(f.work).not.toHaveBeenCalled();
});
it('sanitizes backend errors and returns no success when the transaction fails',async()=>{
 const f=fixture({},true);await expect(f.gate.run('inbound-a','Bearer '+credential,'callback',f.work)).rejects.toThrow('Inbound principal admission is unavailable.');expect(f.work).not.toHaveBeenCalled();
 const healthy=fixture();await expect(healthy.gate.run('inbound-a','Bearer '+credential,'callback',async()=>{throw Error('PRIVATE row');})).rejects.toThrow('Inbound principal admission is unavailable.');
});
it('pins server profile and freezes scopes so caller mutation cannot retarget work',async()=>{
 const original={...profile};const f=fixture();
 const gate=createInboundPrincipalGate({profile:original,transactions:{withGrant:f.withGrant},now:()=>now});original.workspaceId='other';
 const r=await gate.run('inbound-a','Bearer '+credential,'callback',f.work);expect(r.scope.workspaceId).toBe('workspace-a');expect(Object.isFrozen(r.scope)).toBe(true);
});
it('refuses invalid clocks and empty configuration before authorizing work',async()=>{
 expect(()=>createInboundPrincipalGate({profile:{...profile,revision:0},transactions:{withGrant:vi.fn()},now:()=>now})).toThrow();
 const f=fixture();const gate=createInboundPrincipalGate({profile,transactions:{withGrant:f.withGrant},now:()=>NaN});await expect(gate.run('inbound-a','Bearer '+credential,'callback',f.work)).rejects.toThrow();expect(f.work).not.toHaveBeenCalled();
});
it('rechecks the grant on every delivery rather than caching an earlier approval',async()=>{
 let grant=valid();const work=vi.fn(async()=>({saved:true}));
 const gate=createInboundPrincipalGate({profile,now:()=>now,transactions:{withGrant:async(_r,fn)=>fn(grant,{})}});
 expect(await gate.run('inbound-a','Bearer '+credential,'callback',work)).toEqual({saved:true});grant={...grant,revokedAt:'2026-11-03T12:00:00Z'};
 await expect(gate.run('inbound-a','Bearer '+credential,'callback',work)).rejects.toThrow();expect(work).toHaveBeenCalledTimes(1);
});
it('never returns a saved receipt if transaction commit fails after the callback completes',async()=>{
 const work=vi.fn(async()=>({saved:true}));const gate=createInboundPrincipalGate({profile,now:()=>now,transactions:{withGrant:async(_r,fn)=>{await fn(valid(),{});throw Error('PRIVATE commit error');}}});
 await expect(gate.run('inbound-a','Bearer '+credential,'callback',work)).rejects.toThrow('Inbound principal admission is unavailable.');expect(work).toHaveBeenCalledTimes(1);
});
it('cannot be constructed in a production process',()=>{
 const original=process.env.NODE_ENV;
 try{process.env.NODE_ENV='production';expect(()=>fixture()).toThrow('test-only');}finally{process.env.NODE_ENV=original;}
});
it('rejects owner-session or other extra fields in its server binding',()=>{
 for(const extra of [{sessionTokenHash:'must-not-be-reused'},{role:'owner'},{tokenHash}]){
  expect(()=>createInboundPrincipalGate({profile:{...profile,...extra},transactions:{withGrant:vi.fn()},now:()=>now})).toThrow();
 }
});
