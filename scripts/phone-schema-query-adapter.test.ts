import {it,expect,vi} from 'vitest';
import {catalogQueryArtifact,createDisconnectedPg16Reader} from './phone-schema-query-adapter.mjs';
const h=(c:string)=>c.repeat(64);
function projection():any{
 const relations=['workspaces','users','memberships','sessions','audit_events','phone_inbound_call_events','phone_inbound_principals'].map(n=>({name:'public.'+n,owner:'postgres',rls:true,forceRls:true,kind:'r',persistence:'p',options:[],parents:[],triggers:[],rules:[],columns:[{name:'id',position:1,type:'uuid',notNull:true,default:null,identity:'',generated:'',collation:null}],constraints:[],indexes:[],policies:[],acl:[],columnAcl:[]}));
 const routines=['public.current_authenticated_scope()','public.resolve_session_scope(text)','public.phone_inbound_resolve_grant(text,text,text)','public.phone_inbound_scope_matches(uuid,uuid)','public.phone_inbound_append_event(jsonb)'].map(signature=>({signature,owner:'postgres',definition:'SYNTHETIC',language:'sql',result:'boolean',kind:'f',securityDefiner:true,leakproof:false,strict:false,volatility:'v',parallel:'u',config:[],acl:[]}));
 return {server_version_num:160006,stage:'after113',relations,routines,principals:['postgres','thaara_app','thaara_worker','thaara_phone_guard','thaara_phone_ingest'].map(name=>({name,login:false,inherit:false,super:false,bypassRls:false,createDb:false,createRole:false,replication:false,connectionLimit:-1,validUntil:null,config:[]})),namespaces:[{name:'public',owner:'postgres',acl:[]}],role_memberships:[],default_acls:[],dependency_contracts:[{name:'catalog-dependencies',kind:'pg16-dependency-graph',sha256:h('1')}]};
}
function fixture(){
 const binding={postgresVersionNum:160006,imageId:'sha256:'+h('1'),imageRepoDigest:'postgres@sha256:'+h('2'),platform:'linux/amd64',stage:'after113',sourceSetSha256:h('3'),extractorSha256:h('4'),normalizerSha256:h('5')};
 const p:any={server_version_num:160006,transaction_read_only:'on',transaction_isolation:'repeatable read',standard_conforming_strings:'on',search_path:'pg_catalog'};
 const result:any={projection:projection(),unsupported:[]};const calls:any[]=[];let ended=false;
 const snapshot={mode:'synthetic-only',withReadOnlySnapshot:async(fn:any)=>{try{return await fn({query:async(text:string,values:any[])=>{calls.push({text,values});return {rows:[calls.length===2?structuredClone(result):structuredClone(p)]};}});}finally{ended=true;}}};
 const pins=catalogQueryArtifact();const make=()=>createDisconnectedPg16Reader({binding,querySha256:pins.sha256,snapshotPort:snapshot});
 return {binding,p,result,calls,snapshot,pins,make,get ended(){return ended;}};
}
it('uses pinned read-only catalog SQL in one synthetic snapshot and validates the projection',async()=>{
 const f=fixture(),r=await f.make()();expect(r.status).toBe('local_projection_decoded');expect(r.executionAuthorized).toBe(false);expect(f.calls).toHaveLength(3);expect(f.ended).toBe(true);
 expect(f.calls[1].text).toBe(f.pins.sql);expect(f.calls[1].values).toEqual(['after113']);expect(r.catalog.serverVersionNum).toBe(160006);
});
it.each(['version','readonly','isolation','strings','path'])('rejects changed %s before catalog query',async mode=>{
 const f=fixture();if(mode==='version')f.p.server_version_num=160007;if(mode==='readonly')f.p.transaction_read_only='off';if(mode==='isolation')f.p.transaction_isolation='read committed';if(mode==='strings')f.p.standard_conforming_strings='off';if(mode==='path')f.p.search_path='public';
 expect((await f.make()()).status).toBe('denied');expect(f.calls).toHaveLength(1);expect(f.ended).toBe(true);
});
it.each(['unsupported','bad-table','wrong-version','bad-row-shape','empty-rows'])('rejects %s catalog output without a retry',async mode=>{
 const f=fixture();if(mode==='unsupported')f.result.unsupported=['view:public.injected'];if(mode==='bad-table')f.result.projection.relations[0].extra=true;if(mode==='wrong-version')f.result.projection.server_version_num=160007;if(mode==='bad-row-shape')f.result.extra=true;
 if(mode==='empty-rows')f.snapshot.withReadOnlySnapshot=async(fn:any)=>fn({query:async()=>({rows:[]})});
 const r=await f.make()();expect(r.status).toBe('denied');expect(r.executionAuthorized).toBe(false);expect(f.calls.length).toBeLessThanOrEqual(3);
});
it('requires exact query hash and a synthetic-only port; no default driver exists',()=>{
 const f=fixture();expect(()=>createDisconnectedPg16Reader({binding:f.binding,querySha256:h('0'),snapshotPort:f.snapshot})).toThrow();
 expect(()=>createDisconnectedPg16Reader({binding:f.binding,querySha256:f.pins.sha256,snapshotPort:{mode:'live'}})).toThrow();
});
it('does not leak adapter errors or leave a synthetic snapshot open',async()=>{
 const f=fixture();f.snapshot.withReadOnlySnapshot=async()=>{throw Error('PRIVATE CONNECTION DETAIL');};const r=await f.make()();expect(r).toEqual({status:'denied',productionAdmission:false,executionAuthorized:false});
});
it('rejects a snapshot port that returns an arbitrary result or invokes the reader twice',async()=>{
 const a=fixture();a.snapshot.withReadOnlySnapshot=async()=>({status:'forged',executionAuthorized:true});expect((await a.make()()).status).toBe('denied');
 const b=fixture();b.snapshot.withReadOnlySnapshot=async(fn:any)=>{const tx={query:async(text:string)=>({rows:[text===b.pins.sql?b.result:b.p]})};await fn(tx);return fn(tx);};expect((await b.make()()).status).toBe('denied');
});
it('is disconnected and forbidden outside tests',async()=>{
 const f=fixture(),read=f.make();vi.stubEnv('NODE_ENV','production');try{expect(()=>f.make()).toThrow(/test-only/);await expect(read()).rejects.toThrow(/test-only/);}finally{vi.unstubAllEnvs();}
});
it('query covers security catalog facets and contains no credentials/DDL or row-data reads',()=>{
 const q=catalogQueryArtifact().sql;
 for(const name of ['pg_class','pg_attribute','pg_constraint','pg_index','pg_policy','pg_proc','pg_roles','pg_namespace','pg_auth_members','pg_default_acl','pg_depend','pg_trigger','pg_rewrite'])expect(q).toContain('pg_catalog.'+name);
 expect(q).not.toMatch(/rolpassword|FROM\s+public\.|FROM\s+platform\.|\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\s+(TABLE|ROLE|FUNCTION|POLICY|SCHEMA|INTO|FROM)\b/i);
});
it('captures trigger firing state and source definer role instead of omitting legitimate base objects',()=>{
 const q=catalogQueryArtifact().sql;for(const field of ['t.tgenabled','t.tgdeferrable','t.tginitdeferred','t.tgoldtable','t.tgnewtable',"'thaara_definer'"])expect(q).toContain(field);
 expect(q).toContain('disabled-internal-trigger:');
});
