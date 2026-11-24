import {describe,it,expect,vi} from 'vitest';
import {diagnosePhone110a,classifyPhoneFixtureError} from './phone-migration-diagnostic.mjs';
const context={backend_pid:42,review_acknowledged:true,target_matches:true,base_migration_count:12,scope_function_exists:true,audit_table_exists:true,contacts_already_exist:false,is_superuser:true};
const sql='BEGIN;\nSELECT test;\nCOMMIT;';
describe('110a diagnostic-only reporting, no database',()=>{
 it('captures SQLSTATE and source position without copying error messages, hints, details or credentials',async()=>{
  const secret='never-print-synthetic-password';
  const exec=vi.fn(async()=>{throw {code:'42601',position:'8',message:secret,detail:secret,hint:secret,where:secret,query:secret};});
  const db={query:vi.fn(async()=>({rows:[context]})),exec};
  const r=await diagnosePhone110a(db,sql);
  expect(r).toMatchObject({status:'failed',migration:'110a-phone-contacts.review.sql',phase:'migration',sqlstate:'42601',category:'syntax_error',sourceLine:2,context:{backendPid:42,baseMigrationCount:12}});
  expect(JSON.stringify(r)).not.toContain(secret);expect(exec).toHaveBeenCalledTimes(1);expect(exec).toHaveBeenCalledWith(sql);
 });
 it('does not run another migration or any tests when 110a fails or passes',async()=>{
  const db={query:vi.fn(async()=>({rows:[context]})),exec:vi.fn(async()=>{})};
  expect(await diagnosePhone110a(db,sql)).toMatchObject({status:'applied',migration:'110a-phone-contacts.review.sql',sqlstate:null});
  expect(db.exec).toHaveBeenCalledTimes(1);expect(db.query).toHaveBeenCalledTimes(2);
 });
 it('reports an acknowledgement failure without attempting migration SQL',async()=>{
  const db={query:vi.fn(async()=>{throw {code:'42501',message:'secret-token'};}),exec:vi.fn()};
  const r=await diagnosePhone110a(db,sql);expect(r).toMatchObject({status:'failed',phase:'acknowledgement',sqlstate:'42501',category:'insufficient_privilege'});
  expect(db.exec).not.toHaveBeenCalled();expect(JSON.stringify(r)).not.toContain('secret-token');
 });
 it('reports failure of the second query as context phase and never attempts migration SQL',async()=>{
  const db={query:vi.fn().mockResolvedValueOnce({rows:[]}).mockRejectedValueOnce({code:'42501',message:'synthetic-secret'}),exec:vi.fn()};
  const r=await diagnosePhone110a(db,sql);
  expect(r).toMatchObject({status:'failed',phase:'context',sqlstate:'42501',category:'insufficient_privilege'});
  expect(db.query).toHaveBeenCalledTimes(2);expect(db.exec).not.toHaveBeenCalled();expect(JSON.stringify(r)).not.toContain('synthetic-secret');
 });
 it('never invents SQLSTATE for client errors or echo malformed error fields',async()=>{
  const db={query:vi.fn(async()=>({rows:[context]})),exec:vi.fn(async()=>{throw {code:'postgresql://secret',message:'secret',position:'secret'};})};
  expect(await diagnosePhone110a(db,sql)).toMatchObject({status:'failed',sqlstate:null,category:'client_transport_or_runner_error',sourceLine:null});
 });
});

describe('allowlisted fixture diagnostics',()=>{
 it.each([
  [{code:'EPIPE',message:'synthetic-secret'},'broken_pipe'],
  [{code:'ECONNRESET',message:'synthetic-secret'},'connection_reset'],
  [{code:'ETIMEDOUT',message:'synthetic-secret'},'transport_timeout'],
  [{message:'Query read timeout'},'query_read_timeout'],
  [{message:'Connection terminated unexpectedly'},'connection_terminated_unexpectedly'],
  [{message:'Connection terminated due to connection timeout'},'connection_timeout'],
  [{message:'synthetic-secret',code:'TOKEN'},'client_transport_or_runner_error']
 ])('classifies known client errors without treating Node codes as SQLSTATE', (error,category)=>{
  expect(classifyPhoneFixtureError(error)).toEqual({sqlstate:null,category});
 });
 it('keeps PostgreSQL SQLSTATE and never copies raw exception metadata',()=>{
  expect(classifyPhoneFixtureError({code:'42601',message:'synthetic-secret',detail:'synthetic-secret'})).toEqual({sqlstate:'42601',category:'syntax_error'});
 });
 it('keeps a PostgreSQL code even if its message happens to equal a client-error phrase',()=>{
  expect(classifyPhoneFixtureError({code:'P0001',message:'Query read timeout'})).toEqual({sqlstate:'P0001',category:'raised_exception'});
 });
 it('bounds time measurements and never treats prototype keys as diagnostic categories',async()=>{
  expect(classifyPhoneFixtureError({code:'__proto__',message:'constructor'})).toEqual({sqlstate:null,category:'client_transport_or_runner_error'});
  let tick=0;const db={query:vi.fn(async()=>({rows:[context]})),exec:vi.fn(async()=>{})};
  expect(await diagnosePhone110a(db,sql,{now:()=>tick++*1000000000})).toMatchObject({elapsedMs:86400000});
 });
 it('records bounded elapsed time and sanitized pool counts without exposing arbitrary metadata',async()=>{
  const db={query:vi.fn(async()=>({rows:[context]})),exec:vi.fn(async()=>{})};let tick=10;
  const r=await diagnosePhone110a(db,sql,{now:()=>tick+=5,getPoolCounts:()=>({totalCount:1,idleCount:0,waitingCount:0,password:'synthetic-secret'})});
  expect(r).toMatchObject({elapsedMs:5,poolCounts:{totalCount:1,idleCount:0,waitingCount:0}});expect(JSON.stringify(r)).not.toContain('synthetic-secret');
 });
});
