import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PGliteDatabase,
  Migrator,
  WorkspaceRepository,
  UserRepository,
  MembershipRepository,
  PlanRepository,
  PlanStepRepository,
  PlanStepDependencyRepository,
  PlanStepApprovalBindingRepository,
  StepExecutionRepository,
  ReceiptRepository,
  ApprovalRepository,
  AuditEventRepository,
  hashSessionToken
} from '@thaara/db';
import { computeCanonicalParameterHash } from '@thaara/contracts';
import { JobProcessor, JobData } from '../src/processor.js';
import { ApprovalSweeper } from '../src/sweeper.js';
import {
  ActionAdapter,
  ActionExecutionContext,
  ActionResult,
  defaultActionAdapters
} from '@thaara/policy';

describe('Worker Governed Plan Execution, Step Lifecycle, Crash Recovery & Sweeper (Task 002)', () => {
  let db: PGliteDatabase;
  let workspaceId: string;
  let userId: string;
  let enqueuedJobs: JobData[];
  let processor: JobProcessor;

  beforeEach(async () => {
    db = new PGliteDatabase();
    const migrator = new Migrator(db);
    await migrator.migrate(migrator.loadMigrationFiles());

    const wsRepo = new WorkspaceRepository(db);
    const userRepo = new UserRepository(db);

    const ws = await wsRepo.create('Plan Worker Test Org');
    workspaceId = ws.id;
    const user = await userRepo.create('worker-exec@org.com', 'hash', 'Worker Exec');
    userId = user.id;
    await db.withScopedTransaction(sysScope(), async (tx) => {
      await new MembershipRepository(tx).create(workspaceId, userId, 'owner');
    });

    enqueuedJobs = [];
    const stepEnqueuer = async (data: JobData) => {
      enqueuedJobs.push(data);
    };

    processor = new JobProcessor(db, undefined, stepEnqueuer);
  });

  const sysScope = () => ({
    workspaceId,
    userId: '00000000-0000-0000-0000-000000000000',
    role: 'owner' as const,
    sessionTokenHash: hashSessionToken('plan-worker-sys-token')
  });

  it('cascades multi-step DAG: step 1 produces verified receipt and unblocks step 2 to queued', async () => {
    let planId = '';
    let step1Id = '';
    let step2Id = '';

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const stepRepo = new PlanStepRepository(tx);
      const depRepo = new PlanStepDependencyRepository(tx);

      const plan = await planRepo.create(workspaceId, userId, 'Pipeline Plan');
      planId = plan.id;

      const p1 = { task: 'prepare_environment' };
      const s1 = await stepRepo.create(
        workspaceId,
        planId,
        0,
        'test.deterministic_hash_task',
        'write',
        'low',
        'none',
        p1,
        computeCanonicalParameterHash(p1)
      );
      step1Id = s1.id;

      const p2 = { task: 'verify_state' };
      const s2 = await stepRepo.create(
        workspaceId,
        planId,
        1,
        'test.deterministic_hash_task',
        'write',
        'low',
        'none',
        p2,
        computeCanonicalParameterHash(p2)
      );
      step2Id = s2.id;
      await depRepo.create(workspaceId, planId, step2Id, step1Id);

      await planRepo.transitionStatus(workspaceId, planId, 'draft', 'queued');
      await stepRepo.transitionStatus(workspaceId, step1Id, 'blocked', 'queued');
    });

    // Execute Step 1
    const res1 = await processor.process({
      workspaceId,
      jobRunId: step1Id,
      jobName: 'plan.execute_step',
      payload: { planId, stepId: step1Id, actionName: 'test.deterministic_hash_task' }
    });

    expect(res1.success).toBe(true);

    // Verify Step 1 is verified with persisted receipt
    await db.withScopedTransaction(sysScope(), async (tx) => {
      const stepRepo = new PlanStepRepository(tx);
      const receiptRepo = new ReceiptRepository(tx);

      const step1 = await stepRepo.findById(workspaceId, step1Id);
      expect(step1?.status).toBe('verified');

      const receipt1 = await receiptRepo.findByStepId(workspaceId, step1Id);
      expect(receipt1?.status).toBe('verified');
      expect(receipt1?.action_name).toBe('test.deterministic_hash_task');
      expect(receipt1?.verification_method).toBe('cryptographic_hash_receipt');

      // Verify Step 2 was unblocked to 'queued'
      const step2 = await stepRepo.findById(workspaceId, step2Id);
      expect(step2?.status).toBe('queued');
    });

    // Verify step 2 was enqueued via stepEnqueuer
    expect(enqueuedJobs.length).toBe(1);
    expect(enqueuedJobs[0].payload.stepId).toBe(step2Id);

    // Execute Step 2
    const res2 = await processor.process({
      workspaceId,
      jobRunId: step2Id,
      jobName: 'plan.execute_step',
      payload: { planId, stepId: step2Id, actionName: 'test.deterministic_hash_task' }
    });

    expect(res2.success).toBe(true);
    expect(res2.result?.planCompleted).toBe(true);

    // Verify plan status completed and audit event written
    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const auditRepo = new AuditEventRepository(tx);

      const plan = await planRepo.findById(workspaceId, planId);
      expect(plan?.status).toBe('completed');

      const audit = await auditRepo.listByWorkspace(workspaceId);
      expect(audit.events.some((e) => e.action === 'plan.completed')).toBe(true);
    });
  });

  it('deduplicates active lease without executing duplicate job', async () => {
    let planId = '';
    let stepId = '';

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const stepRepo = new PlanStepRepository(tx);
      const stepExecRepo = new StepExecutionRepository(tx);

      const plan = await planRepo.create(workspaceId, userId, 'Lease Plan');
      planId = plan.id;
      await planRepo.transitionStatus(workspaceId, planId, 'draft', 'running');

      const s = await stepRepo.create(
        workspaceId,
        planId,
        0,
        'test.deterministic_hash_task',
        'write',
        'low',
        'none',
        {},
        computeCanonicalParameterHash({})
      );
      stepId = s.id;
      await stepRepo.transitionStatus(workspaceId, stepId, 'blocked', 'running');

      // Pre-acquire active lease for another worker with 60s validity
      const idempotencyKey = `step-exec:${workspaceId}:${planId}:${stepId}`;
      await stepExecRepo.acquireLease(
        workspaceId,
        planId,
        stepId,
        idempotencyKey,
        'other-worker:123',
        '11111111-1111-1111-1111-111111111111',
        60000
      );
    });

    // Processor process attempt should detect active lease and return duplicate acknowledged cleanly
    const outcome = await processor.process({
      workspaceId,
      jobRunId: stepId,
      jobName: 'plan.execute_step',
      payload: { planId, stepId, actionName: 'test.deterministic_hash_task' }
    });

    expect(outcome.success).toBe(true);
    expect(outcome.result?.duplicateAcknowledged).toBe(true);
  });

  it('conservative crash recovery: expired lease for non-idempotent action persists unverified receipt and never re-dispatches', async () => {
    let planId = '';
    let stepId = '';

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const stepRepo = new PlanStepRepository(tx);

      const plan = await planRepo.create(workspaceId, userId, 'Crash Plan');
      planId = plan.id;
      await planRepo.transitionStatus(workspaceId, planId, 'draft', 'running');

      const s = await stepRepo.create(
        workspaceId,
        planId,
        0,
        'test.unverified_task', // non-idempotent action (idempotencySupport: 'none')
        'write',
        'medium',
        'none',
        {},
        computeCanonicalParameterHash({})
      );
      stepId = s.id;
      await stepRepo.transitionStatus(workspaceId, stepId, 'blocked', 'running');

      // Pre-seed an expired lease from a previous crashed attempt
      const idempotencyKey = `step-exec:${workspaceId}:${planId}:${stepId}`;
      await tx.query(
        `INSERT INTO step_executions (
           workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token,
           attempt_number, status, started_at, lease_expires_at
         )
         VALUES ($1, $2, $3, $4, 'crashed-worker:999', gen_random_uuid(), 1, 'started', NOW() - interval '2 minutes', NOW() - interval '1 minute');`,
        [workspaceId, planId, stepId, idempotencyKey]
      );
    });

    // Run processor: takes over expired lease (attempt 2), detects idempotencySupport === 'none', persists unverified receipt
    const outcome = await processor.process({
      workspaceId,
      jobRunId: stepId,
      jobName: 'plan.execute_step',
      payload: { planId, stepId, actionName: 'test.unverified_task' }
    });

    expect(outcome.success).toBe(false);
    expect(outcome.result?.receiptStatus).toBe('unverified');

    // Verify DB state: step is unverified, plan is failed, receipt is unverified
    await db.withScopedTransaction(sysScope(), async (tx) => {
      const stepRepo = new PlanStepRepository(tx);
      const receiptRepo = new ReceiptRepository(tx);
      const planRepo = new PlanRepository(tx);

      const step = await stepRepo.findById(workspaceId, stepId);
      expect(step?.status).toBe('unverified');

      const receipt = await receiptRepo.findByStepId(workspaceId, stepId);
      expect(receipt?.status).toBe('unverified');
      expect(receipt?.verification_method).toBe('crash_recovery_conservative');

      const plan = await planRepo.findById(workspaceId, planId);
      expect(plan?.status).toBe('failed');
    });
  });

  it('reconciles native idempotent action on lease takeover before executing', async () => {
    let planId = '';
    let stepId = '';

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const stepRepo = new PlanStepRepository(tx);

      const plan = await planRepo.create(workspaceId, userId, 'Reconcile Plan');
      planId = plan.id;
      await planRepo.transitionStatus(workspaceId, planId, 'draft', 'running');

      const s = await stepRepo.create(
        workspaceId,
        planId,
        0,
        'test.deterministic_hash_task', // native idempotent action
        'write',
        'low',
        'none',
        { task: 'reconcile_check' },
        computeCanonicalParameterHash({ task: 'reconcile_check' })
      );
      stepId = s.id;
      await stepRepo.transitionStatus(workspaceId, stepId, 'blocked', 'running');

      // Pre-seed an expired lease
      const idempotencyKey = `step-exec:${workspaceId}:${planId}:${stepId}`;
      await tx.query(
        `INSERT INTO step_executions (
           workspace_id, plan_id, step_id, idempotency_key, worker_id, lease_token,
           attempt_number, status, started_at, lease_expires_at
         )
         VALUES ($1, $2, $3, $4, 'crashed-worker:888', gen_random_uuid(), 1, 'started', NOW() - interval '2 minutes', NOW() - interval '1 minute');`,
        [workspaceId, planId, stepId, idempotencyKey]
      );
    });

    const outcome = await processor.process({
      workspaceId,
      jobRunId: stepId,
      jobName: 'plan.execute_step',
      payload: { planId, stepId, actionName: 'test.deterministic_hash_task' }
    });

    expect(outcome.success).toBe(true);
    expect(outcome.result?.reconciled).toBe(true);
    expect(outcome.result?.receiptStatus).toBe('verified');
  });

  it('in-flight plan cancellation produces truthful unverified receipt and cancels step', async () => {
    let planId = '';
    let stepId = '';

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const stepRepo = new PlanStepRepository(tx);

      const plan = await planRepo.create(workspaceId, userId, 'Cancelled Plan');
      planId = plan.id;

      const s = await stepRepo.create(
        workspaceId,
        planId,
        0,
        'test.deterministic_hash_task',
        'write',
        'low',
        'none',
        {},
        computeCanonicalParameterHash({})
      );
      stepId = s.id;

      // Plan was cancelled while step was queued/running
      await planRepo.transitionStatus(workspaceId, planId, 'draft', 'cancelled');
    });

    const outcome = await processor.process({
      workspaceId,
      jobRunId: stepId,
      jobName: 'plan.execute_step',
      payload: { planId, stepId, actionName: 'test.deterministic_hash_task' }
    });

    expect(outcome.success).toBe(false);
    expect(outcome.result?.cancelled).toBe(true);
    expect(outcome.result?.receiptStatus).toBe('unverified');

    // Verify DB state: step is cancelled, receipt is unverified
    await db.withScopedTransaction(sysScope(), async (tx) => {
      const stepRepo = new PlanStepRepository(tx);
      const receiptRepo = new ReceiptRepository(tx);

      const step = await stepRepo.findById(workspaceId, stepId);
      expect(step?.status).toBe('cancelled');

      const receipt = await receiptRepo.findByStepId(workspaceId, stepId);
      expect(receipt?.status).toBe('unverified');
      expect(receipt?.verification_method).toBe('cancellation_audit');
    });
  });

  it('approval sweeper expires pending approvals past TTL and cascades failure truthfully', async () => {
    let planId = '';
    let stepId = '';
    let approvalId = '';

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const stepRepo = new PlanStepRepository(tx);
      const approvalRepo = new ApprovalRepository(tx);
      const bindingRepo = new PlanStepApprovalBindingRepository(tx);

      const plan = await planRepo.create(workspaceId, userId, 'Expiring Approval Plan');
      planId = plan.id;
      await planRepo.transitionStatus(workspaceId, planId, 'draft', 'awaiting_approval');

      const params = { action: 'drop_database' };
      const s = await stepRepo.create(
        workspaceId,
        planId,
        0,
        'test.deterministic_hash_task',
        'write',
        'critical',
        'explicit',
        params,
        computeCanonicalParameterHash(params)
      );
      stepId = s.id;
      await stepRepo.transitionStatus(workspaceId, stepId, 'blocked', 'awaiting_approval');

      // Create expired approval request (expired 5 minutes ago)
      const approval = await approvalRepo.create(workspaceId, 'test.deterministic_hash_task', params, userId, 'critical', 60);
      approvalId = approval.id;
      await tx.query(
        `UPDATE approval_requests SET expires_at = NOW() - interval '5 minutes' WHERE id = $1;`,
        [approvalId]
      );

      await bindingRepo.create(workspaceId, planId, stepId, approvalId, computeCanonicalParameterHash(params));
    });

    const sweeper = new ApprovalSweeper(db);
    const sweptCount = await sweeper.sweepExpiredApprovals();
    expect(sweptCount).toBe(1);

    // Verify DB state: approval is expired, step is failed with failed receipt, plan is failed
    await db.withScopedTransaction(sysScope(), async (tx) => {
      const approvalRepo = new ApprovalRepository(tx);
      const stepRepo = new PlanStepRepository(tx);
      const receiptRepo = new ReceiptRepository(tx);
      const planRepo = new PlanRepository(tx);

      const approval = await approvalRepo.findById(workspaceId, approvalId);
      expect(approval?.status).toBe('expired');

      const step = await stepRepo.findById(workspaceId, stepId);
      expect(step?.status).toBe('failed');

      const receipt = await receiptRepo.findByStepId(workspaceId, stepId);
      expect(receipt?.status).toBe('failed');
      expect(receipt?.verification_method).toBe('approval_expiry');

      const plan = await planRepo.findById(workspaceId, planId);
      expect(plan?.status).toBe('failed');
      const audits=(await new AuditEventRepository(tx).listByWorkspace(workspaceId,100)).events;
      expect(audits.filter(e=>e.action==='approval.expired'&&e.target_id===approvalId)).toHaveLength(1);
      expect(audits.filter(e=>e.action==='step.failed'&&e.target_id===stepId)).toHaveLength(1);
      expect(audits.filter(e=>e.action==='plan.failed'&&e.target_id===planId)).toHaveLength(1);
    });
    expect(await sweeper.sweepExpiredApprovals()).toBe(0);
  });

  it('mixed DAG progress: unblocked read-only step verified while write step waits in awaiting_approval', async () => {
    let planId = '';
    let readStepId = '';
    let writeStepId = '';

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const stepRepo = new PlanStepRepository(tx);
      const depRepo = new PlanStepDependencyRepository(tx);
      const approvalRepo = new ApprovalRepository(tx);
      const bindingRepo = new PlanStepApprovalBindingRepository(tx);

      const plan = await planRepo.create(workspaceId, userId, 'Mixed DAG Plan');
      planId = plan.id;

      // Step 0: Read step
      const s0 = await stepRepo.create(
        workspaceId,
        planId,
        0,
        'test.deterministic_hash_task',
        'write',
        'low',
        'none',
        { read: true },
        computeCanonicalParameterHash({ read: true })
      );
      readStepId = s0.id;

      // Step 1: Write step (depends on step 0)
      const writeParams = { write: true };
      const s1 = await stepRepo.create(
        workspaceId,
        planId,
        1,
        'test.deterministic_hash_task',
        'write',
        'high',
        'explicit',
        writeParams,
        computeCanonicalParameterHash(writeParams)
      );
      writeStepId = s1.id;
      await depRepo.create(workspaceId, planId, writeStepId, readStepId);

      const approval = await approvalRepo.create(workspaceId, 'test.deterministic_hash_task', writeParams, userId, 'high');
      await bindingRepo.create(workspaceId, planId, writeStepId, approval.id, computeCanonicalParameterHash(writeParams));

      // Transition plan and steps after dependencies and bindings are established in draft
      await planRepo.transitionStatus(workspaceId, planId, 'draft', 'running');
      await stepRepo.transitionStatus(workspaceId, readStepId, 'blocked', 'queued');
      await stepRepo.transitionStatus(workspaceId, writeStepId, 'blocked', 'awaiting_approval');
    });

    // Execute read step
    const readOutcome = await processor.process({
      workspaceId,
      jobRunId: readStepId,
      jobName: 'plan.execute_step',
      payload: { planId, stepId: readStepId, actionName: 'test.deterministic_hash_task' }
    });

    expect(readOutcome.success).toBe(true);

    // Verify DB: read step is verified, write step remains in awaiting_approval without prematurely failing/stalling plan
    await db.withScopedTransaction(sysScope(), async (tx) => {
      const stepRepo = new PlanStepRepository(tx);
      const planRepo = new PlanRepository(tx);

      const s0 = await stepRepo.findById(workspaceId, readStepId);
      expect(s0?.status).toBe('verified');

      const s1 = await stepRepo.findById(workspaceId, writeStepId);
      expect(s1?.status).toBe('awaiting_approval');

      const plan = await planRepo.findById(workspaceId, planId);
      expect(plan?.status).toBe('running');
    });
  });

  it('blocks a forged persisted action downgrade before calling its adapter', async () => {
    let planId = '';
    let stepId = '';
    await db.withScopedTransaction(sysScope(), async (tx) => {
      const plans = new PlanRepository(tx);
      const steps = new PlanStepRepository(tx);
      const plan = await plans.create(workspaceId, userId, 'Forged Metadata');
      planId = plan.id;
      await plans.transitionStatus(workspaceId, planId, 'draft', 'queued');
      const params = { connectorName: 'live' };
      const step = await steps.create(workspaceId, planId, 0,
        'system.reset_connector', 'read', 'low', 'none',
        params, computeCanonicalParameterHash(params));
      stepId = step.id;
      await steps.transitionStatus(workspaceId, stepId, 'blocked', 'queued');
    });
    const execute = vi.fn(async (_context: ActionExecutionContext): Promise<ActionResult> => ({
      success: true, status: 'verified', proof: { fake: true }, verificationMethod: 'test'
    }));
    const adapters = new Map(defaultActionAdapters);
    adapters.set('system.reset_connector', {
      name: 'system.reset_connector', idempotencySupport: 'native', execute
    });
    const guardedProcessor = new JobProcessor(db, undefined, undefined, adapters);
    const outcome = await guardedProcessor.process({ workspaceId, jobRunId: stepId,
      jobName: 'plan.execute_step', payload: { planId, stepId } });
    expect(outcome.success).toBe(false);
    expect(outcome.result?.receiptStatus).toBe('failed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects execution when the plan creator loses permission after plan submission', async () => {
    let planId = '';
    let stepId = '';
    await db.withScopedTransaction(sysScope(), async (tx) => {
      const plans = new PlanRepository(tx);
      const steps = new PlanStepRepository(tx);
      const plan = await plans.create(workspaceId, userId, 'Revoked Role');
      planId = plan.id;
      await plans.transitionStatus(workspaceId, planId, 'draft', 'queued');
      const params = { task: 'prepare_environment' };
      const step = await steps.create(workspaceId, planId, 0,
        'test.deterministic_hash_task', 'write', 'low', 'none',
        params, computeCanonicalParameterHash(params));
      stepId = step.id;
      await steps.transitionStatus(workspaceId, stepId, 'blocked', 'queued');
      await tx.query(`UPDATE memberships SET role = 'viewer'
        WHERE workspace_id = $1 AND user_id = $2`, [workspaceId, userId]);
    });
    // viewer cannot execute 'test.deterministic_hash_task' (requires member).
    const outcome = await processor.process({ workspaceId, jobRunId: stepId,
      jobName: 'plan.execute_step', payload: { planId, stepId } });
    expect(outcome.success).toBe(false);
    expect(outcome.result?.receiptStatus).toBe('failed');
  });

  it('Step 64B: 3-step email workflow (compose -> dry_run -> approval-gated step) completes under both late and early approval and passes dependencyProofs', async () => {
    const composeParams = {
      workflowName: 'VIP Onboarding Automation',
      triggerType: 'new_lead_inquiry',
      recipientVariable: 'customer_email',
      emailSubject: 'Welcome {{customer_name}}!',
      emailBodyTemplate: 'Hello {{customer_name}}, your {{tier}} onboarding is ready.',
      allowedVariables: ['customer_email', 'customer_name', 'tier'],
      followUpConditions: [
        { field: 'tier', operator: 'equals', value: 'vip', delayMinutes: 10 }
      ]
    };
    const dryRunParams = {
      ...composeParams,
      sampleData: {
        customer_email: 'ananya@example.com',
        customer_name: 'Ananya',
        tier: 'vip'
      }
    };
    const stepCParams = {
      task: 'stage_verified_email_workflow',
      workflowName: 'VIP Onboarding Automation'
    };

    // --- PART 1: Early Approval (approved BEFORE Step A and Step B run) ---
    let planId = '';
    let stepAId = '';
    let stepBId = '';
    let stepCId = '';

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const stepRepo = new PlanStepRepository(tx);
      const depRepo = new PlanStepDependencyRepository(tx);
      const approvalRepo = new ApprovalRepository(tx);
      const bindingRepo = new PlanStepApprovalBindingRepository(tx);

      const plan = await planRepo.create(workspaceId, userId, 'Early Approved 3-Step Email Plan');
      planId = plan.id;

      const sA = await stepRepo.create(
        workspaceId,
        planId,
        0,
        'automation.email.compose_workflow',
        'read',
        'low',
        'none',
        composeParams,
        computeCanonicalParameterHash(composeParams)
      );
      stepAId = sA.id;

      const sB = await stepRepo.create(
        workspaceId,
        planId,
        1,
        'automation.email.dry_run_test',
        'read',
        'low',
        'none',
        dryRunParams,
        computeCanonicalParameterHash(dryRunParams)
      );
      stepBId = sB.id;
      await depRepo.create(workspaceId, planId, stepBId, stepAId);

      const sC = await stepRepo.create(
        workspaceId,
        planId,
        2,
        'test.approval_gated_hash_task',
        'write',
        'medium',
        'explicit',
        stepCParams,
        computeCanonicalParameterHash(stepCParams)
      );
      stepCId = sC.id;
      await depRepo.create(workspaceId, planId, stepCId, stepBId);

      const approval = await approvalRepo.create(
        workspaceId,
        'test.approval_gated_hash_task',
        stepCParams,
        userId,
        'medium'
      );
      await bindingRepo.create(
        workspaceId,
        planId,
        stepCId,
        approval.id,
        computeCanonicalParameterHash(stepCParams)
      );

      // Submit state: plan awaiting_approval, Step A queued, Step B blocked, Step C awaiting_approval
      await planRepo.transitionStatus(workspaceId, planId, 'draft', 'awaiting_approval');
      await stepRepo.transitionStatus(workspaceId, stepAId, 'blocked', 'queued');
      await stepRepo.transitionStatus(workspaceId, stepCId, 'blocked', 'awaiting_approval');

      // Early approval: approve BEFORE Step A or Step B has executed
      await approvalRepo.transitionStatus(workspaceId, approval.id, 'pending', 'approved', userId);
    });

    // 1. Run Step A -> verifies and enqueues Step B (not Step C!)
    const resA = await processor.process({
      workspaceId,
      jobRunId: stepAId,
      jobName: 'plan.execute_step',
      payload: { planId, stepId: stepAId, actionName: 'automation.email.compose_workflow' }
    });
    expect(resA.success).toBe(true);
    expect(enqueuedJobs.length).toBe(1);
    expect(enqueuedJobs[0]!.payload.stepId).toBe(stepBId);

    // 2. Run Step B -> verifies (checking Step A's workflowHash) and automatically unlocks & enqueues early-approved Step C!
    const resB = await processor.process(enqueuedJobs[0]!);
    expect(resB.success).toBe(true);
    expect(enqueuedJobs.length).toBe(2);
    expect(enqueuedJobs[1]!.payload.stepId).toBe(stepCId);

    // 3. Run Step C -> verifies and completes the entire plan
    const resC = await processor.process(enqueuedJobs[1]!);
    expect(resC.success).toBe(true);
    expect(resC.result?.planCompleted).toBe(true);

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const receiptRepo = new ReceiptRepository(tx);

      const plan = await planRepo.findById(workspaceId, planId);
      expect(plan?.status).toBe('completed');

      const rA = await receiptRepo.findByStepId(workspaceId, stepAId);
      const rB = await receiptRepo.findByStepId(workspaceId, stepBId);
      const rC = await receiptRepo.findByStepId(workspaceId, stepCId);

      expect(rA?.status).toBe('verified');
      expect(rB?.status).toBe('verified');
      expect(rB?.proof.workflowHash).toBe(rA?.proof.workflowHash);
      expect(rC?.status).toBe('verified');
      expect(rC?.proof.verifiedDependencyStepIds).toEqual([stepBId]);
    });
  });

  it('Step 64B: upstream failure in Step B cancels early-approved Step C and prevents Step C execution', async () => {
    const composeParams = {
      workflowName: 'Failing Dry Run Plan',
      triggerType: 'new_lead_inquiry',
      recipientVariable: 'customer_email',
      emailSubject: 'Welcome {{customer_name}}!',
      emailBodyTemplate: 'Hello {{customer_name}}',
      allowedVariables: ['customer_email', 'customer_name']
    };
    const badDryRunParams = {
      ...composeParams,
      sampleData: {
        customer_email: 'not-an-email',
        customer_name: ''
      }
    };
    const stepCParams = { task: 'stage_verified_email_workflow' };

    let planId = '';
    let stepAId = '';
    let stepBId = '';
    let stepCId = '';

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const stepRepo = new PlanStepRepository(tx);
      const depRepo = new PlanStepDependencyRepository(tx);
      const approvalRepo = new ApprovalRepository(tx);
      const bindingRepo = new PlanStepApprovalBindingRepository(tx);

      const plan = await planRepo.create(workspaceId, userId, 'Upstream Failure Plan');
      planId = plan.id;

      const sA = await stepRepo.create(
        workspaceId,
        planId,
        0,
        'automation.email.compose_workflow',
        'read',
        'low',
        'none',
        composeParams,
        computeCanonicalParameterHash(composeParams)
      );
      stepAId = sA.id;

      const sB = await stepRepo.create(
        workspaceId,
        planId,
        1,
        'automation.email.dry_run_test',
        'read',
        'low',
        'none',
        badDryRunParams,
        computeCanonicalParameterHash(badDryRunParams)
      );
      stepBId = sB.id;
      await depRepo.create(workspaceId, planId, stepBId, stepAId);

      const sC = await stepRepo.create(
        workspaceId,
        planId,
        2,
        'test.approval_gated_hash_task',
        'write',
        'medium',
        'explicit',
        stepCParams,
        computeCanonicalParameterHash(stepCParams)
      );
      stepCId = sC.id;
      await depRepo.create(workspaceId, planId, stepCId, stepBId);

      const approval = await approvalRepo.create(
        workspaceId,
        'test.approval_gated_hash_task',
        stepCParams,
        userId,
        'medium'
      );
      await bindingRepo.create(
        workspaceId,
        planId,
        stepCId,
        approval.id,
        computeCanonicalParameterHash(stepCParams)
      );

      await planRepo.transitionStatus(workspaceId, planId, 'draft', 'awaiting_approval');
      await stepRepo.transitionStatus(workspaceId, stepAId, 'blocked', 'queued');
      await stepRepo.transitionStatus(workspaceId, stepCId, 'blocked', 'awaiting_approval');
      await approvalRepo.transitionStatus(workspaceId, approval.id, 'pending', 'approved', userId);
    });

    await processor.process({
      workspaceId,
      jobRunId: stepAId,
      jobName: 'plan.execute_step',
      payload: { planId, stepId: stepAId, actionName: 'automation.email.compose_workflow' }
    });
    expect(enqueuedJobs.length).toBe(1);

    // Step B fails dry-run validation
    const resB = await processor.process(enqueuedJobs[0]!);
    expect(resB.success).toBe(false);
    expect(resB.result?.receiptStatus).toBe('failed');
    // Step C must NOT be enqueued
    expect(enqueuedJobs.length).toBe(1);

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const stepRepo = new PlanStepRepository(tx);

      const plan = await planRepo.findById(workspaceId, planId);
      expect(plan?.status).toBe('failed');

      const sC = await stepRepo.findById(workspaceId, stepCId);
      expect(sC?.status).toBe('cancelled');
    });
  });

  it('Step 64C: idempotent adapter transient throw commits lease release and queued state so immediate retry succeeds', async () => {
    const originalAdapter = defaultActionAdapters.get('test.deterministic_hash_task')!;
    let calls = 0;
    const flakyIdempotentAdapter: ActionAdapter = {
      actionName: 'test.deterministic_hash_task',
      idempotencySupport: 'safe_retry',
      async execute(ctx: ActionExecutionContext): Promise<ActionResult> {
        calls += 1;
        if (calls === 1) {
          throw new Error('Transient network glitch on attempt 1');
        }
        return originalAdapter.execute(ctx);
      }
    };
    defaultActionAdapters.set('test.deterministic_hash_task', flakyIdempotentAdapter);

    try {
      let planId = '';
      let stepId = '';
      const params = { task: 'flaky_idempotent_task' };

      await db.withScopedTransaction(sysScope(), async (tx) => {
        const planRepo = new PlanRepository(tx);
        const stepRepo = new PlanStepRepository(tx);
        const plan = await planRepo.create(workspaceId, userId, 'Step 64C Retry Plan');
        planId = plan.id;
        const step = await stepRepo.create(
          workspaceId,
          planId,
          0,
          'test.deterministic_hash_task',
          'write',
          'low',
          'none',
          params,
          computeCanonicalParameterHash(params),
          3
        );
        stepId = step.id;
        await planRepo.transitionStatus(workspaceId, planId, 'draft', 'running');
        await stepRepo.transitionStatus(workspaceId, stepId, 'blocked', 'queued');
      });

      // Attempt 1 throws so BullMQ can retry, AFTER committing released lease and 'queued' step status
      await expect(
        processor.process({
          workspaceId,
          jobRunId: stepId,
          jobName: 'plan.execute_step',
          payload: { planId, stepId, actionName: 'test.deterministic_hash_task' }
        })
      ).rejects.toThrow('Transient network glitch on attempt 1');

      await db.withScopedTransaction(sysScope(), async (tx) => {
        const stepRepo = new PlanStepRepository(tx);
        const stepExecutionRepo = new StepExecutionRepository(tx);
        const s = await stepRepo.findById(workspaceId, stepId);
        expect(s?.status).toBe('queued');
        const lease = await stepExecutionRepo.findByIdempotencyKey(
          workspaceId,
          `step-exec:${workspaceId}:${planId}:${stepId}`
        );
        expect(lease?.attempt_number).toBe(1);
        expect(lease?.status).toBe('started');
      });

      // Attempt 2 runs immediately (without waiting 60s) and succeeds because the lease was released & committed
      const retryRes = await processor.process({
        workspaceId,
        jobRunId: stepId,
        jobName: 'plan.execute_step',
        payload: { planId, stepId, actionName: 'test.deterministic_hash_task' }
      });
      expect(retryRes.success).toBe(true);
      expect(retryRes.result?.receiptStatus).toBe('verified');
      expect(calls).toBe(2);

      await db.withScopedTransaction(sysScope(), async (tx) => {
        const planRepo = new PlanRepository(tx);
        const stepRepo = new PlanStepRepository(tx);
        const receiptRepo = new ReceiptRepository(tx);
        const stepExecutionRepo = new StepExecutionRepository(tx);

        const plan = await planRepo.findById(workspaceId, planId);
        expect(plan?.status).toBe('completed');

        const s = await stepRepo.findById(workspaceId, stepId);
        expect(s?.status).toBe('verified');

        const receipts = await receiptRepo.listByPlanId(workspaceId, planId);
        expect(receipts.length).toBe(1);
        expect(receipts[0]?.status).toBe('verified');

        const lease = await stepExecutionRepo.findByIdempotencyKey(
          workspaceId,
          `step-exec:${workspaceId}:${planId}:${stepId}`
        );
        expect(lease?.attempt_number).toBe(2);
        expect(lease?.status).toBe('completed');
        const audits=(await new AuditEventRepository(tx).listByWorkspace(workspaceId,100)).events;
        expect(audits.filter(e=>e.action==='step.started'&&e.target_id===stepId).map(e=>e.payload.attemptNumber).sort()).toEqual([1,2]);
        const retries=audits.filter(e=>e.action==='step.retry_scheduled'&&e.target_id===stepId);
        expect(retries).toHaveLength(1);
        expect(retries[0]?.payload.attemptNumber).toBe(1);
        expect(audits.filter(e=>e.action==='step.queued'&&e.target_id===stepId)).toHaveLength(2);
        expect(audits.filter(e=>e.action==='step.verified'&&e.target_id===stepId)).toHaveLength(1);
        expect(audits.filter(e=>e.action==='plan.completed'&&e.target_id===planId)).toHaveLength(1);
        expect(JSON.stringify(audits)).not.toContain('Transient network glitch');
        expect(JSON.stringify(audits)).not.toContain('flaky_idempotent_task');
      });
    } finally {
      defaultActionAdapters.set('test.deterministic_hash_task', originalAdapter);
    }
  });

  it('Step 64C: non-idempotent adapter throw never retries and immediately records unverified receipt', async () => {
    const originalAdapter = defaultActionAdapters.get('test.approval_gated_hash_task')!;
    let calls = 0;
    const nonIdempotentThrowingAdapter: ActionAdapter = {
      actionName: 'test.approval_gated_hash_task',
      idempotencySupport: 'none',
      async execute(_ctx: ActionExecutionContext): Promise<ActionResult> {
        calls += 1;
        throw new Error('Socket closed mid-mutation; external state unknown');
      }
    };
    defaultActionAdapters.set('test.approval_gated_hash_task', nonIdempotentThrowingAdapter);

    try {
      let planId = '';
      let stepId = '';
      const params = { task: 'non_idempotent_throw_task' };

      await db.withScopedTransaction(sysScope(), async (tx) => {
        const planRepo = new PlanRepository(tx);
        const stepRepo = new PlanStepRepository(tx);
        const approvalRepo = new ApprovalRepository(tx);
        const bindingRepo = new PlanStepApprovalBindingRepository(tx);

        const plan = await planRepo.create(workspaceId, userId, 'Step 64C Non-Idempotent Plan');
        planId = plan.id;
        const step = await stepRepo.create(
          workspaceId,
          planId,
          0,
          'test.approval_gated_hash_task',
          'write',
          'medium',
          'explicit',
          params,
          computeCanonicalParameterHash(params),
          3
        );
        stepId = step.id;

        const approval = await approvalRepo.create(
          workspaceId,
          'test.approval_gated_hash_task',
          params,
          userId,
          'medium'
        );
        await bindingRepo.create(
          workspaceId,
          planId,
          stepId,
          approval.id,
          computeCanonicalParameterHash(params)
        );
        await approvalRepo.transitionStatus(workspaceId, approval.id, 'pending', 'approved', userId);
        await planRepo.transitionStatus(workspaceId, planId, 'draft', 'running');
        await stepRepo.transitionStatus(workspaceId, stepId, 'blocked', 'queued');
      });

      const res = await processor.process({
        workspaceId,
        jobRunId: stepId,
        jobName: 'plan.execute_step',
        payload: { planId, stepId, actionName: 'test.approval_gated_hash_task' }
      });

      expect(res.success).toBe(false);
      expect(res.result?.receiptStatus).toBe('unverified');
      expect(calls).toBe(1);

      await db.withScopedTransaction(sysScope(), async (tx) => {
        const planRepo = new PlanRepository(tx);
        const stepRepo = new PlanStepRepository(tx);
        const receiptRepo = new ReceiptRepository(tx);
        const stepExecutionRepo = new StepExecutionRepository(tx);

        const plan = await planRepo.findById(workspaceId, planId);
        expect(plan?.status).toBe('failed');

        const s = await stepRepo.findById(workspaceId, stepId);
        expect(s?.status).toBe('unverified');

        const receipts = await receiptRepo.listByPlanId(workspaceId, planId);
        expect(receipts.length).toBe(1);
        expect(receipts[0]?.status).toBe('unverified');
        expect(receipts[0]?.verification_method).toBe('crash_recovery_conservative');

        const lease = await stepExecutionRepo.findByIdempotencyKey(
          workspaceId,
          `step-exec:${workspaceId}:${planId}:${stepId}`
        );
        expect(lease?.attempt_number).toBe(1);
        expect(lease?.status).toBe('failed');
      });
    } finally {
      defaultActionAdapters.set('test.approval_gated_hash_task', originalAdapter);
    }
  });

  it('Step 90: ApprovalSweeper.sweepOrphanedPlanSteps recovers eligible orphaned queued steps after restart/enqueue failure, skips cancelled/rejected/unauthorized/dependency-blocked steps, and prevents duplicate execution under concurrency', async () => {
    let eligiblePlanId = '';
    let eligibleStepId = '';
    let blockedPlanId = '';
    let cancelledPlanId = '';
    let rejectedPlanId = '';
    let unauthorizedPlanId = '';

    const viewerUser = await new UserRepository(db).create('viewer-step90@org.com', 'hash', 'Viewer 90');

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const stepRepo = new PlanStepRepository(tx);
      const depRepo = new PlanStepDependencyRepository(tx);
      const approvalRepo = new ApprovalRepository(tx);
      const bindingRepo = new PlanStepApprovalBindingRepository(tx);
      const membershipRepo = new MembershipRepository(tx);

      await membershipRepo.create(workspaceId, viewerUser.id, 'viewer');

      // 1. Eligible orphaned queued step (approval committed, enqueue failed before worker ran)
      const pEligible = await planRepo.create(workspaceId, userId, 'Eligible Orphan Plan');
      eligiblePlanId = pEligible.id;
      const params = { task: 'recover_after_enqueue_failure' };
      const paramHash = computeCanonicalParameterHash(params);
      const sEligible = await stepRepo.create(
        workspaceId,
        eligiblePlanId,
        0,
        'test.approval_gated_hash_task',
        'write',
        'medium',
        'explicit',
        params,
        paramHash
      );
      eligibleStepId = sEligible.id;
      const appEligible = await approvalRepo.create(
        workspaceId,
        'test.approval_gated_hash_task',
        params,
        userId,
        'medium'
      );
      await bindingRepo.create(workspaceId, eligiblePlanId, eligibleStepId, appEligible.id, paramHash);
      await approvalRepo.transitionStatus(workspaceId, appEligible.id, 'pending', 'approved', userId);
      await planRepo.transitionStatus(workspaceId, eligiblePlanId, 'draft', 'queued');
      await stepRepo.transitionStatus(workspaceId, eligibleStepId, 'blocked', 'queued');

      // 2. Dependency-blocked step (parent not verified) -> must NOT be recovered
      const pBlocked = await planRepo.create(workspaceId, userId, 'Dependency Blocked Plan');
      blockedPlanId = pBlocked.id;
      const sParent = await stepRepo.create(
        workspaceId,
        blockedPlanId,
        0,
        'test.approval_gated_hash_task',
        'write',
        'medium',
        'explicit',
        params,
        paramHash
      );
      const sChild = await stepRepo.create(
        workspaceId,
        blockedPlanId,
        1,
        'test.deterministic_hash_task',
        'write',
        'low',
        'none',
        params,
        paramHash
      );
      await depRepo.create(workspaceId, blockedPlanId, sChild.id, sParent.id);
      await planRepo.transitionStatus(workspaceId, blockedPlanId, 'draft', 'awaiting_approval');
      await stepRepo.transitionStatus(workspaceId, sParent.id, 'blocked', 'awaiting_approval');
      await stepRepo.transitionStatus(workspaceId, sChild.id, 'blocked', 'queued');

      // 3. Cancelled plan step -> must NOT be recovered
      const pCancelled = await planRepo.create(workspaceId, userId, 'Cancelled Plan');
      cancelledPlanId = pCancelled.id;
      const sCancelled = await stepRepo.create(
        workspaceId,
        cancelledPlanId,
        0,
        'test.deterministic_hash_task',
        'write',
        'low',
        'none',
        params,
        paramHash
      );
      await planRepo.transitionStatus(workspaceId, cancelledPlanId, 'draft', 'cancelled');
      await stepRepo.transitionStatus(workspaceId, sCancelled.id, 'blocked', 'queued');

      // 4. Rejected approval step -> must NOT be recovered
      const pRejected = await planRepo.create(workspaceId, userId, 'Rejected Plan');
      rejectedPlanId = pRejected.id;
      const sRejected = await stepRepo.create(
        workspaceId,
        rejectedPlanId,
        0,
        'test.approval_gated_hash_task',
        'write',
        'medium',
        'explicit',
        params,
        paramHash
      );
      const appRejected = await approvalRepo.create(
        workspaceId,
        'test.approval_gated_hash_task',
        params,
        userId,
        'medium'
      );
      await bindingRepo.create(workspaceId, rejectedPlanId, sRejected.id, appRejected.id, paramHash);
      await approvalRepo.transitionStatus(workspaceId, appRejected.id, 'pending', 'rejected', userId);
      await planRepo.transitionStatus(workspaceId, rejectedPlanId, 'draft', 'queued');
      await stepRepo.transitionStatus(workspaceId, sRejected.id, 'blocked', 'queued');

      // 5. Unauthorized creator (viewer role) step -> must NOT be recovered
      const pUnauth = await planRepo.create(workspaceId, viewerUser.id, 'Unauthorized Viewer Plan');
      unauthorizedPlanId = pUnauth.id;
      const sUnauth = await stepRepo.create(
        workspaceId,
        unauthorizedPlanId,
        0,
        'test.deterministic_hash_task',
        'write',
        'low',
        'none',
        params,
        paramHash
      );
      await planRepo.transitionStatus(workspaceId, unauthorizedPlanId, 'draft', 'queued');
      await stepRepo.transitionStatus(workspaceId, sUnauth.id, 'blocked', 'queued');
    });

    const sweeperJobs: JobData[] = [];
    const sweeper = new ApprovalSweeper(db, undefined, async (job) => {
      sweeperJobs.push(job);
    });

    const recoveredCount = await sweeper.sweepOrphanedPlanSteps();
    expect(recoveredCount).toBe(1);
    expect(sweeperJobs).toHaveLength(1);
    expect(sweeperJobs[0]).toEqual({
      workspaceId,
      jobRunId: eligibleStepId,
      jobName: 'plan.execute_step',
      payload: {
        planId: eligiblePlanId,
        stepId: eligibleStepId,
        stepIndex: 0,
        actionName: 'test.approval_gated_hash_task'
      }
    });

    // Execute concurrently across two worker processors to verify lease + idempotency prevent duplicate execution
    const processor2 = new JobProcessor(db, undefined, async (data) => {
      enqueuedJobs.push(data);
    });
    const [runA, runB] = await Promise.all([
      processor.process(sweeperJobs[0]!),
      processor2.process(sweeperJobs[0]!)
    ]);
    expect(runA.success).toBe(true);
    expect(runB.success).toBe(true);
    expect(
      Boolean(runA.result?.duplicateAcknowledged) !== Boolean(runB.result?.duplicateAcknowledged)
    ).toBe(true);

    // Subsequent sweep after execution finds 0 orphaned steps
    const secondSweepCount = await sweeper.sweepOrphanedPlanSteps();
    expect(secondSweepCount).toBe(0);

    await db.withScopedTransaction(sysScope(), async (tx) => {
      const planRepo = new PlanRepository(tx);
      const receiptRepo = new ReceiptRepository(tx);
      const finalPlan = await planRepo.findById(workspaceId, eligiblePlanId);
      const receipts = await receiptRepo.listByPlanId(workspaceId, eligiblePlanId);
      expect(finalPlan?.status).toBe('completed');
      expect(receipts).toHaveLength(1);
      expect(receipts[0]?.status).toBe('verified');
    });
  });
});
