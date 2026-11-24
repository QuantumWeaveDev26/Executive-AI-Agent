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
import { GMAIL_SEND_NEW_ACTION, GMAIL_SEND_REPLY_ACTION } from './gmail.js';

/**
 * Step 106: shared governance for every outbound Gmail send (threaded reply or brand-new email).
 *
 * The model, chat text or Gmail composer can only *prepare* a send. Preparation creates a one-step
 * governed plan whose step is `awaiting_approval` and is bound (by canonical parameter hash) to an
 * explicit approval request owned by the requesting user. Only an approval decision followed by the
 * PolicyGateway-checked adapter can reach Gmail.
 */
export type GmailSendWorkflowKind = 'gmail_reply' | 'gmail_new_email';
export type GmailSendActionName = typeof GMAIL_SEND_REPLY_ACTION | typeof GMAIL_SEND_NEW_ACTION;

export const GMAIL_SEND_APPROVAL_TTL_SECONDS = 3600;

/**
 * Accepts `name@example.com` or `Name <name@example.com>` and returns the bare address.
 * Rejects lists, CR/LF header-injection attempts and malformed input.
 */
export function normalizeGmailRecipient(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const angle = trimmed.match(/^[^<>]*<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>$/);
  const candidate = (angle?.[1] ?? trimmed).trim();
  if (candidate.length < 3 || candidate.length > 320 || /[\r\n,;]/.test(candidate)) return null;
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]{2,}$/.test(candidate) ? candidate : null;
}

/**
 * Extracts all valid, deduplicated email addresses from a header string (e.g., From, Reply-To, To, Cc).
 * Never inspects message body text.
 */
export function extractAllGmailAddresses(headerValue: string | undefined | null): string[] {
  if (!headerValue || typeof headerValue !== 'string') return [];
  const matches = headerValue.match(/[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]{2,}/g) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of matches) {
    const normalized = normalizeGmailRecipient(raw);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

/**
 * Derives Reply or Reply-All recipients strictly from structured message headers (never body text),
 * deduplicating addresses and excluding the connected user's own address in Reply-All.
 */
export function deriveGmailReplyRecipients(
  sourceMessage: { from?: string; replyTo?: string; to?: string; cc?: string },
  connectedEmail: string,
  replyAll = false
): { to: string | null; cc?: string } {
  const selfKey = connectedEmail.trim().toLowerCase();
  const replyToAddrs = extractAllGmailAddresses(sourceMessage.replyTo);
  const fromAddrs = extractAllGmailAddresses(sourceMessage.from);
  const toAddrs = extractAllGmailAddresses(sourceMessage.to);
  const ccAddrs = extractAllGmailAddresses(sourceMessage.cc);

  const primaryPool = replyToAddrs.length > 0 ? replyToAddrs : fromAddrs;
  if (!replyAll) {
    const nonSelfPrimary = primaryPool.find((addr) => addr.toLowerCase() !== selfKey);
    const nonSelfTo = toAddrs.find((addr) => addr.toLowerCase() !== selfKey);
    const chosen = nonSelfPrimary ?? nonSelfTo ?? primaryPool[0] ?? toAddrs[0] ?? null;
    return { to: chosen };
  }

  const allUnique: string[] = [];
  const seen = new Set<string>();
  for (const addr of [...primaryPool, ...fromAddrs, ...toAddrs, ...ccAddrs]) {
    const key = addr.toLowerCase();
    if (key === selfKey || seen.has(key)) continue;
    seen.add(key);
    allUnique.push(addr);
  }
  if (allUnique.length === 0) {
    const fallback = primaryPool[0] ?? toAddrs[0] ?? null;
    return { to: fallback };
  }
  const [primary, ...rest] = allUnique;
  return {
    to: primary ?? null,
    ...(rest.length > 0 ? { cc: rest.join(', ') } : {})
  };
}

export function normalizeReplySubjectHeader(rawSubject: string | undefined | null): string {
  const cleaned = (rawSubject ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!cleaned) return 'Re: (no subject)';
  return /^re:/i.test(cleaned) ? cleaned.slice(0, 998) : `Re: ${cleaned}`.slice(0, 998);
}

export interface GovernedGmailSendCreated {
  planId: string;
  stepId: string;
  approvalId: string;
  expiresAt: string;
}

export interface GovernedGmailSendSnapshot {
  plan: Awaited<ReturnType<PlanRepository['findById']>> & {};
  step: Awaited<ReturnType<PlanStepRepository['findById']>> & {};
  approval: ApprovalRecord | null;
  receipt: Awaited<ReturnType<ReceiptRepository['findByStepId']>>;
  workflowKind: GmailSendWorkflowKind;
}

function workflowKindFor(actionName: GmailSendActionName): GmailSendWorkflowKind {
  return actionName === GMAIL_SEND_NEW_ACTION ? 'gmail_new_email' : 'gmail_reply';
}

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export async function createGovernedGmailSend(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  input: {
    actionName: GmailSendActionName;
    params: Record<string, unknown>;
    title: string;
    description: string;
    metadata: Record<string, unknown>;
    auditAction: string;
    auditPayload: Record<string, unknown>;
  }
): Promise<GovernedGmailSendCreated> {
  return db.withScopedTransaction(scope, async (txClient) => {
    const membershipRepo = new MembershipRepository(txClient);
    const planRepo = new PlanRepository(txClient);
    const stepRepo = new PlanStepRepository(txClient);
    const approvalRepo = new ApprovalRepository(txClient);
    const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
    const auditRepo = new AuditEventRepository(txClient);

    // Fresh, authoritative membership check (never trust the cached session role alone).
    const liveMembership = await membershipRepo.findByUserAndWorkspace(scope.workspaceId, scope.userId);
    if (!liveMembership || liveMembership.role === 'viewer') {
      throw new ForbiddenError('Your workspace role is not permitted to prepare or send Gmail email.');
    }

    const plan = await planRepo.create(scope.workspaceId, scope.userId, input.title, input.description, {
      source: 'chat_automation_orchestrator',
      ...input.metadata,
      workflowKind: workflowKindFor(input.actionName)
    });

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
    await stepRepo.transitionStatus(scope.workspaceId, step.id, ['ready', 'blocked'], 'awaiting_approval');
    await planRepo.transitionStatus(scope.workspaceId, plan.id, 'draft', 'awaiting_approval');

    const approval = await approvalRepo.create(
      scope.workspaceId,
      input.actionName,
      input.params,
      scope.userId,
      'medium',
      GMAIL_SEND_APPROVAL_TTL_SECONDS
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

/**
 * Finds the newest Gmail send plan created by this user (optionally limited to one conversation).
 * Plans created by other users or in other workspaces are never visible here.
 */
export async function findLatestGmailSendPlan(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  options: {
    conversationId?: string;
    workflowKinds: GmailSendWorkflowKind[];
    onlyAwaitingApproval?: boolean;
  }
): Promise<GovernedGmailSendSnapshot | null> {
  return db.withScopedTransaction(scope, async (txClient) => {
    const planRepo = new PlanRepository(txClient);
    const stepRepo = new PlanStepRepository(txClient);
    const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
    const approvalRepo = new ApprovalRepository(txClient);
    const receiptRepo = new ReceiptRepository(txClient);

    const plans = await planRepo.listByWorkspace(scope.workspaceId, { limit: 50 });
    const candidate = plans.find((p) => {
      const meta = (p.metadata ?? {}) as Record<string, unknown>;
      if (!options.workflowKinds.includes(meta.workflowKind as GmailSendWorkflowKind)) return false;
      if (p.created_by_user_id !== scope.userId) return false;
      if (options.conversationId && meta.conversationId !== options.conversationId) {
        return false;
      }
      if (options.onlyAwaitingApproval && p.status !== 'awaiting_approval') return false;
      return true;
    });
    if (!candidate) return null;

    const steps = await stepRepo.listByPlanId(scope.workspaceId, candidate.id);
    const step = steps.find(
      (s) => s.action_name === GMAIL_SEND_REPLY_ACTION || s.action_name === GMAIL_SEND_NEW_ACTION
    );
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
      workflowKind: meta.workflowKind as GmailSendWorkflowKind
    };
  });
}

/**
 * Cancels a Gmail send that is still awaiting approval. Nothing is sent. Returns false when the plan
 * is not this user's pending Gmail send (already decided, executed, or owned by someone else).
 */
export async function cancelGovernedGmailSend(
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
    const step = steps.find(
      (s) => s.action_name === GMAIL_SEND_REPLY_ACTION || s.action_name === GMAIL_SEND_NEW_ACTION
    );
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
    await stepRepo.transitionStatus(scope.workspaceId, step.id, 'awaiting_approval', 'cancelled', { reason });
    await planRepo.transitionStatus(scope.workspaceId, plan.id, 'awaiting_approval', 'cancelled');
    return { approvalId: binding?.approval_request_id ?? null };
  });
}
