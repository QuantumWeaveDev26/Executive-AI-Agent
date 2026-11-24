import {it,expect} from 'vitest';
import fs from 'node:fs';
import {deriveEffectiveContract} from './phone-schema-effective-contract.mjs';
import {createSourceAclState} from './phone-schema-acl-effects.mjs';
const sources=(sql:string)=>Array.from({length:14},(_,i)=>({path:`acl-${i}.sql`,bytes:Buffer.from(i?'-- empty\n':sql)}));
const acl=(action:string,privilege:string,columns:string[]=[])=>({scope:'object',action,objectKind:'table',objects:['public.t'],allInSchemas:[],privileges:[{privilege,columns}],grantees:['app'],grantOption:false,grantOptionOnly:false,creatorRoles:[],schemas:[]});
it('folds table and column grants in order without revoking a separate column grant',()=>{
 const s=createSourceAclState();s.create('table','public.t','postgres',{columns:['id','role']});
 expect(s.apply(acl('grant','SELECT'))).toEqual([]);s.apply(acl('grant','UPDATE',['role']));s.apply(acl('revoke','SELECT'));
 const t=s.snapshot().objects[0];expect(t.acl.filter((x:any)=>x.grantee==='app')).toEqual([{grantor:'postgres',grantee:'app',privilege:'UPDATE',column:'role',grantOption:false}]);
});
it('a table-level REVOKE removes matching column privileges, but not other privilege kinds',()=>{
 const s=createSourceAclState();s.create('table','public.t','postgres',{columns:['role']});s.apply(acl('grant','UPDATE',['role']));s.apply(acl('grant','SELECT',['role']));
 s.apply(acl('revoke','UPDATE'));const rows=s.snapshot().objects[0].acl.filter((x:any)=>x.grantee==='app');
 expect(rows).toEqual([{grantor:'postgres',grantee:'app',privilege:'SELECT',column:'role',grantOption:false}]);
});
it('table-level REVOKE GRANT OPTION keeps matching column rights but removes their grant option',()=>{
 const s=createSourceAclState();s.create('table','public.t','postgres',{columns:['role']});s.apply({...acl('grant','UPDATE',['role']),grantOption:true});
 s.apply({...acl('revoke','UPDATE'),grantOptionOnly:true});
 expect(s.snapshot().objects[0].acl.filter((x:any)=>x.grantee==='app')).toEqual([{grantor:'postgres',grantee:'app',privilege:'UPDATE',column:'role',grantOption:false}]);
});
it('keeps grants when replacing functions and does not carry them through DROP/recreate',()=>{
 const s=createSourceAclState();s.create('function','public.f()','postgres');
 const e={...acl('grant','EXECUTE'),objectKind:'function',objects:['public.f()']};s.apply(e);s.create('function','public.f()','postgres',{replace:true});
 expect(s.snapshot().objects[0].acl.some((x:any)=>x.grantee==='app')).toBe(true);
 s.drop('function','public.f()');s.create('function','public.f()','postgres');expect(s.snapshot().objects[0].acl.some((x:any)=>x.grantee==='app')).toBe(false);
});
it('uses current object membership for ALL IN SCHEMA, never future objects',()=>{
 const s=createSourceAclState();s.create('table','public.t','postgres');expect(s.apply({...acl('grant','SELECT'),objects:[],allInSchemas:['public']})).toEqual(['acl-collection-coverage-unverified']);s.create('table','public.later','postgres');
 expect(s.snapshot().objects.find((x:any)=>x.name==='public.t').acl.some((x:any)=>x.grantee==='app')).toBe(true);
 expect(s.snapshot().objects.find((x:any)=>x.name==='public.later').acl.some((x:any)=>x.grantee==='app')).toBe(false);
});
it('schema default REVOKE cannot remove global PUBLIC function EXECUTE',()=>{
 const s=createSourceAclState();s.apply({scope:'default',action:'revoke',objectKind:'function',creatorRoles:['postgres'],schemas:['public'],privileges:[{privilege:'ALL',columns:[]}],grantees:['PUBLIC'],grantOption:false,grantOptionOnly:false});
 s.create('function','public.f()','postgres');expect(s.snapshot().objects[0].acl.some((x:any)=>x.grantee==='PUBLIC'&&x.privilege==='EXECUTE')).toBe(true);
});
it('blocks unknown objects and keeps ownership-transfer runtime proof unverified',()=>{
 const s=createSourceAclState();expect(s.apply(acl('grant','SELECT'))).toEqual(['acl-object-dependency-unverified']);
 s.create('table','public.t','postgres');s.transfer('table','public.t','guard');
 expect(s.apply(acl('grant','SELECT'))).toEqual([]);expect(s.snapshot().objects[0].aclVerified).toBe(false);expect(s.snapshot().ownershipTransfers[0].verified).toBe(false);
});
it('substitutes both grantor and grantee and unions colliding grants on ownership transfer',()=>{
 const s=createSourceAclState();s.create('table','public.t','postgres');s.apply({...acl('grant','SELECT'),grantees:['guard'],grantOption:true});
 s.transfer('table','public.t','guard');const rows=s.snapshot().objects[0].acl;
 expect(rows.some((x:any)=>x.grantor==='postgres'||x.grantee==='postgres')).toBe(false);
 expect(rows.filter((x:any)=>x.grantor==='guard'&&x.grantee==='guard'&&x.privilege==='SELECT')).toEqual([{grantor:'guard',grantee:'guard',privilege:'SELECT',column:null,grantOption:true}]);
});
it('global default changes affect future objects only and cannot be undone by schema-local revokes',()=>{
 const s=createSourceAclState();s.create('function','public.before()','postgres');
 const revoke={scope:'default',action:'revoke',objectKind:'function',creatorRoles:['postgres'],schemas:[],privileges:[{privilege:'EXECUTE',columns:[]}],grantees:['PUBLIC'],grantOption:false,grantOptionOnly:false};
 s.apply(revoke);s.create('function','public.after()','postgres');
 expect(s.snapshot().objects.find((x:any)=>x.name==='public.before()').acl.some((x:any)=>x.grantee==='PUBLIC')).toBe(true);
 expect(s.snapshot().objects.find((x:any)=>x.name==='public.after()').acl.some((x:any)=>x.grantee==='PUBLIC')).toBe(false);
});
it('derives public-schema grants only under an explicit unverified PG16 bootstrap dependency',()=>{
 const s=createSourceAclState({pg16PublicNamespace:true});
 expect(s.apply({...acl('grant','USAGE'),objectKind:'schema',objects:['public']})).toEqual([]);
 const pub=s.snapshot().objects.find((x:any)=>x.kind==='schema'&&x.name==='public');
 expect(pub.acl).toContainEqual({grantor:'pg_database_owner',grantee:'app',privilege:'USAGE',column:null,grantOption:false});
 expect(s.snapshot().externalDependencies[0]).toMatchObject({schema:'public',owner:'pg_database_owner',verified:false});
});
it('rolls back ACL ownership state together with an unsupported multi-action DDL statement',()=>{
 const r=deriveEffectiveContract(sources('CREATE TABLE t(id uuid); ALTER TABLE t OWNER TO guard, JUNK; GRANT SELECT ON t TO app;'));
 const t=r.effectiveAclCandidate.objects.find((x:any)=>x.name==='public.t');expect(t.owner).toBe('postgres');
 expect(t.acl).toContainEqual({grantor:'postgres',grantee:'app',privilege:'SELECT',column:null,grantOption:false});expect(r.effectiveAclCandidate.ownershipTransfers).toEqual([]);
});
it('makes every unproven precondition and effect an explicit source-bound admission blocker',()=>{
 const r=deriveEffectiveContract(sources('CREATE TABLE IF NOT EXISTS t(id uuid); GRANT SELECT ON t TO app;'));
 expect(r.admissionConditions).toHaveLength(r.requiredPreconditions.length+r.unresolved.length);
 expect(r.admissionConditions.every((x:any)=>x.blocking===true&&x.verified===false&&/^[a-f0-9]{64}$/.test(x.id))).toBe(true);
 expect(new Set(r.admissionConditions.map((x:any)=>x.id)).size).toBe(r.admissionConditions.length);
 expect(r.productionAdmission).toBe(false);expect(r.executionAuthorized).toBe(false);expect(r.expectedCatalog).toBeNull();
});
it('does not expose mutable ACL state through snapshots or caller-owned column arrays',()=>{
 const columns=['role'],s=createSourceAclState();s.create('table','public.t','postgres',{columns});columns.push('unexpected');
 expect(s.apply(acl('grant','UPDATE',['unexpected']))).toEqual(['acl-column-dependency-unverified']);
 s.snapshot().objects[0].acl[0].grantee='tampered';expect(s.snapshot().objects[0].acl.some((x:any)=>x.grantee==='tampered')).toBe(false);
});
it('models ordered column and table ACL deltas without treating column grants as table grants',()=>{
 const r=deriveEffectiveContract(sources('CREATE TABLE t(id uuid, role text); GRANT SELECT, UPDATE(role) ON TABLE t TO app; REVOKE SELECT ON t FROM app;'));
 expect(r.aclEffects).toHaveLength(2);
 expect(r.aclEffects[0]).toMatchObject({action:'grant',objectKind:'table',objects:['public.t'],grantees:['app'],privileges:[{privilege:'SELECT',columns:[]},{privilege:'UPDATE',columns:['role']}]});
 expect(r.aclEffects[1]).toMatchObject({action:'revoke',privileges:[{privilege:'SELECT',columns:[]}]});
 expect(r.productionAdmission).toBe(false);
});
it('distinguishes overload lists and ALL privileges and keeps grant options',()=>{
 const r=deriveEffectiveContract(sources('CREATE FUNCTION f(x uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$; CREATE FUNCTION f(x text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$; GRANT EXECUTE ON FUNCTION f(uuid), f(text) TO app WITH GRANT OPTION; REVOKE ALL PRIVILEGES ON FUNCTION f(uuid) FROM PUBLIC;'));
 expect(r.aclEffects[0]).toMatchObject({objects:['public.f(uuid)','public.f(text)'],grantOption:true});
 expect(r.aclEffects[1]).toMatchObject({privileges:[{privilege:'ALL',columns:[]}],grantees:['PUBLIC']});
});
it('separates schema-specific default privileges from global defaults',()=>{
 const r=deriveEffectiveContract(sources('ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA platform REVOKE ALL ON FUNCTIONS FROM PUBLIC;'));
 expect(r.aclEffects[0]).toMatchObject({scope:'default',creatorRoles:['owner'],schemas:['platform'],objectKind:'function',action:'revoke'});
 expect(r.aclEffects[0].defaultSemantics).toBe('schema-additive-only');
});
it.each(['GRANT EXECUTE ON FUNCTION f() TO app JUNK;','GRANT SELECT ON t TO app CASCADE;','GRANT app TO worker;','GRANT SELECT ON ALL TABLES IN SCHEMA public TO app JUNK;','GRANT TRUNCATE(id) ON t TO app;','GRANT EXECUTE ON t TO app;','REVOKE SELECT ON t FROM app CASCADE;','ALTER DEFAULT PRIVILEGES FOR ROLE owner IN SCHEMA public REVOKE SELECT(id) ON TABLES FROM PUBLIC;'])('refuses unsupported ACL semantics atomically: %s',sql=>{
 const r=deriveEffectiveContract(sources(sql));expect(r.aclEffects).toEqual([]);expect(r.unresolved).toHaveLength(1);
});
it('preserves ALL IN SCHEMA scope instead of assuming an empty or complete object set',()=>{
 const r=deriveEffectiveContract(sources('GRANT SELECT ON ALL TABLES IN SCHEMA public TO app;'));
 expect(r.aclEffects[0]).toMatchObject({allInSchemas:['public'],objects:[],verified:false});
 expect(r.unresolved[0].reason).toBe('acl-effective-grantor-unverified');
});
it.each(['GRANT EXECUTE ON FUNCTION f(uuid JUNK) TO app;','GRANT EXECUTE ON FUNCTION f(p_id uuid) TO app;','GRANT EXECUTE ON FUNCTION f(unknown_type) TO app;'])('rejects unsupported function argument representations: %s',sql=>{
 const r=deriveEffectiveContract(sources(sql));expect(r.aclEffects).toEqual([]);expect(r.unresolved).toHaveLength(1);
});
it.each(['GRANT SELECT ON t TO "PUBLIC";','GRANT SELECT ON t TO "public";'])('does not conflate quoted role names with the PUBLIC pseudo-role: %s',sql=>{
 const r=deriveEffectiveContract(sources(sql));expect(r.aclEffects).toEqual([]);expect(r.unresolved).toHaveLength(1);
});
it('normalizes every original top-level ACL statement without removing its unverified grantor gate',()=>{
 const old=JSON.parse(fs.readFileSync('docs/integrations/phone/F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json','utf8'));
 const r=deriveEffectiveContract(old.sources.map((s:any)=>({path:s.path,bytes:fs.readFileSync(s.path)})));
 expect(r.aclEffects.filter((x:any)=>!x.proceduralOrigin)).toHaveLength(169);
 expect(r.aclEffects.every((x:any)=>x.verified===false)).toBe(true);
 expect(r.expectedCatalog).toBeNull();expect(r.executionAuthorized).toBe(false);
});
