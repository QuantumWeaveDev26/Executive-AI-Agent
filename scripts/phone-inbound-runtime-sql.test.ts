import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deriveInboundRuntimeSql,INBOUND_SQL_SOURCES} from './phone-inbound-runtime-sql.mjs';
const read=(step:112|113)=>readFileSync(INBOUND_SQL_SOURCES[step].path,'utf8');
for(const step of [112,113] as const){
 it(`derives ${step} runtime candidate with only the reviewed approval-gate change`,()=>{
  const source=read(step),candidate=deriveInboundRuntimeSql(step,source);
  expect(candidate).toContain("current_database() IS DISTINCT FROM 'thaara_phone113_review'");
  expect(candidate).toContain("IS DISTINCT FROM 'isolated-runtime-only'");
  expect(candidate).toContain(`thaara.step${step}_runtime_review_approved`);
  expect(candidate).not.toContain("IS DISTINCT FROM 'in-memory-only'");
  const originalBody=source.slice(source.indexOf(' IF to_reg'));
  expect(candidate.slice(candidate.indexOf(' IF to_reg'))).toBe(originalBody);
  expect(createHash('sha256').update(read(step)).digest('hex')).toBe(INBOUND_SQL_SOURCES[step].sha256);
 });
 it(`refuses changed ${step} source rather than adapting unreviewed SQL`,()=>{
  expect(()=>deriveInboundRuntimeSql(step,read(step)+'\n-- changed')).toThrow('INBOUND_RUNTIME_SQL_SOURCE_CHANGED');
 });
}
it('rejects unsupported schema identifiers',()=>{expect(()=>deriveInboundRuntimeSql(110 as never,'')).toThrow('INBOUND_RUNTIME_SQL_STEP_INVALID');});
