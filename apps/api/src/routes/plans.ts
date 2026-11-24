import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  CancelPlanResponse,
  CancelPlanResponseSchema,
  CreatePlanBody,
  CreatePlanBodySchema,
  CreatePlanStepBody,
  CreatePlanStepBodySchema,
  ErrorResponseSchema,
  Plan,
  PlanSchema,
  PlanStep,
  PlanStepSchema,
  PlanWithStepsResponse,
  PlanWithStepsResponseSchema,
  StagedEmailWorkflowArtifact,
  StagedEmailWorkflowArtifactSchema,
  SubmitPlanResponse,
  SubmitPlanResponseSchema,
  computeCanonicalParameterHash
} from '@thaara/contracts';
import {
  ApprovalRepository,
  AuditEventRepository,
  MembershipRepository,
  PlanRepository,
  PlanStepApprovalBindingRepository,
  PlanStepDependencyRepository,
  PlanStepRepository,
  ReceiptRepository,
  TransactionalDbClient
} from '@thaara/db';
import { defaultActionRegistry, defaultPolicyGateway } from '@thaara/policy';
import { ForbiddenError, NotFoundError, ValidationError } from '@thaara/observability';
import { JobQueueService } from './jobs.js';

export async function planRoutes(
  fastify: FastifyInstance,
  options: { db: TransactionalDbClient; queueService?: JobQueueService }
): Promise<void> {
  const { db, queueService } = options;

  // 1. POST /plans - Create a new plan draft
  fastify.post<{ Body: CreatePlanBody; Reply: Plan }>(
    '/plans',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Create a new plan draft',
        tags: ['Plans'],
        body: CreatePlanBodySchema,
        response: {
          201: PlanSchema,
          400: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const { title, description, metadata } = request.body;

      const plan = await db.withScopedTransaction(scope, async (txClient) => {
        const planRepo = new PlanRepository(txClient);
        const createdPlan = await planRepo.create(
          scope.workspaceId,
          scope.userId,
          title,
          description,
          metadata
        );


        return createdPlan;
      });

      reply.status(201).send(plan as any);
    }
  );

  // 2. GET /plans - List plans for current workspace
  fastify.get<{
    Querystring: { status?: string; limit?: number; offset?: number };
    Reply: Plan[];
  }>(
    '/plans',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'List plans for current workspace',
        tags: ['Plans'],
        querystring: Type.Object({
          status: Type.Optional(Type.String()),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 }))
        }),
        response: {
          200: Type.Array(PlanSchema)
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const { status, limit, offset } = request.query;

      const plans = await db.withScopedTransaction(scope, async (txClient) => {
        const planRepo = new PlanRepository(txClient);
        return planRepo.listByWorkspace(scope.workspaceId, {
          status: status as any,
          limit,
          offset
        });
      });

      reply.status(200).send(plans as any);
    }
  );

  // 3. GET /plans/:id - Retrieve plan with steps and receipts
  fastify.get<{
    Params: { id: string };
    Reply: PlanWithStepsResponse;
  }>(
    '/plans/:id',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Get plan details with ordered steps and receipts',
        tags: ['Plans'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' })
        }),
        response: {
          200: PlanWithStepsResponseSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const { id } = request.params;

      const result = await db.withScopedTransaction(scope, async (txClient) => {
        const planRepo = new PlanRepository(txClient);
        const stepRepo = new PlanStepRepository(txClient);
        const receiptRepo = new ReceiptRepository(txClient);

        const plan = await planRepo.findById(scope.workspaceId, id);
        if (!plan) {
          throw new NotFoundError('Plan not found.');
        }

        const steps = await stepRepo.listByPlanId(scope.workspaceId, id);
        const receipts = await receiptRepo.listByPlanId(scope.workspaceId, id);

        return {
          ...plan,
          steps,
          receipts
        };
      });

      reply.status(200).send(result as any);
    }
  );

  // 3b. GET /plans/:id/workflow-artifact - Retrieve verified, approved, inactive staged workflow artifact
  fastify.get<{
    Params: { id: string };
    Reply: StagedEmailWorkflowArtifact;
  }>(
    '/plans/:id/workflow-artifact',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description:
          'Retrieve the verified, explicitly approved, inactive offline email workflow artifact for a completed plan',
        tags: ['Plans'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' })
        }),
        response: {
          200: StagedEmailWorkflowArtifactSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const { id } = request.params;

      const artifact = await db.withScopedTransaction(scope, async (txClient) => {
        const membershipRepo = new MembershipRepository(txClient);
        const planRepo = new PlanRepository(txClient);
        const stepRepo = new PlanStepRepository(txClient);
        const receiptRepo = new ReceiptRepository(txClient);
        const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
        const approvalRepo = new ApprovalRepository(txClient);

        const membership = await membershipRepo.findByUserAndWorkspace(
          scope.workspaceId,
          scope.userId
        );
        if (!membership) {
          throw new ForbiddenError('Active workspace membership is required.');
        }

        const plan = await planRepo.findById(scope.workspaceId, id);
        if (!plan) {
          throw new NotFoundError('Plan not found.');
        }

        if (plan.status !== 'completed') {
          throw new ForbiddenError(
            `Workflow artifact inspection/export requires a completed plan (current status: '${plan.status}').`
          );
        }

        const steps = await stepRepo.listByPlanId(scope.workspaceId, id);
        const stageStep = steps.find(
          (s) => s.action_name === 'automation.email.stage_workflow_artifact'
        );
        if (!stageStep) {
          throw new NotFoundError('No staged email workflow artifact step found on this plan.');
        }

        if (stageStep.status !== 'verified') {
          throw new ForbiddenError(
            `Staged workflow step is not verified (current status: '${stageStep.status}').`
          );
        }

        const binding = await bindingRepo.findByStepId(scope.workspaceId, stageStep.id);
        const approval = binding
          ? await approvalRepo.findById(scope.workspaceId, binding.approval_request_id)
          : null;

        if (!binding || !approval || approval.status !== 'approved') {
          throw new ForbiddenError(
            'Workflow artifact cannot be exported without a valid approved approval record.'
          );
        }

        const currentParamHash = computeCanonicalParameterHash(stageStep.parameters);
        if (binding.parameter_hash !== currentParamHash) {
          throw new ForbiddenError(
            'Approval parameter hash mismatch; workflow artifact export denied.'
          );
        }

        const receipts = await receiptRepo.listByPlanId(scope.workspaceId, id);
        const stageReceipt = receipts.find(
          (r) => r.plan_step_id === stageStep.id && r.status === 'verified'
        );
        if (!stageReceipt) {
          throw new ForbiddenError('Verified staging receipt not found for this plan.');
        }

        const proof = (stageReceipt.proof ?? {}) as Record<string, unknown>;
        const stagedArtifact = proof.stagedArtifact as StagedEmailWorkflowArtifact | undefined;
        if (!stagedArtifact || typeof stagedArtifact !== 'object') {
          throw new NotFoundError('Staged workflow artifact payload is missing from receipt.');
        }

        if (
          stagedArtifact.workspaceId !== scope.workspaceId ||
          stagedArtifact.planId !== plan.id ||
          stagedArtifact.active !== false ||
          stagedArtifact.workflowDefinition?.n8nBlueprint?.active !== false ||
          stagedArtifact.realEmailSent !== false ||
          stagedArtifact.externalDeploymentStatus !== 'not_configured'
        ) {
          throw new ForbiddenError(
            'Staged workflow artifact failed offline safety or workspace integrity verification.'
          );
        }

        return stagedArtifact;
      });

      reply.status(200).send(artifact);
    }
  );

  // 4. POST /plans/:id/steps - Append a step to a draft plan
  fastify.post<{
    Params: { id: string };
    Body: CreatePlanStepBody;
    Reply: PlanStep;
  }>(
    '/plans/:id/steps',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Append a step to a draft plan',
        tags: ['Plans'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' })
        }),
        body: CreatePlanStepBodySchema,
        response: {
          201: PlanStepSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const { id: planId } = request.params;
      const {
        action_name,
        action_class,
        risk_level,
        approval_mode,
        parameters,
        depends_on_step_ids = []
      } = request.body;

      const step = await db.withScopedTransaction(scope, async (txClient) => {
        const planRepo = new PlanRepository(txClient);
        const stepRepo = new PlanStepRepository(txClient);
        const depRepo = new PlanStepDependencyRepository(txClient);
        const auditRepo = new AuditEventRepository(txClient);

        const plan = await planRepo.findById(scope.workspaceId, planId);
        if (!plan) {
          throw new NotFoundError('Plan not found.');
        }
        if (plan.status !== 'draft') {
          throw new ValidationError(
            `Cannot add steps to plan in '${plan.status}' status. Plan must be in 'draft' status.`
          );
        }

        const existingSteps = await stepRepo.listByPlanId(scope.workspaceId, planId);
        const existingStepIds = new Set(existingSteps.map((s) => s.id));

        // Validate dependencies exist in current plan
        for (const depId of depends_on_step_ids) {
          if (!existingStepIds.has(depId)) {
            throw new ValidationError(`Dependency step '${depId}' does not exist in plan.`);
          }
        }

        // The catalog, not the client, determines action class/risk/approval rules.
        const actionDef = defaultActionRegistry.get(action_name);
        if (!actionDef) {
          throw new ValidationError(`Action '${action_name}' is not registered.`);
        }
        if (
          (action_class !== undefined && action_class !== actionDef.actionClass) ||
          (risk_level !== undefined && risk_level !== actionDef.risk) ||
          (approval_mode !== undefined && approval_mode !== actionDef.approvalMode)
        ) {
          throw new ValidationError(`Action '${action_name}' metadata must match the registered capability.`);
        }
        const admission = defaultPolicyGateway.evaluate(scope, {
          actionName: action_name,
          parameters,
          // Planned action hasn't received an execution lease yet.
          idempotencyKey: `plan-proposal:${scope.workspaceId}:${planId}`
        });
        // An approval is not expected until the plan is submitted; all other gates must pass.
        if (!admission.allowed && admission.status !== 'REJECTED_APPROVAL_REQUIRED') {
          if (admission.status === 'REJECTED_UNAUTHORIZED') throw new ForbiddenError(admission.reason);
          throw new ValidationError(admission.reason);
        }
        const resolvedActionClass = actionDef.actionClass;
        const resolvedRiskLevel = actionDef.risk;
        const resolvedApprovalMode = actionDef.approvalMode;

        const parameterHash = computeCanonicalParameterHash(parameters);
        const stepIndex = existingSteps.length;

        const createdStep = await stepRepo.create(
          scope.workspaceId,
          planId,
          stepIndex,
          action_name,
          resolvedActionClass,
          resolvedRiskLevel,
          resolvedApprovalMode,
          parameters,
          parameterHash
        );

        // Explicitly create dependencies in plan_step_dependencies
        if (depends_on_step_ids.length > 0) {
          await depRepo.createMany(scope.workspaceId, planId, createdStep.id, depends_on_step_ids);
        }

        await auditRepo.create(
          scope.workspaceId,
          'plan.step_added',
          'plan_step',
          { planId, stepIndex, actionName: action_name, parameterHash },
          scope.userId,
          createdStep.id
        );

        return {
          ...createdStep,
          depends_on_step_ids
        };
      });

      reply.status(201).send(step as any);
    }
  );

  // 5. POST /plans/:id/submit - Submit plan, bind approvals, and enqueue ready steps
  fastify.post<{
    Params: { id: string };
    Reply: SubmitPlanResponse;
  }>(
    '/plans/:id/submit',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Submit plan for approval or execution',
        tags: ['Plans'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' })
        }),
        response: {
          200: SubmitPlanResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const { id: planId } = request.params;

      const result = await db.withScopedTransaction(scope, async (txClient) => {
        const planRepo = new PlanRepository(txClient);
        const stepRepo = new PlanStepRepository(txClient);
        const approvalRepo = new ApprovalRepository(txClient);
        const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
        const auditRepo = new AuditEventRepository(txClient);

        const plan = await planRepo.findById(scope.workspaceId, planId);
        if (!plan) {
          throw new NotFoundError('Plan not found.');
        }
        if (plan.status !== 'draft') {
          throw new ValidationError(
            `Cannot submit plan in '${plan.status}' status. Only 'draft' plans can be submitted.`
          );
        }

        const steps = await stepRepo.listByPlanId(scope.workspaceId, planId);
        if (steps.length === 0) {
          throw new ValidationError('Plan must have at least one step to submit.');
        }

        // Validate DAG (detect cycles using Kahn's algorithm)
        validatePlanDag(steps);

        // Reject old/tampered drafts, revoked memberships, invalid inputs and metadata drift
        // BEFORE binding approvals or adding any work to the queue.
        const creatorMembership = await new MembershipRepository(txClient)
          .findByUserAndWorkspace(scope.workspaceId, plan.created_by_user_id);
        if (!creatorMembership) throw new ForbiddenError('Plan creator is no longer a workspace member.');
        for (const step of steps) {
          const action = defaultActionRegistry.get(step.action_name);
          if (!action || step.action_class !== action.actionClass ||
              step.risk_level !== action.risk || step.approval_mode !== action.approvalMode ||
              step.parameter_hash !== computeCanonicalParameterHash(step.parameters)) {
            throw new ValidationError(`Step '${step.id}' does not match the authoritative action catalog.`);
          }
          const request = {
            actionName: step.action_name,
            parameters: step.parameters,
            idempotencyKey: `step-exec:${scope.workspaceId}:${planId}:${step.id}`
          };
          for (const principal of [scope, {
            workspaceId: scope.workspaceId, userId: plan.created_by_user_id,
            role: creatorMembership.role
          }]) {
            const decision = defaultPolicyGateway.evaluate(principal, request);
            if (!decision.allowed && decision.status !== 'REJECTED_APPROVAL_REQUIRED') {
              throw new ForbiddenError(`Cannot submit step '${step.id}': ${decision.reason}`);
            }
          }
        }

        let approvalRequestsCreated = 0;
        let stepsQueued = 0;
        let stepsBlocked = 0;

        // Process approval binding for mutating steps requiring approval
        for (const step of steps) {
          if (step.action_class === 'write' && step.approval_mode !== 'none') {
            const approval = await approvalRepo.create(
              scope.workspaceId,
              step.action_name,
              step.parameters,
              scope.userId,
              step.risk_level
            );
            await bindingRepo.create(
              scope.workspaceId,
              planId,
              step.id,
              approval.id,
              step.parameter_hash
            );
            await stepRepo.transitionStatus(
              scope.workspaceId,
              step.id,
              ['ready', 'blocked'],
              'awaiting_approval'
            );
            approvalRequestsCreated++;
          }
        }

        // Refresh steps after binding approvals
        const refreshedSteps = await stepRepo.listByPlanId(scope.workspaceId, planId);

        // Identify root steps with 0 dependencies that do not require approval
        for (const step of refreshedSteps) {
          if (step.status === 'awaiting_approval') {
            continue;
          }

          if (step.depends_on_step_ids.length === 0) {
            await stepRepo.transitionStatus(
              scope.workspaceId,
              step.id,
              ['blocked', 'ready'],
              'queued'
            );
            stepsQueued++;

            if (queueService) {
              await queueService.enqueue(
                scope.workspaceId,
                step.id,
                'plan.execute_step',
                {
                  planId,
                  stepId: step.id,
                  stepIndex: step.step_index,
                  actionName: step.action_name
                }
              );
            }
          } else {
            await stepRepo.transitionStatus(
              scope.workspaceId,
              step.id,
              ['blocked', 'ready'],
              'blocked'
            );
            stepsBlocked++;
          }
        }

        // Determine plan state on submission:
        // - If approvals were created: 'awaiting_approval'
        // - Else: 'queued' (worker will transition to 'running' upon lease acquisition)
        let nextPlanStatus: 'awaiting_approval' | 'queued';
        if (approvalRequestsCreated > 0) {
          nextPlanStatus = 'awaiting_approval';
        } else {
          nextPlanStatus = 'queued';
        }

        const updatedPlan = await planRepo.transitionStatus(
          scope.workspaceId,
          planId,
          'draft',
          nextPlanStatus
        );

        await auditRepo.create(
          scope.workspaceId,
          'plan.submitted',
          'plan',
          {
            planId,
            status: nextPlanStatus,
            approvalRequestsCreated,
            stepsQueued,
            stepsBlocked
          },
          scope.userId,
          planId
        );

        return {
          plan: updatedPlan!,
          approval_requests_created: approvalRequestsCreated,
          steps_queued: stepsQueued,
          steps_blocked: stepsBlocked
        };
      });

      reply.status(200).send(result as any);
    }
  );

  // 6. POST /plans/:id/cancel - Cancel plan and pending steps
  fastify.post<{
    Params: { id: string };
    Reply: CancelPlanResponse;
  }>(
    '/plans/:id/cancel',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Cancel an active or queued plan',
        tags: ['Plans'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' })
        }),
        response: {
          200: CancelPlanResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const { id: planId } = request.params;

      const result = await db.withScopedTransaction(scope, async (txClient) => {
        const planRepo = new PlanRepository(txClient);
        const stepRepo = new PlanStepRepository(txClient);
        const plan = await planRepo.findById(scope.workspaceId, planId);
        if (!plan) {
          throw new NotFoundError('Plan not found.');
        }

        const cancellableStates = ['draft', 'awaiting_approval', 'queued', 'running', 'paused'];
        if (!cancellableStates.includes(plan.status)) {
          throw new ValidationError(`Cannot cancel plan in terminal status '${plan.status}'.`);
        }

        const updatedPlan = await planRepo.transitionStatus(
          scope.workspaceId,
          planId,
          cancellableStates as any,
          'cancelled'
        );

        const cancelledCount = await stepRepo.cancelNonTerminalSteps(scope.workspaceId, planId);


        return {
          plan: updatedPlan!,
          steps_cancelled: cancelledCount
        };
      });

      reply.status(200).send(result as any);
    }
  );
}

/**
 * Validates step DAG for cycles and forward references.
 */
function validatePlanDag(steps: Array<{ id: string; depends_on_step_ids: string[] }>): void {
  const stepMap = new Map(steps.map((s) => [s.id, s]));
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const step of steps) {
    inDegree.set(step.id, step.depends_on_step_ids.length);
    for (const depId of step.depends_on_step_ids) {
      if (!stepMap.has(depId)) {
        throw new ValidationError(`Step references missing dependency ID '${depId}'.`);
      }
      const list = adj.get(depId) ?? [];
      list.push(step.id);
      adj.set(depId, list);
    }
  }

  // Topological Sort / Kahn's algorithm
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  let visitedCount = 0;
  while (queue.length > 0) {
    const curr = queue.shift()!;
    visitedCount++;
    for (const next of adj.get(curr) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  if (visitedCount !== steps.length) {
    throw new ValidationError('Cyclic dependency detected among plan steps.');
  }
}
