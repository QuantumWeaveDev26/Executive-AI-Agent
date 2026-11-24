import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createInboundPrincipalGate,type InboundPrincipalGrant} from '../src/services/phone-inbound-principal.js';
import {createInboundPrincipalTransactions} from '../src/services/phone-inbound-principal-postgres.js';
import type {InboundDiagnostic} from '../src/services/phone-inbound-diagnostics.js';
import {ForbiddenError} from '@thaara/observability';
const token='synthetic-phone-runtime-token-00000000000',hash=createHash('sha256').update(token).digest('hex');
const profile={routeId:'inbound-a',workspaceId:'workspace-a',ownerUserId:'owner-a',principalId:'principal-a',revision:1,profileFingerprint:'a'.repeat(64)};
const time=Date.parse('2026-11-03T12:00:00Z');
const grant=():InboundPrincipalGrant=>({...profile,tokenHash:hash,activeOwner:true,revokedAt:null,expiresAt:'2026-11-03T12:01:00Z',operations:['callback','completion']});
function fixture(options:{flags?:Record<string,unknown>;final?:Partial<InboundPrincipalGrant>;missing?:boolean;fail?:string;sqlState?:string;rollbackFails?:boolean;times?:number[];observerFails?:boolean;singleStatementOnly?:boolean}={}){
 const calls:string[]=[];let reads=0,clock=0;
 const query=vi.fn(async(sql:string,_params?:unknown[])=>{
  calls.push(sql);if(options.fail&&sql.includes(options.fail))throw Object.assign(Error('PRIVATE DATABASE DETAIL'),{code:options.sqlState,detail:'PRIVATE SQL CONTEXT'});
  if(options.singleStatementOnly&&sql.split(';').filter(s=>s.trim()).length>1)throw Object.assign(Error('Synthetic multi-statement rejection'),{code:'42601'});
  if(sql.startsWith('ROLLBACK')&&options.rollbackFails)throw Error('PRIVATE rollback detail');
  if(sql.includes('phone_inbound_role_preflight'))return {rows:[{role_name:'thaara_phone_ingest',session_role_name:'thaara_phone_ingest',schema_create:false,rolsuper:false,rolbypassrls:false,rolcreaterole:false,rolcreatedb:false,rolreplication:false,rolinherit:false,elevated_membership:false,owns_protected:false,journal_rls:true,journal_force_rls:true,direct_journal_access:false,direct_protected_access:false,...options.flags}]};
  if(sql.includes('phone_inbound_resolve_grant')){reads++;return {rows:options.missing?[]:[{grant_record:reads===1?grant():{...grant(),...options.final}}]};}
  return {rows:[]};
 });
 const release=vi.fn(),connect=vi.fn(async()=>({query,release}));
 const diagnostics:InboundDiagnostic[]=[];
 const transactions=createInboundPrincipalTransactions({pool:{connect},now:()=>options.times?.[clock++]??time,onDiagnostic:d=>{diagnostics.push(d);if(options.observerFails)throw Error('PRIVATE observer error');}});
 const gate=createInboundPrincipalGate({profile,transactions,now:()=>time});
 return {calls,query,release,connect,transactions,gate,diagnostics};
}
it('commits once after resolving and rechecking the grant, then releases the client',async()=>{
 const f=fixture();const result=await f.gate.run(profile.routeId,'Bearer '+token,'callback',async(_scope,tx)=>{await tx.query('SELECT synthetic_report_work()');return {saved:true};});
 expect(result).toEqual({saved:true});expect(f.calls[0]).toBe('BEGIN');expect(f.calls.filter(q=>q.includes('phone_inbound_resolve_grant'))).toHaveLength(2);expect(f.calls.at(-1)).toBe('COMMIT');expect(f.release).toHaveBeenCalledTimes(1);expect(f.release.mock.calls[0]).toEqual([]);
 expect(f.calls.join(' ')).toContain('statement_timeout');expect(f.calls.join(' ')).toContain('lock_timeout');expect(f.calls.join(' ')).toContain('idle_in_transaction_session_timeout');
});
it('rejects elevated roles, ownership, disabled RLS and direct table access before resolving a grant',async()=>{
 for(const flags of [{role_name:'thaara_app'},{session_role_name:'postgres'},{schema_create:true},{rolsuper:true},{rolbypassrls:true},{rolcreaterole:true},{rolcreatedb:true},{rolreplication:true},{rolinherit:true},{elevated_membership:true},{owns_protected:true},{journal_rls:false},{journal_force_rls:false},{direct_journal_access:true},{direct_protected_access:true},{journal_rls:null}]){
  const f=fixture({flags}),work=vi.fn();await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',work)).rejects.toThrow();expect(work).not.toHaveBeenCalled();expect(f.calls.some(q=>q.includes('phone_inbound_resolve_grant'))).toBe(false);expect(f.calls.at(-1)).toBe('ROLLBACK');expect(f.release).toHaveBeenCalledTimes(1);
 }
});
it('rolls back an unknown identity without invoking report work',async()=>{
 const f=fixture({missing:true}),work=vi.fn();await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',work)).rejects.toThrow();expect(work).not.toHaveBeenCalled();expect(f.calls.at(-1)).toBe('ROLLBACK');
});
it('rolls back when the grant is revoked, owner deactivated or binding changes before commit',async()=>{
 for(const final of [{revokedAt:'2026-11-03T12:00:00Z'},{activeOwner:false},{revision:2},{profileFingerprint:'b'.repeat(64)},{workspaceId:'other'},{operations:['completion'] as const}]){
  const f=fixture({final});await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',async()=>({saved:true}))).rejects.toThrow();expect(f.calls).not.toContain('COMMIT');expect(f.calls.at(-1)).toBe('ROLLBACK');
 }
});
it('rolls back expired grants and transaction budget overruns before returning success',async()=>{
 for(const times of [[time,time+61000],[time,time+9000],[time,NaN],[time,time-1]]){
  const f=fixture({times});await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',async()=>({saved:true}))).rejects.toThrow();expect(f.calls).not.toContain('COMMIT');expect(f.calls.at(-1)).toBe('ROLLBACK');
 }
});
it('does not expose database errors or retry after report work fails',async()=>{
 const f=fixture(),work=vi.fn(async()=>{throw Error('PRIVATE failed save');});await expect(f.gate.run(profile.routeId,'Bearer '+token,'completion',work)).rejects.toThrow('Inbound principal admission is unavailable.');expect(work).toHaveBeenCalledTimes(1);expect(f.connect).toHaveBeenCalledTimes(1);expect(f.calls.at(-1)).toBe('ROLLBACK');
});
it('treats a failed COMMIT as uncertain, returns no receipt and discards the connection',async()=>{
 const f=fixture({fail:'COMMIT'});await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',async()=>({saved:true}))).rejects.toThrow('Inbound principal admission is unavailable.');expect(f.calls.filter(q=>q==='COMMIT')).toHaveLength(1);expect(f.release.mock.calls[0]?.[0]).toBe(true);
});
it('discards a connection if rollback fails and still sanitizes the original error',async()=>{
 const f=fixture({rollbackFails:true});await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',async()=>{throw Error('PRIVATE');})).rejects.toThrow('Inbound principal admission is unavailable.');expect(f.release.mock.calls[0]?.[0]).toBe(true);
});
it('prevents retained transaction handles from being used after commit',async()=>{
 const f=fixture();let retained:any;await f.gate.run(profile.routeId,'Bearer '+token,'callback',async(_s,tx)=>{retained=tx;return true;});const count=f.query.mock.calls.length;
 await expect(retained.query('SELECT unauthorized_late_work()')).rejects.toThrow();expect(f.query.mock.calls).toHaveLength(count);
});
it('refuses invalid request shapes before connecting and construction outside tests',async()=>{
 const f=fixture();await expect(f.transactions.withGrant({routeId:'bad/route',tokenHash:hash,operation:'callback'},vi.fn())).rejects.toThrow();expect(f.connect).not.toHaveBeenCalled();
 const original=process.env.NODE_ENV;try{process.env.NODE_ENV='production';expect(()=>fixture()).toThrow('test-only');}finally{process.env.NODE_ENV=original;}
});
it('compares final identity against an immutable admission snapshot even if work mutates its grant argument',async()=>{
 const f=fixture({final:{revision:2}});
 await expect(f.transactions.withGrant({routeId:profile.routeId,tokenHash:hash,operation:'callback'},async(g)=>{
  (g as any).revision=2;return {saved:true};
 })).rejects.toThrow();expect(f.calls).not.toContain('COMMIT');
});
it('releases failed-begin clients as broken and never retries a failed connection',async()=>{
 const f=fixture({fail:'BEGIN'});await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',vi.fn())).rejects.toThrow();expect(f.release).toHaveBeenCalledWith(true);
 const connect=vi.fn(async()=>{throw Error('PRIVATE credentials');});
 const transactions=createInboundPrincipalTransactions({pool:{connect}});
 await expect(transactions.withGrant({routeId:profile.routeId,tokenHash:hash,operation:'callback'},vi.fn())).rejects.toThrow('Inbound principal transaction is unavailable.');expect(connect).toHaveBeenCalledTimes(1);
});
it('captures the failing resolver phase and allowlisted SQLSTATE before sanitizing the public error',async()=>{
 const f=fixture({fail:'phone_inbound_resolve_grant',sqlState:'42501'});
 await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',vi.fn())).rejects.toThrow('Inbound principal admission is unavailable.');
 expect(f.diagnostics[0]).toEqual({phase:'grant_initial',category:'permission',sqlState:'42501',check:null});expect(JSON.stringify(f.diagnostics)).not.toContain('PRIVATE');expect(f.calls.at(-1)).toBe('ROLLBACK');
});
it('identifies failed role validation without recording the actual privileged role',async()=>{
 const f=fixture({flags:{session_role_name:'PRIVATE_SESSION'}});await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',vi.fn())).rejects.toThrow();
 expect(f.diagnostics[0]?.phase).toBe('role_validation');expect(f.diagnostics[0]?.check).toBe('session_identity');expect(JSON.stringify(f.diagnostics)).not.toContain('PRIVATE_SESSION');
});
it('cannot let a diagnostic observer failure skip rollback or expose raw errors',async()=>{
 const f=fixture({fail:'phone_inbound_resolve_grant',sqlState:'42809',observerFails:true});
 await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',vi.fn())).rejects.toThrow('Inbound principal admission is unavailable.');expect(f.calls.at(-1)).toBe('ROLLBACK');expect(f.release).toHaveBeenCalledTimes(1);
});
it('retains a commit SQLSTATE and separately records rollback failure without replacing the first phase',async()=>{
 const f=fixture({fail:'COMMIT',sqlState:'08006',rollbackFails:true});await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',async()=>({saved:true}))).rejects.toThrow('Inbound principal admission is unavailable.');
 expect(f.diagnostics[0]).toEqual({phase:'commit',category:'connection',sqlState:'08006',check:null});expect(f.diagnostics[1]?.phase).toBe('rollback');expect(f.release).toHaveBeenCalledWith(true);
});
it('sets all three unchanged timeout values with separate awaited statements on a single-statement query API',async()=>{
 const f=fixture({singleStatementOnly:true});
 await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',async()=>({saved:true}))).resolves.toEqual({saved:true});
 expect(f.calls.slice(0,4)).toEqual(['BEGIN',"SET LOCAL statement_timeout='3s'","SET LOCAL lock_timeout='1s'","SET LOCAL idle_in_transaction_session_timeout='5s'"]);
 expect(f.calls.at(-1)).toBe('COMMIT');
});
it('preserves a policy403 only after successful rollback while hiding the original denial message',async()=>{
 const f=fixture();let caught:any;
 try{await f.gate.run(profile.routeId,'Bearer '+token,'callback',async()=>{throw new ForbiddenError('PRIVATE denial detail');});}catch(error){caught=error;}
 expect(caught.statusCode).toBe(403);expect(caught.message).toBe('Inbound principal admission was denied.');expect(f.calls.at(-1)).toBe('ROLLBACK');expect(f.calls).not.toContain('COMMIT');expect(f.release).toHaveBeenCalledTimes(1);
});
it('keeps rollback and commit failures503 even if the original error is a ForbiddenError',async()=>{
 const f=fixture({rollbackFails:true});await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',async()=>{throw new ForbiddenError('PRIVATE');})).rejects.toMatchObject({statusCode:503});expect(f.release).toHaveBeenCalledWith(true);
 const g=fixture();
 // Query is already a mock; replace only COMMIT to simulate a misleading native403 classification.
 const implementation=g.query.getMockImplementation()!;
 g.query.mockImplementation(async(sql:string,params?:unknown[])=>{if(sql==='COMMIT')throw new ForbiddenError('PRIVATE COMMIT');return implementation(sql,params);});
 await expect(g.gate.run(profile.routeId,'Bearer '+token,'callback',async()=>({saved:true}))).rejects.toMatchObject({statusCode:503});expect(g.release).toHaveBeenCalledWith(true);
});
it('rolls back if any timeout cannot be set and never proceeds to role or grant checks',async()=>{
 for(const fail of ['statement_timeout','lock_timeout','idle_in_transaction_session_timeout']){
  const f=fixture({singleStatementOnly:true,fail,sqlState:'42501'}),work=vi.fn();
  await expect(f.gate.run(profile.routeId,'Bearer '+token,'callback',work)).rejects.toThrow();expect(work).not.toHaveBeenCalled();expect(f.calls.at(-1)).toBe('ROLLBACK');
  expect(f.calls.some(sql=>sql.includes('phone_inbound_role_preflight'))).toBe(false);expect(f.diagnostics[0]?.phase).toBe('timeouts');
 }
});
