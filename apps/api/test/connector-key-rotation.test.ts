import { describe,it,expect } from 'vitest';
import { randomBytes,createHash } from 'node:crypto';
import { Migrator } from '@thaara/db';
import { defaultPolicyGateway } from '@thaara/policy';
import { ConnectorEnvelopeCipher } from '../src/services/connector-security.js';
import { ConnectorKeyRotationPreparation } from '../src/services/connector-key-rotation.js';
import { MockConnectorKeys,MockConnectorStore } from './helpers/durable-connector.js';
import type { VersionedConnectorKeyService,ConnectorKeyVersion } from '../src/services/connector-key-rotation.js';
const a={workspaceId:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',role:'owner' as const,sessionTokenHash:'session-a'};
const b={...a,workspaceId:'33333333-3333-4333-8333-333333333333',sessionTokenHash:'session-b'};
const secret='SYNTHETIC-ROTATION-CREDENTIAL-ONLY';
class VersionedMockKeys extends MockConnectorKeys implements VersionedConnectorKeyService {
 versions=new Map<string,ConnectorKeyVersion>([
  ['test-key-v1',{keyId:'test-key-v1',generation:1,state:'decrypt_only'}],
  ['test-key-v2',{keyId:'test-key-v2',generation:2,state:'encrypt_decrypt'}]
 ]);
 activeId='test-key-v2';dataKeyHashes:string[]=[];afterWrap?:()=>void;wrongVersion=false;
 async describeVersion(_binding:any,keyId:string){if(this.fail)throw Error('PRIVATE-KEY-METADATA');return {...this.versions.get(keyId)!};}
 async activeVersion(binding:any){return this.describeVersion(binding,this.activeId);}
 async wrapForVersion(key:Buffer,context:string,keyId:string){
  this.dataKeyHashes.push(createHash('sha256').update(key).digest('hex'));
  if(this.versions.get(keyId)?.state!=='encrypt_decrypt')throw Error('PRIVATE-KEY-UNAVAILABLE');
  const result=await new MockConnectorKeys(this.keys,keyId).wrap(key,context);this.afterWrap?.();
  return this.wrongVersion?{...result,keyId:'unexpected-key'}:result;
 }
}
async function fixture() {
 const members=new Map([[a.sessionTokenHash,a],[b.sessionTokenHash,b]]),store=new MockConnectorStore(members),ring=new Map([['test-key-v1',randomBytes(32)],['test-key-v2',randomBytes(32)]]);
 const keys=new VersionedMockKeys(ring,'test-key-v1'),binding={workspaceId:a.workspaceId,connector:'n8n' as const,profileId:'synthetic',revision:1};
 const envelope=await new ConnectorEnvelopeCipher(keys).seal(binding,secret);
 const record={...binding,state:'configured_unverified' as const,envelope};
 store.records.set(JSON.stringify([a.workspaceId,'n8n']),JSON.stringify(record));
 const profiles=[{id:'synthetic',workspaceId:a.workspaceId,label:'Synthetic'}];
 const create=(repo=store,k=keys)=>new ConnectorKeyRotationPreparation({mode:'mock',store:repo,keys:k,profiles},defaultPolicyGateway);
 return {members,store,ring,keys,binding,envelope,record,create,service:create()};
}
describe('Step79A provider-neutral versioned key preparation (mock only)',()=>{
 it('prepares a new encrypted revision without committing or returning plaintext',async()=>{
  const f=await fixture(),before=f.store.snapshot(),result=await f.service.prepare(a,1);
  expect(result).toMatchObject({status:'prepared_not_committed',expectedRevision:1,mode:'mock',next:{revision:2,envelope:{keyId:'test-key-v2'}}});
  expect(JSON.stringify(result)).not.toContain(secret);expect(f.store.snapshot()).toBe(before);
  expect(await new ConnectorEnvelopeCipher(f.keys).open({...f.binding,revision:2},result.next.envelope!)).toBe(secret);
 });
 it('uses a fresh data key and nonce per prepared secret, retaining old decrypt-only versions',async()=>{
  const f=await fixture(),one=await f.service.prepare(a,1),two=await f.service.prepare(a,1);
  expect(f.keys.dataKeyHashes[0]).not.toBe(f.keys.dataKeyHashes[1]);
  expect(one.next.envelope!.iv).not.toBe(two.next.envelope!.iv);
  expect(await new ConnectorEnvelopeCipher(f.keys).open(f.binding,f.envelope)).toBe(secret);
 });
 it('supports mock snapshot restart and commits only one of two prepared revisions',async()=>{
  const f=await fixture(),one=await f.service.prepare(a,1),two=await f.service.prepare(a,1);
  const restored=new MockConnectorStore(f.members,f.store.snapshot());
  const audit={workspaceId:a.workspaceId,actorUserId:a.userId,action:'connector.connection.configured' as const,payload:{connector:'n8n' as const,revision:2,mode:'mock' as const,localOnly:true as const}};
  expect(await restored.commit(a,'n8n',one.expectedRevision,one.next,audit)).toBe(true);
  expect(await restored.commit(a,'n8n',two.expectedRevision,two.next,audit)).toBe(false);
  const record=await restored.read(a,'n8n');
  expect(await new ConnectorEnvelopeCipher(new VersionedMockKeys(f.ring)).open({...f.binding,revision:2},record!.envelope!)).toBe(secret);
  expect(restored.audit).toHaveLength(1);
 });
 it.each(['member','viewer'] as const)('denies %s preparation without exposing credentials',async role=>{
  const f=await fixture();await expect(f.service.prepare({...a,role},1)).rejects.toMatchObject({statusCode:403});
 });
 it('cannot rotate or decrypt another workspace connection',async()=>{
  const f=await fixture();await expect(f.service.prepare(b,1)).rejects.toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
  const next=await f.service.prepare(a,1);
  await expect(new ConnectorEnvelopeCipher(f.keys).open({...f.binding,workspaceId:b.workspaceId,revision:2},next.next.envelope!)).rejects.toMatchObject({code:'CONNECTOR_CREDENTIAL_UNAVAILABLE'});
 });
 it.each(['decrypt_only','disabled'] as const)('rejects a target version in %s state',async state=>{
  const f=await fixture();f.keys.versions.set('test-key-v2',{keyId:'test-key-v2',generation:2,state});
  await expect(f.service.prepare(a,1)).rejects.toMatchObject({code:'CONNECTOR_ROTATION_UNAVAILABLE'});
 });
 it('rejects disabled source keys and never falls back to another key',async()=>{
  const f=await fixture();f.keys.versions.set('test-key-v1',{keyId:'test-key-v1',generation:1,state:'disabled'});
  await expect(f.service.prepare(a,1)).rejects.toMatchObject({code:'CONNECTOR_ROTATION_UNAVAILABLE'});
 });
 it('rejects non-increasing or mismatched key-version metadata',async()=>{
  const f=await fixture();f.keys.versions.set('test-key-v2',{keyId:'test-key-v2',generation:1,state:'encrypt_decrypt'});
  await expect(f.service.prepare(a,1)).rejects.toMatchObject({code:'CONNECTOR_ROTATION_UNAVAILABLE'});
  f.keys.versions.set('test-key-v2',{keyId:'wrong-id',generation:2,state:'encrypt_decrypt'});
  await expect(f.service.prepare(a,1)).rejects.toMatchObject({code:'CONNECTOR_ROTATION_UNAVAILABLE'});
 });
 it('rejects a wrapping acknowledgement from an unexpected version',async()=>{
  const f=await fixture();f.keys.wrongVersion=true;
  await expect(f.service.prepare(a,1)).rejects.toMatchObject({code:'CONNECTOR_ROTATION_UNAVAILABLE'});
 });
 it('rechecks key lifecycle after wrapping instead of publishing a revoked target',async()=>{
  const f=await fixture();f.keys.afterWrap=()=>{f.keys.versions.set('test-key-v2',{keyId:'test-key-v2',generation:2,state:'disabled'});};
  await expect(f.service.prepare(a,1)).rejects.toMatchObject({code:'CONNECTOR_ROTATION_UNAVAILABLE'});
 });
 it('retains disconnect tombstones and rejects stale prepared work',async()=>{
  const f=await fixture(),before=f.store.snapshot();
  f.keys.afterWrap=()=>{const row={...f.record,profileId:null,envelope:null,state:'disconnected',revision:2};f.store.records.set(JSON.stringify([a.workspaceId,'n8n']),JSON.stringify(row));};
  await expect(f.service.prepare(a,1)).rejects.toMatchObject({code:'CONNECTOR_CONNECTION_CHANGED'});
  const restored=new MockConnectorStore(f.members,f.store.snapshot());
  expect(await restored.read(a,'n8n')).toMatchObject({revision:2,state:'disconnected',envelope:null});
  expect(f.store.snapshot()).not.toBe(before);
 });
 it('refreshes revoked membership after asynchronous key work',async()=>{
  const f=await fixture();f.keys.afterWrap=()=>{f.members.delete(a.sessionTokenHash);};
  await expect(f.service.prepare(a,1)).rejects.toMatchObject({statusCode:403});
 });
 it('redacts key-service failures and preserves encrypted state',async()=>{
  const f=await fixture(),before=f.store.snapshot();f.keys.fail=true;
  await expect(f.service.prepare(a,1)).rejects.toMatchObject({code:'CONNECTOR_ROTATION_UNAVAILABLE',message:'Connector key rotation preparation is unavailable.'});
  expect(f.store.snapshot()).toBe(before);
 });
 it('rejects provider adapters rather than choosing or provisioning a cloud service',async()=>{
  const f=await fixture();expect(()=>new ConnectorKeyRotationPreparation({mode:'mock',store:f.store,keys:{...f.keys,mode:'managed'},profiles:[]} as any,defaultPolicyGateway)).toThrow('mock');
 });
 it('the default migration loader excludes all review drafts without executing any SQL',()=>{
  const migrator=new Migrator({query:async()=>{throw Error('No database access permitted');}});
  const discovered=migrator.loadMigrationFiles();
  expect(discovered.length).toBeGreaterThan(0);
  expect(discovered.some(file=>file.name.includes('079a')||file.sql.includes('STEP79A_REVIEW_ONLY'))).toBe(false);
 });
});
