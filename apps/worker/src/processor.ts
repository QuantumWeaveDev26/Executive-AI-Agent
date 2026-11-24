import os from 'node:os';
import crypto from 'node:crypto';
import {
  ApprovalRepository,
  AuditEventRepository,
  JobRunRepository,
  MembershipRepository,
  PlanRepository,
  PlanStepApprovalBindingRepository,
  PlanStepRepository,
  ReceiptRepository,
  StepExecutionRepository,
  TransactionalDbClient,
  AuthenticatedScope,
  hashSessionToken
} from '@thaara/db';
import { Logger, defaultLogger } from '@thaara/observability';
import { computeCanonicalParameterHash } from '@thaara/contracts';
import {
  N8N_CREATE_ACTION,
  ActionAdapter,
  ActionExecutionContext,
  ActionResult,
  defaultActionAdapters,
  defaultActionRegistry,
  defaultPolicyGateway
} from '@thaara/policy';
import { RoleAwarePool } from '@thaara/db';
import { PrivacyPurgeProcessor } from './privacy-purge-processor.js';

export interface JobData {
  workspaceId: string;
  jobRunId: string;
  jobName: string;
  payload: Record<string, unknown>;
  maxRetries?: number;
}

export type StepEnqueuer = (data: JobData) => Promise<void>;

export class JobProcessor {
  private workerId: string;
  private privacyPurgeProcessor: PrivacyPurgeProcessor;

  constructor(
    private db: TransactionalDbClient,
    private logger: Logger = defaultLogger,
    private stepEnqueuer?: StepEnqueuer,
    private adapters: Map<string, ActionAdapter> = defaultActionAdapters,
    private workerPool?: RoleAwarePool
  ) {
    this.workerId = `${os.hostname()}:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
    const purgeDb = this.workerPool ?? this.db;
    this.privacyPurgeProcessor = new PrivacyPurgeProcessor(
      purgeDb,
      { enqueue: (d) => (this.stepEnqueuer ? this.stepEnqueuer(d) : Promise.resolve()) },
      this.logger,
      { workerId: this.workerId }
    );
  }

  async process(
    data: JobData,
    attemptNumber = 1
  ): Promise<{ success: boolean; result?: Record<string, unknown> }> {
    const { workspaceId, jobRunId, jobName, payload, maxRetries = 3 } = data;

    // Special handling for background privacy purge
    if (jobName === 'privacy.purge_operation') {
      return await this.privacyPurgeProcessor.processPurge(data, attemptNumber);
    }
    const systemScope: AuthenticatedScope = {
      workspaceId,
      userId: '00000000-0000-0000-0000-000000000000',
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken(`system-worker-${workspaceId}`)
    };

    this.logger.info(`[Worker] Leased job execution`, {
      workspaceId,
      context: { jobRunId, jobName, attemptNumber, workerId: this.workerId }
    });

    // Special handling for governed plan step execution DAG
    if (jobName === 'plan.execute_step') {
      try {
        const res = await this.executePlanStep(data, attemptNumber);
        this.logger.info(`[Worker] Plan step execution finished`, {
          workspaceId,
          context: { jobRunId, stepId: payload.stepId, success: res.success, result: res.result }
        });
        return res;
      } catch (stepErr) {
        this.logger.error(`[Worker] Plan step execution threw exception`, {
          workspaceId,
          context: {
            jobRunId,
            stepId: payload.stepId,
            error: (stepErr as Error).message,
            stack: (stepErr as Error).stack
          }
        });
        throw stepErr;
      }
    }

    // Standard job run processing with job_runs table
    await this.db.withScopedTransaction(systemScope, async (txClient) => {
      const jobRepo = new JobRunRepository(txClient);
      await jobRepo.updateStatus(workspaceId, jobRunId, 'processing');
    });

    try {
      const result = await this.executeJobLogic(jobName, payload, attemptNumber);

      if (result.status === 'not_configured') {
        const errorMsg =
          (result.message as string) || 'External connector credentials are not configured.';
        await this.db.withScopedTransaction(systemScope, async (txClient) => {
          const jobRepo = new JobRunRepository(txClient);
          const auditRepo = new AuditEventRepository(txClient);

          await jobRepo.updateStatus(workspaceId, jobRunId, 'failed', result, errorMsg);
          await auditRepo.create(
            workspaceId,
            'job.not_configured',
            'job_run',
            { jobName, attemptNumber, result, error: errorMsg },
            null,
            jobRunId
          );
        });

        this.logger.warn(`[Worker] Connector not configured: ${jobName}`, {
          workspaceId,
          context: { jobRunId, jobName, result }
        });

        return { success: false, result };
      }

      await this.db.withScopedTransaction(systemScope, async (txClient) => {
        const jobRepo = new JobRunRepository(txClient);
        const auditRepo = new AuditEventRepository(txClient);

        await jobRepo.updateStatus(workspaceId, jobRunId, 'completed', result);
        await auditRepo.create(
          workspaceId,
          'job.completed',
          'job_run',
          { jobName, attemptNumber, result },
          null,
          jobRunId
        );
      });

      this.logger.info(`[Worker] Job completed successfully`, {
        workspaceId,
        context: { jobRunId, jobName }
      });

      return { success: true, result };
    } catch (err) {
      const errorMsg = (err as Error).message || 'Unknown execution error';

      if (attemptNumber < maxRetries) {
        await this.db.withScopedTransaction(systemScope, async (txClient) => {
          const jobRepo = new JobRunRepository(txClient);
          await jobRepo.incrementRetry(workspaceId, jobRunId, errorMsg);
        });

        this.logger.warn(`[Worker] Job transient failure, will retry`, {
          workspaceId,
          context: { jobRunId, jobName, attemptNumber, error: errorMsg }
        });

        throw err;
      }

      await this.db.withScopedTransaction(systemScope, async (txClient) => {
        const jobRepo = new JobRunRepository(txClient);
        const auditRepo = new AuditEventRepository(txClient);

        await jobRepo.updateStatus(workspaceId, jobRunId, 'failed', null, errorMsg);
        await auditRepo.create(
          workspaceId,
          'job.failed',
          'job_run',
          { jobName, attemptNumber, error: errorMsg },
          null,
          jobRunId
        );
      });

      this.logger.error(`[Worker] Job permanently failed`, {
        workspaceId,
        context: { jobRunId, jobName, attemptNumber, error: errorMsg }
      });

      return { success: false };
    }
  }

  private async executePlanStep(
    data: JobData,
    _attemptNumber: number
  ): Promise<{ success: boolean; result?: Record<string, unknown> }> {
    const { workspaceId, payload, maxRetries = 3 } = data;
    const planId = payload.planId as string;
    const stepId = payload.stepId as string;
    const idempotencyKey = `step-exec:${workspaceId}:${planId}:${stepId}`;
    const leaseToken = crypto.randomUUID();

    const systemScope: AuthenticatedScope = {
      workspaceId,
      userId: '00000000-0000-0000-0000-000000000000',
      role: 'owner' as const,
      sessionTokenHash: hashSessionToken(`system-plan-step-${workspaceId}`)
    };

    // n8n is explicitly manual-only in this foundation; never consume it in a background worker.
    let manualOnly = false;
    // 1. Atomic lease acquisition check
    let executionLease = await this.db.withScopedTransaction(systemScope, async (txClient) => {
      const storedStep = await new PlanStepRepository(txClient).findById(workspaceId, stepId);
      if (storedStep?.plan_id === planId && storedStep.action_name === N8N_CREATE_ACTION) {
        manualOnly = true;
        return null;
      }
      const stepExecutionRepo = new StepExecutionRepository(txClient);
      return stepExecutionRepo.acquireLease(
        workspaceId,
        planId,
        stepId,
        idempotencyKey,
        this.workerId,
        leaseToken,
        60000
      );
    });

    if (manualOnly) return { success: true, result: { manualExecutionRequired: true } };

    // Handle lease conflict: active lease or terminal execution — never fall through without a lease
    if (!executionLease) {
      const existing = await this.db.withScopedTransaction(systemScope, async (txClient) => {
        const stepExecutionRepo = new StepExecutionRepository(txClient);
        return stepExecutionRepo.findByIdempotencyKey(workspaceId, idempotencyKey);
      });

      if (existing && (existing.status === 'completed' || existing.status === 'failed')) {
        this.logger.info(`[Worker] Execution already terminal (${existing.status}); duplicate acknowledged`, {
          workspaceId,
          context: { planId, stepId, terminalStatus: existing.status }
        });
        return { success: existing.status === 'completed', result: { duplicateAcknowledged: true } };
      }

      this.logger.info(`[Worker] Lease not acquired for step ${stepId}; duplicate acknowledged cleanly`, {
        workspaceId,
        context: { planId, stepId, activeWorkerId: existing?.worker_id ?? null }
      });
      return { success: true, result: { duplicateAcknowledged: true } };
    }

    const stepsToEnqueue: JobData[] = [];

    const executionResult = await this.db.withScopedTransaction(systemScope, async (txClient) => {
      const planRepo = new PlanRepository(txClient);
      const stepRepo = new PlanStepRepository(txClient);
      const receiptRepo = new ReceiptRepository(txClient);
      const approvalRepo = new ApprovalRepository(txClient);
      const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
      const stepExecutionRepo = new StepExecutionRepository(txClient);
      const auditRepo = new AuditEventRepository(txClient);

      const plan = await planRepo.findById(workspaceId, planId);
      if (!plan) {
        throw new Error(`Plan '${planId}' not found.`);
      }

      // Check In-Flight Cancellation Truthfulness
      if (plan.status === 'cancelled') {
        await stepRepo.transitionStatus(
          workspaceId,
          stepId,
          ['queued', 'ready', 'blocked', 'running'],
          'cancelled'
        );

        // Controlled Trigger Exception: in-flight cancelled step produces an unverified receipt
        const receipt = await receiptRepo.create(
          workspaceId,
          planId,
          stepId,
          payload.actionName as string || 'cancelled_action',
          'unverified',
          { reason: 'Plan was cancelled while step was scheduled or running' },
          'cancellation_audit'
        );

        await stepExecutionRepo.failLease(workspaceId, executionLease.id, executionLease.lease_token);

        return {
          success: false,
          result: { receiptStatus: 'unverified', receiptId: receipt.id, cancelled: true }
        };
      }

      if (plan.status === 'failed') {
        await stepRepo.transitionStatus(
          workspaceId,
          stepId,
          ['queued', 'ready', 'blocked', 'running'],
          'cancelled'
        );
        await stepExecutionRepo.failLease(workspaceId, executionLease.id, executionLease.lease_token);
        return { success: false, result: { reason: 'Plan has already failed' } };
      }

      const step = await stepRepo.findById(workspaceId, stepId);
      if (!step) {
        throw new Error(`Step '${stepId}' not found.`);
      }

      if (['verified', 'unverified', 'failed', 'not_configured', 'cancelled', 'skipped'].includes(step.status)) {
        return { success: step.status === 'verified', result: { stepStatus: step.status } };
      }

      // Transition step and plan to running
      if (step.status !== 'running') {
        await stepRepo.transitionStatus(
          workspaceId,
          stepId,
          ['queued', 'ready', 'blocked'],
          'running'
        );
      }
      if (plan.status !== 'running') {
        await planRepo.transitionStatus(
          workspaceId,
          planId,
          ['draft', 'queued', 'awaiting_approval'],
          'running'
        );
      }

      // 2. Validate Parent Dependencies & Collect Verified Dependency Proofs
      const dependencyProofs: Record<string, Record<string, unknown>> = {};
      for (const parentId of step.depends_on_step_ids) {
        const parent = await stepRepo.findById(workspaceId, parentId);
        if (!parent || parent.status !== 'verified') {
          const failReason = `Parent step '${parentId}' is not verified (status: ${parent?.status ?? 'missing'}).`;
          await stepRepo.transitionStatus(workspaceId, stepId, 'running', 'skipped', { reason: failReason });
          await planRepo.transitionStatus(workspaceId, planId, 'running', 'failed');
          await stepRepo.cancelNonTerminalSteps(workspaceId, planId);

          if (executionLease) {
            await stepExecutionRepo.failLease(workspaceId, executionLease.id, executionLease.lease_token);
          }

          return { success: false, result: { error: failReason, skipped: true } };
        }
        const parentReceipt = await receiptRepo.findByStepId(workspaceId, parentId);
        if (parentReceipt && parentReceipt.status === 'verified') {
          dependencyProofs[parentId] = parentReceipt.proof;
        }
      }

      // 3. Worker-time Policy Re-evaluation. Never trust client-stored metadata.
      // Resolve the CURRENT membership of the original plan creator, not the
      // internal worker's privileged system scope.
      const actionDefinition = defaultActionRegistry.get(step.action_name);
      const creatorMembership = await new MembershipRepository(txClient)
        .findByUserAndWorkspace(workspaceId, plan.created_by_user_id);
      const binding = await bindingRepo.findByStepId(workspaceId, stepId);
      const approvalRecord = binding
        ? await approvalRepo.findById(workspaceId, binding.approval_request_id)
        : null;
      const approvedRequest = approvalRecord ? {
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
      } : null;

      let failReason = '';
      if (!actionDefinition) {
        failReason = `Unregistered action '${step.action_name}'.`;
      } else if (
        step.action_class !== actionDefinition.actionClass ||
        step.risk_level !== actionDefinition.risk ||
        step.approval_mode !== actionDefinition.approvalMode
      ) {
        failReason = 'Stored step metadata differs from authoritative action catalog.';
      } else if (step.parameter_hash !== computeCanonicalParameterHash(step.parameters)) {
        failReason = 'Stored step parameter hash mismatch.';
      } else if (!creatorMembership) {
        failReason = 'Plan creator membership is missing or revoked.';
      } else if (binding && binding.parameter_hash !== step.parameter_hash) {
        failReason = 'Approval binding parameter hash mismatch.';
      } else if (approvalRecord && approvalRecord.risk_level !== actionDefinition.risk) {
        failReason = 'Approval request risk does not match action catalog.';
      } else {
        const decision = defaultPolicyGateway.evaluate(
          { workspaceId, userId: plan.created_by_user_id, role: creatorMembership.role },
          { actionName: step.action_name, parameters: step.parameters, idempotencyKey },
          approvedRequest,
          plan.created_by_user_id
        );
        if (!decision.allowed) failReason = decision.reason;
      }

      if (failReason) {
        await stepRepo.transitionStatus(workspaceId, stepId, 'running', 'failed', { reason: failReason });
        await planRepo.transitionStatus(workspaceId, planId, 'running', 'failed');
        await stepRepo.cancelNonTerminalSteps(workspaceId, planId);
        const receipt = await receiptRepo.create(
          workspaceId, planId, stepId, step.action_name, 'failed',
          { error: failReason }, 'policy_rejection'
        );
        if (executionLease) {
          await stepExecutionRepo.failLease(workspaceId, executionLease.id, executionLease.lease_token);
        }
        await auditRepo.create(workspaceId, 'step.policy_rejected', 'plan_step',
          { receiptId: receipt.id, receiptStatus: 'failed', reasonCode: 'policy_rejected' }, null, stepId);
        return { success: false, result: { receiptStatus: 'failed', receiptId: receipt.id, error: failReason } };
      }

      // 4. Action Adapter Resolution & Crash Recovery Protocol
      const adapter = this.adapters.get(step.action_name);
      const execContext: ActionExecutionContext = {
        workspaceId,
        planId,
        stepId,
        idempotencyKey,
        parameters: step.parameters,
        dependencyProofs
      };

      // Crash Recovery check if lease takeover occurred (attempt_number > 1)
      if (executionLease && executionLease.attempt_number > 1) {
        if (!adapter || adapter.idempotencySupport === 'none') {
          // Conservative Recovery: NEVER re-dispatch after expired started lease for non-idempotent action
          const failReason = 'Crash recovery: Previous attempt on non-idempotent action timed out; outcome unknown.';
          await stepRepo.transitionStatus(workspaceId, stepId, 'running', 'unverified', { reason: failReason });
          await planRepo.transitionStatus(workspaceId, planId, 'running', 'failed');
          await stepRepo.cancelNonTerminalSteps(workspaceId, planId);

          const receipt = await receiptRepo.create(
            workspaceId,
            planId,
            stepId,
            step.action_name,
            'unverified',
            { reason: failReason, previousAttempts: executionLease.attempt_number },
            'crash_recovery_conservative'
          );

          await stepExecutionRepo.failLease(workspaceId, executionLease.id, executionLease.lease_token);
          return { success: false, result: { receiptStatus: 'unverified', receiptId: receipt.id, error: failReason } };
        }

        // Native / reconciliation adapter: attempt reconciliation prior to execution
        if (adapter.reconcile) {
          const reconciled = await adapter.reconcile(execContext);
          if (reconciled && reconciled.status === 'verified') {
            await stepRepo.transitionStatus(workspaceId, stepId, 'running', 'verified');
            const receipt = await receiptRepo.create(
              workspaceId,
              planId,
              stepId,
              step.action_name,
              'verified',
              reconciled.proof,
              reconciled.verificationMethod
            );
            await stepExecutionRepo.completeLease(workspaceId, executionLease.id, executionLease.lease_token);

            // Cascade downstream dependencies
            await this.cascadeDownstreamSteps(txClient, workspaceId, planId, stepId, stepsToEnqueue);

            return { success: true, result: { receiptStatus: 'verified', receiptId: receipt.id, reconciled: true } };
          }
        }
      }

      // 5. Action Execution
      let actionResult: ActionResult;
      try {
        if (!adapter) {
          if (step.action_name.startsWith('connector.')) {
            actionResult = {
              success: false,
              status: 'not_configured',
              verificationMethod: 'connector_catalog_lookup',
              proof: { message: 'Connector credentials have not been configured in workspace.' }
            };
          } else {
            actionResult = {
              success: false,
              status: 'failed',
              verificationMethod: 'action_catalog_lookup',
              proof: { error: `Unsupported or unknown action name: ${step.action_name}` },
              error: `Action '${step.action_name}' not supported`
            };
          }
        } else {
          actionResult = await adapter.execute(execContext);
        }
      } catch (execErr) {
        const errorMsg = (execErr as Error).message || 'Adapter execution error';

        if (!adapter || adapter.idempotencySupport === 'none') {
          // Non-idempotent actions must never blindly re-run after an in-flight exception
          actionResult = {
            success: false,
            status: 'unverified',
            verificationMethod: 'crash_recovery_conservative',
            proof: {
              error: errorMsg,
              reason: 'Non-idempotent action threw during execution; outcome unknown, retry prohibited.',
              attempts: executionLease?.attempt_number ?? 1
            },
            error: errorMsg
          };
        } else if (executionLease && executionLease.attempt_number < maxRetries) {
          // Release lease for backoff and keep step in queued, then commit before rethrowing for BullMQ retry
          await stepExecutionRepo.releaseLease(workspaceId, executionLease.id, executionLease.lease_token);
          const requeued = await stepRepo.transitionStatus(workspaceId, stepId, 'running', 'queued', { transientError: errorMsg });
          if (requeued) {
            await auditRepo.create(workspaceId, 'step.retry_scheduled', 'plan_step',
              { executionId: executionLease.id, attemptNumber: executionLease.attempt_number }, null, stepId);
          }
          return {
            success: false,
            retryError: execErr instanceof Error ? execErr : new Error(errorMsg)
          };
        } else {
          // Exhausted retries -> mark failed
          actionResult = {
            success: false,
            status: 'failed',
            verificationMethod: 'error_capture',
            proof: { error: errorMsg, attempts: executionLease?.attempt_number ?? 1 },
            error: errorMsg
          };
        }
      }

      // 6. Transition step to terminal status first so enforce_receipt_integrity trigger verifies matching status
      await stepRepo.transitionStatus(
        workspaceId,
        stepId,
        'running',
        actionResult.status,
        actionResult.error ? { error: actionResult.error } : null
      );

      // 7. Persist Truthful Receipt
      const receipt = await receiptRepo.create(
        workspaceId,
        planId,
        stepId,
        step.action_name,
        actionResult.status,
        actionResult.proof,
        actionResult.verificationMethod
      );

      // Update execution lease status
      if (executionLease) {
        if (actionResult.status === 'verified') {
          await stepExecutionRepo.completeLease(workspaceId, executionLease.id, executionLease.lease_token);
        } else {
          await stepExecutionRepo.failLease(workspaceId, executionLease.id, executionLease.lease_token);
        }
      }

      // 7. Handle Outcomes & Cascading
      if (actionResult.status !== 'verified') {
        await planRepo.transitionStatus(workspaceId, planId, 'running', 'failed');
        await stepRepo.cancelNonTerminalSteps(workspaceId, planId);
        return {
          success: false,
          result: {
            receiptStatus: actionResult.status,
            receiptId: receipt.id,
            error: actionResult.error
          }
        };
      }


      // Downstream cascading
      const planCompleted = await this.cascadeDownstreamSteps(
        txClient,
        workspaceId,
        planId,
        stepId,
        stepsToEnqueue
      );

      return {
        success: true,
        result: {
          receiptStatus: 'verified',
          receiptId: receipt.id,
          planCompleted
        }
      };
    });

    if ('retryError' in executionResult && executionResult.retryError) {
      throw executionResult.retryError;
    }

    // Enqueue newly ready steps asynchronously after transaction commit
    if (this.stepEnqueuer && stepsToEnqueue.length > 0) {
      for (const nextJob of stepsToEnqueue) {
        await this.stepEnqueuer(nextJob);
      }
    }

    return executionResult;
  }

  private async cascadeDownstreamSteps(
    txClient: any,
    workspaceId: string,
    planId: string,
    _stepId: string,
    stepsToEnqueue: JobData[]
  ): Promise<boolean> {
    const stepRepo = new PlanStepRepository(txClient);
    const planRepo = new PlanRepository(txClient);
    const approvalRepo = new ApprovalRepository(txClient);
    const bindingRepo = new PlanStepApprovalBindingRepository(txClient);

    const allSteps = await stepRepo.listByPlanId(workspaceId, planId);
    const verifiedStepIds = new Set(
      allSteps.filter((s) => s.status === 'verified').map((s) => s.id)
    );

    for (const candidate of allSteps) {
      if (candidate.status === 'blocked' || candidate.status === 'awaiting_approval') {
        const allDepsSatisfied = candidate.depends_on_step_ids.every((id) =>
          verifiedStepIds.has(id)
        );
        if (allDepsSatisfied) {
          const requiresApproval =
            candidate.action_class === 'write' && candidate.approval_mode !== 'none';
          if (requiresApproval) {
            const binding = await bindingRepo.findByStepId(workspaceId, candidate.id);
            const approval = binding
              ? await approvalRepo.findById(workspaceId, binding.approval_request_id)
              : null;
            if (approval && approval.status === 'approved') {
              await stepRepo.transitionStatus(
                workspaceId,
                candidate.id,
                ['blocked', 'awaiting_approval'],
                'queued'
              );
              stepsToEnqueue.push({
                workspaceId,
                jobRunId: candidate.id,
                jobName: 'plan.execute_step',
                payload: {
                  planId,
                  stepId: candidate.id,
                  stepIndex: candidate.step_index,
                  actionName: candidate.action_name
                }
              });
            } else if (candidate.status === 'blocked') {
              await stepRepo.transitionStatus(workspaceId, candidate.id, 'blocked', 'awaiting_approval');
            }
          } else if (candidate.status === 'blocked') {
            await stepRepo.transitionStatus(workspaceId, candidate.id, 'blocked', 'queued');
            stepsToEnqueue.push({
              workspaceId,
              jobRunId: candidate.id,
              jobName: 'plan.execute_step',
              payload: {
                planId,
                stepId: candidate.id,
                stepIndex: candidate.step_index,
                actionName: candidate.action_name
              }
            });
          }
        }
      }
    }

    // Check if entire plan is completed
    const finalSteps = await stepRepo.listByPlanId(workspaceId, planId);
    const allVerified = finalSteps.length > 0 && finalSteps.every((s) => s.status === 'verified');
    if (allVerified) {
      await planRepo.transitionStatus(workspaceId, planId, 'running', 'completed');
    }

    return allVerified;
  }

  private async executeJobLogic(
    jobName: string,
    payload: Record<string, unknown>,
    attemptNumber: number
  ): Promise<Record<string, unknown>> {
    if (jobName === 'test.permanent_failure') {
      throw new Error('Deterministic permanent job failure for testing.');
    }

    if (jobName === 'test.transient_failure') {
      if (attemptNumber < 2) {
        throw new Error('Deterministic transient failure on attempt 1.');
      }
      return { status: 'recovered_after_retry', attempt: attemptNumber };
    }

    if (jobName === 'test.sample_task') {
      return {
        status: 'executed',
        jobName,
        payloadSummary: Object.keys(payload),
        processedAt: new Date().toISOString()
      };
    }

    if (jobName.startsWith('connector.')) {
      return {
        status: 'not_configured',
        connector: jobName.replace('connector.', ''),
        message: 'External connector credentials are not configured.'
      };
    }

    throw new Error(`Unsupported or unknown job name: ${jobName}`);
  }
}
