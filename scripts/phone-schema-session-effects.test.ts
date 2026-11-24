import {it,expect} from 'vitest';
import fs from 'node:fs';
import {sqlStatementEvidence} from './phone-schema-source-evidence.mjs';
import {createSourceSessionState} from './phone-schema-session-effects.mjs';
// The reducer supplies its own lexer; this fixture deliberately preserves punctuation.
const tokens=(sql:string)=>(sql.match(/[A-Za-z_][A-Za-z_0-9$]*|[^\s]/g)??[]).map(value=>({value,word:value.toLowerCase()}));
const ref={path:'source.sql',ordinal:1,sha256:'a'.repeat(64)};
const apply=(s:any,sql:string)=>s.apply(tokens(sql),ref);
it('models all three exact source statements without asserting execution or transaction proof',()=>{
 const paths=['packages/db/src/migrations/0012_task004_governed_capabilities_and_personas.sql','docs/migrations/112h-phone-inbound-events.hosted-review.sql','docs/migrations/113h-phone-inbound-principals.hosted-review.sql'];
 for(const path of paths){
  const s=createSourceSessionState();const statements=sqlStatementEvidence(fs.readFileSync(path)).statements;
  for(const statement of statements){const text=statement.text.replace(/--[^\n]*(?:\n|$)/g,'').trim().replace(/;$/,'');
   if(/^BEGIN$/i.test(text))apply(s,text);
   if(/^SET LOCAL search_path/i.test(text)){
    const e=apply(s,text);expect(e).toMatchObject({kind:'local-search-path',sourceModeled:true,verified:false});
    expect(e.searchPath).toEqual(path.includes('0012')?['pg_catalog','public','pg_temp']:['pg_catalog']);
    expect(e.transactionContext).toBe(path.includes('0012')?'external-required':'source-begin');
    expect(e.conditions).toContainEqual(expect.objectContaining({kind:'session-search-path-transaction-context',verified:false}));
   }
  }
 }
});
it('resets LOCAL state at COMMIT, and a later SET LOCAL outside a transaction has no effect',()=>{
 const s=createSourceSessionState();apply(s,'BEGIN');apply(s,'SET LOCAL search_path = pg_catalog');
 expect(s.snapshot().localSearchPath).toEqual(['pg_catalog']);apply(s,'COMMIT');
 expect(s.snapshot()).toMatchObject({transaction:'outside',localSearchPath:null});
 const effect=apply(s,'SET LOCAL search_path TO pg_catalog');expect(effect.applies).toBe(false);
 expect(effect.blockers).toEqual(['local-search-path-outside-transaction']);expect(s.snapshot().localSearchPath).toBeNull();
 apply(s,'BEGIN');expect(s.snapshot().localSearchPath).toBeNull();
});
it('keeps initial unknown transaction context conditional and replaces a local value only within that context',()=>{
 const s=createSourceSessionState();const e=apply(s,'SET LOCAL search_path=pg_catalog,public,pg_temp');
 expect(e.applies).toBe('conditional');expect(e.conditions[0]).toMatchObject({transactionContext:'external-required',verified:false});
 apply(s,'SET LOCAL search_path=pg_catalog');expect(s.snapshot().localSearchPath).toEqual(['pg_catalog']);
 expect(s.snapshot().transaction).toBe('external-required');apply(s,'COMMIT');expect(s.snapshot().localSearchPath).toBeNull();
});
it('does not mistake a repeated BEGIN for a new transaction or reset its local value',()=>{
 const s=createSourceSessionState();apply(s,'BEGIN');apply(s,'SET LOCAL search_path=pg_catalog');
 const e=apply(s,'BEGIN');expect(e.blockers).toEqual(['nested-source-begin']);expect(s.snapshot().localSearchPath).toEqual(['pg_catalog']);
});
it.each(['SET search_path=pg_catalog','SET SESSION search_path=pg_catalog','SET LOCAL search_path=public,pg_catalog','SET LOCAL search_path=pg_catalog,evil','SET LOCAL search_path=pg_catalog,public','SET LOCAL search_path=pg_catalog,','SET LOCAL search_path=pg_catalog JUNK','SET LOCAL search_path=pg_catalog; SELECT 1','SET LOCAL search_path=DEFAULT','BEGIN WORK','COMMIT AND CHAIN','ROLLBACK TO SAVEPOINT x'])('fails closed without partial mutation: %s',sql=>{
 const s=createSourceSessionState();apply(s,'BEGIN');apply(s,'SET LOCAL search_path=pg_catalog');const before=s.snapshot();
 expect(()=>apply(s,sql)).toThrow('SESSION_MODEL_DENIED');expect(s.snapshot()).toEqual(before);
});
it('returns detached snapshots and conditions',()=>{
 const s=createSourceSessionState();apply(s,'BEGIN');const e=apply(s,'SET LOCAL search_path=pg_catalog');
 e.searchPath[0]='evil';s.snapshot().localSearchPath[0]='evil';expect(s.snapshot().localSearchPath).toEqual(['pg_catalog']);
});
it.each(['SET LOCAL search_path=pg_cata log','SET LOCAL search_path=pg_catalog,pu blic,pg_temp'])('does not merge adjacent identifiers into a supported namespace: %s',sql=>{
 const s=createSourceSessionState();expect(()=>apply(s,sql)).toThrow('SESSION_MODEL_DENIED');
});
