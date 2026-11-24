import {
  ApprovalRecord,
  ApprovalRepository,
  AuditEventRepository,
  AuthenticatedScope,
  MembershipRepository,
  PlanRepository,
  PlanStepApprovalBindingRepository,
  PlanStepRepository,
  ReceiptRepository,
  TransactionalDbClient
} from '@thaara/db';
import { computeCanonicalParameterHash } from '@thaara/contracts';
import { ForbiddenError } from '@thaara/observability';
import {
  GOOGLE_CALENDAR_CANCEL_EVENT_ACTION,
  GOOGLE_CALENDAR_CREATE_EVENT_ACTION,
  GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION,
  isCalendarMutationAction
} from './google-calendar.js';

/**
 * Step 107.5: shared governance for every Google Calendar mutation (create, reschedule, cancel).
 *
 * Neither chat text nor the Calendar UI can mutate Google Calendar directly. Preparation creates a
 * one-step governed plan whose step is `awaiting_approval` and is bound (by canonical parameter hash)
 * to an explicit approval request owned by the requesting user. Only an explicit approval decision
 * followed by the PolicyGateway-checked adapter can reach Google Calendar.
 */
export type CalendarMutationWorkflowKind =
  | 'calendar_create_event'
  | 'calendar_reschedule_event'
  | 'calendar_cancel_event';

export type CalendarMutationActionName =
  | typeof GOOGLE_CALENDAR_CREATE_EVENT_ACTION
  | typeof GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION
  | typeof GOOGLE_CALENDAR_CANCEL_EVENT_ACTION;

export const CALENDAR_MUTATION_APPROVAL_TTL_SECONDS = 3600;

export function normalizeAttendeeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const angle = trimmed.match(/^[^<>]*<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>$/);
  const candidate = (angle?.[1] ?? trimmed).trim();
  if (candidate.length < 3 || candidate.length > 320 || /[\r\n,;]/.test(candidate)) return null;
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]{2,}$/.test(candidate) ? candidate : null;
}

export function normalizeAttendeeList(rawList: readonly string[] | undefined): string[] {
  if (!rawList || rawList.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of rawList) {
    const normalized = normalizeAttendeeEmail(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
    if (result.length >= 25) break;
  }
  return result;
}

export interface GovernedCalendarMutationCreated {
  planId: string;
  stepId: string;
  approvalId: string;
  expiresAt: string;
}

export interface GovernedCalendarMutationSnapshot {
  plan: Awaited<ReturnType<PlanRepository['findById']>> & {};
  step: Awaited<ReturnType<PlanStepRepository['findById']>> & {};
  approval: ApprovalRecord | null;
  receipt: Awaited<ReturnType<ReceiptRepository['findByStepId']>>;
  workflowKind: CalendarMutationWorkflowKind;
}

function workflowKindFor(actionName: CalendarMutationActionName): CalendarMutationWorkflowKind {
  if (actionName === GOOGLE_CALENDAR_CREATE_EVENT_ACTION) return 'calendar_create_event';
  if (actionName === GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION) return 'calendar_reschedule_event';
  return 'calendar_cancel_event';
}

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export async function createGovernedCalendarMutation(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  input: {
    actionName: CalendarMutationActionName;
    params: Record<string, unknown>;
    title: string;
    description: string;
    metadata: Record<string, unknown>;
    auditAction: string;
    auditPayload: Record<string, unknown>;
  }
): Promise<GovernedCalendarMutationCreated> {
  return db.withScopedTransaction(scope, async (txClient) => {
    const membershipRepo = new MembershipRepository(txClient);
    const planRepo = new PlanRepository(txClient);
    const stepRepo = new PlanStepRepository(txClient);
    const approvalRepo = new ApprovalRepository(txClient);
    const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
    const auditRepo = new AuditEventRepository(txClient);

    const liveMembership = await membershipRepo.findByUserAndWorkspace(
      scope.workspaceId,
      scope.userId
    );
    if (!liveMembership || liveMembership.role === 'viewer') {
      throw new ForbiddenError(
        'Your workspace role is not permitted to schedule, reschedule, or cancel Google Calendar meetings.'
      );
    }

    const plan = await planRepo.create(
      scope.workspaceId,
      scope.userId,
      input.title,
      input.description,
      {
        source: 'chat_automation_orchestrator',
        ...input.metadata,
        workflowKind: workflowKindFor(input.actionName)
      }
    );

    const paramHash = computeCanonicalParameterHash(input.params);
    const step = await stepRepo.create(
      scope.workspaceId,
      plan.id,
      0,
      input.actionName,
      'write',
      'medium',
      'explicit',
      input.params,
      paramHash
    );
    await stepRepo.transitionStatus(
      scope.workspaceId,
      step.id,
      ['ready', 'blocked'],
      'awaiting_approval'
    );
    await planRepo.transitionStatus(scope.workspaceId, plan.id, 'draft', 'awaiting_approval');

    const approval = await approvalRepo.create(
      scope.workspaceId,
      input.actionName,
      input.params,
      scope.userId,
      'medium',
      CALENDAR_MUTATION_APPROVAL_TTL_SECONDS
    );
    await bindingRepo.create(scope.workspaceId, plan.id, step.id, approval.id, step.parameter_hash);

    await auditRepo.create(
      scope.workspaceId,
      input.auditAction,
      'plan_step',
      { planId: plan.id, stepId: step.id, approvalId: approval.id, ...input.auditPayload },
      scope.userId,
      step.id
    );

    return {
      planId: plan.id,
      stepId: step.id,
      approvalId: approval.id,
      expiresAt: toIso(approval.expires_at)
    };
  });
}

export async function findLatestCalendarMutationPlan(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  options: {
    conversationId?: string;
    workflowKinds?: CalendarMutationWorkflowKind[];
    onlyAwaitingApproval?: boolean;
  } = {}
): Promise<GovernedCalendarMutationSnapshot | null> {
  const allowedKinds = options.workflowKinds ?? [
    'calendar_create_event',
    'calendar_reschedule_event',
    'calendar_cancel_event'
  ];
  return db.withScopedTransaction(scope, async (txClient) => {
    const planRepo = new PlanRepository(txClient);
    const stepRepo = new PlanStepRepository(txClient);
    const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
    const approvalRepo = new ApprovalRepository(txClient);
    const receiptRepo = new ReceiptRepository(txClient);

    const plans = await planRepo.listByWorkspace(scope.workspaceId, { limit: 50 });
    const candidate = plans.find((p) => {
      const meta = (p.metadata ?? {}) as Record<string, unknown>;
      if (!allowedKinds.includes(meta.workflowKind as CalendarMutationWorkflowKind)) return false;
      if (p.created_by_user_id !== scope.userId) return false;
      if (options.conversationId && meta.conversationId !== options.conversationId) {
        return false;
      }
      if (options.onlyAwaitingApproval && p.status !== 'awaiting_approval') return false;
      return true;
    });
    if (!candidate) return null;

    const steps = await stepRepo.listByPlanId(scope.workspaceId, candidate.id);
    const step = steps.find((s) => isCalendarMutationAction(s.action_name));
    if (!step) return null;

    const binding = await bindingRepo.findByStepId(scope.workspaceId, step.id);
    const approval = binding
      ? await approvalRepo.findById(scope.workspaceId, binding.approval_request_id)
      : null;
    const receipt = await receiptRepo.findByStepId(scope.workspaceId, step.id);
    const meta = (candidate.metadata ?? {}) as Record<string, unknown>;
    return {
      plan: candidate,
      step,
      approval,
      receipt,
      workflowKind: meta.workflowKind as CalendarMutationWorkflowKind
    };
  });
}

export async function cancelGovernedCalendarMutation(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  planId: string,
  reason: string
): Promise<{ approvalId: string | null } | null> {
  return db.withScopedTransaction(scope, async (txClient) => {
    const planRepo = new PlanRepository(txClient);
    const stepRepo = new PlanStepRepository(txClient);
    const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
    const approvalRepo = new ApprovalRepository(txClient);

    const plan = await planRepo.findById(scope.workspaceId, planId);
    if (!plan || plan.created_by_user_id !== scope.userId || plan.status !== 'awaiting_approval') {
      return null;
    }
    const steps = await stepRepo.listByPlanId(scope.workspaceId, plan.id);
    const step = steps.find((s) => isCalendarMutationAction(s.action_name));
    if (!step || step.status !== 'awaiting_approval') return null;

    const binding = await bindingRepo.findByStepId(scope.workspaceId, step.id);
    if (binding) {
      const transitioned = await approvalRepo.transitionStatus(
        scope.workspaceId,
        binding.approval_request_id,
        'pending',
        'rejected',
        scope.userId
      );
      if (!transitioned) return null;
    }
    await stepRepo.transitionStatus(scope.workspaceId, step.id, 'awaiting_approval', 'cancelled', {
      reason
    });
    await planRepo.transitionStatus(scope.workspaceId, plan.id, 'awaiting_approval', 'cancelled');
    return { approvalId: binding?.approval_request_id ?? null };
  });
}
