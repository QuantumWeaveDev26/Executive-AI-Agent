import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGliteDatabase, Migrator, WorkspaceRepository, UserRepository, hashSessionToken } from '../src/index.js';
import { PlanRepository } from '../src/repositories/plans.js';
import { PlanStepRepository } from '../src/repositories/plan-steps.js';
import { StepExecutionRepository } from '../src/repositories/step-executions.js';
import { ApprovalRepository } from '../src/repositories/approvals.js';
import { PlanStepApprovalBindingRepository } from '../src/repositories/plan-step-approval-bindings.js';
import { ReceiptRepository } from '../src/repositories/receipts.js';
import { AuditEventRepository } from '../src/repositories/audit.js';
import { AutomationActivityRepository } from '../src/repositories/automation-activity.js';

describe('Step 73 future automation audit capture', () => {
  let db: PGliteDatabase, workspaceId: string, userId: string;
  const scope=()=>({workspaceId,userId,role:'owner' as const,sessionTokenHash:hashSessionToken('step73-test')});
  beforeAll(async()=>{
    db=new PGliteDatabase();
    const migrator=new Migrator(db);await migrator.migrate(migrator.loadMigrationFiles());
    workspaceId=(await new WorkspaceRepository(db).create('Step 73 audit tests')).id;
    userId=(await new UserRepository(db).create('step73@test.local','unused','Audit tester')).id;
  });
  afterAll(async()=>{await db?.close();});
  async function fixture(tx:any) {
    const plans=new PlanRepository(tx), steps=new PlanStepRepository(tx);
    const plan=await plans.create(workspaceId,userId,'PRIVATE-TITLE','PRIVATE-DESCRIPTION');
    const step=await steps.create(workspaceId,plan.id,0,'automation.email.compose_workflow','read','low','none',
      {private:'PRIVATE-PARAMETER'},'a'.repeat(64));
    return {plans,steps,plan,step};
  }
  async function events(tx:any,target:string) {
    return (await new AuditEventRepository(tx).listByWorkspace(workspaceId,1000)).events.filter(e=>e.target_id===target);
  }
  it('records queue transitions once, excludes rejected/no-op updates and private parameters',async()=>{
    await db.withScopedTransaction(scope(),async tx=>{
      const {steps,step,plan}=await fixture(tx);
      expect(await steps.transitionStatus(workspaceId,step.id,'blocked','queued')).not.toBeNull();
      expect(await steps.transitionStatus(workspaceId,step.id,'blocked','queued')).toBeNull();
      expect(await steps.transitionStatus(workspaceId,step.id,'queued','queued')).toBeNull();
      expect(await steps.transitionStatus(workspaceId,step.id,'queued','running',null,1)).toBeNull();
      const captured=await events(tx,step.id);
      expect(captured.map(e=>e.action)).toEqual(['step.queued']);
      expect(captured[0]?.payload).toEqual({status:'queued',version:2});
      expect(JSON.stringify(await events(tx,plan.id))).not.toContain('PRIVATE-');
    });
  });
  it('retains each winning execution attempt without duplicate delivery or lease credentials',async()=>{
    await db.withScopedTransaction(scope(),async tx=>{
      const {plan,step}=await fixture(tx), executions=new StepExecutionRepository(tx);
      const key=crypto.randomUUID(), token=crypto.randomUUID();
      const first=await executions.acquireLease(workspaceId,plan.id,step.id,key,'PRIVATE-WORKER',token);
      expect(await executions.acquireLease(workspaceId,plan.id,step.id,key,'other',crypto.randomUUID())).toBeNull();
      await executions.releaseLease(workspaceId,first!.id,token);
      const second=await executions.acquireLease(workspaceId,plan.id,step.id,key,'other',crypto.randomUUID());
      expect(second?.attempt_number).toBe(2);
      const captured=await events(tx,step.id);
      expect(captured.filter(e=>e.action==='step.started').map(e=>e.payload.attemptNumber).sort()).toEqual([1,2]);
      expect(JSON.stringify(captured)).not.toContain(key);
      expect(JSON.stringify(captured)).not.toContain(token);
      expect(JSON.stringify(captured)).not.toContain('PRIVATE-WORKER');
      const timeline=await new AutomationActivityRepository(tx).list(workspaceId,plan.id);
      expect(timeline?.items.filter(e=>e.event_type==='step.started')).toHaveLength(2);
      expect(timeline?.items.filter(e=>e.event_type==='step.started').map(e=>e.attempt_number).sort()).toEqual([1,2]);
    });
  });
  it.each(['approved','rejected'] as const)('records a bound request and %s decision once',async decision=>{
    await db.withScopedTransaction(scope(),async tx=>{
      const {plan,step}=await fixture(tx), approvals=new ApprovalRepository(tx);
      const approval=await approvals.create(workspaceId,step.action_name,{secret:'PRIVATE-APPROVAL'},userId,'low');
      await new PlanStepApprovalBindingRepository(tx).create(workspaceId,plan.id,step.id,approval.id,step.parameter_hash);
      await approvals.transitionStatus(workspaceId,approval.id,'pending',decision,userId);
      expect(await approvals.transitionStatus(workspaceId,approval.id,'pending',decision,userId)).toBeNull();
      const captured=await events(tx,approval.id);
      expect(captured.map(e=>e.action).sort()).toEqual(['approval.'+decision,'approval.created'].sort());
      expect(JSON.stringify(captured)).not.toContain('PRIVATE-APPROVAL');
      const timeline=await new AutomationActivityRepository(tx).list(workspaceId,plan.id);
      expect(timeline?.items.filter(e=>e.event_type==='approval.requested')).toHaveLength(1);
      expect(timeline?.items.find(e=>e.event_type==='approval.'+decision)?.source).toBe('audit');
    });
  });
  it.each(['verified','failed','unverified','not_configured'] as const)('records truthful %s receipts without copying proof',async outcome=>{
    await db.withScopedTransaction(scope(),async tx=>{
      const {steps,step,plan}=await fixture(tx);
      await steps.transitionStatus(workspaceId,step.id,'blocked','queued');
      await steps.transitionStatus(workspaceId,step.id,'queued','running');
      await steps.transitionStatus(workspaceId,step.id,'running',outcome);
      const receipt=await new ReceiptRepository(tx).create(workspaceId,plan.id,step.id,step.action_name,outcome,{artifact:'PRIVATE-PROOF'},'PRIVATE-METHOD');
      const captured=await events(tx,step.id);
      expect(captured.filter(e=>e.action==='step.'+outcome)).toHaveLength(1);
      expect(captured.find(e=>e.action==='step.'+outcome)?.actor_user_id).toBe(userId);
      expect(captured.find(e=>e.action==='step.'+outcome)?.payload).toEqual({receiptId:receipt.id,receiptStatus:outcome});
      expect(JSON.stringify(captured)).not.toContain('PRIVATE-');
      const timeline=await new AutomationActivityRepository(tx).list(workspaceId,plan.id);
      expect(timeline?.items.filter(e=>e.receipt_id===receipt.id)).toHaveLength(1);
    });
  });
  it.each(['completed','cancelled','failed'] as const)('records a winning plan %s transition only once',async terminal=>{
    await db.withScopedTransaction(scope(),async tx=>{
      const {plans,steps,step,plan}=await fixture(tx);
      await plans.transitionStatus(workspaceId,plan.id,'draft','queued');
      if(terminal==='completed') {
        await plans.transitionStatus(workspaceId,plan.id,'queued','running');
        await steps.transitionStatus(workspaceId,step.id,'blocked','queued');
        await steps.transitionStatus(workspaceId,step.id,'queued','running');
        await steps.transitionStatus(workspaceId,step.id,'running','verified');
      }
      const before=terminal==='completed'?'running':'queued';
      await plans.transitionStatus(workspaceId,plan.id,before,terminal);
      expect(await plans.transitionStatus(workspaceId,plan.id,before,terminal)).toBeNull();
      expect((await events(tx,plan.id)).find(e=>e.action==='plan.'+terminal)?.actor_user_id).toBe(userId);
      expect((await events(tx,plan.id)).map(e=>e.action).sort()).toEqual(['plan.created','plan.'+terminal].sort());
    });
  });
  it('rolls audit events back with the transition and never writes during activity reads',async()=>{
    let stepId='',planId='';
    await db.withScopedTransaction(scope(),async tx=>{const f=await fixture(tx);stepId=f.step.id;planId=f.plan.id;});
    await expect(db.withScopedTransaction(scope(),async tx=>{
      await new PlanStepRepository(tx).transitionStatus(workspaceId,stepId,'blocked','queued');
      throw new Error('Rollback test');
    })).rejects.toThrow('Rollback test');
    await db.withScopedTransaction(scope(),async tx=>{
      expect((await new PlanStepRepository(tx).findById(workspaceId,stepId))?.status).toBe('blocked');
      expect(await events(tx,stepId)).toEqual([]);
      const before=await new AuditEventRepository(tx).listByWorkspace(workspaceId,1000);
      await new AutomationActivityRepository(tx).list(workspaceId,planId);
      expect((await new AuditEventRepository(tx).listByWorkspace(workspaceId,1000)).total).toBe(before.total);
    });
  });
});
