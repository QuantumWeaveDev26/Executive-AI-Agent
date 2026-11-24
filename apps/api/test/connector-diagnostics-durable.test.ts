import { describe,it,expect,vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { defaultPolicyGateway } from '@thaara/policy';
import { registerN8nConnections } from '../src/routes/n8n-connections.js';
import { DurableN8nSecurityPrototype } from '../src/services/durable-n8n-security.js';
import { ConnectorEnvelopeCipher } from '../src/services/connector-security.js';
import { MockConnectorKeys,MockConnectorStore } from './helpers/durable-connector.js';
const scope={workspaceId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',role:'owner' as const,sessionTokenHash:'synthetic-only'};
async function fixture(){
 const members=new Map([[scope.sessionTokenHash,scope]]),store=Object.assign(new MockConnectorStore(members),{storage:'postgres_durable' as const});
 const keys=new MockConnectorKeys(new Map([['test-key-v1',randomBytes(32)]]));
 const options={mode:'mock' as const,store,cipher:new ConnectorEnvelopeCipher(keys),profiles:[{workspaceId:scope.workspaceId,id:'synthetic',label:'Synthetic'}],resolveProfileSecret:vi.fn(async()=> 'SYNTHETIC-PRIVATE-ONLY'),transportFactory:vi.fn()};
 await new DurableN8nSecurityPrototype(options,defaultPolicyGateway).configure(scope,'synthetic',0);
 const unwrap=vi.spyOn(keys,'unwrap'),wrap=vi.spyOn(keys,'wrap');options.resolveProfileSecret.mockClear();
 // Unit-test the same reader registered by buildApp; no DB sockets or grant changes.
 const app={get:vi.fn(),put:vi.fn(),delete:vi.fn(),requireAuth:vi.fn()} as any;
 const manager=await registerN8nConnections(app,{db:{} as any,policyGateway:defaultPolicyGateway,durable:options});
 return {members,store,options,unwrap,wrap,reader:manager.diagnostics};
}
describe('Step84 durable metadata reader (mock store; no KMS probes)',()=>{
 it('reports persistent storage and mock KMS without decrypting or changing the connector',async()=>{
  const f=await fixture(),before=f.store.snapshot();expect(f.reader).toMatchObject({storageKind:'postgres_durable',kmsStatus:'mock_only',connectionScope:'workspace'});
  expect(await f.reader.read(scope)).toEqual({connectionState:'configured_unverified',storageStatus:'readable'});
  for(const fn of [f.unwrap,f.wrap,f.options.resolveProfileSecret,f.options.transportFactory])expect(fn).not.toHaveBeenCalled();
  expect(f.store.snapshot()).toBe(before);
 });
 it('redacts storage failure rather than claiming readable health',async()=>{
  const f=await fixture();f.store.failRead=true;
  await expect(f.reader.read(scope)).rejects.toMatchObject({code:'CONNECTOR_STORAGE_UNAVAILABLE',message:'Connector storage is unavailable.'});
  expect(f.unwrap).not.toHaveBeenCalled();
 });
 it('preserves workspace/role/session checks in durable reads',async()=>{
  const f=await fixture();await expect(f.reader.read({...scope,workspaceId:'33333333-3333-4333-8333-333333333333'})).rejects.toMatchObject({statusCode:403});
  await expect(f.reader.read({...scope,role:'viewer'})).rejects.toMatchObject({statusCode:403});
  f.members.delete(scope.sessionTokenHash);await expect(f.reader.read(scope)).rejects.toMatchObject({statusCode:403});expect(f.unwrap).not.toHaveBeenCalled();
 });
});
