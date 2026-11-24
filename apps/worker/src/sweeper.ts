import { computeCanonicalParameterHash } from '@thaara/contracts';
import {
  ApprovalRepository,
  MembershipRepository,
  PlanRepository,
  PlanStepApprovalBindingRepository,
  PlanStepRepository,
  ReceiptRepository,
  StepExecutionRepository,
  DbClient,
  TransactionalDbClient,
  AuthenticatedScope,
  hashSessionToken,
  AssistantStreamRepository,
  RoleAwarePool
} from '@thaara/db';
import { Logger, defaultLogger } from '@thaara/observability';
import {
  N8N_CREATE_ACTION,
  defaultActionRegistry,
  defaultPolicyGateway
} from '@thaara/policy';
import type { JobData, StepEnqueuer } from './processor.js';

export interface SweeperOptions {
  intervalMs?: number;
  logger?: Logger;
}

export class ApprovalSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private db: TransactionalDbClient,
    private logger: Logger = defaultLogger,
    private stepEnqueuer?: StepEnqueuer
  ) {}

  /**
   * Sweeps expired pending approval requests safely using FOR UPDATE OF ar, ps SKIP LOCKED.
   * Cascades expiration to bound plan steps with truthful 'failed' receipts and transitions.
   */
  async sweepExpiredApprovals(): Promise<number> {
    const systemScope: AuthenticatedScope = {
      workspaceId: '00000000-0000-0000-0000-000000000000',
      userId: '00000000-0000-0000-0000-000000000000',
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken('system-sweeper-0000')
    };

    return await this.db.withScopedTransaction(systemScope, async (txClient) => {
      const { rows } = await txClient.query<{
        id: string;
        workspace_id: string;
        step_id: string | null;
        plan_id: string | null;
      }>(
        `SELECT ar.id, ar.workspace_id, b.step_id, b.plan_id
         FROM approval_requests ar
         LEFT JOIN plan_step_approval_bindings b
           ON b.workspace_id = ar.workspace_id AND b.approval_request_id = ar.id
         LEFT JOIN plan_steps ps
           ON ps.workspace_id = b.workspace_id AND ps.plan_id = b.plan_id AND ps.id = b.step_id
         WHERE ar.status = 'pending' AND ar.expires_at <= NOW()
         FOR UPDATE OF ar SKIP LOCKED;`
      );

      if (rows.length === 0) return 0;

      for (const row of rows) {
        const expired = await new ApprovalRepository(txClient).transitionStatus(
          row.workspace_id, row.id, 'pending', 'expired');
        if (!expired) continue;

        if (row.step_id && row.plan_id) {
          const steps = new PlanStepRepository(txClient);
          const failed = await steps.transitionStatus(row.workspace_id, row.step_id,
            'awaiting_approval', 'failed', { reason: 'Approval request expired' });
          if (failed && !await new ReceiptRepository(txClient).findByStepId(row.workspace_id, row.step_id)) {
            await new ReceiptRepository(txClient).create(row.workspace_id, row.plan_id, row.step_id,
              failed.action_name, 'failed', { reason: 'Approval request expired' }, 'approval_expiry');
          }
          await new PlanRepository(txClient).transitionStatus(row.workspace_id, row.plan_id,
            ['awaiting_approval', 'running', 'queued'], 'failed');
          await steps.cancelNonTerminalSteps(row.workspace_id, row.plan_id);
        }
      }

      this.logger.info(`[ApprovalSweeper] Swept and expired ${rows.length} approvals`, {
        context: { expiredCount: rows.length }
      });

      return rows.length;
    });
  }

  /**
   * Recovers eligible orphaned queued (or approved-but-unqueued / expired-lease) plan steps
   * after post-commit enqueue failures or worker restarts, using deterministic job IDs and
   * enforcing dependencies, approval bindings, fresh creator authorization, and PolicyGateway.
   */
  async sweepOrphanedPlanSteps(batchSize = 50): Promise<number> {
    if (!this.stepEnqueuer) {
      return 0;
    }

    const systemScope: AuthenticatedScope = {
      workspaceId: '00000000-0000-0000-0000-000000000000',
      userId: '00000000-0000-0000-0000-000000000000',
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken('system-orphan-step-sweeper-0000')
    };

    const jobsToEnqueue = await this.db.withScopedTransaction(systemScope, async (txClient) => {
      const { rows } = await txClient.query<{
        id: string;
        workspace_id: string;
        plan_id: string;
      }>(
        `SELECT ps.id, ps.workspace_id, ps.plan_id
         FROM plan_steps ps
         INNER JOIN plans p
           ON p.workspace_id = ps.workspace_id AND p.id = ps.plan_id
         LEFT JOIN step_executions se
           ON se.workspace_id = ps.workspace_id AND se.step_id = ps.id
         WHERE p.status IN ('queued', 'running', 'awaiting_approval')
           AND ps.status IN ('queued', 'awaiting_approval', 'running')
           AND ps.action_name <> $1
           AND (
             se.id IS NULL
             OR (se.status = 'started' AND se.lease_expires_at <= NOW())
           )
         ORDER BY ps.created_at ASC, ps.step_index ASC
         LIMIT $2
         FOR UPDATE OF ps SKIP LOCKED;`,
        [N8N_CREATE_ACTION, batchSize]
      );

      if (rows.length === 0) {
        return [] as JobData[];
      }

      const planRepo = new PlanRepository(txClient);
      const stepRepo = new PlanStepRepository(txClient);
      const receiptRepo = new ReceiptRepository(txClient);
      const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
      const approvalRepo = new ApprovalRepository(txClient);
      const membershipRepo = new MembershipRepository(txClient);
      const stepExecRepo = new StepExecutionRepository(txClient);
      const recoveredJobs: JobData[] = [];

      for (const row of rows) {
        const existingReceipt = await receiptRepo.findByStepId(row.workspace_id, row.id);
        if (existingReceipt) {
          continue;
        }
        const plan = await planRepo.findById(row.workspace_id, row.plan_id);
        if (!plan || ['completed', 'failed', 'cancelled', 'draft'].includes(plan.status)) {
          continue;
        }

        const allSteps = await stepRepo.listByPlanId(row.workspace_id, row.plan_id);
        const stepMap = new Map(allSteps.map((s) => [s.id, s]));
        const step = stepMap.get(row.id);
        if (!step || !['queued', 'awaiting_approval', 'running'].includes(step.status)) {
          continue;
        }

        const dependenciesSatisfied = step.depends_on_step_ids.every((depId) => {
          const parent = stepMap.get(depId);
          return parent && parent.status === 'verified';
        });
        if (!dependenciesSatisfied) {
          continue;
        }

        const actionDefinition = defaultActionRegistry.get(step.action_name);
        if (
          !actionDefinition ||
          step.action_class !== actionDefinition.actionClass ||
          step.risk_level !== actionDefinition.risk ||
          step.approval_mode !== actionDefinition.approvalMode ||
          step.parameter_hash !== computeCanonicalParameterHash(step.parameters)
        ) {
          continue;
        }

        const binding = await bindingRepo.findByStepId(row.workspace_id, step.id);
        const approvalRecord = binding
          ? await approvalRepo.findById(row.workspace_id, binding.approval_request_id)
          : null;

        if (step.action_class === 'write' && step.approval_mode !== 'none') {
          if (
            !binding ||
            !approvalRecord ||
            approvalRecord.status !== 'approved' ||
            new Date(approvalRecord.expires_at) <= new Date() ||
            binding.parameter_hash !== step.parameter_hash
          ) {
            continue;
          }
        }

        const creatorMembership = await membershipRepo.findByUserAndWorkspace(
          row.workspace_id,
          plan.created_by_user_id
        );
        if (!creatorMembership) {
          continue;
        }

        const idempotencyKey = `step-exec:${row.workspace_id}:${row.plan_id}:${step.id}`;
        const existingExec = await stepExecRepo.findByIdempotencyKey(
          row.workspace_id,
          idempotencyKey
        );
        if (
          existingExec &&
          (existingExec.status !== 'started' ||
            new Date(existingExec.lease_expires_at) > new Date())
        ) {
          continue;
        }

        const approvedRequest = approvalRecord
          ? {
              id: approvalRecord.id,
              workspaceId: approvalRecord.workspace_id,
              actionName: approvalRecord.action_name,
              actionParams: approvalRecord.action_params,
              requesterUserId: approvalRecord.requester_user_id,
              approverUserId: approvalRecord.approver_user_id,
              status: approvalRecord.status,
              riskLevel: approvalRecord.risk_level,
              expiresAt: approvalRecord.expires_at,
              createdAt: approvalRecord.created_at,
              updatedAt: approvalRecord.updated_at
            }
          : null;

        const decision = defaultPolicyGateway.evaluate(
          {
            workspaceId: row.workspace_id,
            userId: plan.created_by_user_id,
            role: creatorMembership.role
          },
          {
            actionName: step.action_name,
            parameters: step.parameters,
            idempotencyKey
          },
          approvedRequest,
          plan.created_by_user_id
        );
        if (!decision.allowed) {
          continue;
        }

        if (step.status === 'awaiting_approval') {
          await stepRepo.transitionStatus(
            row.workspace_id,
            step.id,
            'awaiting_approval',
            'queued'
          );
          if (plan.status === 'awaiting_approval') {
            await planRepo.transitionStatus(
              row.workspace_id,
              row.plan_id,
              'awaiting_approval',
              'queued'
            );
          }
        }

        recoveredJobs.push({
          workspaceId: row.workspace_id,
          jobRunId: step.id,
          jobName: 'plan.execute_step',
          payload: {
            planId: row.plan_id,
            stepId: step.id,
            stepIndex: step.step_index,
            actionName: step.action_name
          }
        });
      }

      return recoveredJobs;
    });

    let enqueuedCount = 0;
    for (const job of jobsToEnqueue) {
      await this.stepEnqueuer(job);
      enqueuedCount++;
    }

    if (enqueuedCount > 0) {
      this.logger.info(`[ApprovalSweeper] Recovered and enqueued ${enqueuedCount} orphaned plan steps`, {
        context: { enqueuedCount }
      });
    }

    return enqueuedCount;
  }

  start(intervalMs = 10000): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(async () => {
      try {
        await this.sweepExpiredApprovals();
        await this.sweepOrphanedPlanSteps();
      } catch (err) {
        this.logger.error('[ApprovalSweeper] Error sweeping approvals and orphaned steps', {
          error: { name: (err as Error).name, message: (err as Error).message }
        });
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }
}

export class AssistantStreamSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private db: DbClient | TransactionalDbClient | RoleAwarePool,
    private logger: Logger = defaultLogger
  ) {
    if (process.env.NODE_ENV !== 'test') {
      const isRolePool = Boolean(
        this.db &&
        'checkout' in this.db &&
        'withRoleClient' in this.db &&
        (this.db as any).targetRole === 'thaara_worker'
      );
      if (!isRolePool) {
        throw new Error(
          '[AssistantStreamSweeper] Fatal: AssistantStreamSweeper requires a RoleAwarePool configured for thaara_worker in all non-test environments.'
        );
      }
    }
  }

  /**
   * Reconciles stale assistant stream executions (> 60s in queued or streaming state)
   * using public.reconcile_stale_assistant_streams($1).
   */
  async reconcileStaleStreams(batchSize = 50): Promise<{ recoveredCount: number; streamIds: string[] }> {
    let result: { recovered_count: number; stream_ids: string[] };

    if (this.db && 'withRoleClient' in this.db && typeof (this.db as any).withRoleClient === 'function') {
      if (process.env.NODE_ENV !== 'test' && (this.db as any).targetRole !== 'thaara_worker') {
        throw new Error(
          '[AssistantStreamSweeper] Fatal: AssistantStreamSweeper requires a RoleAwarePool configured for thaara_worker in all non-test environments.'
        );
      }
      result = await (this.db as any).withRoleClient(async (client: DbClient) => {
        const repo = new AssistantStreamRepository(client);
        return await repo.reconcileStaleStreams(batchSize);
      });
    } else {
      if (process.env.NODE_ENV !== 'test') {
        throw new Error(
          '[AssistantStreamSweeper] Fatal: Worker-role access is unavailable in non-test environment; PGlite fallback is test-only.'
        );
      }
      const repo = new AssistantStreamRepository(this.db as any);
      const res = await repo.reconcileStaleStreams(batchSize);
      result = { recovered_count: res.recovered_count, stream_ids: res.stream_ids };
    }

    if (result.recovered_count > 0) {
      this.logger.info(`[AssistantStreamSweeper] Reconciled ${result.recovered_count} stale assistant streams`, {
        context: { recoveredCount: result.recovered_count, streamIds: result.stream_ids }
      });
    }

    return {
      recoveredCount: result.recovered_count,
      streamIds: result.stream_ids
    };
  }

  start(intervalMs = 15000): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(async () => {
      try {
        await this.reconcileStaleStreams();
      } catch (err) {
        this.logger.error('[AssistantStreamSweeper] Error reconciling stale assistant streams', {
          error: { name: (err as Error).name, message: (err as Error).message }
        });
      }
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
  }
}

