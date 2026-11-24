
import { FastifyInstance,FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { N8nConnectionStatusSchema,N8nRunResponseSchema,computeCanonicalParameterHash } from '@thaara/contracts';
import {
 TransactionalDbClient,AuthenticatedScope,PlanRepository,PlanStepRepository,PlanStepApprovalBindingRepository,
 ApprovalRepository,ReceiptRepository
} from '@thaara/db';
import { N8nCreateOnlyTransport,N8nInactiveWorkflowAdapter,N8N_CREATE_ACTION,PolicyGateway } from '@thaara/policy';
import { ForbiddenError,NotFoundError } from '@thaara/observability';
import { LocalConnectorDiagnosticReader } from './connector-diagnostics.js';
import { registerN8nConnections } from './n8n-connections.js';
import { DurableN8nSecurityOptions } from '../services/durable-n8n-security.js';
import { N8nConnectionOptions } from '../services/n8n-connections.js';
import { executeGovernedPlanStep } from '../services/chat-automation-orchestrator.js';

export async function n8nRoutes(app:FastifyInstance,options:{
 db:TransactionalDbClient;policyGateway:PolicyGateway;transports?:ReadonlyMap<string,N8nCreateOnlyTransport>;connections?:N8nConnectionOptions;durable?:DurableN8nSecurityOptions;
}):Promise<LocalConnectorDiagnosticReader> {
 const preHandler=[async (_request:unknown,reply:FastifyReply)=>{reply.header('Cache-Control','no-store');},app.requireAuth];
 const tags=['n8n'];
 const manager=await registerN8nConnections(app,options);
 const transport=async(scope:AuthenticatedScope)=>options.connections||options.durable?manager.transport(scope):options.transports?.get(scope.workspaceId);
 async function fresh(scope:AuthenticatedScope,tx:{query:<T=any>(sql:string,params?:any[])=>Promise<{rows:T[]}>}) {
  const {rows}=await tx.query<{workspace_id:string;user_id:string;role:string}>(
   'SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)',[scope.sessionTokenHash]);
  const row=rows[0];if(!row||row.workspace_id!==scope.workspaceId||row.user_id!==scope.userId||row.role!==scope.role)
   throw new ForbiddenError('Active matching workspace membership is required.');
 }
 app.get('/connectors/n8n/status',{preHandler,schema:{tags,response:{200:N8nConnectionStatusSchema}}},async request=>{
  const scope=request.scope!;await options.db.withScopedTransaction(scope,tx=>fresh(scope,tx));
  if(options.durable){const value=await manager.details(scope);return {connectorName:'n8n',configured:value.configured,
   status:value.configured?'configured_unverified':'not_configured',mode:value.mode,liveProvidersStatus:'not_configured'};}
  const connection=await transport(scope),configured=connection?.workspaceId===scope.workspaceId;
  return {connectorName:'n8n',configured,status:configured?'configured_unverified':'not_configured',
   mode:configured?connection!.mode:'disabled',liveProvidersStatus:'not_configured'};
 });
 app.post<{Params:{planId:string;stepId:string}}>('/connectors/n8n/plans/:planId/steps/:stepId/create-inactive',{
  preHandler,schema:{tags,description:'Execute an explicitly approved, create-only synthetic n8n export through the governed step executor',
   params:Type.Object({planId:Type.String({format:'uuid'}),stepId:Type.String({format:'uuid'})},{additionalProperties:false}),
   response:{200:N8nRunResponseSchema,202:N8nRunResponseSchema}}
 },async(request,reply)=>{
  const scope=request.scope!,{planId,stepId}=request.params;
  if(!['admin','owner'].includes(scope.role))throw new ForbiddenError('Only workspace admins can export inactive development workflows.');
  const existing=await options.db.withScopedTransaction(scope,async tx=>{
   await fresh(scope,tx);
   const plan=await new PlanRepository(tx).findById(scope.workspaceId,planId);
   const step=await new PlanStepRepository(tx).findById(scope.workspaceId,stepId);
   if(!plan||!step||step.plan_id!==planId||step.action_name!==N8N_CREATE_ACTION)throw new NotFoundError('n8n plan step not found.');
   const receipt=await new ReceiptRepository(tx).findByStepId(scope.workspaceId,stepId);
   if(receipt)return receipt;
   if(!['queued','running'].includes(step.status)||['draft','completed','failed','cancelled'].includes(plan.status))
    throw new ForbiddenError('The n8n plan step is not approved and ready.');
   const binding=await new PlanStepApprovalBindingRepository(tx).findByStepId(scope.workspaceId,stepId);
   const approval=binding?await new ApprovalRepository(tx).findById(scope.workspaceId,binding.approval_request_id):null;
   if(!binding||!approval||binding.plan_id!==planId||binding.parameter_hash!==computeCanonicalParameterHash(step.parameters)||
    step.parameter_hash!==binding.parameter_hash)throw new ForbiddenError('Invalid n8n approval binding.');
   const decision=options.policyGateway.evaluate(scope,{actionName:N8N_CREATE_ACTION,parameters:step.parameters,
    idempotencyKey:'step-exec:'+scope.workspaceId+':'+planId+':'+stepId},{
     id:approval.id,workspaceId:approval.workspace_id,actionName:approval.action_name,actionParams:approval.action_params,
     requesterUserId:approval.requester_user_id,approverUserId:approval.approver_user_id,status:approval.status,
     riskLevel:approval.risk_level,expiresAt:approval.expires_at,createdAt:approval.created_at,updatedAt:approval.updated_at
    },plan.created_by_user_id);
   if(!decision.allowed)throw new ForbiddenError('n8n export denied by policy.');
   const parents=await Promise.all(step.depends_on_step_ids.map(id=>new PlanStepRepository(tx).findById(scope.workspaceId,id)));
   const stages=parents.filter(parent=>parent?.action_name==='automation.email.stage_workflow_artifact'&&parent.status==='verified'&&parent.plan_id===planId);
   if(stages.length!==1)throw new ForbiddenError('A verified staged artifact dependency is required.');
   return null;
  });
  if(!existing) {
   const adapter=new N8nInactiveWorkflowAdapter(await transport(scope));
   await executeGovernedPlanStep(options.db,scope,planId,stepId,{
    policyGateway:options.policyGateway,adapters:new Map([[N8N_CREATE_ACTION,adapter]]),maxRetries:1,leaseDurationMs:60000,allowN8nInteractive:true
   });
  }
  const receipt=existing??await options.db.withScopedTransaction(scope,async tx=>{
   await fresh(scope,tx);return new ReceiptRepository(tx).findByStepId(scope.workspaceId,stepId);
  });
  // Revalidate after provider work, including the idempotent replay path.
  await options.db.withScopedTransaction(scope,tx=>fresh(scope,tx));
  if(!receipt)reply.status(202);
  const proof=receipt?.proof??{};
  return {planId,stepId,receiptId:receipt?.id??null,status:receipt?.status??'running',
   workflowId:typeof proof.workflowId==='string'?proof.workflowId:null,
   workflowName:typeof proof.workflowName==='string'?proof.workflowName:null,
   active:receipt?.status==='verified'&&proof.active===false?false:null,
   verificationMethod:receipt?.verification_method??null,liveProvidersStatus:'not_configured'};
 });
 return {...manager.diagnostics,read:async scope=>{
  if(!options.connections&&!options.durable&&options.transports?.get(scope.workspaceId)?.workspaceId===scope.workspaceId)return {connectionState:'configured_unverified',storageStatus:'not_configured'};
  return manager.diagnostics.read(scope);
 }};
}
