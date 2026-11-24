import {it,expect} from 'vitest';
import fs from 'node:fs';
import {deriveEffectiveContract} from './phone-schema-effective-contract.mjs';
function inputs(first:string,second=''){return Array.from({length:14},(_,i)=>({path:`source-${i}.sql`,bytes:Buffer.from(i===0?first:i===1?second:'-- no changes\n')}));}
it('binds every precondition evidence requirement to fresh ordered source derivation without claiming verification',async()=>{
 const {createHash}=await import('node:crypto');const {fingerprint}=await import('./phone-inbound-expected-schema.mjs');
 const path='docs/integrations/phone/F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json',bytes=fs.readFileSync(path),saved=JSON.parse(bytes.toString());
 const artifact=JSON.parse(fs.readFileSync('docs/integrations/phone/F03_PRECONDITION_EVIDENCE_REQUIREMENTS_2026-11-05.json','utf8'));
 expect(artifact.sourceContractSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
 const actual=deriveEffectiveContract(saved.sources.map((s:any)=>({path:s.path,bytes:fs.readFileSync(s.path)}))),conditions=actual.admissionConditions.filter((x:any)=>x.kind==='precondition');
 expect(actual.statementCount).toBe(864);expect(conditions).toHaveLength(269);
 expect(artifact.requirements.map((x:any)=>x.id)).toEqual(conditions.map((x:any)=>x.id));
 for(let i=0;i<conditions.length;i++){const r=artifact.requirements[i];expect(r.conditionSha256).toBe(fingerprint(conditions[i].condition));expect(r.status).toBe('NOT VERIFIED');expect(r.rowDataPermitted).toBe(false);expect(r.requiredEvidence.length).toBeGreaterThan(20);}
 expect(artifact.expectedCatalog).toBeNull();expect(artifact.productionAdmission).toBe(false);expect(artifact.executionAuthorized).toBe(false);expect(artifact.unresolvedEffects).toHaveLength(actual.unresolved.length);
});
it('folds sequential function replacement, owner changes and policy role changes without losing definitions',()=>{
 const a='CREATE TABLE public.t(id uuid NOT NULL, CONSTRAINT pk PRIMARY KEY(id)); CREATE FUNCTION public.f(p_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$; CREATE POLICY p ON public.t USING (id IS NOT NULL) WITH CHECK (id IS NOT NULL);';
 const b='CREATE OR REPLACE FUNCTION public.f(p_id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$; ALTER FUNCTION public.f(uuid) OWNER TO guard; ALTER TABLE public.t ENABLE ROW LEVEL SECURITY; ALTER TABLE public.t FORCE ROW LEVEL SECURITY; ALTER POLICY p ON public.t TO app;';
 const r=deriveEffectiveContract(inputs(a,b));expect(r.unresolved).toEqual([]);expect(r.functions).toHaveLength(1);expect(r.functions[0].owner).toBe('guard');expect(r.functions[0].definition).toContain('SELECT false');expect(r.policies[0].roles).toEqual(['app']);expect(r.policies[0].using).toContain('id IS NOT NULL');expect(r.tables[0]).toMatchObject({rls:true,forceRls:true});expect(r.executionAuthorized).toBe(false);
});
it('folds add/drop/default/not-null and named constraints in source order',()=>{
 const r=deriveEffectiveContract(inputs('CREATE TABLE t(id uuid, CONSTRAINT old CHECK(true));','ALTER TABLE t ADD COLUMN IF NOT EXISTS n integer, ADD COLUMN IF NOT EXISTS label text; ALTER TABLE t ALTER COLUMN n SET DEFAULT 2; ALTER TABLE t ALTER COLUMN n SET NOT NULL; ALTER TABLE t DROP CONSTRAINT IF EXISTS old; ALTER TABLE t ADD CONSTRAINT fresh CHECK(n>0);'));
 expect(r.unresolved).toEqual([]);expect(r.tables[0].columns.map((c:any)=>c.name)).toEqual(['id','n','label']);expect(r.tables[0].columns[1]).toMatchObject({default:'2',notNull:true});expect(r.tables[0].constraints.map((c:any)=>c.name)).toEqual(['fresh']);
});
it('preserves full parenthesized column defaults instead of dropping expression arguments',()=>{
 const r=deriveEffectiveContract(inputs("CREATE TABLE t(id uuid DEFAULT gen_random_uuid(), payload jsonb DEFAULT jsonb_build_object('x', 1) NOT NULL);"));
 expect(r.tables[0].columns[0].default).toBe('gen_random_uuid()');expect(r.tables[0].columns[1].default).toBe("jsonb_build_object('x', 1)");
});
it('drops old function signatures/policies/triggers and retains exact index/trigger definitions',()=>{
 const r=deriveEffectiveContract(inputs('CREATE TABLE t(id uuid); CREATE FUNCTION f(id uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$; CREATE POLICY p ON t USING(true); CREATE INDEX idx ON t(id); CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();','DROP FUNCTION IF EXISTS f(uuid); DROP POLICY IF EXISTS p ON t; DROP TRIGGER IF EXISTS tr ON t;'));
 expect(r.unresolved).toEqual([]);expect(r.functions).toEqual([]);expect(r.policies).toEqual([]);expect(r.triggers).toEqual([]);expect(r.indexes[0].definition).toContain('CREATE INDEX idx');
});
it('resolves an unqualified index name in its table schema and rejects unknown policy modes',()=>{
 const r=deriveEffectiveContract(inputs('CREATE TABLE platform.t(id uuid); CREATE INDEX ix ON platform.t(id); CREATE POLICY p ON platform.t AS imaginary USING(true);'));
 expect(r.indexes[0].name).toBe('platform.ix');expect(r.unresolved).toHaveLength(1);
});
it('never assumes DO or helper calls are assertion-only and never silently approves ACL grantors',()=>{
 const r=deriveEffectiveContract(inputs('DO $$ BEGIN CREATE ROLE app; END $$; SELECT pg_temp.assert_rls(\'t\'); GRANT SELECT ON TABLE public.t TO app;'));
 expect(r.unresolved.map((x:any)=>x.reason)).toEqual(expect.arrayContaining(['procedural-block','helper-body-not-pinned','acl-effective-grantor-unverified']));expect(r.expectedCatalog).toBeNull();expect(r.executionAuthorized).toBe(false);
});
it('rejects unresolved or unknown DDL instead of returning an approved contract',()=>{
 const r=deriveEffectiveContract(inputs('CREATE VIEW v AS SELECT 1; ALTER TABLE missing ENABLE ROW LEVEL SECURITY;'));
 expect(r.unresolved.length).toBe(2);expect(r.productionAdmission).toBe(false);expect(r.staticResolutionComplete).toBe(false);
});
it.each(['INHERITS (parent)','PARTITION BY HASH(id)','WITH (fillfactor=70)','TABLESPACE fast','JUNK'])('does not accept unmodeled CREATE TABLE suffix: %s',tail=>{
 const r=deriveEffectiveContract(inputs(`CREATE TABLE t(id uuid) ${tail};`));expect(r.unresolved).toHaveLength(1);expect(r.tables).toEqual([]);expect(r.staticResolutionComplete).toBe(false);
});
it.each(['id text','id uuid'])('records conditional existence without assuming a matching definition: %s',definition=>{
 const r=deriveEffectiveContract(inputs('CREATE TABLE t(id uuid);',`CREATE TABLE IF NOT EXISTS t(${definition});`));expect(r.unresolved).toHaveLength(1);expect(r.tables).toHaveLength(1);expect(r.tables[0].definition).toContain('id uuid');
});
it.each([
 ['CREATE TABLE t(id uuid);','ALTER TABLE t ADD COLUMN IF NOT EXISTS id text;'],
 ['CREATE TABLE t(id uuid); CREATE INDEX idx ON t(id);','CREATE INDEX IF NOT EXISTS idx ON t(id);'],
 ['CREATE SCHEMA s;','CREATE SCHEMA IF NOT EXISTS s;']
])('does not silently adopt existing conditional column/index/schema state', (initial,next)=>{
 const r=deriveEffectiveContract(inputs(initial,next));expect(r.unresolved).toHaveLength(1);expect(r.unresolved[0].reason).toBe('conditional-object-exists');
});
it.each([
 'ALTER TABLE t OWNER TO guard JUNK;',
 'ALTER TABLE t DROP CONSTRAINT IF EXISTS pk CASCADE;',
 'CREATE FUNCTION f() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$ JUNK;',
 'ALTER FUNCTION f() OWNER TO guard JUNK;',
 'DROP FUNCTION IF EXISTS f() CASCADE;',
 'CREATE INDEX idx ON t(id) JUNK;',
 'CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f() JUNK;',
 'DROP TRIGGER IF EXISTS tr ON t CASCADE;',
 'DROP POLICY IF EXISTS p ON t CASCADE;',
 'CREATE SCHEMA s JUNK;',
 'ALTER SCHEMA s OWNER TO guard JUNK;',
 'CREATE ROLE guard NOLOGIN JUNK;',
 'SET ROLE guard;',
 'BEGIN JUNK;',
 'CREATE POLICY pp ON t TO app JUNK USING(true);'
])('fully consumes supported DDL/control or records unresolved: %s',statement=>{
 const initial='CREATE TABLE t(id uuid, CONSTRAINT pk PRIMARY KEY(id)); CREATE FUNCTION f() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$; CREATE POLICY p ON t USING(true); CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f(); CREATE SCHEMA s;';
 const r=deriveEffectiveContract(inputs(initial,statement));expect(r.unresolved).toHaveLength(1);expect(r.tables[0].owner).toBe('postgres');expect(r.functions).toHaveLength(1);expect(r.functions[0].owner).toBe('postgres');expect(r.policies).toHaveLength(1);expect(r.triggers).toHaveLength(1);
});
it('does not retain partial prefix mutations from an unresolved multi-action statement',()=>{
 const r=deriveEffectiveContract(inputs('CREATE TABLE t(id uuid);','ALTER TABLE t ENABLE ROW LEVEL SECURITY, OWNER TO guard JUNK;'));
 expect(r.unresolved).toHaveLength(1);expect(r.tables[0].rls).toBe(false);expect(r.tables[0].owner).toBe('postgres');
});
it('keeps function overloads distinct and resolves IN/OUT/default parameter identities',()=>{
 const r=deriveEffectiveContract(inputs('CREATE FUNCTION f(IN p uuid, OUT result boolean) LANGUAGE sql AS $$ SELECT true $$; CREATE FUNCTION f(p text DEFAULT \'x\') RETURNS boolean LANGUAGE sql AS $$ SELECT true $$; ALTER FUNCTION f(text) OWNER TO guard;'));
 expect(r.unresolved).toEqual([]);expect(r.functions.map((f:any)=>f.signature)).toEqual(['public.f(text)','public.f(uuid)']);expect(r.functions[0].owner).toBe('guard');
});
it('fully recognizes named parameters even when their name is also a type keyword',()=>{
 const r=deriveEffectiveContract(inputs('CREATE FUNCTION f(text uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$; ALTER FUNCTION f(uuid) OWNER TO guard;'));
 expect(r.unresolved).toEqual([]);expect(r.functions[0]).toMatchObject({signature:'public.f(uuid)',owner:'guard'});
});
it('rejects unsupported argument suffixes rather than creating a fictitious overload',()=>{
 const r=deriveEffectiveContract(inputs('CREATE FUNCTION f(p uuid JUNK) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;'));
 expect(r.unresolved).toHaveLength(1);expect(r.functions).toEqual([]);
});
it('snapshots input bytes and does not mutate caller-owned sources',()=>{
 const sources=inputs('CREATE TABLE t(id uuid);'),before=sources.map(s=>s.bytes.toString('hex'));const r=deriveEffectiveContract(sources);sources[0].bytes.fill(0);expect(r.tables[0].name).toBe('public.t');expect(r.sources[0].sha256).toMatch(/^[a-f0-9]{64}$/);expect(before[1]).toBe(sources[1].bytes.toString('hex'));
});
it('reproduces the saved14-source effective candidate from exact source bytes',()=>{
 const candidate=JSON.parse(fs.readFileSync('docs/integrations/phone/F03_EFFECTIVE_SOURCE_CONTRACT_2026-11-04.json','utf8'));
 const sources=candidate.sources.map((s:any)=>({path:s.path,bytes:fs.readFileSync(s.path)}));expect(deriveEffectiveContract(sources)).toEqual(candidate);
 expect(candidate.sources).toHaveLength(14);expect(candidate.statementCount).toBe(864);expect(candidate.expectedCatalog).toBeNull();expect(candidate.unresolved.length).toBeGreaterThan(0);
 expect(candidate.helperEffects).toHaveLength(245);expect(candidate.requiredPreconditions.length).toBeGreaterThan(0);
 const order=new Map(candidate.sources.map((s:any,i:number)=>[s.path,i]));const positions=candidate.helperEffects.map((x:any)=>Number(order.get(x.path))*1000+x.ordinal);expect([...positions].sort((a:number,b:number)=>a-b)).toEqual(positions);
 const phone=candidate.tables.find((t:any)=>t.name==='public.phone_inbound_call_events');expect(phone.rls).toBe(true);expect(phone.forceRls).toBe(true);
 const p=candidate.policies.find((p:any)=>p.name==='phone_inbound_call_events_owner');expect(p.roles).toEqual(['thaara_app']);expect(p.using).toContain('current_authenticated_scope');
 expect(candidate.functions.find((f:any)=>f.signature==='public.phone_inbound_append_event(jsonb)').owner).toBe('thaara_phone_guard');
});
