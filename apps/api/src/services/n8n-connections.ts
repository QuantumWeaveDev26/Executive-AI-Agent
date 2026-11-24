import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'node:crypto';
import { AuthenticatedScope } from '@thaara/db';
import { N8nConnectionDetails,N8nConfigureConnection } from '@thaara/contracts';
import { N8nCreateOnlyTransport,PolicyGateway } from '@thaara/policy';
import { AppError,ForbiddenError,NotFoundError } from '@thaara/observability';

const failure=(code:string,message:string,status=409)=>new AppError(message,code,status);
// Ciphertext-only ephemeral abstraction. No durable store is enabled in this step.
// A deployed replacement requires approved managed key/secret storage, atomic revisions and fencing.
export class N8nWorkspaceVault {
 #key:Buffer;
 constructor(key:Buffer,private readonly ciphertext:Map<string,string>) {
  if(key.length!==32)throw new Error('n8n vault requires a dedicated 256-bit key.');
  this.#key=Buffer.from(key);
 }
 private partition(workspaceId:string,purpose:string) {
  if(!workspaceId||!purpose)throw new Error('Authenticated workspace required.');
  return 'n8n:'+createHash('sha256').update(JSON.stringify([workspaceId,purpose])).digest('hex');
 }
 put(workspaceId:string,purpose:string,value:unknown):void {
  const key=this.partition(workspaceId,purpose),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.#key,iv);
  cipher.setAAD(Buffer.from(key));
  const bytes=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  this.ciphertext.set(key,Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url'));
 }
 get<T>(workspaceId:string,purpose:string):T|undefined {
  const key=this.partition(workspaceId,purpose),value=this.ciphertext.get(key);if(value===undefined)return undefined;
  try {
   const bytes=Buffer.from(value,'base64url'),cipher=createDecipheriv('aes-256-gcm',this.#key,bytes.subarray(0,12));
   cipher.setAAD(Buffer.from(key));cipher.setAuthTag(bytes.subarray(12,28));
   return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8')) as T;
  }catch {throw failure('N8N_SECRET_UNAVAILABLE','n8n server secret is unavailable.',503);}
 }
 delete(workspaceId:string,purpose:string):void {this.ciphertext.delete(this.partition(workspaceId,purpose));}
}
export interface N8nConnectionOptions {
 readonly mode:'mock';
 readonly vault:N8nWorkspaceVault;
 readonly profiles:ReadonlyArray<{id:string;workspaceId:string;label:string}>;
 // Factory constructs a mock transport only; the resolver must never escape server-side code.
 readonly transportFactory:(workspaceId:string,profileId:string,resolveSecret:()=>string)=>N8nCreateOnlyTransport;
}
type Audit=(scope:AuthenticatedScope,action:string,payload:Record<string,unknown>)=>Promise<void>;
interface Selection {profileId:string;revision:string;}
export class N8nConnectionManager {
 private readonly epochs=new Map<string,string>();
 constructor(private readonly options:N8nConnectionOptions|undefined,private readonly policy:PolicyGateway,private readonly audit:Audit) {
  if(options&&(options.mode!=='mock'||options.profiles.some(p=>!p.workspaceId||!/^[a-zA-Z0-9_-]{1,64}$/.test(p.id)||!/^[a-zA-Z0-9 ._-]{1,60}$/.test(p.label))||
   new Set(options.profiles.map(p=>JSON.stringify([p.workspaceId,p.id]))).size!==options.profiles.length))
   throw new Error('n8n connection profiles must be unique, workspace-scoped synthetic profiles.');
 }
 private authorize(scope:AuthenticatedScope,actionName:string,parameters:Record<string,unknown>={}) {
  if(!scope.sessionTokenHash||!scope.workspaceId||!scope.userId||!this.policy.evaluate(scope,{actionName,parameters}).allowed)
   throw new ForbiddenError('n8n connection management denied by policy.');
 }
 private epoch(workspaceId:string) {return this.epochs.get(workspaceId)??'initial';}
 private changed(workspaceId:string,revision:string) {
  if(this.epoch(workspaceId)!==revision)throw failure('N8N_CONNECTION_CHANGED','n8n connection changed during the request.');
 }
 private async record(scope:AuthenticatedScope,action:string,payload:Record<string,unknown>) {
  try {await this.audit(scope,action,payload);}
  catch(error){if(error instanceof ForbiddenError)throw new ForbiddenError('Active workspace membership is required.');
   throw failure('N8N_CONNECTION_AUDIT_FAILED','n8n connection audit is unavailable.',503);}
 }
 private selection(workspaceId:string):Selection|undefined {return this.options?.vault.get<Selection>(workspaceId,'connection');}
 details(scope:AuthenticatedScope):N8nConnectionDetails {
  this.authorize(scope,'n8n.connection.manage_status');
  const selected=this.selection(scope.workspaceId);
  const configured=Boolean(selected&&selected.revision===this.epoch(scope.workspaceId)&&this.options?.vault.get<string>(scope.workspaceId,'profile:'+selected.profileId));
  return {connectorName:'n8n',status:!this.options?'not_configured':configured?'configured_unverified':'disconnected',
   configured,mode:this.options?'mock':'disabled',managementEnabled:Boolean(this.options),
   storage:this.options?'ephemeral_encrypted_mock':'unavailable',selectedProfileId:configured?selected!.profileId:null,
   profiles:this.options?.profiles.filter(p=>p.workspaceId===scope.workspaceId&&this.options!.vault.get(scope.workspaceId,'profile:'+p.id))
    .map(p=>({id:p.id,label:p.label}))??[],liveProvidersStatus:'not_configured'};
 }
 async configure(scope:AuthenticatedScope,input:N8nConfigureConnection):Promise<N8nConnectionDetails> {
  this.authorize(scope,'n8n.connection.configure',input);
  if(!this.options)throw failure('N8N_MANAGEMENT_NOT_CONFIGURED','Secure server storage is not configured.',503);
  const profile=this.options.profiles.find(p=>p.id===input.profileId&&p.workspaceId===scope.workspaceId);
  if(!profile)throw new NotFoundError('Approved n8n server profile not found.');
  const old=this.epoch(scope.workspaceId);
  await this.record(scope,'n8n.connection.configure_requested',{mode:'mock',localOnly:true});
  this.changed(scope.workspaceId,old);
  const secret=this.options.vault.get<string>(scope.workspaceId,'profile:'+profile.id);
  if(typeof secret!=='string'||!secret||secret.length>16384)throw failure('N8N_SECRET_UNAVAILABLE','n8n server secret is unavailable.',503);
  const revision=randomBytes(24).toString('base64url');this.epochs.set(scope.workspaceId,revision);
  // Fence prior transports now; publish the replacement only after its success audit commits.
  try {
   await this.record(scope,'n8n.connection.configured',{mode:'mock',localOnly:true,verified:false});
   this.changed(scope.workspaceId,revision);
   this.options.vault.put(scope.workspaceId,'connection',{profileId:profile.id,revision});
   return this.details(scope);
  }catch(error) {
   if(this.epoch(scope.workspaceId)===revision){this.epochs.set(scope.workspaceId,randomBytes(24).toString('base64url'));this.options.vault.delete(scope.workspaceId,'connection');}
   throw error;
  }
 }
 async disconnect(scope:AuthenticatedScope):Promise<N8nConnectionDetails> {
  this.authorize(scope,'n8n.connection.disconnect');
  if(!this.options)throw failure('N8N_MANAGEMENT_NOT_CONFIGURED','Secure server storage is not configured.',503);
  // Local forgetting precedes audit and never changes n8n credentials, workflows or settings.
  this.epochs.set(scope.workspaceId,randomBytes(24).toString('base64url'));
  this.options.vault.delete(scope.workspaceId,'connection');
  for(const p of this.options.profiles.filter(p=>p.workspaceId===scope.workspaceId))this.options.vault.delete(scope.workspaceId,'profile:'+p.id);
  await this.record(scope,'n8n.connection.disconnected',{mode:'mock',localOnly:true});
  return this.details(scope);
 }
 transport(workspaceId:string):N8nCreateOnlyTransport|undefined {
  const selection=this.selection(workspaceId);if(!selection||!this.options||selection.revision!==this.epoch(workspaceId))return undefined;
  const {profileId,revision}=selection,options=this.options;
  const resolve=()=>{
   this.changed(workspaceId,revision);
   const current=this.selection(workspaceId),secret=options.vault.get<string>(workspaceId,'profile:'+profileId);
   if(current?.revision!==revision||typeof secret!=='string'||!secret)throw failure('N8N_CONNECTION_CHANGED','n8n connection changed during the request.');
   return secret;
  };
  resolve();
  let delegate:N8nCreateOnlyTransport;
  try {delegate=options.transportFactory(workspaceId,profileId,resolve);}
  catch {throw failure('N8N_SECRET_UNAVAILABLE','n8n server transport is unavailable.',503);}
  if(delegate.mode!=='mock'||delegate.workspaceId!==workspaceId)throw failure('N8N_SECRET_UNAVAILABLE','n8n server transport is unavailable.',503);
  async function guarded<T>(call:()=>Promise<T>):Promise<T> {
   resolve();let result:T;
   try{result=await call();}catch{resolve();throw failure('N8N_PROVIDER_UNAVAILABLE','n8n server transport is unavailable.',502);}
   resolve();return result;
  }
  return {mode:'mock',workspaceId,listByName:name=>guarded(()=>delegate.listByName(name)),
   createInactive:workflow=>guarded(()=>delegate.createInactive(workflow)),read:id=>guarded(()=>delegate.read(id))};
 }
}
