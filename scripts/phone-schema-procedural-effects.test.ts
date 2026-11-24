import {it,expect} from 'vitest';
import {deriveEffectiveContract} from './phone-schema-effective-contract.mjs';
import fs from 'node:fs';
import {sqlStatementEvidence} from './phone-schema-source-evidence.mjs';
const inputs=(s:string)=>Array.from({length:14},(_,i)=>({path:`proc-${i}.sql`,bytes:Buffer.from(i?'-- empty\n':s)}));
const make="DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app') THEN CREATE ROLE app WITH NOLOGIN; END IF; END $$;";
it('classifies every original procedural body while keeping source assertion and external evidence blocking',()=>{
 const prior=JSON.parse(fs.readFileSync('docs/integrations/phone/F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json','utf8'));
 const r=deriveEffectiveContract(prior.sources.map((s:any)=>({path:s.path,bytes:fs.readFileSync(s.path)})));
 expect(r.proceduralEffects).toHaveLength(30);expect(r.unresolved.filter((x:any)=>x.reason==='procedural-block')).toEqual([]);
 expect(r.requiredPreconditions.filter((x:any)=>x.kind==='source-assertion-program')).toHaveLength(13);
 expect(r.requiredPreconditions.every((x:any)=>x.verified!==true)).toBe(true);expect(r.expectedCatalog).toBeNull();
 expect(r.roles.map((x:any)=>x.name)).toContain('thaara_definer');expect(r.roles.map((x:any)=>x.name)).toContain('thaara_platform_owner');
});
it('does not reuse assertion classification after exact original source bytes change',()=>{
 const path='packages/db/src/migrations/0003_plans_and_receipts.sql';
 const s=sqlStatementEvidence(fs.readFileSync(path)).statements.find(x=>x.ordinal===7)!;
 const src=inputs(s.text.replace('approval_requests','evil'));src[0].path=path;
 const r=deriveEffectiveContract(src);expect(r.proceduralEffects).toEqual([]);expect(r.unresolved).toHaveLength(1);
});
it('rejects a changed body at the same original source position',()=>{
 const saved=JSON.parse(fs.readFileSync('docs/integrations/phone/F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json','utf8'));
 const path='packages/db/src/migrations/0003_plans_and_receipts.sql';
 const src=saved.sources.map((s:any)=>({path:s.path,bytes:fs.readFileSync(s.path)}));
 const item=src.find((s:any)=>s.path===path),statement=sqlStatementEvidence(item.bytes).statements.find(x=>x.ordinal===7)!;
 item.bytes=Buffer.from(item.bytes.toString('utf8').replace(statement.text,()=>statement.text.replace('approval_requests','evil')));
 const r=deriveEffectiveContract(src);expect(r.proceduralEffects).toHaveLength(29);expect(r.unresolved.some((u:any)=>u.path===path&&u.ordinal===7&&u.reason==='procedural-block')).toBe(true);
});
it('models conditional role creation followed by conditional ACLs in original order',()=>{
 const r=deriveEffectiveContract(inputs(make+" DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='app') THEN GRANT SELECT ON TABLE t TO app; REVOKE UPDATE ON TABLE t FROM app; END IF; END; $$;"));
 expect(r.roles.map((x:any)=>x.name)).toContain('app');expect(r.proceduralEffects).toHaveLength(2);
 expect(r.aclEffects.map((x:any)=>x.action)).toEqual(['grant','revoke']);
 expect(r.requiredPreconditions.some((x:any)=>x.kind==='initial-role-absence')).toBe(true);
 expect(r.productionAdmission).toBe(false);
});
it('does not recreate an existing source-defined role or change its flags',()=>{
 const r=deriveEffectiveContract(inputs(make+make));expect(r.roles).toHaveLength(1);expect(r.proceduralEffects).toHaveLength(2);
 expect(r.roles[0].definition).toContain('NOLOGIN');
});
it('models conditional named constraints but preserves the global absence and row-validation obligations',()=>{
 const r=deriveEffectiveContract(inputs("CREATE TABLE t(id uuid); DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='checked') THEN ALTER TABLE public.t ADD CONSTRAINT checked CHECK(id IS NOT NULL); END IF; END; $$;"));
 expect(r.tables[0].constraints).toEqual([expect.objectContaining({name:'checked'})]);
 expect(r.requiredPreconditions.map((x:any)=>x.kind)).toEqual(['global-constraint-name-absence','constraint-data-validation','source-to-pg16-semantic-realization','public-namespace-bootstrap-contract']);
 expect(r.proceduralEffects[0].kind).toBe('conditional-constraint');
});
it('rejects adoption when a globally named conditional constraint already exists',()=>{
 const r=deriveEffectiveContract(inputs("CREATE TABLE other(id uuid, CONSTRAINT checked CHECK(true)); CREATE TABLE t(id uuid); DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='checked') THEN ALTER TABLE public.t ADD CONSTRAINT checked CHECK(false); END IF; END; $$;"));
 expect(r.tables.find((x:any)=>x.name==='public.t').constraints).toEqual([]);expect(r.proceduralEffects).toEqual([]);expect(r.unresolved).toHaveLength(1);
});
it.each([
 "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='app') THEN CREATE ROLE other NOLOGIN; END IF; END $$;",
 "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='app') THEN CREATE ROLE app NOLOGIN; EXECUTE 'evil'; END IF; END $$;",
 "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='unknown') THEN GRANT SELECT ON t TO unknown; END IF; END $$;",
 "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname='app') THEN CREATE ROLE app NOLOGIN; END IF; END JUNK $$;"
])('rejects unmodeled procedural bodies atomically',s=>{
 const r=deriveEffectiveContract(inputs(s));expect(r.proceduralEffects).toEqual([]);expect(r.roles).toEqual([]);expect(r.aclEffects).toEqual([]);expect(r.unresolved).toHaveLength(1);
});
