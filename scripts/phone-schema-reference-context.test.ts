import {it,expect} from 'vitest';
import fs from 'node:fs';
import {deriveEffectiveContract} from './phone-schema-effective-contract.mjs';
import {createSourceReferenceContext} from './phone-schema-reference-context.mjs';
const read=(p:string)=>fs.readFileSync(p);
const inputs=()=>({bootstrapSource:read('packages/db/src/migrator.ts'),bootstrapCompiled:read('packages/db/dist/migrator.js'),pgcryptoSql:read('docs/integrations/phone/reference-sources/pgcrypto--1.3.REL_16_15.sql'),pgcryptoControl:read('docs/integrations/phone/reference-sources/pgcrypto.REL_16_15.control')});
const sources=()=>JSON.parse(read('docs/integrations/phone/F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json').toString()).sources.map((s:any)=>({path:s.path,bytes:read(s.path)}));
it('models the ten known effects under exact source context while retaining unverified admission conditions',()=>{
 const result=deriveEffectiveContract(sources(),{referenceContext:createSourceReferenceContext(inputs())});
 expect(result.statementCount).toBe(864);expect(result.unresolved).toEqual([]);
 expect(result.tables.map((t:any)=>t.name)).toContain('public.schema_migrations');
 expect(result.functions.filter((f:any)=>f.nativeSource)).toHaveLength(36);
 expect(result.referenceContext.productionAdmission).toBe(false);expect(result.expectedCatalog).toBeNull();
 expect(result.productionAdmission).toBe(false);expect(result.executionAuthorized).toBe(false);expect(result.staticResolutionComplete).toBe(false);
 expect(result.requiredPreconditions.every((p:any)=>p.verified!==true)).toBe(true);
 expect(result.requiredPreconditions.map((p:any)=>p.kind)).toEqual(expect.arrayContaining(['source-context-bootstrap-and-external-coverage','migration-ledger-write-fence-required','data-effect-runtime-validation','session-search-path-realization','superuser-membership-branch']));
});
it('preserves the old source-only contract exactly when context is omitted',()=>{
 const expected=JSON.parse(read('docs/integrations/phone/F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json').toString());
 expect(deriveEffectiveContract(sources())).toEqual(expected);
});
it('rejects caller supplied context booleans and serialized context copies',()=>{
 expect(()=>deriveEffectiveContract(sources(),{referenceContext:{verified:true}})).toThrow();
 expect(()=>deriveEffectiveContract(sources(),{referenceContext:JSON.parse(JSON.stringify(createSourceReferenceContext(inputs())))})).toThrow();
});
it.each(['bootstrapSource','bootstrapCompiled','pgcryptoSql','pgcryptoControl'])('rejects tampered exact dependency: %s',key=>{
 const b=inputs();(b as any)[key]=Buffer.concat([(b as any)[key],Buffer.from('\n')]);expect(()=>createSourceReferenceContext(b)).toThrow();
});
it('retains immutable dependency snapshots after input buffer mutation',()=>{
 const b=inputs(),ctx=createSourceReferenceContext(b);for(const value of Object.values(b))value.fill(0);
 expect(deriveEffectiveContract(sources(),{referenceContext:ctx}).functions.filter((f:any)=>f.nativeSource)).toHaveLength(36);
});
it('does not apply contextual resolutions to changed or foreign statements',()=>{
 const src=sources();src[11].bytes=Buffer.concat([src[11].bytes,Buffer.from('\nINSERT INTO public.plans DEFAULT VALUES;')]);
 const result=deriveEffectiveContract(src,{referenceContext:createSourceReferenceContext(inputs())});
 expect(result.unresolved.some((u:any)=>u.reason==='data-dependent-precondition')).toBe(true);
});
it('keeps all native and bootstrap objects in ordered collection ACL effects',()=>{
 const result=deriveEffectiveContract(sources(),{referenceContext:createSourceReferenceContext(inputs())});
 const objects=result.effectiveAclCandidate.objects;
 expect(objects.find((o:any)=>o.name==='public.schema_migrations').acl.some((a:any)=>a.grantee==='thaara_app'&&a.privilege==='UPDATE')).toBe(true);
 expect(objects.filter((o:any)=>o.kind==='function'&&o.acl.some((a:any)=>a.grantee==='PUBLIC'&&a.privilege==='EXECUTE')).length).toBe(0);
});
it.each(['pg_catalog','information_schema','foreign_schema'])('does not declare unmodeled collection coverage complete: %s',schema=>{
 const src=sources();src[13].bytes=Buffer.concat([src[13].bytes,Buffer.from(`\nREVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ${schema} FROM PUBLIC;`)]);
 expect(deriveEffectiveContract(src,{referenceContext:createSourceReferenceContext(inputs())}).unresolved.some((u:any)=>u.reason==='acl-effective-grantor-unverified')).toBe(true);
});
