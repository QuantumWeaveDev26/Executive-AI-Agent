import { AuthenticatedScope } from '@thaara/db';
import { N8nCreateOnlyTransport,PolicyGateway } from '@thaara/policy';
import { AppError,ForbiddenError,NotFoundError } from '@thaara/observability';
import { N8nConnectionOptions } from './n8n-connections.js';
import { ConnectorAudit,ConnectorBinding,ConnectorRecord,ConnectorStateStore,ConnectorEnvelopeCipher,isConnectorBinding,isCredentialEnvelope } from './connector-security.js';
import { ConnectorKeyRotationPreparation,VersionedConnectorKeyService } from './connector-key-rotation.js';
export { PostgresConnectorStateStore,computeConnectorProfileFingerprint } from './postgres-connector-store.js';
export type { PostgresConnectorProfileInput,PostgresConnectorStoreOptions } from './postgres-connector-store.js';

export interface DurableN8nSecurityOptions {
 readonly mode:'mock';readonly store:ConnectorStateStore;readonly cipher:ConnectorEnvelopeCipher;
 readonly profiles:N8nConnectionOptions['profiles'];
 // Trusted server-side synthetic provisioning only. Never an HTTP token input.
 readonly resolveProfileSecret:(workspaceId:string,profileId:string)=>Promise<string>;
 readonly transportFactory?:(workspaceId:string,profileId:string,secret:string)=>N8nCreateOnlyTransport;
}
const changed=()=>new AppError('Connector connection changed during the request.','CONNECTOR_CONNECTION_CHANGED',409);
// Deliberately unwired from buildApp/routes/workers. Managed adapters are rejected until approved.
export class DurableN8nSecurityPrototype {
 constructor(private readonly options:DurableN8nSecurityOptions|undefined,private readonly policy:PolicyGateway) {
  if(options&&(options.mode!=='mock'||options.store.mode!=='mock'||options.cipher.mode!=='mock'))
   throw new Error('Step 78 durable security prototype accepts mock adapters only.');
 }
 private authorize(scope:AuthenticatedScope,actionName:string,parameters:Record<string,unknown>={}) {
  if(!scope.sessionTokenHash||!scope.workspaceId||!scope.userId||!this.policy.evaluate(scope,{actionName,parameters}).allowed)
   throw new ForbiddenError('Connector security denied by policy.');
 }
 private configured():DurableN8nSecurityOptions {
  if(!this.options)throw new AppError('Durable connector storage is not configured.','CONNECTOR_STORAGE_NOT_CONFIGURED',503);
  return this.options;
 }
 private async storage<T>(operation:()=>Promise<T>):Promise<T> {
  try{return await operation();}
  catch(error){if(error instanceof ForbiddenError)throw new ForbiddenError('Active matching workspace membership is required.');
   throw new AppError('Connector storage is unavailable.','CONNECTOR_STORAGE_UNAVAILABLE',503);}
 }
 private revision(value:number) {
  if(!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER)
   throw new AppError('A safe expected connection revision is required.','CONNECTOR_REVISION_INVALID',400);
 }
 private approved(scope:AuthenticatedScope,profileId:string) {
  return this.options?.profiles.some(p=>p.workspaceId===scope.workspaceId&&p.id===profileId);
 }
 private async read(scope:AuthenticatedScope):Promise<ConnectorRecord|null> {
  const record=await this.storage(()=>this.configured().store.read(scope,'n8n'));if(!record)return null;
  const active=record.state==='configured_unverified';
  if(record.workspaceId!==scope.workspaceId||record.connector!=='n8n'||!Number.isSafeInteger(record.revision)||record.revision<=0||
   (!active&&record.state!=='disconnected')||(active?(!isConnectorBinding(record as ConnectorBinding)||!isCredentialEnvelope(record.envelope)):
    (record.profileId!==null||record.envelope!==null)))
   throw new AppError('Connector record is invalid.','CONNECTOR_RECORD_INVALID',503);
  return record;
 }
 private async commit(scope:AuthenticatedScope,expected:number,record:ConnectorRecord,actionOverride?:ConnectorAudit['action']) {
  const audit:ConnectorAudit={workspaceId:scope.workspaceId,actorUserId:scope.userId,
   action:actionOverride??(record.state==='disconnected'?'connector.connection.disconnected':'connector.connection.configured'),
   payload:{connector:'n8n',revision:record.revision,mode:'mock',localOnly:true}};
  const committed=await this.storage(()=>this.configured().store.commit(scope,'n8n',expected,record,audit));
  if(!committed)throw changed();
 }
 async status(scope:AuthenticatedScope) {
  scope=Object.freeze({...scope});
  this.authorize(scope,'n8n.connection.manage_status');
  if(!this.options)return {status:'not_configured',configured:false,revision:0,mode:'disabled',storage:'unavailable',liveProvidersStatus:'not_configured'};
  const record=await this.read(scope),configured=record?.state==='configured_unverified'&&this.approved(scope,record.profileId!);
  return {status:configured?'configured_unverified':record?.state==='disconnected'?'disconnected':'not_configured',
   configured:Boolean(configured),revision:record?.revision??0,mode:'mock',
   storage:this.options.store.storage??'mock_restart_simulation',liveProvidersStatus:'not_configured'};
 }
 async configure(scope:AuthenticatedScope,profileId:string,expectedRevision:number) {
  scope=Object.freeze({...scope});
  this.authorize(scope,'n8n.connection.configure',{profileId});this.revision(expectedRevision);
  const options=this.configured();
  if(!this.approved(scope,profileId))throw new NotFoundError('Approved connector server profile not found.');
  const old=await this.read(scope);if((old?.revision??0)!==expectedRevision)throw changed();
  let secret:string;
  try{secret=await options.resolveProfileSecret(scope.workspaceId,profileId);}
  catch{throw new AppError('Connector credential is unavailable.','CONNECTOR_CREDENTIAL_UNAVAILABLE',503);}
  const revision=expectedRevision+1,binding={workspaceId:scope.workspaceId,connector:'n8n' as const,profileId,revision};
  const envelope=await options.cipher.seal(binding,secret);
  await this.commit(scope,expectedRevision,{...binding,state:'configured_unverified',envelope});
  return this.status(scope);
 }
 async rotate(scope:AuthenticatedScope,expectedRevision:number,keys:VersionedConnectorKeyService) {
  scope=Object.freeze({...scope});
  const options=this.configured();
  const prep=new ConnectorKeyRotationPreparation({mode:'mock',store:options.store,keys,profiles:options.profiles},this.policy);
  const prepared=await prep.prepare(scope,expectedRevision);
  await this.commit(scope,prepared.expectedRevision,prepared.next,'connector.connection.key_rotated');
  return this.status(scope);
 }
 async disconnect(scope:AuthenticatedScope,expectedRevision:number) {
  scope=Object.freeze({...scope});
  this.authorize(scope,'n8n.connection.disconnect');this.revision(expectedRevision);this.configured();
  // No decryption/KMS dependency. Preserve a monotonic tombstone; never physically delete the row.
  await this.commit(scope,expectedRevision,{workspaceId:scope.workspaceId,connector:'n8n',profileId:null,
   revision:expectedRevision+1,state:'disconnected',envelope:null});
  return this.status(scope);
 }
 async capture(scope:AuthenticatedScope):Promise<ConnectorBinding> {
  scope=Object.freeze({...scope});
  this.authorize(scope,'n8n.connection.manage_status');
  const record=await this.read(scope);
  if(!record||record.state!=='configured_unverified'||!this.approved(scope,record.profileId!))throw changed();
  return {workspaceId:scope.workspaceId,connector:'n8n',profileId:record.profileId!,revision:record.revision};
 }
 private async current(scope:AuthenticatedScope,access:ConnectorBinding) {
  this.authorize(scope,'n8n.connection.manage_status');
  if(!isConnectorBinding(access)||access.workspaceId!==scope.workspaceId||access.connector!=='n8n')throw new ForbiddenError('Connector access binding is invalid.');
  const record=await this.read(scope);
  if(!record||record.state!=='configured_unverified'||record.revision!==access.revision||record.profileId!==access.profileId||
   !this.approved(scope,access.profileId))throw changed();
  return record;
 }
 async assertCurrent(scope:AuthenticatedScope,access:ConnectorBinding):Promise<void> {
  await this.current(Object.freeze({...scope}),Object.freeze({...access}));
 }
 // Server-internal only. Future adapters must retain governed approval/lease/receipt checks,
 // recheck this persisted fence after provider work and keep uncertain outcomes unverified.
 async resolve(scope:AuthenticatedScope,access:ConnectorBinding):Promise<string> {
  // Caller-owned objects must not retarget authorization or fences across awaited work.
  scope=Object.freeze({...scope});access=Object.freeze({...access});
  const record=await this.current(scope,access),secret=await this.configured().cipher.open(access,record.envelope!);
  await this.assertCurrent(scope,access);return secret;
 }
 async transport(subject:AuthenticatedScope,existingAccess?:ConnectorBinding):Promise<N8nCreateOnlyTransport> {
  const scope=Object.freeze({...subject});
  const options=this.configured();
  if(!options.transportFactory)throw new AppError('n8n transport factory is not configured.','CONNECTOR_TRANSPORT_UNAVAILABLE',503);
  const access=Object.freeze(existingAccess?{...existingAccess}:await this.capture(scope));
  await this.assertCurrent(scope,access);
  const execute=async<T>(call:(delegate:N8nCreateOnlyTransport)=>Promise<T>):Promise<T>=>{
   const secret=await this.resolve(scope,access);
   let delegate:N8nCreateOnlyTransport;
   try{delegate=options.transportFactory!(scope.workspaceId,access.profileId,secret);}
   catch{throw new AppError('n8n server transport is unavailable.','CONNECTOR_TRANSPORT_UNAVAILABLE',503);}
   if(!delegate||delegate.mode!=='mock'||delegate.workspaceId!==scope.workspaceId)
    throw new AppError('n8n server transport is unavailable.','CONNECTOR_TRANSPORT_UNAVAILABLE',503);
   let result:T;
   try{result=await call(delegate);}
   catch{
    await this.assertCurrent(scope,access);
    throw new AppError('n8n server transport is unavailable.','CONNECTOR_TRANSPORT_UNAVAILABLE',502);
   }
   await this.assertCurrent(scope,access);
   return result;
  };
  return {
   mode:'mock',
   workspaceId:scope.workspaceId,
   listByName:name=>execute(d=>d.listByName(name)),
   createInactive:async workflow=>{
    if(!workflow||workflow.active!==false)throw new AppError('Only inactive n8n workflows are permitted.','CONNECTOR_WORKFLOW_ACTIVE_FORBIDDEN',400);
    return execute(d=>d.createInactive(workflow));
   },
   read:id=>execute(d=>d.read(id))
  };
 }
}
