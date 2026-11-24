
import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'node:crypto';
import { RequestScope } from '@thaara/contracts';
import { AppError } from '@thaara/observability';

// Implementations store ciphertext only. take MUST atomically fetch and delete.
// No durable implementation is enabled in Step 75; tests inject a private in-memory store.
export interface GmailCiphertextStore {
 get(key:string):string|undefined;
 set(key:string,value:string):void;
 take(key:string):string|undefined;
 delete(key:string):void;
}
export class GmailVault {
 #key:Buffer;
 constructor(key:Buffer,private store:GmailCiphertextStore) {
  if(key.length!==32)throw new Error('Gmail vault requires a dedicated 256-bit encryption key.');
  this.#key=Buffer.from(key);
 }
 private partition(scope:RequestScope,purpose:string):string {
  if(!scope.workspaceId||!scope.userId)throw new Error('Gmail vault requires an authenticated subject.');
  return 'gmail:'+purpose+':'+createHash('sha256').update(JSON.stringify([scope.workspaceId,scope.userId,purpose])).digest('hex');
 }
 set(scope:RequestScope,purpose:string,value:unknown):void {
  const key=this.partition(scope,purpose),iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',this.#key,iv);cipher.setAAD(Buffer.from(key));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  this.store.set(key,Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url'));
 }
 private open<T>(key:string,value:string|undefined):T|undefined {
  if(value===undefined)return undefined;
  try {
   const data=Buffer.from(value,'base64url');
   const decipher=createDecipheriv('aes-256-gcm',this.#key,data.subarray(0,12));
   decipher.setAAD(Buffer.from(key));decipher.setAuthTag(data.subarray(12,28));
   return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8')) as T;
  } catch {throw new AppError('Gmail credentials are unavailable.','GMAIL_CREDENTIALS_INVALID',503);}
 }
 get<T>(scope:RequestScope,purpose:string):T|undefined {
  const key=this.partition(scope,purpose);return this.open<T>(key,this.store.get(key));
 }
 take<T>(scope:RequestScope,purpose:string):T|undefined {
  const key=this.partition(scope,purpose);return this.open<T>(key,this.store.take(key));
 }
 delete(scope:RequestScope,purpose:string):void {this.store.delete(this.partition(scope,purpose));}
}
