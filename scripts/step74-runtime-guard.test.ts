import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { getIsolatedRuntimeConfig, isolatedRoleUrl, childEnvironment, withoutCommandOutput } from './step74-runtime-guard.mjs';

const password='a'.repeat(64);
function settings() {
  const pg=(user:string)=>'postgresql://'+user+':'+password+'@127.0.0.1:15432/thaara_step74_test';
  return {
    THAARA_TEST_MODE:'step74',
    THAARA_TEST_DATABASE_URL:pg('thaara_app'),
    THAARA_TEST_MIGRATION_DATABASE_URL:pg('postgres'),
    THAARA_TEST_BOOTSTRAP_DATABASE_URL:pg('postgres'),
    THAARA_TEST_WORKER_DATABASE_URL:pg('thaara_worker_user'),
    THAARA_TEST_REDIS_URL:'redis://:'+password+'@127.0.0.1:16379/0'
  } as Record<string,string>;
}
describe('Step 74 isolated runtime connection guards (no services used)',()=>{
  it('accepts only explicit test settings and exposes the expected database',()=>{
    expect(getIsolatedRuntimeConfig(settings())).toMatchObject({databaseName:'thaara_step74_test',host:'127.0.0.1',port:'15432'});
  });
  it.each(Object.keys(settings()))('rejects missing %s',key=>{
    const env=settings();delete env[key];
    expect(()=>getIsolatedRuntimeConfig(env)).toThrow(/isolation/i);
  });
  it.each([
    ['THAARA_TEST_MIGRATION_DATABASE_URL','postgresql://postgres:private@127.0.0.1:5432/thaara_step74_test'],
    ['THAARA_TEST_DATABASE_URL','postgresql://thaara_app:private@127.0.0.1:15432/thaara_v2'],
    ['THAARA_TEST_REDIS_URL','redis://:private@127.0.0.1:6379/0'],
    ['THAARA_TEST_DATABASE_URL','postgresql://thaara_app:private@localhost:15432/thaara_step74_test'],
    ['THAARA_TEST_DATABASE_URL','postgresql://thaara_app:private@production.invalid:15432/thaara_step74_test'],
    ['THAARA_TEST_DATABASE_URL','postgresql://thaara_app:private@127.0.0.2:15432/thaara_step74_test'],
    ['THAARA_TEST_DATABASE_URL','postgresql://thaara_app:private@127.0.0.1/thaara_step74_test'],
    ['THAARA_TEST_DATABASE_URL','postgresql://thaara_app:private@127.0.0.1:15432/other_test'],
    ['THAARA_TEST_DATABASE_URL','postgresql://postgres:private@127.0.0.1:15432/thaara_step74_test'],
    ['THAARA_TEST_DATABASE_URL','postgresql://thaara_app@127.0.0.1:15432/thaara_step74_test'],
    ['THAARA_TEST_DATABASE_URL','postgresql://thaara_app:private@127.0.0.1:15432/thaara_step74_test?host=production.invalid'],
    ['THAARA_TEST_DATABASE_URL','postgresql://thaara_app:private@127.0.0.1:15432/thaara_step74_test#override'],
    ['THAARA_TEST_REDIS_URL','redis://:private@127.0.0.1:16379/1'],
    ['THAARA_TEST_REDIS_URL','rediss://:private@127.0.0.1:16379/0'],
    ['THAARA_TEST_DATABASE_URL','not a URL containing PRIVATE-CREDENTIAL'],
  ])('rejects unsafe target %s %# without echoing credentials',(key,value)=>{
    try{getIsolatedRuntimeConfig({...settings(),[key]:value});throw Error('accepted unsafe target');}
    catch(e){expect((e as Error).message).toMatch(/isolation/i);expect((e as Error).message).not.toContain('PRIVATE-CREDENTIAL');expect((e as Error).message).not.toContain('private');}
  });
  it.each(['DATABASE_URL','MIGRATION_DATABASE_URL','BOOTSTRAP_DATABASE_URL','WORKER_DATABASE_URL','REDIS_URL',
    'TASK004_DATABASE_URL','TASK004_MIGRATION_DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])('rejects conflicting inherited %s',key=>{
    expect(()=>getIsolatedRuntimeConfig({...settings(),[key]:'development'})).toThrow(/isolation/i);
  });
  it('builds encoded role credentials without changing the isolated target',()=>{
    const url=new URL(isolatedRoleUrl(getIsolatedRuntimeConfig(settings()),'thaara_seeder_user','p@ss:word/secret'));
    expect(url.host).toBe('127.0.0.1:15432');expect(url.pathname).toBe('/thaara_step74_test');
    expect(decodeURIComponent(url.password)).toBe('p@ss:word/secret');
  });
  it('refuses unexpected role identities',()=>{
    expect(()=>isolatedRoleUrl(getIsolatedRuntimeConfig(settings()),'postgres','secret')).toThrow(/isolation/i);
  });
  it('constructs child settings from validated targets without mutating parent settings',()=>{
    const env=settings();const child=childEnvironment(env);
    expect(child.MIGRATION_DATABASE_URL).toBe(env.THAARA_TEST_MIGRATION_DATABASE_URL);
    expect(child.REDIS_URL).toBe(env.THAARA_TEST_REDIS_URL);expect(child.PGDATABASE).toBe('thaara_step74_test');
    expect(env).not.toHaveProperty('MIGRATION_DATABASE_URL');
  });
  it('removes inherited Node preload options from initialization children',()=>{
    const child=childEnvironment({...settings(),NODE_OPTIONS:'--require=untrusted-preload',NODE_PATH:'untrusted-modules'});
    expect(child).not.toHaveProperty('NODE_OPTIONS');expect(child).not.toHaveProperty('NODE_PATH');
  });
  it('fails in a child before executing its script with an unsafe target',()=>{
    const env=childEnvironment(settings());env.MIGRATION_DATABASE_URL='postgresql://postgres:PRIVATE@127.0.0.1:5432/thaara_v2';
    const result=spawnSync(process.execPath,['--import',new URL('./step74-child-guard.mjs',import.meta.url).href,
      '--input-type=module','-e','console.log("UNSAFE_CHILD_EXECUTED")'],{env,encoding:'utf8'});
    expect(result.status).not.toBe(0);expect(result.stdout).not.toContain('UNSAFE_CHILD_EXECUTED');
    expect(result.stderr).not.toContain('postgresql://');expect(result.stderr).not.toContain(':PRIVATE@');
  });
});

 it('does not expose captured Docker credentials when inspection fails',()=>{
 const failure=Object.assign(new Error('raw PRIVATE-CREDENTIAL'),{stdout:'Config.Env PASSWORD=PRIVATE-CREDENTIAL',stderr:'PRIVATE-CREDENTIAL'});
 try{withoutCommandOutput(()=>{throw failure;});throw Error('accepted failure');}
 catch(error){expect((error as Error).message).toBe('[Step 74 isolation] Docker inspection failed');expect(error).not.toHaveProperty('stdout');expect(error).not.toHaveProperty('cause');}
 });

it('loads the child guard and executes a safe child without service access',()=>{
 const result=spawnSync(process.execPath,['--import',new URL('./step74-child-guard.mjs',import.meta.url).href,
 '--input-type=module','-e','console.log("SAFE_CHILD_EXECUTED")'],{env:childEnvironment(settings()),encoding:'utf8'});
 expect(result.status).toBe(0);expect(result.stdout).toContain('SAFE_CHILD_EXECUTED');
});
