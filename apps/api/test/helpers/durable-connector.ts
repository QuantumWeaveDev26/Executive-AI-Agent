import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { ForbiddenError } from '@thaara/observability';
import type { AuthenticatedScope } from '@thaara/db';
import type { ConnectorKind,ConnectorRecord,ConnectorAudit,ConnectorStateStore,ConnectorKeyService } from '../../src/services/connector-security.js';
export class MockConnectorStore implements ConnectorStateStore {
 readonly mode='mock' as const;
 records=new Map<string,string>();audit:ConnectorAudit[]=[];
 failRead=false;failCommit=false;
 constructor(readonly members:Map<string,{workspaceId:string;userId:string;role:string}>,snapshot?:string) {
  if(snapshot){const value=JSON.parse(snapshot);this.records=new Map(value.records);this.audit=value.audit;}
 }
 private authorized(scope:AuthenticatedScope) {
  const current=this.members.get(scope.sessionTokenHash);
  if(!current||current.workspaceId!==scope.workspaceId||current.userId!==scope.userId||current.role!==scope.role||!['owner','admin'].includes(current.role))throw new ForbiddenError();
 }
 private key(workspaceId:string,connector:ConnectorKind){return JSON.stringify([workspaceId,connector]);}
 async read(scope:AuthenticatedScope,connector:ConnectorKind):Promise<ConnectorRecord|null> {
  this.authorized(scope);if(this.failRead)throw Error('PRIVATE-DB-ERROR');
  const raw=this.records.get(this.key(scope.workspaceId,connector));return raw?JSON.parse(raw):null;
 }
 async commit(scope:AuthenticatedScope,connector:ConnectorKind,expectedRevision:number,next:ConnectorRecord,audit:ConnectorAudit) {
  this.authorized(scope);if(this.failCommit)throw Error('PRIVATE-ATOMIC-AUDIT-ERROR');
  const key=this.key(scope.workspaceId,connector),old=this.records.get(key),revision=old?JSON.parse(old).revision:0;
  if(revision!==expectedRevision)return false;
  if(next.workspaceId!==scope.workspaceId||next.connector!==connector||next.revision!==expectedRevision+1)throw Error('Invalid mock transition');
  // No await inside this atomic simulation. Real adapters require one DB transaction.
  this.records.set(key,JSON.stringify(next));this.audit.push(structuredClone(audit));return true;
 }
 snapshot(){return JSON.stringify({records:[...this.records],audit:this.audit});}
}
export class MockConnectorKeys implements ConnectorKeyService {
 readonly mode='mock' as const;
 fail=false;beforeUnwrap?:()=>Promise<void>;beforeWrap?:()=>Promise<void>;
 constructor(readonly keys:ReadonlyMap<string,Buffer>,readonly activeKeyId='test-key-v1'){}
 async wrap(key:Buffer,context:string) {
  await this.beforeWrap?.();if(this.fail)throw Error('PRIVATE-KMS-ERROR');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.keys.get(this.activeKeyId)!,iv);
  cipher.setAAD(Buffer.from(context));const bytes=Buffer.concat([cipher.update(key),cipher.final()]);
  return {keyId:this.activeKeyId,wrappedKey:Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url')};
 }
 async unwrap(input:{keyId:string;wrappedKey:string},context:string) {
  await this.beforeUnwrap?.();if(this.fail||!this.keys.has(input.keyId))throw Error('PRIVATE-KMS-ERROR');
  const bytes=Buffer.from(input.wrappedKey,'base64url'),cipher=createDecipheriv('aes-256-gcm',this.keys.get(input.keyId)!,bytes.subarray(0,12));
  cipher.setAAD(Buffer.from(context));cipher.setAuthTag(bytes.subarray(12,28));
  return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]);
 }
}
