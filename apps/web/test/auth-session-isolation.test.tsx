import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  App,
  WorkspaceSessionApi,
  WorkspaceSessionState,
  createDefaultConnectorSummaries,
  createWorkspaceSessionController,
} from '../src/App';
import {
  ApiRequestError,
  ApprovalRequestItem,
  AuditEventItem,
  AuthState,
  ConversationItem,
} from '../src/api';
import type { AutomationSummary } from '../src/automation-api';
import type { CalendarEvent } from '../src/calendar-api';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const USER_A_WS1: AuthState = {
  user: {
    id: 'user-a',
    email: 'user-a@ws1.example.test',
    displayName: 'User Alpha',
  },
  workspace: {
    id: 'ws-1',
    name: 'Workspace Alpha',
  },
  membership: {
    role: 'owner',
    joinedAt: '2026-10-01T00:00:00.000Z',
  },
  csrfToken: 'csrf-a',
};

const USER_B_WS1: AuthState = {
  user: {
    id: 'user-b',
    email: 'user-b@ws1.example.test',
    displayName: 'User Beta',
  },
  workspace: {
    id: 'ws-1',
    name: 'Workspace Alpha',
  },
  membership: {
    role: 'viewer',
    joinedAt: '2026-10-02T00:00:00.000Z',
  },
  csrfToken: 'csrf-b',
};

const USER_C_WS2: AuthState = {
  user: {
    id: 'user-c',
    email: 'user-c@ws2.example.test',
    displayName: 'User Gamma',
  },
  workspace: {
    id: 'ws-2',
    name: 'Workspace Gamma',
  },
  membership: {
    role: 'owner',
    joinedAt: '2026-10-03T00:00:00.000Z',
  },
  csrfToken: 'csrf-c',
};

const APPROVAL_USER_A: ApprovalRequestItem = {
  id: 'appr-secret-user-a-001',
  workspaceId: 'ws-1',
  actionName: 'automation.email.stage_workflow_artifact',
  actionParams: { subject: 'Confidential M&A Approval' },
  requesterUserId: 'user-a',
  approverUserId: null,
  status: 'pending',
  riskLevel: 'high',
  expiresAt: '2026-10-25T10:00:00.000Z',
  createdAt: '2026-10-22T10:00:00.000Z',
  updatedAt: '2026-10-22T10:00:00.000Z',
};

const APPROVAL_USER_C_WS2: ApprovalRequestItem = {
  id: 'appr-ws2-only-999',
  workspaceId: 'ws-2',
  actionName: 'phone.briefing.prepare',
  actionParams: {},
  requesterUserId: 'user-c',
  approverUserId: null,
  status: 'pending',
  riskLevel: 'medium',
  expiresAt: '2026-10-25T10:00:00.000Z',
  createdAt: '2026-10-22T11:00:00.000Z',
  updatedAt: '2026-10-22T11:00:00.000Z',
};

const CONVERSATION_USER_A: ConversationItem = {
  id: 'conv-secret-a',
  workspace_id: 'ws-1',
  user_id: 'user-a',
  title: 'Confidential Board Acquisition Thread',
  channel: 'web',
  status: 'active',
  metadata: {},
  created_at: '2026-10-22T09:00:00.000Z',
  updated_at: '2026-10-22T09:30:00.000Z',
};

const AUTOMATION_USER_A: AutomationSummary = {
  id: 'auto-secret-a',
  title: 'Private Treasury Sweep Blueprint',
  status: 'awaiting_approval',
  display_status: 'awaiting_approval',
  created_at: '2026-10-22T08:00:00.000Z',
  updated_at: '2026-10-22T08:30:00.000Z',
};

const AUDIT_USER_A: AuditEventItem = {
  id: 'audit-secret-a',
  workspaceId: 'ws-1',
  actorUserId: 'user-a',
  action: 'secret.vault.rotated',
  targetType: 'vault_key',
  targetId: 'vk-1',
  payload: {},
  createdAt: '2026-10-22T09:15:00.000Z',
};

const CALENDAR_EVENT_USER_A: CalendarEvent = {
  id: 'cal-secret-a',
  calendarId: 'primary',
  summary: 'Private CEO Compensation Committee',
  startAt: '2026-10-23T10:00:00Z',
  endAt: '2026-10-23T11:00:00Z',
  timeZone: 'UTC',
  allDay: false,
  status: 'confirmed',
  attendees: [],
  untrusted: true,
  mode: 'mock',
};

function createMockSessionApi(overrides: Partial<WorkspaceSessionApi> = {}): WorkspaceSessionApi {
  return {
    checkMe: vi.fn(async () => USER_A_WS1),
    logout: vi.fn(async () => undefined),
    getConnectorStatus: vi.fn(async () => ({
      connectorName: 'n8n',
      status: 'connected' as const,
      connected: true,
      configured: true,
      message: 'Ready',
    })),
    getAuditEvents: vi.fn(async () => ({ events: [AUDIT_USER_A], total: 1 })),
    listConversations: vi.fn(async () => [CONVERSATION_USER_A]),
    listAutomations: vi.fn(async () => ({ items: [AUTOMATION_USER_A], nextOffset: null })),
    listApprovals: vi.fn(async () => [APPROVAL_USER_A]),
    getGmailStatus: vi.fn(async () => ({ status: 'connected', mode: 'mock' })),
    getWhatsAppStatus: vi.fn(async () => ({ status: 'connected', mode: 'mock' })),
    fetchPhoneStatus: vi.fn(async () => ({ status: 'connected', mode: 'mock' })),
    getCalendarStatus: vi.fn(async () => ({
      status: 'connected',
      mode: 'mock',
      connected: true,
    })),
    getCalendarAgenda: vi.fn(async () => ({
      days: [{ events: [CALENDAR_EVENT_USER_A] }],
    })),
    listConversationMessages: vi.fn(async () => []),
    getPlanWithSteps: vi.fn(async (planId: string) => ({
      id: planId,
      workspace_id: 'ws-1',
      conversation_id: 'conv-secret-a',
      requester_user_id: 'user-a',
      title: 'Confidential Plan',
      status: 'awaiting_approval' as const,
      display_status: 'awaiting_approval' as const,
      metadata: {},
      created_at: '2026-10-22T10:00:00.000Z',
      updated_at: '2026-10-22T10:00:00.000Z',
      steps: [],
      receipts: [],
    })),
    ...overrides,
  };
}

function renderSessionMarkup(
  state: WorkspaceSessionState,
  page: 'dashboard' | 'conversation-history' | 'settings' = 'dashboard',
): string {
  return renderToStaticMarkup(
    <App
      initialAuth={state.auth}
      initialLoading={state.loading}
      initialPage={page}
      initialApprovals={Object.values(state.approvalsById)}
      initialAutomations={state.automationsList}
      initialConversations={state.conversations}
      initialAuditEvents={state.auditEvents}
      initialUpcomingEvents={state.upcomingEvents}
      initialCalendarMode={state.calendarMode}
    />,
  );
}

describe('Step 103 — Dashboard Cross-User & Cross-Workspace Isolation Regression Suite', () => {
  it('1. clears approvals, overview, conversations, automations, audit, and calendar immediately on logout before network logout finishes', async () => {
    const logoutDeferred = createDeferred<void>();
    const api = createMockSessionApi({
      logout: vi.fn(() => logoutDeferred.promise),
    });

    const controller = createWorkspaceSessionController({}, undefined, api);
    await controller.checkSession();

    const stateUserA = controller.getState();
    expect(stateUserA.auth?.user.id).toBe('user-a');
    expect(Object.keys(stateUserA.approvalsById)).toEqual(['appr-secret-user-a-001']);
    expect(stateUserA.conversations).toHaveLength(1);
    expect(stateUserA.automationsList).toHaveLength(1);
    expect(stateUserA.auditEvents).toHaveLength(1);
    expect(stateUserA.upcomingEvents).toHaveLength(1);

    const htmlBeforeLogout = renderSessionMarkup(stateUserA, 'dashboard');
    expect(htmlBeforeLogout).toContain('appr-secret-user-a-001');
    expect(htmlBeforeLogout).toContain('automation.email.stage_workflow_artifact');
    expect(htmlBeforeLogout).toContain('Confidential Board Acquisition Thread');
    expect(htmlBeforeLogout).toContain('secret.vault.rotated');
    expect(htmlBeforeLogout).toContain('Private CEO Compensation Committee');

    // Trigger logout while network request is still pending
    const logoutPromise = controller.logout();
    const stateDuringLogout = controller.getState();

    expect(stateDuringLogout.auth).toBeNull();
    expect(stateDuringLogout.approvalsById).toEqual({});
    expect(stateDuringLogout.conversations).toEqual([]);
    expect(stateDuringLogout.automationsList).toEqual([]);
    expect(stateDuringLogout.auditEvents).toEqual([]);
    expect(stateDuringLogout.upcomingEvents).toEqual([]);
    expect(stateDuringLogout.calendarMode).toBe('disabled');
    expect(stateDuringLogout.connectorSummaries).toEqual(createDefaultConnectorSummaries());

    const htmlAfterLogout = renderSessionMarkup(stateDuringLogout, 'dashboard');
    expect(htmlAfterLogout).not.toContain('appr-secret-user-a-001');
    expect(htmlAfterLogout).not.toContain('automation.email.stage_workflow_artifact');
    expect(htmlAfterLogout).not.toContain('Confidential Board Acquisition Thread');
    expect(htmlAfterLogout).not.toContain('secret.vault.rotated');
    expect(htmlAfterLogout).not.toContain('Private CEO Compensation Committee');
    expect(htmlAfterLogout).toContain('data-testid="login-form"');

    logoutDeferred.resolve();
    await logoutPromise;
    controller.dispose();
  });

  it('2. switching from User A to User B in the same workspace clears User A state and fails closed when User B approval refresh errors', async () => {
    let activeUser: AuthState = USER_A_WS1;
    let failApprovalsForUserB = false;

    const api = createMockSessionApi({
      checkMe: vi.fn(async () => activeUser),
      listApprovals: vi.fn(async () => {
        if (activeUser.user.id === 'user-a') {
          return [APPROVAL_USER_A];
        }
        if (failApprovalsForUserB) {
          throw new ApiRequestError(502, 'Approvals temporarily unavailable');
        }
        return [];
      }),
      listConversations: vi.fn(async () =>
        activeUser.user.id === 'user-a' ? [CONVERSATION_USER_A] : [],
      ),
      listAutomations: vi.fn(async () => ({
        items: activeUser.user.id === 'user-a' ? [AUTOMATION_USER_A] : [],
        nextOffset: null,
      })),
      getAuditEvents: vi.fn(async () => ({
        events: activeUser.user.id === 'user-a' ? [AUDIT_USER_A] : [],
        total: activeUser.user.id === 'user-a' ? 1 : 0,
      })),
      getCalendarAgenda: vi.fn(async () => ({
        days: [{ events: activeUser.user.id === 'user-a' ? [CALENDAR_EVENT_USER_A] : [] }],
      })),
    });

    const controller = createWorkspaceSessionController({}, undefined, api);
    await controller.checkSession();
    expect(Object.keys(controller.getState().approvalsById)).toEqual(['appr-secret-user-a-001']);

    // Now switch directly to User B (same workspace ws-1) with a failing approvals refresh
    activeUser = USER_B_WS1;
    failApprovalsForUserB = true;
    await controller.checkSession();

    const stateUserB = controller.getState();
    expect(stateUserB.auth?.user.id).toBe('user-b');
    expect(stateUserB.identityKey).toBe('ws-1:user-b:viewer');
    expect(stateUserB.approvalsById).toEqual({});
    expect(stateUserB.conversations).toEqual([]);
    expect(stateUserB.automationsList).toEqual([]);
    expect(stateUserB.auditEvents).toEqual([]);
    expect(stateUserB.upcomingEvents).toEqual([]);

    const dashboardHtml = renderSessionMarkup(stateUserB, 'dashboard');
    expect(dashboardHtml).toContain('User Beta');
    expect(dashboardHtml).toContain('No pending approvals.');
    expect(dashboardHtml).toContain('No activity yet.');
    expect(dashboardHtml).toContain('No upcoming events.');
    expect(dashboardHtml).not.toContain('appr-secret-user-a-001');
    expect(dashboardHtml).not.toContain('automation.email.stage_workflow_artifact');
    expect(dashboardHtml).not.toContain('Confidential Board Acquisition Thread');
    expect(dashboardHtml).not.toContain('secret.vault.rotated');

    const settingsHtml = renderSessionMarkup(stateUserB, 'settings');
    expect(settingsHtml).toContain('No audit events recorded yet.');
    expect(settingsHtml).not.toContain('secret.vault.rotated');

    controller.dispose();
  });

  it('3. fails closed and clears existing approvals when a subsequent loadApprovalsMap refresh fails in-place', async () => {
    let shouldFail = false;
    const api = createMockSessionApi({
      listApprovals: vi.fn(async () => {
        if (shouldFail) {
          throw new ApiRequestError(503, 'Database timeout');
        }
        return [APPROVAL_USER_A];
      }),
    });

    const controller = createWorkspaceSessionController({}, undefined, api);
    await controller.checkSession();
    expect(Object.keys(controller.getState().approvalsById)).toEqual(['appr-secret-user-a-001']);

    // Subsequent refresh fails -> must clear stale approvals rather than retaining them
    shouldFail = true;
    await controller.loadApprovalsMap();
    expect(controller.getState().approvalsById).toEqual({});

    controller.dispose();
  });

  it('4. ignores delayed approval and calendar responses from User A that resolve after switching to User B', async () => {
    const delayedApprovalsUserA = createDeferred<ApprovalRequestItem[]>();
    const delayedAgendaUserA = createDeferred<{ days: Array<{ events: CalendarEvent[] }> }>();
    let activeUser: AuthState = USER_A_WS1;

    const api = createMockSessionApi({
      checkMe: vi.fn(async () => activeUser),
      listApprovals: vi.fn(async () => {
        if (activeUser.user.id === 'user-a') {
          return delayedApprovalsUserA.promise;
        }
        return [];
      }),
      getCalendarAgenda: vi.fn(async () => {
        if (activeUser.user.id === 'user-a') {
          return delayedAgendaUserA.promise;
        }
        return { days: [] };
      }),
      listConversations: vi.fn(async () => []),
      listAutomations: vi.fn(async () => ({ items: [], nextOffset: null })),
      getAuditEvents: vi.fn(async () => ({ events: [], total: 0 })),
    });

    const controller = createWorkspaceSessionController({}, undefined, api);

    // Start User A session load (blocks on delayedApprovalsUserA)
    const userASessionPromise = controller.checkSession();
    await Promise.resolve();
    await Promise.resolve();

    // User A logs out and User B logs in while User A requests are still in flight
    await controller.logout();
    activeUser = USER_B_WS1;
    await controller.checkSession();

    expect(controller.getState().auth?.user.id).toBe('user-b');
    expect(controller.getState().approvalsById).toEqual({});

    // Now resolve User A's late responses after User B is active
    delayedApprovalsUserA.resolve([APPROVAL_USER_A]);
    delayedAgendaUserA.resolve({ days: [{ events: [CALENDAR_EVENT_USER_A] }] });
    await userASessionPromise;

    const stateAfterLateResolve = controller.getState();
    expect(stateAfterLateResolve.auth?.user.id).toBe('user-b');
    expect(stateAfterLateResolve.approvalsById).toEqual({});
    expect(stateAfterLateResolve.upcomingEvents).toEqual([]);

    const html = renderSessionMarkup(stateAfterLateResolve, 'dashboard');
    expect(html).not.toContain('appr-secret-user-a-001');
    expect(html).not.toContain('Private CEO Compensation Committee');

    controller.dispose();
  });

  it('5. aborts in-flight AbortSignals when logging out while workspace requests are pending', async () => {
    const capturedSignals: AbortSignal[] = [];
    const pendingApprovals = createDeferred<ApprovalRequestItem[]>();

    const api = createMockSessionApi({
      listApprovals: vi.fn((signal?: AbortSignal) => {
        if (signal) capturedSignals.push(signal);
        return pendingApprovals.promise;
      }),
    });

    const controller = createWorkspaceSessionController({}, undefined, api);
    const checkPromise = controller.checkSession();

    // Wait until listApprovals is reached
    for (let i = 0; i < 10 && capturedSignals.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(capturedSignals.length).toBeGreaterThan(0);
    expect(capturedSignals[0]?.aborted).toBe(false);

    // Logout while listApprovals is still pending
    await controller.logout();
    expect(capturedSignals[0]?.aborted).toBe(true);

    // Resolving after abort must not populate state
    pendingApprovals.resolve([APPROVAL_USER_A]);
    await checkPromise;

    expect(controller.getState().auth).toBeNull();
    expect(controller.getState().approvalsById).toEqual({});

    controller.dispose();
  });

  it('6. isolates users across different workspaces (ws-1 -> ws-2) and filters mismatched workspace records both in controller and App render', async () => {
    let activeUser: AuthState = USER_A_WS1;
    const api = createMockSessionApi({
      checkMe: vi.fn(async () => activeUser),
      listApprovals: vi.fn(async () => [APPROVAL_USER_A, APPROVAL_USER_C_WS2]),
    });

    const controller = createWorkspaceSessionController({}, undefined, api);
    await controller.checkSession();

    // When User A (ws-1) is active, ws-2 approval is rejected
    expect(Object.keys(controller.getState().approvalsById)).toEqual(['appr-secret-user-a-001']);

    // Switch to User C (ws-2)
    activeUser = USER_C_WS2;
    await controller.checkSession();

    const stateUserC = controller.getState();
    expect(stateUserC.auth?.workspace.id).toBe('ws-2');
    expect(Object.keys(stateUserC.approvalsById)).toEqual(['appr-ws2-only-999']);

    // Also verify App render-time defense-in-depth filtering even if mixed props are passed
    const mixedPropsHtml = renderToStaticMarkup(
      <App
        initialAuth={USER_C_WS2}
        initialLoading={false}
        initialPage="dashboard"
        initialApprovals={[APPROVAL_USER_A, APPROVAL_USER_C_WS2]}
        initialConversations={[CONVERSATION_USER_A]}
        initialAuditEvents={[AUDIT_USER_A]}
      />,
    );

    expect(mixedPropsHtml).toContain('Workspace Gamma');
    expect(mixedPropsHtml).toContain('phone.briefing.prepare');
    expect(mixedPropsHtml).not.toContain('automation.email.stage_workflow_artifact');
    expect(mixedPropsHtml).not.toContain('Confidential Board Acquisition Thread');
    expect(mixedPropsHtml).not.toContain('secret.vault.rotated');

    controller.dispose();
  });

  it('7. transitions immediately to unauthenticated state and wipes sensitive data on 401/403 unauthorized API error', async () => {
    let return401OnApprovals = false;
    const api = createMockSessionApi({
      listApprovals: vi.fn(async () => {
        if (return401OnApprovals) {
          throw new ApiRequestError(401, 'Session expired');
        }
        return [APPROVAL_USER_A];
      }),
    });

    const controller = createWorkspaceSessionController({}, undefined, api);
    await controller.checkSession();
    expect(controller.getState().auth?.user.id).toBe('user-a');
    expect(Object.keys(controller.getState().approvalsById)).toEqual(['appr-secret-user-a-001']);

    return401OnApprovals = true;
    await controller.loadApprovalsMap();

    const stateAfter401 = controller.getState();
    expect(stateAfter401.auth).toBeNull();
    expect(stateAfter401.approvalsById).toEqual({});
    expect(stateAfter401.conversations).toEqual([]);
    expect(stateAfter401.automationsList).toEqual([]);
    expect(stateAfter401.auditEvents).toEqual([]);
    expect(stateAfter401.upcomingEvents).toEqual([]);

    controller.dispose();
  });
});
