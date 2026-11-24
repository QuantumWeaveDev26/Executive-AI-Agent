import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {deriveInboundInstallDraft,verifyInboundInstallDraft,INBOUND_INSTALL_DRAFTS} from './phone-inbound-install-draft.mjs';
import {INBOUND_SQL_SOURCES} from './phone-inbound-runtime-sql.mjs';
for(const step of [112,113] as const){
 it(`preserves step${step} schema/privileges and blocks before any DDL`,()=>{
  const source=readFileSync(INBOUND_SQL_SOURCES[step].path,'utf8'),draft=deriveInboundInstallDraft(step,source),boundary=source.indexOf(' IF to_reg');
  expect(draft.slice(draft.indexOf(' IF to_reg'))).toBe(source.slice(boundary));
  expect(draft).toContain("DO $$ BEGIN\n RAISE EXCEPTION 'Inbound production install draft is disabled; target-specific approval required';");
  expect(draft.indexOf('RAISE EXCEPTION')).toBeLessThan(draft.indexOf('CREATE TABLE'));
  expect(verifyInboundInstallDraft(step,source,draft)).toMatchObject({executionAllowed:false,schemaBodyUnchanged:true});
  expect(INBOUND_INSTALL_DRAFTS[step]).not.toBe(INBOUND_SQL_SOURCES[step].candidate);
 });
 it(`rejects altered source or removal of step${step} blocking gate`,()=>{
  const source=readFileSync(INBOUND_SQL_SOURCES[step].path,'utf8'),draft=deriveInboundInstallDraft(step,source);
  expect(()=>deriveInboundInstallDraft(step,source+'\n')).toThrow();
  expect(()=>verifyInboundInstallDraft(step,source,draft.replace(" RAISE EXCEPTION 'Inbound production install draft is disabled; target-specific approval required';\n",''))).toThrow();
 });
}
it('rejects unexpected migration identifiers',()=>{expect(()=>deriveInboundInstallDraft(110,'')).toThrow();});
