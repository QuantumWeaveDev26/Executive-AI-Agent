import {it,expect,vi} from 'vitest';
import {rehearseInboundInstall} from './phone-inbound-install-sequence.mjs';
const runId='a'.repeat(32),manifest='b'.repeat(64),sha112='c'.repeat(64),sha113='d'.repeat(64),catalog='e'.repeat(64);
const target={containerId:'f'.repeat(64),imageId:'sha256:'+'1'.repeat(64),database:'thaara_vps_pilot',postgresMajor:16};
const now=Date.parse('2026-11-04T10:00:00Z');
function fixture(){
 const sources={manifestSha256:manifest,sql112Sha256:sha112,sql113Sha256:sha113,expected112CatalogSha256:catalog};
 const ports={sources:vi.fn(async()=>({...sources})),target:vi.fn(async()=>({...target})),
  authorization:vi.fn(async()=>({runId,manifestSha256:manifest,scope:'inbound-schema-only',approved:true})),
  preconditions:vi.fn(async()=>({ready:true})),backup:vi.fn(async()=>({verified:true,restoreVerified:true,restoreFixtureRemoved:true,sourceIdentity:target,archiveSha256:'2'.repeat(64),verifiedAt:'2026-11-04T09:55:00Z'})),
  apply:vi.fn(async(step:number)=>({step,runId,sqlSha256:step===112?sha112:sha113,committed:true,...(step===113?{journalCatalogSha256:catalog,journalLockedAndVerified:true}:{})})),
  journal:vi.fn(async()=>({runId,sqlSha256:sha112,catalogSha256:catalog,verified:true})),
  privileges:vi.fn(async()=>({runId,sqlSha256:sha113,verified:true})),now:()=>now};return {ports,sources};
}
it('requires fresh recovery proof, same-run112 receipt and exact catalog before113',async()=>{
 const {ports}=fixture(),r=await rehearseInboundInstall(ports,{runId});expect(r.status).toBe('rehearsed');expect(r.productionReady).toBe(false);expect(r.committedSteps).toEqual([112,113]);
 expect(ports.apply.mock.calls.map(c=>c[0])).toEqual([112,113]);expect(ports.journal.mock.invocationCallOrder[0]).toBeGreaterThan(ports.apply.mock.invocationCallOrder[0]!);expect(ports.journal.mock.invocationCallOrder[0]).toBeLessThan(ports.apply.mock.invocationCallOrder[1]!);
});
it('blocks incomplete approval, backup, catalog or initial target before mutation',async()=>{
 const a=fixture();a.ports.authorization.mockResolvedValueOnce({runId,manifestSha256:manifest,scope:'inbound-schema-only',approved:false});expect((await rehearseInboundInstall(a.ports,{runId})).status).toBe('stopped');expect(a.ports.apply).not.toHaveBeenCalled();
 const b=fixture();b.ports.backup.mockResolvedValueOnce({...await b.ports.backup(),verifiedAt:'2026-10-31T00:00:00Z'});await rehearseInboundInstall(b.ports,{runId});expect(b.ports.apply).not.toHaveBeenCalled();
 const c=fixture();c.sources.expected112CatalogSha256='';await rehearseInboundInstall(c.ports,{runId});expect(c.ports.apply).not.toHaveBeenCalled();
 const d=fixture();d.ports.target.mockResolvedValueOnce({...target,database:'other'});await rehearseInboundInstall(d.ports,{runId});expect(d.ports.apply).not.toHaveBeenCalled();
});
it('stops113 on a foreign112 receipt or catalog mismatch while preserving known partial state',async()=>{
 const a=fixture();a.ports.apply.mockResolvedValueOnce({step:112,runId:'9'.repeat(32),sqlSha256:sha112,committed:true});const x=await rehearseInboundInstall(a.ports,{runId});expect(x.status).toBe('stopped');expect(x.stateUncertain).toBe(true);expect(a.ports.journal).not.toHaveBeenCalled();expect(a.ports.apply).toHaveBeenCalledTimes(1);
 const b=fixture();b.ports.journal.mockResolvedValueOnce({runId,sqlSha256:sha112,catalogSha256:'0'.repeat(64),verified:true});const y=await rehearseInboundInstall(b.ports,{runId});expect(y.committedSteps).toEqual([112]);expect(y.stateUncertain).toBe(false);expect(b.ports.apply).toHaveBeenCalledTimes(1);
});
it('rechecks source/target and approval before113 without retry or automatic downgrade',async()=>{
 const f=fixture();f.ports.sources.mockResolvedValueOnce({...f.sources}).mockResolvedValueOnce({...f.sources}).mockResolvedValueOnce({...f.sources,sql113Sha256:'0'.repeat(64)});
 const r=await rehearseInboundInstall(f.ports,{runId});expect(r.status).toBe('stopped');expect(r.committedSteps).toEqual([112]);expect(f.ports.apply).toHaveBeenCalledTimes(1);expect(r.recovery).toBe('keep_reporting_disabled_preserve_evidence_forward_review');
});
it('treats thrown commit acknowledgements as uncertain, never claims rollback or retries',async()=>{
 const f=fixture();f.ports.apply.mockRejectedValueOnce(Error('PRIVATE SERVER SECRET'));const r=await rehearseInboundInstall(f.ports,{runId});expect(r.stateUncertain).toBe(true);expect(r.committedSteps).toEqual([]);expect(f.ports.apply).toHaveBeenCalledTimes(1);expect(JSON.stringify(r)).not.toContain('PRIVATE');
});
it('rejects use outside tests before any port is touched',async()=>{
 vi.stubEnv('NODE_ENV','production');const f=fixture();try{await expect(rehearseInboundInstall(f.ports,{runId})).rejects.toThrow(/test-only/);expect(f.ports.sources).not.toHaveBeenCalled();}finally{vi.unstubAllEnvs();}
});
it('rejects wrong backup target, missing restore cleanup, future dates and invalid clocks before mutation',async()=>{
 for(const change of [{sourceIdentity:{...target,containerId:'0'.repeat(64)}},{restoreFixtureRemoved:false},{verifiedAt:'2026-11-04T10:01:00Z'},{archiveSha256:'invalid'}]){
  const f=fixture();f.ports.backup.mockResolvedValueOnce({...await f.ports.backup(),...change} as any);await rehearseInboundInstall(f.ports,{runId});expect(f.ports.apply).not.toHaveBeenCalled();
 }
 const f=fixture();f.ports.now=()=>NaN;await rehearseInboundInstall(f.ports,{runId});expect(f.ports.apply).not.toHaveBeenCalled();
});
it('stops on target drift or revoked approval after112',async()=>{
 const f=fixture();f.ports.target.mockResolvedValueOnce({...target}).mockResolvedValueOnce({...target}).mockResolvedValueOnce({...target,containerId:'0'.repeat(64)});
 expect((await rehearseInboundInstall(f.ports,{runId})).committedSteps).toEqual([112]);expect(f.ports.apply).toHaveBeenCalledTimes(1);
 const g=fixture();g.ports.authorization.mockResolvedValueOnce({runId,manifestSha256:manifest,scope:'inbound-schema-only',approved:true}).mockResolvedValueOnce({runId,manifestSha256:manifest,scope:'inbound-schema-only',approved:true}).mockResolvedValueOnce({runId,manifestSha256:manifest,scope:'inbound-schema-only',approved:false});
 expect((await rehearseInboundInstall(g.ports,{runId})).committedSteps).toEqual([112]);expect(g.ports.apply).toHaveBeenCalledTimes(1);
});
it('requires113 commit receipt to attest the transaction-bound locked journal check',async()=>{
 const f=fixture();f.ports.apply.mockImplementation(async step=>({step,runId,sqlSha256:step===112?sha112:sha113,committed:true}));
 const r=await rehearseInboundInstall(f.ports,{runId});expect(r.status).toBe('stopped');expect(r.stateUncertain).toBe(true);expect(r.committedSteps).toEqual([112]);expect(f.ports.apply.mock.calls[1]?.[1]).toMatchObject({expected112CatalogSha256:catalog});
});
it('records both confirmed commits if final privilege verification fails, without claiming rollback',async()=>{
 const f=fixture();f.ports.privileges.mockResolvedValueOnce({runId,sqlSha256:sha113,verified:false});const r=await rehearseInboundInstall(f.ports,{runId});expect(r.status).toBe('stopped');expect(r.committedSteps).toEqual([112,113]);expect(r.stateUncertain).toBe(false);expect(r.phase).toBe('privilege_verification');expect(f.ports.apply).toHaveBeenCalledTimes(2);
});
it('rejects final privilege receipts from a different run or SQL revision',async()=>{
 for(const change of [{runId:'9'.repeat(32)},{sqlSha256:'0'.repeat(64)}]){const f=fixture();f.ports.privileges.mockResolvedValueOnce({runId,sqlSha256:sha113,verified:true,...change});const r=await rehearseInboundInstall(f.ports,{runId});expect(r.status).toBe('stopped');expect(r.committedSteps).toEqual([112,113]);}
});
