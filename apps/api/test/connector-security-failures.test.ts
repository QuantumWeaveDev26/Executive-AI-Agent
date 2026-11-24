import { describe,it,expect,vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { defaultPolicyGateway } from '@thaara/policy';
import { ConnectorEnvelopeCipher } from '../src/services/connector-security.js';
import { DurableN8nSecurityPrototype } from '../src/services/durable-n8n-security.js';
import { MockConnectorStore } from './helpers/durable-connector.js';
import { FaultInjectedConnectorKeys,faultGate } from './helpers/connector-faults.js';
const a={workspaceId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',role:'owner' as const,sessionTokenHash:'synthetic-a'};
async function fixture(){
 const members=new Map([[a.sessionTokenHash,a]]),store=new MockConnectorStore(members);
 const keys=new FaultInjectedConnectorKeys(new Map([['test-key-v1',randomBytes(32)],['test-key-v2',randomBytes(32)]]));
 const provider={mode:'mock' as const,workspaceId:a.workspaceId,listByName:vi.fn(async()=>[]),createInactive:vi.fn(async()=>({id:'synthetic-id'})),read:vi.fn(async()=>({active:false}))};
 const create=()=>new DurableN8nSecurityPrototype({mode:'mock',store,cipher:new ConnectorEnvelopeCipher(keys),profiles:[{workspaceId:a.workspaceId,id:'synthetic',label:'Synthetic'}],
  resolveProfileSecret:async()=> 'SYNTHETIC-STEP83-ONLY',transportFactory:()=>provider},defaultPolicyGateway);
 const service=create();await service.configure(a,'synthetic',0);return {members,store,keys,provider,create,service};
}
describe('Step83 durable transport failure and committed rotation boundaries (mock only)',()=>{
 it('disconnects during a KMS outage and fences old transports without a plaintext fallback',async()=>{
  const f=await fixture(),transport=await f.service.transport(a);f.keys.fail=true;
  expect(await f.service.disconnect(a,1)).toMatchObject({revision:2,status:'disconnected'});
  await expect(transport.listByName('synthetic')).rejects.toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
  expect(f.provider.listByName).not.toHaveBeenCalled();expect(f.store.snapshot()).not.toContain('SYNTHETIC-STEP83-ONLY');
 });
 it('does not fall back to an active key when the selected envelope key is retired',async()=>{
  const f=await fixture(),before=f.store.snapshot();f.keys.activeId='test-key-v2';f.keys.versions.get('test-key-v1')!.state='disabled';
  await expect((await f.service.transport(a)).listByName('synthetic')).rejects.toMatchObject({code:'CONNECTOR_CREDENTIAL_UNAVAILABLE'});
  expect(f.provider.listByName).not.toHaveBeenCalled();expect(f.store.snapshot()).toBe(before);
 });
 it('commits rotation, retires the old key, and uses only the new persisted binding after restart',async()=>{
  const f=await fixture(),old=await f.service.transport(a);f.keys.activeId='test-key-v2';f.keys.versions.get('test-key-v1')!.state='decrypt_only';
  expect(await f.service.rotate(a,1,f.keys)).toMatchObject({revision:2,configured:true});f.keys.versions.get('test-key-v1')!.state='disabled';
  await expect(old.listByName('synthetic')).rejects.toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
  await expect((await f.create().transport(a)).listByName('synthetic')).resolves.toEqual([]);
  expect(f.provider.listByName).toHaveBeenCalledTimes(1);expect(f.store.audit.filter(e=>e.action==='connector.connection.key_rotated')).toHaveLength(1);
 });
 it('preserves state and the audit ledger if committed rotation cannot unwrap the source',async()=>{
  const f=await fixture(),before=f.store.snapshot();f.keys.activeId='test-key-v2';
  const unwrap=vi.spyOn(f.keys,'unwrap').mockRejectedValueOnce(Error('PRIVATE-MOCK-UNWRAP-FAILURE'));
  await expect(f.service.rotate(a,1,f.keys)).rejects.toMatchObject({code:'CONNECTOR_ROTATION_UNAVAILABLE'});
  expect(unwrap).toHaveBeenCalledTimes(1);expect(f.store.snapshot()).toBe(before);
 });
 it('retains a disconnect tombstone when wrapping and disconnect race across instances',async()=>{
  const f=await fixture(),gate=faultGate();f.keys.activeId='test-key-v2';f.keys.beforeWrap=gate.pause;
  const pending=f.service.rotate(a,1,f.keys).catch(e=>e);
  try{await gate.entered;await f.create().disconnect(a,1);}finally{gate.release();}
  expect(await pending).toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
  expect(await f.service.status(a)).toMatchObject({revision:2,status:'disconnected'});
  expect(f.store.audit.filter(e=>e.action==='connector.connection.key_rotated')).toHaveLength(0);
 });
 it('rejects an acknowledged provider result after membership is revoked in flight',async()=>{
  const f=await fixture(),gate=faultGate();f.provider.createInactive.mockImplementationOnce(async()=>{await gate.pause();return {id:'synthetic-id'};});
  const transport=await f.service.transport(a),pending=transport.createInactive({active:false} as any).catch(e=>e);
  try{await gate.entered;f.members.delete(a.sessionTokenHash);}finally{gate.release();}
  expect(await pending).toMatchObject({statusCode:403});
  await expect(transport.read('synthetic-id')).rejects.toMatchObject({statusCode:403});expect(f.provider.read).not.toHaveBeenCalled();
 });
});
