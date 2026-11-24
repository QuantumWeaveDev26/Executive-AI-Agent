export interface UserData {
  id: string;
  email: string;
  displayName: string;
}

export interface WorkspaceData {
  id: string;
  name: string;
}

export interface AuthState {
  user: UserData;
  workspace: WorkspaceData;
  membership: {
    role: string;
    joinedAt: string;
  };
  csrfToken: string;
}

export interface ConnectorStatus {
  connectorName: string;
  status: string;
  connected: boolean;
  configured: boolean;
  message: string;
}

export interface AuditEventItem {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AuditListResponse {
  events: AuditEventItem[];
  total: number;
}

export type ConversationStatus = 'active' | 'archived' | 'closed' | 'purged';
export type ConversationChannel = 'web' | 'api';

export interface ConversationItem {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessageItem {
  id: string;
  workspace_id: string;
  conversation_id: string;
  user_id: string;
  sequence_number: number;
  sender_type: 'user' | 'assistant';
  sender_id?: string | null;
  assistant_stream_id?: string | null;
  content: string;
  token_count?: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type AssistantStreamState =
  | 'idle'
  | 'connecting'
  | 'queued'
  | 'streaming'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'not_configured';

export type PlanStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type PlanStepStatus =
  | 'blocked'
  | 'awaiting_approval'
  | 'ready'
  | 'queued'
  | 'running'
  | 'verified'
  | 'failed'
  | 'unverified'
  | 'cancelled';

export type ReceiptStatus = 'verified' | 'failed' | 'unverified' | 'not_configured';

export type DisplayPlanStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'verified'
  | 'failed'
  | 'unverified'
  | 'cancelled';

export interface PlanStepItem {
  id: string;
  plan_id: string;
  step_index: number;
  action_name: string;
  action_class: 'read' | 'write';
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  approval_mode: 'none' | 'implicit' | 'explicit';
  parameters: Record<string, unknown>;
  parameter_hash: string;
  status: PlanStepStatus;
  depends_on_step_ids: string[];
  approval_request_id?: string | null;
  error_details?: Record<string, unknown> | null;
}

export interface PlanReceiptItem {
  id: string;
  plan_id: string;
  plan_step_id: string;
  action_name: string;
  status: ReceiptStatus;
  proof: Record<string, unknown>;
  verification_method: string;
  created_at: string;
}

export interface PlanWithStepsItem {
  id: string;
  workspace_id: string;
  created_by_user_id: string;
  title: string;
  description?: string | null;
  status: PlanStatus;
  version: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  steps: PlanStepItem[];
  receipts: PlanReceiptItem[];
}

export interface ApprovalRequestItem {
  id: string;
  workspaceId: string;
  actionName: string;
  actionParams: Record<string, unknown>;
  requesterUserId: string;
  approverUserId?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export function deriveDisplayPlanStatus(plan: PlanWithStepsItem): DisplayPlanStatus {
  const hasUnverified =
    plan.steps.some((s) => s.status === 'unverified') ||
    plan.receipts.some((r) => r.status === 'unverified');
  if (hasUnverified && plan.status !== 'cancelled') {
    return 'unverified';
  }
  if (plan.status === 'completed') {
    return 'verified';
  }
  return plan.status;
}

export const GMAIL_SEND_ACTION_NAMES = ['gmail.messages.send_reply', 'gmail.messages.send_new'] as const;
export function isGmailSendActionName(name: unknown): boolean {
  return name === 'gmail.messages.send_reply' || name === 'gmail.messages.send_new';
}

export const CALENDAR_MUTATION_ACTION_NAMES = [
  'calendar.events.create',
  'calendar.events.reschedule',
  'calendar.events.cancel',
] as const;
export function isCalendarMutationActionName(name: unknown): boolean {
  return (
    name === 'calendar.events.create' ||
    name === 'calendar.events.reschedule' ||
    name === 'calendar.events.cancel'
  );
}

export function canUserDecideApproval(
  userRole: string,
  userId: string,
  approval: ApprovalRequestItem
): { canDecide: boolean; reason?: string } {
  if (approval.status !== 'pending') {
    return { canDecide: false, reason: `Approval is already ${approval.status}.` };
  }
  if (new Date(approval.expiresAt) < new Date()) {
    return { canDecide: false, reason: 'Approval request has expired.' };
  }
  if (isGmailSendActionName(approval.actionName)) {
    if (userRole === 'viewer') return { canDecide: false, reason: 'Viewers cannot send Gmail email.' };
    if (approval.requesterUserId !== userId) return { canDecide: false, reason: 'Only the person who prepared this email can send or cancel it.' };
    return { canDecide: true };
  }
  if (approval.actionName === 'whatsapp.meta.messages.send' || approval.actionName === 'whatsapp.meta.media.upload') {
    if (userRole === 'viewer' || approval.requesterUserId !== userId) return { canDecide: false, reason: 'Only the person who prepared this WhatsApp action can approve or cancel it.' };
    return { canDecide: true };
  }
  if (approval.actionName === 'campaign.bulk.execute') {
    if (userRole !== 'owner' && userRole !== 'admin') {
      return {
        canDecide: false,
        reason: 'Only workspace owners and admins can approve or reject bulk campaigns.'
      };
    }
    return { canDecide: true };
  }
  if (isCalendarMutationActionName(approval.actionName)) {
    if (userRole === 'viewer') return { canDecide: false, reason: 'Viewers cannot modify Google Calendar.' };
    if (approval.requesterUserId !== userId) return { canDecide: false, reason: 'Only the person who prepared this calendar change can approve or cancel it.' };
    return { canDecide: true };
  }
  if (userRole !== 'owner' && userRole !== 'admin') {
    return {
      canDecide: false,
      reason: 'Only workspace owners and admins can approve or reject requests.'
    };
  }
  if (
    (approval.riskLevel === 'high' || approval.riskLevel === 'critical') &&
    approval.requesterUserId === userId
  ) {
    return {
      canDecide: false,
      reason: `Two-person rule: requester cannot decide their own ${approval.riskLevel}-risk action.`
    };
  }
  return { canDecide: true };
}

export interface StreamAutomationMetadata {
  plan_id?: string;
  plan_status?: string;
  approval_id?: string | null;
  workflow_hash?: string | null;
  dry_run_hash?: string | null;
  staged_artifact_id?: string | null;
  step_statuses?: Array<{
    step_id: string;
    step_order: number;
    action_name: string;
    status: string;
    receipt_status: string | null;
  }>;
}

export interface StreamCallbacks {
  onContextReady?: (data: { stream_id: string; user_message_id: string; status: string }) => void;
  onStatus?: (data: { status: AssistantStreamState; error?: string; error_code?: string; message?: string }) => void;
  onToken?: (delta: string, metadata?: StreamAutomationMetadata) => void;
  onDone?: (data: { assistant_message_id: string; status: string } & StreamAutomationMetadata) => void;
  onError?: (errorMessage: string) => void;
}

export function getCsrfToken(): string {
  const match = document.cookie.match(/thaara_csrf=([^;]+)/);
  return match && match[1] ? decodeURIComponent(match[1]) : '';
}

export class ApiRequestError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); this.name = 'ApiRequestError'; }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');

  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes((options.method || 'GET').toUpperCase());
  if (isMutating) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers.set('x-csrf-token', csrfToken);
    }
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include'
  });

  const json = await res.json();
  if (!res.ok) {
    throw new ApiRequestError(
      res.status,
      json.error?.message || `HTTP ${res.status}`,
      typeof json.error?.code === 'string' ? json.error.code : undefined
    );
  }

  return json as T;
}

export async function listConversations(signal?: AbortSignal): Promise<ConversationItem[]> {
  return request<ConversationItem[]>('/api/v1/conversations', { signal });
}

export async function createConversation(title: string): Promise<ConversationItem> {
  return request<ConversationItem>('/api/v1/conversations', {
    method: 'POST',
    body: JSON.stringify({ title, channel: 'web' })
  });
}

export async function listConversationMessages(conversationId: string, signal?: AbortSignal): Promise<ConversationMessageItem[]> {
  return request<ConversationMessageItem[]>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { signal });
}

export interface StagedEmailWorkflowNodeItem {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
}

export interface StagedEmailWorkflowBlueprintItem {
  name: string;
  active: false;
  versionId: string;
  nodes: StagedEmailWorkflowNodeItem[];
  connections: Record<
    string,
    {
      main: Array<Array<{ node: string; type: 'main'; index: number }>>;
    }
  >;
  settings: {
    executionOrder: 'v1';
    saveManualExecutions: boolean;
  };
  meta: {
    generatedBy: 'thaara-v2-offline-workflow-builder';
    importReadiness: 'offline_schema_validated_not_live_verified';
    externallyVerifiedWithLiveN8n: false;
  };
}

export interface StagedEmailWorkflowArtifactItem {
  schemaVersion: 'thaara.staged_email_workflow_artifact.v1';
  artifactId: string;
  workspaceId: string;
  planId: string;
  stepId: string;
  workflowHash: string;
  parameterHash: string;
  verifiedComposeStepId: string;
  verifiedDryRunStepId: string;
  workflowDefinition: {
    schemaVersion: 'thaara.email_automation.v1';
    workflowId: string;
    workflowName: string;
    triggerType: string;
    recipientVariable: string;
    emailSubject: string;
    emailBodyTemplate: string;
    allowedVariables: string[];
    referencedVariables: string[];
    followUpConditions: Array<{
      field: string;
      operator: string;
      value?: string;
      delayMinutes: number;
    }>;
    n8nBlueprint: StagedEmailWorkflowBlueprintItem;
  };
  dryRunSummary: {
    dryRunPassed: true;
    conditionsSatisfied: boolean;
    renderedPreview: {
      recipient: string;
      subject: string;
      body: string;
      totalDelayMinutes: number;
    } | null;
  };
  stagingStatus: 'staged_offline_inactive';
  active: false;
  realEmailSent: false;
  externalDeploymentStatus: 'not_configured';
  externalAccountsContacted: false;
}

export async function getPlanWithSteps(planId: string, signal?: AbortSignal): Promise<PlanWithStepsItem> {
  return request<PlanWithStepsItem>(`/api/v1/plans/${encodeURIComponent(planId)}`, { signal });
}

export async function getPlanWorkflowArtifact(
  planId: string, signal?: AbortSignal
): Promise<StagedEmailWorkflowArtifactItem> {
  return request<StagedEmailWorkflowArtifactItem>(
    `/api/v1/plans/${encodeURIComponent(planId)}/workflow-artifact`, { method: 'GET', cache: 'no-store', signal }
  );
}

export async function cancelPlan(
  planId: string
): Promise<{ plan: Record<string, unknown>; steps_cancelled: number }> {
  return request<{ plan: Record<string, unknown>; steps_cancelled: number }>(
    `/api/v1/plans/${encodeURIComponent(planId)}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify({})
    }
  );
}

export async function listApprovals(signal?: AbortSignal): Promise<ApprovalRequestItem[]> {
  return request<ApprovalRequestItem[]>('/api/v1/approvals', { signal });
}

export async function decideApproval(
  approvalId: string,
  status: 'approved' | 'rejected'
): Promise<ApprovalRequestItem> {
  return request<ApprovalRequestItem>(`/api/v1/approvals/${encodeURIComponent(approvalId)}/decide`, {
    method: 'POST',
    body: JSON.stringify({ status })
  });
}

export async function cancelAssistantStream(
  conversationId: string,
  streamId: string,
  reason = 'Cancelled by user'
): Promise<{ success: boolean; stream_id: string; status: string; version: number; idempotent: boolean }> {
  return request(`/api/v1/conversations/${encodeURIComponent(conversationId)}/stream/${encodeURIComponent(streamId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

export interface UploadedAttachmentResponse {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  extractedTextLength: number;
  createdAt: string;
}

export async function uploadConversationAttachment(
  conversationId: string,
  file: File
): Promise<UploadedAttachmentResponse> {
  const base64Content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });

  return request<UploadedAttachmentResponse>(
    `/api/v1/conversations/${encodeURIComponent(conversationId)}/attachments`,
    {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        contentBase64: base64Content
      })
    }
  );
}

export async function streamConversationMessage(
  conversationId: string,
  content: string,
  idempotencyKey: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  attachmentIds?: string[],
  voiceMode?: boolean
): Promise<void> {
  const headers = new Headers({
    Accept: 'text/event-stream, application/json',
    'Content-Type': 'application/json'
  });

  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }

  const payload: Record<string, unknown> = {
    content,
    idempotency_key: idempotencyKey
  };
  if (attachmentIds && attachmentIds.length > 0) {
    payload.attachment_ids = attachmentIds;
  }
  if (voiceMode) {
    payload.voice_mode = true;
  }

  const res = await fetch(`/api/v1/conversations/${encodeURIComponent(conversationId)}/stream`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(payload),
    signal
  });

  if (!res.ok) {
    let errorMsg = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      errorMsg = errJson.error?.message || errorMsg;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(errorMsg);
  }

  if (!res.body) {
    throw new Error('Streaming response body is unavailable.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processBlock = (rawBlock: string) => {
    const lines = rawBlock.split(/\r?\n/);
    let eventType = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) return;
    const rawData = dataLines.join('\n');

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      return;
    }

    if (eventType === 'context_ready') {
      callbacks.onContextReady?.({
        stream_id: String(parsed.stream_id ?? ''),
        user_message_id: String(parsed.user_message_id ?? ''),
        status: String(parsed.status ?? 'queued')
      });
    } else if (eventType === 'stream_status') {
      const status = String(parsed.status ?? 'streaming') as AssistantStreamState;
      callbacks.onStatus?.({
        status,
        error: typeof parsed.error === 'string' ? parsed.error : undefined,
        error_code: typeof parsed.error_code === 'string' ? parsed.error_code : undefined,
        message: typeof parsed.message === 'string' ? parsed.message : undefined
      });
    } else if (eventType === 'token') {
      if (typeof parsed.delta === 'string') {
        callbacks.onToken?.(parsed.delta, {
          plan_id: typeof parsed.plan_id === 'string' ? parsed.plan_id : undefined,
          plan_status: typeof parsed.plan_status === 'string' ? parsed.plan_status : undefined,
          approval_id: typeof parsed.approval_id === 'string' ? parsed.approval_id : null,
          workflow_hash: typeof parsed.workflow_hash === 'string' ? parsed.workflow_hash : null,
          dry_run_hash: typeof parsed.dry_run_hash === 'string' ? parsed.dry_run_hash : null,
          staged_artifact_id:
            typeof parsed.staged_artifact_id === 'string' ? parsed.staged_artifact_id : null,
          step_statuses: Array.isArray(parsed.step_statuses) ? (parsed.step_statuses as any) : undefined
        });
      }
    } else if (eventType === 'done') {
      callbacks.onDone?.({
        assistant_message_id: String(parsed.assistant_message_id ?? ''),
        status: String(parsed.status ?? 'completed'),
        plan_id: typeof parsed.plan_id === 'string' ? parsed.plan_id : undefined,
        plan_status: typeof parsed.plan_status === 'string' ? parsed.plan_status : undefined,
        approval_id: typeof parsed.approval_id === 'string' ? parsed.approval_id : null,
        workflow_hash: typeof parsed.workflow_hash === 'string' ? parsed.workflow_hash : null,
        dry_run_hash: typeof parsed.dry_run_hash === 'string' ? parsed.dry_run_hash : null,
        staged_artifact_id:
          typeof parsed.staged_artifact_id === 'string' ? parsed.staged_artifact_id : null,
        step_statuses: Array.isArray(parsed.step_statuses) ? (parsed.step_statuses as any) : undefined
      });
    } else if (eventType === 'error') {
      const errCode = typeof parsed.error === 'string' ? parsed.error : 'STREAM_ERROR';
      callbacks.onError?.(errCode);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      if (block.trim().length > 0) {
        processBlock(block);
      }
    }
  }

  if (buffer.trim().length > 0) {
    processBlock(buffer);
  }
}

