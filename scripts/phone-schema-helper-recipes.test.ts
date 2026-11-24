import {it,expect} from 'vitest';
import fs from 'node:fs';
import {deriveEffectiveContract} from './phone-schema-effective-contract.mjs';
const evidence=JSON.parse(fs.readFileSync('docs/integrations/phone/INBOUND_SCHEMA_COMPLETE_SOURCE_EVIDENCE_2026-11-04.json','utf8'));
const helper=(name:string)=>evidence.sources.flatMap((s:any)=>s.statements).find((s:any)=>s.text.includes(`CREATE OR REPLACE FUNCTION pg_temp.${name}(`)).text;
function run(ddl:string,names:string[],calls:string){const text=ddl+names.map(helper).join('')+calls;return deriveEffectiveContract(Array.from({length:14},(_,i)=>({path:`fixture-${i}.sql`,bytes:Buffer.from(i===0?text:'-- empty\n')})));}
it('models pinned RLS helper and records source order',()=>{
 const r=run('CREATE TABLE t(id uuid);',['assert_rls'],"SELECT pg_temp.assert_rls('t');");expect(r.unresolved).toEqual([]);expect(r.tables[0]).toMatchObject({rls:true,forceRls:true});expect(r.helperEffects[0].helper).toBe('assert_rls');expect(r.executionAuthorized).toBe(false);
});
it('preserves existing column default, models not-null strengthening and missing-column defaults',()=>{
 const r=run('CREATE TABLE t(id uuid, n integer DEFAULT 1);',['assert_column'],"SELECT pg_temp.assert_column('t','n','int4',true,'2'); SELECT pg_temp.assert_column('t','label','text',false,'''new''');");
 expect(r.unresolved).toEqual([]);expect(r.tables[0].columns.find((c:any)=>c.name==='n')).toMatchObject({default:'1',notNull:true});expect(r.tables[0].columns.find((c:any)=>c.name==='label').default).toBe("'new'");expect(r.requiredPreconditions.some((p:any)=>p.kind==='no-null-values')).toBe(true);
});
it('denies column type mismatch or missing required column without safe default',()=>{
 for(const call of ["SELECT pg_temp.assert_column('t','id','text',false);","SELECT pg_temp.assert_column('t','missing','uuid',true);"]){const r=run('CREATE TABLE t(id uuid);',['assert_column'],call);expect(r.unresolved).toHaveLength(1);expect(r.tables[0].columns).toHaveLength(1);}
});
it('recognizes an equivalent existing unique/primary key regardless of its name',()=>{
 const r=run('CREATE TABLE t(id uuid, CONSTRAINT original PRIMARY KEY(id));',['assert_unique'],"SELECT pg_temp.assert_unique('t','new_name',ARRAY['id']);");expect(r.unresolved).toEqual([]);expect(r.tables[0].constraints.map((c:any)=>c.name)).toEqual(['original']);
});
it('adds an ordered unique key only with explicit data precondition',()=>{
 const r=run('CREATE TABLE t(a uuid,b uuid);',['assert_unique'],"SELECT pg_temp.assert_unique('t','uq',ARRAY['b','a']);");expect(r.unresolved).toEqual([]);expect(r.tables[0].constraints[0].definition).toContain('b, a');expect(r.requiredPreconditions.some((p:any)=>p.kind==='no-duplicate-key-groups')).toBe(true);
});
it('models actual FK recipe RESTRICT creation even when the requested comparison action differs',()=>{
 const r=run('CREATE TABLE parent(id uuid PRIMARY KEY); CREATE TABLE t(id uuid);',['assert_fk'],"SELECT pg_temp.assert_fk('t','fk',ARRAY['id'],'parent',ARRAY['id'],'c');");expect(r.unresolved).toEqual([]);expect(r.tables.find((t:any)=>t.name==='public.t').constraints[0].definition).toContain('ON DELETE RESTRICT');expect(r.requiredPreconditions.some((p:any)=>p.kind==='no-orphan-key-rows')).toBe(true);
});
it('preserves an equivalent FK under another name and does not invent grantors',()=>{
 const r=run('CREATE TABLE parent(id uuid PRIMARY KEY); CREATE TABLE t(id uuid, CONSTRAINT original FOREIGN KEY(id) REFERENCES parent(id) ON DELETE RESTRICT);',['assert_fk'],"SELECT pg_temp.assert_fk('t','fk',ARRAY['id'],'parent',ARRAY['id']);");expect(r.unresolved).toEqual([]);expect(r.tables.find((t:any)=>t.name==='public.t').constraints[0].name).toBe('original');expect(r.expectedCatalog).toBeNull();
});
it('check recipe preserves a named existing check and models a missing check with NULL-aware condition',()=>{
 const r=run('CREATE TABLE t(id uuid, CONSTRAINT existing CHECK(id IS NOT NULL));',['assert_check'],"SELECT pg_temp.assert_check('t','existing','false'); SELECT pg_temp.assert_check('t','fresh','id IS NOT NULL');");expect(r.unresolved).toEqual([]);expect(r.tables[0].constraints[0].definition).toContain('id IS NOT NULL');expect(r.requiredPreconditions.find((p:any)=>p.kind==='no-false-expression-rows').nullIsViolation).toBe(false);
});
it('validates exact trigger name/procedure basename and rejects missing trigger',()=>{
 const ddl='CREATE TABLE t(id uuid); CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();';
 expect(run(ddl,['assert_trigger'],"SELECT pg_temp.assert_trigger('t','tr','f');").unresolved).toEqual([]);
 expect(run(ddl,['assert_trigger'],"SELECT pg_temp.assert_trigger('t','missing','f');").unresolved).toHaveLength(1);
});
it('does not execute or trust a changed helper body, unknown helper, nonliteral argument or trailing tokens',()=>{
 const changed=helper('assert_rls').replace('IF NOT v_rls THEN','IF true THEN');
 for(const text of [changed+"SELECT pg_temp.assert_rls('t');",helper('assert_rls')+"SELECT pg_temp.assert_rls(lower('t'));",helper('assert_rls')+"SELECT pg_temp.assert_rls('t') JUNK;","SELECT pg_temp.unknown('t');"]){
  const inputs=Array.from({length:14},(_,i)=>({path:`f-${i}.sql`,bytes:Buffer.from(i===0?'CREATE TABLE t(id uuid);'+text:'-- empty\n')}));const r=deriveEffectiveContract(inputs);expect(r.unresolved).toHaveLength(1);expect(r.tables[0].rls).toBe(false);
 }
});
it.each([
 ['assert_rls',"SELECT pg_temp.assert_rls('missing');"],
 ['assert_rls',"SELECT pg_temp.assert_rls('t',true);"],
 ['assert_column',"SELECT pg_temp.assert_column('t','new','uuid',true,'NULL; DROP TABLE t');"],
 ['assert_column',"SELECT pg_temp.assert_column('t','id','unsupported_type',true);"],
 ['assert_unique',"SELECT pg_temp.assert_unique('t','uq',ARRAY[]);"],
 ['assert_unique',"SELECT pg_temp.assert_unique('t','uq',ARRAY['id','id']);"],
 ['assert_unique',"SELECT pg_temp.assert_unique('t','uq',ARRAY['missing']);"],
 ['assert_fk',"SELECT pg_temp.assert_fk('t','fk',ARRAY['id'],'missing',ARRAY['id']);"],
 ['assert_fk',"SELECT pg_temp.assert_fk('t','fk',ARRAY['id'],'parent',ARRAY['id','id']);"],
 ['assert_fk',"SELECT pg_temp.assert_fk('t','fk',ARRAY['id'],'parent',ARRAY['missing']);"],
 ['assert_check',"SELECT pg_temp.assert_check('t','chk','true; DROP TABLE t');"],
 ['assert_trigger',"SELECT pg_temp.assert_trigger('t','tr','wrong');"]
])('fails closed on unsupported or failing %s inputs: %s',(name,call)=>{
 const ddl='CREATE TABLE parent(id uuid PRIMARY KEY); CREATE TABLE t(id uuid); CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$; CREATE TRIGGER tr BEFORE INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();';
 const r=run(ddl,[name],call);expect(r.unresolved).toHaveLength(1);expect(r.helperEffects).toEqual([]);expect(r.tables.find((t:any)=>t.name==='public.t').columns).toHaveLength(1);
});
it('replays helper effects before subsequent DDL rather than grouping calls after all DDL',()=>{
 const r=run('CREATE TABLE t(n integer NOT NULL);',['assert_column'],"SELECT pg_temp.assert_column('t','n','int4',true); ALTER TABLE t ALTER COLUMN n DROP NOT NULL;");
 expect(r.unresolved).toEqual([]);expect(r.tables[0].columns[0].notNull).toBe(false);
});
it('never reuses a cached recipe after a helper is replaced by an unpinned definition',()=>{
 const replaced=helper('assert_rls').replace('IF NOT v_rls THEN','IF true THEN');
 const r=run('CREATE TABLE t(id uuid); CREATE TABLE other(id uuid);',['assert_rls'],"SELECT pg_temp.assert_rls('t');"+replaced+"SELECT pg_temp.assert_rls('other');");
 expect(r.helperEffects).toHaveLength(1);expect(r.unresolved).toHaveLength(1);expect(r.tables.find((t:any)=>t.name==='public.other').rls).toBe(false);
});
it('does not reuse a helper after an intervening DROP FUNCTION',()=>{
 const r=run('CREATE TABLE t(id uuid);',['assert_rls'],"DROP FUNCTION IF EXISTS pg_temp.assert_rls(text); SELECT pg_temp.assert_rls('t');");
 expect(r.helperEffects).toEqual([]);expect(r.unresolved).toHaveLength(1);expect(r.tables[0].rls).toBe(false);
});
