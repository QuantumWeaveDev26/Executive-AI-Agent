
import { beforeAll,beforeEach,afterAll,describe,it,expect,vi } from 'vitest';
import {
 PGliteDatabase,Migrator,WorkspaceRepository,UserRepository,MembershipRepository,SessionRepository,generateSessionToken,hashSessionToken,
 StepExecutionRepository,PlanRepository,PlanStepRepository,PlanStepDependencyRepository,ApprovalRepository,PlanStepApprovalBindingRepository,ReceiptRepository
} from '@thaara/db';
import { loadConfig } from '@thaara/config';
import { computeCanonicalParameterHash } from '@thaara/contracts';
import { ComposeEmailWorkflowAdapter,DryRunEmailWorkflowAdapter,StageEmailWorkflowArtifactAdapter,N8N_CREATE_ACTION } from '@thaara/policy';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { executeGovernedPlanStep } from '../src/services/chat-automation-orchestrator.js';
import { generateCsrfToken } from '../src/crypto/csrf.js';
describe('Step76 authenticated n8n governed-step integration (mock only)',()=>{
 let db:PGliteDatabase,app:Awaited<ReturnType<typeof buildApp>>,disabled:typeof app,a:any,b:any,viewer:any;
 const enqueue=vi.fn();
 const csrf=generateCsrfToken(),created=new Map<string,any>();
 const transport={mode:'mock' as const,workspaceId:'',
  listByName:vi.fn(async()=>[] as any[]),
  createInactive:vi.fn(async(workflow:any)=>{const id=randomUUID();created.set(id,{...structuredClone(workflow),id,active:false});return {id};}),
  read:vi.fn(async(id:string)=>structuredClone(created.get(id)))};
 const params={workflowName:'Private source workflow',triggerType:'new_lead_inquiry',emailSubject:'Hi {{recipient_name}}',
 emailBodyTemplate:'Hello {{recipient_name}}',allowedVariables:['recipient_email','recipient_name'],recipientVariable:'recipient_email'};
 const headers=(identity=a)=>({cookie:'thaara_session='+identity.token+'; thaara_csrf='+csrf,'x-csrf-token':csrf});
 async function plan(approvalStatus:'approved'|'pending'='approved',badArtifact=false) {
  return db.withScopedTransaction(a,async tx=>{
   const plans=new PlanRepository(tx),steps=new PlanStepRepository(tx),approvals=new ApprovalRepository(tx),
    bindings=new PlanStepApprovalBindingRepository(tx),receipts=new ReceiptRepository(tx);
   const p=await plans.create(a.workspaceId,a.userId,'n8n offline dev');
   const stage=await steps.create(a.workspaceId,p.id,0,'automation.email.stage_workflow_artifact','write','medium','explicit',params,computeCanonicalParameterHash(params));
   const context={workspaceId:a.workspaceId,planId:p.id,stepId:stage.id,idempotencyKey:'fixture',parameters:params};
   const compose=await new ComposeEmailWorkflowAdapter().execute(context);
   const dry=await new DryRunEmailWorkflowAdapter().execute({...context,parameters:{...params,sampleData:{recipient_email:'private@example.test',recipient_name:'Private'}}});
   const staged=await new StageEmailWorkflowArtifactAdapter().execute({...context,dependencyProofs:{compose:compose.proof,dry:dry.proof}});
   if(staged.status!=='verified')throw Error('invalid staging fixture');
   const artifact:any=staged.proof.stagedArtifact;
   const stageApproval=await approvals.create(a.workspaceId,stage.action_name,params,a.userId,'medium');
   await approvals.updateStatus(a.workspaceId,stageApproval.id,'approved',a.userId);
   await bindings.create(a.workspaceId,p.id,stage.id,stageApproval.id,stage.parameter_hash);
   if(badArtifact)artifact.workspaceId=b.workspaceId;
   await steps.transitionStatus(a.workspaceId,stage.id,'blocked','queued');
   await steps.transitionStatus(a.workspaceId,stage.id,'queued','running');
   await steps.transitionStatus(a.workspaceId,stage.id,'running','verified');
   await receipts.create(a.workspaceId,p.id,stage.id,stage.action_name,'verified',staged.proof,staged.verificationMethod);
   const targetParams={artifactId:artifact.artifactId,workflowHash:artifact.workflowHash};
   const step=await steps.create(a.workspaceId,p.id,1,N8N_CREATE_ACTION,'write','medium','explicit',targetParams,computeCanonicalParameterHash(targetParams));
   await new PlanStepDependencyRepository(tx).create(a.workspaceId,p.id,step.id,stage.id);
   const approval=await approvals.create(a.workspaceId,N8N_CREATE_ACTION,targetParams,a.userId,'medium');
   if(approvalStatus==='approved')await approvals.updateStatus(a.workspaceId,approval.id,'approved',a.userId);
   await bindings.create(a.workspaceId,p.id,step.id,approval.id,step.parameter_hash);
   await steps.transitionStatus(a.workspaceId,step.id,'blocked',approvalStatus==='approved'?'queued':'awaiting_approval');
   await plans.transitionStatus(a.workspaceId,p.id,'draft',approvalStatus==='approved'?'queued':'awaiting_approval');
   return {planId:p.id,stepId:step.id,approvalId:approval.id};
  });
 }
 const url=(p:any)=>'/api/v1/connectors/n8n/plans/'+p.planId+'/steps/'+p.stepId+'/create-inactive';
 beforeAll(async()=>{
  db=new PGliteDatabase();const migrator=new Migrator(db);await migrator.migrate(migrator.loadMigrationFiles());
  async function identity(name:string,role:'owner'|'viewer'='owner') {
   const ws=await new WorkspaceRepository(db).create(name),u=await new UserRepository(db).create(name+'@example.test','unused',name),token=generateSessionToken();
   const scope={workspaceId:ws.id,userId:u.id,role,sessionTokenHash:hashSessionToken(token)};
   await db.withScopedTransaction(scope,async tx=>{await new MembershipRepository(tx).create(ws.id,u.id,role);await new SessionRepository(tx).create(u.id,ws.id,token);});
   return {...scope,token};
  }
  a=await identity('n8n-a');b=await identity('n8n-b');viewer=await identity('n8n-viewer','viewer');
  transport.workspaceId=a.workspaceId;await db.exec('SET ROLE thaara_app;');
  app=await buildApp({db,config:loadConfig({NODE_ENV:'test'}),n8nTransports:new Map([[a.workspaceId,transport]]),queueService:{enqueue}});await app.ready();
  disabled=await buildApp({db,config:loadConfig({NODE_ENV:'test'})});await disabled.ready();
 });
 beforeEach(()=>{enqueue.mockClear();transport.listByName.mockClear();transport.createInactive.mockClear();transport.read.mockClear();});
 afterAll(async()=>{await app?.close();await disabled?.close();await db?.close();});
 it('requires auth and reports workspace configuration truthfully',async()=>{
  expect((await app.inject({url:'/api/v1/connectors/n8n/status'})).statusCode).toBe(401);
  expect((await disabled.inject({url:'/api/v1/connectors/n8n/status',headers:headers()})).json()).toMatchObject({configured:false,status:'not_configured',liveProvidersStatus:'not_configured'});
  expect((await app.inject({url:'/api/v1/connectors/n8n/status',headers:headers()})).json()).toMatchObject({configured:true,status:'configured_unverified',mode:'mock'});
  expect((await app.inject({url:'/api/v1/connectors/n8n/status',headers:headers(b)})).json()).toMatchObject({configured:false});
 });
 it('enforces CSRF and admin permissions before any execution',async()=>{
  const p=await plan();
  expect((await app.inject({method:'POST',url:url(p),headers:{cookie:headers().cookie}})).statusCode).toBe(403);
  expect((await app.inject({method:'POST',url:url(p),headers:headers(viewer)})).statusCode).toBe(403);
  expect(transport.createInactive).not.toHaveBeenCalled();
 });
 it('denies another workspace and spoofed workspace headers',async()=>{
  const p=await plan();expect((await app.inject({method:'POST',url:url(p),headers:{...headers(b),'x-workspace-id':a.workspaceId}})).statusCode).toBe(404);
  expect(transport.createInactive).not.toHaveBeenCalled();
 });
 it('requires the bound explicit approval and preserves an unapproved step',async()=>{
  const p=await plan('pending');
  expect((await app.inject({method:'POST',url:url(p),headers:headers()})).statusCode).toBe(403);
  const step=await db.withScopedTransaction(a,tx=>new PlanStepRepository(tx).findById(a.workspaceId,p.stepId));
  expect(step?.status).toBe('awaiting_approval');expect(transport.createInactive).not.toHaveBeenCalled();
 });
 it('rejects changed approval parameters before any network access',async()=>{
  const p=await plan();await db.withScopedTransaction(a,tx=>tx.query("UPDATE approval_requests SET action_params='{}' WHERE id=$1",[p.approvalId]));
  expect((await app.inject({method:'POST',url:url(p),headers:headers()})).statusCode).toBe(403);
  expect(transport.createInactive).not.toHaveBeenCalled();
 });
 it('persists an exact inactive readback receipt once and replays without duplicate creation',async()=>{
  const p=await plan(),one=await app.inject({method:'POST',url:url(p),headers:headers()});
  expect(one.statusCode).toBe(200);expect(one.json()).toMatchObject({status:'verified',active:false,liveProvidersStatus:'not_configured',verificationMethod:'mocked_n8n_inactive_readback'});
  const two=await app.inject({method:'POST',url:url(p),headers:headers()});
  expect(two.statusCode).toBe(200);expect(two.json().receiptId).toBe(one.json().receiptId);expect(transport.createInactive).toHaveBeenCalledTimes(1);
  const receipts=await db.withScopedTransaction(a,tx=>new ReceiptRepository(tx).listByPlanId(a.workspaceId,p.planId));
  expect(receipts.filter(r=>r.plan_step_id===p.stepId)).toHaveLength(1);
  expect(one.body).not.toMatch(/Private source|private@example|parameters|credential|apiKey/);
 });
 it('returns truthful not_configured receipt when no workspace transport exists',async()=>{
  const p=await plan(),result=await disabled.inject({method:'POST',url:url(p),headers:headers()});
  expect(result.statusCode).toBe(200);expect(result.json()).toMatchObject({status:'not_configured',workflowId:null});
  expect(transport.createInactive).not.toHaveBeenCalled();
 });
 it('never adopts or modifies an existing matching workflow',async()=>{
  const p=await plan();transport.listByName.mockResolvedValueOnce([{id:'existing',name:'THAARA_V2_DEV_EXISTING'}]);
  const result=await app.inject({method:'POST',url:url(p),headers:headers()});
  expect(result.json().status).toBe('unverified');expect(transport.createInactive).not.toHaveBeenCalled();
 });
 it('keeps an unsafe readback unverified and never tries to deactivate it',async()=>{
  const p=await plan();transport.read.mockImplementationOnce(async id=>({...created.get(id),active:true}));
  const result=await app.inject({method:'POST',url:url(p),headers:headers()});
  expect(result.json()).toMatchObject({status:'unverified',active:null});expect(transport.createInactive).toHaveBeenCalledTimes(1);
 });
 it('uncertain creation is terminal and repeated requests never retry it',async()=>{
  const p=await plan();transport.createInactive.mockRejectedValueOnce(Error('PRIVATE-TOKEN uncertain'));
  const one=await app.inject({method:'POST',url:url(p),headers:headers()}),two=await app.inject({method:'POST',url:url(p),headers:headers()});
  expect(one.json().status).toBe('unverified');expect(two.json().receiptId).toBe(one.json().receiptId);
  expect(one.body+two.body).not.toContain('PRIVATE-TOKEN');expect(transport.createInactive).toHaveBeenCalledTimes(1);
 });
 it('refuses staged proof belonging to another workspace',async()=>{
  const p=await plan('approved',true),response=await app.inject({method:'POST',url:url(p),headers:headers()});
  expect(response.json().status).toBe('failed');expect(transport.createInactive).not.toHaveBeenCalled();
 });

 it('ordinary approval keeps n8n execution manual even when a queue is configured',async()=>{
  const p=await plan('pending');
  const approved=await app.inject({method:'POST',url:'/api/v1/approvals/'+p.approvalId+'/decide',headers:headers(),payload:{status:'approved'}});
  expect(approved.statusCode).toBe(200);expect(enqueue).not.toHaveBeenCalled();
  const response=await app.inject({method:'POST',url:url(p),headers:headers()});
  expect(response.json().status).toBe('verified');expect(transport.createInactive).toHaveBeenCalledTimes(1);
 });
 it('background API execution cannot consume a manual-only n8n step',async()=>{
  const p=await plan();const result=await executeGovernedPlanStep(db,a,p.planId,p.stepId);
  expect(result.result).toMatchObject({manualExecutionRequired:true});
  const step=await db.withScopedTransaction(a,tx=>new PlanStepRepository(tx).findById(a.workspaceId,p.stepId));
  expect(step?.status).toBe('queued');expect(transport.createInactive).not.toHaveBeenCalled();
 });

 it('does not call n8n when another valid lease already owns the step',async()=>{
  const p=await plan();
  const acquire=vi.spyOn(StepExecutionRepository.prototype,'acquireLease').mockResolvedValueOnce(null);
  const lookup=vi.spyOn(StepExecutionRepository.prototype,'findByIdempotencyKey').mockResolvedValueOnce({status:'started',worker_id:'other-worker'} as any);
  try {
   const response=await app.inject({method:'POST',url:url(p),headers:headers()});
   expect(response.statusCode).toBe(202);expect(response.json()).toMatchObject({status:'running',receiptId:null});
   expect(transport.createInactive).not.toHaveBeenCalled();
  }finally{acquire.mockRestore();lookup.mockRestore();}
 });
 it('expired uncertain attempt becomes unverified without a second external POST',async()=>{
  const p=await plan();
  await db.withScopedTransaction(a,async tx=>{
   await new StepExecutionRepository(tx).acquireLease(a.workspaceId,p.planId,p.stepId,
    'step-exec:'+a.workspaceId+':'+p.planId+':'+p.stepId,'interrupted-test-worker',randomUUID(),60);
   await tx.query("UPDATE step_executions SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE workspace_id=$1 AND step_id=$2",[a.workspaceId,p.stepId]);
  });
  const response=await app.inject({method:'POST',url:url(p),headers:headers()});
  expect(response.json().status).toBe('unverified');expect(transport.createInactive).not.toHaveBeenCalled();
 });
 it('publishes only create/status routes and rejects non-test mock injection',async()=>{
  expect((await app.inject({method:'POST',url:'/api/v1/connectors/n8n/workflows/existing/activate',headers:headers()})).statusCode).toBe(404);
  await expect(buildApp({db,config:{...loadConfig({NODE_ENV:'test'}),NODE_ENV:'development'},n8nTransports:new Map([[a.workspaceId,transport]])})).rejects.toThrow(/mock.*test/i);
 });
});
