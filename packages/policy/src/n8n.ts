
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { StagedEmailWorkflowArtifact,StagedEmailWorkflowArtifactSchema,N8nCreateInactiveSchema,computeCanonicalParameterHash } from '@thaara/contracts';
import type { ActionAdapter,ActionExecutionContext,ActionResult } from './adapter.js';
import { computeEmailWorkflowHash,validateN8nWorkflowBlueprint } from './email-automation.js';

export const N8N_CREATE_ACTION='automation.n8n.create_inactive_workflow';
export interface N8nDevelopmentWorkflow {
 name:string;active:false;nodes:Array<{id:string;name:string;type:string;typeVersion:number;position:number[];parameters:Record<string,unknown>}>;
 connections:Record<string,unknown>;settings:Record<string,unknown>;
}
export interface N8nCreateOnlyTransport {
 readonly mode:'mock'|'live';
 readonly workspaceId:string;
 listByName(name:string):Promise<Array<{id:string;name:string}>>;
 createInactive(workflow:N8nDevelopmentWorkflow):Promise<{id:string}>;
 read(id:string):Promise<unknown>;
}
const artifactCheck=TypeCompiler.Compile(StagedEmailWorkflowArtifactSchema);
const inputCheck=TypeCompiler.Compile(N8nCreateInactiveSchema);
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);

// Hash-only binding: no real artifact content, addresses, credentials or expressions leave Thaara.
export function buildN8nDevWorkflow(context:ActionExecutionContext,artifact:Pick<StagedEmailWorkflowArtifact,'workflowHash'>):N8nDevelopmentWorkflow {
 const marker=computeCanonicalParameterHash({workspaceId:context.workspaceId,planId:context.planId,
  stepId:context.stepId,idempotencyKey:context.idempotencyKey,workflowHash:artifact.workflowHash});
 return renderWorkflow(marker,artifact.workflowHash);
}
function renderWorkflow(marker:string,workflowHash:string):N8nDevelopmentWorkflow {
 const fields=[
  {name:'recipient',value:'recipient@example.invalid',type:'string'},
  {name:'subject',value:'THAARA synthetic offline email preview',type:'string'},
  {name:'body',value:'Synthetic data only. No email delivery.',type:'string'},
  {name:'realEmailSent',value:false,type:'boolean'},
  {name:'liveProvidersStatus',value:'not_configured',type:'string'},
  {name:'artifactHash',value:workflowHash,type:'string'},
  {name:'ownershipMarker',value:marker,type:'string'}
 ];
 return {name:'THAARA_V2_DEV_EMAIL_OFFLINE_'+marker.slice(0,24),active:false,
  nodes:[
   {id:'manual-test',name:'Manual Test',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[240,300],parameters:{}},
   {id:'synthetic-preview',name:'Synthetic Email Preview',type:'n8n-nodes-base.set',typeVersion:3.5,position:[480,300],
    parameters:{mode:'manual',includeOtherFields:false,assignments:{assignments:fields.map((field,index)=>({id:'field-'+index,...field}))},
     options:{includeBinary:false}}}
  ],connections:{'Manual Test':{main:[[{node:'Synthetic Email Preview',type:'main',index:0}]]}},settings:{executionOrder:'v1'}};
}
export function isSafeN8nDevWorkflow(value:N8nDevelopmentWorkflow):boolean {
 try {
  const assignments=(value.nodes[1]!.parameters.assignments as {assignments:Array<{name:string;value:unknown}>}).assignments;
  const marker=assignments.find(f=>f.name==='ownershipMarker')?.value,hash=assignments.find(f=>f.name==='artifactHash')?.value;
  if(typeof marker!=='string'||typeof hash!=='string'||!(/^[a-f0-9]{64}$/).test(marker)||!(/^[a-f0-9]{64}$/).test(hash))return false;
  return verifyN8nReadback({...value,id:'candidate'},renderWorkflow(marker,hash),'candidate');
 }catch{return false;}
}
function graph(nodes:Array<Record<string,unknown>>) {
 return nodes.map(n=>({name:n.name,type:n.type,typeVersion:n.typeVersion,parameters:n.parameters??{}}));
}
export function verifyN8nReadback(value:unknown,expected:N8nDevelopmentWorkflow,id:string):boolean {
 if(!value||typeof value!=='object')return false;
 const w=value as Record<string,unknown>;
 if(w.id!==id||!validId(id)||w.name!==expected.name||w.active!==false||w.isArchived===true||w.activeVersionId||
  w.activeVersion||(w.pinData&&Object.keys(w.pinData as object).length)||
  (w.staticData&&Object.keys(w.staticData as object).length))return false;
 if(!Array.isArray(w.nodes)||w.nodes.length!==2||w.nodes.some(n=>!n||typeof n!=='object'||n.credentials||n.disabled||
  n.webhookId||n.onError||n.retryOnFail||n.executeOnce||n.alwaysOutputData||n.continueOnFail||
  Object.keys(n).some(key=>!['id','name','type','typeVersion','position','parameters','notes','notesInFlow'].includes(key))))return false;
 const settings=(w.settings??{}) as Record<string,unknown>;
 if(!settings||typeof settings!=='object'||Array.isArray(settings)||Object.keys(settings).some(key=>!['executionOrder','availableInMCP'].includes(key))||
  (settings.executionOrder!==undefined&&settings.executionOrder!=='v1')||
  (settings.availableInMCP!==undefined&&typeof settings.availableInMCP!=='boolean')||
  Boolean(settings.availableInMCP)!==Boolean(expected.settings.availableInMCP))return false;
 return computeCanonicalParameterHash(graph(w.nodes))===computeCanonicalParameterHash(graph(expected.nodes))&&
  computeCanonicalParameterHash(w.connections??{})===computeCanonicalParameterHash(expected.connections);
}
function stagedArtifact(context:ActionExecutionContext):StagedEmailWorkflowArtifact|null {
 if(!inputCheck.Check(context.parameters))return null;
 const entries=Object.entries(context.dependencyProofs??{});
 const matches=entries.filter(([,proof])=>proof.workflowStaged===true&&proof.stagedArtifact);
 if(matches.length!==1)return null;
 const [parentId,proof]=matches[0]!,a=proof.stagedArtifact;
 if(!artifactCheck.Check(a)||a.workspaceId!==context.workspaceId||a.planId!==context.planId||a.stepId!==parentId||
  a.workflowHash!==context.parameters.workflowHash||a.artifactId!==context.parameters.artifactId||
  proof.workflowHash!==a.workflowHash||proof.parameterHash!==a.parameterHash||
  a.artifactId!=='stg_'+a.workflowHash.slice(0,16)||a.dryRunSummary.dryRunPassed!==true||
  !validateN8nWorkflowBlueprint(a.workflowDefinition.n8nBlueprint).valid||
  computeEmailWorkflowHash(context.workspaceId,a.workflowDefinition)!==a.workflowHash)return null;
 return a;
}
export class N8nInactiveWorkflowAdapter implements ActionAdapter {
 readonly name=N8N_CREATE_ACTION;
 // No provider-native idempotency: ambiguous POSTs must never be retried automatically.
 readonly idempotencySupport='none' as const;
 constructor(private transport?:N8nCreateOnlyTransport) {}
 async execute(context:ActionExecutionContext):Promise<ActionResult> {
  const mode=this.transport?.mode??'disabled';
  const proof={mode,active:null,liveProvidersStatus:'not_configured',realEmailSent:false,workflowCreated:false};
  const result=(status:ActionResult['status'],message:string):ActionResult=>({
   success:false,status,verificationMethod:'n8n_inactive_creation',error:message,proof});
  const artifact=stagedArtifact(context);
  if(!artifact||!context.idempotencyKey)return result('failed','A verified, scoped staged artifact dependency is required.');
  if(!this.transport||this.transport.workspaceId!==context.workspaceId)
   return result('not_configured','The workspace n8n connection is not configured.');
  const expected=buildN8nDevWorkflow(context,artifact);
  try {
   // Never adopt, rename, update or reuse any existing workflow, even with matching ownership text.
   if((await this.transport.listByName(expected.name)).length)
    return result('unverified','Workflow name already exists; creation stopped without modifying it.');
  } catch {return result('failed','Unable to verify n8n name availability. Nothing was created.');}
  let id:string|undefined;
  const uncertain=(message:string):ActionResult=>({...result('unverified',message),
   proof:{...proof,workflowCreated:null,...(id?{workflowId:id}:{}),active:null}});
  try {
   const created=await this.transport.createInactive(expected);
   if(!validId(created?.id))return uncertain('n8n creation outcome is unverified; do not retry.');
   id=created.id;
   const readback=await this.transport.read(id);
   if(!verifyN8nReadback(readback,expected,id))
    return uncertain('n8n readback did not verify the exact inactive workflow.');
   return {success:true,status:'verified',
    verificationMethod:mode==='mock'?'mocked_n8n_inactive_readback':'n8n_inactive_workflow_readback',
    proof:{...proof,workflowCreated:true,workflowId:id,workflowName:expected.name,artifactHash:artifact.workflowHash,
     ownershipMarker:computeCanonicalParameterHash({workspaceId:context.workspaceId,planId:context.planId,
      stepId:context.stepId,idempotencyKey:context.idempotencyKey,workflowHash:artifact.workflowHash}),active:false}};
  } catch {return uncertain('n8n creation/readback outcome is unverified; do not retry.');}
 }
}
