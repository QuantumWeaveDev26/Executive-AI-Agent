import crypto from 'node:crypto';
import {
  ComposeEmailWorkflowInput,
  DryRunEmailWorkflowInput,
  EmailAutomationTriggerType,
  GoogleCalendarBriefingQuery,
  GoogleCalendarBriefingResponse,
  PhoneBriefingQuery,
  PhoneBriefingResponse,
  StageEmailWorkflowArtifactInput,
  WhatsAppBriefingQuery,
  WhatsAppBriefingResponse,
  computeCanonicalParameterHash
} from '@thaara/contracts';
import {
  ApprovalRepository,
  AuditEventRepository,
  AuthenticatedScope,
  IdempotencyRepository,
  MembershipRepository,
  PlanRepository,
  PlanStepApprovalBindingRepository,
  PlanStepDependencyRepository,
  PlanStepRepository,
  ReceiptRepository,
  StepExecutionRepository,
  TransactionalDbClient
} from '@thaara/db';
import { ConflictError, ForbiddenError, ValidationError } from '@thaara/observability';
import {
  N8N_CREATE_ACTION,
  ActionAdapter,
  ActionExecutionContext,
  ActionResult,
  PolicyGateway,
  computeEmailWorkflowHash,
  defaultActionAdapters,
  defaultActionRegistry,
  defaultPolicyGateway,
  validateN8nWorkflowBlueprint
} from '@thaara/policy';
import type { JobQueueService } from '../routes/jobs.js';
import {
  GoogleCalendarFoundation,
  buildCalendarBriefingN8nBlueprint
} from './google-calendar.js';
import {
  PhoneFoundation,
  buildPhoneBriefingN8nBlueprint
} from './phone.js';
import {
  WhatsAppFoundation,
  buildWhatsAppBriefingN8nBlueprint
} from './whatsapp.js';

export interface EmailAutomationChatProposal {
  matched: boolean;
  workflowKind?: 'email_automation' | 'calendar_briefing' | 'whatsapp_briefing' | 'phone_briefing';
  planTitle: string;
  requireApprovalGate: boolean;
  composeParams: ComposeEmailWorkflowInput;
  dryRunParams: DryRunEmailWorkflowInput;
  stageParams?: StageEmailWorkflowArtifactInput;
  briefingQuery?: GoogleCalendarBriefingQuery;
  calendarBriefing?: GoogleCalendarBriefingResponse;
  whatsappBriefingQuery?: WhatsAppBriefingQuery;
  whatsappBriefing?: WhatsAppBriefingResponse;
  phoneBriefingQuery?: PhoneBriefingQuery;
  phoneBriefing?: PhoneBriefingResponse;
  approvalGateParams?: {
    task: string;
  };
}

export interface ChatAutomationStepSummary {
  stepId: string;
  stepOrder: number;
  actionName: string;
  status: string;
  receiptId: string | null;
  receiptStatus: string | null;
  verificationMethod: string | null;
  proof: Record<string, unknown> | null;
  error: string | null;
}

export interface ChatAutomationExecutionOutcome {
  executed: boolean;
  planId: string;
  planStatus: string;
  approvalId: string | null;
  steps: ChatAutomationStepSummary[];
  workflowHash: string | null;
  dryRunHash: string | null;
  stagedArtifactId?: string | null;
  assistantResponseText: string;
  idempotentReplay?: boolean;
}

export interface ChatAutomationExecutionOptions {
  policyGateway?: PolicyGateway;
  queueService?: JobQueueService;
  googleCalendar?: GoogleCalendarFoundation;
  whatsapp?: WhatsAppFoundation;
  phone?: PhoneFoundation;
  adapters?: Map<string, ActionAdapter>;
  idempotencyKey?: string;
  conversationId?: string;
  streamId?: string;
  signal?: AbortSignal;
  maxRetries?: number;
  queueWaitTimeoutMs?: number;
  workerId?: string;
  leaseDurationMs?: number;
}

const activeBackgroundPlanExecutions = new Map<string, Promise<void>>();

export async function waitForChatPlanBackgroundExecution(planId: string): Promise<void> {
  const pending = activeBackgroundPlanExecutions.get(planId);
  if (pending) {
    await pending;
  }
}

const EMAIL_AUTOMATION_REQUEST_PATTERNS: RegExp[] = [
  /\b(?:create|build|generate|prepare|draft|make|set\s*up|setup|design|compose|stage)\b[\s\S]{0,80}\b(?:email\s+(?:automation|workflow)|automated\s+email(?:\s+workflow)?)\b/i,
  /\b(?:email\s+(?:automation|workflow))\b[\s\S]{0,80}\b(?:create|build|generate|prepare|draft|for\s+me|dry[\s-]*run|test|stage)\b/i
];

const CALENDAR_BRIEFING_REQUEST_PATTERNS: RegExp[] = [
  /\b(?:create|build|generate|prepare|draft|make|set\s*up|setup|design|compose|stage)\b[\s\S]{0,80}\b(?:calendar\s+(?:briefing|agenda)(?:\s+(?:automation|workflow))?|agenda\s+(?:briefing|automation|workflow)|daily\s+calendar\s+briefing)\b/i,
  /\b(?:calendar\s+(?:briefing|agenda)(?:\s+(?:automation|workflow))?|agenda\s+(?:briefing|automation|workflow))\b[\s\S]{0,80}\b(?:create|build|generate|prepare|draft|for\s+me|dry[\s-]*run|test|stage|workflow|automation)\b/i
];

export function detectCalendarBriefingChatRequest(
  userMessage: string
): EmailAutomationChatProposal | null {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return null;
  }

  const isCalendarMatch = CALENDAR_BRIEFING_REQUEST_PATTERNS.some((pattern) =>
    pattern.test(trimmed)
  );
  if (!isCalendarMatch) {
    return null;
  }

  const requireApprovalGate =
    /\b(?:with\s+approval(?:\s+gate)?|require\s+approval|stage(?:\s+for\s+approval|\s+workflow|\s+calendar|\s+briefing|\s+artifact)?|approval[\s-]*gated)\b/i.test(
      trimmed
    );

  const tzMatch = trimmed.match(/\btime\s*zone\s*:\s*([A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+){0,2})/i);
  const timeZone = tzMatch?.[1]?.trim() || 'UTC';
  const subjectMatch = trimmed.match(/subject\s*:\s*"([^"]+)"/i);
  const bodyMatch = trimmed.match(/body\s*:\s*"([^"]+)"/i);
  const sampleRecipientMatch = trimmed.match(/sample\s+recipient\s*:\s*([^\s,;]+)/i);

  const workflowName = 'Daily Executive Calendar Briefing Automation';
  const recipientVariable = 'recipient_email';
  const allowedVariables = [
    'recipient_email',
    'executive_name',
    'briefing_date',
    'time_zone',
    'appointment_count',
    'conflict_summary',
    'upcoming_schedule'
  ];

  const emailSubject = subjectMatch?.[1]
    ? subjectMatch[1].trim()
    : 'Daily Calendar Briefing for {{briefing_date}} ({{time_zone}})';

  const emailBodyTemplate = bodyMatch?.[1]
    ? bodyMatch[1].trim()
    : 'Hello {{executive_name}},\n\nHere is your daily calendar briefing for {{briefing_date}} ({{time_zone}}):\n- Total appointments: {{appointment_count}}\n- Conflict status: {{conflict_summary}}\n- Upcoming schedule:\n{{upcoming_schedule}}\n\nNote: Event descriptions are treated as untrusted data.\n\nBest regards,\nThaara Executive Partner';

  const sampleRecipient = sampleRecipientMatch?.[1]
    ? sampleRecipientMatch[1].trim()
    : 'executive@example.com';

  const composeParams: ComposeEmailWorkflowInput = {
    workflowName,
    triggerType: 'scheduled_digest',
    recipientVariable,
    allowedVariables,
    emailSubject,
    emailBodyTemplate
  };

  const dryRunParams: DryRunEmailWorkflowInput = {
    ...composeParams,
    sampleData: {
      recipient_email: sampleRecipient,
      executive_name: 'Aarav Sharma',
      briefing_date: '2026-10-19',
      time_zone: timeZone,
      appointment_count: 2,
      conflict_summary: '2 overlapping appointments detected',
      upcoming_schedule:
        '09:00–10:00 (' + timeZone + ') Board Strategy Review | 09:30–10:30 (' + timeZone + ') Investor Sync [CONFLICT]'
    }
  };

  const stageParams: StageEmailWorkflowArtifactInput | undefined = requireApprovalGate
    ? {
        ...composeParams
      }
    : undefined;

  const briefingQuery: GoogleCalendarBriefingQuery = {
    windowStart: '2026-10-19T00:00:00.000Z',
    windowEnd: '2026-10-20T00:00:00.000Z',
    timeZone,
    limit: 25,
    includeCancelled: false,
    workflowName
  };

  return {
    matched: true,
    workflowKind: 'calendar_briefing',
    planTitle: 'Governed Calendar Briefing Workflow Plan',
    requireApprovalGate,
    composeParams,
    dryRunParams,
    stageParams,
    briefingQuery,
    approvalGateParams: requireApprovalGate
      ? { task: 'stage_verified_calendar_briefing_workflow_for_review' }
      : undefined
  };
}

const WHATSAPP_BRIEFING_REQUEST_PATTERNS: RegExp[] = [
  /\b(?:create|build|generate|prepare|draft|make|set\s*up|setup|design|compose|stage)\b[\s\S]{0,80}\b(?:whatsapp\s+(?:briefing|digest|summary|conversation\s+briefing)(?:\s+(?:automation|workflow))?|daily\s+whatsapp\s+briefing)\b/i,
  /\b(?:whatsapp\s+(?:briefing|digest|summary|conversation\s+briefing)(?:\s+(?:automation|workflow))?)\b[\s\S]{0,80}\b(?:create|build|generate|prepare|draft|for\s+me|dry[\s-]*run|test|stage|workflow|automation)\b/i
];

export function detectWhatsAppBriefingChatRequest(
  userMessage: string
): EmailAutomationChatProposal | null {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return null;
  }

  const isWhatsAppMatch = WHATSAPP_BRIEFING_REQUEST_PATTERNS.some((pattern) =>
    pattern.test(trimmed)
  );
  if (!isWhatsAppMatch) {
    return null;
  }

  const requireApprovalGate =
    /\b(?:with\s+approval(?:\s+gate)?|require\s+approval|stage(?:\s+for\s+approval|\s+workflow|\s+whatsapp|\s+briefing|\s+artifact)?|approval[\s-]*gated)\b/i.test(
      trimmed
    );

  const threadMatch = trimmed.match(/\bthread\s*:\s*([A-Za-z0-9_-]{1,128})/i);
  const queryMatch = trimmed.match(/\bquery\s*:\s*"([^"]+)"/i);
  const subjectMatch = trimmed.match(/subject\s*:\s*"([^"]+)"/i);
  const bodyMatch = trimmed.match(/body\s*:\s*"([^"]+)"/i);
  const sampleRecipientMatch = trimmed.match(/sample\s+recipient\s*:\s*([^\s,;]+)/i);

  const workflowName = 'Daily Executive WhatsApp Briefing Automation';
  const recipientVariable = 'recipient_email';
  const allowedVariables = [
    'recipient_email',
    'executive_name',
    'unread_count',
    'attention_count',
    'conversation_summary',
    'attention_items'
  ];

  const emailSubject = subjectMatch?.[1]
    ? subjectMatch[1].trim()
    : 'Daily WhatsApp Executive Briefing ({{unread_count}} unread, {{attention_count}} needing attention)';

  const emailBodyTemplate = bodyMatch?.[1]
    ? bodyMatch[1].trim()
    : 'Hello {{executive_name}},\n\nHere is your governed WhatsApp Business briefing:\n- Unread messages: {{unread_count}}\n- Items needing attention: {{attention_count}}\n- Conversation summaries:\n{{conversation_summary}}\n- Attention items:\n{{attention_items}}\n\nNote: WhatsApp content is treated as untrusted data and phone numbers remain masked.\n\nBest regards,\nThaara Executive Partner';

  const sampleRecipient = sampleRecipientMatch?.[1]
    ? sampleRecipientMatch[1].trim()
    : 'executive@example.com';

  const composeParams: ComposeEmailWorkflowInput = {
    workflowName,
    triggerType: 'scheduled_digest',
    recipientVariable,
    allowedVariables,
    emailSubject,
    emailBodyTemplate
  };

  const dryRunParams: DryRunEmailWorkflowInput = {
    ...composeParams,
    sampleData: {
      recipient_email: sampleRecipient,
      executive_name: 'Aarav Sharma',
      unread_count: 2,
      attention_count: 3,
      conversation_summary:
        'Ananya Rao (+91 ******3210) — 2 unread | Vikram Menon (+91 ******2233) — 0 unread',
      attention_items:
        'wamid_exec_board_001: Q4 liquidity summary requested | wamid_exec_counsel_002: Vendor addendum review'
    }
  };

  const stageParams: StageEmailWorkflowArtifactInput | undefined = requireApprovalGate
    ? {
        ...composeParams
      }
    : undefined;

  const whatsappBriefingQuery: WhatsAppBriefingQuery = {
    ...(threadMatch?.[1] ? { threadId: threadMatch[1].trim() } : {}),
    ...(queryMatch?.[1] ? { query: queryMatch[1].trim() } : {}),
    limit: 25,
    workflowName
  };

  return {
    matched: true,
    workflowKind: 'whatsapp_briefing',
    planTitle: 'Governed WhatsApp Briefing Workflow Plan',
    requireApprovalGate,
    composeParams,
    dryRunParams,
    stageParams,
    whatsappBriefingQuery,
    approvalGateParams: requireApprovalGate
      ? { task: 'stage_verified_whatsapp_briefing_workflow_for_review' }
      : undefined
  };
}

const OUTBOUND_CALL_INTENT_PATTERNS: RegExp[] = [
  /\b(?:place|make|initiate|start|dial|ring|schedule\s+an?\s+outbound)\s+(?:a\s+|an\s+)?(?:outbound\s+)?(?:phone\s+)?call\b/i,
  /^\s*(?:please\s+)?(?:call|dial|phone)\s+(?:[A-Z][a-z]+|\+\d)/
];

const PHONE_BRIEFING_REQUEST_PATTERNS: RegExp[] = [
  /\b(?:summarize|brief|review|digest|prepare|create|build|generate|draft|make|set\s*up|setup|design|compose|stage)\b[\s\S]{0,80}\b(?:(?:my\s+|recent\s+|missed\s+|daily\s+)?(?:phone\s+)?calls?(?:\s+(?:history|log|logs|briefing|digest|summary))?(?:\s+(?:automation|workflow))?|phone\s+(?:briefing|digest|summary|call\s+briefing|call\s+summary)(?:\s+(?:automation|workflow))?)\b/i,
  /\b(?:(?:phone|call|calls)\s+(?:briefing|digest|summary|history\s+briefing)(?:\s+(?:automation|workflow))?)\b[\s\S]{0,80}\b(?:summarize|create|build|generate|prepare|draft|for\s+me|dry[\s-]*run|test|stage|workflow|automation)\b/i
];

export function detectPhoneBriefingChatRequest(
  userMessage: string
): EmailAutomationChatProposal | null {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return null;
  }

  // Keep briefing requests strictly separate from outbound-call intents
  const hasExplicitBriefingSignal =
    /\b(?:summarize|summary|briefing|digest|recent\s+calls|call\s+history|missed\s+calls)\b/i.test(
      trimmed
    );
  const isOutboundCallIntent = OUTBOUND_CALL_INTENT_PATTERNS.some((pattern) =>
    pattern.test(trimmed)
  );
  if (isOutboundCallIntent && !hasExplicitBriefingSignal) {
    return null;
  }

  // Do not steal calendar or WhatsApp briefing prompts
  if (/\b(?:calendar|whatsapp)\b/i.test(trimmed)) {
    return null;
  }

  const isPhoneMatch = PHONE_BRIEFING_REQUEST_PATTERNS.some((pattern) =>
    pattern.test(trimmed)
  );
  if (!isPhoneMatch) {
    return null;
  }

  const requireApprovalGate =
    /\b(?:with\s+approval(?:\s+gate)?|require\s+approval|stage(?:\s+for\s+approval|\s+workflow|\s+phone|\s+call|\s+briefing|\s+artifact)?|approval[\s-]*gated)\b/i.test(
      trimmed
    );

  const queryMatch = trimmed.match(/\bquery\s*:\s*"([^"]+)"/i);
  const subjectMatch = trimmed.match(/subject\s*:\s*"([^"]+)"/i);
  const bodyMatch = trimmed.match(/body\s*:\s*"([^"]+)"/i);
  const sampleRecipientMatch = trimmed.match(/sample\s+recipient\s*:\s*([^\s,;]+)/i);

  const workflowName = 'Daily Executive Phone Call Briefing Automation';
  const recipientVariable = 'recipient_email';
  const allowedVariables = [
    'recipient_email',
    'executive_name',
    'total_calls',
    'inbound_count',
    'outbound_count',
    'missed_or_failed_count',
    'recent_call_activity',
    'follow_up_items'
  ];

  const emailSubject = subjectMatch?.[1]
    ? subjectMatch[1].trim()
    : 'Daily Phone Call Briefing ({{total_calls}} calls, {{missed_or_failed_count}} missed/failed)';

  const emailBodyTemplate = bodyMatch?.[1]
    ? bodyMatch[1].trim()
    : 'Hello {{executive_name}},\n\nHere is your governed Phone Call History briefing:\n- Total calls: {{total_calls}} ({{inbound_count}} incoming, {{outbound_count}} outgoing simulated)\n- Missed or failed calls: {{missed_or_failed_count}}\n- Recent call activity:\n{{recent_call_activity}}\n- Follow-up items:\n{{follow_up_items}}\n\nNote: Call metadata is treated as untrusted data, phone numbers remain masked, and call recording/transcription are disabled.\n\nBest regards,\nThaara Executive Partner';

  const sampleRecipient = sampleRecipientMatch?.[1]
    ? sampleRecipientMatch[1].trim()
    : 'executive@example.com';

  const composeParams: ComposeEmailWorkflowInput = {
    workflowName,
    triggerType: 'scheduled_digest',
    recipientVariable,
    allowedVariables,
    emailSubject,
    emailBodyTemplate
  };

  const dryRunParams: DryRunEmailWorkflowInput = {
    ...composeParams,
    sampleData: {
      recipient_email: sampleRecipient,
      executive_name: 'Aarav Sharma',
      total_calls: 6,
      inbound_count: 1,
      outbound_count: 5,
      missed_or_failed_count: 2,
      recent_call_activity:
        'Ananya Rao (+91 ******3210) [inbound, completed] | Vikram Menon (+91 ******1223) [outbound_simulated, answered]',
      follow_up_items:
        'External Advisory Desk (+1 ******0144) — failed_call_retry_or_review | Investor Relations Lead (+91 ******2233) — cancelled_call_reschedule_check'
    }
  };

  const stageParams: StageEmailWorkflowArtifactInput | undefined = requireApprovalGate
    ? {
        ...composeParams
      }
    : undefined;

  const phoneBriefingQuery: PhoneBriefingQuery = {
    ...(queryMatch?.[1] ? { query: queryMatch[1].trim() } : {}),
    limit: 25,
    workflowName
  };

  return {
    matched: true,
    workflowKind: 'phone_briefing',
    planTitle: 'Governed Phone Call Briefing Workflow Plan',
    requireApprovalGate,
    composeParams,
    dryRunParams,
    stageParams,
    phoneBriefingQuery,
    approvalGateParams: requireApprovalGate
      ? { task: 'stage_verified_phone_briefing_workflow_for_review' }
      : undefined
  };
}

/**
 * Deterministically detects whether a chat message is asking Thaara to create or dry-run
 * a governed email automation workflow, and extracts safe typed parameters.
 */
export function detectEmailAutomationChatRequest(
  userMessage: string
): EmailAutomationChatProposal | null {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return null;
  }

  const isMatch = EMAIL_AUTOMATION_REQUEST_PATTERNS.some((pattern) => pattern.test(trimmed));
  if (!isMatch) {
    return null;
  }

  const triggerType: EmailAutomationTriggerType = /\bwebhook\b/i.test(trimmed)
    ? 'webhook_inbound'
    : /\b(?:schedule|scheduled|daily|weekly|digest)\b/i.test(trimmed)
      ? 'scheduled_digest'
      : /\bform\b/i.test(trimmed)
        ? 'form_submission'
        : 'new_lead_inquiry';

  const requireApprovalGate =
    /\b(?:with\s+approval(?:\s+gate)?|require\s+approval|stage(?:\s+for\s+approval|\s+workflow|\s+email|\s+artifact)?|approval[\s-]*gated)\b/i.test(
      trimmed
    );

  // Allow explicit subject/body/sample recipient overrides in the user prompt for testing both happy and failure paths
  const subjectMatch = trimmed.match(/subject\s*:\s*"([^"]+)"/i);
  const bodyMatch = trimmed.match(/body\s*:\s*"([^"]+)"/i);
  const sampleRecipientMatch = trimmed.match(/sample\s+recipient\s*:\s*([^\s,;]+)/i);

  const workflowName = 'Executive Follow-Up Email Automation';
  const recipientVariable = 'recipient_email';
  const allowedVariables = ['recipient_email', 'recipient_name', 'company_name'];

  const emailSubject = subjectMatch?.[1]
    ? subjectMatch[1].trim()
    : 'Executive Follow-Up for {{company_name}}';

  const emailBodyTemplate = bodyMatch?.[1]
    ? bodyMatch[1].trim()
    : 'Hello {{recipient_name}},\n\nI am following up regarding {{company_name}}. Please let us know a convenient time to connect.\n\nBest regards,\nExecutive Office';

  const sampleRecipient = sampleRecipientMatch?.[1]
    ? sampleRecipientMatch[1].trim()
    : 'client@example.com';

  const composeParams: ComposeEmailWorkflowInput = {
    workflowName,
    triggerType,
    recipientVariable,
    allowedVariables,
    emailSubject,
    emailBodyTemplate
  };

  const dryRunParams: DryRunEmailWorkflowInput = {
    ...composeParams,
    sampleData: {
      recipient_email: sampleRecipient,
      recipient_name: 'Aarav Sharma',
      company_name: 'Quantum Weave'
    }
  };

  const stageParams: StageEmailWorkflowArtifactInput | undefined = requireApprovalGate
    ? {
        ...composeParams
      }
    : undefined;

  return {
    matched: true,
    workflowKind: 'email_automation',
    planTitle: 'Governed Email Automation Workflow Plan',
    requireApprovalGate,
    composeParams,
    dryRunParams,
    stageParams,
    approvalGateParams: requireApprovalGate
      ? { task: 'stage_verified_email_workflow_for_review' }
      : undefined
  };
}

/**
 * Executes a single governed plan step in its own scoped transaction with full worker parity:
 * - Atomic execution lease acquisition (`step_executions`)
 * - In-flight plan cancellation / failure check
 * - Parent dependency verification & proof forwarding
 * - Live creator membership & role re-evaluation via PolicyGateway
 * - Approval binding & parameter hash verification
 * - Crash recovery (`attempt_number > 1` -> conservative `unverified` for non-idempotent adapters)
 * - Transient retry lease release (`releaseLease` committed before retry)
 * - Truthful receipt persistence & downstream step cascading
 */
export async function executeGovernedPlanStep(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  planId: string,
  stepId: string,
  options?: {
    policyGateway?: PolicyGateway;
    adapters?: Map<string, ActionAdapter>;
    queueService?: JobQueueService;
    maxRetries?: number;
    workerId?: string;
    leaseDurationMs?: number;
    allowN8nInteractive?: boolean;
  }
): Promise<{
  success: boolean;
  retryError?: Error;
  result?: Record<string, unknown>;
}> {
  const workspaceId = scope.workspaceId;
  const policyGateway = options?.policyGateway ?? defaultPolicyGateway;
  const adapters = options?.adapters ?? defaultActionAdapters;
  const queueService = options?.queueService;
  const maxRetries = options?.maxRetries ?? 3;
  const workerId = options?.workerId ?? 'chat-governed-worker';
  const leaseDurationMs = options?.leaseDurationMs ?? 60000;
  const idempotencyKey = `step-exec:${workspaceId}:${planId}:${stepId}`;
  const leaseToken = crypto.randomUUID();

  // 1. Atomic lease acquisition in its own transaction (also transitions step/plan to 'running' so crash state is durable)
  let manualOnly = false;
  const executionLease = await db.withScopedTransaction(scope, async (txClient) => {
    if (!options?.allowN8nInteractive) {
      const storedStep = await new PlanStepRepository(txClient).findById(workspaceId, stepId);
      if (storedStep?.plan_id === planId && storedStep.action_name === N8N_CREATE_ACTION) {
        manualOnly = true;
        return null;
      }
    }
    const stepExecutionRepo = new StepExecutionRepository(txClient);
    const planRepo = new PlanRepository(txClient);
    const stepRepo = new PlanStepRepository(txClient);
    const lease = await stepExecutionRepo.acquireLease(
      workspaceId,
      planId,
      stepId,
      idempotencyKey,
      workerId,
      leaseToken,
      leaseDurationMs
    );
    if (lease) {
      const plan = await planRepo.findById(workspaceId, planId);
      const step = await stepRepo.findById(workspaceId, stepId);
      if (
        plan &&
        step &&
        !['cancelled', 'failed', 'completed'].includes(plan.status) &&
        ['queued', 'ready', 'blocked'].includes(step.status)
      ) {
        await stepRepo.transitionStatus(
          workspaceId,
          stepId,
          ['queued', 'ready', 'blocked'],
          'running'
        );
        if (plan.status !== 'running') {
          await planRepo.transitionStatus(
            workspaceId,
            planId,
            ['draft', 'queued', 'awaiting_approval'],
            'running'
          );
        }
      }
    }
    return lease;
  });

  if (manualOnly) return { success: false, result: { manualExecutionRequired: true } };

  // Never fall through without a lease
  if (!executionLease) {
    const existing = await db.withScopedTransaction(scope, async (txClient) => {
      const stepExecutionRepo = new StepExecutionRepository(txClient);
      return stepExecutionRepo.findByIdempotencyKey(workspaceId, idempotencyKey);
    });

    if (existing && (existing.status === 'completed' || existing.status === 'failed')) {
      return {
        success: existing.status === 'completed',
        result: { duplicateAcknowledged: true, skipped: true }
      };
    }

    return { success: true, result: { duplicateAcknowledged: true, skipped: true } };
  }

  const stepsToEnqueue: Array<{
    stepId: string;
    stepIndex: number;
    actionName: string;
  }> = [];

  const executionResult = await db.withScopedTransaction(scope, async (txClient) => {
    const planRepo = new PlanRepository(txClient);
    const stepRepo = new PlanStepRepository(txClient);
    const receiptRepo = new ReceiptRepository(txClient);
    const approvalRepo = new ApprovalRepository(txClient);
    const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
    const stepExecutionRepo = new StepExecutionRepository(txClient);
    const membershipRepo = new MembershipRepository(txClient);
    const auditRepo = new AuditEventRepository(txClient);

    const plan = await planRepo.findById(workspaceId, planId);
    if (!plan) {
      throw new Error(`Plan '${planId}' not found.`);
    }

    const step = await stepRepo.findById(workspaceId, stepId);
    if (!step) {
      throw new Error(`Step '${stepId}' not found.`);
    }

    // Check in-flight cancellation truthfulness
    if (plan.status === 'cancelled') {
      if (!['verified', 'unverified', 'failed', 'cancelled', 'skipped'].includes(step.status)) {
        await stepRepo.transitionStatus(
          workspaceId,
          stepId,
          ['queued', 'ready', 'blocked', 'running'],
          'cancelled'
        );
      }

      const existingReceipt = await receiptRepo.findByStepId(workspaceId, stepId);
      const receipt =
        existingReceipt ??
        (await receiptRepo.create(
          workspaceId,
          planId,
          stepId,
          step.action_name,
          'unverified',
          { reason: 'Plan was cancelled while step was scheduled or running' },
          'cancellation_audit'
        ));

      if (executionLease) {
        await stepExecutionRepo.failLease(workspaceId, executionLease.id, executionLease.lease_token);
      }

      return {
        success: false,
        result: { receiptStatus: 'unverified', receiptId: receipt.id, cancelled: true }
      };
    }

    if (plan.status === 'failed') {
      if (['queued', 'ready', 'blocked', 'running'].includes(step.status)) {
        await stepRepo.transitionStatus(
          workspaceId,
          stepId,
          ['queued', 'ready', 'blocked', 'running'],
          'cancelled'
        );
      }
      await stepExecutionRepo.failLease(workspaceId, executionLease.id, executionLease.lease_token);
      return { success: false, result: { reason: 'Plan has already failed' } };
    }

    if (
      ['verified', 'unverified', 'failed', 'not_configured', 'cancelled', 'skipped'].includes(
        step.status
      )
    ) {
      return { success: step.status === 'verified', result: { stepStatus: step.status } };
    }

    // Transition step and plan to running if not already transitioned during lease acquisition
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

    // 2. Validate parent dependencies & collect verified dependency proofs
    const dependencyProofs: Record<string, Record<string, unknown>> = {};
    for (const parentId of step.depends_on_step_ids) {
      const parent = await stepRepo.findById(workspaceId, parentId);
      if (!parent || parent.status !== 'verified') {
        const failReason = `Parent step '${parentId}' is not verified (status: ${parent?.status ?? 'missing'}).`;
        await stepRepo.transitionStatus(workspaceId, stepId, 'running', 'skipped', {
          reason: failReason
        });
        await planRepo.transitionStatus(workspaceId, planId, 'running', 'failed');
        await stepRepo.cancelNonTerminalSteps(workspaceId, planId);

        if (executionLease) {
          await stepExecutionRepo.failLease(
            workspaceId,
            executionLease.id,
            executionLease.lease_token
          );
        }

        return { success: false, result: { error: failReason, skipped: true } };
      }
      const parentReceipt = await receiptRepo.findByStepId(workspaceId, parentId);
      if (parentReceipt && parentReceipt.status === 'verified') {
        dependencyProofs[parentId] = parentReceipt.proof;
      }
    }

    // 3. Worker-time Policy Re-evaluation against live plan creator membership & approval binding
    const actionDefinition = defaultActionRegistry.get(step.action_name);
    const creatorMembership = await membershipRepo.findByUserAndWorkspace(
      workspaceId,
      plan.created_by_user_id
    );
    const binding = await bindingRepo.findByStepId(workspaceId, stepId);
    const approvalRecord = binding
      ? await approvalRepo.findById(workspaceId, binding.approval_request_id)
      : null;
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
      const decision = policyGateway.evaluate(
        {
          workspaceId,
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
        failReason = decision.reason;
      }
    }

    if (failReason) {
      await stepRepo.transitionStatus(workspaceId, stepId, 'running', 'failed', {
        error: failReason,
        reason: failReason
      });
      await planRepo.transitionStatus(workspaceId, planId, 'running', 'failed');
      await stepRepo.cancelNonTerminalSteps(workspaceId, planId);
      const receipt = await receiptRepo.create(
        workspaceId,
        planId,
        stepId,
        step.action_name,
        'failed',
        { error: failReason },
        'policy_rejection'
      );
      if (executionLease) {
        await stepExecutionRepo.failLease(workspaceId, executionLease.id, executionLease.lease_token);
      }
      await auditRepo.create(
        workspaceId,
        'step.policy_rejected',
        'plan_step',
        { receiptId: receipt.id, receiptStatus: 'failed', reasonCode: 'policy_rejected' },
        scope.userId,
        stepId
      );
      return {
        success: false,
        result: { receiptStatus: 'failed', receiptId: receipt.id, error: failReason }
      };
    }

    // 4. Adapter resolution & crash recovery protocol
    const adapter = adapters.get(step.action_name);
    const execContext: ActionExecutionContext = {
      workspaceId,
      planId,
      stepId,
      idempotencyKey,
      parameters: step.parameters,
      dependencyProofs,
      scope,
      approvedRequest: approvedRequest ?? undefined
    };

    if (executionLease && executionLease.attempt_number > 1) {
      if (!adapter || adapter.idempotencySupport === 'none') {
        const crashReason =
          'Crash recovery: Previous attempt on non-idempotent action timed out; outcome unknown.';
        await stepRepo.transitionStatus(workspaceId, stepId, 'running', 'unverified', {
          error: crashReason,
          reason: crashReason
        });
        await planRepo.transitionStatus(workspaceId, planId, 'running', 'failed');
        await stepRepo.cancelNonTerminalSteps(workspaceId, planId);

        const receipt = await receiptRepo.create(
          workspaceId,
          planId,
          stepId,
          step.action_name,
          'unverified',
          { reason: crashReason, previousAttempts: executionLease.attempt_number },
          'crash_recovery_conservative'
        );

        await stepExecutionRepo.failLease(workspaceId, executionLease.id, executionLease.lease_token);
        return {
          success: false,
          result: { receiptStatus: 'unverified', receiptId: receipt.id, error: crashReason }
        };
      }

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
          await stepExecutionRepo.completeLease(
            workspaceId,
            executionLease.id,
            executionLease.lease_token
          );

          await cascadeVerifiedStepDownstream(
            txClient,
            workspaceId,
            planId,
            scope.userId,
            stepsToEnqueue
          );

          return {
            success: true,
            result: { receiptStatus: 'verified', receiptId: receipt.id, reconciled: true }
          };
        }
      }
    }

    // 5. Execute adapter with retry and non-idempotent exception safety
    let actionResult: ActionResult;
    try {
      if (!adapter) {
        if (step.action_name.startsWith('connector.')) {
          actionResult = {
            success: false,
            status: 'not_configured',
            verificationMethod: 'connector_catalog_lookup',
            proof: { message: 'Connector credentials have not been configured in workspace.' },
            error: 'Connector credentials have not been configured in workspace.'
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
        actionResult = {
          success: false,
          status: 'unverified',
          verificationMethod: 'crash_recovery_conservative',
          proof: {
            error: errorMsg,
            reason:
              'Non-idempotent action threw during execution; outcome unknown, retry prohibited.',
            attempts: executionLease?.attempt_number ?? 1
          },
          error: errorMsg
        };
      } else if (executionLease && executionLease.attempt_number < maxRetries) {
        await stepExecutionRepo.releaseLease(
          workspaceId,
          executionLease.id,
          executionLease.lease_token
        );
        const requeued = await stepRepo.transitionStatus(workspaceId, stepId, 'running', 'queued', {
          transientError: errorMsg
        });
        if (requeued) {
          await auditRepo.create(workspaceId, 'step.retry_scheduled', 'plan_step',
            { executionId: executionLease.id, attemptNumber: executionLease.attempt_number }, scope.userId, stepId);
        }
        return {
          success: false,
          retryError: execErr instanceof Error ? execErr : new Error(errorMsg)
        };
      } else {
        actionResult = {
          success: false,
          status: 'failed',
          verificationMethod: 'error_capture',
          proof: { error: errorMsg, attempts: executionLease?.attempt_number ?? 1 },
          error: errorMsg
        };
      }
    }

    // 6. Transition step to terminal status first so enforce_receipt_integrity trigger passes
    await stepRepo.transitionStatus(
      workspaceId,
      stepId,
      'running',
      actionResult.status,
      actionResult.error ? { error: actionResult.error } : null
    );

    const receipt = await receiptRepo.create(
      workspaceId,
      planId,
      stepId,
      step.action_name,
      actionResult.status,
      actionResult.proof,
      actionResult.verificationMethod
    );

    if (executionLease) {
      if (actionResult.status === 'verified') {
        await stepExecutionRepo.completeLease(
          workspaceId,
          executionLease.id,
          executionLease.lease_token
        );
      } else {
        await stepExecutionRepo.failLease(workspaceId, executionLease.id, executionLease.lease_token);
      }
    }

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


    const planCompleted = await cascadeVerifiedStepDownstream(
      txClient,
      workspaceId,
      planId,
      scope.userId,
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

  if (queueService && stepsToEnqueue.length > 0) {
    for (const nextStep of stepsToEnqueue) {
      await queueService.enqueue(workspaceId, nextStep.stepId, 'plan.execute_step', {
        planId,
        stepId: nextStep.stepId,
        stepIndex: nextStep.stepIndex,
        actionName: nextStep.actionName
      });
    }
  }

  return executionResult;
}

async function cascadeVerifiedStepDownstream(
  txClient: any,
  workspaceId: string,
  planId: string,
  _actorUserId: string,
  stepsToEnqueue: Array<{ stepId: string; stepIndex: number; actionName: string }>
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
              stepId: candidate.id,
              stepIndex: candidate.step_index,
              actionName: candidate.action_name
            });
          } else if (candidate.status === 'blocked') {
            await stepRepo.transitionStatus(
              workspaceId,
              candidate.id,
              'blocked',
              'awaiting_approval'
            );
          }
        } else if (candidate.status === 'blocked') {
          await stepRepo.transitionStatus(workspaceId, candidate.id, 'blocked', 'queued');
          stepsToEnqueue.push({
            stepId: candidate.id,
            stepIndex: candidate.step_index,
            actionName: candidate.action_name
          });
        }
      }
    }
  }

  const finalSteps = await stepRepo.listByPlanId(workspaceId, planId);
  const allVerified = finalSteps.length > 0 && finalSteps.every((s) => s.status === 'verified');
  if (allVerified) {
    await planRepo.transitionStatus(workspaceId, planId, 'running', 'completed');
  }

  return allVerified;
}

/**
 * Drives all runnable ('queued' or expired-lease 'running') steps of a governed plan
 * in independent per-step transactions, with bounded retry handling on transient errors.
 * Runs detached from the HTTP request lifecycle so client disconnects do not abort plan completion.
 */
export async function driveGovernedPlanSteps(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  planId: string,
  options?: {
    policyGateway?: PolicyGateway;
    adapters?: Map<string, ActionAdapter>;
    queueService?: JobQueueService;
    maxRetries?: number;
    workerId?: string;
    leaseDurationMs?: number;
  }
): Promise<void> {
  const maxRetries = options?.maxRetries ?? 3;

  while (true) {
    const nextStep = await db.withScopedTransaction(scope, async (txClient) => {
      const planRepo = new PlanRepository(txClient);
      const stepRepo = new PlanStepRepository(txClient);
      const stepExecRepo = new StepExecutionRepository(txClient);
      const plan = await planRepo.findById(scope.workspaceId, planId);
      if (!plan || ['completed', 'failed', 'cancelled'].includes(plan.status)) {
        return null;
      }
      const steps = await stepRepo.listByPlanId(scope.workspaceId, planId);
      for (const s of steps) {
        if (s.action_name === N8N_CREATE_ACTION) continue;
        const idempKey = `step-exec:${scope.workspaceId}:${planId}:${s.id}`;
        const existingExec = await stepExecRepo.findByIdempotencyKey(scope.workspaceId, idempKey);
        if (s.status === 'queued') {
          if (
            !existingExec ||
            (existingExec.status === 'started' &&
              new Date(existingExec.lease_expires_at) <= new Date())
          ) {
            return s;
          }
        } else if (s.status === 'running') {
          if (
            !existingExec ||
            (existingExec.status === 'started' &&
              new Date(existingExec.lease_expires_at) <= new Date())
          ) {
            return s;
          }
        }
      }
      return null;
    });

    if (!nextStep) {
      break;
    }

    let attempt = 1;
    while (attempt <= maxRetries) {
      const stepOutcome = await executeGovernedPlanStep(
        db,
        scope,
        planId,
        nextStep.id,
        options
      );
      if (stepOutcome.retryError && attempt < maxRetries) {
        attempt++;
        continue;
      }
      break;
    }
  }
}

/**
 * Schedules or joins a background plan execution promise in-process when `queueService` is not used,
 * ensuring at most one in-memory driver per `planId` at a time.
 */
export function scheduleBackgroundPlanExecution(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  planId: string,
  options?: {
    policyGateway?: PolicyGateway;
    adapters?: Map<string, ActionAdapter>;
    queueService?: JobQueueService;
    maxRetries?: number;
    workerId?: string;
    leaseDurationMs?: number;
  }
): Promise<void> {
  const existing = activeBackgroundPlanExecutions.get(planId);
  if (existing) {
    return existing;
  }
  const bgPromise = driveGovernedPlanSteps(db, scope, planId, options).finally(() => {
    activeBackgroundPlanExecutions.delete(planId);
  });
  activeBackgroundPlanExecutions.set(planId, bgPromise);
  return bgPromise;
}

/**
 * Reconciles and recovers any orphaned 'queued' or expired-lease 'running' steps of a governed plan
 * from PostgreSQL after an API process restart or approval decision.
 *
 * - Never runs both API and worker paths simultaneously:
 *   - If `queueService` is configured, it enqueues recoverable steps to `queueService`.
 *   - If `queueService` is not configured, it drives recoverable steps via `scheduleBackgroundPlanExecution`.
 */
export async function reconcileGovernedPlanExecution(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  planId: string,
  options?: {
    policyGateway?: PolicyGateway;
    adapters?: Map<string, ActionAdapter>;
    queueService?: JobQueueService;
    maxRetries?: number;
    workerId?: string;
    leaseDurationMs?: number;
  }
): Promise<void> {
  const activeBg = activeBackgroundPlanExecutions.get(planId);
  if (activeBg) {
    await activeBg;
    return;
  }

  const recoverableSteps = await db.withScopedTransaction(scope, async (txClient) => {
    const planRepo = new PlanRepository(txClient);
    const stepRepo = new PlanStepRepository(txClient);
    const stepExecRepo = new StepExecutionRepository(txClient);
    const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
    const approvalRepo = new ApprovalRepository(txClient);

    const plan = await planRepo.findById(scope.workspaceId, planId);
    if (!plan || ['completed', 'failed', 'cancelled', 'draft'].includes(plan.status)) {
      return [];
    }

    let steps = await stepRepo.listByPlanId(scope.workspaceId, planId);
    const stepMap = new Map(steps.map((s) => [s.id, s]));

    // Cascade any blocked or awaiting_approval step whose parent steps are all verified and approval is approved
    let cascaded = false;
    for (const candidate of steps) {
      if (candidate.status !== 'blocked' && candidate.status !== 'awaiting_approval') {
        continue;
      }
      if (candidate.depends_on_step_ids.length === 0 && candidate.status === 'blocked') {
        continue;
      }
      const allParentsVerified = candidate.depends_on_step_ids.every((depId) => {
        const p = stepMap.get(depId);
        return p && p.status === 'verified';
      });
      if (!allParentsVerified) {
        continue;
      }
      if (candidate.action_class === 'write' && candidate.approval_mode !== 'none') {
        const binding = await bindingRepo.findByStepId(scope.workspaceId, candidate.id);
        const approval = binding
          ? await approvalRepo.findById(scope.workspaceId, binding.approval_request_id)
          : null;
        if (
          !approval ||
          approval.status !== 'approved' ||
          new Date(approval.expires_at) <= new Date()
        ) {
          continue;
        }
      }
      const transitioned = await stepRepo.transitionStatus(
        scope.workspaceId,
        candidate.id,
        ['blocked', 'awaiting_approval'],
        'queued'
      );
      if (transitioned) {
        cascaded = true;
      }
    }

    if (cascaded) {
      steps = await stepRepo.listByPlanId(scope.workspaceId, planId);
    }

    const allVerified = steps.length > 0 && steps.every((s) => s.status === 'verified');
    if (allVerified && plan.status !== 'completed') {
      await planRepo.transitionStatus(
        scope.workspaceId,
        planId,
        ['queued', 'running', 'awaiting_approval', 'paused'],
        'completed'
      );
      return [];
    }

    const toRecover: Array<{ stepId: string; stepIndex: number; actionName: string }> = [];
    for (const s of steps) {
      if (s.status !== 'queued' && s.status !== 'running') {
        continue;
      }
      const idempKey = `step-exec:${scope.workspaceId}:${planId}:${s.id}`;
      const existingExec = await stepExecRepo.findByIdempotencyKey(scope.workspaceId, idempKey);
      if (!existingExec) {
        toRecover.push({
          stepId: s.id,
          stepIndex: s.step_index,
          actionName: s.action_name
        });
      } else if (
        existingExec.status === 'started' &&
        new Date(existingExec.lease_expires_at) <= new Date()
      ) {
        toRecover.push({
          stepId: s.id,
          stepIndex: s.step_index,
          actionName: s.action_name
        });
      }
    }

    return toRecover;
  });

  if (recoverableSteps.length === 0) {
    return;
  }

  if (options?.queueService) {
    for (const s of recoverableSteps) {
      await options.queueService.enqueue(scope.workspaceId, s.stepId, 'plan.execute_step', {
        planId,
        stepId: s.stepId,
        stepIndex: s.stepIndex,
        actionName: s.actionName
      });
    }
  } else {
    await scheduleBackgroundPlanExecution(db, scope, planId, options);
  }
}

async function waitForQueueOrSignal(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  planId: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      return;
    }
    const isSettled = await db.withScopedTransaction(scope, async (txClient) => {
      const planRepo = new PlanRepository(txClient);
      const stepRepo = new PlanStepRepository(txClient);
      const plan = await planRepo.findById(scope.workspaceId, planId);
      if (!plan || ['completed', 'failed', 'cancelled'].includes(plan.status)) {
        return true;
      }
      const steps = await stepRepo.listByPlanId(scope.workspaceId, planId);
      const hasActiveOrQueued = steps.some(
        (s) => s.status === 'queued' || s.status === 'running'
      );
      return !hasActiveOrQueued;
    });
    if (isSettled) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 15));
  }
}

function waitWithAbortSignal(promise: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise
      .then(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      })
      .catch((err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

/**
 * Reads the persisted plan, steps, and receipts from PostgreSQL and constructs
 * a truthful executive summary covering all valid states:
 * `queued`, `running`, `awaiting_approval`, `completed` (`verified`), `unverified`, `failed`, and `cancelled`.
 */
export async function buildChatAutomationOutcome(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  planId: string,
  approvalId: string | null,
  proposal: EmailAutomationChatProposal,
  idempotentReplay = false
): Promise<ChatAutomationExecutionOutcome> {
  const summary = await db.withScopedTransaction(scope, async (txClient) => {
    const planRepo = new PlanRepository(txClient);
    const stepRepo = new PlanStepRepository(txClient);
    const receiptRepo = new ReceiptRepository(txClient);
    const bindingRepo = new PlanStepApprovalBindingRepository(txClient);

    const plan = await planRepo.findById(scope.workspaceId, planId);
    const steps = await stepRepo.listByPlanId(scope.workspaceId, planId);
    const receipts = await receiptRepo.listByPlanId(scope.workspaceId, planId);
    const receiptByStepId = new Map(receipts.map((r) => [r.plan_step_id, r]));

    let resolvedApprovalId = approvalId;
    if (!resolvedApprovalId) {
      for (const s of steps) {
        if (s.approval_request_id) {
          resolvedApprovalId = s.approval_request_id;
          break;
        }
        const binding = await bindingRepo.findByStepId(scope.workspaceId, s.id);
        if (binding) {
          resolvedApprovalId = binding.approval_request_id;
          break;
        }
      }
    }

    const stepSummaries: ChatAutomationStepSummary[] = steps.map((s) => {
      const r = receiptByStepId.get(s.id);
      const errObj = s.error as { error?: string; reason?: string } | null;
      return {
        stepId: s.id,
        stepOrder: s.step_index,
        actionName: s.action_name,
        status: s.status,
        receiptId: r?.id ?? null,
        receiptStatus: r?.status ?? null,
        verificationMethod: r?.verification_method ?? null,
        proof: r?.proof ?? null,
        error: errObj?.error ?? errObj?.reason ?? null
      };
    });

    return {
      planStatus: plan?.status ?? 'failed',
      resolvedApprovalId,
      stepSummaries
    };
  });

  const composeStep = summary.stepSummaries.find(
    (s) => s.actionName === 'automation.email.compose_workflow'
  );
  const dryRunStep = summary.stepSummaries.find(
    (s) => s.actionName === 'automation.email.dry_run_test'
  );
  const approvalStep = summary.stepSummaries.find(
    (s) =>
      s.actionName === 'automation.email.stage_workflow_artifact' ||
      s.actionName === 'test.approval_gated_hash_task'
  );
  const unverifiedStep = summary.stepSummaries.find(
    (s) => s.status === 'unverified' || s.receiptStatus === 'unverified'
  );
  const failedStep = summary.stepSummaries.find(
    (s) => s.status === 'failed' || s.receiptStatus === 'failed'
  );

  const workflowHash =
    typeof composeStep?.proof?.workflowHash === 'string' ? composeStep.proof.workflowHash : null;
  const dryRunHash =
    typeof dryRunStep?.proof?.workflowHash === 'string' && dryRunStep?.status === 'verified'
      ? dryRunStep.proof.workflowHash
      : null;
  const stagedArtifactId =
    typeof approvalStep?.proof?.artifactId === 'string' && approvalStep?.status === 'verified'
      ? approvalStep.proof.artifactId
      : null;

  const hasQueuedOrRunning = summary.stepSummaries.some(
    (s) => s.status === 'queued' || s.status === 'running'
  );
  const hasRunning = summary.stepSummaries.some((s) => s.status === 'running');

  let effectivePlanStatus: string = summary.planStatus;
  if (unverifiedStep) {
    effectivePlanStatus = 'unverified';
  } else if (
    summary.planStatus === 'running' &&
    !hasQueuedOrRunning &&
    approvalStep?.status === 'awaiting_approval'
  ) {
    effectivePlanStatus = 'awaiting_approval';
  } else if (
    summary.planStatus === 'awaiting_approval' &&
    hasQueuedOrRunning &&
    composeStep?.status !== 'verified'
  ) {
    effectivePlanStatus = hasRunning ? 'running' : 'queued';
  }

  const isCalendarBriefing =
    proposal.workflowKind === 'calendar_briefing' ||
    proposal.planTitle === 'Governed Calendar Briefing Workflow Plan';
  const isWhatsAppBriefing =
    proposal.workflowKind === 'whatsapp_briefing' ||
    proposal.planTitle === 'Governed WhatsApp Briefing Workflow Plan';
  const isPhoneBriefing =
    proposal.workflowKind === 'phone_briefing' ||
    proposal.planTitle === 'Governed Phone Call Briefing Workflow Plan';
  const workflowLabel = isCalendarBriefing
    ? 'calendar briefing workflow plan'
    : isWhatsAppBriefing
      ? 'WhatsApp briefing workflow plan'
      : isPhoneBriefing
        ? 'Phone call briefing workflow plan'
        : 'email automation plan';
  const calendarBriefingLines =
    isCalendarBriefing && proposal.calendarBriefing
      ? [
          ``,
          `### Authorized Daily Calendar Briefing (\`calendar.briefing.prepare\`)`,
          `- **Time Zone:** \`${proposal.calendarBriefing.timeZone}\``,
          `- **Headline:** ${proposal.calendarBriefing.headline}`,
          `- **Conflicts:** \`${proposal.calendarBriefing.conflictCount}\` (${proposal.calendarBriefing.conflictEventIds.join(', ') || 'none'})`,
          `- **Offline n8n Blueprint:** \`${proposal.calendarBriefing.n8nBlueprint?.name ?? proposal.composeParams.workflowName}\` (\`active: ${String(proposal.calendarBriefing.n8nBlueprint?.active ?? false)}\`)`
        ]
      : [];
  const whatsappBriefingLines =
    isWhatsAppBriefing && proposal.whatsappBriefing
      ? [
          ``,
          `### Authorized WhatsApp Conversation Briefing (\`whatsapp.briefing.prepare\`)`,
          `- **Headline:** ${proposal.whatsappBriefing.headline}`,
          `- **Unread Messages:** \`${proposal.whatsappBriefing.unreadCount}\` across \`${proposal.whatsappBriefing.totalThreads}\` thread(s)`,
          `- **Items Needing Attention:** \`${proposal.whatsappBriefing.attentionCount}\` (${proposal.whatsappBriefing.attentionItems.map((i) => `${i.sender.displayName} [${i.sender.maskedPhone}]`).join(', ') || 'none'})`,
          `- **Offline n8n Blueprint:** \`${proposal.whatsappBriefing.n8nBlueprint?.name ?? proposal.composeParams.workflowName}\` (\`active: ${String(proposal.whatsappBriefing.n8nBlueprint?.active ?? false)}\`)`
        ]
      : [];
  const phoneBriefingLines =
    isPhoneBriefing && proposal.phoneBriefing
      ? [
          ``,
          `### Authorized Phone Call History Briefing (\`phone.briefing.prepare\`)`,
          `- **Headline:** ${proposal.phoneBriefing.headline}`,
          `- **Call Breakdown:** \`${proposal.phoneBriefing.totalCalls}\` total (\`${proposal.phoneBriefing.inboundCount}\` incoming, \`${proposal.phoneBriefing.outboundSimulatedCount}\` outgoing simulated, \`${proposal.phoneBriefing.missedOrFailedCount}\` missed/failed)`,
          `- **Follow-Up Items:** \`${proposal.phoneBriefing.followUpCount}\` (${proposal.phoneBriefing.followUpItems.map((i) => `${i.participant.displayName} [${i.participant.maskedPhone}]`).join(', ') || 'none'})`,
          `- **Offline n8n Blueprint:** \`${proposal.phoneBriefing.n8nBlueprint?.name ?? proposal.composeParams.workflowName}\` (\`active: ${String(proposal.phoneBriefing.n8nBlueprint?.active ?? false)}\`, \`recordingEnabled: false\`, \`transcriptionEnabled: false\`)`
        ]
      : [];
  const connectorBriefingLines = [
    ...calendarBriefingLines,
    ...whatsappBriefingLines,
    ...phoneBriefingLines
  ];

  let assistantResponseText: string;
  if (effectivePlanStatus === 'completed') {
    const dryRunReport = dryRunStep?.proof?.dryRunReport as
      | { renderedPreview?: { recipient?: string; subject?: string; body?: string } | null }
      | undefined;
    const preview = dryRunReport?.renderedPreview;
    assistantResponseText = [
      `I have created and verified your governed ${workflowLabel} (**Plan ID:** \`${planId}\`, **Status:** \`completed\`).`,
      ``,
      `### Verified Execution Steps`,
      `1. **Compose Offline Email Workflow (\`automation.email.compose_workflow\`)** — Status: \`${composeStep?.status}\` (Receipt: \`${composeStep?.receiptId}\`, Workflow Hash: \`${workflowHash}\`)`,
      `2. **Offline Dry-Run Validation (\`automation.email.dry_run_test\`)** — Status: \`${dryRunStep?.status}\` (Receipt: \`${dryRunStep?.receiptId}\`, Dry-Run Hash: \`${dryRunHash}\`)`,
      ...(approvalStep
        ? [
            `3. **Approval-Gated Offline Staging (\`${approvalStep.actionName}\`)** — Status: \`${approvalStep.status}\` (Receipt: \`${approvalStep.receiptId}\`${stagedArtifactId ? `, Artifact ID: \`${stagedArtifactId}\`` : ''})`
          ]
        : []),
      ...connectorBriefingLines,
      ``,
      `### Dry-Run Preview`,
      `- **Sample Recipient:** \`${preview?.recipient ?? String(proposal.dryRunParams.sampleData.recipient_email ?? '')}\``,
      `- **Rendered Subject:** ${preview?.subject ?? proposal.composeParams.emailSubject}`,
      ``,
      `> **Truthful Governance Notice:** The generated n8n workflow artifact is strictly **inactive and offline** (\`active: false\`). No real email was sent, no WhatsApp message was sent, and no external connector or workflow was activated.`
    ].join('\n');
  } else if (effectivePlanStatus === 'awaiting_approval') {
    assistantResponseText = [
      `I have composed and dry-run tested your ${workflowLabel} (**Plan ID:** \`${planId}\`), and staged the write step for your explicit approval (**Status:** \`awaiting_approval\`, **Approval ID:** \`${summary.resolvedApprovalId}\`).`,
      ``,
      `### Step Progress`,
      `1. **Compose Offline Email Workflow (\`automation.email.compose_workflow\`)** — Status: \`${composeStep?.status}\` (Workflow Hash: \`${workflowHash}\`)`,
      `2. **Offline Dry-Run Validation (\`automation.email.dry_run_test\`)** — Status: \`${dryRunStep?.status}\` (Dry-Run Hash: \`${dryRunHash}\`)`,
      `3. **Approval-Gated Offline Staging (\`${approvalStep?.actionName}\`)** — Status: \`${approvalStep?.status}\` (Waiting for explicit approval \`${summary.resolvedApprovalId}\`)`,
      ...connectorBriefingLines,
      ``,
      `> **Truthful Governance Notice:** The generated n8n workflow artifact remains **inactive and offline** (\`active: false\`). No real email was sent, no WhatsApp message was sent, and no external workflow was activated.`
    ].join('\n');
  } else if (effectivePlanStatus === 'queued' || effectivePlanStatus === 'running') {
    const stepLines = summary.stepSummaries.map(
      (s, idx) => `${idx + 1}. **\`${s.actionName}\`** — Status: \`${s.status}\``
    );
    assistantResponseText = [
      `I have created and queued your governed ${workflowLabel} (**Plan ID:** \`${planId}\`, **Status:** \`${effectivePlanStatus}\`). Background worker execution is in progress.`,
      ``,
      `### Current Step States`,
      ...stepLines,
      ...connectorBriefingLines,
      ``,
      `> **Truthful Governance Notice:** All email workflow steps run **offline only** (\`active: false\`). No real email was sent and no external workflow was activated.`
    ].join('\n');
  } else if (effectivePlanStatus === 'unverified') {
    assistantResponseText = [
      `I created a governed ${workflowLabel} (**Plan ID:** \`${planId}\`), and execution halted with status \`unverified\` (**Plan Status:** \`${summary.planStatus}\`).`,
      ``,
      `- **Unverified Step:** \`${unverifiedStep?.actionName ?? 'unknown'}\` (Receipt Status: \`${unverifiedStep?.receiptStatus ?? 'unverified'}\`, Method: \`${unverifiedStep?.verificationMethod ?? 'crash_recovery_conservative'}\`)`,
      `- **Reason:** ${unverifiedStep?.error ?? 'Action outcome could not be verified; automatic retry was prohibited for safety.'}`,
      ``,
      `> **Truthful Governance Notice:** Downstream steps were cancelled. The workflow remains **inactive and offline**, and no email was sent.`
    ].join('\n');
  } else {
    assistantResponseText = [
      `I created a governed ${workflowLabel} (**Plan ID:** \`${planId}\`), but execution stopped truthfully with status \`${summary.planStatus}\`.`,
      ``,
      `- **Failed Step:** \`${failedStep?.actionName ?? 'unknown'}\` (Receipt Status: \`${failedStep?.receiptStatus ?? summary.planStatus}\`)`,
      `- **Reason:** ${failedStep?.error ?? 'Validation, cancellation, or policy check halted governed execution.'}`,
      ``,
      `> **Truthful Governance Notice:** Downstream steps were cancelled. The workflow remains **inactive and offline**, and no email was sent.`
    ].join('\n');
  }

  return {
    executed: true,
    planId,
    planStatus: effectivePlanStatus,
    approvalId: summary.resolvedApprovalId,
    steps: summary.stepSummaries,
    workflowHash,
    dryRunHash,
    stagedArtifactId,
    assistantResponseText,
    idempotentReplay
  };
}

/**
 * Prepares and enriches a Calendar briefing chat proposal through `calendar.briefing.prepare`
 * PolicyGateway validation, `GoogleCalendarFoundation.prepareBriefing` (when connected),
 * and `buildCalendarBriefingN8nBlueprint` (`active: false`), then executes the governed plan.
 */
export async function executeChatCalendarBriefingPlan(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  proposal: EmailAutomationChatProposal,
  policyOrOptions: PolicyGateway | ChatAutomationExecutionOptions = defaultPolicyGateway
): Promise<ChatAutomationExecutionOutcome> {
  const options: ChatAutomationExecutionOptions =
    'evaluate' in policyOrOptions
      ? { policyGateway: policyOrOptions }
      : policyOrOptions;
  const policyGateway = options.policyGateway ?? defaultPolicyGateway;

  const briefingQuery: GoogleCalendarBriefingQuery = proposal.briefingQuery ?? {
    windowStart: '2026-10-19T00:00:00.000Z',
    windowEnd: '2026-10-20T00:00:00.000Z',
    timeZone: String(proposal.dryRunParams.sampleData.time_zone ?? 'UTC'),
    limit: 25,
    includeCancelled: false,
    workflowName: proposal.composeParams.workflowName
  };

  const briefingActionDef = defaultActionRegistry.get('calendar.briefing.prepare');
  if (!briefingActionDef || !briefingActionDef.validate(briefingQuery)) {
    throw new ValidationError(
      `Parameters for 'calendar.briefing.prepare' failed schema validation.`
    );
  }

  const briefingDecision = policyGateway.evaluate(
    scope,
    {
      actionName: 'calendar.briefing.prepare',
      parameters: briefingQuery,
      idempotencyKey: `chat-calendar-briefing-preflight:${scope.workspaceId}:${scope.userId}:${briefingQuery.windowStart}:${briefingQuery.windowEnd}:${briefingQuery.timeZone}`
    },
    undefined,
    scope.userId
  );

  if (!briefingDecision.allowed) {
    if (briefingDecision.status === 'REJECTED_UNAUTHORIZED') {
      throw new ForbiddenError(
        `PolicyGateway denied 'calendar.briefing.prepare': ${briefingDecision.reason || 'Unauthorized'}`
      );
    }
    throw new ValidationError(
      `PolicyGateway denied 'calendar.briefing.prepare': ${briefingDecision.reason || 'Denied'}`
    );
  }

  const { blueprint: offlineCalendarBlueprint } = buildCalendarBriefingN8nBlueprint({
    workflowName: briefingQuery.workflowName ?? proposal.composeParams.workflowName,
    n8nContext: {
      connector: 'google_calendar',
      operation: 'read_agenda_snapshot',
      readOnly: true,
      windowStart: briefingQuery.windowStart,
      windowEnd: briefingQuery.windowEnd,
      timeZone: briefingQuery.timeZone,
      eventIds: []
    },
    conflictEventIds: []
  });
  const blueprintValidation = validateN8nWorkflowBlueprint(offlineCalendarBlueprint);
  if (offlineCalendarBlueprint.active !== false || !blueprintValidation.valid) {
    throw new ValidationError('Calendar briefing n8n blueprint failed offline safety validation.');
  }

  let enrichedProposal: EmailAutomationChatProposal = {
    ...proposal,
    workflowKind: 'calendar_briefing',
    briefingQuery
  };

  if (options.googleCalendar && !proposal.calendarBriefing) {
    const calStatus = await options.googleCalendar.status(scope);
    if (calStatus.status === 'connected') {
      const briefing = await options.googleCalendar.prepareBriefing(scope, briefingQuery);
      const conflictSummary =
        briefing.conflictCount > 0
          ? `${briefing.conflictCount} overlapping appointments (${briefing.conflictEventIds.join(', ')})`
          : 'No scheduling conflicts';
      const upcomingSchedule =
        briefing.appointments.length > 0
          ? briefing.appointments
              .map(
                (apt) =>
                  `${apt.localTimeRange} ${apt.summary}${apt.hasConflict ? ' [CONFLICT]' : ''}${apt.descriptionSnippet ? ` — ${apt.descriptionSnippet}` : ''}`
              )
              .join(' | ')
          : 'No scheduled appointments';

      enrichedProposal = {
        ...enrichedProposal,
        calendarBriefing: briefing,
        dryRunParams: {
          ...enrichedProposal.dryRunParams,
          sampleData: {
            ...enrichedProposal.dryRunParams.sampleData,
            briefing_date: briefing.windowStart.slice(0, 10),
            time_zone: briefing.timeZone,
            appointment_count: briefing.totalEvents,
            conflict_summary: conflictSummary,
            upcoming_schedule: upcomingSchedule
          }
        }
      };
    }
  }

  return executeGovernedChatAutomationPlanInternal(db, scope, enrichedProposal, options);
}

/**
 * Prepares and enriches a WhatsApp conversation briefing chat proposal through `whatsapp.briefing.prepare`
 * PolicyGateway validation, `WhatsAppFoundation.prepareBriefing` (when connected),
 * and `buildWhatsAppBriefingN8nBlueprint` (`active: false`, zero raw private messages), then executes the governed plan.
 */
export async function executeChatWhatsAppBriefingPlan(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  proposal: EmailAutomationChatProposal,
  policyOrOptions: PolicyGateway | ChatAutomationExecutionOptions = defaultPolicyGateway
): Promise<ChatAutomationExecutionOutcome> {
  const options: ChatAutomationExecutionOptions =
    'evaluate' in policyOrOptions
      ? { policyGateway: policyOrOptions }
      : policyOrOptions;
  const policyGateway = options.policyGateway ?? defaultPolicyGateway;

  const whatsappBriefingQuery: WhatsAppBriefingQuery = proposal.whatsappBriefingQuery ?? {
    limit: 25,
    workflowName: proposal.composeParams.workflowName
  };

  const briefingActionDef = defaultActionRegistry.get('whatsapp.briefing.prepare');
  if (!briefingActionDef || !briefingActionDef.validate(whatsappBriefingQuery)) {
    throw new ValidationError(
      `Parameters for 'whatsapp.briefing.prepare' failed schema validation.`
    );
  }

  const briefingDecision = policyGateway.evaluate(
    scope,
    {
      actionName: 'whatsapp.briefing.prepare',
      parameters: whatsappBriefingQuery,
      idempotencyKey: `chat-whatsapp-briefing-preflight:${scope.workspaceId}:${scope.userId}:${whatsappBriefingQuery.limit ?? 25}:${whatsappBriefingQuery.threadId ?? 'all'}`
    },
    undefined,
    scope.userId
  );

  if (!briefingDecision.allowed) {
    if (briefingDecision.status === 'REJECTED_UNAUTHORIZED') {
      throw new ForbiddenError(
        `PolicyGateway denied 'whatsapp.briefing.prepare': ${briefingDecision.reason || 'Unauthorized'}`
      );
    }
    throw new ValidationError(
      `PolicyGateway denied 'whatsapp.briefing.prepare': ${briefingDecision.reason || 'Denied'}`
    );
  }

  const { blueprint: offlineWhatsAppBlueprint } = buildWhatsAppBriefingN8nBlueprint({
    workflowName: whatsappBriefingQuery.workflowName ?? proposal.composeParams.workflowName,
    n8nContext: {
      connector: 'whatsapp_business',
      operation: 'read_conversation_briefing_metadata',
      readOnly: true,
      active: false,
      threadIds: [],
      attentionMessageIds: [],
      unreadTotal: 0
    }
  });
  const blueprintValidation = validateN8nWorkflowBlueprint(offlineWhatsAppBlueprint);
  if (offlineWhatsAppBlueprint.active !== false || !blueprintValidation.valid) {
    throw new ValidationError('WhatsApp briefing n8n blueprint failed offline safety validation.');
  }

  let enrichedProposal: EmailAutomationChatProposal = {
    ...proposal,
    workflowKind: 'whatsapp_briefing',
    whatsappBriefingQuery
  };

  if (options.whatsapp && !proposal.whatsappBriefing) {
    const waStatus = await options.whatsapp.status(scope);
    if (waStatus.status === 'connected') {
      const briefing = await options.whatsapp.prepareBriefing(scope, whatsappBriefingQuery);
      const conversationSummary =
        briefing.conversationSummaries.length > 0
          ? briefing.conversationSummaries
              .map(
                (t) =>
                  `${t.participant.displayName} (${t.participant.maskedPhone}) [unread: ${t.unreadCount}${t.needsAttention ? ', NEEDS ATTENTION' : ''}]: ${t.summarySnippet}`
              )
              .join(' | ')
          : 'No active WhatsApp threads';
      const attentionSummary =
        briefing.attentionItems.length > 0
          ? briefing.attentionItems
              .map(
                (item) =>
                  `${item.sender.displayName} (${item.sender.maskedPhone}) — ${item.reason}: ${item.snippet}`
              )
              .join(' | ')
          : 'No items needing attention';

      enrichedProposal = {
        ...enrichedProposal,
        whatsappBriefing: briefing,
        dryRunParams: {
          ...enrichedProposal.dryRunParams,
          sampleData: {
            ...enrichedProposal.dryRunParams.sampleData,
            unread_count: briefing.unreadCount,
            attention_count: briefing.attentionCount,
            conversation_summary: conversationSummary,
            attention_items: attentionSummary
          }
        }
      };
    }
  }

  return executeGovernedChatAutomationPlanInternal(db, scope, enrichedProposal, options);
}

/**
 * Prepares and enriches a Phone call-history briefing chat proposal through `phone.briefing.prepare`
 * PolicyGateway validation, `PhoneFoundation.prepareBriefing` (when connected),
 * and `buildPhoneBriefingN8nBlueprint` (`active: false`, zero raw phone numbers or private call details), then executes the governed plan.
 */
export async function executeChatPhoneBriefingPlan(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  proposal: EmailAutomationChatProposal,
  policyOrOptions: PolicyGateway | ChatAutomationExecutionOptions = defaultPolicyGateway
): Promise<ChatAutomationExecutionOutcome> {
  const options: ChatAutomationExecutionOptions =
    'evaluate' in policyOrOptions
      ? { policyGateway: policyOrOptions }
      : policyOrOptions;
  const policyGateway = options.policyGateway ?? defaultPolicyGateway;

  const phoneBriefingQuery: PhoneBriefingQuery = proposal.phoneBriefingQuery ?? {
    limit: 25,
    workflowName: proposal.composeParams.workflowName
  };

  const briefingActionDef = defaultActionRegistry.get('phone.briefing.prepare');
  if (!briefingActionDef || !briefingActionDef.validate(phoneBriefingQuery)) {
    throw new ValidationError(
      `Parameters for 'phone.briefing.prepare' failed schema validation.`
    );
  }

  const briefingDecision = policyGateway.evaluate(
    scope,
    {
      actionName: 'phone.briefing.prepare',
      parameters: phoneBriefingQuery,
      idempotencyKey: `chat-phone-briefing-preflight:${scope.workspaceId}:${scope.userId}:${phoneBriefingQuery.limit ?? 25}:${phoneBriefingQuery.direction ?? 'all'}:${phoneBriefingQuery.lifecycleState ?? 'all'}`
    },
    undefined,
    scope.userId
  );

  if (!briefingDecision.allowed) {
    if (briefingDecision.status === 'REJECTED_UNAUTHORIZED') {
      throw new ForbiddenError(
        `PolicyGateway denied 'phone.briefing.prepare': ${briefingDecision.reason || 'Unauthorized'}`
      );
    }
    throw new ValidationError(
      `PolicyGateway denied 'phone.briefing.prepare': ${briefingDecision.reason || 'Denied'}`
    );
  }

  const { blueprint: offlinePhoneBlueprint } = buildPhoneBriefingN8nBlueprint({
    workflowName: phoneBriefingQuery.workflowName ?? proposal.composeParams.workflowName,
    n8nContext: {
      connector: 'phone_telephony',
      operation: 'read_call_history_briefing_metadata',
      readOnly: true,
      active: false,
      recordingEnabled: false,
      transcriptionEnabled: false,
      callIds: [],
      missedOrFailedCallIds: [],
      followUpCallIds: [],
      totalCalls: 0,
      inboundCount: 0,
      outboundSimulatedCount: 0,
      missedOrFailedCount: 0
    }
  });
  const blueprintValidation = validateN8nWorkflowBlueprint(offlinePhoneBlueprint);
  if (offlinePhoneBlueprint.active !== false || !blueprintValidation.valid) {
    throw new ValidationError('Phone briefing n8n blueprint failed offline safety validation.');
  }

  let enrichedProposal: EmailAutomationChatProposal = {
    ...proposal,
    workflowKind: 'phone_briefing',
    phoneBriefingQuery
  };

  if (options.phone && !proposal.phoneBriefing) {
    const phoneStatus = await options.phone.status(scope);
    if (phoneStatus.status === 'connected') {
      const briefing = await options.phone.prepareBriefing(scope, phoneBriefingQuery);
      const recentCallActivity =
        briefing.recentCalls.length > 0
          ? briefing.recentCalls
              .map(
                (c) =>
                  `${c.participant.displayName} (${c.participant.maskedPhone}) [${c.direction}, ${c.lifecycleState}]: ${c.summarySnippet}`
              )
              .join(' | ')
          : 'No recent phone calls';
      const followUpSummary =
        briefing.followUpItems.length > 0
          ? briefing.followUpItems
              .map(
                (item) =>
                  `${item.participant.displayName} (${item.participant.maskedPhone}) — ${item.reason}: ${item.snippet}`
              )
              .join(' | ')
          : 'No follow-up items';

      enrichedProposal = {
        ...enrichedProposal,
        phoneBriefing: briefing,
        dryRunParams: {
          ...enrichedProposal.dryRunParams,
          sampleData: {
            ...enrichedProposal.dryRunParams.sampleData,
            total_calls: briefing.totalCalls,
            inbound_count: briefing.inboundCount,
            outbound_count: briefing.outboundSimulatedCount,
            missed_or_failed_count: briefing.missedOrFailedCount,
            recent_call_activity: recentCallActivity,
            follow_up_items: followUpSummary
          }
        }
      };
    }
  }

  return executeGovernedChatAutomationPlanInternal(db, scope, enrichedProposal, options);
}

/**
 * Creates, submits, and executes a governed multi-step email automation plan through
 * the authoritative ActionRegistry, PolicyGateway, execution leases, and ReceiptRepository.
 *
 * Strictly enforces AGENTS.md, Step 67 & Step 68 durability rules:
 * - Never lets the AI model bypass PolicyGateway or directly run adapters.
 * - Enforces idempotency across repeated calls and rejects conflicting payloads on the same idempotencyKey (409 Conflict).
 * - Decouples plan execution from the HTTP streaming socket so client disconnects do not abort background execution.
 * - Uses `automation.email.stage_workflow_artifact` (`actionClass: 'write'`, `approvalMode: 'explicit'`) with verified compose & dry-run dependencies.
 * - Never runs API and worker paths simultaneously (`queueService` vs in-process execution + atomic DB lease).
 * - Keeps n8n workflow artifacts offline and inactive (`active: false`).
 * - Never claims an email was sent or an external workflow was activated.
 */
export async function executeChatEmailAutomationPlan(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  proposal: EmailAutomationChatProposal,
  policyOrOptions: PolicyGateway | ChatAutomationExecutionOptions = defaultPolicyGateway
): Promise<ChatAutomationExecutionOutcome> {
  if (
    proposal.workflowKind === 'calendar_briefing' ||
    proposal.planTitle === 'Governed Calendar Briefing Workflow Plan'
  ) {
    return executeChatCalendarBriefingPlan(db, scope, proposal, policyOrOptions);
  }
  if (
    proposal.workflowKind === 'whatsapp_briefing' ||
    proposal.planTitle === 'Governed WhatsApp Briefing Workflow Plan'
  ) {
    return executeChatWhatsAppBriefingPlan(db, scope, proposal, policyOrOptions);
  }
  if (
    proposal.workflowKind === 'phone_briefing' ||
    proposal.planTitle === 'Governed Phone Call Briefing Workflow Plan'
  ) {
    return executeChatPhoneBriefingPlan(db, scope, proposal, policyOrOptions);
  }
  const options: ChatAutomationExecutionOptions =
    'evaluate' in policyOrOptions
      ? { policyGateway: policyOrOptions }
      : policyOrOptions;
  return executeGovernedChatAutomationPlanInternal(db, scope, proposal, options);
}

async function executeGovernedChatAutomationPlanInternal(
  db: TransactionalDbClient,
  scope: AuthenticatedScope,
  proposal: EmailAutomationChatProposal,
  options: ChatAutomationExecutionOptions
): Promise<ChatAutomationExecutionOutcome> {
  const policyGateway = options.policyGateway ?? defaultPolicyGateway;
  const queueService = options.queueService;
  const adapters = options.adapters ?? defaultActionAdapters;
  const maxRetries = options.maxRetries ?? 3;
  const queueWaitTimeoutMs = options.queueWaitTimeoutMs ?? 250;

  const plannedSteps: Array<{
    actionName: string;
    parameters: Record<string, unknown>;
    dependsOnOrders: number[];
  }> = [
    {
      actionName: 'automation.email.compose_workflow',
      parameters: proposal.composeParams,
      dependsOnOrders: []
    },
    {
      actionName: 'automation.email.dry_run_test',
      parameters: proposal.dryRunParams,
      dependsOnOrders: [0]
    }
  ];

  const expectedWorkflowHash = computeEmailWorkflowHash(scope.workspaceId, proposal.composeParams);
  const resolvedStageParams: StageEmailWorkflowArtifactInput | null = proposal.requireApprovalGate
    ? {
        ...(proposal.stageParams ?? proposal.composeParams),
        expectedWorkflowHash:
          proposal.stageParams?.expectedWorkflowHash ?? expectedWorkflowHash
      }
    : null;

  if (proposal.requireApprovalGate && resolvedStageParams) {
    plannedSteps.push({
      actionName: 'automation.email.stage_workflow_artifact',
      parameters: resolvedStageParams,
      dependsOnOrders: [0, 1]
    });
  }

  // Compute canonical hash of the proposal for idempotency conflict detection
  const proposalHash = computeCanonicalParameterHash({
    planTitle: proposal.planTitle,
    requireApprovalGate: proposal.requireApprovalGate,
    composeParams: proposal.composeParams,
    dryRunParams: proposal.dryRunParams,
    stageParams: resolvedStageParams
  });

  // 1. Pre-flight authoritative ActionRegistry & PolicyGateway check for all steps
  for (const s of plannedSteps) {
    const actionDef = defaultActionRegistry.get(s.actionName);
    if (!actionDef) {
      throw new ValidationError(
        `Action '${s.actionName}' is not registered in the authoritative ActionRegistry.`
      );
    }
    if (!actionDef.validate(s.parameters)) {
      throw new ValidationError(`Parameters for '${s.actionName}' failed schema validation.`);
    }
    const preflightDecision = policyGateway.evaluate(
      scope,
      {
        actionName: s.actionName,
        parameters: s.parameters,
        idempotencyKey: `chat-plan-preflight:${scope.workspaceId}:${s.actionName}`
      },
      undefined
    );
    const allowedAtProposal =
      preflightDecision.allowed ||
      (actionDef.approvalMode === 'explicit' &&
        preflightDecision.status === 'REJECTED_APPROVAL_REQUIRED');
    if (!allowedAtProposal) {
      if (preflightDecision.status === 'REJECTED_UNAUTHORIZED') {
        throw new ForbiddenError(
          `PolicyGateway denied '${s.actionName}': ${preflightDecision.reason || 'Unauthorized'}`
        );
      }
      throw new ValidationError(
        `PolicyGateway denied '${s.actionName}': ${preflightDecision.reason || 'Denied'}`
      );
    }
  }

  const scopedIdempotencyKey = options.idempotencyKey
    ? `chat-auto-plan:${scope.userId}:${options.conversationId ?? 'direct'}:${options.idempotencyKey}`
    : null;

  // 2. Create and submit the governed plan in PostgreSQL (with atomic idempotency check)
  const created = await db.withScopedTransaction(scope, async (txClient) => {
    const idempotencyRepo = new IdempotencyRepository(txClient);
    const planRepo = new PlanRepository(txClient);
    const stepRepo = new PlanStepRepository(txClient);
    const depRepo = new PlanStepDependencyRepository(txClient);
    const approvalRepo = new ApprovalRepository(txClient);
    const bindingRepo = new PlanStepApprovalBindingRepository(txClient);
    const auditRepo = new AuditEventRepository(txClient);

    if (scopedIdempotencyKey) {
      const claimResult = await idempotencyRepo.claim(
        scope.workspaceId,
        scopedIdempotencyKey,
        scope.userId,
        '/api/v1/conversations/stream/automation'
      );

      if (!claimResult.claimed) {
        const storedBody = claimResult.record.response_body as {
          planId?: string;
          approvalId?: string | null;
          stepIds?: string[];
          proposalHash?: string;
        } | null;

        if (storedBody?.proposalHash && storedBody.proposalHash !== proposalHash) {
          throw new ConflictError(
            `Idempotency key '${options.idempotencyKey}' was already used with a conflicting automation payload.`
          );
        }

        if (storedBody?.planId) {
          return {
            planId: storedBody.planId,
            approvalId: storedBody.approvalId ?? null,
            stepIds: storedBody.stepIds ?? [],
            queuedRootSteps: [] as Array<{ stepId: string; stepIndex: number; actionName: string }>,
            alreadyExists: true
          };
        }
      }
    }

    const plan = await planRepo.create(
      scope.workspaceId,
      scope.userId,
      proposal.planTitle,
      proposal.workflowKind === 'calendar_briefing'
        ? 'Governed calendar briefing workflow initiated from executive chat'
        : proposal.workflowKind === 'whatsapp_briefing'
          ? 'Governed WhatsApp conversation briefing workflow initiated from executive chat'
          : proposal.workflowKind === 'phone_briefing'
            ? 'Governed Phone call history briefing workflow initiated from executive chat'
            : 'Governed email automation workflow initiated from executive chat',
      {
        source: 'chat_automation_orchestrator',
        workflowKind: proposal.workflowKind ?? 'email_automation',
        conversationId: options.conversationId ?? null,
        streamId: options.streamId ?? null,
        idempotencyKey: options.idempotencyKey ?? null,
        proposalHash
      }
    );

    const stepRecords = [];
    let createdApprovalId: string | null = null;

    for (let i = 0; i < plannedSteps.length; i++) {
      const spec = plannedSteps[i]!;
      const actionDef = defaultActionRegistry.get(spec.actionName)!;
      const paramHash = computeCanonicalParameterHash(spec.parameters);

      const step = await stepRepo.create(
        scope.workspaceId,
        plan.id,
        i,
        spec.actionName,
        actionDef.actionClass,
        actionDef.risk,
        actionDef.approvalMode,
        spec.parameters,
        paramHash
      );
      stepRecords.push(step);
    }

    for (let i = 0; i < plannedSteps.length; i++) {
      const spec = plannedSteps[i]!;
      const dependentStep = stepRecords[i]!;
      for (const parentOrder of spec.dependsOnOrders) {
        const parentStep = stepRecords[parentOrder]!;
        await depRepo.create(scope.workspaceId, plan.id, dependentStep.id, parentStep.id);
      }
    }

    let hasExplicitApproval = false;
    const queuedRootSteps: Array<{ stepId: string; stepIndex: number; actionName: string }> = [];

    for (let i = 0; i < stepRecords.length; i++) {
      const step = stepRecords[i]!;
      const spec = plannedSteps[i]!;
      if (step.action_class === 'write' && step.approval_mode !== 'none') {
        hasExplicitApproval = true;
        const approval = await approvalRepo.create(
          scope.workspaceId,
          step.action_name,
          step.parameters,
          scope.userId,
          step.risk_level
        );
        createdApprovalId = approval.id;
        await bindingRepo.create(
          scope.workspaceId,
          plan.id,
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
      } else if (spec.dependsOnOrders.length === 0) {
        await stepRepo.transitionStatus(
          scope.workspaceId,
          step.id,
          ['ready', 'blocked'],
          'queued'
        );
        queuedRootSteps.push({
          stepId: step.id,
          stepIndex: step.step_index,
          actionName: step.action_name
        });
      }
    }

    const submittedPlanStatus = hasExplicitApproval ? 'awaiting_approval' : 'queued';
    await planRepo.transitionStatus(scope.workspaceId, plan.id, 'draft', submittedPlanStatus);

    const stepIds = stepRecords.map((s) => s.id);
    if (scopedIdempotencyKey) {
      await idempotencyRepo.complete(scope.workspaceId, scopedIdempotencyKey, 200, {
        planId: plan.id,
        approvalId: createdApprovalId,
        stepIds,
        proposalHash
      });
    }

    await auditRepo.create(
      scope.workspaceId,
      'plan.submitted',
      'plan',
      {
        planId: plan.id,
        source: 'chat_automation_orchestrator',
        stepCount: stepRecords.length,
        status: submittedPlanStatus
      },
      scope.userId,
      plan.id
    );

    return {
      planId: plan.id,
      approvalId: createdApprovalId,
      stepIds,
      queuedRootSteps,
      alreadyExists: false
    };
  });

  // 3. If this was an idempotent duplicate call, wait for any active background execution (or reconcile after restart) and return current state
  if (created.alreadyExists) {
    const existingBg = activeBackgroundPlanExecutions.get(created.planId);
    if (existingBg) {
      await waitWithAbortSignal(existingBg, options.signal);
    } else {
      await reconcileGovernedPlanExecution(db, scope, created.planId, {
        policyGateway,
        adapters,
        queueService,
        maxRetries,
        workerId: options.workerId,
        leaseDurationMs: options.leaseDurationMs
      });
    }
    return buildChatAutomationOutcome(
      db,
      scope,
      created.planId,
      created.approvalId,
      proposal,
      true
    );
  }

  // 4. Dispatch root steps to durable queueService if configured, or launch detached background execution
  if (queueService) {
    for (const rootStep of created.queuedRootSteps) {
      await queueService.enqueue(scope.workspaceId, rootStep.stepId, 'plan.execute_step', {
        planId: created.planId,
        stepId: rootStep.stepId,
        stepIndex: rootStep.stepIndex,
        actionName: rootStep.actionName
      });
    }
    await waitForQueueOrSignal(
      db,
      scope,
      created.planId,
      queueWaitTimeoutMs,
      options.signal
    );
  } else {
    // Launch detached background execution so HTTP client disconnects never abort governed plan execution
    const bgPromise = scheduleBackgroundPlanExecution(db, scope, created.planId, {
      policyGateway,
      adapters,
      maxRetries,
      workerId: options.workerId,
      leaseDurationMs: options.leaseDurationMs
    });

    await waitWithAbortSignal(bgPromise, options.signal);
  }

  // 5. Read back persisted plan, steps, and receipts to build a truthful executive summary
  return buildChatAutomationOutcome(
    db,
    scope,
    created.planId,
    created.approvalId,
    proposal,
    false
  );
}
