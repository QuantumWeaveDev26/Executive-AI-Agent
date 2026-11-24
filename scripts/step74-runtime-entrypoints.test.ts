import { describe, it, expect, vi } from 'vitest';
import { assertIsolatedPostgresUrl } from './step74-runtime-guard.mjs';
const clients=vi.hoisted(()=>({client:vi.fn(()=>{throw Error('Unexpected database construction');}),pool:vi.fn(()=>{throw Error('Unexpected pool construction');})}));
vi.mock('pg',()=>({default:{Client:clients.client,Pool:clients.pool}}));
const paths=[
 '../packages/db/test/automation-management.runtime.test.ts','../packages/db/test/postgres-rls.runtime.test.ts',
 '../packages/db/test/task003-purge.runtime.test.ts','../packages/db/test/task003-repositories.runtime.test.ts',
 '../packages/db/test/task003-security.runtime.test.ts','../packages/db/test/task003-streaming.runtime.test.ts',
 '../packages/db/test/task004-governance.runtime.test.ts','../packages/db/test/step79b-connector-security.runtime.test.ts',
 '../apps/worker/test/redis-worker.runtime.test.ts'
];
describe('Runtime entry points reject absent isolation before touching services',()=>{
 it.each(paths)('blocks %s without database construction',async path=>{
  vi.resetModules();vi.clearAllMocks();vi.stubEnv('THAARA_TEST_MODE','');
  try {
   await expect(import(path)).rejects.toThrow(/Step 74 isolation/);
   expect(clients.client).not.toHaveBeenCalled();expect(clients.pool).not.toHaveBeenCalled();
  } finally {vi.unstubAllEnvs();}
 });
 it('blocks the legacy destructive fresh-database target before opening a client',async()=>{
  vi.resetModules();vi.clearAllMocks();
  const {provisionTask004Fresh}=await import('../packages/db/scripts/provision-task004-fresh.ts');
  await expect(provisionTask004Fresh('postgresql://postgres:fixture@127.0.0.1:15432/thaara_step74_test',
    assertIsolatedPostgresUrl)).rejects.toThrow(/Step 74 isolation/);
  expect(clients.client).not.toHaveBeenCalled();
 });
});
