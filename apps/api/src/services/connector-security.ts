import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { AuthenticatedScope } from '@thaara/db';
import { AppError } from '@thaara/observability';

export type ConnectorKind='n8n'|'gmail'|'calendar'|'whatsapp'|'phone';
export interface ConnectorBinding {workspaceId:string;connector:ConnectorKind;profileId:string;revision:number;}
export interface CredentialEnvelope {
 version:1;keyId:string;wrappedKey:string;iv:string;tag:string;ciphertext:string;
}
export interface ConnectorKeyService {
 readonly mode:'mock'|'managed';
 // Wrapping context MUST be authenticated; implementations never persist plaintext data keys.
 wrap(key:Buffer,context:string):Promise<{keyId:string;wrappedKey:string}>;
 unwrap(input:{keyId:string;wrappedKey:string},context:string):Promise<Buffer>;
}
export interface ConnectorRecord {
 workspaceId:string;connector:ConnectorKind;profileId:string|null;revision:number;
 state:'configured_unverified'|'disconnected';envelope:CredentialEnvelope|null;
}
export interface ConnectorAudit {
 workspaceId:string;actorUserId:string;
 action:'connector.connection.configured'|'connector.connection.disconnected'|'connector.connection.key_rotated';
 payload:{connector:ConnectorKind;revision:number;mode:'mock'|'managed';localOnly:true};
}
export interface ConnectorStateStore {
 readonly mode:'mock'|'managed';
 readonly storage?:'mock_restart_simulation'|'postgres_durable';
 // Every operation MUST refresh the session/membership and enforce explicit workspace scope plus RLS.
 read(scope:AuthenticatedScope,connector:ConnectorKind):Promise<ConnectorRecord|null>;
 // Atomically compare revision (missing=0), persist next record AND audit. On conflict do neither.
 // A disconnected tombstone is never deleted/reused; failures roll back both state and audit.
 commit(scope:AuthenticatedScope,connector:ConnectorKind,expectedRevision:number,next:ConnectorRecord,audit:ConnectorAudit):Promise<boolean>;
}
const unavailable=()=>new AppError('Connector credential is unavailable.','CONNECTOR_CREDENTIAL_UNAVAILABLE',503);
const connectors=new Set<ConnectorKind>(['n8n','gmail','calendar','whatsapp','phone']);
export function isConnectorBinding(value:ConnectorBinding):boolean {
 return Boolean(value&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.workspaceId)&&
  connectors.has(value.connector)&&/^[a-zA-Z0-9_-]{1,64}$/.test(value.profileId)&&Number.isSafeInteger(value.revision)&&value.revision>0);
}
function bytes(value:unknown,min:number,max:number):Buffer {
 if(typeof value!=='string'||value.length>Math.ceil(max*4/3)+4||!/^[a-zA-Z0-9_-]+$/.test(value))throw unavailable();
 const decoded=Buffer.from(value,'base64url');
 if(decoded.length<min||decoded.length>max||decoded.toString('base64url')!==value)throw unavailable();
 return decoded;
}
export function isCredentialEnvelope(value:unknown):value is CredentialEnvelope {
 try {
  if(!value||typeof value!=='object')return false;
  const envelope=value as CredentialEnvelope;
  if(Object.keys(value).sort().join(',')!=='ciphertext,iv,keyId,tag,version,wrappedKey'||envelope.version!==1||
   typeof envelope.keyId!=='string'||!envelope.keyId||envelope.keyId.length>512||/[\s\x00-\x1f]/.test(envelope.keyId))return false;
  bytes(envelope.wrappedKey,1,4096);bytes(envelope.iv,12,12);bytes(envelope.tag,16,16);bytes(envelope.ciphertext,1,16384);return true;
 }catch{return false;}
}
export class ConnectorEnvelopeCipher {
 readonly mode:'mock'|'managed';
 constructor(private readonly keys:ConnectorKeyService){this.mode=keys.mode;}
 private context(binding:ConnectorBinding) {
  if(!isConnectorBinding(binding))throw unavailable();
  return JSON.stringify([1,binding.workspaceId,binding.connector,binding.profileId,binding.revision]);
 }
 async seal(binding:ConnectorBinding,secret:string):Promise<CredentialEnvelope> {
  let key:Buffer|undefined,plaintext:Buffer|undefined;
  try {
   const context=this.context(binding);
   if(typeof secret!=='string'||!secret||Buffer.byteLength(secret,'utf8')>16384)throw unavailable();
   key=randomBytes(32);const wrapped=await this.keys.wrap(key,context),iv=randomBytes(12);
   const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify([context,wrapped.keyId])));
   plaintext=Buffer.from(secret,'utf8');const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()]);
   const envelope:CredentialEnvelope={version:1,...wrapped,iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),ciphertext:encrypted.toString('base64url')};
   if(!isCredentialEnvelope(envelope))throw unavailable();return envelope;
  }catch {throw unavailable();}
  finally{key?.fill(0);plaintext?.fill(0);}
 }
 async open(binding:ConnectorBinding,envelope:CredentialEnvelope):Promise<string> {
  let key:Buffer|undefined,plaintext:Buffer|undefined;
  try {
   envelope={...envelope};
   const context=this.context(binding);if(!isCredentialEnvelope(envelope))throw unavailable();
   key=await this.keys.unwrap({keyId:envelope.keyId,wrappedKey:envelope.wrappedKey},context);
   if(!Buffer.isBuffer(key)||key.length!==32)throw unavailable();
   const cipher=createDecipheriv('aes-256-gcm',key,bytes(envelope.iv,12,12));
   cipher.setAAD(Buffer.from(JSON.stringify([context,envelope.keyId])));cipher.setAuthTag(bytes(envelope.tag,16,16));
   plaintext=Buffer.concat([cipher.update(bytes(envelope.ciphertext,1,16384)),cipher.final()]);
   return plaintext.toString('utf8');
  }catch {throw unavailable();}
  finally{key?.fill(0);plaintext?.fill(0);}
 }
}
