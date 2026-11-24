import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  ApprovalRequest,
  ApprovalRequestSchema,
  BULK_CAMPAIGN_EXECUTE_ACTION,
  CreateApprovalRequest,
  CreateApprovalRequestSchema,
  ErrorResponseSchema,
  UpdateApprovalStatus,
  UpdateApprovalStatusSchema,
  computeCanonicalParameterHash
} from '@thaara/contracts';
import {
  ApprovalRepository,
  MembershipRepository,
  PlanRepository,
  PlanStepApprovalBindingRepository,
  PlanStepRepository,
  ReceiptRepository,
  StepExecutionRepository,
  TransactionalDbClient
} from '@thaara/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@thaara/observability';
import {
  N8N_CREATE_ACTION,
  defaultActionRegistry,
  defaultPolicyGateway
} from '@thaara/policy';
import { JobQueueService } from './jobs.js';
import { scheduleBackgroundPlanExecution } from '../services/chat-automation-orchestrator.js';
import { GmailFoundation, isGmailSendAction } from '../services/gmail.js';
import { GoogleCalendarFoundation, isCalendarMutationAction } from '../services/google-calendar.js';
import { defaultActionAdapters } from '@thaara/policy';
import { createWhatsAppReserveAdapter } from '../services/chat-whatsapp-assistant.js';
import type { DurableWhatsAppService } from '../services/whatsapp-durable.js';
import {
  createBulkCampaignActionAdapter,
  defaultBulkCampaignStore,
  rejectOrCancelBulkCampaign
} from '../services/bulk-campaign.js';

export async function approvalRoutes(
  fastify: FastifyInstance,
  options: {
    db: TransactionalDbClient;
    queueService?: JobQueueService;
    gmail?: GmailFoundation;
    googleCalendar?: GoogleCalendarFoundation;
    whatsappDurable?: DurableWhatsAppService;
  }
): Promise<void> {
  const { db, queueService, gmail, googleCalendar, whatsappDurable } = options;
  defaultBulkCampaignStore.bindDb(db);

  // POST /approvals - Create an approval request
  fastify.post<{ Body: CreateApprovalRequest; Reply: ApprovalRequest }>(
    '/approvals',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Create an approval request for a proposed action',
        tags: ['Approvals'],
        body: CreateApprovalRequestSchema,
        response: {
          201: ApprovalRequestSchema,
          400: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const { actionName, actionParams, riskLevel, ttlSeconds } = request.body;

      const created = await db.withScopedTransaction(scope, async (txClient) => {
        const approvalRepo = new ApprovalRepository(txClient);

        const record = await approvalRepo.create(
          scope.workspaceId,
          actionName,
          actionParams,
          scope.userId,
          riskLevel,
          ttlSeconds ?? 86400
        );

        return record;
      });

      reply.status(201);
      return {
        id: created.id,
        workspaceId: created.workspace_id,
        actionName: created.action_name,
        actionParams: created.action_params,
        requesterUserId: created.requester_user_id,
        approverUserId: created.approver_user_id,
        status: created.status,
        riskLevel: created.risk_level,
        expiresAt: created.expires_at,
        createdAt: created.created_at,
        updatedAt: created.updated_at
      };
    }
  );

  // GET /approvals - List approvals
  fastify.get<{ Reply: ApprovalRequest[] }>(
    '/approvals',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'List approval requests in workspace',
        tags: ['Approvals'],
        response: {
          200: Type.Array(ApprovalRequestSchema)
        }
      }
    },
    async (request) => {
      const scope = request.scope!;
      return await db.withScopedTransaction(scope, async (txClient) => {
        const approvalRepo = new ApprovalRepository(txClient);
        const records = await approvalRepo.listByWorkspace(scope.workspaceId);
        return records.map((r) => ({
          id: r.id,
          workspaceId: r.workspace_id,
          actionName: r.action_name,
          actionParams: r.action_params,
          requesterUserId: r.requester_user_id,
          approverUserId: r.approver_user_id,
          status: r.status,
          riskLevel: r.risk_level,
          expiresAt: r.expires_at,
          createdAt: r.created_at,
          updatedAt: r.updated_at
        }));
      });
    }
  );

  // POST /approvals/:id/decide - Approve or reject
  fastify.post<{
    Params: { id: string };
    Body: UpdateApprovalStatus;
    Reply: ApprovalRequest;
  }>(
    '/approvals/:id/decide',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Approve or reject a pending approval request',
        tags: ['Approvals'],
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: UpdateApprovalStatusSchema,
        response: {
          200: ApprovalRequestSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request) => {
      const scope = request.scope!;
      const { id } = request.params;
      const { status } = request.body;

      // RBAC: Viewers can never decide approvals
      if (scope.role === 'viewer') {
        throw new ForbiddenError('Only workspace owners and admins can approve or reject requests.');
      }

      const { response, scheduledStep } = await db.withScopedTransaction(scope, async (txClient) => {
        const approvalRepo = new ApprovalRepository(txClient);
        const membershipRepo = new MembershipRepository(txClient);
        const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
        const stepRepo = new PlanStepRepository(txClient);
        const planRepo = new PlanRepository(txClient);
        const receiptRepo = new ReceiptRepository(txClient);
        const stepExecRepo = new StepExecutionRepository(txClient);

        // Fresh authorization check against authoritative workspace membership
        const approverMembership = await membershipRepo.findByUserAndWorkspace(
          scope.workspaceId,
          scope.userId
        );
        if (!approverMembership || approverMembership.role === 'viewer') {
          throw new ForbiddenError('Only workspace owners and admins can approve or reject requests.');
        }

        const existing = await approvalRepo.findById(scope.workspaceId, id);
        if (!existing) {
          throw new NotFoundError('Approval request not found.');
        }

        const personalWhatsApp = existing.action_name === 'whatsapp.meta.messages.send' || existing.action_name === 'whatsapp.meta.media.upload';
        const isBulkCampaignApproval = existing.action_name === BULK_CAMPAIGN_EXECUTE_ACTION;
        if (personalWhatsApp) {
          const connectionId = existing.action_params.connectionId;
          if (existing.requester_user_id !== scope.userId || !whatsappDurable || typeof connectionId !== 'string') throw new ForbiddenError('Only the owner of this WhatsApp action can decide it.');
          // Approving re-validates the full send/upload authority. Rejecting only needs the requester: a closed
          // 24 h window, changed contacts or an expired intent must never make declining impossible.
          if (status === 'approved') await whatsappDurable.authorizePersonalApproval(scope, connectionId, existing.id);
        } else if (isGmailSendAction(existing.action_name)) {
          if (existing.requester_user_id !== scope.userId) {
            throw new ForbiddenError(
              'Personal Gmail emails can only be approved or rejected by the user who prepared them.'
            );
          }
        } else if (isCalendarMutationAction(existing.action_name)) {
          if (existing.requester_user_id !== scope.userId) {
            throw new ForbiddenError(
              'Personal Google Calendar meetings can only be approved or rejected by the user who prepared them.'
            );
          }
        } else if (approverMembership.role !== 'owner' && approverMembership.role !== 'admin') {
          throw new ForbiddenError('Only workspace owners and admins can approve or reject requests.');
        }

        // Two-person rule enforcement for high and critical risk
        if (
          (existing.risk_level === 'critical' || existing.risk_level === 'high') &&
          existing.requester_user_id === scope.userId && !personalWhatsApp && !isBulkCampaignApproval
        ) {
          throw new ForbiddenError(
            `Two-person rule violation: Requester cannot decide their own ${existing.risk_level}-risk action.`
          );
        }

        let postCommitStep: {
          planId: string;
          stepId: string;
          stepIndex: number;
          actionName: string;
          isChatOrchestratorPlan: boolean;
        } | null = null;

        // Handle already-decided approval requests:
        // - Reject any conflicting decision or repeat rejection/expired decision with 403
        // - Make retrying an already-approved decision safely idempotent with fresh authorization and no duplicate execution
        if (existing.status !== 'pending') {
          if (existing.status !== status || status !== 'approved') {
            throw new ForbiddenError(`Approval request is already in status '${existing.status}'.`);
          }

          const binding = await bindingRepo.findByApprovalRequestId(scope.workspaceId, id);
          if (binding) {
            const step = await stepRepo.findById(scope.workspaceId, binding.step_id);
            const plan = step ? await planRepo.findById(scope.workspaceId, step.plan_id) : null;

            if (
              step &&
              plan &&
              !['completed', 'failed', 'cancelled'].includes(plan.status) &&
              step.action_name !== N8N_CREATE_ACTION
            ) {
              const allSteps = await stepRepo.listByPlanId(scope.workspaceId, step.plan_id);
              const stepMap = new Map(allSteps.map((s) => [s.id, s]));
              const dependenciesSatisfied = step.depends_on_step_ids.every((depId) => {
                const parent = stepMap.get(depId);
                return parent && parent.status === 'verified';
              });

              const existingReceipt = await receiptRepo.findByStepId(scope.workspaceId, step.id);
              const idempotencyKey = `step-exec:${scope.workspaceId}:${step.plan_id}:${step.id}`;
              const existingExec = await stepExecRepo.findByIdempotencyKey(
                scope.workspaceId,
                idempotencyKey
              );

              const actionDefinition = defaultActionRegistry.get(step.action_name);
              const creatorMembership = await membershipRepo.findByUserAndWorkspace(
                scope.workspaceId,
                plan.created_by_user_id
              );
              const approvedRequest: ApprovalRequest = {
                id: existing.id,
                workspaceId: existing.workspace_id,
                actionName: existing.action_name,
                actionParams: existing.action_params,
                requesterUserId: existing.requester_user_id,
                approverUserId: existing.approver_user_id,
                status: existing.status,
                riskLevel: existing.risk_level,
                expiresAt: existing.expires_at,
                createdAt: existing.created_at,
                updatedAt: existing.updated_at
              };

              const policyAllowed =
                Boolean(actionDefinition) &&
                Boolean(creatorMembership) &&
                binding.parameter_hash === step.parameter_hash &&
                step.parameter_hash === computeCanonicalParameterHash(step.parameters) &&
                defaultPolicyGateway.evaluate(
                  {
                    workspaceId: scope.workspaceId,
                    userId: plan.created_by_user_id,
                    role: creatorMembership!.role
                  },
                  {
                    actionName: step.action_name,
                    parameters: step.parameters,
                    idempotencyKey
                  },
                  approvedRequest,
                  plan.created_by_user_id
                ).allowed;

              if (dependenciesSatisfied && !existingReceipt && !existingExec && policyAllowed) {
                if (step.status === 'awaiting_approval') {
                  await stepRepo.transitionStatus(
                    scope.workspaceId,
                    step.id,
                    'awaiting_approval',
                    'queued'
                  );
                  if (plan.status === 'awaiting_approval') {
                    await planRepo.transitionStatus(
                      scope.workspaceId,
                      step.plan_id,
                      'awaiting_approval',
                      'queued'
                    );
                  }
                }

                if (step.status === 'queued' || step.status === 'awaiting_approval') {
                  const planMeta = (plan.metadata ?? {}) as Record<string, unknown>;
                  postCommitStep = {
                    planId: step.plan_id,
                    stepId: step.id,
                    stepIndex: step.step_index,
                    actionName: step.action_name,
                    isChatOrchestratorPlan: planMeta.source === 'chat_automation_orchestrator'
                  };
                }
              }
            }
          }

          return {
            response: {
              id: existing.id,
              workspaceId: existing.workspace_id,
              actionName: existing.action_name,
              actionParams: existing.action_params,
              requesterUserId: existing.requester_user_id,
              approverUserId: existing.approver_user_id,
              status: existing.status,
              riskLevel: existing.risk_level,
              expiresAt: existing.expires_at,
              createdAt: existing.created_at,
              updatedAt: existing.updated_at
            },
            scheduledStep: postCommitStep
          };
        }

        // Check if expired -> return 409 Conflict as specified in Task 002
        if (new Date(existing.expires_at) < new Date()) {
          await approvalRepo.transitionStatus(scope.workspaceId, id, 'pending', 'expired');
          throw new ConflictError('Approval request has expired.');
        }

        // Atomic conditional state transition to prevent race conditions
        const updated = await approvalRepo.transitionStatus(
          scope.workspaceId,
          id,
          'pending',
          status,
          scope.userId
        );

        if (!updated) {
          const current = await approvalRepo.findById(scope.workspaceId, id);
          if (current && current.status === 'approved' && status === 'approved') {
            return {
              response: {
                id: current.id,
                workspaceId: current.workspace_id,
                actionName: current.action_name,
                actionParams: current.action_params,
                requesterUserId: current.requester_user_id,
                approverUserId: current.approver_user_id,
                status: current.status,
                riskLevel: current.risk_level,
                expiresAt: current.expires_at,
                createdAt: current.created_at,
                updatedAt: current.updated_at
              },
              scheduledStep: null
            };
          }
          throw new ConflictError('Approval request is no longer in pending status.');
        }

        // Cascade to bound plan step if this approval was bound to a plan step
        const binding = await bindingRepo.findByApprovalRequestId(scope.workspaceId, id);

        if (binding) {
          const step = await stepRepo.findById(scope.workspaceId, binding.step_id);
          const plan = step ? await planRepo.findById(scope.workspaceId, step.plan_id) : null;

          if (!step || !plan || ['completed', 'failed', 'cancelled'].includes(plan.status) || step.status !== 'awaiting_approval') {
            throw new ConflictError('Bound plan or step is no longer awaiting approval.');
          }

          if (status === 'approved') {
            // Check if all parent dependencies are verified
            const allSteps = await stepRepo.listByPlanId(scope.workspaceId, step.plan_id);
            const stepMap = new Map(allSteps.map((s) => [s.id, s]));
            const dependenciesSatisfied = step.depends_on_step_ids.every((depId) => {
              const parent = stepMap.get(depId);
              return parent && parent.status === 'verified';
            });

            if (dependenciesSatisfied) {
              await stepRepo.transitionStatus(
                scope.workspaceId,
                step.id,
                'awaiting_approval',
                'queued'
              );

              if (plan.status === 'awaiting_approval') {
                await planRepo.transitionStatus(
                  scope.workspaceId,
                  step.plan_id,
                  'awaiting_approval',
                  'queued'
                );
              }

              if (step.action_name !== N8N_CREATE_ACTION) {
                const planMeta = (plan.metadata ?? {}) as Record<string, unknown>;
                postCommitStep = {
                  planId: step.plan_id,
                  stepId: step.id,
                  stepIndex: step.step_index,
                  actionName: step.action_name,
                  isChatOrchestratorPlan: planMeta.source === 'chat_automation_orchestrator'
                };
              }
            }
          } else if (status === 'rejected') {
            // Write failed receipt, fail step, fail parent plan, and cancel remaining non-terminal steps
            await stepRepo.transitionStatus(
              scope.workspaceId,
              step.id,
              'awaiting_approval',
              'failed',
              { reason: 'Approval request was rejected' }
            );
            await receiptRepo.create(
              scope.workspaceId,
              step.plan_id,
              step.id,
              step.action_name,
              'failed',
              { reason: 'Approval request was rejected' },
              'approval_gateway'
            );
            await planRepo.transitionStatus(
              scope.workspaceId,
              step.plan_id,
              ['awaiting_approval', 'queued', 'running', 'paused'],
              'failed'
            );
            await stepRepo.cancelNonTerminalSteps(scope.workspaceId, step.plan_id);
            if (isBulkCampaignApproval) {
              const cid = (existing.action_params as { campaignId?: string })?.campaignId;
              if (cid) {
                const currentCampaign = await defaultBulkCampaignStore.getScoped(scope, cid, db);
                if (currentCampaign) {
                  await defaultBulkCampaignStore.saveScoped(
                    scope,
                    rejectOrCancelBulkCampaign(currentCampaign),
                    db
                  );
                }
              }
            }
          }
        }

        return {
          response: {
            id: updated!.id,
            workspaceId: updated!.workspace_id,
            actionName: updated!.action_name,
            actionParams: updated!.action_params,
            requesterUserId: updated!.requester_user_id,
            approverUserId: updated!.approver_user_id,
            status: updated!.status,
            riskLevel: updated!.risk_level,
            expiresAt: updated!.expires_at,
            createdAt: updated!.created_at,
            updatedAt: updated!.updated_at
          },
          scheduledStep: postCommitStep
        };
      });

      if (scheduledStep) {
        if (queueService) {
          await queueService.enqueue(
            scope.workspaceId,
            scheduledStep.stepId,
            'plan.execute_step',
            {
              planId: scheduledStep.planId,
              stepId: scheduledStep.stepId,
              stepIndex: scheduledStep.stepIndex,
              actionName: scheduledStep.actionName
            }
          );
        } else if (scheduledStep.isChatOrchestratorPlan) {
          const adapters = new Map(defaultActionAdapters);
          if (gmail) {
            for (const [name, adapter] of gmail.createSendAdapters()) {
              adapters.set(name, adapter);
            }
          }
          if (googleCalendar) {
            for (const [name, adapter] of googleCalendar.createMutationAdapters()) {
              adapters.set(name, adapter);
            }
          }
          // Reserve-only: approving a WhatsApp reply never sends; it records "Prepared, not sent".
          if (whatsappDurable) adapters.set('whatsapp.meta.messages.send', createWhatsAppReserveAdapter(whatsappDurable));
          adapters.set(BULK_CAMPAIGN_EXECUTE_ACTION, createBulkCampaignActionAdapter(defaultBulkCampaignStore, db));
          await scheduleBackgroundPlanExecution(db, scope, scheduledStep.planId, { adapters });
        }
      }

      return response;
    }
  );
}
