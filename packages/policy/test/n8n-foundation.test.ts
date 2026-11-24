
import { describe,it,expect,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { computeCanonicalParameterHash } from '@thaara/contracts';
import { ComposeEmailWorkflowAdapter,DryRunEmailWorkflowAdapter,StageEmailWorkflowArtifactAdapter } from '../src/email-automation.js';
import { N8nInactiveWorkflowAdapter,buildN8nDevWorkflow,N8N_CREATE_ACTION,verifyN8nReadback } from '../src/n8n.js';
import { defaultPolicyGateway } from '../src/gateway.js';
const workspaceId=randomUUID(),planId=randomUUID(),stageId=randomUUID();
async function fixture() {
 const parameters={workflowName:'Offline test',triggerType:'new_lead_inquiry',emailSubject:'Hi {{recipient_name}}',
 emailBodyTemplate:'Hello {{recipient_name}}',allowedVariables:['recipient_email','recipient_name'],recipientVariable:'recipient_email'};
 const base={workspaceId,planId,stepId:randomUUID(),idempotencyKey:'unit-operation-key',parameters};
 const composed=await new ComposeEmailWorkflowAdapter().execute(base);
 const dry=await new DryRunEmailWorkflowAdapter().execute({...base,parameters:{...parameters,sampleData:{recipient_email:'private@example.test',recipient_name:'Private Recipient'}}});
 const staged=await new StageEmailWorkflowArtifactAdapter().execute({...base,stepId:stageId,dependencyProofs:{compose:composed.proof,dry:dry.proof}});
 if(staged.status!=='verified')throw Error('Invalid fixture '+staged.error);
 const artifact=staged.proof.stagedArtifact as any;
 const context={...base,stepId:randomUUID(),parameters:{artifactId:artifact.artifactId,workflowHash:artifact.workflowHash},
 dependencyProofs:{[stageId]:staged.proof}};
 let created:any;
 const transport={mode:'mock' as const,workspaceId,
 listByName:vi.fn(async(_name:string)=>[] as any[]),
 createInactive:vi.fn(async(workflow:any)=>{created={...structuredClone(workflow),id:'new-owned-id',active:false};return {id:created.id};}),
 read:vi.fn(async(_id:string)=>structuredClone(created))};
 return {context,artifact,transport,adapter:new N8nInactiveWorkflowAdapter(transport),staged};
}
describe('Step76 create-only n8n foundation',()=>{
 it('requires explicit approval, admin role and idempotency in the policy gateway',async()=>{
  const f=await fixture(),scope={workspaceId,userId:randomUUID(),role:'admin' as const};
  expect(defaultPolicyGateway.evaluate(scope,{actionName:N8N_CREATE_ACTION,parameters:f.context.parameters,idempotencyKey:'key-123456'}).status).toBe('REJECTED_APPROVAL_REQUIRED');
  expect(defaultPolicyGateway.evaluate({...scope,role:'member'},{actionName:N8N_CREATE_ACTION,parameters:f.context.parameters,idempotencyKey:'key-123456'}).status).toBe('REJECTED_UNAUTHORIZED');
  const now=new Date().toISOString();
  const approval={id:randomUUID(),workspaceId,actionName:N8N_CREATE_ACTION,actionParams:f.context.parameters,
   requesterUserId:scope.userId,approverUserId:randomUUID(),status:'approved' as const,riskLevel:'medium' as const,
   expiresAt:new Date(Date.now()+3600000).toISOString(),createdAt:now,updatedAt:now};
  expect(defaultPolicyGateway.evaluate(scope,{actionName:N8N_CREATE_ACTION,parameters:f.context.parameters},approval).status).toBe('REJECTED_IDEMPOTENCY_REQUIRED');
  expect(defaultPolicyGateway.evaluate(scope,{actionName:N8N_CREATE_ACTION,parameters:f.context.parameters,idempotencyKey:'key-123456'},approval).allowed).toBe(true);
  expect(defaultPolicyGateway.evaluate(scope,{actionName:N8N_CREATE_ACTION,parameters:{...f.context.parameters,active:true},idempotencyKey:'key-123456'},approval).allowed).toBe(false);
 });
 it('defaults to not_configured without contacting n8n',async()=>{
  const f=await fixture();expect((await new N8nInactiveWorkflowAdapter().execute(f.context)).status).toBe('not_configured');
 });
 it('creates only a synthetic manual workflow and verifies its exact inactive readback',async()=>{
  const f=await fixture();const result=await f.adapter.execute(f.context);
  expect(result).toMatchObject({success:true,status:'verified',verificationMethod:'mocked_n8n_inactive_readback',
   proof:{workflowId:'new-owned-id',active:false,liveProvidersStatus:'not_configured',realEmailSent:false,mode:'mock'}});
  const workflow=f.transport.createInactive.mock.calls[0]![0];
  expect(workflow.name).toMatch(/^THAARA_V2_DEV_/);expect(workflow.active).toBe(false);
  expect(workflow.nodes.map((n:any)=>n.type)).toEqual(['n8n-nodes-base.manualTrigger','n8n-nodes-base.set']);
  expect(JSON.stringify(workflow)).not.toMatch(/private@example|Private Recipient|credentials|webhook|scheduleTrigger|gmail|httpRequest/);
  expect(f.transport.read).toHaveBeenCalledWith('new-owned-id');
 });
 it('derives distinct stable ownership names for workspace and plan step',async()=>{
  const f=await fixture(),one=buildN8nDevWorkflow(f.context,f.artifact);
  expect(buildN8nDevWorkflow(f.context,f.artifact).name).toBe(one.name);
  expect(buildN8nDevWorkflow({...f.context,workspaceId:randomUUID()},f.artifact).name).not.toBe(one.name);
  expect(buildN8nDevWorkflow({...f.context,stepId:randomUUID()},f.artifact).name).not.toBe(one.name);
 });
 it('refuses any pre-existing matching workflow, including one labelled Thaara',async()=>{
  const f=await fixture();f.transport.listByName.mockResolvedValueOnce([{id:'existing',name:'THAARA_V2_DEV_EXISTING',active:false}]);
  expect((await f.adapter.execute(f.context)).status).toBe('unverified');
  expect(f.transport.createInactive).not.toHaveBeenCalled();expect(f.transport.read).not.toHaveBeenCalled();
 });
 it.each(['missing','workspace','plan','step','hash','active','credentials'])('rejects invalid staged dependency: %s',async mutation=>{
  const f=await fixture();const context=structuredClone(f.context),proof:any=context.dependencyProofs[stageId],artifact=proof.stagedArtifact;
  if(mutation==='missing')context.dependencyProofs={};
  if(mutation==='workspace')artifact.workspaceId=randomUUID();
  if(mutation==='plan')artifact.planId=randomUUID();
  if(mutation==='step')artifact.stepId=randomUUID();
  if(mutation==='hash')context.parameters.workflowHash='a'.repeat(64);
  if(mutation==='active')artifact.active=true;
  if(mutation==='credentials')artifact.workflowDefinition.n8nBlueprint.nodes[0].credentials={private:'secret'};
  expect((await f.adapter.execute(context)).status).toBe('failed');
  expect(f.transport.listByName).not.toHaveBeenCalled();expect(f.transport.createInactive).not.toHaveBeenCalled();
 });
 it('rejects an n8n connection assigned to another workspace',async()=>{
  const f=await fixture();const adapter=new N8nInactiveWorkflowAdapter({...f.transport,workspaceId:randomUUID()});
  expect((await adapter.execute(f.context)).status).toBe('not_configured');expect(f.transport.createInactive).not.toHaveBeenCalled();
 });
 it.each(['active','nodes','parameters','connections','name','id','credentials','published'])('keeps acknowledgement unverified when readback differs: %s',async mutation=>{
  const f=await fixture();f.transport.read.mockImplementationOnce(async id=>{
   const workflow:any=structuredClone(f.transport.createInactive.mock.calls[0]![0]);Object.assign(workflow,{id,active:false});
   if(mutation==='active')workflow.active=true;
   if(mutation==='nodes')workflow.nodes.push({type:'n8n-nodes-base.httpRequest'});
   if(mutation==='parameters')workflow.nodes[1].parameters.assignments.assignments[0].value='changed';
   if(mutation==='connections')workflow.connections={};
   if(mutation==='name')workflow.name='Existing unrelated workflow';
   if(mutation==='id')workflow.id='other-id';
   if(mutation==='credentials')workflow.nodes[1].credentials={apiKey:{id:'secret'}};
   if(mutation==='published')workflow.activeVersionId='published-version';
   return workflow;
  });
  const result=await f.adapter.execute(f.context);expect(result.status).toBe('unverified');expect(result.success).toBe(false);
  expect(f.transport.createInactive).toHaveBeenCalledTimes(1);
 });
 it('does not retry an uncertain create and never leaks provider errors',async()=>{
  const f=await fixture();f.transport.createInactive.mockRejectedValueOnce(Error('X-N8N-API-KEY PRIVATE'));
  const result=await f.adapter.execute(f.context);expect(result.status).toBe('unverified');expect(result.proof.workflowCreated).toBeNull();
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|API-KEY/);expect(f.adapter.idempotencySupport).toBe('none');
  expect(f.transport.createInactive).toHaveBeenCalledTimes(1);expect(f.transport.read).not.toHaveBeenCalled();
 });
 it('does not fabricate a verified result on readback timeout',async()=>{
  const f=await fixture();f.transport.read.mockRejectedValueOnce(Error('private credential'));
  expect((await f.adapter.execute(f.context)).status).toBe('unverified');
 });
 it('readback verification rejects unexpected settings and pinned data',async()=>{
  const f=await fixture(),expected=buildN8nDevWorkflow(f.context,f.artifact);
  expect(verifyN8nReadback({...expected,id:'new',active:false,pinData:{private:[1]}},expected,'new')).toBe(false);
  expect(verifyN8nReadback({...expected,id:'new',active:false,settings:{...expected.settings,errorWorkflow:'existing'}},expected,'new')).toBe(false);
  expect(computeCanonicalParameterHash(f.context.parameters)).toHaveLength(64);
 });
});

describe('n8n truthfulness and execution metadata regressions',()=>{
 it.each(['staticData','node-settings','settings'])('refuses unexpected execution data: %s',async mutation=>{
  const f=await fixture(),expected=buildN8nDevWorkflow(f.context,f.artifact),readback:any={...structuredClone(expected),id:'new',active:false};
  if(mutation==='staticData')readback.staticData={private:'unexpected'};
  if(mutation==='node-settings')readback.nodes[1].settings={onError:'continueErrorOutput'};
  if(mutation==='settings')readback.settings={...readback.settings,unknownExecutionSetting:true};
  expect(verifyN8nReadback(readback,expected,'new')).toBe(false);
 });
 it('records unknown creation after an acknowledged but failed readback',async()=>{
  const f=await fixture();f.transport.read.mockRejectedValueOnce(Error('unavailable'));
  const result=await f.adapter.execute(f.context);
  expect(result).toMatchObject({status:'unverified',proof:{workflowCreated:null}});
 });
});

describe('n8n SDK discovery metadata is explicit and separate from activation',()=>{
 it('allows the observed SDK discovery flag only when explicitly expected by the server',async()=>{
  const f=await fixture(),expected=buildN8nDevWorkflow(f.context,f.artifact);
  const readback={...structuredClone(expected),id:'new',active:false,settings:{executionOrder:'v1',availableInMCP:true}};
  expect(verifyN8nReadback(readback,expected,'new')).toBe(false);
  expect(verifyN8nReadback(readback,{...expected,settings:{executionOrder:'v1',availableInMCP:true}},'new')).toBe(true);
 });
});
