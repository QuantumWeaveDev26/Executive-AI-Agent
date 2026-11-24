import { describe,it,expect,vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { defaultPolicyGateway } from '@thaara/policy';
import { N8nWorkspaceVault,N8nConnectionManager } from '../src/services/n8n-connections.js';
const a={workspaceId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',role:'owner' as const,sessionTokenHash:'session'};
const b={...a,workspaceId:'33333333-3333-4333-8333-333333333333'};
function fixture(audit=vi.fn(async()=>{})) {
 const values=new Map<string,string>(),vault=new N8nWorkspaceVault(randomBytes(32),values);
 vault.put(a.workspaceId,'profile:test-profile','SYNTHETIC-N8N-SECRET-ONLY');
 const provider={mode:'mock' as const,workspaceId:a.workspaceId,listByName:vi.fn(async()=>[]),createInactive:vi.fn(async()=>({id:'new'})),read:vi.fn(async()=>({active:false}))};
 const factory=vi.fn((_w:string,_p:string,resolve:()=>string)=>({...provider,listByName:async()=>{resolve();return provider.listByName();}}));
 const manager=new N8nConnectionManager({mode:'mock',vault,profiles:[{id:'test-profile',workspaceId:a.workspaceId,label:'Synthetic test profile'}],transportFactory:factory},defaultPolicyGateway,audit);
 return {values,vault,manager,provider,factory};
}
describe('Step77 workspace-scoped n8n connection security (no network)',()=>{
 it('defaults to unavailable rather than simulating a connection',async()=>{
  const manager=new N8nConnectionManager(undefined,defaultPolicyGateway,async()=>{});
  expect(manager.details(a)).toMatchObject({status:'not_configured',configured:false,managementEnabled:false,storage:'unavailable'});
  await expect(manager.configure(a,{profileId:'test-profile'})).rejects.toMatchObject({code:'N8N_MANAGEMENT_NOT_CONFIGURED'});
 });
 it('encrypts secrets and rejects ciphertext moved across workspace partitions',()=>{
  const {values,vault}=fixture();expect([...values.values()].join()).not.toContain('SYNTHETIC-N8N-SECRET-ONLY');
  expect(vault.get(b.workspaceId,'profile:test-profile')).toBeUndefined();
  vault.put(b.workspaceId,'profile:test-profile','other');
  const keys=[...values.keys()];values.set(keys[1],values.get(keys[0])!);
  expect(()=>vault.get(b.workspaceId,'profile:test-profile')).toThrow('unavailable');
 });
 it('rejects an invalid vault key',()=>{expect(()=>new N8nWorkspaceVault(Buffer.alloc(8),new Map())).toThrow();});
 it.each(['viewer','member'] as const)('denies %s management through PolicyGateway',async role=>{
  const {manager}=fixture();expect(()=>manager.details({...a,role})).toThrow();
  await expect(manager.configure({...a,role},{profileId:'test-profile'})).rejects.toMatchObject({statusCode:403});
  await expect(manager.disconnect({...a,role})).rejects.toMatchObject({statusCode:403});
 });
 it('shares the connection with another admin in the same workspace',async()=>{
  const {manager}=fixture();await manager.configure(a,{profileId:'test-profile'});
  expect(manager.details({...a,userId:'44444444-4444-4444-8444-444444444444',role:'admin'})).toMatchObject({configured:true,status:'configured_unverified',mode:'mock'});
 });
 it('hides profiles and rejects configuration belonging to another workspace',async()=>{
  const {manager}=fixture();expect(manager.details(b).profiles).toEqual([]);
  await expect(manager.configure(b,{profileId:'test-profile'})).rejects.toMatchObject({statusCode:404});
  expect(manager.transport(b.workspaceId)).toBeUndefined();
 });
 it('never exposes secret handles, secrets, URLs or provider errors in status/audit',async()=>{
  const audit=vi.fn(async()=>{}),{manager}=fixture(audit);
  await manager.configure(a,{profileId:'test-profile'});
  expect(JSON.stringify([manager.details(a),audit.mock.calls])).not.toMatch(/SYNTHETIC-N8N-SECRET-ONLY|profile:test-profile|https:|apiKey/);
 });
 it('rejects arbitrary endpoint/token fields via the policy schema',async()=>{
  const {manager}=fixture();
  await expect(manager.configure(a,{profileId:'test-profile',token:'private'} as any)).rejects.toMatchObject({statusCode:403});
 });
 it('disconnect removes the selected secret and fences old transports and resolvers',async()=>{
  const {manager,vault,provider}=fixture();await manager.configure(a,{profileId:'test-profile'});
  const transport=manager.transport(a.workspaceId)!;await manager.disconnect(a);
  expect(manager.details(a)).toMatchObject({configured:false,status:'disconnected',selectedProfileId:null});
  expect(vault.get(a.workspaceId,'profile:test-profile')).toBeUndefined();
  await expect(transport.listByName('test')).rejects.toMatchObject({code:'N8N_CONNECTION_CHANGED'});
  expect(provider.listByName).not.toHaveBeenCalled();
  expect(manager.transport(a.workspaceId)).toBeUndefined();
 });
 it('withholds a delayed response after disconnect',async()=>{
  const {manager,provider}=fixture();await manager.configure(a,{profileId:'test-profile'});
  let finish!:(v:any[])=>void;provider.listByName.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const pending=manager.transport(a.workspaceId)!.listByName('test');await manager.disconnect(a);finish([]);
  await expect(pending).rejects.toMatchObject({code:'N8N_CONNECTION_CHANGED'});
 });
 it('disconnect stays fail-closed even if audit persistence fails',async()=>{
  const audit=vi.fn(async()=>{}),{manager}=fixture(audit);await manager.configure(a,{profileId:'test-profile'});
  audit.mockRejectedValueOnce(Error('PRIVATE-SECRET'));
  await expect(manager.disconnect(a)).rejects.toMatchObject({code:'N8N_CONNECTION_AUDIT_FAILED'});
  expect(manager.transport(a.workspaceId)).toBeUndefined();
 });
 it('a delayed configuration cannot restore a disconnected connection',async()=>{
  let release!:()=>void;const audit=vi.fn(async()=>{}),{manager}=fixture(audit);
  audit.mockImplementationOnce(()=>new Promise<void>(resolve=>{release=resolve;}));
  const pending=manager.configure(a,{profileId:'test-profile'});await manager.disconnect(a);release();
  await expect(pending).rejects.toMatchObject({code:'N8N_CONNECTION_CHANGED'});
  expect(manager.details(a).configured).toBe(false);
 });
 it('an unaudited configuration is rolled back without leaking an error',async()=>{
  const audit=vi.fn(async()=>{}),{manager}=fixture(audit);
  audit.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('PRIVATE-SECRET'));
  await expect(manager.configure(a,{profileId:'test-profile'})).rejects.toMatchObject({code:'N8N_CONNECTION_AUDIT_FAILED'});
  expect(manager.details(a).configured).toBe(false);
 });
 it('keeps a new connection unusable until the success audit commits',async()=>{
  let reject!:(e:Error)=>void;const audit=vi.fn(async()=>{}),{manager}=fixture(audit);
  audit.mockResolvedValueOnce(undefined).mockImplementationOnce(()=>new Promise<void>((_resolve,no)=>{reject=no;}));
  const pending=manager.configure(a,{profileId:'test-profile'});
  for(let attempt=0;attempt<10&&!reject;attempt++)await Promise.resolve();
  if(!reject)throw Error('Success audit was not reached.');
  const visible=manager.details(a).configured,transport=manager.transport(a.workspaceId);
  reject(Error('PRIVATE-AUDIT-FAILURE'));
  await expect(pending).rejects.toMatchObject({code:'N8N_CONNECTION_AUDIT_FAILED'});
  expect(visible).toBe(false);expect(transport).toBeUndefined();
 });
 it('does not accept a transport for another workspace or a live mock replacement',async()=>{
  const {manager,factory}=fixture();await manager.configure(a,{profileId:'test-profile'});
  factory.mockReturnValueOnce({mode:'live',workspaceId:b.workspaceId} as any);
  expect(()=>manager.transport(a.workspaceId)).toThrow('unavailable');
 });
});
