import { useState } from 'react';
import {
  ApprovalRequestItem,
  AuditEventItem,
  ConversationItem,
  canUserDecideApproval,
} from './api';
import { AutomationSummary } from './automation-api';
import { CalendarEvent, formatCalendarEventWindow } from './calendar-api';
import { UI_VISIBILITY, WorkspacePageId } from './navigation';
import {
  ChartCard,
  EmptyState,
  LoadingState,
  NavIcon,
  PageHeader,
  StatCard,
  StatusIndicator,
  buildActivityBuckets,
} from './ui-primitives';

export interface ConnectorSummaryItem {
  id: 'gmail' | 'whatsapp' | 'phone' | 'calendar';
  label: string;
  status: string;
  mode: 'mock' | 'disabled' | string;
  detail?: string;
}

export interface DashboardPageProps {
  workspaceName: string;
  userDisplayName: string;
  userId: string;
  userRole: string;
  conversations: ConversationItem[];
  automations: AutomationSummary[];
  approvals: ApprovalRequestItem[];
  auditEvents: AuditEventItem[];
  upcomingEvents: CalendarEvent[];
  calendarMode: 'mock' | 'disabled' | string;
  calendarTimeZone: string;
  connectorSummaries: ConnectorSummaryItem[];
  loading?: boolean;
  error?: string | null;
  decidingApprovalIds: Record<string, boolean>;
  onDecideApproval: (approvalId: string, decision: 'approved' | 'rejected') => void;
  onNavigate: (page: WorkspacePageId) => void;
  onSelectConversation: (conversationId: string) => void;
  formatTimestamp: (value?: string | null) => string;
}

export function DashboardPage({
  workspaceName,
  userDisplayName,
  userId,
  userRole,
  conversations,
  automations,
  approvals,
  auditEvents,
  upcomingEvents,
  calendarMode,
  calendarTimeZone,
  connectorSummaries,
  loading = false,
  error = null,
  decidingApprovalIds,
  onDecideApproval,
  onNavigate,
  onSelectConversation,
  formatTimestamp,
}: DashboardPageProps) {
  const [windowDays, setWindowDays] = useState<7 | 30>(7);

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const activeOrPendingAutomations = automations.filter((a) =>
    ['draft', 'queued', 'running', 'awaiting_approval', 'paused'].includes(a.display_status || a.status),
  );

  const buckets = buildActivityBuckets(
    windowDays,
    conversations,
    UI_VISIBILITY.automations ? automations : [],
    auditEvents,
  );

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        title="Dashboard"
        subtitle="Your executive workspace at a glance."
        actions={
          <>
            <span
              className="badge"
              style={{ textTransform: 'none', fontWeight: 500 }}
              data-testid="dashboard-workspace-badge"
            >
              {workspaceName} · {userDisplayName} ({userRole})
            </span>
            {connectorSummaries.map((conn) => {
              const isConnected = conn.status === 'connected';
              const isMock = conn.mode === 'mock';
              return (
                <StatusIndicator
                  key={conn.id}
                  testId={`dashboard-conn-${conn.id}`}
                  tone={isConnected ? 'success' : 'neutral'}
                  label={`${conn.label}: ${conn.status}${isMock ? ' (DEMO / MOCK)' : ''}`}
                />
              );
            })}
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onNavigate('new-conversation')}
              data-testid="dashboard-new-conversation-btn"
            >
              + New Conversation
            </button>
          </>
        }
      />

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {/* SECTION A — EXECUTIVE OVERVIEW (KPI CARDS) */}
      <section aria-label="Executive overview metrics" className="kpi-grid" data-testid="dashboard-kpi-grid">
        <StatCard
          testId="kpi-total-conversations"
          label="Total Conversations"
          value={conversations.length}
          meta={
            conversations.length === 0
              ? 'No conversations yet'
              : `${conversations.length} persisted thread${conversations.length === 1 ? '' : 's'}`
          }
          iconName="new-conversation"
          onClick={() => onNavigate('conversation-history')}
        />
        {UI_VISIBILITY.automations && (
          <StatCard
            testId="kpi-active-automations"
            label="Active / Pending Automations"
            value={activeOrPendingAutomations.length}
            meta={`${automations.length} total plan${automations.length === 1 ? '' : 's'} in workspace`}
            iconName="automations"
            onClick={() => onNavigate('automations')}
          />
        )}
        <StatCard
          testId="kpi-pending-approvals"
          label="Pending Approvals"
          value={pendingApprovals.length}
          meta={
            pendingApprovals.length === 0
              ? 'All approval gates clear'
              : 'Requires owner/admin review'
          }
          iconName="approvals"
          onClick={UI_VISIBILITY.automations ? () => onNavigate('automations') : undefined}
        />
        <StatCard
          testId="kpi-upcoming-events"
          label="Upcoming Calendar Events"
          value={upcomingEvents.length}
          meta={
            calendarMode === 'mock'
              ? 'Authorized schedule (DEMO / MOCK)'
              : 'Authorized calendar schedule'
          }
          iconName="calendar"
          onClick={() => onNavigate('calendar')}
        />
      </section>

      {/* SECTION B — ACTIVITY CHART & SECTION F — QUICK ACTIONS */}
      <div className="dashboard-two-col">
        <ChartCard
          title="Workspace Activity"
          subtitle={
            UI_VISIBILITY.automations
              ? 'Persisted conversations, governed automations, and tenant audit activity.'
              : 'Persisted conversations and tenant audit activity.'
          }
          buckets={buckets}
          windowDays={windowDays}
          onChangeWindowDays={setWindowDays}
          loading={loading}
          showAutomations={UI_VISIBILITY.automations}
        />

        <section className="card" aria-labelledby="quick-actions-heading" data-testid="dashboard-quick-actions">
          <div style={{ marginBottom: '1rem' }}>
            <h2 id="quick-actions-heading" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
              Quick Actions
            </h2>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
              Jump directly to governed executive tools and integrations.
            </p>
          </div>

          <div className="quick-actions-grid">
            <button
              type="button"
              className="quick-action-btn"
              onClick={() => onNavigate('new-conversation')}
              data-testid="quick-action-new-chat"
            >
              <NavIcon name="new-conversation" />
              <span>New Chat</span>
            </button>
            <button
              type="button"
              className="quick-action-btn"
              onClick={() => onNavigate('gmail')}
              data-testid="quick-action-open-gmail"
            >
              <NavIcon name="gmail" />
              <span>Open Gmail</span>
            </button>
            <button
              type="button"
              className="quick-action-btn"
              onClick={() => onNavigate('whatsapp')}
              data-testid="quick-action-open-whatsapp"
            >
              <NavIcon name="whatsapp" />
              <span>Open WhatsApp</span>
            </button>
            <button
              type="button"
              className="quick-action-btn"
              onClick={() => onNavigate('phone')}
              data-testid="quick-action-open-phone"
            >
              <NavIcon name="phone" />
              <span>Open Phone</span>
            </button>
            <button
              type="button"
              className="quick-action-btn"
              onClick={() => onNavigate('calendar')}
              data-testid="quick-action-view-calendar"
            >
              <NavIcon name="calendar" />
              <span>View Calendar</span>
            </button>
            {UI_VISIBILITY.bulkCampaigns && (
              <button
                type="button"
                className="quick-action-btn"
                onClick={() => onNavigate('bulk-campaign')}
                data-testid="quick-action-open-bulk-campaign"
              >
                <NavIcon name="bulk-campaign" />
                <span>Bulk Campaigns</span>
              </button>
            )}
            {UI_VISIBILITY.automations && (
              <button
                type="button"
                className="quick-action-btn"
                onClick={() => onNavigate('automations')}
                data-testid="quick-action-manage-automations"
              >
                <NavIcon name="automations" />
                <span>Manage Automations</span>
              </button>
            )}
          </div>
        </section>
      </div>

      {/* SECTION D — UPCOMING EVENTS & SECTION E — PENDING APPROVALS */}
      <div className="dashboard-equal-col">
        <section className="card" aria-labelledby="upcoming-events-heading" data-testid="dashboard-upcoming-events">
          <div className="automation-toolbar">
            <div>
              <h2 id="upcoming-events-heading" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                Upcoming Events
              </h2>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
                Authorized schedule overview
                {calendarMode === 'mock' ? ' · Labeled DEMO / MOCK synthetic events' : ''}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {calendarMode === 'mock' && (
                <span className="badge badge-warning" data-testid="dashboard-calendar-mock-badge">
                  DEMO / MOCK
                </span>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onNavigate('calendar')}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}
              >
                Open Calendar
              </button>
            </div>
          </div>

          {loading ? (
            <LoadingState label="Loading upcoming schedule…" />
          ) : upcomingEvents.length === 0 ? (
            <EmptyState
              testId="upcoming-events-empty"
              title="No upcoming events."
              description="No scheduled calendar events found in the current window."
              actionLabel="View Calendar"
              onAction={() => onNavigate('calendar')}
            />
          ) : (
            <ul style={{ listStyle: 'none', display: 'grid', gap: '0.55rem', margin: 0 }}>
              {upcomingEvents.slice(0, 4).map((ev) => (
                <li
                  key={ev.id}
                  style={{
                    padding: '0.75rem 0.9rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    background: 'var(--surface-muted)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      {ev.summary}
                    </strong>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {formatCalendarEventWindow(ev, calendarTimeZone)}
                      {ev.location ? ` · ${ev.location}` : ''}
                    </span>
                  </div>
                  <span className="badge badge-info">{ev.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card" aria-labelledby="pending-approvals-heading" data-testid="dashboard-pending-approvals">
          <div className="automation-toolbar">
            <div>
              <h2 id="pending-approvals-heading" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
                Pending Approvals
              </h2>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
                PolicyGateway approval gates requiring explicit owner or admin sign-off.
              </p>
            </div>
            {UI_VISIBILITY.automations && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onNavigate('automations')}
                style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}
              >
                All Automations
              </button>
            )}
          </div>

          {loading ? (
            <LoadingState label="Checking approval gates…" />
          ) : pendingApprovals.length === 0 ? (
            <EmptyState
              testId="pending-approvals-empty"
              title="No pending approvals."
              description={
                UI_VISIBILITY.automations
                  ? 'All governed automation steps are currently settled.'
                  : 'All approval gates are currently settled.'
              }
            />
          ) : (
            <ul style={{ listStyle: 'none', display: 'grid', gap: '0.65rem', margin: 0 }}>
              {pendingApprovals.map((app) => {
                const check = canUserDecideApproval(userRole, userId, app);
                const busy = Boolean(decidingApprovalIds[app.id]);
                return (
                  <li
                    key={app.id}
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--warning-border)',
                      background: 'var(--warning-bg)',
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
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                        {app.actionName}
                      </strong>
                      <span className="badge badge-warning">Risk: {app.riskLevel}</span>
                    </div>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.55rem' }}>
                      Approval ID: <code>{app.id}</code> · Requested {formatTimestamp(app.createdAt)}
                    </p>
                    {check.canDecide ? (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={busy}
                          onClick={() => onDecideApproval(app.id, 'approved')}
                          style={{ padding: '0.32rem 0.75rem', fontSize: '0.78rem' }}
                        >
                          {busy ? 'Submitting…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          disabled={busy}
                          onClick={() => onDecideApproval(app.id, 'rejected')}
                          style={{ padding: '0.32rem 0.75rem', fontSize: '0.78rem' }}
                        >
                          {busy ? 'Submitting…' : 'Reject'}
                        </button>
                      </div>
                    ) : (
                      <p style={{ fontSize: '0.76rem', color: 'var(--warning)', margin: 0 }}>
                        {check.reason || 'Only authorized workspace owners or admins can decide this approval.'}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* SECTION C — RECENT ACTIVITY */}
      <section className="card" aria-labelledby="recent-activity-heading" data-testid="dashboard-recent-activity">
        <div className="automation-toolbar">
          <div>
            <h2 id="recent-activity-heading" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
              Recent Activity
            </h2>
            <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
              {UI_VISIBILITY.automations
                ? 'Persisted conversations, automation updates, and tenant audit ledger events.'
                : 'Persisted conversations and tenant audit ledger events.'}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onNavigate('conversation-history')}
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}
          >
            Conversation History
          </button>
        </div>

        {loading ? (
          <LoadingState label="Loading recent workspace activity…" />
        ) : conversations.length === 0 &&
          (!UI_VISIBILITY.automations || automations.length === 0) &&
          auditEvents.length === 0 ? (
          <EmptyState
            testId="recent-activity-empty"
            title="No activity yet."
            description="Start a governed conversation or run an offline briefing to populate your workspace timeline."
            actionLabel="Start New Conversation"
            onAction={() => onNavigate('new-conversation')}
          />
        ) : (
          <div className="dashboard-equal-col" style={{ marginBottom: 0 }}>
            <div>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 600, marginBottom: '0.55rem' }}>
                Recent Conversations ({conversations.length})
              </h3>
              {conversations.length === 0 ? (
                <p className="automation-muted">No conversations recorded yet.</p>
              ) : (
                <ul style={{ listStyle: 'none', display: 'grid', gap: '0.45rem', margin: 0 }}>
                  {conversations.slice(0, 4).map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="automation-plan"
                        onClick={() => {
                          onSelectConversation(c.id);
                          onNavigate('new-conversation');
                        }}
                      >
                        <span>
                          <strong>{c.title}</strong>
                          <small>{formatTimestamp(c.updated_at || c.created_at)}</small>
                        </span>
                        <span className="badge badge-info">Open</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 style={{ fontSize: '0.92rem', fontWeight: 600, marginBottom: '0.55rem' }}>
                {UI_VISIBILITY.automations
                  ? `Recent Audit & Automation Events (${auditEvents.length})`
                  : `Recent Audit Events (${auditEvents.length})`}
              </h3>
              {auditEvents.length === 0 ? (
                <p className="automation-muted">No audit events recorded yet.</p>
              ) : (
                <ul style={{ listStyle: 'none', display: 'grid', gap: '0.45rem', margin: 0 }}>
                  {auditEvents.slice(0, 4).map((evt) => (
                    <li
                      key={evt.id}
                      style={{
                        padding: '0.65rem 0.85rem',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)',
                        background: 'var(--surface-muted)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <code style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {evt.action}
                        </code>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                          Target: {evt.targetType || 'workspace'}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {formatTimestamp(evt.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
