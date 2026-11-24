import React, { useEffect, useRef, useState } from 'react';
import {
  ThaaraVoiceModeButton,
  ThaaraVoiceScreen,
  fetchChatVoiceConfigured,
} from './ChatVoiceControls';
import { ChatVoiceScope } from './chat-voice-controller';
import { confirmVoiceCancellation } from './chat-voice-command';
import {
  ApiRequestError,
  ApprovalRequestItem,
  AssistantStreamState,
  AuditEventItem,
  AuditListResponse,
  AuthState,
  ConnectorStatus,
  ConversationItem,
  ConversationMessageItem,
  DisplayPlanStatus,
  PlanReceiptItem,
  PlanStepStatus,
  PlanWithStepsItem,
  StagedEmailWorkflowArtifactItem,
  canUserDecideApproval,
  isCalendarMutationActionName,
  isGmailSendActionName,
  cancelAssistantStream,
  cancelPlan,
  createConversation,
  decideApproval,
  deriveDisplayPlanStatus,
  getPlanWithSteps,
  getPlanWorkflowArtifact,
  listApprovals,
  listConversationMessages,
  listConversations,
  request,
  streamConversationMessage,
  uploadConversationAttachment,
} from './api';
import { ChatAttachmentMenu } from './ChatAttachmentMenu';
import { ChatAttachmentPreview, ChatAttachmentItem } from './ChatAttachmentPreview';
import { AutomationSummary, listAutomations } from './automation-api';
import { AutomationDashboard } from './AutomationDashboard';
import { CalendarEvent, getCalendarAgenda, getCalendarStatus } from './calendar-api';
import { CalendarMutationChatCard } from './CalendarMutationCard';
import { CalendarScreen } from './CalendarScreen';
import { ChatRichText } from './ChatRichText';
import { GoogleDriveScreen } from './GoogleDriveScreen';
import { ConnectorDiagnostics } from './ConnectorDiagnostics';
import { ConnectorSummaryItem, DashboardPage } from './DashboardPage';
import { getGmailStatus } from './gmail-api';
import { GmailScreen } from './GmailScreen';
import { GmailSendChatCard } from './GmailSendCard';
import { N8nConnection } from './N8nConnection';
import {
  UI_VISIBILITY,
  WorkspacePageId,
  getPageMeta,
  isIntegrationPage,
  pushWorkspaceHistory,
  readInitialPage,
  resolvePageFromLocation,
} from './navigation';
import { fetchPhoneStatus, PhoneApiError } from './phone-api';
import { PhoneCallPage, PhoneContactsPage, PhoneHistoryPage } from './PhonePages';
import {PhoneInboundPage} from './PhoneInboundPage';
import { PhoneCallChatCard } from './PhoneCallChatCard';
import { BulkCampaignChatCard, BulkCampaignPanel } from './BulkCampaignPanel';
import {
  AppShell,
  EmptyState,
  PageHeader,
  Sidebar,
  ThaaraBrandMark,
  Topbar,
} from './ui-primitives';
import { getWhatsAppStatus } from './whatsapp-api';
import { WhatsAppScreen } from './WhatsAppScreen';
import {
  WorkflowInspector,
  copyWorkflowBlueprint,
  downloadWorkflowBlueprint,
} from './WorkflowInspector';
import { formatFriendlyDateTime } from './integration-ui';

export function createDefaultConnectorSummaries(): ConnectorSummaryItem[] {
  return [
    { id: 'gmail', label: 'Gmail', status: 'disconnected', mode: 'disabled' },
    { id: 'whatsapp', label: 'WhatsApp', status: 'disconnected', mode: 'disabled' },
    { id: 'phone', label: 'Phone', status: 'disconnected', mode: 'disabled' },
    { id: 'calendar', label: 'Calendar', status: 'disconnected', mode: 'disabled' },
  ];
}

export function getAuthIdentityKey(auth: AuthState | null | undefined): string {
  if (!auth) {
    return 'anonymous';
  }
  return `${auth.workspace.id}:${auth.user.id}:${auth.membership.role}`;
}

export function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof ApiRequestError) {
    return error.status === 401 || error.status === 403;
  }
  if (error instanceof PhoneApiError) {
    return error.statusCode === 401 || error.statusCode === 403;
  }
  return false;
}

export function formatTimestamp(value?: string | null): string {
  const formatted = formatFriendlyDateTime(value);
  return formatted === 'Unavailable' ? '—' : formatted;
}

export function getStreamBadgeClass(state: AssistantStreamState): string {
  if (state === 'completed') return 'badge badge-success';
  if (state === 'failed') return 'badge badge-danger';
  if (
    state === 'not_configured' ||
    state === 'cancelled' ||
    state === 'queued' ||
    state === 'streaming' ||
    state === 'connecting'
  ) {
    return 'badge badge-warning';
  }
  return 'badge';
}

export function getPlanStatusBadgeClass(
  status: DisplayPlanStatus | PlanStepStatus | string,
): string {
  if (status === 'verified' || status === 'completed' || status === 'approved') {
    return 'badge badge-success';
  }
  if (
    status === 'failed' ||
    status === 'unverified' ||
    status === 'rejected' ||
    status === 'expired'
  ) {
    return 'badge badge-danger';
  }
  if (
    status === 'awaiting_approval' ||
    status === 'queued' ||
    status === 'running' ||
    status === 'pending' ||
    status === 'cancelled' ||
    status === 'blocked' ||
    status === 'not_configured'
  ) {
    return 'badge badge-warning';
  }
  return 'badge';
}

export interface AppProps {
  initialAuth?: AuthState | null;
  initialLoading?: boolean;
  initialPage?: WorkspacePageId;
  initialSidebarCollapsed?: boolean;
  initialIntegrationsExpanded?: boolean;
  initialConversations?: ConversationItem[];
  initialMessages?: ConversationMessageItem[];
  initialSelectedConversationId?: string | null;
  initialAutomations?: AutomationSummary[];
  initialApprovals?: ApprovalRequestItem[];
  initialAuditEvents?: AuditEventItem[];
  initialUpcomingEvents?: CalendarEvent[];
  initialCalendarMode?: string;
}

export interface WorkspaceSessionState {
  auth: AuthState | null;
  loading: boolean;
  generation: number;
  identityKey: string;
  connectorStatus: ConnectorStatus | null;
  auditEvents: AuditEventItem[];
  automationsList: AutomationSummary[];
  upcomingEvents: CalendarEvent[];
  calendarMode: string;
  connectorSummaries: ConnectorSummaryItem[];
  conversations: ConversationItem[];
  selectedConversationId: string | null;
  newConversationTitle: string;
  historySearchQuery: string;
  messages: ConversationMessageItem[];
  loadingMessages: boolean;
  messageInput: string;
  chatError: string | null;
  streamState: AssistantStreamState;
  streamStatusMessage: string | null;
  activeStreamId: string | null;
  streamingContent: string;
  plansById: Record<string, PlanWithStepsItem>;
  approvalsById: Record<string, ApprovalRequestItem>;
  decidingApprovalIds: Record<string, boolean>;
  cancellingPlanIds: Record<string, boolean>;
  refreshingPlanIds: Record<string, boolean>;
  workflowArtifactsByPlanId: Record<string, StagedEmailWorkflowArtifactItem>;
  expandedWorkflowPlanIds: Record<string, boolean>;
  loadingWorkflowPlanIds: Record<string, boolean>;
  copiedWorkflowPlanIds: Record<string, boolean>;
}

export interface WorkspaceSessionApi {
  checkMe: (signal?: AbortSignal) => Promise<AuthState>;
  logout: () => Promise<void>;
  getConnectorStatus: (signal?: AbortSignal) => Promise<ConnectorStatus>;
  getAuditEvents: (signal?: AbortSignal) => Promise<AuditListResponse>;
  listConversations: (signal?: AbortSignal) => Promise<ConversationItem[]>;
  listAutomations: (
    status: '' | AutomationSummary['display_status'],
    offset: number,
    signal?: AbortSignal,
  ) => Promise<{ items: AutomationSummary[]; nextOffset: number | null }>;
  listApprovals: (signal?: AbortSignal) => Promise<ApprovalRequestItem[]>;
  getGmailStatus: (signal?: AbortSignal) => Promise<{ status: string; mode: string }>;
  getWhatsAppStatus: (signal?: AbortSignal) => Promise<{ status: string; mode: string }>;
  fetchPhoneStatus: (signal?: AbortSignal) => Promise<{ status: string; mode: string }>;
  getCalendarStatus: (
    signal?: AbortSignal,
  ) => Promise<{ status: string; mode: string; connected: boolean }>;
  getCalendarAgenda: (
    input: {
      windowStart: string;
      windowEnd: string;
      timeZone: string;
      includeCancelled?: boolean;
    },
    signal?: AbortSignal,
  ) => Promise<{ days: Array<{ events: CalendarEvent[] }> }>;
  listConversationMessages: (
    conversationId: string,
    signal?: AbortSignal,
  ) => Promise<ConversationMessageItem[]>;
  getPlanWithSteps: (planId: string, signal?: AbortSignal) => Promise<PlanWithStepsItem>;
}

const defaultWorkspaceSessionApi: WorkspaceSessionApi = {
  checkMe: (signal) => request<AuthState>('/api/v1/auth/me', { signal }),
  logout: () => request('/api/v1/auth/logout', { method: 'POST' }),
  getConnectorStatus: (signal) => request<ConnectorStatus>('/api/v1/connectors/status', { signal }),
  getAuditEvents: (signal) => request<AuditListResponse>('/api/v1/audit', { signal }),
  listConversations: (signal) => listConversations(signal),
  listAutomations: (status, offset, signal) => listAutomations(status, offset, signal),
  listApprovals: (signal) => listApprovals(signal),
  getGmailStatus: (signal) => getGmailStatus(signal, { allowLiveMode: true }),
  getWhatsAppStatus: (signal) => getWhatsAppStatus(signal),
  fetchPhoneStatus: (signal) => fetchPhoneStatus(signal),
  getCalendarStatus: (signal) => getCalendarStatus(signal, { allowLiveMode: true }),
  getCalendarAgenda: (input, signal) => getCalendarAgenda(input, signal, { allowLiveMode: true }),
  listConversationMessages: (conversationId, signal) =>
    listConversationMessages(conversationId, signal),
  getPlanWithSteps: (planId, signal) => getPlanWithSteps(planId, signal),
};

export function createInitialWorkspaceSessionState(
  props: AppProps = {},
): WorkspaceSessionState {
  const initialAuth = props.initialAuth ?? null;
  const workspaceId = initialAuth?.workspace.id ?? null;
  const initialApprovalsMap: Record<string, ApprovalRequestItem> = {};
  if (initialAuth) {
    for (const item of props.initialApprovals ?? []) {
      if (!item.workspaceId || item.workspaceId === workspaceId) {
        initialApprovalsMap[item.id] = item;
      }
    }
  }
  const initialConvs = initialAuth
    ? (props.initialConversations ?? []).filter(
        (c) => !c.workspace_id || c.workspace_id === workspaceId,
      )
    : [];
  const initialAudits = initialAuth
    ? (props.initialAuditEvents ?? []).filter(
        (evt) => !evt.workspaceId || evt.workspaceId === workspaceId,
      )
    : [];
  const initialMsgs = initialAuth
    ? (props.initialMessages ?? []).filter(
        (m) => !m.workspace_id || m.workspace_id === workspaceId,
      )
    : [];

  return {
    auth: initialAuth,
    loading: props.initialLoading !== undefined ? props.initialLoading : props.initialAuth === undefined,
    generation: 1,
    identityKey: getAuthIdentityKey(initialAuth),
    connectorStatus: null,
    auditEvents: initialAudits,
    automationsList: initialAuth ? (props.initialAutomations ?? []) : [],
    upcomingEvents: initialAuth ? (props.initialUpcomingEvents ?? []) : [],
    calendarMode: initialAuth ? (props.initialCalendarMode ?? 'disabled') : 'disabled',
    connectorSummaries: createDefaultConnectorSummaries(),
    conversations: initialConvs,
    selectedConversationId: initialAuth
      ? (props.initialSelectedConversationId ?? initialConvs[0]?.id ?? null)
      : null,
    newConversationTitle: '',
    historySearchQuery: '',
    messages: initialMsgs,
    loadingMessages: false,
    messageInput: '',
    chatError: null,
    streamState: 'idle',
    streamStatusMessage: null,
    activeStreamId: null,
    streamingContent: '',
    plansById: {},
    approvalsById: initialApprovalsMap,
    decidingApprovalIds: {},
    cancellingPlanIds: {},
    refreshingPlanIds: {},
    workflowArtifactsByPlanId: {},
    expandedWorkflowPlanIds: {},
    loadingWorkflowPlanIds: {},
    copiedWorkflowPlanIds: {},
  };
}

export function createWorkspaceSessionController(
  props: AppProps = {},
  publish?: (state: WorkspaceSessionState) => void,
  api: WorkspaceSessionApi = defaultWorkspaceSessionApi,
) {
  let state = createInitialWorkspaceSessionState(props);
  let disposed = false;
  let sessionAbort = new AbortController();

  function emit(patch: Partial<WorkspaceSessionState>): void {
    if (disposed) return;
    state = { ...state, ...patch };
    publish?.(state);
  }

  function resetAbort(): AbortController {
    sessionAbort.abort();
    sessionAbort = new AbortController();
    return sessionAbort;
  }

  function getClearSensitivePatch(): Partial<WorkspaceSessionState> {
    return {
      connectorStatus: null,
      auditEvents: [],
      automationsList: [],
      upcomingEvents: [],
      calendarMode: 'disabled',
      connectorSummaries: createDefaultConnectorSummaries(),
      conversations: [],
      selectedConversationId: null,
      newConversationTitle: '',
      historySearchQuery: '',
      messages: [],
      loadingMessages: false,
      messageInput: '',
      chatError: null,
      streamState: 'idle',
      streamStatusMessage: null,
      activeStreamId: null,
      streamingContent: '',
      plansById: {},
      approvalsById: {},
      decidingApprovalIds: {},
      cancellingPlanIds: {},
      refreshingPlanIds: {},
      workflowArtifactsByPlanId: {},
      expandedWorkflowPlanIds: {},
      loadingWorkflowPlanIds: {},
      copiedWorkflowPlanIds: {},
    };
  }

  function transitionAuth(nextAuth: AuthState | null): {
    generation: number;
    identityKey: string;
    signal: AbortSignal;
  } {
    const nextIdentityKey = getAuthIdentityKey(nextAuth);
    const identityChanged = state.identityKey !== nextIdentityKey;

    if (identityChanged || nextAuth === null) {
      const nextGeneration = state.generation + 1;
      const controller = resetAbort();
      emit({
        ...getClearSensitivePatch(),
        auth: nextAuth,
        generation: nextGeneration,
        identityKey: nextIdentityKey,
      });
      return {
        generation: nextGeneration,
        identityKey: nextIdentityKey,
        signal: controller.signal,
      };
    }

    if (sessionAbort.signal.aborted) {
      sessionAbort = new AbortController();
    }
    emit({ auth: nextAuth });
    return {
      generation: state.generation,
      identityKey: state.identityKey,
      signal: sessionAbort.signal,
    };
  }

  function isCurrent(generation: number, identityKey: string, signal?: AbortSignal): boolean {
    if (disposed || signal?.aborted) {
      return false;
    }
    return (
      identityKey !== 'anonymous' &&
      state.generation === generation &&
      state.identityKey === identityKey
    );
  }

  function handleUnauthorized(generation: number, identityKey: string): void {
    if (disposed || state.generation !== generation || state.identityKey !== identityKey) {
      return;
    }
    transitionAuth(null);
  }

  async function loadApprovalsMap(context?: {
    generation: number;
    identityKey: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const generation = context?.generation ?? state.generation;
    const identityKey = context?.identityKey ?? state.identityKey;
    const signal = context?.signal ?? sessionAbort.signal;

    if (!isCurrent(generation, identityKey, signal)) {
      return;
    }

    try {
      const list = await api.listApprovals(signal);
      if (!isCurrent(generation, identityKey, signal)) {
        return;
      }
      const nextMap: Record<string, ApprovalRequestItem> = {};
      for (const item of list) {
        if (!item.workspaceId || identityKey.startsWith(`${item.workspaceId}:`)) {
          nextMap[item.id] = item;
        }
      }
      emit({ approvalsById: nextMap });
    } catch (err) {
      if (!isCurrent(generation, identityKey, signal)) {
        return;
      }
      emit({ approvalsById: {} });
      if (isUnauthorizedError(err)) {
        handleUnauthorized(generation, identityKey);
      }
    }
  }

  async function loadConnectorAndCalendarOverview(context?: {
    generation: number;
    identityKey: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const generation = context?.generation ?? state.generation;
    const identityKey = context?.identityKey ?? state.identityKey;
    const signal = context?.signal ?? sessionAbort.signal;

    if (!isCurrent(generation, identityKey, signal)) {
      return;
    }

    const nextSummaries: ConnectorSummaryItem[] = [];

    try {
      const g = await api.getGmailStatus(signal);
      if (!isCurrent(generation, identityKey, signal)) return;
      nextSummaries.push({ id: 'gmail', label: 'Gmail', status: g.status, mode: g.mode });
    } catch (err) {
      if (!isCurrent(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorized(generation, identityKey);
        return;
      }
      nextSummaries.push({ id: 'gmail', label: 'Gmail', status: 'unavailable', mode: 'disabled' });
    }

    try {
      const w = await api.getWhatsAppStatus(signal);
      if (!isCurrent(generation, identityKey, signal)) return;
      nextSummaries.push({ id: 'whatsapp', label: 'WhatsApp', status: w.status, mode: w.mode });
    } catch (err) {
      if (!isCurrent(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorized(generation, identityKey);
        return;
      }
      nextSummaries.push({
        id: 'whatsapp',
        label: 'WhatsApp',
        status: 'unavailable',
        mode: 'disabled',
      });
    }

    try {
      const p = await api.fetchPhoneStatus(signal);
      if (!isCurrent(generation, identityKey, signal)) return;
      nextSummaries.push({ id: 'phone', label: 'Phone', status: p.status, mode: p.mode });
    } catch (err) {
      if (!isCurrent(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorized(generation, identityKey);
        return;
      }
      nextSummaries.push({ id: 'phone', label: 'Phone', status: 'unavailable', mode: 'disabled' });
    }

    try {
      const c = await api.getCalendarStatus(signal);
      if (!isCurrent(generation, identityKey, signal)) return;
      nextSummaries.push({ id: 'calendar', label: 'Calendar', status: c.status, mode: c.mode });
      emit({ calendarMode: c.mode });
      if (c.connected && c.status === 'connected') {
        const start = new Date();
        const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
        const agenda = await api.getCalendarAgenda(
          {
            windowStart: start.toISOString(),
            windowEnd: end.toISOString(),
            timeZone: 'UTC',
            includeCancelled: false,
          },
          signal,
        );
        if (!isCurrent(generation, identityKey, signal)) return;
        const flatEvents = agenda.days.flatMap((d) => d.events);
        emit({ upcomingEvents: flatEvents });
      } else {
        emit({ upcomingEvents: [] });
      }
    } catch (err) {
      if (!isCurrent(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorized(generation, identityKey);
        return;
      }
      emit({ calendarMode: 'disabled', upcomingEvents: [] });
      nextSummaries.push({
        id: 'calendar',
        label: 'Calendar',
        status: 'unavailable',
        mode: 'disabled',
      });
    }

    if (!isCurrent(generation, identityKey, signal)) {
      return;
    }
    emit({ connectorSummaries: nextSummaries });
  }

  async function loadWorkspaceData(context?: {
    generation: number;
    identityKey: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const generation = context?.generation ?? state.generation;
    const identityKey = context?.identityKey ?? state.identityKey;
    const signal = context?.signal ?? sessionAbort.signal;

    if (!isCurrent(generation, identityKey, signal)) {
      return;
    }

    try {
      const connector = await api.getConnectorStatus(signal);
      if (!isCurrent(generation, identityKey, signal)) return;
      emit({ connectorStatus: connector });
    } catch (err) {
      if (!isCurrent(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorized(generation, identityKey);
        return;
      }
      emit({ connectorStatus: null });
    }

    try {
      const audit = await api.getAuditEvents(signal);
      if (!isCurrent(generation, identityKey, signal)) return;
      emit({
        auditEvents: (audit.events || []).filter(
          (evt) => !evt.workspaceId || identityKey.startsWith(`${evt.workspaceId}:`),
        ),
      });
    } catch (err) {
      if (!isCurrent(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorized(generation, identityKey);
        return;
      }
      emit({ auditEvents: [] });
    }

    try {
      const convList = await api.listConversations(signal);
      if (!isCurrent(generation, identityKey, signal)) return;
      const scopedConvList = convList.filter(
        (c) => !c.workspace_id || identityKey.startsWith(`${c.workspace_id}:`),
      );
      const nextSelected =
        state.selectedConversationId &&
        scopedConvList.some((c) => c.id === state.selectedConversationId)
          ? state.selectedConversationId
          : (scopedConvList[0]?.id ?? null);
      emit({
        conversations: scopedConvList,
        selectedConversationId: nextSelected,
      });
    } catch (err) {
      if (!isCurrent(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorized(generation, identityKey);
        return;
      }
      emit({ conversations: [], selectedConversationId: null });
    }

    try {
      const autoRes = await api.listAutomations('', 0, signal);
      if (!isCurrent(generation, identityKey, signal)) return;
      emit({ automationsList: autoRes.items || [] });
    } catch (err) {
      if (!isCurrent(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorized(generation, identityKey);
        return;
      }
      emit({ automationsList: [] });
    }

    await loadApprovalsMap({ generation, identityKey, signal });
    if (!isCurrent(generation, identityKey, signal)) return;
    await loadConnectorAndCalendarOverview({ generation, identityKey, signal });
  }

  async function checkSession(): Promise<AuthState | null> {
    const checkController = resetAbort();
    let activeGeneration = state.generation;
    let activeSignal = checkController.signal;
    emit({ loading: true });
    try {
      const data = await api.checkMe(checkController.signal);
      if (disposed || checkController.signal.aborted || state.generation !== activeGeneration) {
        return null;
      }
      const ctx = transitionAuth(data);
      activeGeneration = ctx.generation;
      activeSignal = ctx.signal;
      emit({ loading: false });
      await loadWorkspaceData(ctx);
      return state.auth;
    } catch {
      if (disposed || checkController.signal.aborted || state.generation !== activeGeneration) {
        return null;
      }
      const ctx = transitionAuth(null);
      activeGeneration = ctx.generation;
      activeSignal = ctx.signal;
      return null;
    } finally {
      if (!disposed && !activeSignal.aborted && state.generation === activeGeneration) {
        emit({ loading: false });
      }
    }
  }

  async function logout(): Promise<void> {
    transitionAuth(null);
    try {
      await api.logout();
    } catch {
      // ignore network error; local session is already cleared and fenced
    }
  }

  async function loadMessages(conversationId: string): Promise<void> {
    const generation = state.generation;
    const identityKey = state.identityKey;
    const signal = sessionAbort.signal;
    if (!isCurrent(generation, identityKey, signal)) {
      return;
    }

    emit({ loadingMessages: true });
    try {
      const list = await api.listConversationMessages(conversationId, signal);
      if (!isCurrent(generation, identityKey, signal)) {
        return;
      }
      emit({
        messages: list.filter(
          (m) => !m.workspace_id || identityKey.startsWith(`${m.workspace_id}:`),
        ),
      });

      const planIds = Array.from(
        new Set(
          list
            .map((m) => (typeof m.metadata?.plan_id === 'string' ? m.metadata.plan_id : null))
            .filter((id): id is string => Boolean(id)),
        ),
      );

      if (planIds.length > 0) {
        await loadApprovalsMap({ generation, identityKey, signal });
        if (!isCurrent(generation, identityKey, signal)) {
          return;
        }
        const loadedPlans = await Promise.all(
          planIds.map(async (pid) => {
            try {
              return await api.getPlanWithSteps(pid, signal);
            } catch {
              return null;
            }
          }),
        );
        if (!isCurrent(generation, identityKey, signal)) {
          return;
        }
        const nextPlans = { ...state.plansById };
        for (const p of loadedPlans) {
          if (p && (!p.workspace_id || identityKey.startsWith(`${p.workspace_id}:`))) {
            nextPlans[p.id] = p;
          }
        }
        emit({ plansById: nextPlans });
      }
    } catch (err) {
      if (!isCurrent(generation, identityKey, signal)) {
        return;
      }
      if (isUnauthorizedError(err)) {
        handleUnauthorized(generation, identityKey);
        return;
      }
      emit({ messages: [], chatError: (err as Error).message });
    } finally {
      if (isCurrent(generation, identityKey, signal)) {
        emit({ loadingMessages: false });
      }
    }
  }

  return {
    getState: () => state,
    transitionAuth,
    checkSession,
    logout,
    loadWorkspaceData,
    loadApprovalsMap,
    loadConnectorAndCalendarOverview,
    loadMessages,
    dispose: () => {
      disposed = true;
      sessionAbort.abort();
    },
  };
}

class WorkspacePageErrorBoundary extends React.Component<
  { children: React.ReactNode; onRecover?: () => void },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode; onRecover?: () => void }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || 'Unexpected rendering error.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          data-testid="workspace-error-boundary"
          style={{
            maxWidth: '640px',
            margin: '2rem auto',
            padding: '1.25rem 1.5rem',
            borderRadius: '14px',
            border: '1px solid #fecaca',
            background: '#fef2f2',
            color: '#991b1b'
          }}
        >
          <h3 style={{ margin: '0 0 0.4rem', fontSize: '1rem' }}>Unable to render this view</h3>
          <p style={{ margin: '0 0 0.85rem', fontSize: '0.84rem' }}>{this.state.message}</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                this.props.onRecover?.();
              }}
            >
              Try Again
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App(props: AppProps = {}) {
  const [auth, setAuth] = useState<AuthState | null>(props.initialAuth ?? null);
  const [loading, setLoading] = useState<boolean>(
    props.initialLoading !== undefined ? props.initialLoading : props.initialAuth === undefined,
  );
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'bootstrap'>('login');

  // Navigation & Responsive Shell State
  const [activePage, setActivePage] = useState<WorkspacePageId>(
    () => props.initialPage ?? readInitialPage(),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    props.initialSidebarCollapsed ?? false,
  );
  const [integrationsExpanded, setIntegrationsExpanded] = useState<boolean>(
    props.initialIntegrationsExpanded ?? true,
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Login & Bootstrap Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [displayName, setDisplayName] = useState('');

  // Workspace Data State
  const [connectorStatus, setConnectorStatus] = useState<ConnectorStatus | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventItem[]>(
    props.initialAuditEvents ?? [],
  );
  const [automationsList, setAutomationsList] = useState<AutomationSummary[]>(
    props.initialAutomations ?? [],
  );
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>(
    props.initialUpcomingEvents ?? [],
  );
  const [calendarMode, setCalendarMode] = useState<string>(
    props.initialCalendarMode ?? 'disabled',
  );
  const [connectorSummaries, setConnectorSummaries] = useState<ConnectorSummaryItem[]>(() =>
    createDefaultConnectorSummaries(),
  );

  // Executive Chat & History State
  const [conversations, setConversations] = useState<ConversationItem[]>(
    props.initialConversations ?? [],
  );
  const [selectedConversationId, setSelectedConversationIdState] = useState<string | null>(
    props.initialSelectedConversationId ?? props.initialConversations?.[0]?.id ?? null,
  );
  const voiceScopeRef = useRef(new ChatVoiceScope(selectedConversationId));
  const [isVoiceScreenOpen, setIsVoiceScreenOpen] = useState(false);
  const [voiceConfigured, setVoiceConfigured] = useState(true);
  function setSelectedConversationId(next: React.SetStateAction<string | null>) {
    const id = typeof next === 'function' ? next(voiceScopeRef.current.conversationId) : next;
    if (id !== voiceScopeRef.current.conversationId) {
      setIsVoiceScreenOpen(false);
    }
    voiceScopeRef.current.select(id);
    setSelectedConversationIdState(id);
  }
  const [newConversationTitle, setNewConversationTitle] = useState('');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [messages, setMessages] = useState<ConversationMessageItem[]>(
    props.initialMessages ?? [],
  );
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<AssistantStreamState>('idle');
  const [streamStatusMessage, setStreamStatusMessage] = useState<string | null>(null);
  const [activeStreamId, setActiveStreamId] = useState<string | null>(null);
  const [streamingContent, setStreamingContent] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatSendBusyRef = useRef(false);
  const voiceCancellationUnverifiedRef = useRef(false);

  // Chat Attachments & Auto-Scroll UI State
  const [chatAttachments, setChatAttachments] = useState<ChatAttachmentItem[]>([]);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const chatStreamRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef<boolean>(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [hasNewTokensWhileScrolled, setHasNewTokensWhileScrolled] = useState(false);

  const scrollToBottom = (smooth = true) => {
    const el = chatStreamRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
    setShowJumpToLatest(false);
    setHasNewTokensWhileScrolled(false);
    isUserScrolledUp.current = false;
  };

  const handleStreamScroll = () => {
    const el = chatStreamRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
    if (isNearBottom) {
      isUserScrolledUp.current = false;
      setShowJumpToLatest(false);
      setHasNewTokensWhileScrolled(false);
    } else {
      isUserScrolledUp.current = true;
      setShowJumpToLatest(true);
    }
  };

  const handleFilesSelected = (files: File[]) => {
    if (!selectedConversationId) return;

    setChatAttachments((prev) => {
      const remainingSlots = Math.max(0, 5 - prev.length);
      const toAdd = files.slice(0, remainingSlots);
      if (files.length > remainingSlots) {
        setChatError(`Maximum 5 attachments allowed. Only first ${remainingSlots} were added.`);
      }

      const newItems: ChatAttachmentItem[] = toAdd.map((file) => {
        const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const isTooLarge = file.size > 10 * 1024 * 1024;
        const isImage = file.type.startsWith('image/');
        const previewUrl = isImage ? URL.createObjectURL(file) : undefined;

        return {
          localId,
          file,
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          previewUrl,
          status: isTooLarge ? 'error' : 'uploading',
          error: isTooLarge ? 'File exceeds 10MB limit' : undefined,
        };
      });

      for (const item of newItems) {
        if (item.status === 'uploading') {
          uploadConversationAttachment(selectedConversationId, item.file)
            .then((res) => {
              setChatAttachments((current) =>
                current.map((curr) =>
                  curr.localId === item.localId
                    ? { ...curr, status: 'ready', serverId: res.id }
                    : curr,
                ),
              );
            })
            .catch((err) => {
              setChatAttachments((current) =>
                current.map((curr) =>
                  curr.localId === item.localId
                    ? { ...curr, status: 'error', error: (err as Error).message || 'Upload failed' }
                    : curr,
                ),
              );
            });
        }
      }

      return [...prev, ...newItems];
    });
  };

  const handleRemoveAttachment = (localId: string) => {
    setChatAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((a) => a.localId !== localId);
    });
  };

  // Governed Automation Plan & Approval UI State
  const [plansById, setPlansById] = useState<Record<string, PlanWithStepsItem>>({});
  const [approvalsById, setApprovalsById] = useState<Record<string, ApprovalRequestItem>>(() => {
    const map: Record<string, ApprovalRequestItem> = {};
    for (const item of props.initialApprovals ?? []) {
      map[item.id] = item;
    }
    return map;
  });
  const [decidingApprovalIds, setDecidingApprovalIds] = useState<Record<string, boolean>>({});
  const [cancellingPlanIds, setCancellingPlanIds] = useState<Record<string, boolean>>({});
  const [refreshingPlanIds, setRefreshingPlanIds] = useState<Record<string, boolean>>({});
  const [workflowArtifactsByPlanId, setWorkflowArtifactsByPlanId] = useState<
    Record<string, StagedEmailWorkflowArtifactItem>
  >({});
  const [expandedWorkflowPlanIds, setExpandedWorkflowPlanIds] = useState<Record<string, boolean>>(
    {},
  );
  const [loadingWorkflowPlanIds, setLoadingWorkflowPlanIds] = useState<Record<string, boolean>>({});
  const [copiedWorkflowPlanIds, setCopiedWorkflowPlanIds] = useState<Record<string, boolean>>({});

  // Authentication Session Generation & Identity Fencing
  const initialIdentityKey = getAuthIdentityKey(props.initialAuth ?? null);
  const authGenerationRef = useRef<number>(1);
  const authIdentityKeyRef = useRef<string>(initialIdentityKey);
  const sessionAbortRef = useRef<AbortController | null>(null);
  const [committedIdentityKey, setCommittedIdentityKey] = useState<string>(initialIdentityKey);

  function abortActiveSessionRequests(): AbortController {
    voiceScopeRef.current.invalidate();
    if (sessionAbortRef.current) {
      sessionAbortRef.current.abort();
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const nextController = new AbortController();
    sessionAbortRef.current = nextController;
    return nextController;
  }

  function clearSensitiveWorkspaceState(): void {
    setConnectorStatus(null);
    setAuditEvents([]);
    setAutomationsList([]);
    setUpcomingEvents([]);
    setCalendarMode('disabled');
    setConnectorSummaries(createDefaultConnectorSummaries());
    setConversations([]);
    setSelectedConversationId(null);
    setNewConversationTitle('');
    setHistorySearchQuery('');
    setMessages([]);
    setLoadingMessages(false);
    setMessageInput('');
    setChatError(null);
    setStreamState('idle');
    setStreamStatusMessage(null);
    setActiveStreamId(null);
    setStreamingContent('');
    setPlansById({});
    setApprovalsById({});
    setDecidingApprovalIds({});
    setCancellingPlanIds({});
    setRefreshingPlanIds({});
    setWorkflowArtifactsByPlanId({});
    setExpandedWorkflowPlanIds({});
    setLoadingWorkflowPlanIds({});
    setCopiedWorkflowPlanIds({});
    setIsVoiceScreenOpen(false);
    voiceCancellationUnverifiedRef.current = false;
  }

  function transitionAuthContext(nextAuth: AuthState | null): {
    generation: number;
    identityKey: string;
    signal: AbortSignal;
  } {
    const nextIdentityKey = getAuthIdentityKey(nextAuth);
    const previousIdentityKey = authIdentityKeyRef.current;
    const identityChanged = previousIdentityKey !== nextIdentityKey;

    if (identityChanged || nextAuth === null) {
      authGenerationRef.current += 1;
      authIdentityKeyRef.current = nextIdentityKey;
      const controller = abortActiveSessionRequests();
      clearSensitiveWorkspaceState();
      setCommittedIdentityKey(nextIdentityKey);
      setAuth(nextAuth);
      return {
        generation: authGenerationRef.current,
        identityKey: nextIdentityKey,
        signal: controller.signal,
      };
    }

    setAuth(nextAuth);
    if (!sessionAbortRef.current || sessionAbortRef.current.signal.aborted) {
      sessionAbortRef.current = new AbortController();
    }
    return {
      generation: authGenerationRef.current,
      identityKey: nextIdentityKey,
      signal: sessionAbortRef.current.signal,
    };
  }

  function isCurrentAuthSession(
    generation: number,
    identityKey: string,
    signal?: AbortSignal,
  ): boolean {
    if (signal?.aborted) {
      return false;
    }
    return (
      identityKey !== 'anonymous' &&
      authGenerationRef.current === generation &&
      authIdentityKeyRef.current === identityKey
    );
  }

  function handleUnauthorizedSession(generation: number, identityKey: string): void {
    if (
      authGenerationRef.current !== generation ||
      authIdentityKeyRef.current !== identityKey
    ) {
      return;
    }
    transitionAuthContext(null);
  }

  // Synchronize prop-driven initialAuth changes (e.g. account/workspace switch in tests or parent shell)
  const propIdentityKey =
    props.initialAuth !== undefined ? getAuthIdentityKey(props.initialAuth) : null;
  if (propIdentityKey !== null && propIdentityKey !== committedIdentityKey) {
    authGenerationRef.current += 1;
    authIdentityKeyRef.current = propIdentityKey;
    abortActiveSessionRequests();
    clearSensitiveWorkspaceState();
    setCommittedIdentityKey(propIdentityKey);
    setAuth(props.initialAuth ?? null);
  }

  useEffect(() => {
    if (!sessionAbortRef.current) {
      sessionAbortRef.current = new AbortController();
    }
    return () => {
      authGenerationRef.current += 1;
      if (sessionAbortRef.current) {
        sessionAbortRef.current.abort();
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  function selectWorkspacePage(page: WorkspacePageId, replace = false) {
    setActivePage(page);
    if (isIntegrationPage(page)) {
      setIntegrationsExpanded(true);
    }
    pushWorkspaceHistory(page, replace);
  }

  // Browser back/forward navigation support
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      const next = resolvePageFromLocation(window.location.pathname, window.location.hash);
      setActivePage(next);
      if (isIntegrationPage(next)) {
        setIntegrationsExpanded(true);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (props.initialAuth === undefined) {
      void checkSession();
    }
  }, []);

  useEffect(() => {
    if (auth && selectedConversationId && props.initialMessages === undefined) {
      void loadMessages(selectedConversationId);
    } else if (!selectedConversationId) {
      setMessages([]);
    }
  }, [auth, selectedConversationId]);

  useEffect(() => {
    if (!auth) return;
    const ctrl = new AbortController();
    void fetchChatVoiceConfigured(ctrl.signal).then((configured) => {
      if (!ctrl.signal.aborted) {
        setVoiceConfigured(configured);
      }
    });
    return () => ctrl.abort();
  }, [auth]);

  // Poll active ('queued' or 'running') plans displayed in chat until they reach a settled state
  useEffect(() => {
    const activePlanIds = Object.values(plansById)
      .filter((p) => p.status === 'queued' || p.status === 'running')
      .map((p) => p.id);

    if (activePlanIds.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      for (const planId of activePlanIds) {
        void refreshPlanState(planId, false);
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [plansById, selectedConversationId]);

  async function checkSession() {
    const checkController = abortActiveSessionRequests();
    let activeGeneration = authGenerationRef.current;
    let activeSignal = checkController.signal;
    setLoading(true);
    try {
      const data = await request<AuthState>('/api/v1/auth/me', {
        signal: checkController.signal,
      });
      if (checkController.signal.aborted || authGenerationRef.current !== activeGeneration) {
        return;
      }
      const ctx = transitionAuthContext(data);
      activeGeneration = ctx.generation;
      activeSignal = ctx.signal;
      setLoading(false);
      const currentResolved = readInitialPage();
      if (currentResolved === 'not-found' && window.location.pathname === '/') {
        selectWorkspacePage('dashboard', true);
      }
      await loadWorkspaceData(ctx);
    } catch {
      if (checkController.signal.aborted || authGenerationRef.current !== activeGeneration) {
        return;
      }
      const ctx = transitionAuthContext(null);
      activeGeneration = ctx.generation;
      activeSignal = ctx.signal;
    } finally {
      if (!activeSignal.aborted && authGenerationRef.current === activeGeneration) {
        setLoading(false);
      }
    }
  }

  async function loadWorkspaceData(context?: {
    generation: number;
    identityKey: string;
    signal: AbortSignal;
  }) {
    const generation = context?.generation ?? authGenerationRef.current;
    const identityKey = context?.identityKey ?? authIdentityKeyRef.current;
    const signal = context?.signal ?? sessionAbortRef.current?.signal;

    if (!isCurrentAuthSession(generation, identityKey, signal)) {
      return;
    }

    try {
      const connector = await request<ConnectorStatus>('/api/v1/connectors/status', { signal });
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      setConnectorStatus(connector);
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      setConnectorStatus(null);
    }

    try {
      const audit = await request<AuditListResponse>('/api/v1/audit', { signal });
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      setAuditEvents(
        (audit.events || []).filter(
          (evt) => !evt.workspaceId || identityKey.startsWith(`${evt.workspaceId}:`),
        ),
      );
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      setAuditEvents([]);
    }

    try {
      const convList = await listConversations(signal);
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      const scopedConvList = convList.filter(
        (c) => !c.workspace_id || identityKey.startsWith(`${c.workspace_id}:`),
      );
      setConversations(scopedConvList);
      setSelectedConversationId((prev) => {
        if (prev && scopedConvList.some((c) => c.id === prev)) {
          return prev;
        }
        return scopedConvList[0]?.id ?? null;
      });
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      // Preserve currently loaded workspace conversations on transient 429/5xx refresh failures.
    }

    try {
      const autoRes = await listAutomations('', 0, signal);
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      setAutomationsList(autoRes.items || []);
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      setAutomationsList([]);
    }

    await loadApprovalsMap({ generation, identityKey, signal });
    if (!isCurrentAuthSession(generation, identityKey, signal)) return;
    await loadConnectorAndCalendarOverview({ generation, identityKey, signal });
  }

  async function loadConnectorAndCalendarOverview(context?: {
    generation: number;
    identityKey: string;
    signal?: AbortSignal;
  }) {
    const generation = context?.generation ?? authGenerationRef.current;
    const identityKey = context?.identityKey ?? authIdentityKeyRef.current;
    const signal = context?.signal ?? sessionAbortRef.current?.signal;

    if (!isCurrentAuthSession(generation, identityKey, signal)) {
      return;
    }

    const nextSummaries: ConnectorSummaryItem[] = [];

    try {
      const g = await getGmailStatus(signal, { allowLiveMode: true });
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      nextSummaries.push({ id: 'gmail', label: 'Gmail', status: g.status, mode: g.mode });
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      nextSummaries.push({ id: 'gmail', label: 'Gmail', status: 'unavailable', mode: 'disabled' });
    }

    try {
      const w = await getWhatsAppStatus(signal);
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      nextSummaries.push({ id: 'whatsapp', label: 'WhatsApp', status: w.status, mode: w.mode });
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      nextSummaries.push({
        id: 'whatsapp',
        label: 'WhatsApp',
        status: 'unavailable',
        mode: 'disabled',
      });
    }

    try {
      const p = await fetchPhoneStatus(signal);
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      nextSummaries.push({ id: 'phone', label: 'Phone', status: p.status, mode: p.mode });
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      nextSummaries.push({ id: 'phone', label: 'Phone', status: 'unavailable', mode: 'disabled' });
    }

    try {
      const c = await getCalendarStatus(signal, { allowLiveMode: true });
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      nextSummaries.push({ id: 'calendar', label: 'Calendar', status: c.status, mode: c.mode });
      setCalendarMode(c.mode);
      if (c.connected && c.status === 'connected') {
        const start = new Date();
        const end = new Date(start.getTime() + 7 * 24 * 3600 * 1000);
        const agenda = await getCalendarAgenda(
          {
            windowStart: start.toISOString(),
            windowEnd: end.toISOString(),
            timeZone: 'UTC',
            includeCancelled: false,
          },
          signal,
          { allowLiveMode: true },
        );
        if (!isCurrentAuthSession(generation, identityKey, signal)) return;
        const flatEvents = agenda.days.flatMap((d) => d.events);
        setUpcomingEvents(flatEvents);
      } else {
        setUpcomingEvents([]);
      }
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) return;
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      setCalendarMode('disabled');
      setUpcomingEvents([]);
      nextSummaries.push({
        id: 'calendar',
        label: 'Calendar',
        status: 'unavailable',
        mode: 'disabled',
      });
    }

    if (!isCurrentAuthSession(generation, identityKey, signal)) {
      return;
    }
    setConnectorSummaries(nextSummaries);
  }

  async function loadApprovalsMap(context?: {
    generation: number;
    identityKey: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const generation = context?.generation ?? authGenerationRef.current;
    const identityKey = context?.identityKey ?? authIdentityKeyRef.current;
    const signal = context?.signal ?? sessionAbortRef.current?.signal;

    if (!isCurrentAuthSession(generation, identityKey, signal)) {
      return;
    }

    try {
      const list = await listApprovals(signal);
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      const nextMap: Record<string, ApprovalRequestItem> = {};
      for (const item of list) {
        if (!item.workspaceId || identityKey.startsWith(`${item.workspaceId}:`)) {
          nextMap[item.id] = item;
        }
      }
      setApprovalsById(nextMap);
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      // Fail-closed: clear approvals on any refresh error or unauthorized response
      setApprovalsById({});
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
      }
    }
  }

  async function refreshPlanState(planId: string, showSpinner = true): Promise<void> {
    const generation = authGenerationRef.current;
    const identityKey = authIdentityKeyRef.current;
    const signal = sessionAbortRef.current?.signal;

    if (!isCurrentAuthSession(generation, identityKey, signal)) {
      return;
    }

    if (showSpinner) {
      setRefreshingPlanIds((prev) => ({ ...prev, [planId]: true }));
    }
    try {
      const [plan] = await Promise.all([
        getPlanWithSteps(planId, signal),
        loadApprovalsMap({ generation, identityKey, signal }),
      ]);
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      if (!plan.workspace_id || identityKey.startsWith(`${plan.workspace_id}:`)) {
        setPlansById((prev) => ({ ...prev, [plan.id]: plan }));
      }
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      if (showSpinner) {
        setChatError((err as Error).message);
      }
    } finally {
      if (showSpinner && isCurrentAuthSession(generation, identityKey, signal)) {
        setRefreshingPlanIds((prev) => ({ ...prev, [planId]: false }));
      }
    }
  }

  async function handleDecideApproval(
    planId: string | null,
    approvalId: string,
    decision: 'approved' | 'rejected',
  ): Promise<void> {
    if (decidingApprovalIds[approvalId]) {
      return;
    }
    const generation = authGenerationRef.current;
    const identityKey = authIdentityKeyRef.current;
    const signal = sessionAbortRef.current?.signal;
    if (!isCurrentAuthSession(generation, identityKey, signal)) {
      return;
    }

    setChatError(null);
    setDecidingApprovalIds((prev) => ({ ...prev, [approvalId]: true }));
    try {
      const updatedApproval = await decideApproval(approvalId, decision);
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      if (
        !updatedApproval.workspaceId ||
        identityKey.startsWith(`${updatedApproval.workspaceId}:`)
      ) {
        setApprovalsById((prev) => ({ ...prev, [updatedApproval.id]: updatedApproval }));
      }
      if (planId) {
        await refreshPlanState(planId, false);
      }
      if (selectedConversationId) {
        await loadMessages(selectedConversationId);
      }
      await loadWorkspaceData({
        generation,
        identityKey,
        signal: signal ?? new AbortController().signal,
      });
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      setChatError((err as Error).message);
      if (planId) {
        await refreshPlanState(planId, false);
      }
    } finally {
      if (isCurrentAuthSession(generation, identityKey, signal)) {
        setDecidingApprovalIds((prev) => ({ ...prev, [approvalId]: false }));
      }
    }
  }

  async function handleCancelGovernedPlan(planId: string): Promise<void> {
    if (cancellingPlanIds[planId]) {
      return;
    }
    const generation = authGenerationRef.current;
    const identityKey = authIdentityKeyRef.current;
    const signal = sessionAbortRef.current?.signal;
    if (!isCurrentAuthSession(generation, identityKey, signal)) {
      return;
    }

    setChatError(null);
    setCancellingPlanIds((prev) => ({ ...prev, [planId]: true }));
    try {
      await cancelPlan(planId);
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      await refreshPlanState(planId, false);
      if (selectedConversationId) {
        await loadMessages(selectedConversationId);
      }
      await loadWorkspaceData({
        generation,
        identityKey,
        signal: signal ?? new AbortController().signal,
      });
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      setChatError((err as Error).message);
    } finally {
      if (isCurrentAuthSession(generation, identityKey, signal)) {
        setCancellingPlanIds((prev) => ({ ...prev, [planId]: false }));
      }
    }
  }

  async function handleToggleViewWorkflow(planId: string): Promise<void> {
    const isCurrentlyOpen = Boolean(expandedWorkflowPlanIds[planId]);
    if (isCurrentlyOpen) {
      setExpandedWorkflowPlanIds((prev) => ({ ...prev, [planId]: false }));
      return;
    }

    const generation = authGenerationRef.current;
    const identityKey = authIdentityKeyRef.current;
    const signal = sessionAbortRef.current?.signal;
    if (!isCurrentAuthSession(generation, identityKey, signal)) {
      return;
    }

    setChatError(null);
    setExpandedWorkflowPlanIds((prev) => ({ ...prev, [planId]: true }));
    setLoadingWorkflowPlanIds((prev) => ({ ...prev, [planId]: true }));
    try {
      const artifact = await getPlanWorkflowArtifact(planId, signal);
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      if (!artifact.workspaceId || identityKey.startsWith(`${artifact.workspaceId}:`)) {
        setWorkflowArtifactsByPlanId((prev) => ({ ...prev, [planId]: artifact }));
      }
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      setChatError((err as Error).message);
      setExpandedWorkflowPlanIds((prev) => ({ ...prev, [planId]: false }));
    } finally {
      if (isCurrentAuthSession(generation, identityKey, signal)) {
        setLoadingWorkflowPlanIds((prev) => ({ ...prev, [planId]: false }));
      }
    }
  }

  async function handleCopyWorkflowJson(
    planId: string,
    artifact: StagedEmailWorkflowArtifactItem,
  ): Promise<void> {
    try {
      await copyWorkflowBlueprint(artifact);
      setCopiedWorkflowPlanIds((prev) => ({ ...prev, [planId]: true }));
      setTimeout(() => {
        setCopiedWorkflowPlanIds((prev) => ({ ...prev, [planId]: false }));
      }, 2000);
    } catch (err) {
      setChatError((err as Error).message);
    }
  }

  function handleDownloadWorkflowJson(artifact: StagedEmailWorkflowArtifactItem): void {
    try {
      downloadWorkflowBlueprint(artifact);
    } catch (err) {
      setChatError((err as Error).message);
    }
  }

  async function loadMessages(conversationId: string) {
    const generation = authGenerationRef.current;
    const identityKey = authIdentityKeyRef.current;
    const signal = sessionAbortRef.current?.signal;
    if (!isCurrentAuthSession(generation, identityKey, signal)) {
      return;
    }

    setLoadingMessages(true);
    try {
      const list = await listConversationMessages(conversationId, signal);
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      setMessages(
        list.filter((m) => !m.workspace_id || identityKey.startsWith(`${m.workspace_id}:`)),
      );

      const planIds = Array.from(
        new Set(
          list
            .map((m) => (typeof m.metadata?.plan_id === 'string' ? m.metadata.plan_id : null))
            .filter((id): id is string => Boolean(id)),
        ),
      );

      if (planIds.length > 0) {
        await loadApprovalsMap({ generation, identityKey, signal });
        if (!isCurrentAuthSession(generation, identityKey, signal)) {
          return;
        }
        const loadedPlans = await Promise.all(
          planIds.map(async (pid) => {
            try {
              return await getPlanWithSteps(pid, signal);
            } catch {
              return null;
            }
          }),
        );
        if (!isCurrentAuthSession(generation, identityKey, signal)) {
          return;
        }
        setPlansById((prev) => {
          const next = { ...prev };
          for (const p of loadedPlans) {
            if (p && (!p.workspace_id || identityKey.startsWith(`${p.workspace_id}:`))) {
              next[p.id] = p;
            }
          }
          return next;
        });
      }
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      setMessages((prev) =>
        prev.length > 0 && prev.every((m) => m.conversation_id === conversationId) ? prev : [],
      );
      setChatError((err as Error).message);
    } finally {
      if (isCurrentAuthSession(generation, identityKey, signal)) {
        setLoadingMessages(false);
      }
    }
  }

  async function syncVoiceTurnMessages(conversationId: string): Promise<void> {
    const generation = authGenerationRef.current;
    const identityKey = authIdentityKeyRef.current;
    const signal = sessionAbortRef.current?.signal;
    if (!isCurrentAuthSession(generation, identityKey, signal)) {
      return;
    }

    try {
      const list = await listConversationMessages(conversationId, signal);
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      const scopedList = list.filter(
        (m) => !m.workspace_id || identityKey.startsWith(`${m.workspace_id}:`),
      );
      setMessages(scopedList);

      const latestAssistant = [...scopedList]
        .reverse()
        .find((m) => m.sender_type === 'assistant');
      const latestPlanId =
        typeof latestAssistant?.metadata?.plan_id === 'string'
          ? latestAssistant.metadata.plan_id
          : null;
      const latestApprovalId =
        typeof latestAssistant?.metadata?.approval_id === 'string'
          ? latestAssistant.metadata.approval_id
          : null;

      if (latestPlanId || latestApprovalId) {
        await loadApprovalsMap({ generation, identityKey, signal });
        if (latestPlanId && isCurrentAuthSession(generation, identityKey, signal)) {
          try {
            const plan = await getPlanWithSteps(latestPlanId, signal);
            if (
              isCurrentAuthSession(generation, identityKey, signal) &&
              (!plan.workspace_id || identityKey.startsWith(`${plan.workspace_id}:`))
            ) {
              setPlansById((prev) => ({ ...prev, [plan.id]: plan }));
            }
          } catch {
            // Keep voice loop uninterrupted if optional plan metadata refresh fails
          }
        }
      }
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
      }
    }
  }

  async function handleCreateConversation(e: React.FormEvent) {
    e.preventDefault();
    const title = newConversationTitle.trim();
    if (!title) return;

    const generation = authGenerationRef.current;
    const identityKey = authIdentityKeyRef.current;
    const signal = sessionAbortRef.current?.signal;
    if (!isCurrentAuthSession(generation, identityKey, signal)) {
      return;
    }

    setChatError(null);
    try {
      const created = await createConversation(title);
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      setNewConversationTitle('');
      setConversations((prev) => [created, ...prev]);
      setSelectedConversationId(created.id);
      setStreamState('idle');
      setStreamStatusMessage(null);
      setStreamingContent('');
      selectWorkspacePage('new-conversation');
      await loadWorkspaceData({
        generation,
        identityKey,
        signal: signal ?? new AbortController().signal,
      });
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey, signal)) {
        return;
      }
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      setChatError((err as Error).message);
    }
  }

  async function handleOpenVoiceMode() {
    if (!auth) return;
    if (!chatSendBusyRef.current) {
      voiceCancellationUnverifiedRef.current = false;
      setChatError(null);
    }
    const selectedConv = selectedConversationId
      ? conversations.find((c) => c.id === selectedConversationId)
      : undefined;
    if (selectedConversationId && (!selectedConv || selectedConv.status === 'active')) {
      setIsVoiceScreenOpen(true);
      return;
    }
    const existing = conversations.find(
      (c) =>
        c.status === 'active' &&
        (!c.workspace_id || c.workspace_id === auth.workspace.id),
    );
    if (existing) {
      setSelectedConversationId(existing.id);
      setIsVoiceScreenOpen(true);
      return;
    }
    const generation = authGenerationRef.current;
    const identityKey = authIdentityKeyRef.current;
    try {
      const created = await createConversation('Voice Conversation');
      if (!isCurrentAuthSession(generation, identityKey)) return;
      setConversations((prev) => [created, ...prev]);
      setSelectedConversationId(created.id);
      setIsVoiceScreenOpen(true);
    } catch (err) {
      if (isUnauthorizedError(err)) {
        handleUnauthorizedSession(generation, identityKey);
        return;
      }
      setChatError((err as Error).message);
    }
  }

  async function handleSendMessage(
    e?: React.FormEvent,
    voice?: { text: string; signal: AbortSignal; conversationId?: string },
  ): Promise<string | undefined> {
    e?.preventDefault();
    if (voice?.signal.aborted) return;
    if (voice && voiceCancellationUnverifiedRef.current)
      throw Error('A previous voice request is unverified. Review Chat before starting another voice session.');
    if (!voice) voiceScopeRef.current.invalidate();
    if (chatSendBusyRef.current) {
      if (voice) throw Error('Another Chat request is still finishing.');
      setChatError('The previous request is stopping. Please send your message again.');
      return;
    }
    const content = (voice?.text ?? messageInput).trim();
    if (voice && chatAttachments.length)
      throw Error('Send or remove attachments before using continuous voice.');
    if (!content && chatAttachments.length === 0) return;

    if (chatAttachments.some((a) => a.status === 'uploading')) {
      setChatError('Please wait for all attachments to finish uploading.');
      return;
    }

    const generation = authGenerationRef.current;
    const identityKey = authIdentityKeyRef.current;
    if (!isCurrentAuthSession(generation, identityKey)) {
      return;
    }

    let targetConversationId = voice?.conversationId ?? selectedConversationId;
    if (!targetConversationId) {
      try {
        const created = await createConversation(content.slice(0, 60) || 'New Conversation');
        if (!isCurrentAuthSession(generation, identityKey)) return;
        setConversations((prev) => [created, ...prev]);
        setSelectedConversationId(created.id);
        targetConversationId = created.id;
      } catch (err) {
        setChatError((err as Error).message);
        return;
      }
    }

    const readyAttachmentIds = chatAttachments
      .filter((a) => a.status === 'ready' && a.serverId)
      .map((a) => a.serverId!);

    setChatError(null);
    if (!voice) {
      setMessageInput('');
    }
    setStreamingContent('');
    setActiveStreamId(null);
    setStreamState('connecting');
    setStreamStatusMessage('Initiating governed executive stream...');
    if (!voice) {
      setChatAttachments([]);
    }

    setTimeout(() => scrollToBottom(true), 50);

    const idempotencyKey =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const controller = new AbortController();
    chatSendBusyRef.current = true;
    abortControllerRef.current = controller;
    let voiceStreamId: string | undefined, replyId: string | undefined;
    let streamTerminal = false;
    let voiceRunError: Error | undefined;
    let earlyAbortTimer: ReturnType<typeof setTimeout> | undefined;
    // Capture the server run identity before aborting; an unknown run must never be followed by another automatic command.
    const abortVoice = () => {
      if (voiceStreamId) controller.abort();
      else earlyAbortTimer = setTimeout(() => controller.abort(), 10000);
    };
    voice?.signal.addEventListener('abort', abortVoice, { once: true });
    if (voice?.signal.aborted) controller.abort();

    try {
      await streamConversationMessage(
        targetConversationId,
        content || '(Attached documents provided for review)',
        idempotencyKey,
        {
          onContextReady: (data) => {
            voiceStreamId = data.stream_id;
            if (voice?.signal.aborted) {
              controller.abort();
              return;
            }
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setActiveStreamId(data.stream_id);
            setStreamState('queued');
            setStreamStatusMessage(
              `Context ready (Stream ID: ${data.stream_id.slice(0, 8)}...) — status: ${data.status}`,
            );
            if (!voice) {
              void loadMessages(targetConversationId!);
            }
            scrollToBottom(false);
          },
          onStatus: (data) => {
            if (data.status === 'not_configured' || data.status === 'failed' || data.status === 'cancelled' || data.status === 'completed') {
              streamTerminal = true;
            }
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamState(data.status);
            if (data.status === 'not_configured') {
              const code = data.error_code || data.error || 'MODEL_GATEWAY_NOT_CONFIGURED';
              const detail = data.message || 'Executive model provider is not configured.';
              setStreamStatusMessage(`${detail} (${code})`);
            } else if (data.status === 'streaming') {
              setStreamStatusMessage('Streaming response from model gateway...');
            } else if (data.status === 'failed') {
              const code = data.error_code || data.error || 'STREAM_FAILED';
              setStreamStatusMessage(data.message || `Stream failed (${code})`);
            }
          },
          onToken: (delta) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamingContent((prev) => prev + delta);
            if (!isUserScrolledUp.current) {
              scrollToBottom(false);
            } else {
              setHasNewTokensWhileScrolled(true);
            }
          },
          onDone: (data) => {
            streamTerminal = true;
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            replyId = data.assistant_message_id;
            setStreamState('completed');
            setStreamStatusMessage('Assistant stream completed.');
            setStreamingContent('');
            if (!isUserScrolledUp.current) {
              scrollToBottom(true);
            }
          },
          onError: (errCode) => {
            streamTerminal = true;
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamState('failed');
            setStreamStatusMessage(`Stream error: ${errCode}`);
          },
        },
        controller.signal,
        readyAttachmentIds.length > 0 ? readyAttachmentIds : undefined,
        Boolean(voice),
      );
    } catch (err) {
      if (!isCurrentAuthSession(generation, identityKey)) {
        return;
      }
      if ((err as Error).name === 'AbortError') {
        setStreamState('cancelled');
        setStreamStatusMessage('Stream cancelled by user.');
      } else {
        streamTerminal = true;
        setStreamState('failed');
        setChatError((err as Error).message);
        setStreamStatusMessage(`Failed: ${(err as Error).message}`);
        if (voice && !voice.signal.aborted && !controller.signal.aborted) {
          voiceRunError = err as Error;
        }
      }
    } finally {
      clearTimeout(earlyAbortTimer);
      voice?.signal.removeEventListener('abort', abortVoice);
      try {
        if (
          voice &&
          !streamTerminal &&
          (voice.signal.aborted || controller.signal.aborted) &&
          isCurrentAuthSession(generation, identityKey)
        ) {
          await confirmVoiceCancellation(voice.signal, controller.signal, voiceStreamId, async (id) => {
            const attemptCancel = async () => {
              try {
                return await cancelAssistantStream(
                  targetConversationId!,
                  id,
                  'Interrupted by a newer spoken instruction',
                );
              } catch (cancelErr) {
                if (cancelErr instanceof ApiRequestError && cancelErr.status === 404) {
                  return { success: true, status: 'cancelled' };
                }
                throw cancelErr;
              }
            };
            try {
              return await attemptCancel();
            } catch (firstErr) {
              if (
                firstErr instanceof ApiRequestError &&
                [429, 502, 503, 504].includes(firstErr.status)
              ) {
                await new Promise((r) => setTimeout(r, 300));
                return attemptCancel();
              }
              throw firstErr;
            }
          });
        }
      } catch {
        voiceCancellationUnverifiedRef.current = true;
        setChatError(
          'Could not verify the interrupted request. Re-open voice mode or review the conversation.',
        );
        throw Error('Voice cancellation unverified');
      } finally {
        chatSendBusyRef.current = false;
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (isCurrentAuthSession(generation, identityKey)) {
          if (voice) {
            void syncVoiceTurnMessages(targetConversationId);
          } else {
            await loadMessages(targetConversationId);
            await loadWorkspaceData();
          }
        }
      }
    }
    if (voice && !controller.signal.aborted && !voice.signal.aborted) {
      if (voiceRunError) throw voiceRunError;
      if (!replyId) throw Error('Could not complete response. Please try speaking again.');
    }
    return controller.signal.aborted ? undefined : replyId;
  }

  async function handleCancelStream() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    if (selectedConversationId && activeStreamId) {
      try {
        await cancelAssistantStream(
          selectedConversationId,
          activeStreamId,
          'Cancelled by user from web UI',
        );
        setStreamState('cancelled');
        setStreamStatusMessage('Stream cancelled.');
        await loadWorkspaceData();
      } catch (err) {
        setChatError((err as Error).message);
      }
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    transitionAuthContext(null);
    try {
      await request('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setPassword('');
      selectWorkspacePage('dashboard', true);
      await checkSession();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleBootstrap(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    transitionAuthContext(null);
    try {
      await request('/api/v1/bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          workspaceName,
          displayName,
          email,
          password,
        }),
      });
      setPassword('');
      selectWorkspacePage('dashboard', true);
      await checkSession();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleLogout() {
    // Immediately fence in-flight requests and clear all user/workspace-scoped state before network roundtrip
    transitionAuthContext(null);
    setPassword('');
    selectWorkspacePage('dashboard', true);
    try {
      await request('/api/v1/auth/logout', { method: 'POST' });
    } catch {
      // ignore network error; local session is already cleared and fenced
    }
  }

  /* ============================================================
     1. INITIAL SESSION LOADING STATE
     ============================================================ */
  if (loading) {
    return (
      <div className="auth-canvas" data-testid="session-loading">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', marginBottom: '0.85rem' }}>
            <span className="brand-mark">
              <ThaaraBrandMark size={22} />
            </span>
          </div>
          <h1 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.35rem' }}>
            THAARA AI
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Loading THAARA V2 executive session...
          </p>
        </div>
      </div>
    );
  }

  /* ============================================================
     2. UNAUTHENTICATED LOGIN & OWNER BOOTSTRAP SCREEN
     ============================================================ */
  if (!auth) {
    return (
      <div className="auth-canvas" data-testid="auth-screen">
        <div className="auth-card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <span className="brand-mark">
              <ThaaraBrandMark size={22} />
            </span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <h1 style={{ fontSize: '1.35rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                  THAARA AI
                </h1>
                <span className="brand-version">V2</span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', margin: 0 }}>
                Executive Intelligence Workspace
              </p>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Authentication mode"
            style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={`btn ${mode === 'login' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1 }}
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              data-testid="auth-tab-signin"
            >
              Sign In
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'bootstrap'}
              className={`btn ${mode === 'bootstrap' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1 }}
              onClick={() => {
                setMode('bootstrap');
                setError(null);
              }}
              data-testid="auth-tab-bootstrap"
            >
              Bootstrap Owner
            </button>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLogin} data-testid="login-form">
              <div className="form-group">
                <label htmlFor="auth-login-email">Email Address</label>
                <input
                  id="auth-login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="executive@quantumweave.com"
                />
              </div>
              <div className="form-group">
                <label htmlFor="auth-login-password">Password</label>
                <input
                  id="auth-login-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '0.5rem' }}
              >
                Sign In
              </button>
            </form>
          ) : (
            <form onSubmit={handleBootstrap} data-testid="bootstrap-form">
              <div className="form-group">
                <label htmlFor="auth-boot-workspace">Workspace Name</label>
                <input
                  id="auth-boot-workspace"
                  type="text"
                  required
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="Quantum Weave Executive"
                />
              </div>
              <div className="form-group">
                <label htmlFor="auth-boot-display">Display Name</label>
                <input
                  id="auth-boot-display"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Founding Partner"
                />
              </div>
              <div className="form-group">
                <label htmlFor="auth-boot-email">Email Address</label>
                <input
                  id="auth-boot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@quantumweave.com"
                />
              </div>
              <div className="form-group">
                <label htmlFor="auth-boot-password">Password (min 12 chars)</label>
                <input
                  id="auth-boot-password"
                  type="password"
                  required
                  minLength={12}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '0.5rem' }}
              >
                Initialize Platform
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  /* ============================================================
     3. AUTHENTICATED APPLICATION SHELL & DEDICATED PAGES
     ============================================================ */
  const activeWorkspaceId = auth.workspace.id;
  const allApprovals = Object.values(approvalsById).filter(
    (a) => !a.workspaceId || a.workspaceId === activeWorkspaceId,
  );
  const scopedConversations = conversations.filter(
    (c) => !c.workspace_id || c.workspace_id === activeWorkspaceId,
  );
  const scopedAuditEvents = auditEvents.filter(
    (evt) => !evt.workspaceId || evt.workspaceId === activeWorkspaceId,
  );
  const pendingApprovalsCount = allApprovals.filter((a) => a.status === 'pending').length;
  const filteredHistoryConversations = historySearchQuery.trim()
    ? scopedConversations.filter((c) =>
        c.title.toLowerCase().includes(historySearchQuery.trim().toLowerCase()),
      )
    : scopedConversations;

  const renderDedicatedPage = () => {
    switch (activePage) {
      case 'dashboard':
        return (
          <DashboardPage
            workspaceName={auth.workspace.name}
            userDisplayName={auth.user.displayName}
            userId={auth.user.id}
            userRole={auth.membership.role}
            conversations={scopedConversations}
            automations={automationsList}
            approvals={allApprovals}
            auditEvents={scopedAuditEvents}
            upcomingEvents={upcomingEvents}
            calendarMode={calendarMode}
            calendarTimeZone="UTC"
            connectorSummaries={connectorSummaries}
            decidingApprovalIds={decidingApprovalIds}
            onDecideApproval={(approvalId, decision) =>
              void handleDecideApproval(null, approvalId, decision)
            }
            onNavigate={(page) => selectWorkspacePage(page)}
            onSelectConversation={(convId) => setSelectedConversationId(convId)}
            formatTimestamp={formatTimestamp}
          />
        );

      case 'new-conversation':
        return (
          <div data-testid="chat-page">
            <PageHeader
              title="New Conversation"
              subtitle="Governed executive AI assistant with real-time Server-Sent Events streaming and approval gates."
              actions={
                <>
                  {streamState !== 'idle' && (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span className={getStreamBadgeClass(streamState)}>{streamState}</span>
                      {(streamState === 'connecting' ||
                        streamState === 'queued' ||
                        streamState === 'streaming') && (
                        <button
                          type="button"
                          onClick={() => void handleCancelStream()}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.78rem', padding: '0.3rem 0.65rem' }}
                        >
                          Cancel Stream
                        </button>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => selectWorkspacePage('conversation-history')}
                  >
                    View Conversation History ({conversations.length})
                  </button>
                </>
              }
            />

            {chatError && (
              <div className="error-banner" role="alert">
                {chatError}
              </div>
            )}

            {streamStatusMessage && (
              <div
                role="status"
                style={{
                  background: 'var(--brand-blue-soft)',
                  border: '1px solid var(--brand-blue-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0.65rem 0.95rem',
                  marginBottom: '1rem',
                  fontSize: '0.85rem',
                  color: 'var(--text-primary)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>
                  <strong>Stream Status:</strong> {streamStatusMessage}
                </span>
              </div>
            )}

            <div className="chat-shell">
              {/* Left Thread Selector & New Thread Form */}
              <aside className="chat-sidebar-pane" aria-label="Conversation threads">
                <form
                  onSubmit={handleCreateConversation}
                  style={{ display: 'flex', gap: '0.45rem' }}
                  data-testid="new-conversation-form"
                >
                  <input
                    type="text"
                    value={newConversationTitle}
                    onChange={(e) => setNewConversationTitle(e.target.value)}
                    placeholder="New conversation title..."
                    aria-label="New conversation title"
                    maxLength={255}
                    required
                    style={{
                      flex: 1,
                      background: 'var(--card-bg)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.48rem 0.7rem',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                    }}
                  />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    style={{ padding: '0.48rem 0.8rem', fontSize: '0.84rem' }}
                  >
                    New
                  </button>
                </form>

                <div
                  style={{
                    overflowY: 'auto',
                    maxHeight: '480px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.45rem',
                  }}
                >
                  {conversations.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', paddingTop: '0.5rem' }}>
                      No conversations yet. Create one above to start chatting.
                    </p>
                  ) : (
                    conversations.map((conv) => {
                      const isSelected = conv.id === selectedConversationId;
                      return (
                        <button
                          key={conv.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => {
                            setSelectedConversationId(conv.id);
                            setChatError(null);
                            setStreamState('idle');
                            setStreamStatusMessage(null);
                            setStreamingContent('');
                          }}
                          style={{
                            textAlign: 'left',
                            background: isSelected ? 'var(--brand-blue-soft)' : 'var(--card-bg)',
                            border: isSelected
                              ? '1px solid var(--brand-blue-border)'
                              : '1px solid var(--border-color)',
                            borderRadius: '8px',
                            padding: '0.65rem 0.8rem',
                            color: isSelected ? 'var(--brand-blue)' : 'var(--text-primary)',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.15rem' }}>
                            {conv.title}
                          </div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                            {formatTimestamp(conv.updated_at || conv.created_at)}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </aside>

              {/* Right Message Stream & Large Executive Composer */}
              <section className="chat-main-pane" aria-label="Active conversation">
                {!selectedConversationId ? (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <EmptyState
                      testId="chat-no-conversation-selected"
                      title="Ready for your executive request"
                      description="Type a message, click the voice button on the right, or select an existing thread."
                    />
                  </div>
                ) : (
                  <>
                    <div className="chat-stream-wrapper">
                      <div
                        className="chat-message-stream"
                        data-testid="chat-message-stream"
                        ref={chatStreamRef}
                        onScroll={handleStreamScroll}
                      >
                      {loadingMessages && messages.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                          Loading conversation history...
                        </p>
                      ) : messages.length === 0 && !streamingContent ? (
                        <div style={{ margin: 'auto', textAlign: 'center', maxWidth: '520px' }}>
                          <p
                            style={{
                              fontWeight: 600,
                              color: 'var(--text-primary)',
                              marginBottom: '0.35rem',
                            }}
                          >
                            No messages in this conversation yet. Send a message below.
                          </p>
                          <p
                            style={{
                              fontSize: '0.84rem',
                              color: 'var(--text-secondary)',
                              marginBottom: '0.9rem',
                            }}
                          >
                            {UI_VISIBILITY.automations
                              ? 'Ask Thaara to prepare a Calendar, WhatsApp, or Phone briefing, or compose an inactive offline n8n workflow blueprint.'
                              : 'Ask Thaara to prepare a Calendar, Gmail, Google Drive, WhatsApp, or Phone briefing.'}
                          </p>
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '0.45rem',
                              justifyContent: 'center',
                            }}
                          >
                            {[
                              'Summarize my recent calls',
                              'Prepare a WhatsApp briefing',
                              'Prepare my calendar briefing for today',
                            ].map((promptText) => (
                              <button
                                key={promptText}
                                type="button"
                                className="btn btn-secondary"
                                style={{ fontSize: '0.78rem', padding: '0.35rem 0.7rem' }}
                                onClick={() => setMessageInput(promptText)}
                              >
                                {promptText}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        messages.map((msg) => {
                          const msgPlanId =
                            typeof msg.metadata?.plan_id === 'string'
                              ? msg.metadata.plan_id
                              : null;
                          const plan = msgPlanId ? plansById[msgPlanId] : undefined;
                          const displayPlanStatus = plan
                            ? deriveDisplayPlanStatus(plan)
                            : typeof msg.metadata?.plan_status === 'string'
                              ? msg.metadata.plan_status
                              : null;
                          const receiptByStepId = new Map<string, PlanReceiptItem>(
                            (plan?.receipts ?? []).map((r) => [r.plan_step_id, r]),
                          );
                          const approvalStep = plan?.steps.find(
                            (s) => s.action_class === 'write' && s.approval_mode !== 'none',
                          );
                          const boundApprovalId =
                            approvalStep?.approval_request_id ??
                            (typeof msg.metadata?.approval_id === 'string'
                              ? msg.metadata.approval_id
                              : null);
                          const boundApproval = boundApprovalId
                            ? approvalsById[boundApprovalId]
                            : undefined;
                          const decisionCheck =
                            boundApproval && auth
                              ? canUserDecideApproval(
                                  auth.membership.role,
                                  auth.user.id,
                                  boundApproval,
                                )
                              : { canDecide: false };
                          const isGmailSendCard = Boolean(
                            isGmailSendActionName(boundApproval?.actionName) ||
                              plan?.steps.some((s) => isGmailSendActionName(s.action_name)),
                          );
                          const isCalendarMutationCard = Boolean(
                            isCalendarMutationActionName(boundApproval?.actionName) ||
                              plan?.steps.some((s) => isCalendarMutationActionName(s.action_name)),
                          );
                          // Phone calls use their own card: one tap on "Call now" is the owner's approval for that one call.
                          const isPhoneCallCard = Boolean(
                            boundApproval?.actionName === 'phone.ai.calls.request' ||
                              plan?.steps.some((s) => s.action_name === 'phone.ai.calls.request') ||
                              msg.metadata?.action_name === 'phone.ai.calls.request',
                          );
                          const isBulkCampaignCard = Boolean(
                            boundApproval?.actionName === 'campaign.bulk.execute' ||
                              plan?.steps.some((s) => s.action_name === 'campaign.bulk.execute') ||
                              msg.metadata?.action_name === 'campaign.bulk.execute',
                          );
                          const canCancelPlan =
                            plan &&
                            ['awaiting_approval', 'queued', 'running', 'paused'].includes(
                              plan.status,
                            );
                          const verifiedStageStep = plan?.steps.find(
                            (s) =>
                              s.action_name === 'automation.email.stage_workflow_artifact' &&
                              s.status === 'verified',
                          );
                          const hasVerifiedStagedWorkflow = Boolean(
                            (plan?.status === 'completed' && verifiedStageStep) ||
                              (displayPlanStatus === 'verified' &&
                                typeof msg.metadata?.staged_artifact_id === 'string' &&
                                msg.metadata.staged_artifact_id.length > 0),
                          );
                          const loadedWorkflowArtifact = msgPlanId
                            ? workflowArtifactsByPlanId[msgPlanId]
                            : undefined;
                          const isWorkflowExpanded = Boolean(
                            msgPlanId && expandedWorkflowPlanIds[msgPlanId],
                          );

                          return (
                            <div
                              key={msg.id}
                              className={`chat-bubble ${
                                msg.sender_type === 'user'
                                  ? 'chat-bubble-user'
                                  : 'chat-bubble-assistant'
                              }`}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  gap: '1rem',
                                  fontSize: '0.75rem',
                                  color: 'var(--text-secondary)',
                                  marginBottom: '0.3rem',
                                }}
                              >
                                <strong style={{ color: 'var(--text-primary)' }}>
                                  {msg.sender_type === 'user' ? 'You' : 'Thaara Assistant'}
                                </strong>
                                <span>{formatTimestamp(msg.created_at)}</span>
                              </div>
                              <div style={{ whiteSpace: 'pre-wrap' }}>
                                {msg.sender_type === 'user' ? msg.content : <ChatRichText text={msg.content} />}
                              </div>

                              {isPhoneCallCard && <PhoneCallChatCard key={boundApprovalId} approvalId={boundApprovalId} />}
                              {UI_VISIBILITY.bulkCampaigns && msgPlanId && isBulkCampaignCard && (
                                <BulkCampaignChatCard
                                  approval={boundApproval}
                                  plan={plan}
                                  canDecide={decisionCheck.canDecide}
                                  decideReason={decisionCheck.reason}
                                  deciding={Boolean(boundApproval && decidingApprovalIds[boundApproval.id])}
                                  refreshing={Boolean(refreshingPlanIds[msgPlanId])}
                                  onConfirm={() =>
                                    boundApproval &&
                                    void handleDecideApproval(msgPlanId, boundApproval.id, 'approved')
                                  }
                                  onCancel={() =>
                                    boundApproval &&
                                    void handleDecideApproval(msgPlanId, boundApproval.id, 'rejected')
                                  }
                                  onRefresh={() => void refreshPlanState(msgPlanId, true)}
                                  onOpenDashboard={() => selectWorkspacePage('bulk-campaign')}
                                />
                              )}
                              {msgPlanId && isGmailSendCard && (
                                <GmailSendChatCard
                                  approval={boundApproval}
                                  plan={plan}
                                  canDecide={decisionCheck.canDecide}
                                  decideReason={decisionCheck.reason}
                                  deciding={Boolean(boundApproval && decidingApprovalIds[boundApproval.id])}
                                  refreshing={Boolean(refreshingPlanIds[msgPlanId])}
                                  onConfirm={() =>
                                    boundApproval &&
                                    void handleDecideApproval(msgPlanId, boundApproval.id, 'approved')
                                  }
                                  onCancel={() =>
                                    boundApproval &&
                                    void handleDecideApproval(msgPlanId, boundApproval.id, 'rejected')
                                  }
                                  onRefresh={() => void refreshPlanState(msgPlanId, true)}
                                />
                              )}
                              {msgPlanId && isCalendarMutationCard && !isGmailSendCard && (
                                <CalendarMutationChatCard
                                  approval={boundApproval}
                                  plan={plan}
                                  canDecide={decisionCheck.canDecide}
                                  decideReason={decisionCheck.reason}
                                  deciding={Boolean(
                                    boundApproval && decidingApprovalIds[boundApproval.id],
                                  )}
                                  refreshing={Boolean(refreshingPlanIds[msgPlanId])}
                                  onConfirm={() =>
                                    boundApproval &&
                                    void handleDecideApproval(
                                      msgPlanId,
                                      boundApproval.id,
                                      'approved',
                                    )
                                  }
                                  onCancel={() =>
                                    boundApproval &&
                                    void handleDecideApproval(
                                      msgPlanId,
                                      boundApproval.id,
                                      'rejected',
                                    )
                                  }
                                  onRefresh={() => void refreshPlanState(msgPlanId, true)}
                                />
                              )}
                              {msgPlanId && !isGmailSendCard && !isCalendarMutationCard && !isPhoneCallCard && !isBulkCampaignCard && (
                                <div className="chat-plan-card">
                                  <div
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      flexWrap: 'wrap',
                                      gap: '0.5rem',
                                      marginBottom: '0.5rem',
                                    }}
                                  >
                                    <div>
                                      <strong>
                                        {UI_VISIBILITY.automations
                                          ? 'Governed Automation Plan:'
                                          : 'Governed Action Plan:'}{' '}
                                        {plan ? plan.title : 'Governed Plan'}
                                      </strong>
                                      <div
                                        style={{
                                          fontSize: '0.74rem',
                                          color: 'var(--text-secondary)',
                                          fontFamily: 'var(--font-mono)',
                                        }}
                                      >
                                        Plan ID: {msgPlanId}
                                      </div>
                                    </div>
                                    <div
                                      style={{
                                        display: 'flex',
                                        gap: '0.45rem',
                                        alignItems: 'center',
                                        flexWrap: 'wrap',
                                      }}
                                    >
                                      {displayPlanStatus && (
                                        <span
                                          className={getPlanStatusBadgeClass(displayPlanStatus)}
                                        >
                                          {displayPlanStatus}
                                        </span>
                                      )}
                                      {UI_VISIBILITY.automations && hasVerifiedStagedWorkflow && (
                                        <button
                                          type="button"
                                          className="btn btn-primary"
                                          disabled={Boolean(loadingWorkflowPlanIds[msgPlanId])}
                                          onClick={() => void handleToggleViewWorkflow(msgPlanId)}
                                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                                        >
                                          {loadingWorkflowPlanIds[msgPlanId]
                                            ? 'Loading Workflow...'
                                            : isWorkflowExpanded
                                              ? 'Hide Workflow'
                                              : 'View Workflow'}
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="btn btn-secondary"
                                        disabled={Boolean(refreshingPlanIds[msgPlanId])}
                                        onClick={() => void refreshPlanState(msgPlanId, true)}
                                        style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                                      >
                                        {refreshingPlanIds[msgPlanId]
                                          ? 'Refreshing...'
                                          : 'Refresh'}
                                      </button>
                                      {canCancelPlan && (
                                        <button
                                          type="button"
                                          className="btn btn-secondary"
                                          disabled={Boolean(cancellingPlanIds[msgPlanId])}
                                          onClick={() => void handleCancelGovernedPlan(msgPlanId)}
                                          style={{ padding: '0.25rem 0.55rem', fontSize: '0.75rem' }}
                                        >
                                          {cancellingPlanIds[msgPlanId]
                                            ? 'Cancelling...'
                                            : 'Cancel Plan'}
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {plan && plan.steps.length > 0 && (
                                    <div
                                      style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.4rem',
                                        marginBottom: boundApproval ? '0.65rem' : 0,
                                      }}
                                    >
                                      {plan.steps.map((step) => {
                                        const rec = receiptByStepId.get(step.id);
                                        const proof = (rec?.proof ?? {}) as Record<
                                          string,
                                          unknown
                                        >;
                                        const wfHash =
                                          typeof proof.workflowHash === 'string'
                                            ? proof.workflowHash
                                            : null;
                                        const drHash =
                                          typeof proof.dryRunHash === 'string'
                                            ? proof.dryRunHash
                                            : null;
                                        const artId =
                                          typeof proof.artifactId === 'string'
                                            ? proof.artifactId
                                            : null;
                                        const gmailProviderMsgId =
                                          typeof proof.providerMessageId === 'string'
                                            ? proof.providerMessageId
                                            : null;
                                        const gmailProviderThreadId =
                                          typeof proof.providerThreadId === 'string'
                                            ? proof.providerThreadId
                                            : null;
                                        const gmailReceiptStatus =
                                          typeof proof.status === 'string'
                                            ? proof.status
                                            : null;
                                        const errText =
                                          typeof proof.error === 'string'
                                            ? proof.error
                                            : typeof proof.reason === 'string'
                                              ? proof.reason
                                              : typeof step.error_details?.error === 'string'
                                                ? step.error_details.error
                                                : null;

                                        return (
                                          <div key={step.id} className="chat-step-row">
                                            <div
                                              style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                gap: '0.5rem',
                                              }}
                                            >
                                              <span style={{ fontFamily: 'var(--font-mono)' }}>
                                                Step {step.step_index + 1}: {step.action_name}
                                              </span>
                                              <span
                                                className={getPlanStatusBadgeClass(step.status)}
                                              >
                                                {step.status}
                                              </span>
                                            </div>
                                            {rec && (
                                              <div
                                                style={{
                                                  marginTop: '0.25rem',
                                                  fontSize: '0.75rem',
                                                  color: 'var(--text-secondary)',
                                                }}
                                              >
                                                <div>
                                                  Receipt:{' '}
                                                  <code style={{ color: 'var(--text-primary)' }}>
                                                    {rec.id.slice(0, 12)}...
                                                  </code>{' '}
                                                  ({rec.status} via {rec.verification_method})
                                                </div>
                                                {wfHash && (
                                                  <div>
                                                    Workflow Hash:{' '}
                                                    <code>{wfHash.slice(0, 16)}...</code>
                                                  </div>
                                                )}
                                                {drHash && (
                                                  <div>
                                                    Dry-Run Hash:{' '}
                                                    <code>{drHash.slice(0, 16)}...</code>
                                                  </div>
                                                )}
                                                {artId && (
                                                  <div>
                                                    Staged Artifact ID: <code>{artId}</code>{' '}
                                                    (inactive &amp; offline, realEmailSent: false)
                                                  </div>
                                                )}
                                                {gmailProviderMsgId && (
                                                  <div>
                                                    Gmail Delivery Receipt:{' '}
                                                    <code>{gmailReceiptStatus ?? 'accepted_by_gmail'}</code>{' '}
                                                    | Message ID: <code>{gmailProviderMsgId}</code>
                                                    {gmailProviderThreadId ? (
                                                      <>
                                                        {' '}
                                                        | Thread ID:{' '}
                                                        <code>{gmailProviderThreadId}</code>
                                                      </>
                                                    ) : null}
                                                  </div>
                                                )}
                                              </div>
                                            )}
                                            {errText && (
                                              <div
                                                style={{
                                                  marginTop: '0.25rem',
                                                  fontSize: '0.75rem',
                                                  color: 'var(--danger)',
                                                }}
                                              >
                                                Reason: {errText}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {boundApproval && (
                                    <div
                                      style={{
                                        padding: '0.75rem',
                                        background: 'var(--warning-bg)',
                                        border: '1px solid var(--warning-border)',
                                        borderRadius: '6px',
                                      }}
                                    >
                                      <div
                                        style={{
                                          display: 'flex',
                                          justifyContent: 'space-between',
                                          alignItems: 'center',
                                          gap: '0.5rem',
                                          marginBottom: '0.35rem',
                                        }}
                                      >
                                        <strong>
                                          {boundApproval.actionName === 'gmail.messages.send_reply'
                                            ? 'Gmail Reply Approval Gate'
                                            : 'Offline Workflow Staging Approval Gate'}
                                        </strong>
                                        <span
                                          className={getPlanStatusBadgeClass(boundApproval.status)}
                                        >
                                          {boundApproval.status}
                                        </span>
                                      </div>
                                      <div
                                        style={{
                                          fontSize: '0.76rem',
                                          color: 'var(--text-secondary)',
                                          display: 'grid',
                                          gap: '0.15rem',
                                          marginBottom: '0.5rem',
                                        }}
                                      >
                                        <div>
                                          <strong>Action:</strong>{' '}
                                          <code>{boundApproval.actionName}</code> |{' '}
                                          <strong>Risk:</strong>{' '}
                                          <code>{boundApproval.riskLevel}</code>
                                        </div>
                                        {boundApproval.actionName === 'gmail.messages.send_reply' ? (
                                          <>
                                            <div>
                                              <strong>Connected Gmail Account:</strong>{' '}
                                              <code>
                                                {String(
                                                  boundApproval.actionParams?.connectedEmail ??
                                                    'Verified Account',
                                                )}
                                              </code>
                                            </div>
                                            <div>
                                              <strong>Recipient:</strong>{' '}
                                              <code>
                                                {String(boundApproval.actionParams?.to ?? '')}
                                              </code>{' '}
                                              | <strong>Subject:</strong>{' '}
                                              {String(boundApproval.actionParams?.subject ?? '')}
                                            </div>
                                            <div>
                                              <strong>Reply Message:</strong>{' '}
                                              <span style={{ color: 'var(--text-primary)' }}>
                                                {String(boundApproval.actionParams?.bodyText ?? '')}
                                              </span>
                                            </div>
                                          </>
                                        ) : (
                                          <div>
                                            <strong>Safety Guarantee:</strong> Offline staging only (
                                            <code>active: false</code>, no external deployment)
                                          </div>
                                        )}
                                      </div>

                                      {boundApproval.status === 'pending' &&
                                        (decisionCheck.canDecide ? (
                                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button
                                              type="button"
                                              className="btn btn-primary"
                                              disabled={Boolean(
                                                decidingApprovalIds[boundApproval.id],
                                              )}
                                              onClick={() =>
                                                void handleDecideApproval(
                                                  msgPlanId,
                                                  boundApproval.id,
                                                  'approved',
                                                )
                                              }
                                              style={{
                                                padding: '0.35rem 0.75rem',
                                                fontSize: '0.78rem',
                                              }}
                                            >
                                              {decidingApprovalIds[boundApproval.id]
                                                ? 'Submitting...'
                                                : boundApproval.actionName ===
                                                    'gmail.messages.send_reply'
                                                  ? 'Approve and Send'
                                                  : 'Approve Staging'}
                                            </button>
                                            <button
                                              type="button"
                                              className="btn btn-danger"
                                              disabled={Boolean(
                                                decidingApprovalIds[boundApproval.id],
                                              )}
                                              onClick={() =>
                                                void handleDecideApproval(
                                                  msgPlanId,
                                                  boundApproval.id,
                                                  'rejected',
                                                )
                                              }
                                              style={{
                                                padding: '0.35rem 0.75rem',
                                                fontSize: '0.78rem',
                                              }}
                                            >
                                              {decidingApprovalIds[boundApproval.id]
                                                ? 'Submitting...'
                                                : boundApproval.actionName ===
                                                    'gmail.messages.send_reply'
                                                  ? 'Cancel'
                                                  : 'Reject'}
                                            </button>
                                          </div>
                                        ) : (
                                          <div
                                            style={{
                                              fontSize: '0.76rem',
                                              color: 'var(--warning)',
                                            }}
                                          >
                                            {decisionCheck.reason ||
                                              'Only authorized workspace users can decide this approval.'}
                                          </div>
                                        ))}
                                    </div>
                                  )}

                                  {UI_VISIBILITY.automations &&
                                    isWorkflowExpanded &&
                                    loadedWorkflowArtifact && (
                                    <WorkflowInspector
                                      artifact={loadedWorkflowArtifact}
                                      copied={Boolean(copiedWorkflowPlanIds[msgPlanId])}
                                      onCopy={() =>
                                        void handleCopyWorkflowJson(
                                          msgPlanId,
                                          loadedWorkflowArtifact,
                                        )
                                      }
                                      onDownload={() =>
                                        handleDownloadWorkflowJson(loadedWorkflowArtifact)
                                      }
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}

                      {streamingContent && (
                        <div className="chat-bubble chat-bubble-assistant">
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--brand-blue)',
                              marginBottom: '0.25rem',
                            }}
                          >
                            <strong>Thaara Assistant (Streaming...)</strong>
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>
                            <ChatRichText text={streamingContent} />
                          </div>
                        </div>
                      )}
                    </div>
                      {showJumpToLatest && (
                        <button
                          type="button"
                          className="chat-jump-to-latest-btn"
                          onClick={() => scrollToBottom(true)}
                          data-testid="chat-jump-to-latest-btn"
                          aria-label="Jump to latest messages"
                        >
                          <span>↓ Jump to latest</span>
                          {hasNewTokensWhileScrolled && (
                            <span className="chat-jump-badge">New</span>
                          )}
                        </button>
                      )}
                    </div>
                  </>
                )}

                <ChatAttachmentPreview
                  attachments={chatAttachments}
                  onRemove={handleRemoveAttachment}
                  disabled={
                    streamState === 'connecting' ||
                    streamState === 'queued' ||
                    streamState === 'streaming'
                  }
                />

                <form
                  onSubmit={handleSendMessage}
                  className="chat-composer-pill"
                  data-testid="chat-composer-form"
                >
                  <div className="chat-composer-left">
                    <button
                      type="button"
                      className="chat-attachment-toggle-btn"
                      onClick={() => setIsAttachmentMenuOpen((prev) => !prev)}
                      disabled={
                        !selectedConversationId ||
                        streamState === 'connecting' ||
                        streamState === 'queued' ||
                        streamState === 'streaming'
                      }
                      aria-label="Add attachment"
                      title="Add photos or documents"
                      aria-haspopup="menu"
                      aria-expanded={isAttachmentMenuOpen}
                      data-testid="chat-attachment-toggle-btn"
                    >
                      +
                    </button>

                    <ChatAttachmentMenu
                      isOpen={isAttachmentMenuOpen}
                      onClose={() => setIsAttachmentMenuOpen(false)}
                      onFilesSelected={handleFilesSelected}
                      disabled={
                        !selectedConversationId ||
                        streamState === 'connecting' ||
                        streamState === 'queued' ||
                        streamState === 'streaming'
                      }
                      currentCount={chatAttachments.length}
                      maxCount={5}
                    />
                  </div>

                  <input
                    type="text"
                    className="chat-composer-input"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    placeholder={
                      chatAttachments.length > 0
                        ? 'Add optional instructions for attached file(s)...'
                        : 'Ask Thaara...'
                    }
                    aria-label="Message for Thaara"
                    disabled={
                      streamState === 'connecting' ||
                      streamState === 'queued' ||
                      streamState === 'streaming'
                    }
                  />

                  <div className="chat-composer-right">
                    {(messageInput.trim().length > 0 || chatAttachments.length > 0) && (
                      <button
                        type="submit"
                        className="chat-composer-send-btn"
                        disabled={
                          chatAttachments.some((a) => a.status === 'uploading') ||
                          streamState === 'connecting' ||
                          streamState === 'queued' ||
                          streamState === 'streaming'
                        }
                        aria-label="Send message"
                        title="Send message"
                        data-testid="chat-composer-send-btn"
                      >
                        {chatAttachments.some((a) => a.status === 'uploading') ? (
                          <span style={{ fontSize: '0.75rem', padding: '0 0.35rem' }}>…</span>
                        ) : (
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <line x1="12" y1="19" x2="12" y2="5" />
                            <polyline points="5 12 12 5 19 12" />
                          </svg>
                        )}
                      </button>
                    )}

                    <ThaaraVoiceModeButton
                      configured={voiceConfigured}
                      disabled={
                        chatAttachments.length > 0 ||
                        streamState === 'connecting' ||
                        streamState === 'queued' ||
                        streamState === 'streaming'
                      }
                      onOpen={() => void handleOpenVoiceMode()}
                    />
                  </div>
                </form>

                {isVoiceScreenOpen && selectedConversationId && (() => {
                  const latestAssistant = [...messages]
                    .reverse()
                    .find((m) => m.sender_type === 'assistant');
                  const latestPlanId =
                    typeof latestAssistant?.metadata?.plan_id === 'string'
                      ? latestAssistant.metadata.plan_id
                      : null;
                  const latestApprovalId =
                    typeof latestAssistant?.metadata?.approval_id === 'string'
                      ? latestAssistant.metadata.approval_id
                      : null;
                  const latestApproval = latestApprovalId
                    ? approvalsById[latestApprovalId]
                    : undefined;
                  const pendingApproval =
                    latestApproval && latestApproval.status === 'pending'
                      ? {
                          approval: latestApproval,
                          planId: latestPlanId,
                          canDecide: canUserDecideApproval(
                            auth.membership.role,
                            auth.user.id,
                            latestApproval,
                          ).canDecide,
                          deciding: Boolean(decidingApprovalIds[latestApproval.id]),
                        }
                      : null;
                  return (
                    <ThaaraVoiceScreen
                      key={`voice-screen:${authIdentityKeyRef.current}:${selectedConversationId}`}
                      conversationId={selectedConversationId}
                      streamingText={streamingContent}
                      latestAssistantText={latestAssistant?.content}
                      pendingApproval={pendingApproval}
                      onDecideApproval={(planId, approvalId, decision) =>
                        void handleDecideApproval(planId, approvalId, decision)
                      }
                      context={voiceScopeRef.current.capture()}
                      onVoiceCommand={(text, signal) =>
                        handleSendMessage(undefined, {
                          text,
                          signal,
                          conversationId: selectedConversationId,
                        })
                      }
                      onClose={() => {
                        setIsVoiceScreenOpen(false);
                        void loadMessages(selectedConversationId);
                        void loadWorkspaceData();
                      }}
                    />
                  );
                })()}
              </section>
            </div>
          </div>
        );

      case 'conversation-history':
        return (
          <div data-testid="conversation-history-page">
            <PageHeader
              title="Conversation History"
              subtitle="Browse, search, and resume past governed executive threads."
              actions={
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => selectWorkspacePage('new-conversation')}
                >
                  + Open Chat Composer
                </button>
              }
            />

            <section className="card">
              <div className="automation-toolbar">
                <label htmlFor="history-search" style={{ flex: '1 1 280px' }}>
                  Search conversations
                  <input
                    id="history-search"
                    type="text"
                    value={historySearchQuery}
                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                    placeholder="Filter by conversation title..."
                  />
                </label>
                <span className="automation-muted">
                  {filteredHistoryConversations.length} of {conversations.length} conversations
                </span>
              </div>

              {filteredHistoryConversations.length === 0 ? (
                <EmptyState
                  testId="conversation-history-empty"
                  title={
                    conversations.length === 0
                      ? 'No conversations recorded yet.'
                      : 'No conversations match your search.'
                  }
                  description="Start a new governed executive conversation to build your workspace history."
                  actionLabel="New Conversation"
                  onAction={() => selectWorkspacePage('new-conversation')}
                />
              ) : (
                <ul className="automation-list" aria-label="Past conversations">
                  {filteredHistoryConversations.map((conv) => {
                    const isSelected = conv.id === selectedConversationId;
                    return (
                      <li key={conv.id} style={{ background: 'transparent', border: 'none', padding: 0 }}>
                        <button
                          type="button"
                          className="automation-plan"
                          aria-pressed={isSelected}
                          onClick={() => {
                            setSelectedConversationId(conv.id);
                            selectWorkspacePage('new-conversation');
                          }}
                        >
                          <span>
                            <strong>{conv.title}</strong>
                            <small>
                              Created {formatTimestamp(conv.created_at)} · Last active{' '}
                              {formatTimestamp(conv.updated_at || conv.created_at)}
                            </small>
                          </span>
                          <span className="badge badge-info">
                            {isSelected ? 'Active Thread' : 'Resume in Chat'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        );

      case 'automations': {
        if (!UI_VISIBILITY.automations) {
          const meta = getPageMeta('not-found');
          return (
            <div data-testid="not-found-page">
              <PageHeader title={meta.title} subtitle={meta.subtitle} />
              <EmptyState
                title="Workspace route not found"
                description="The page you requested does not exist in Thaara AI V2."
                actionLabel="Return to Dashboard"
                onAction={() => selectWorkspacePage('dashboard')}
              />
            </div>
          );
        }
        return (
          <div data-testid="automations-page" aria-label="Automations">
            <AutomationDashboard
              key={'automations-' + auth.workspace.id + ':' + auth.user.id + ':' + auth.membership.role}
            />
          </div>
        );
      }

      case 'gmail':
        return (
          <div data-testid="gmail-page" aria-label="Gmail Integration">
            <GmailScreen
              key={'gmail-' + auth.workspace.id + auth.user.id + auth.membership.role}
              workspaceId={auth.workspace.id}
              userId={auth.user.id}
              role={auth.membership.role}
            />
          </div>
        );

      case 'whatsapp':
        return (
          <div data-testid="whatsapp-page" aria-label="WhatsApp Business">
            <WhatsAppScreen
              key={'whatsapp-' + auth.workspace.id + auth.user.id + auth.membership.role}
              workspaceId={auth.workspace.id}
              userId={auth.user.id}
              role={auth.membership.role}
            />
          </div>
        );

      case 'phone':
        return (
          <div data-testid="phone-page" aria-label="Phone">
            <PhoneCallPage key={'phone-' + auth.workspace.id + auth.user.id} />
          </div>
        );

      case 'phone-contacts':
        return (
          <div data-testid="phone-contacts" aria-label="Contacts">
            <PhoneContactsPage key={'phone-contacts-' + auth.workspace.id + auth.user.id} />
          </div>
        );

      case 'phone-history':
        return (
          <div data-testid="phone-history" aria-label="Call history">
            <PhoneHistoryPage ownerIdentity={{role:auth.membership.role,userId:auth.user.id,workspaceId:auth.workspace.id}} key={'phone-history-' + auth.workspace.id + auth.user.id} />
          </div>
        );
      case 'phone-inbound':
        return <PhoneInboundPage role={auth.membership.role} ownerIdentity={{userId:auth.user.id,workspaceId:auth.workspace.id}} key={'phone-inbound-'+getAuthIdentityKey(auth)}/>;
      case 'phone-outbound':
        return <PhoneHistoryPage title="Outbound calls" ownerIdentity={{role:auth.membership.role,userId:auth.user.id,workspaceId:auth.workspace.id}} key={'phone-outbound-'+auth.workspace.id+auth.user.id}/>;

      case 'calendar':
        return (
          <div data-testid="calendar-page" aria-label="Google Calendar">
            <CalendarScreen
              key={'calendar-' + auth.workspace.id + auth.user.id + auth.membership.role}
              workspaceId={auth.workspace.id}
              userId={auth.user.id}
              role={auth.membership.role}
            />
          </div>
        );

      case 'drive':
        return (
          <div data-testid="drive-page" aria-label="Google Drive">
            <GoogleDriveScreen
              key={'drive-' + auth.workspace.id + auth.user.id + auth.membership.role}
              workspaceId={auth.workspace.id}
              userId={auth.user.id}
              role={auth.membership.role}
            />
          </div>
        );

      case 'bulk-campaign':
      case 'bulk-campaign-create':
      case 'bulk-campaign-history': {
        if (!UI_VISIBILITY.bulkCampaigns) {
          const meta = getPageMeta('not-found');
          return (
            <div data-testid="not-found-page">
              <PageHeader title={meta.title} subtitle={meta.subtitle} />
              <EmptyState
                title="Workspace route not found"
                description="The page you requested does not exist in Thaara AI V2."
                actionLabel="Return to Dashboard"
                onAction={() => selectWorkspacePage('dashboard')}
              />
            </div>
          );
        }
        return (
          <WorkspacePageErrorBoundary onRecover={() => selectWorkspacePage('bulk-campaign-history')}>
            <BulkCampaignPanel
              key={
                'bulk-campaign-' +
                auth.workspace.id +
                auth.user.id +
                auth.membership.role +
                '-' +
                (activePage === 'bulk-campaign-history' ? 'history' : 'create')
              }
              initialViewMode={activePage === 'bulk-campaign-history' ? 'history' : 'create'}
              onNavigatePage={(page) => selectWorkspacePage(page)}
            />
          </WorkspacePageErrorBoundary>
        );
      }

      case 'settings':
        return (
          <div data-testid="settings-page">
            <PageHeader
              title="Customizations / Settings"
              subtitle={
                UI_VISIBILITY.n8nSettingsConnection
                  ? 'Workspace configuration, n8n connection profiles, diagnostics, and tenant audit ledger.'
                  : 'Workspace configuration, diagnostics, and tenant audit ledger.'
              }
            />
            {UI_VISIBILITY.n8nSettingsConnection && (
              <N8nConnection
                key={'n8n-' + auth.workspace.id + ':' + auth.user.id + ':' + auth.membership.role}
                workspaceId={auth.workspace.id}
                role={auth.membership.role}
              />
            )}
            <ConnectorDiagnostics
              key={'diagnostics-' + auth.workspace.id + ':' + auth.user.id + ':' + auth.membership.role}
              workspaceId={auth.workspace.id}
              role={auth.membership.role}
            />
            {(UI_VISIBILITY.n8nSettingsConnection || connectorStatus?.connectorName !== 'n8n') && (
              <section className="card" aria-labelledby="connector-boundary-heading">
                <h2 id="connector-boundary-heading" style={{ fontSize: '1.2rem', marginBottom: '0.75rem' }}>
                  Connector Status Boundary
                </h2>
                {connectorStatus ? (
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.75rem',
                        alignItems: 'center',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <strong>Adapter:</strong> {connectorStatus.connectorName}
                      <span className="badge badge-warning">{connectorStatus.status}</span>
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                      {connectorStatus.message}
                    </p>
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-secondary)' }}>Loading connector state...</p>
                )}
              </section>
            )}

            <section className="card" aria-labelledby="audit-ledger-heading">
              <h2 id="audit-ledger-heading" style={{ fontSize: '1.2rem', marginBottom: '0.75rem' }}>
                Tenant Audit Ledger
              </h2>
              {auditEvents.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>No audit events recorded yet.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                        <th style={{ padding: '0.6rem' }}>Action</th>
                        <th style={{ padding: '0.6rem' }}>Target</th>
                        <th style={{ padding: '0.6rem' }}>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditEvents.map((evt) => (
                        <tr key={evt.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '0.6rem', fontFamily: 'var(--font-mono)' }}>
                            {evt.action}
                          </td>
                          <td style={{ padding: '0.6rem' }}>{evt.targetType || '—'}</td>
                          <td style={{ padding: '0.6rem', color: 'var(--text-secondary)' }}>
                            {formatTimestamp(evt.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        );

      default: {
        const meta = getPageMeta('not-found');
        return (
          <div data-testid="not-found-page">
            <PageHeader title={meta.title} subtitle={meta.subtitle} />
            <EmptyState
              title="Workspace route not found"
              description="The page you requested does not exist in Thaara AI V2."
              actionLabel="Return to Dashboard"
              onAction={() => selectWorkspacePage('dashboard')}
            />
          </div>
        );
      }
    }
  };

  return (
    <AppShell
      sidebar={
        <Sidebar
          activePage={activePage}
          onSelectPage={(page) => selectWorkspacePage(page)}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((prev) => !prev)}
          integrationsExpanded={integrationsExpanded}
          onToggleIntegrations={() => setIntegrationsExpanded((prev) => !prev)}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          workspaceName={auth.workspace.name}
          userDisplayName={auth.user.displayName}
          userEmail={auth.user.email}
          userRole={auth.membership.role}
          pendingApprovalsCount={pendingApprovalsCount}
          onSignOut={() => void handleLogout()}
        />
      }
      topbar={
        <Topbar
          workspaceName={auth.workspace.name}
          userDisplayName={auth.user.displayName}
          userRole={auth.membership.role}
          connectorModeLabel="Governed Workspace · Live Connectors"
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          onNewConversation={() => selectWorkspacePage('new-conversation')}
        />
      }
    >
      {renderDedicatedPage()}
    </AppShell>
  );
}
