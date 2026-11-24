import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import type { ApprovalRequestItem, AuditEventItem, AuthState, ConversationItem } from '../src/api';
import type { AutomationSummary } from '../src/automation-api';
import type { CalendarEvent } from '../src/calendar-api';
import {
  getPathForPage,
  isIntegrationPage,
  pushWorkspaceHistory,
  resolvePageFromLocation,
  shouldExpandIntegrations,
} from '../src/navigation';
import { buildActivityBuckets } from '../src/ui-primitives';

const MOCK_AUTH_OWNER: AuthState = {
  user: {
    id: 'user-owner-1',
    email: 'owner@quantumweave.com',
    displayName: 'Ananya Rao',
  },
  workspace: {
    id: 'ws-exec-1',
    name: 'Quantum Weave Executive',
    slug: 'quantum-weave-exec',
  },
  membership: {
    id: 'mem-1',
    role: 'owner',
    status: 'active',
  },
};

const MOCK_AUTH_VIEWER: AuthState = {
  ...MOCK_AUTH_OWNER,
  user: {
    id: 'user-viewer-2',
    email: 'viewer@quantumweave.com',
    displayName: 'Viewer Analyst',
  },
  membership: {
    id: 'mem-2',
    role: 'viewer',
    status: 'active',
  },
};

const SAMPLE_CONVERSATIONS: ConversationItem[] = [
  {
    id: 'conv-1',
    workspace_id: 'ws-exec-1',
    user_id: 'user-owner-1',
    title: 'Q4 Board Prep <script>alert(1)</script>',
    status: 'active',
    created_at: '2026-10-21T09:00:00.000Z',
    updated_at: '2026-10-22T09:30:00.000Z',
  },
];

const SAMPLE_AUTOMATIONS: AutomationSummary[] = [
  {
    id: 'plan-1',
    title: 'Executive Morning Briefing Blueprint',
    status: 'awaiting_approval',
    display_status: 'awaiting_approval',
    created_at: '2026-10-22T08:00:00.000Z',
    updated_at: '2026-10-22T08:15:00.000Z',
  },
];

const SAMPLE_APPROVALS: ApprovalRequestItem[] = [
  {
    id: 'appr-pending-1',
    workspaceId: 'ws-exec-1',
    requesterUserId: 'user-viewer-2',
    approverUserId: null,
    actionName: 'automation.email.stage_workflow_artifact',
    actionParams: { workflowName: 'Board Digest' },
    parameterHash: 'a'.repeat(64),
    riskLevel: 'medium',
    status: 'pending',
    decisionReason: null,
    expiresAt: '2099-12-31T08:00:00.000Z',
    decidedAt: null,
    createdAt: '2026-10-22T08:05:00.000Z',
    updatedAt: '2026-10-22T08:05:00.000Z',
  },
];

const SAMPLE_EVENTS: CalendarEvent[] = [
  {
    id: 'evt-1',
    calendarId: 'primary',
    summary: 'Series B Partner Sync <img src=x onerror=alert(1)>',
    description: 'Discuss Q4 ARR metrics',
    location: 'Boardroom A',
    startAt: '2026-10-22T11:00:00Z',
    endAt: '2026-10-22T12:00:00Z',
    timeZone: 'UTC',
    allDay: false,
    status: 'confirmed',
    attendees: [],
    untrusted: true,
    mode: 'mock',
  },
];

const SAMPLE_AUDIT: AuditEventItem[] = [
  {
    id: 'aud-1',
    action: 'phone.briefing.prepared',
    targetType: 'phone_telephony_connection',
    createdAt: '2026-10-22T09:00:00.000Z',
  },
];

describe('Canvas Blue Redesign & Executive Workspace Architecture', () => {
  it('1. loads Dashboard as the default authenticated page without dumping all screens onto one page', () => {
    const html = renderToStaticMarkup(
      <App
        initialAuth={MOCK_AUTH_OWNER}
        initialLoading={false}
        initialConversations={SAMPLE_CONVERSATIONS}
        initialAutomations={SAMPLE_AUTOMATIONS}
        initialApprovals={SAMPLE_APPROVALS}
        initialUpcomingEvents={SAMPLE_EVENTS}
        initialAuditEvents={SAMPLE_AUDIT}
        initialCalendarMode="mock"
      />,
    );

    expect(html).toContain('data-testid="dashboard-page"');
    expect(html).toContain('Your executive workspace at a glance.');
    expect(html).toContain('Total Conversations');
    expect(html).not.toContain('Active / Pending Automations');
    expect(html).not.toContain('data-testid="kpi-active-automations"');
    expect(html).not.toContain('data-testid="quick-action-manage-automations"');
    expect(html).toContain('data-testid="quick-action-open-bulk-campaign"');
    expect(html).not.toContain('All Automations');
    expect(html).toContain('Pending Approvals');
    expect(html).toContain('Upcoming Calendar Events');
    // Dedicated pages must not be rendered simultaneously on the Dashboard
    expect(html).not.toContain('data-testid="gmail-page"');
    expect(html).not.toContain('data-testid="whatsapp-page"');
    expect(html).not.toContain('data-testid="phone-page"');
    expect(html).not.toContain('data-testid="calendar-page"');
  });

  it('2 & 3. renders THAARA AI sidebar navigation and keeps Integrations submenu expanded properly', () => {
    const expandedHtml = renderToStaticMarkup(
      <App
        initialAuth={MOCK_AUTH_OWNER}
        initialLoading={false}
        initialPage="dashboard"
        initialIntegrationsExpanded={true}
      />,
    );

    expect(expandedHtml).toContain('THAARA AI');
    expect(expandedHtml).toContain('Executive Intelligence Workspace');
    expect(expandedHtml).toContain('data-testid="nav-item-dashboard"');
    expect(expandedHtml).toContain('data-testid="nav-item-new-conversation"');
    expect(expandedHtml).toContain('data-testid="nav-item-conversation-history"');
    expect(expandedHtml).not.toContain('data-testid="nav-item-automations"');
    expect(expandedHtml).toContain('data-testid="nav-item-bulk-campaign"');
    expect(expandedHtml).toContain('data-testid="nav-integrations-submenu"');
    expect(expandedHtml).toContain('data-testid="nav-item-gmail"');
    expect(expandedHtml).toContain('data-testid="nav-item-whatsapp"');
    expect(expandedHtml).toContain('data-testid="nav-item-phone"');
    expect(expandedHtml).toContain('data-testid="nav-item-calendar"');
    expect(expandedHtml).toContain('data-testid="nav-item-drive"');
    expect(expandedHtml).toContain('data-testid="nav-item-settings"');

    // When Integrations is collapsed on Dashboard, submenu hides
    const collapsedSubmenuHtml = renderToStaticMarkup(
      <App
        initialAuth={MOCK_AUTH_OWNER}
        initialLoading={false}
        initialPage="dashboard"
        initialIntegrationsExpanded={false}
      />,
    );
    expect(collapsedSubmenuHtml).not.toContain('data-testid="nav-integrations-submenu"');

    // When a child integration page is active, parent submenu stays expanded even if manual flag was false
    expect(shouldExpandIntegrations('gmail', false)).toBe(true);
    expect(shouldExpandIntegrations('whatsapp', false)).toBe(true);
    expect(shouldExpandIntegrations('phone', false)).toBe(true);
    expect(shouldExpandIntegrations('calendar', false)).toBe(true);
    expect(isIntegrationPage('phone')).toBe(true);
    expect(isIntegrationPage('dashboard')).toBe(false);
  });

  it('4, 5, 6, 7. renders dedicated Gmail, WhatsApp, Phone, and Calendar integration pages', () => {
    const gmailHtml = renderToStaticMarkup(
      <App initialAuth={MOCK_AUTH_OWNER} initialLoading={false} initialPage="gmail" />,
    );
    expect(gmailHtml).toContain('data-testid="gmail-page"');
    expect(gmailHtml).toContain('Gmail Integration');
    expect(gmailHtml).toContain('Refresh Gmail');

    const whatsappHtml = renderToStaticMarkup(
      <App initialAuth={MOCK_AUTH_OWNER} initialLoading={false} initialPage="whatsapp" />,
    );
    expect(whatsappHtml).toContain('data-testid="whatsapp-page"');
    expect(whatsappHtml).toContain('WhatsApp Business');
    expect(whatsappHtml).toContain('Refresh WhatsApp');

    const phoneHtml = renderToStaticMarkup(
      <App initialAuth={MOCK_AUTH_OWNER} initialLoading={false} initialPage="phone" />,
    );
    expect(phoneHtml).toContain('data-testid="phone-page"');
    expect(phoneHtml).toContain('data-testid="phone-call-page"');
    expect(phoneHtml).toContain('Who should Thaara call?');
    expect(phoneHtml).toContain('What should Thaara ask?');
    expect(phoneHtml).not.toContain('Language');
    expect(phoneHtml).toContain('data-testid="nav-item-phone-contacts"');
    expect(phoneHtml).toContain('data-testid="nav-item-phone-history"');

    const calendarHtml = renderToStaticMarkup(
      <App initialAuth={MOCK_AUTH_OWNER} initialLoading={false} initialPage="calendar" />,
    );
    expect(calendarHtml).toContain('data-testid="calendar-page"');
    expect(calendarHtml).toContain('Google Calendar');
    expect(calendarHtml).toContain('Refresh Calendar');
  });

  it('8. renders dedicated New Conversation chat experience and Conversation History page', () => {
    const chatHtml = renderToStaticMarkup(
      <App
        initialAuth={MOCK_AUTH_OWNER}
        initialLoading={false}
        initialPage="new-conversation"
        initialConversations={SAMPLE_CONVERSATIONS}
        initialSelectedConversationId="conv-1"
      />,
    );
    expect(chatHtml).toContain('data-testid="chat-page"');
    expect(chatHtml).toContain('data-testid="chat-composer-form"');
    expect(chatHtml).toContain('Summarize my recent calls');
    // Must not claim live voice calling or microphone activation
    expect(chatHtml).not.toContain('Start Voice Call');

    const historyHtml = renderToStaticMarkup(
      <App
        initialAuth={MOCK_AUTH_OWNER}
        initialLoading={false}
        initialPage="conversation-history"
        initialConversations={SAMPLE_CONVERSATIONS}
      />,
    );
    expect(historyHtml).toContain('data-testid="conversation-history-page"');
    expect(historyHtml).toContain('Conversation History');
    expect(historyHtml).toContain('Active Thread');
  });

  it('9. restores Bulk Campaigns UI while keeping Automations and Settings n8n Connection UI hidden, preserving Settings diagnostics, Audit Ledger, and role-gated approval controls', () => {
    const automationsHtml = renderToStaticMarkup(
      <App initialAuth={MOCK_AUTH_OWNER} initialLoading={false} initialPage="automations" />,
    );
    expect(automationsHtml).toContain('data-testid="not-found-page"');
    expect(automationsHtml).not.toContain('data-testid="automations-page"');
    expect(automationsHtml).not.toContain('Automation Management');

    const bulkCampaignHtml = renderToStaticMarkup(
      <App initialAuth={MOCK_AUTH_OWNER} initialLoading={false} initialPage="bulk-campaign" />,
    );
    expect(bulkCampaignHtml).toContain('data-testid="bulk-campaign-page"');
    expect(bulkCampaignHtml).toContain('Thaara Bulk Campaign Agent');
    expect(bulkCampaignHtml).not.toContain('data-testid="not-found-page"');

    const settingsHtml = renderToStaticMarkup(
      <App
        initialAuth={MOCK_AUTH_OWNER}
        initialLoading={false}
        initialPage="settings"
        initialAuditEvents={SAMPLE_AUDIT}
      />,
    );
    expect(settingsHtml).toContain('data-testid="settings-page"');
    expect(settingsHtml).toContain('Customizations / Settings');
    expect(settingsHtml).not.toContain('n8n connection');
    expect(settingsHtml).not.toContain('Approved server profile');
    expect(settingsHtml).not.toContain('Use server profile');
    expect(settingsHtml).not.toContain('Local disconnect');
    expect(settingsHtml).not.toContain('Refresh connection');
    expect(settingsHtml).not.toContain('n8n shows this workspace');
    expect(settingsHtml).toContain('Connector diagnostics');
    expect(settingsHtml).toContain('Tenant Audit Ledger');
    expect(settingsHtml).toContain('phone.briefing.prepared');

    // Viewer cannot approve pending approval gates on Dashboard
    const viewerDashboardHtml = renderToStaticMarkup(
      <App
        initialAuth={MOCK_AUTH_VIEWER}
        initialLoading={false}
        initialPage="dashboard"
        initialApprovals={SAMPLE_APPROVALS}
      />,
    );
    expect(viewerDashboardHtml).toContain('Only workspace owners and admins can approve or reject requests.');
    expect(viewerDashboardHtml).not.toContain('>Approve</button>');
  });

  it('10. resolves deep links, page refresh paths, hidden feature routes, and unknown route fallback accurately', () => {
    expect(resolvePageFromLocation('/')).toBe('dashboard');
    expect(resolvePageFromLocation('/dashboard')).toBe('dashboard');
    expect(resolvePageFromLocation('/chat')).toBe('new-conversation');
    expect(resolvePageFromLocation('/history')).toBe('conversation-history');
    expect(resolvePageFromLocation('/automations')).toBe('not-found');
    expect(resolvePageFromLocation('/integrations/bulk-campaign')).toBe('bulk-campaign');
    expect(resolvePageFromLocation('/bulk-campaign')).toBe('bulk-campaign');
    expect(resolvePageFromLocation('/bulk-campaigns')).toBe('bulk-campaign');
    expect(resolvePageFromLocation('/integrations/gmail')).toBe('gmail');
    expect(resolvePageFromLocation('/integrations/whatsapp')).toBe('whatsapp');
    expect(resolvePageFromLocation('/integrations/phone')).toBe('phone');
    expect(resolvePageFromLocation('/integrations/phone/contacts')).toBe('phone-contacts');
    expect(resolvePageFromLocation('/integrations/phone/history/')).toBe('phone-history');
    expect(resolvePageFromLocation('/integrations/phone/inbound')).toBe('phone-inbound');
    expect(resolvePageFromLocation('/integrations/phone/outbound')).toBe('phone-outbound');
    expect(resolvePageFromLocation('/integrations/calendar')).toBe('calendar');
    expect(resolvePageFromLocation('/integrations/drive')).toBe('drive');
    expect(resolvePageFromLocation('/settings')).toBe('settings');
    expect(resolvePageFromLocation('/customizations')).toBe('settings');
    expect(resolvePageFromLocation('/non-existent-route')).toBe('not-found');

    expect(getPathForPage('dashboard')).toBe('/dashboard');
    expect(getPathForPage('phone')).toBe('/integrations/phone');
    expect(getPathForPage('phone-contacts')).toBe('/integrations/phone/contacts');
    expect(getPathForPage('phone-history')).toBe('/integrations/phone/history');
    expect(() => pushWorkspaceHistory('dashboard')).not.toThrow();

    const notFoundHtml = renderToStaticMarkup(
      <App initialAuth={MOCK_AUTH_OWNER} initialLoading={false} initialPage="not-found" />,
    );
    expect(notFoundHtml).toContain('data-testid="not-found-page"');
    expect(notFoundHtml).toContain('Return to Dashboard');
  });

  it('11. protects unauthorized access and never leaks workspace data when unauthenticated', () => {
    const unauthHtml = renderToStaticMarkup(
      <App
        initialAuth={null}
        initialLoading={false}
        initialConversations={SAMPLE_CONVERSATIONS}
        initialAuditEvents={SAMPLE_AUDIT}
      />,
    );
    expect(unauthHtml).toContain('data-testid="auth-screen"');
    expect(unauthHtml).toContain('Sign In');
    expect(unauthHtml).toContain('Bootstrap Owner');
    expect(unauthHtml).not.toContain('data-testid="thaara-sidebar"');
    expect(unauthHtml).not.toContain('Quantum Weave Executive');
    expect(unauthHtml).not.toContain('Q4 Board Prep');
  });

  it('12 & 13. shows truthful empty states ("No activity yet."), DEMO / MOCK labels, and escapes untrusted text', () => {
    const emptyDashboardHtml = renderToStaticMarkup(
      <App
        initialAuth={MOCK_AUTH_OWNER}
        initialLoading={false}
        initialPage="dashboard"
        initialConversations={[]}
        initialAutomations={[]}
        initialApprovals={[]}
        initialUpcomingEvents={[]}
        initialAuditEvents={[]}
        initialCalendarMode="mock"
      />,
    );

    expect(emptyDashboardHtml).toContain('No activity yet.');
    expect(emptyDashboardHtml).toContain('DEMO / MOCK');

    const populatedHtml = renderToStaticMarkup(
      <App
        initialAuth={MOCK_AUTH_OWNER}
        initialLoading={false}
        initialPage="dashboard"
        initialConversations={SAMPLE_CONVERSATIONS}
        initialUpcomingEvents={SAMPLE_EVENTS}
        initialCalendarMode="mock"
      />,
    );
    expect(populatedHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(populatedHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(populatedHtml).not.toContain('<script>alert(1)</script>');

    const buckets = buildActivityBuckets(
      7,
      SAMPLE_CONVERSATIONS,
      SAMPLE_AUTOMATIONS,
      SAMPLE_AUDIT,
      new Date('2026-10-22T12:00:00Z'),
    );
    expect(buckets).toHaveLength(7);
    const totalCount = buckets.reduce(
      (sum, b) => sum + b.conversations + b.automations + b.auditEvents,
      0,
    );
    expect(totalCount).toBe(3);
  });

  it('14. supports collapsed sidebar accessibility attributes and mobile drawer controls', () => {
    const collapsedSidebarHtml = renderToStaticMarkup(
      <App
        initialAuth={MOCK_AUTH_OWNER}
        initialLoading={false}
        initialPage="dashboard"
        initialSidebarCollapsed={true}
      />,
    );
    expect(collapsedSidebarHtml).toContain('app-sidebar collapsed');
    expect(collapsedSidebarHtml).toContain('aria-label="Expand sidebar"');
    expect(collapsedSidebarHtml).toContain('aria-current="page"');
    expect(collapsedSidebarHtml).toContain('data-testid="mobile-menu-toggle"');
  });
});
