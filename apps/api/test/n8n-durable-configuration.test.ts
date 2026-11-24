import { afterEach,describe,it,expect,vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PostgresDatabase } from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { createDurableN8nTestDependency,verifiedDurableN8nOptions } from '../src/services/n8n-durable-test.js';
import { ConnectorEnvelopeCipher } from '../src/services/connector-security.js';
import { MockConnectorKeys } from './helpers/durable-connector.js';
import { buildApp } from '../src/app.js';
const baseUrl='postgresql://thaara_app:synthetic-only@127.0.0.1:15432/thaara_step74_test';
const env={THAARA_TEST_MODE:'step74',THAARA_TEST_DATABASE_URL:baseUrl,
 THAARA_TEST_MIGRATION_DATABASE_URL:baseUrl.replace('thaara_app:','postgres:'),
 THAARA_TEST_BOOTSTRAP_DATABASE_URL:baseUrl.replace('thaara_app:','postgres:'),
 THAARA_TEST_WORKER_DATABASE_URL:baseUrl.replace('thaara_app:','thaara_worker_user:'),
 THAARA_TEST_REDIS_URL:'redis://:synthetic-only@127.0.0.1:16379/0'};
const identity={db:'thaara_step74_test',actor:'thaara_app',elevated:false,can_read:true,can_commit:true,forced_rls_tables:2,direct_table_access:false};
function input(extra:any={}){return {config:loadConfig({NODE_ENV:'test',DATABASE_URL:baseUrl}),testEnvironment:env,profiles:[],
 cipher:new ConnectorEnvelopeCipher(new MockConnectorKeys(new Map([['test-key-v1',randomBytes(32)]]))),resolveProfileSecret:async()=> 'SYNTHETIC-ONLY',...extra};}
afterEach(()=>vi.restoreAllMocks());
describe('Step82 durable dependency admission (mocked probe; no sockets)',()=>{
 it.each(['development','production'] as const)('rejects %s before any database probe',async NODE_ENV=>{
  const probe=vi.spyOn(PostgresDatabase.prototype,'query');
  await expect(createDurableN8nTestDependency(input({config:{...input().config,NODE_ENV}}))).rejects.toThrow('verified isolated');
  expect(probe).not.toHaveBeenCalled();
 });
 it.each([
  {THAARA_TEST_MODE:undefined},
  {THAARA_TEST_DATABASE_URL:baseUrl.replace(':15432',':5432')},
  {THAARA_TEST_DATABASE_URL:baseUrl.replace('thaara_step74_test','thaara_v2')},
  {THAARA_TEST_DATABASE_URL:baseUrl.replace('127.0.0.1','localhost')},
  {THAARA_TEST_DATABASE_URL:baseUrl+'?options=unsafe'}
 ])('rejects missing/unsafe isolation settings',async change=>{
  const probe=vi.spyOn(PostgresDatabase.prototype,'query');
  await expect(createDurableN8nTestDependency(input({testEnvironment:{...env,...change}}))).rejects.toThrow('verified isolated');
  expect(probe).not.toHaveBeenCalled();
 });
 it('rejects a mismatched application database URL without opening a pool connection',async()=>{
  const probe=vi.spyOn(PostgresDatabase.prototype,'query');
  await expect(createDurableN8nTestDependency(input({config:loadConfig({NODE_ENV:'test',DATABASE_URL:baseUrl.replace(':15432',':5432')})}))).rejects.toThrow('verified isolated');
  expect(probe).not.toHaveBeenCalled();
 });
 it.each([{elevated:undefined},{direct_table_access:undefined},{actor:'postgres'},{elevated:true},{forced_rls_tables:1},{can_commit:false},{can_read:false},{direct_table_access:true},{db:'thaara_v2'}])('fails closed on unsuitable database identity/security %j',async change=>{
  vi.spyOn(PostgresDatabase.prototype,'query').mockResolvedValue({rows:[{...identity,...change}]});
  await expect(createDurableN8nTestDependency(input())).rejects.toThrow('verified isolated');
 });
 it('brands a verified dependency and binds it to the exact app DB and config',async()=>{
  vi.spyOn(PostgresDatabase.prototype,'query').mockResolvedValue({rows:[identity]});
  const args=input(),dependency=await createDurableN8nTestDependency(args);
  try{
   expect(verifiedDurableN8nOptions(dependency,args.config,dependency.db).store.storage).toBe('postgres_durable');
   expect(()=>verifiedDurableN8nOptions(dependency,args.config,{} as any)).toThrow('verified isolated');
   expect(()=>verifiedDurableN8nOptions(dependency,{...args.config,NODE_ENV:'production'},dependency.db)).toThrow('verified isolated');
   expect(()=>verifiedDurableN8nOptions({...dependency} as any,args.config,dependency.db)).toThrow('verified isolated');
  }finally{await dependency.db.close();}
 });
 it('redacts connection failures instead of echoing credentials',async()=>{
  vi.spyOn(PostgresDatabase.prototype,'query').mockRejectedValue(Error('PRIVATE-CONNECTION-SECRET'));
  await expect(createDurableN8nTestDependency(input())).rejects.toThrow('verified isolated');
  try{await createDurableN8nTestDependency(input());}catch(error){expect(String(error)).not.toMatch(/PRIVATE-CONNECTION-SECRET|synthetic-only|postgresql:/);}
 });
 it('buildApp rejects a fabricated durable dependency before creating a runtime DB',async()=>{
  await expect(buildApp({config:input().config,n8nDurable:{} as any})).rejects.toThrow('verified isolated');
 });
});
