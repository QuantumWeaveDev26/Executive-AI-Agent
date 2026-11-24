import { AuthenticatedScope } from '@thaara/db';
import { PolicyGateway } from '@thaara/policy';
import { AppError,ForbiddenError } from '@thaara/observability';
import { N8nConnectionOptions } from './n8n-connections.js';
import { ConnectorBinding,ConnectorKeyService,ConnectorStateStore,ConnectorRecord,ConnectorEnvelopeCipher,isCredentialEnvelope,isConnectorBinding } from './connector-security.js';

export interface ConnectorKeyVersion {
 readonly keyId:string;readonly generation:number;
 readonly state:'encrypt_decrypt'|'decrypt_only'|'disabled';
}
// These methods describe/use already provisioned versions. No provider, create/delete-key,
// IAM or automatic cloud provisioning operation is selected or exposed.
export interface VersionedConnectorKeyService extends ConnectorKeyService {
 activeVersion(binding:ConnectorBinding):Promise<ConnectorKeyVersion>;
 describeVersion(binding:ConnectorBinding,keyId:string):Promise<ConnectorKeyVersion>;
 wrapForVersion(key:Buffer,authenticatedContext:string,keyId:string):Promise<{keyId:string;wrappedKey:string}>;
}
export interface PreparedConnectorRotation {
 status:'prepared_not_committed';expectedRevision:number;next:ConnectorRecord;
 mode:'mock';liveProvidersStatus:'not_configured';
}
export interface ConnectorRotationOptions {
 mode:'mock';store:ConnectorStateStore;keys:VersionedConnectorKeyService;profiles:N8nConnectionOptions['profiles'];
}
const unavailable=()=>new AppError('Connector key rotation preparation is unavailable.','CONNECTOR_ROTATION_UNAVAILABLE',503);
const changed=()=>new AppError('Connector connection changed during the request.','CONNECTOR_CONNECTION_CHANGED',409);
// Offline preparation only. No registration in routes/workers or persistence of the result.
export class ConnectorKeyRotationPreparation {
 constructor(private readonly options:ConnectorRotationOptions,private readonly policy:PolicyGateway) {
  if(options.mode!=='mock'||options.store.mode!=='mock'||options.keys.mode!=='mock')throw new Error('Step 79A rotation preparation accepts mock adapters only.');
 }
 private authorize(scope:AuthenticatedScope,actionName:string,parameters:Record<string,unknown>={}) {
  if(!scope.sessionTokenHash||!scope.workspaceId||!scope.userId||!this.policy.evaluate(scope,{actionName,parameters}).allowed)
   throw new ForbiddenError('Connector rotation denied by policy.');
 }
 private async read(scope:AuthenticatedScope,expected:number):Promise<ConnectorRecord> {
  const row=await this.options.store.read(scope,'n8n');
  if(!row||row.workspaceId!==scope.workspaceId||row.connector!=='n8n'||row.state!=='configured_unverified'||row.revision!==expected||
   !isConnectorBinding(row as ConnectorBinding)||!isCredentialEnvelope(row.envelope)||
   !this.options.profiles.some(p=>p.workspaceId===scope.workspaceId&&p.id===row.profileId))throw changed();
  return {...row,envelope:Object.freeze({...row.envelope})};
 }
 private version(value:ConnectorKeyVersion,keyId?:string):ConnectorKeyVersion {
  if(!value||typeof value.keyId!=='string'||!value.keyId||value.keyId.length>512||
   !Number.isSafeInteger(value.generation)||value.generation<1||
   !['encrypt_decrypt','decrypt_only','disabled'].includes(value.state)||(keyId!==undefined&&value.keyId!==keyId))throw unavailable();
  return Object.freeze({...value});
 }
 async prepare(subject:AuthenticatedScope,expectedRevision:number):Promise<PreparedConnectorRotation> {
  const scope=Object.freeze({...subject});
  try {
   this.authorize(scope,'n8n.connection.manage_status');
   if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1||expectedRevision>=Number.MAX_SAFE_INTEGER)throw changed();
   const original=await this.read(scope,expectedRevision);
   this.authorize(scope,'n8n.connection.configure',{profileId:original.profileId!});
   const from=Object.freeze({workspaceId:scope.workspaceId,connector:'n8n' as const,profileId:original.profileId!,revision:expectedRevision});
   const to=Object.freeze({...from,revision:expectedRevision+1}),keys=this.options.keys;
   const source=this.version(await keys.describeVersion(from,original.envelope!.keyId),original.envelope!.keyId);
   const target=this.version(await keys.activeVersion(to));
   if(source.state==='disabled'||target.state!=='encrypt_decrypt'||target.keyId===source.keyId||target.generation<=source.generation)throw unavailable();
   const plaintext=await new ConnectorEnvelopeCipher(keys).open(from,original.envelope!);
   const pinned:ConnectorKeyService={mode:'mock',unwrap:(input,context)=>keys.unwrap(input,context),wrap:async(key,context)=>{
    const wrapped=await keys.wrapForVersion(key,context,target.keyId);
    if(wrapped.keyId!==target.keyId)throw unavailable();
    return wrapped;
   }};
   // seal uses a fresh per-secret DEK and nonce, and binds the new durable revision.
   const envelope=await new ConnectorEnvelopeCipher(pinned).seal(to,plaintext);
   const sourceNow=this.version(await keys.describeVersion(from,source.keyId),source.keyId);
   const targetNow=this.version(await keys.describeVersion(to,target.keyId),target.keyId);
   const activeNow=this.version(await keys.activeVersion(to));
   if(sourceNow.state==='disabled'||sourceNow.generation!==source.generation||targetNow.state!=='encrypt_decrypt'||
    targetNow.generation!==target.generation||activeNow.keyId!==target.keyId||activeNow.generation!==target.generation||activeNow.state!=='encrypt_decrypt')throw unavailable();
   const current=await this.read(scope,expectedRevision);
   if(current.profileId!==from.profileId)throw changed();
   this.authorize(scope,'n8n.connection.configure',{profileId:from.profileId});
   return {status:'prepared_not_committed',expectedRevision,next:{...to,state:'configured_unverified',envelope},mode:'mock',liveProvidersStatus:'not_configured'};
  }catch(error) {
   if(error instanceof ForbiddenError)throw new ForbiddenError('Active workspace admin authority is required.');
   if(error instanceof AppError&&error.code==='CONNECTOR_CONNECTION_CHANGED')throw changed();
   throw unavailable();
  }
 }
}
