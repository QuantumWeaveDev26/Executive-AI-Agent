import {PHONE_AI_CALL_ACTION,computeCanonicalParameterHash,type PhoneCallingDraft} from '@thaara/contracts';
import {ApprovalRepository,AuditEventRepository,PlanRepository,PlanStepRepository,PlanStepApprovalBindingRepository,type AuthenticatedScope,type TransactionalDbClient,type DbClient} from '@thaara/db';
import {ForbiddenError} from '@thaara/observability';
import type {PhoneCallingStore} from './phone-calling.js';

/** Existing RLS-protected plan/approval/audit tables only. No migration or runtime call-state table. */
export function createPhoneCallingStore(db:TransactionalDbClient):PhoneCallingStore{
 const auth=async(tx:DbClient,s:AuthenticatedScope)=>{
  const {rows}=await tx.query<{workspace_id:string;user_id:string;role:string}>('SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)',[s.sessionTokenHash]);
  const current=rows[0];if(!current||current.workspace_id!==s.workspaceId||current.user_id!==s.userId||current.role!==s.role||!['owner','admin','member'].includes(current.role))throw new ForbiddenError('Phone owner scope denied.');
 };
 return {
  assertScope:s=>db.withScopedTransaction(s,tx=>auth(tx,s)),
  createPrepared:(s,draft:PhoneCallingDraft,chatContext)=>db.withScopedTransaction(s,async tx=>{
   await auth(tx,s);
   const plans=new PlanRepository(tx),steps=new PlanStepRepository(tx);
   // Context comes only from the authenticated conversation route, never from the public draft payload.
   const plan=await plans.create(s.workspaceId,s.userId,'Prepare AI phone call','Review the recipient, purpose, AI disclosure and language before starting one call.',{source:'chat_automation_orchestrator',workflowKind:'phone_calling',liveCallingEnabled:draft.mode==='live',...(chatContext?{conversationId:chatContext.conversationId}:{})});
   const step=await steps.create(s.workspaceId,plan.id,0,PHONE_AI_CALL_ACTION,'write','high','explicit',draft,computeCanonicalParameterHash(draft));
   await steps.transitionStatus(s.workspaceId,step.id,['blocked','ready'],'awaiting_approval');
   await plans.transitionStatus(s.workspaceId,plan.id,'draft','awaiting_approval');
   const a=await new ApprovalRepository(tx).create(s.workspaceId,PHONE_AI_CALL_ACTION,draft,s.userId,'high',900);
   await new PlanStepApprovalBindingRepository(tx).create(s.workspaceId,plan.id,step.id,a.id,step.parameter_hash);
   await new AuditEventRepository(tx).create(s.workspaceId,'phone.ai.draft_prepared','plan_step',{planId:plan.id,approvalId:a.id,contactId:draft.contactId,contactRevision:draft.contactRevision,liveCallingEnabled:draft.mode==='live'},s.userId,step.id);
   await auth(tx,s);return {approvalId:a.id,planId:plan.id,stepId:step.id};
  }),
  approval:(s,id)=>db.withScopedTransaction(s,async tx=>{
   await auth(tx,s);const a=await new ApprovalRepository(tx).findById(s.workspaceId,id);
   if(!a||a.requester_user_id!==s.userId)return null;
   return {id:a.id,workspaceId:a.workspace_id,actionName:a.action_name,actionParams:a.action_params,requesterUserId:a.requester_user_id,approverUserId:a.approver_user_id,status:a.status,riskLevel:a.risk_level,expiresAt:new Date(a.expires_at).toISOString(),createdAt:new Date(a.created_at).toISOString(),updatedAt:new Date(a.updated_at).toISOString()};
  }),
  openRequests:s=>db.withScopedTransaction(s,async tx=>{
   await auth(tx,s);
   const {rows}=await tx.query<{id:string;status:'pending'|'approved';expires_at:string|Date;action_params:unknown}>(`SELECT id,status,expires_at,action_params FROM approval_requests
    WHERE workspace_id=$1 AND requester_user_id=$2 AND action_name=$3 AND status IN ('pending','approved') AND expires_at>clock_timestamp()
    ORDER BY created_at DESC LIMIT 50`,[s.workspaceId,s.userId,PHONE_AI_CALL_ACTION]);
   return rows.map(r=>({approvalId:r.id,status:r.status,expiresAt:new Date(r.expires_at).toISOString(),draft:r.action_params}));
  }),
  // Owner's one-tap "Call now": only the requester, only a pending, unexpired phone-call approval, audited in the same transaction.
  confirmOwnRequest:(s,id)=>db.withScopedTransaction(s,async tx=>{
   await auth(tx,s);
   if(s.role!=='owner')throw new ForbiddenError('Phone call confirmation denied.');
   const repo=new ApprovalRepository(tx),a=await repo.findById(s.workspaceId,id);
   if(!a||a.requester_user_id!==s.userId||a.action_name!==PHONE_AI_CALL_ACTION||new Date(a.expires_at).getTime()<=Date.now())throw new ForbiddenError('Phone call confirmation denied.');
   if(a.status==='approved')return;
   if(a.status!=='pending')throw new ForbiddenError('Phone call confirmation denied.');
   await repo.transitionStatus(s.workspaceId,id,'pending','approved',s.userId);
   await new AuditEventRepository(tx).create(s.workspaceId,'phone.ai.call_confirmed','approval_request',{approvalId:id,channel:'owner_one_tap'},s.userId,id);
   await auth(tx,s);
  }),
  ownerName:s=>db.withScopedTransaction(s,async tx=>{await auth(tx,s);const {rows}=await tx.query<{display_name:string}>('SELECT display_name FROM users WHERE id=$1',[s.userId]);return rows[0]?.display_name??null;}),
  audit:(s,action,metadata)=>db.withScopedTransaction(s,async tx=>{await auth(tx,s);await new AuditEventRepository(tx).create(s.workspaceId,action,'phone_calling',metadata,s.userId);await auth(tx,s);})
 };
}
