import React from 'react';
import {
  NAV_ITEMS,
  WorkspacePageId,
  isIntegrationPage,
  shouldExpandIntegrations,
} from './navigation';

/* ============================================================
   DISTINCTIVE THAARA AI BRAND MARK & LUCIDE-STYLE SVG ICONS
   ============================================================ */

export function ThaaraBrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <path d="M3 17.5h7M6.5 14v7" />
    </svg>
  );
}

export function NavIcon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
     style: { flexShrink: 0 },
  };

  switch (name) {
    case 'dashboard':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case 'new-conversation':
      return (
        <svg {...common}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M12 7v6M9 10h6" />
        </svg>
      );
    case 'conversation-history':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'automations':
      return (
        <svg {...common}>
          <rect x="2" y="4" width="6" height="6" rx="1" />
          <rect x="16" y="4" width="6" height="6" rx="1" />
          <rect x="9" y="14" width="6" height="6" rx="1" />
          <path d="M8 7h8M12 7v7" />
        </svg>
      );
    case 'integrations':
      return (
        <svg {...common}>
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      );
    case 'gmail':
      return (
        <svg {...common}>
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg {...common}>
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          <path d="M9.5 9.5c.3 1.8 1.7 3.2 3.5 3.5l1.2-1.2" />
        </svg>
      );
    case 'phone':
      return (
        <svg {...common}>
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.58 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      );
    case 'drive':
      return (
        <svg {...common}>
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
        </svg>
      );
    case 'bulk-campaign':
      return (
        <svg {...common}>
          <path d="M3 11l18-5v12L3 14v-3z" />
          <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
        </svg>
      );
    case 'bulk-campaign-create':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <path d="M10 7v6M7 10h6" />
        </svg>
      );
    case 'bulk-campaign-history':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.02 1.41 1.09H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case 'approvals':
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
  }
}

/* ============================================================
   REUSABLE ENTERPRISE UI PRIMITIVES
   ============================================================ */

export function StatusIndicator({
  label,
  tone = 'neutral',
  testId,
}: {
  label: string;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  testId?: string;
}) {
  const badgeClass =
    tone === 'success'
      ? 'badge badge-success'
      : tone === 'warning'
        ? 'badge badge-warning'
        : tone === 'danger'
          ? 'badge badge-danger'
          : tone === 'info'
            ? 'badge badge-info'
            : 'badge';

  return (
    <span className={badgeClass} data-testid={testId}>
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'currentColor',
          display: 'inline-block',
        }}
      />
      {label}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-header" data-testid="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          {actions}
        </div>
      )}
    </div>
  );
}

export function StatCard({
  label,
  value,
  meta,
  iconName,
  onClick,
  testId,
}: {
  label: string;
  value: string | number;
  meta: string;
  iconName: string;
  onClick?: () => void;
  testId?: string;
}) {
  return (
    <article
      className="stat-card"
      data-testid={testId}
      style={onClick ? { cursor: 'pointer' } : undefined}
      onClick={onClick}
    >
      <div className="stat-card-header">
        <span>{label}</span>
        <span className="stat-card-icon">
          <NavIcon name={iconName} size={17} />
        </span>
      </div>
      <div className="stat-card-value">{value}</div>
      <div className="stat-card-meta">{meta}</div>
    </article>
  );
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  testId,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        padding: '1.75rem 1.25rem',
        textAlign: 'center',
        background: 'var(--surface-muted)',
        border: '1px dashed var(--border-color)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.3rem' }}>
        {title}
      </p>
      <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: actionLabel ? '0.9rem' : 0 }}>
        {description}
      </p>
      {actionLabel && onAction && (
        <button type="button" className="btn btn-secondary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function LoadingState({ label = 'Loading workspace data…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '1.5rem',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        fontSize: '0.9rem',
      }}
    >
      {label}
    </div>
  );
}

export interface ActivityBucket {
  label: string;
  dateKey: string;
  conversations: number;
  automations: number;
  auditEvents: number;
}

export function buildActivityBuckets(
  daysCount: 7 | 30,
  conversations: ReadonlyArray<{ created_at?: string; updated_at?: string }>,
  automations: ReadonlyArray<{ created_at?: string; updated_at?: string }>,
  auditEvents: ReadonlyArray<{ createdAt?: string }>,
  referenceNow = new Date(),
): ActivityBucket[] {
  const buckets: ActivityBucket[] = [];
  const mapByDate = new Map<string, ActivityBucket>();

  for (let i = daysCount - 1; i >= 0; i -= 1) {
    const d = new Date(referenceNow);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const bucket: ActivityBucket = {
      label,
      dateKey: key,
      conversations: 0,
      automations: 0,
      auditEvents: 0,
    };
    buckets.push(bucket);
    mapByDate.set(key, bucket);
  }

  for (const c of conversations) {
    const raw = c.updated_at || c.created_at;
    if (!raw) continue;
    const key = raw.slice(0, 10);
    const b = mapByDate.get(key);
    if (b) b.conversations += 1;
  }

  for (const a of automations) {
    const raw = a.updated_at || a.created_at;
    if (!raw) continue;
    const key = raw.slice(0, 10);
    const b = mapByDate.get(key);
    if (b) b.automations += 1;
  }

  for (const ev of auditEvents) {
    if (!ev.createdAt) continue;
    const key = ev.createdAt.slice(0, 10);
    const b = mapByDate.get(key);
    if (b) b.auditEvents += 1;
  }

  return buckets;
}

export function ChartCard({
  title,
  subtitle,
  buckets,
  windowDays,
  onChangeWindowDays,
  loading,
  error,
  showAutomations = true,
}: {
  title: string;
  subtitle: string;
  buckets: ActivityBucket[];
  windowDays: 7 | 30;
  onChangeWindowDays: (days: 7 | 30) => void;
  loading?: boolean;
  error?: string | null;
  showAutomations?: boolean;
}) {
  const totalConv = buckets.reduce((acc, b) => acc + b.conversations, 0);
  const totalAuto = showAutomations ? buckets.reduce((acc, b) => acc + b.automations, 0) : 0;
  const totalAudit = buckets.reduce((acc, b) => acc + b.auditEvents, 0);
  const grandTotal = totalConv + totalAuto + totalAudit;
  const maxDayTotal = Math.max(
    1,
    ...buckets.map(
      (b) => b.conversations + (showAutomations ? b.automations : 0) + b.auditEvents,
    ),
  );

  return (
    <section className="card" aria-labelledby="dashboard-chart-heading" data-testid="activity-chart-card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '1rem',
        }}
      >
        <div>
          <h2 id="dashboard-chart-heading" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
            {title}
          </h2>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', margin: 0 }}>
            {subtitle}
          </p>
        </div>

        <div
          role="group"
          aria-label="Activity chart time window"
          style={{ display: 'flex', gap: '0.35rem' }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            aria-pressed={windowDays === 7}
            onClick={() => onChangeWindowDays(7)}
            style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
          >
            7 Days
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            aria-pressed={windowDays === 30}
            onClick={() => onChangeWindowDays(30)}
            style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}
          >
            30 Days
          </button>
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          gap: '1.25rem',
          flexWrap: 'wrap',
          fontSize: '0.78rem',
          color: 'var(--text-secondary)',
          marginBottom: '1rem',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <span
            aria-hidden="true"
            style={{ width: 10, height: 10, borderRadius: 2, background: '#2563EB', display: 'inline-block' }}
          />
          Conversations ({totalConv})
        </span>
        {showAutomations && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
            <span
              aria-hidden="true"
              style={{ width: 10, height: 10, borderRadius: 2, background: '#60A5FA', display: 'inline-block' }}
            />
            Automations ({totalAuto})
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <span
            aria-hidden="true"
            style={{ width: 10, height: 10, borderRadius: 2, background: '#CBD5E1', display: 'inline-block' }}
          />
          Audit Events ({totalAudit})
        </span>
      </div>

      {loading ? (
        <LoadingState label="Loading authorized activity metrics…" />
      ) : error ? (
        <div className="error-banner" role="alert">
          {error}
        </div>
      ) : grandTotal === 0 ? (
        <EmptyState
          testId="activity-chart-empty"
          title="No activity yet."
          description={
            showAutomations
              ? `No persisted conversations, automations, or audit events recorded in the last ${windowDays} days.`
              : `No persisted conversations or audit events recorded in the last ${windowDays} days.`
          }
        />
      ) : (
        <div>
          <p
            className="automation-muted"
            style={{ marginBottom: '0.6rem', fontSize: '0.78rem' }}
          >
            {showAutomations
              ? `Accessible summary: ${totalConv} conversations, ${totalAuto} automation plans, and ${totalAudit} audit events recorded across ${windowDays} days.`
              : `Accessible summary: ${totalConv} conversations and ${totalAudit} audit events recorded across ${windowDays} days.`}
          </p>
          <div
            role="img"
            aria-label={
              showAutomations
                ? `Workspace activity bar chart over ${windowDays} days showing ${totalConv} conversations, ${totalAuto} automations, and ${totalAudit} audit events`
                : `Workspace activity bar chart over ${windowDays} days showing ${totalConv} conversations and ${totalAudit} audit events`
            }
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
              alignItems: 'end',
              gap: windowDays === 7 ? '0.65rem' : '0.2rem',
              height: '168px',
              padding: '0.75rem 0.5rem 0.25rem',
              borderBottom: '1px solid var(--border-color)',
            }}
          >
            {buckets.map((bucket) => {
              const dayTotal =
                bucket.conversations +
                (showAutomations ? bucket.automations : 0) +
                bucket.auditEvents;
              const totalHeightPct = Math.max(dayTotal > 0 ? 10 : 2, Math.round((dayTotal / maxDayTotal) * 100));
              return (
                <div
                  key={bucket.dateKey}
                  title={
                    showAutomations
                      ? `${bucket.label}: ${bucket.conversations} conversations, ${bucket.automations} automations, ${bucket.auditEvents} audit events`
                      : `${bucket.label}: ${bucket.conversations} conversations, ${bucket.auditEvents} audit events`
                  }
                  style={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  <div
                    style={{
                      width: '100%',
                      maxWidth: windowDays === 7 ? '34px' : '12px',
                      height: `${totalHeightPct}%`,
                      borderRadius: '5px 5px 2px 2px',
                      background: dayTotal > 0 ? 'var(--brand-blue)' : 'var(--surface-muted)',
                      border: dayTotal > 0 ? '1px solid var(--brand-blue-hover)' : '1px solid var(--border-color)',
                      transition: 'height 0.2s ease',
                    }}
                  />
                  {(windowDays === 7 || bucket.dateKey.endsWith('01') || bucket.dateKey.endsWith('15')) && (
                    <span
                      style={{
                        fontSize: '0.68rem',
                        color: 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {bucket.label}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/* ============================================================
   PROFESSIONAL COLLAPSIBLE SIDEBAR & APP SHELL
   ============================================================ */

export interface SidebarProps {
  activePage: WorkspacePageId;
  onSelectPage: (page: WorkspacePageId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  integrationsExpanded: boolean;
  onToggleIntegrations: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  workspaceName: string;
  userDisplayName: string;
  userEmail: string;
  userRole: string;
  pendingApprovalsCount: number;
  onSignOut: () => void;
}

export function Sidebar({
  activePage,
  onSelectPage,
  collapsed,
  onToggleCollapsed,
  integrationsExpanded,
  onToggleIntegrations,
  mobileOpen,
  onCloseMobile,
  workspaceName,
  userDisplayName,
  userEmail,
  userRole,
  pendingApprovalsCount,
  onSignOut,
}: SidebarProps) {
  const isSubmenuOpen = shouldExpandIntegrations(activePage, integrationsExpanded);
  const primaryItems = NAV_ITEMS.filter((i) => i.section === 'primary');
  const integrationItems = NAV_ITEMS.filter((i) => i.section === 'integrations' && !i.parent);
  const phoneChildren = NAV_ITEMS.filter((i) => i.parent === 'phone');
  const onPhoneChild = activePage === 'phone' || phoneChildren.some((i) => i.id === activePage);
  const [phoneMenuOpen, setPhoneMenuOpen] = React.useState(onPhoneChild);
  const phoneOpen = phoneMenuOpen || onPhoneChild;
  const bulkCampaignChildren = NAV_ITEMS.filter((i) => i.parent === 'bulk-campaign');
  const onBulkChild =
    activePage === 'bulk-campaign' || bulkCampaignChildren.some((i) => i.id === activePage);
  const [bulkMenuOpen, setBulkMenuOpen] = React.useState(onBulkChild);
  const bulkOpen = bulkMenuOpen || onBulkChild;
  const footerItems = NAV_ITEMS.filter((i) => i.section === 'footer');

  const handleNavClick = (page: WorkspacePageId) => {
    onSelectPage(page);
    onCloseMobile();
  };

  const initials = (userDisplayName || userEmail || 'T')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <>
      <div
        className={`mobile-backdrop ${mobileOpen ? 'open' : ''}`}
        onClick={onCloseMobile}
        aria-hidden="true"
      />
      <aside
        className={`app-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
        aria-label="Thaara AI workspace navigation"
        data-testid="thaara-sidebar"
      >
        <div className="sidebar-top">
          {/* Brand Header */}
          <div className="sidebar-brand-row">
            <div className="sidebar-brand">
              <span className="brand-mark" title="THAARA AI — Executive Intelligence Workspace">
                <ThaaraBrandMark size={20} />
              </span>
              {!collapsed && (
                <div className="brand-text">
                  <div className="brand-title-row">
                    <span className="brand-title">THAARA AI</span>
                    <span className="brand-version">V2</span>
                  </div>
                  <span className="brand-subtitle">Executive Intelligence Workspace</span>
                </div>
              )}
            </div>

            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              data-testid="sidebar-collapse-toggle"
            >
              {collapsed ? '»' : '«'}
            </button>
          </div>

          {/* Primary Navigation */}
          <nav className="sidebar-nav" aria-label="Primary navigation">
            {!collapsed && <div className="sidebar-section-label">Workspace</div>}

            {primaryItems.map((item) => {
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-item ${isActive ? 'active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={item.label}
                  title={collapsed ? item.label : undefined}
                  data-testid={`nav-item-${item.id}`}
                  onClick={() => handleNavClick(item.id)}
                >
                  <span className="sidebar-item-main">
                    <NavIcon name={item.id} />
                    {!collapsed && <span className="sidebar-item-label">{item.label}</span>}
                  </span>
                  {!collapsed && item.id === 'automations' && pendingApprovalsCount > 0 && (
                    <span className="badge badge-warning" title="Pending approval gates">
                      {pendingApprovalsCount}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Expandable Integrations Dropdown */}
            {!collapsed && <div className="sidebar-section-label">Connectors</div>}
            <button
              type="button"
              className={`sidebar-item ${isIntegrationPage(activePage) ? 'active' : ''}`}
              aria-expanded={isSubmenuOpen}
              aria-controls="sidebar-integrations-submenu"
              aria-label="Integrations"
              title={collapsed ? 'Integrations' : undefined}
              data-testid="nav-integrations-toggle"
              onClick={onToggleIntegrations}
            >
              <span className="sidebar-item-main">
                <NavIcon name="integrations" />
                {!collapsed && <span className="sidebar-item-label">Integrations</span>}
              </span>
              {!collapsed && (
                <span aria-hidden="true" style={{ fontSize: '0.75rem' }}>
                  {isSubmenuOpen ? '▾' : '▸'}
                </span>
              )}
            </button>

            {isSubmenuOpen && (
              <div
                id="sidebar-integrations-submenu"
                className={collapsed ? 'sidebar-nav' : 'sidebar-submenu'}
                role="group"
                aria-label="Integration pages"
                data-testid="nav-integrations-submenu"
              >
                {integrationItems.map((sub) => {
                  const isActive = activePage === sub.id;
                  const button = (
                    <button
                      key={sub.id}
                      type="button"
                      className={`${collapsed ? 'sidebar-item' : 'sidebar-subitem'} ${
                        isActive ? 'active' : ''
                      }`}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={sub.label}
                      title={collapsed ? sub.label : undefined}
                      data-testid={`nav-item-${sub.id}`}
                      onClick={() => handleNavClick(sub.id)}
                    >
                      <span className="sidebar-item-main">
                        <NavIcon name={sub.id} size={16} />
                        {!collapsed && <span className="sidebar-item-label">{sub.label}</span>}
                      </span>
                    </button>
                  );
                  if (sub.id === 'bulk-campaign' && bulkCampaignChildren.length > 0) {
                    return (
                      <React.Fragment key={sub.id}>
                        <div className="sidebar-phone-row">
                          <button
                            key={sub.id}
                            type="button"
                            className={`sidebar-item ${onBulkChild ? 'active' : ''}`}
                            aria-current={activePage === sub.id ? 'page' : undefined}
                            aria-label={sub.label}
                            title={collapsed ? sub.label : undefined}
                            data-testid={`nav-item-${sub.id}`}
                            onClick={() => {
                              setBulkMenuOpen(true);
                              handleNavClick(sub.id);
                            }}
                          >
                            <span className="sidebar-item-main">
                              <NavIcon name={sub.id} size={16} />
                              {!collapsed && <span className="sidebar-item-label">{sub.label}</span>}
                            </span>
                          </button>
                          {!collapsed && (
                            <button
                              type="button"
                              className="sidebar-phone-toggle"
                              aria-expanded={bulkOpen}
                              aria-controls="sidebar-bulk-campaign-submenu"
                              aria-label={bulkOpen ? 'Hide bulk campaign pages' : 'Show bulk campaign pages'}
                              data-testid="nav-bulk-campaign-toggle"
                              onClick={() => setBulkMenuOpen(!bulkOpen)}
                            >
                              <span aria-hidden="true">{bulkOpen ? '▾' : '▸'}</span>
                            </button>
                          )}
                        </div>
                        {(bulkOpen || collapsed) && (
                          <div
                            id="sidebar-bulk-campaign-submenu"
                            role="group"
                            aria-label="Bulk Campaigns pages"
                            className={collapsed ? undefined : 'sidebar-phone-submenu'}
                          >
                            {bulkCampaignChildren.map((child) => {
                              const childActive =
                                activePage === child.id ||
                                (activePage === 'bulk-campaign' && child.id === 'bulk-campaign-create');
                              return (
                                <button
                                  key={child.id}
                                  type="button"
                                  className={`${collapsed ? 'sidebar-item' : 'sidebar-subitem'} ${childActive ? 'active' : ''}`}
                                  aria-current={childActive ? 'page' : undefined}
                                  aria-label={child.label}
                                  title={collapsed ? child.label : undefined}
                                  data-testid={`nav-item-${child.id}`}
                                  onClick={() => handleNavClick(child.id)}
                                >
                                  <span className="sidebar-item-main">
                                    <NavIcon name={child.id} size={14} />
                                    {!collapsed && <span className="sidebar-item-label">{child.label}</span>}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  }
                  if (sub.id !== 'phone' || !phoneChildren.length) return button;
                  // Phone & Calls has its own dropdown: Contacts and Call history.
                  return (
                    <React.Fragment key={sub.id}>
                      <div className="sidebar-phone-row">
                        {button}
                        {!collapsed && (
                          <button
                            type="button"
                            className="sidebar-phone-toggle"
                            aria-expanded={phoneOpen}
                            aria-controls="sidebar-phone-submenu"
                            aria-label={phoneOpen ? 'Hide phone pages' : 'Show phone pages'}
                            data-testid="nav-phone-toggle"
                            onClick={() => setPhoneMenuOpen(!phoneOpen)}
                          >
                            <span aria-hidden="true">{phoneOpen ? '▾' : '▸'}</span>
                          </button>
                        )}
                      </div>
                      {(phoneOpen || collapsed) && (
                        <div id="sidebar-phone-submenu" role="group" aria-label="Phone pages" className={collapsed ? undefined : 'sidebar-phone-submenu'}>
                          {phoneChildren.map((child) => {
                            const childActive = activePage === child.id;
                            return (
                              <button
                                key={child.id}
                                type="button"
                                className={`${collapsed ? 'sidebar-item' : 'sidebar-subitem'} ${childActive ? 'active' : ''}`}
                                aria-current={childActive ? 'page' : undefined}
                                aria-label={child.label}
                                title={collapsed ? child.label : undefined}
                                data-testid={`nav-item-${child.id}`}
                                onClick={() => handleNavClick(child.id)}
                              >
                                <span className="sidebar-item-main">
                                  <NavIcon name="phone" size={14} />
                                  {!collapsed && <span className="sidebar-item-label">{child.label}</span>}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            )}

            {/* Customizations / Settings */}
            {!collapsed && <div className="sidebar-section-label">Administration</div>}
            {footerItems.map((item) => {
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-item ${isActive ? 'active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={item.label}
                  title={collapsed ? item.label : undefined}
                  data-testid={`nav-item-${item.id}`}
                  onClick={() => handleNavClick(item.id)}
                >
                  <span className="sidebar-item-main">
                    <NavIcon name={item.id} />
                    {!collapsed && <span className="sidebar-item-label">{item.label}</span>}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Workspace & User Profile Section */}
        <div className="sidebar-footer" data-testid="sidebar-footer">
          {!collapsed && (
            <div className="sidebar-workspace-pill">
              <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                Current Workspace
              </span>
              <strong style={{ fontSize: '0.84rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {workspaceName}
              </strong>
            </div>
          )}

          <div className="sidebar-user-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0 }}>
              <span className="sidebar-user-avatar" title={`${userDisplayName} (${userEmail})`}>
                {initials}
              </span>
              {!collapsed && (
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.83rem',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {userDisplayName}
                  </div>
                  <div
                    style={{
                      fontSize: '0.72rem',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {userEmail}
                  </div>
                </div>
              )}
            </div>
            {!collapsed && <span className="badge badge-success">{userRole}</span>}
          </div>

          <button
            type="button"
            onClick={onSignOut}
            className="btn btn-secondary"
            style={{ width: '100%', fontSize: '0.82rem', padding: '0.45rem 0.65rem' }}
            title="Sign Out"
            aria-label="Sign Out"
            data-testid="sidebar-signout-btn"
          >
            {collapsed ? '⎋' : 'Sign Out'}
          </button>
        </div>
      </aside>
    </>
  );
}

export function Topbar({
  workspaceName,
  userDisplayName,
  userRole,
  connectorModeLabel,
  onOpenMobileMenu,
  onNewConversation,
}: {
  workspaceName: string;
  userDisplayName: string;
  userRole: string;
  connectorModeLabel: string;
  onOpenMobileMenu: () => void;
  onNewConversation: () => void;
}) {
  return (
    <header className="app-topbar" data-testid="thaara-topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          data-testid="mobile-menu-toggle"
        >
          ☰
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {workspaceName}
          </span>
          <StatusIndicator label={connectorModeLabel} tone="info" testId="topbar-mode-indicator" />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span
          style={{
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <span>{userDisplayName}</span>
          <span className="badge badge-success">{userRole}</span>
        </span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onNewConversation}
          data-testid="topbar-new-conversation-btn"
          style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem' }}
        >
          + New Conversation
        </button>
      </div>
    </header>
  );
}

export function AppShell({
  sidebar,
  topbar,
  children,
}: {
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell" data-testid="thaara-app-shell">
      {sidebar}
      <div className="app-main-wrapper">
        {topbar}
        <main className="app-content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
