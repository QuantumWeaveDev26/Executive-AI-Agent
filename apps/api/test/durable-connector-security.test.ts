import { describe,it,expect,vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { defaultPolicyGateway } from '@thaara/policy';
import { ConnectorEnvelopeCipher } from '../src/services/connector-security.js';
import { DurableN8nSecurityPrototype,PostgresConnectorStateStore,computeConnectorProfileFingerprint } from '../src/services/durable-n8n-security.js';
import { MockConnectorStore,MockConnectorKeys } from './helpers/durable-connector.js';
const a={workspaceId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',role:'owner' as const,sessionTokenHash:'session-a'};
const b={...a,workspaceId:'33333333-3333-4333-8333-333333333333',sessionTokenHash:'session-b'};
const secret='SYNTHETIC-STEP78-CREDENTIAL-ONLY';
const binding={workspaceId:a.workspaceId,connector:'n8n' as const,profileId:'synthetic',revision:1};
function fixture() {
 const members=new Map([[a.sessionTokenHash,a],[b.sessionTokenHash,b]]),store=new MockConnectorStore(members),ring=new Map([['test-key-v1',randomBytes(32)]]);
 const keys=new MockConnectorKeys(ring),cipher=new ConnectorEnvelopeCipher(keys);
 const profiles=[{id:'synthetic',workspaceId:a.workspaceId,label:'Synthetic'}];
 const create=(repo=store,keyService=keys,transportFactory?:any)=>new DurableN8nSecurityPrototype({mode:'mock',store:repo,cipher:new ConnectorEnvelopeCipher(keyService),profiles,resolveProfileSecret:async()=>secret,transportFactory},defaultPolicyGateway);
 return {members,store,ring,keys,cipher,create,service:create()};
}
describe('Step78 durable connector contracts (isolated mock simulation)',()=>{
 it('defaults to not_configured without enabling existing runtime connections',async()=>{
  const service=new DurableN8nSecurityPrototype(undefined,defaultPolicyGateway);
  expect(await service.status(a)).toMatchObject({status:'not_configured',configured:false,mode:'disabled'});
  await expect(service.configure(a,'synthetic',0)).rejects.toMatchObject({code:'CONNECTOR_STORAGE_NOT_CONFIGURED'});
 });
 it('persists only envelope ciphertext and safe revision/audit metadata',async()=>{
  const f=fixture();await f.service.configure(a,'synthetic',0);
  expect(f.store.snapshot()).not.toContain(secret);
  expect(f.store.snapshot()).not.toContain(f.ring.get('test-key-v1')!.toString('base64url'));
  expect(await f.service.status(a)).toMatchObject({configured:true,status:'configured_unverified',revision:1,mode:'mock'});
  expect(JSON.stringify([await f.service.status(a),f.store.audit])).not.toMatch(/wrappedKey|ciphertext|SYNTHETIC-STEP78/);
 });
 it('reconstructs a connection and decrypts after simulated process restart',async()=>{
  const f=fixture();await f.service.configure(a,'synthetic',0);
  const restored=new MockConnectorStore(f.members,f.store.snapshot()),fresh=f.create(restored,new MockConnectorKeys(f.ring));
  expect(await fresh.status(a)).toMatchObject({configured:true,revision:1});
  const access=await fresh.capture(a);expect(await fresh.resolve(a,access)).toBe(secret);
 });
 it('retains a disconnect tombstone across restart without resurrecting ciphertext',async()=>{
  const f=fixture();await f.service.configure(a,'synthetic',0);const access=await f.service.capture(a);
  await f.service.disconnect(a,1);
  const snapshot=f.store.snapshot(),fresh=f.create(new MockConnectorStore(f.members,snapshot),new MockConnectorKeys(f.ring));
  expect(await fresh.status(a)).toMatchObject({configured:false,status:'disconnected',revision:2});
  expect([...JSON.parse(snapshot).records].map((v:any)=>JSON.parse(v[1]))[0]).toMatchObject({profileId:null,envelope:null});
  await expect(fresh.resolve(a,access)).rejects.toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
 });
 it('two instances racing configuration commit at most one revision and success audit',async()=>{
  const f=fixture(),second=f.create();
  const results=await Promise.allSettled([f.service.configure(a,'synthetic',0),second.configure(a,'synthetic',0)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(f.store.audit).toHaveLength(1);expect((await f.service.status(a)).revision).toBe(1);
 });
 it('a delayed configuration cannot pass a disconnect/reconnect revision (no ABA)',async()=>{
  const f=fixture();let resume!:()=>void;
  f.keys.beforeWrap=()=>new Promise<void>(resolve=>{resume=resolve;});
  const pending=f.service.configure(a,'synthetic',0);
  for(let n=0;n<12&&!resume;n++)await Promise.resolve();if(!resume)throw Error('Wrap not reached');
  f.keys.beforeWrap=undefined;await f.create().disconnect(a,0);await f.create().configure(a,'synthetic',1);resume();
  await expect(pending).rejects.toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
  expect(await f.service.status(a)).toMatchObject({configured:true,revision:2});expect(f.store.audit).toHaveLength(2);
 });
 it('cross-instance disconnect invalidates previously captured access',async()=>{
  const f=fixture();await f.service.configure(a,'synthetic',0);const access=await f.service.capture(a);
  await f.create().disconnect(a,1);
  await expect(f.service.resolve(a,access)).rejects.toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
  await expect(f.service.assertCurrent(a,access)).rejects.toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
 });
 it('withholds a delayed decryption when another instance disconnects',async()=>{
  const f=fixture();await f.service.configure(a,'synthetic',0);const access=await f.service.capture(a);
  let resume!:()=>void;f.keys.beforeUnwrap=()=>new Promise<void>(resolve=>{resume=resolve;});
  const pending=f.service.resolve(a,access);for(let n=0;n<12&&!resume;n++)await Promise.resolve();if(!resume)throw Error('Unwrap not reached');
  await f.create().disconnect(a,1);resume();
  await expect(pending).rejects.toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
 });
 it('never lets caller mutation switch the final fence to a newer credential revision',async()=>{
  const f=fixture();await f.service.configure(a,'synthetic',0);const access=await f.service.capture(a);
  let resume!:()=>void;f.keys.beforeUnwrap=()=>new Promise<void>(resolve=>{resume=resolve;});
  const pending=f.service.resolve(a,access);for(let n=0;n<12&&!resume;n++)await Promise.resolve();if(!resume)throw Error('Unwrap not reached');
  await f.create().disconnect(a,1);await f.create().configure(a,'synthetic',2);
  access.revision=3;resume();
  await expect(pending).rejects.toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
 });
 it('pins the authenticated subject before an asynchronous provisioning callback',async()=>{
  const f=fixture(),subject={...a};
  const service=new DurableN8nSecurityPrototype({mode:'mock',store:f.store,cipher:f.cipher,profiles:[{id:'synthetic',workspaceId:a.workspaceId,label:'Synthetic'}],
   resolveProfileSecret:async()=>{Object.assign(subject,b);return secret;}},defaultPolicyGateway);
  await service.configure(subject,'synthetic',0);
  expect(await f.store.read(b,'n8n')).toBeNull();
  expect(await f.store.read(a,'n8n')).toMatchObject({workspaceId:a.workspaceId,revision:1});
 });
 it('a failed atomic state/audit commit preserves the previous record without a success event',async()=>{
  const f=fixture();await f.service.configure(a,'synthetic',0);const before=f.store.snapshot();f.store.failCommit=true;
  await expect(f.service.disconnect(a,1)).rejects.toMatchObject({code:'CONNECTOR_STORAGE_UNAVAILABLE'});
  expect(f.store.snapshot()).toBe(before);
 });
 it.each(['member','viewer'] as const)('PolicyGateway denies %s even if a store is available',async role=>{
  const f=fixture(),scope={...a,role};
  await expect(f.service.configure(scope,'synthetic',0)).rejects.toMatchObject({statusCode:403});
  await expect(f.service.disconnect(scope,0)).rejects.toMatchObject({statusCode:403});
  await expect(f.service.status(scope)).rejects.toMatchObject({statusCode:403});
  expect(f.store.records.size).toBe(0);
 });
 it('rejects revoked authorization when committing after key wrapping',async()=>{
  const f=fixture();f.keys.beforeWrap=async()=>{f.members.delete(a.sessionTokenHash);};
  await expect(f.service.configure(a,'synthetic',0)).rejects.toMatchObject({statusCode:403});
  expect(f.store.records.size).toBe(0);expect(f.store.audit).toEqual([]);
 });
 it('refreshes authorization after a delayed decryption',async()=>{
  const f=fixture();await f.service.configure(a,'synthetic',0);const access=await f.service.capture(a);
  f.keys.beforeUnwrap=async()=>{f.members.delete(a.sessionTokenHash);};
  await expect(f.service.resolve(a,access)).rejects.toMatchObject({statusCode:403});
 });
 it('cannot enumerate/select another workspace profile or forge an access binding',async()=>{
  const f=fixture();await f.service.configure(a,'synthetic',0);const access=await f.service.capture(a);
  expect(await f.service.status(b)).toMatchObject({configured:false,revision:0});
  await expect(f.service.configure(b,'synthetic',0)).rejects.toMatchObject({statusCode:404});
  await expect(f.service.resolve(b,access)).rejects.toMatchObject({statusCode:403});
 });
 it('rejects a store returning another workspace record before releasing a credential',async()=>{
  const f=fixture();await f.service.configure(a,'synthetic',0);const record=await f.store.read(a,'n8n');
  f.store.read=async()=>record;
  await expect(f.service.status(b)).rejects.toMatchObject({code:'CONNECTOR_RECORD_INVALID'});
 });
 it('fails closed on unavailable storage without exposing database error details',async()=>{
  const f=fixture();f.store.failRead=true;
  await expect(f.service.status(a)).rejects.toMatchObject({code:'CONNECTOR_STORAGE_UNAVAILABLE',message:'Connector storage is unavailable.'});
 });
 it('key service outage is redacted and never persists a plaintext fallback',async()=>{
  const f=fixture();f.keys.fail=true;
  await expect(f.service.configure(a,'synthetic',0)).rejects.toMatchObject({code:'CONNECTOR_CREDENTIAL_UNAVAILABLE'});
  expect(f.store.records.size).toBe(0);expect(f.store.audit).toHaveLength(0);
 });
 it.each(['workspaceId','connector','profileId','revision'] as const)('envelope authentication rejects changed %s',async field=>{
  const f=fixture(),sealed=await f.cipher.seal(binding,secret);
  const changes={workspaceId:b.workspaceId,connector:'calendar',profileId:'other',revision:2};
  await expect(f.cipher.open({...binding,[field]:changes[field]} as any,sealed)).rejects.toMatchObject({code:'CONNECTOR_CREDENTIAL_UNAVAILABLE'});
 });
 it('rejects ciphertext/wrapped-key tampering without returning raw cryptography errors',async()=>{
  const f=fixture(),sealed=await f.cipher.seal(binding,secret);
  const bad=Buffer.from(sealed.ciphertext,'base64url');bad[0]^=1;
  await expect(f.cipher.open(binding,{...sealed,ciphertext:bad.toString('base64url')})).rejects.toMatchObject({code:'CONNECTOR_CREDENTIAL_UNAVAILABLE'});
  await expect(f.cipher.open(binding,{...sealed,wrappedKey:'AAAA'})).rejects.toMatchObject({code:'CONNECTOR_CREDENTIAL_UNAVAILABLE'});
 });
 it('supports key-version selection across restart without embedding master keys in storage',async()=>{
  const f=fixture(),old=await f.cipher.seal(binding,secret);f.ring.set('test-key-v2',randomBytes(32));
  const rotated=new ConnectorEnvelopeCipher(new MockConnectorKeys(f.ring,'test-key-v2')),next=await rotated.seal({...binding,revision:2},secret);
  expect(old.keyId).toBe('test-key-v1');expect(next.keyId).toBe('test-key-v2');
  expect(await rotated.open(binding,old)).toBe(secret);expect(await rotated.open({...binding,revision:2},next)).toBe(secret);
  await expect(new ConnectorEnvelopeCipher(new MockConnectorKeys(new Map([['test-key-v2',f.ring.get('test-key-v2')!]]),'test-key-v2')).open(binding,old)).rejects.toMatchObject({code:'CONNECTOR_CREDENTIAL_UNAVAILABLE'});
 });
 it.each([-1,Number.MAX_SAFE_INTEGER])('rejects unsafe expected revision %s without changing storage',async revision=>{
  const f=fixture();await expect(f.service.configure(a,'synthetic',revision)).rejects.toMatchObject({code:'CONNECTOR_REVISION_INVALID'});
  expect(f.store.records.size).toBe(0);
 });
 it('rejects managed adapters rather than silently enabling unapproved infrastructure',()=>{
  const f=fixture();
  expect(()=>new DurableN8nSecurityPrototype({mode:'mock',store:{...f.store,mode:'managed'},cipher:f.cipher,profiles:[],resolveProfileSecret:async()=>secret} as any,defaultPolicyGateway)).toThrow('mock');
 });
 it('fences in-flight durable transport calls on disconnect and enforces inactive-only workflows',async()=>{
  const f=fixture();
  let finish!:(v:any[])=>void;
  const provider={
   mode:'mock' as const,
   workspaceId:a.workspaceId,
   listByName:vi.fn(()=>new Promise<any[]>(r=>{finish=r;})),
   createInactive:vi.fn(async()=>({id:'wf-1',active:false})),
   read:vi.fn(async()=>({id:'wf-1',active:false}))
  };
  const seenSecrets:string[]=[];
  const svc=f.create(f.store,f.keys,(_w:string,_p:string,resolved:string)=>{seenSecrets.push(resolved);return provider;});
  await svc.configure(a,'synthetic',0);
  const tr=await svc.transport(a);
  await expect(tr.createInactive({name:'wf',active:true,nodes:[],connections:{}} as any)).rejects.toMatchObject({code:'CONNECTOR_WORKFLOW_ACTIVE_FORBIDDEN'});
  expect(await tr.createInactive({name:'wf',active:false,nodes:[],connections:{}} as any)).toEqual({id:'wf-1',active:false});
  expect(seenSecrets).toEqual([secret]);
  const pending=tr.listByName('wf');
  for(let i=0;i<10&&!finish;i++)await Promise.resolve();
  await svc.disconnect(a,1);
  finish([]);
  await expect(pending).rejects.toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
 });
 it('PostgresConnectorStateStore validates profile definitions, fingerprints, and redacts database errors',async()=>{
  const fp=computeConnectorProfileFingerprint({workspaceId:a.workspaceId,connector:'n8n',id:'synthetic',label:'Synthetic'});
  expect(fp).toMatch(/^[a-f0-9]{64}$/);
  expect(()=>new PostgresConnectorStateStore({mode:'managed' as any,db:{} as any,profiles:[]})).toThrow('mock');
  expect(()=>new PostgresConnectorStateStore({mode:'mock',db:{} as any,profiles:[{id:'bad id!',workspaceId:a.workspaceId,label:'Bad'}]})).toThrow('Invalid');
  const failingDb={withScopedTransaction:async()=>{throw new Error('PG_PRIVATE_CONNECTION_SECRET');}} as any;
  const store=new PostgresConnectorStateStore({mode:'mock',db:failingDb,profiles:[{id:'synthetic',workspaceId:a.workspaceId,label:'Synthetic',configurationFingerprint:fp}]});
  await expect(store.read(a,'n8n')).rejects.toMatchObject({code:'CONNECTOR_STORAGE_UNAVAILABLE',message:'Connector storage is unavailable.'});
  await expect(store.read({...a,role:'viewer'},'n8n')).rejects.toMatchObject({statusCode:403});
 });
});
