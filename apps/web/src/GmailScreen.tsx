import { useEffect, useRef, useState } from 'react';
import {
  GmailComposeInput,
  GmailComposeMode,
  GmailMailbox,
  GmailState,
  canConnectGmail,
  canDisconnectGmail,
  canReadGmail,
  canSendGmail,
  createGmailModel,
  deriveForwardDraft,
  deriveReplyDraft,
  initialGmailState,
  needsSendReconnect,
  searchedEmailAddress,
} from './gmail-model';
import {
  DEFAULT_WORKSPACE_TIMEZONE,
  EnrichedGmailMessage,
  EnrichedMailRow,
  GmailStatusFilter,
  GmailTypeFilter,
  classifyGmailMessage,
  extractEmailAddress,
  filterGmailRows,
  formatFriendlyDateTime,
} from './integration-ui';

const statuses = {
  not_configured: 'Not configured',
  disconnected: 'Disconnected',
  connected: 'Connected (mock)',
  reconnect_required: 'Reconnect required',
};

const MAILBOX_LABELS: Record<GmailMailbox, string> = {
  inbox: 'Inbox',
  all: 'All Mail',
  sent: 'Sent',
};

function formatGmailStatusBadgeText(state: GmailState): string {
  if (state.connecting) return 'Connecting';
  if (!state.status) return 'Unavailable';
  if (state.status.status === 'connected') {
    return state.status.mode === 'live' ? 'Connected (LIVE)' : 'Connected (mock)';
  }
  return statuses[state.status.status] ?? 'Unavailable';
}

export interface GmailScreenViewProps {
  state: GmailState;
  draft: string;
  onDraft: (value: string) => void;
  onSearch: () => void;
  onInbox: () => void;
  onBackToInbox?: () => void;
  onClearSearch?: () => void;
  onNext: () => void;
  onLoadMore?: () => void;
  onPrev?: () => void;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onDisconnect: () => void;
  onConnect?: () => void;
  onReconnect?: () => void;
  onMailbox?: (mailbox: GmailMailbox) => void;
  onOpenCompose?: (initial?: Partial<GmailComposeInput>, mode?: GmailComposeMode) => void;
  onReply?: () => void;
  onReplyAll?: () => void;
  onForward?: () => void;
  onCloseCompose?: () => void;
  onUpdateCompose?: (patch: Partial<GmailComposeInput>) => void;
  onSendEmail?: () => void;
  onConfirmSend?: () => void;
  onCancelSend?: () => void;
  onEditAgain?: () => void;
  onDiscardDraft?: () => void;
  typeFilter?: GmailTypeFilter;
  onTypeFilter?: (value: GmailTypeFilter) => void;
  statusFilter?: GmailStatusFilter;
  onStatusFilter?: (value: GmailStatusFilter) => void;
  timeZone?: string;
  nowMs?: number;
  userEmail?: string;
}

const smallBtn = { padding: '0.4rem 0.85rem', fontSize: '0.8rem' } as const;

export function GmailScreenView(p: GmailScreenViewProps) {
  const s = p.state;
  const ready = canReadGmail(s);
  const canSend = canSendGmail(s);
  const showSendReconnect = needsSendReconnect(s);
  const busy = s.connectionLoading || s.disconnecting || Boolean(s.connecting);
  const timeZone = p.timeZone ?? DEFAULT_WORKSPACE_TIMEZONE;
  const statusLabel = formatGmailStatusBadgeText(s);
  const canConnect = Boolean(p.onConnect && !busy && canConnectGmail(s));
  const mailbox: GmailMailbox = s.mailbox ?? 'inbox';

  const connectedAccountEmail =
    s.status?.connected && s.status.status === 'connected' && s.status.connectedEmail
      ? s.status.connectedEmail
      : null;
  const effectiveUserEmail = connectedAccountEmail ?? p.userEmail;

  const [localTypeFilter, setLocalTypeFilter] = useState<GmailTypeFilter>('all');
  const [localStatusFilter, setLocalStatusFilter] = useState<GmailStatusFilter>('all');

  // Local fallback so GmailScreenView can render a composer when used without a model (unit tests).
  const [localComposeOpen, setLocalComposeOpen] = useState<boolean>(false);
  const [localComposeMode, setLocalComposeMode] = useState<GmailComposeMode>('new');
  const [localComposeDraft, setLocalComposeDraft] = useState<GmailComposeInput>({
    to: '',
    cc: '',
    subject: '',
    bodyText: '',
  });

  const isComposeOpen = s.composeOpen ?? localComposeOpen;
  const activeComposeMode: GmailComposeMode = s.composeMode ?? localComposeMode;
  const activeComposeDraft = s.composeDraft ?? localComposeDraft;
  const composeStage = s.composeStage ?? 'editing';
  const pendingSend = s.pendingSend ?? null;
  const sendResult = s.sendResult ?? null;

  const handleOpenCompose = (initial?: Partial<GmailComposeInput>, mode: GmailComposeMode = 'new') => {
    if (p.onOpenCompose) {
      p.onOpenCompose(initial, mode);
    } else {
      setLocalComposeOpen(true);
      setLocalComposeMode(mode);
      if (initial) setLocalComposeDraft((prev) => ({ ...prev, ...initial }));
    }
  };
  const handleReply = () => {
    if (p.onReply) {
      p.onReply();
    } else if (s.preview) {
      const replyDraft = deriveReplyDraft(s.preview, connectedAccountEmail, false);
      handleOpenCompose(replyDraft, 'reply');
    }
  };
  const handleReplyAll = () => {
    if (p.onReplyAll) {
      p.onReplyAll();
    } else if (s.preview) {
      const replyDraft = deriveReplyDraft(s.preview, connectedAccountEmail, true);
      handleOpenCompose(replyDraft, 'reply_all');
    }
  };
  const handleForward = () => {
    if (p.onForward) {
      p.onForward();
    } else if (s.preview) {
      const forwardDraft = deriveForwardDraft(s.preview);
      handleOpenCompose(forwardDraft, 'forward');
    }
  };
  const handleCloseCompose = () => {
    if (p.onCloseCompose) p.onCloseCompose();
    else setLocalComposeOpen(false);
  };
  const handleUpdateCompose = (patch: Partial<GmailComposeInput>) => {
    if (p.onUpdateCompose) p.onUpdateCompose(patch);
    else setLocalComposeDraft((prev) => ({ ...prev, ...patch }));
  };
  const handleDiscardDraft = () => {
    if (p.onDiscardDraft) {
      p.onDiscardDraft();
    } else {
      setLocalComposeOpen(false);
      setLocalComposeMode('new');
      setLocalComposeDraft({ to: '', cc: '', subject: '', bodyText: '' });
    }
  };

  const activeTypeFilter = p.typeFilter ?? localTypeFilter;
  const activeStatusFilter = p.statusFilter ?? localStatusFilter;
  const handleTypeChange = (next: GmailTypeFilter) => {
    setLocalTypeFilter(next);
    p.onTypeFilter?.(next);
  };
  const handleStatusChange = (next: GmailStatusFilter) => {
    setLocalStatusFilter(next);
    p.onStatusFilter?.(next);
  };
  const handleBackToInbox = () => {
    handleTypeChange('all');
    handleStatusChange('all');
    p.onDraft('');
    if (p.onBackToInbox) {
      p.onBackToInbox();
    } else {
      p.onInbox();
    }
  };
  const handleClearSearch = () => {
    p.onDraft('');
    if (p.onClearSearch) {
      p.onClearSearch();
    } else if (p.onBackToInbox) {
      p.onBackToInbox();
    } else {
      p.onInbox();
    }
  };

  // Gmail's own search (POST /api/v1/connectors/gmail/messages/search) is authoritative for query matching;
  // only the UI dropdown filters (type and status) are applied locally, so valid provider results are never dropped.
  const filteredRows = filterGmailRows(s.rows as EnrichedMailRow[], {
    typeFilter: activeTypeFilter,
    statusFilter: activeStatusFilter,
    userEmail: effectiveUserEmail,
  });

  const searchedAddress = s.query ? searchedEmailAddress(s.query) : null;
  const showEmpty = s.searched && !s.listLoading && !s.listError && filteredRows.length === 0;
  const isSearch = Boolean(s.query && s.query !== 'in:inbox');
  const paneTitle = isSearch ? `Search results in ${MAILBOX_LABELS[mailbox]}` : MAILBOX_LABELS[mailbox];

  const statusBadgeClass =
    s.status?.status === 'connected'
      ? 'badge badge-success'
      : s.status?.status === 'disconnected'
        ? 'badge badge-danger'
        : 'badge badge-warning';

  const previewClassification = s.preview
    ? classifyGmailMessage(s.preview as EnrichedGmailMessage, effectiveUserEmail)
    : null;

  const resultBannerClass =
    sendResult?.kind === 'sent'
      ? 'badge badge-success'
      : sendResult?.kind === 'cancelled'
        ? 'badge badge-info'
        : 'badge badge-danger';

  return (
    <section className="integration-card" aria-labelledby="gmail-heading" data-testid="gmail-screen">
      {/* Compact 1-Row Header */}
      <div className="integration-header-bar">
        <div className="integration-header-left" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <h2 id="gmail-heading" className="integration-title">
            Gmail
          </h2>
          {!s.unauthorized && (
            <span className={statusBadgeClass} data-testid="gmail-status-badge">
              {statusLabel}
            </span>
          )}
          {!s.unauthorized && connectedAccountEmail && (
            <span
              className="badge badge-info"
              data-testid="gmail-connected-account"
              style={{ fontWeight: 500 }}
            >
              Connected as: {connectedAccountEmail}
            </span>
          )}
        </div>

        <div className="integration-header-actions" style={{ display: 'flex', gap: '0.5rem' }}>
          {ready && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => handleOpenCompose()}
              data-testid="gmail-new-email-btn"
              style={{ padding: '0.38rem 0.75rem', fontSize: '0.8rem' }}
            >
              + New Email
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={p.onRefresh}
            style={{ padding: '0.38rem 0.75rem', fontSize: '0.8rem' }}
          >
            Refresh Gmail
          </button>
        </div>
      </div>

      {s.unauthorized ? (
        <p role="alert" className="error-banner" data-testid="gmail-unauthorized-banner">
          Gmail access is unavailable. Sign in with an authorized workspace account.
        </p>
      ) : (
        <>
          {s.connectionLoading && <p role="status">Loading Gmail connection…</p>}
          {s.connecting && <p role="status">Connecting to Google Account…</p>}
          {s.disconnecting && <p role="status">Disconnecting Gmail…</p>}
          {s.connectionError && (
            <p role="alert" className="error-banner">
              Unable to load or update Gmail. Refresh the connection to retry.
            </p>
          )}

          {showSendReconnect && (
            <div
              className="email-thaara-activity-box"
              data-testid="gmail-send-permission-notice"
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}
            >
              <span style={{ fontSize: '0.84rem' }}>
                Thaara can read your Gmail. To send emails, reconnect Gmail and allow sending.
              </span>
              {p.onReconnect && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={p.onReconnect}
                  data-testid="gmail-reconnect-btn"
                  style={smallBtn}
                >
                  Reconnect Gmail
                </button>
              )}
            </div>
          )}

          {/* Collapsible Connection Settings */}
          <details
            className="integration-settings-drawer"
            open={Boolean(s.status && s.status.status !== 'connected')}
            data-testid="gmail-connection-settings"
          >
            <summary>Connection Settings</summary>
            <div className="integration-settings-body">
              <p style={{ margin: 0 }}>
                <strong>Connection:</strong> {statusLabel} · Mode:{' '}
                {s.status?.mode === 'live' ? 'LIVE (Google OAuth 2.0)' : 'DEMO / MOCK'} · Timezone:{' '}
                {timeZone}
              </p>
              {connectedAccountEmail && (
                <p style={{ margin: 0, fontSize: '0.82rem' }} data-testid="gmail-settings-account">
                  <strong>Authorized Gmail account:</strong> Connected as: {connectedAccountEmail}
                </p>
              )}
              <p style={{ margin: 0, fontSize: '0.78rem' }} data-testid="gmail-settings-permissions">
                {s.status?.mode === 'live'
                  ? canSend
                    ? 'Thaara can read your Gmail and send emails only after you press Confirm & Send.'
                    : 'Thaara can read your Gmail. Sending is not allowed yet.'
                  : 'Live Google OAuth is not configured in this environment. Mock mode displays synthetic inbox messages in read-only mode.'}
              </p>
              <div className="integration-settings-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!canConnect}
                  onClick={canConnect ? p.onConnect : undefined}
                >
                  Connect Gmail
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={p.onDisconnect}
                  disabled={busy || !canDisconnectGmail(s)}
                >
                  Local disconnect
                </button>
              </div>
            </div>
          </details>

          {ready && (
            <>
              {/* Search & Filter Bar */}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  p.onSearch();
                }}
                className="integration-filter-bar"
                data-testid="gmail-filter-bar"
              >
                <label htmlFor="gmail-search" style={{ flex: '1 1 220px', margin: 0 }}>
                  <span
                    style={{
                      position: 'absolute',
                      width: 1,
                      height: 1,
                      overflow: 'hidden',
                      clip: 'rect(0,0,0,0)',
                    }}
                  >
                    Search mail
                  </span>
                  <input
                    id="gmail-search"
                    className="integration-search-input"
                    value={p.draft}
                    onChange={(e) => p.onDraft(e.target.value)}
                    placeholder="Search by email address, name, subject, words, or Gmail search (e.g. from:name@example.com)"
                    maxLength={1000}
                    disabled={s.listLoading}
                  />
                </label>

                <select
                  aria-label="Choose Gmail folder"
                  data-testid="gmail-mailbox-filter"
                  className="integration-select"
                  value={mailbox}
                  onChange={(e) => p.onMailbox?.(e.target.value as GmailMailbox)}
                  disabled={s.listLoading || !p.onMailbox}
                >
                  <option value="inbox">Inbox</option>
                  <option value="all">All Mail</option>
                  <option value="sent">Sent</option>
                </select>

                <select
                  aria-label="Filter Gmail by message type"
                  data-testid="gmail-type-filter"
                  className="integration-select"
                  value={activeTypeFilter}
                  onChange={(e) => handleTypeChange(e.target.value as GmailTypeFilter)}
                  disabled={s.listLoading}
                >
                  <option value="all">All Messages</option>
                  <option value="received">Received</option>
                  <option value="sent">Sent by You</option>
                  <option value="thaara_actions">Thaara Activity</option>
                </select>

                <select
                  aria-label="Filter Gmail by message status"
                  data-testid="gmail-status-filter"
                  className="integration-select"
                  value={activeStatusFilter}
                  onChange={(e) => handleStatusChange(e.target.value as GmailStatusFilter)}
                  disabled={s.listLoading}
                >
                  <option value="all">All Statuses</option>
                  <option value="unread">Unread</option>
                  <option value="read">Read</option>
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="failed">Failed / Unverified</option>
                </select>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={s.listLoading}
                  style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem' }}
                >
                  Search mail
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={s.listLoading}
                  onClick={handleBackToInbox}
                  style={{ padding: '0.45rem 0.75rem', fontSize: '0.82rem' }}
                >
                  Inbox
                </button>
                {(isSearch || Boolean(p.draft.trim())) && (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={s.listLoading}
                      onClick={handleBackToInbox}
                      data-testid="gmail-back-to-inbox-btn"
                      style={{ padding: '0.45rem 0.75rem', fontSize: '0.82rem' }}
                    >
                      Back to Inbox
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={s.listLoading}
                      onClick={handleClearSearch}
                      data-testid="gmail-clear-search-btn"
                      style={{ padding: '0.45rem 0.75rem', fontSize: '0.82rem' }}
                    >
                      Clear Search
                    </button>
                  </>
                )}
              </form>

              {s.listLoading && <p role="status">Loading messages…</p>}
              {s.listError && (
                <p role="alert" className="error-banner">
                  {s.listError === 'invalid_search'
                    ? 'Enter a search of up to 1,000 characters.'
                    : 'Unable to load messages. Refresh or search again.'}
                </p>
              )}

              {/* Inbox list & reading pane */}
              <div className="integration-split-layout" data-testid="gmail-split-layout">
                <div className="integration-list-pane">
                  <div
                    className="integration-pane-header"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span data-testid="gmail-pane-title">
                      {paneTitle} ({filteredRows.length})
                    </span>
                    {isSearch && (
                      <span
                        className="badge badge-info"
                        data-testid="gmail-active-query"
                        style={{ fontSize: '0.72rem' }}
                      >
                        Query: {s.query}
                      </span>
                    )}
                  </div>

                  {showEmpty && searchedAddress && (
                    <div style={{ padding: '1rem', display: 'grid', gap: '0.6rem' }} data-testid="gmail-empty-address">
                      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        No existing emails found.
                      </p>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => handleOpenCompose({ to: searchedAddress })}
                          data-testid="gmail-compose-to-searched"
                          style={smallBtn}
                        >
                          Compose email to {searchedAddress}
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={handleBackToInbox}
                          data-testid="gmail-empty-back-to-inbox-btn"
                          style={smallBtn}
                        >
                          Back to Inbox
                        </button>
                      </div>
                    </div>
                  )}
                  {showEmpty && !searchedAddress && (
                    <div style={{ padding: '1rem', display: 'grid', gap: '0.6rem' }}>
                      <p
                        style={{
                          margin: 0,
                          color: 'var(--text-secondary)',
                          fontSize: '0.85rem',
                        }}
                      >
                        No messages found.
                      </p>
                      {isSearch && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={handleBackToInbox}
                          data-testid="gmail-empty-back-to-inbox-btn"
                          style={{ ...smallBtn, justifySelf: 'start' }}
                        >
                          Back to Inbox
                        </button>
                      )}
                    </div>
                  )}

                  <ul
                    aria-label="Gmail messages"
                    className="integration-list"
                    data-testid="gmail-message-list"
                    onScroll={(event) => {
                      if (!s.nextPageToken || s.listLoading || s.loadingMore) return;
                      const el = event.currentTarget;
                      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
                        if (p.onLoadMore) {
                          p.onLoadMore();
                        } else {
                          p.onNext();
                        }
                      }
                    }}
                  >
                    {filteredRows.map((row) => {
                      const originInfo = classifyGmailMessage(row, effectiveUserEmail);
                      const senderEmail = extractEmailAddress(row.from);
                      const friendlyDate = row.date
                        ? formatFriendlyDateTime(row.date, { timeZone, nowMs: p.nowMs })
                        : null;
                      const isSelected = s.selectedId === row.id;

                      return (
                        <li key={row.id}>
                          <button
                            type="button"
                            className={`integration-row-btn ${isSelected ? 'selected' : ''}`}
                            aria-pressed={isSelected}
                            onClick={() => p.onSelect(row.id)}
                            data-testid={`gmail-row-${row.id}`}
                          >
                            {row.unavailable ? (
                              <span className="integration-row-subtitle">Message unavailable</span>
                            ) : (
                              <>
                                <div className="integration-row-top">
                                  <span
                                    className="integration-row-title"
                                    data-testid={`gmail-row-sender-${row.id}`}
                                  >
                                    {originInfo.effectiveStatus === 'unread' && (
                                      <span className="unread-dot" aria-label="Unread" />
                                    )}
                                    <span
                                      style={{
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {senderEmail}
                                    </span>
                                  </span>
                                  {friendlyDate && (
                                    <span
                                      className="integration-row-time"
                                      data-testid={`gmail-row-time-${row.id}`}
                                    >
                                      {friendlyDate}
                                    </span>
                                  )}
                                </div>

                                <div
                                  className="integration-row-subtitle"
                                  data-testid={`gmail-row-subject-${row.id}`}
                                >
                                  {row.subject || '(No subject)'}
                                </div>

                                {row.snippet && (
                                  <p
                                    className="integration-row-snippet"
                                    data-testid={`gmail-row-snippet-${row.id}`}
                                  >
                                    {row.snippet}
                                  </p>
                                )}

                                {originInfo.isThaaraAction && (
                                  <div className="integration-row-badges">
                                    <span
                                      className={`badge badge-${originInfo.badgeVariant}`}
                                      data-testid={`gmail-origin-badge-${row.id}`}
                                    >
                                      {originInfo.thaaraActivityStatus}
                                    </span>
                                  </div>
                                )}
                              </>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  {s.loadingMore && (
                    <p
                      role="status"
                      data-testid="gmail-loading-more"
                      style={{
                        padding: '0.6rem',
                        margin: 0,
                        textAlign: 'center',
                        fontSize: '0.8rem',
                        color: 'var(--text-secondary)',
                        borderTop: '1px solid var(--border-color)',
                      }}
                    >
                      Loading more emails...
                    </p>
                  )}
                </div>

                {/* RIGHT PANE: composer & reading pane */}
                <div className="integration-detail-pane" data-testid="gmail-detail-pane">
                  {isComposeOpen && (
                    <section
                      aria-label="New Email"
                      data-testid="gmail-compose-panel"
                      style={{
                        padding: '1rem',
                        borderBottom: '1px solid var(--border-color)',
                        background: 'var(--surface-muted)',
                        display: 'grid',
                        gap: '0.75rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                        <h3 style={{ fontSize: '0.98rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                          {composeStage === 'review' || composeStage === 'sending'
                            ? 'Check your email'
                            : activeComposeMode === 'reply'
                              ? 'Reply'
                              : activeComposeMode === 'reply_all'
                                ? 'Reply All'
                                : activeComposeMode === 'forward'
                                  ? 'Forward Email'
                                  : 'New Email'}
                        </h3>
                        {composeStage !== 'sending' && composeStage !== 'preparing' && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={handleCloseCompose}
                            style={{ padding: '0.28rem 0.65rem', fontSize: '0.76rem' }}
                          >
                            Close
                          </button>
                        )}
                      </div>

                      {s.composeError && (
                        <div role="alert" className="error-banner" data-testid="gmail-compose-error" style={{ margin: 0, display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span>{s.composeError}</span>
                          {s.composeNeedsReconnect && p.onReconnect && (
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={p.onReconnect}
                              data-testid="gmail-compose-reconnect-btn"
                              style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}
                            >
                              Reconnect Gmail
                            </button>
                          )}
                        </div>
                      )}

                      {(composeStage === 'editing' || composeStage === 'preparing') && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            p.onSendEmail?.();
                          }}
                          style={{ display: 'grid', gap: '0.6rem' }}
                          data-testid="gmail-compose-form"
                        >
                          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.82rem' }}>
                            <strong>To</strong>
                            <input
                              type="email"
                              className="integration-search-input"
                              data-testid="gmail-compose-to"
                              value={activeComposeDraft.to}
                              onChange={(e) => handleUpdateCompose({ to: e.target.value })}
                              placeholder="name@example.com"
                              maxLength={320}
                              disabled={composeStage === 'preparing'}
                            />
                          </label>
                          {(activeComposeMode === 'reply_all' || Boolean(activeComposeDraft.cc)) && (
                            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.82rem' }}>
                              <span>
                                <strong>Cc</strong> (optional)
                              </span>
                              <input
                                type="text"
                                className="integration-search-input"
                                data-testid="gmail-compose-cc"
                                value={activeComposeDraft.cc ?? ''}
                                onChange={(e) => handleUpdateCompose({ cc: e.target.value })}
                                placeholder="cc@example.com"
                                maxLength={998}
                                disabled={composeStage === 'preparing'}
                              />
                            </label>
                          )}
                          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.82rem' }}>
                            <span>
                              <strong>Subject</strong> (optional)
                            </span>
                            <input
                              type="text"
                              className="integration-search-input"
                              data-testid="gmail-compose-subject"
                              value={activeComposeDraft.subject}
                              onChange={(e) => handleUpdateCompose({ subject: e.target.value })}
                              placeholder="Subject"
                              maxLength={998}
                              disabled={composeStage === 'preparing'}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.82rem' }}>
                            <strong>Message</strong>
                            <textarea
                              className="integration-search-input"
                              data-testid="gmail-compose-body"
                              value={activeComposeDraft.bodyText}
                              onChange={(e) => handleUpdateCompose({ bodyText: e.target.value })}
                              placeholder="Write your message…"
                              rows={5}
                              style={{ resize: 'vertical', fontFamily: 'var(--font-sans)' }}
                              disabled={composeStage === 'preparing'}
                            />
                          </label>
                          {!canSend && ready && (
                            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }} data-testid="gmail-compose-send-disabled">
                              {showSendReconnect
                                ? 'Sending needs your permission. Reconnect Gmail and allow sending.'
                                : 'Sending is available only with a live Gmail connection.'}
                            </p>
                          )}
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                              type="submit"
                              className="btn btn-primary"
                              data-testid="gmail-compose-submit"
                              disabled={!canSend || composeStage === 'preparing' || !p.onSendEmail}
                              style={smallBtn}
                            >
                              {composeStage === 'preparing' ? 'Preparing…' : 'Send Email'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={handleDiscardDraft}
                              data-testid="gmail-discard-draft-btn"
                              disabled={composeStage === 'preparing'}
                              style={smallBtn}
                            >
                              Discard
                            </button>
                          </div>
                        </form>
                      )}

                      {(composeStage === 'review' || composeStage === 'sending') && pendingSend && (
                        <div
                          data-testid="gmail-send-review"
                          style={{
                            padding: '0.8rem 0.95rem',
                            borderRadius: '8px',
                            background: 'var(--card-bg)',
                            border: '1px solid var(--border-color)',
                            display: 'grid',
                            gap: '0.4rem',
                            fontSize: '0.84rem',
                          }}
                        >
                          <p style={{ margin: 0 }}>Please check your email, then press Approve &amp; Send (Confirm &amp; Send).</p>
                          <p style={{ margin: 0 }}>
                            <strong>From:</strong> {pendingSend.from}
                          </p>
                          <p style={{ margin: 0 }} data-testid="gmail-send-review-to">
                            <strong>Recipient (To):</strong> {pendingSend.to}
                          </p>
                          {pendingSend.cc && (
                            <p style={{ margin: 0 }} data-testid="gmail-send-review-cc">
                              <strong>Cc:</strong> {pendingSend.cc}
                            </p>
                          )}
                          <p style={{ margin: 0 }}>
                            <strong>Subject:</strong> {pendingSend.subject || '(none)'}
                          </p>
                          <pre
                            style={{
                              margin: '0.25rem 0 0',
                              padding: '0.6rem 0.75rem',
                              borderRadius: '6px',
                              background: 'var(--surface-muted)',
                              border: '1px solid var(--border-color)',
                              fontFamily: 'var(--font-sans)',
                              fontSize: '0.85rem',
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                            }}
                            data-testid="gmail-send-review-body"
                          >
                            {pendingSend.bodyText}
                          </pre>
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={p.onConfirmSend}
                              disabled={composeStage === 'sending' || !p.onConfirmSend}
                              data-testid="gmail-confirm-send-btn"
                              style={smallBtn}
                            >
                              {composeStage === 'sending' ? 'Sending…' : 'Approve & Send (Confirm & Send)'}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary"
                              onClick={p.onEditAgain}
                              disabled={composeStage === 'sending' || !p.onEditAgain}
                              data-testid="gmail-edit-again-btn"
                              style={smallBtn}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger"
                              onClick={p.onCancelSend}
                              disabled={composeStage === 'sending' || !p.onCancelSend}
                              data-testid="gmail-cancel-send-btn"
                              style={smallBtn}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {composeStage === 'done' && sendResult && (
                        <div style={{ display: 'grid', gap: '0.5rem' }} data-testid="gmail-send-result">
                          <p role="status" style={{ margin: 0, fontSize: '0.86rem' }}>
                            <span className={resultBannerClass} data-testid="gmail-send-result-message" style={{ whiteSpace: 'normal' }}>
                              {sendResult.message}
                            </span>
                          </p>
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button type="button" className="btn btn-primary" onClick={() => handleOpenCompose()} style={smallBtn}>
                              New Email
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={handleDiscardDraft} style={smallBtn}>
                              Close
                            </button>
                          </div>
                        </div>
                      )}
                    </section>
                  )}

                  {s.previewLoading && (
                    <p
                      role="status"
                      style={{ padding: '1rem', margin: 0, color: 'var(--text-secondary)' }}
                    >
                      Loading message…
                    </p>
                  )}
                  {s.previewError && (
                    <p role="alert" className="error-banner" style={{ margin: '1rem' }}>
                      Unable to load this message. Select it again to retry.
                    </p>
                  )}

                  {!s.previewLoading && !s.previewError && !s.preview && !isComposeOpen && (
                    <div
                      style={{
                        padding: '1.5rem',
                        color: 'var(--text-secondary)',
                        fontSize: '0.88rem',
                      }}
                    >
                      Select an email on the left to read it, or click "+ New Email" to write one.
                    </div>
                  )}

                  {s.preview && previewClassification && (
                    <article
                      aria-label="Message preview"
                      style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
                    >
                      <div className="integration-detail-header">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap', width: '100%' }}>
                          <h3
                            style={{
                              fontSize: '1.06rem',
                              fontWeight: 700,
                              margin: 0,
                              color: 'var(--text-primary)',
                            }}
                          >
                            {s.preview.subject || '(No subject)'}
                          </h3>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {s.preview.date && (
                              <span
                                className="integration-row-time"
                                data-testid="gmail-preview-friendly-date"
                              >
                                {formatFriendlyDateTime(s.preview.date, {
                                  timeZone,
                                  nowMs: p.nowMs,
                                })}
                              </span>
                            )}
                            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }} data-testid="gmail-preview-actions">
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleReply}
                                data-testid="gmail-reply-btn"
                                style={{ padding: '0.32rem 0.68rem', fontSize: '0.78rem' }}
                              >
                                Reply
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleReplyAll}
                                data-testid="gmail-reply-all-btn"
                                style={{ padding: '0.32rem 0.68rem', fontSize: '0.78rem' }}
                              >
                                Reply All
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleForward}
                                data-testid="gmail-forward-btn"
                                style={{ padding: '0.32rem 0.68rem', fontSize: '0.78rem' }}
                              >
                                Forward
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="integration-detail-body">
                        <div
                          style={{
                            padding: '0.65rem 0.85rem',
                            borderRadius: '8px',
                            background: 'var(--surface-muted)',
                            border: '1px solid var(--border-color)',
                            fontSize: '0.84rem',
                            display: 'grid',
                            gap: '0.25rem',
                          }}
                          data-testid="gmail-preview-addresses"
                        >
                          <p style={{ margin: 0 }}>
                            <strong>From:</strong> {extractEmailAddress(s.preview.from)}
                          </p>
                          <p style={{ margin: 0 }}>
                            <strong>To:</strong>{' '}
                            {s.preview.to ? extractEmailAddress(s.preview.to) : '—'}
                          </p>
                          {s.preview.cc && (
                            <p style={{ margin: 0 }}>
                              <strong>Cc:</strong> {s.preview.cc}
                            </p>
                          )}
                        </div>

                        <div
                          style={{
                            padding: '0.95rem 1rem',
                            borderRadius: '8px',
                            background: 'var(--card-bg)',
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          <pre
                            style={{
                              margin: 0,
                              fontFamily: 'var(--font-sans)',
                              fontSize: '0.9rem',
                              lineHeight: 1.6,
                              color: 'var(--text-primary)',
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                            }}
                            data-testid="gmail-preview-body"
                          >
                            {s.preview.bodyText || s.preview.snippet || '(No plain-text content)'}
                          </pre>
                        </div>

                        <section
                          aria-label="Thaara Activity"
                          className="email-thaara-activity-box"
                          data-testid="gmail-thaara-activity"
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '0.5rem',
                            }}
                          >
                            <strong style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                              Thaara Activity
                            </strong>
                            <span
                              className={`badge badge-${previewClassification.badgeVariant}`}
                              data-testid="gmail-thaara-activity-status"
                            >
                              {previewClassification.thaaraActivityStatus}
                            </span>
                          </div>
                          <p
                            style={{
                              margin: '0.35rem 0 0',
                              fontSize: '0.83rem',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {previewClassification.thaaraActivitySummary}
                          </p>
                          {previewClassification.thaaraReplyText && (
                            <pre
                              style={{
                                margin: '0.5rem 0 0',
                                padding: '0.6rem 0.75rem',
                                borderRadius: '6px',
                                background: 'var(--card-bg)',
                                border: '1px solid var(--border-color)',
                                fontFamily: 'var(--font-sans)',
                                fontSize: '0.84rem',
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                              }}
                              data-testid="gmail-thaara-reply-text"
                            >
                              {previewClassification.thaaraReplyText}
                            </pre>
                          )}
                        </section>

                        <details className="integration-settings-drawer" style={{ margin: 0 }}>
                          <summary>Security &amp; Message Handling Details</summary>
                          <div className="integration-settings-body">
                            <span>Untrusted email content is rendered as plain text only.</span>
                          </div>
                        </details>
                      </div>
                    </article>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export function GmailScreen({
  role,
  workspaceId,
  userId,
}: {
  role: string;
  workspaceId: string;
  userId: string;
}) {
  const subject = JSON.stringify([workspaceId, userId, role]);
  const [view, setView] = useState<{ subject: string; state: GmailState }>(() => ({
    subject,
    state: initialGmailState(role),
  }));
  const [draft, setDraft] = useState('');
  const [typeFilter, setTypeFilter] = useState<GmailTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<GmailStatusFilter>('all');
  const model = useRef<ReturnType<typeof createGmailModel> | null>(null);

  useEffect(() => {
    const current = createGmailModel(role, (state) => setView({ subject, state }));
    model.current = current;
    setView({ subject, state: initialGmailState(role) });
    setDraft('');
    setTypeFilter('all');
    setStatusFilter('all');
    void current.loadStatus();
    return () => {
      current.dispose();
      if (model.current === current) model.current = null;
    };
  }, [subject, role]);

  const currentState = view.subject === subject ? view.state : initialGmailState(role);

  useEffect(() => {
    if (
      currentState.searched &&
      !currentState.listLoading &&
      !currentState.selectedId &&
      !currentState.previewLoading &&
      currentState.rows.length > 0
    ) {
      const firstAvailable = currentState.rows.find((r) => !r.unavailable);
      if (firstAvailable) {
        void model.current?.select(firstAvailable.id);
      }
    }
  }, [
    currentState.searched,
    currentState.listLoading,
    currentState.selectedId,
    currentState.previewLoading,
    currentState.rows,
  ]);

  const redirect = (url: string | null) => {
    if (url && typeof window !== 'undefined') {
      window.location.assign(url);
    }
  };

  return (
    <GmailScreenView
      state={currentState}
      draft={view.subject === subject ? draft : ''}
      onDraft={setDraft}
      typeFilter={typeFilter}
      onTypeFilter={setTypeFilter}
      statusFilter={statusFilter}
      onStatusFilter={setStatusFilter}
      onSearch={() => void model.current?.search(draft)}
      onInbox={() => {
        setDraft('');
        void model.current?.backToInbox();
      }}
      onBackToInbox={() => {
        setDraft('');
        void model.current?.backToInbox();
      }}
      onClearSearch={() => {
        setDraft('');
        void model.current?.backToInbox();
      }}
      onMailbox={(mailbox) => void model.current?.setMailbox(mailbox)}
      onNext={() => void model.current?.loadMore()}
      onLoadMore={() => void model.current?.loadMore()}
      onPrev={() => void model.current?.prev()}
      onSelect={(id) => void model.current?.select(id)}
      onRefresh={() => void model.current?.loadStatus(draft.trim() || undefined)}
      onDisconnect={() => void model.current?.disconnect()}
      onOpenCompose={(initial, mode) => model.current?.openCompose(initial, mode)}
      onReply={() => model.current?.startReply()}
      onReplyAll={() => model.current?.startReplyAll()}
      onForward={() => model.current?.startForward()}
      onCloseCompose={() => model.current?.closeCompose()}
      onUpdateCompose={(patch) => model.current?.updateCompose(patch)}
      onSendEmail={() => void model.current?.prepareSend()}
      onConfirmSend={() => void model.current?.confirmSend()}
      onCancelSend={() => void model.current?.cancelSend()}
      onEditAgain={() => void model.current?.editAgain()}
      onDiscardDraft={() => model.current?.discardDraft()}
      onConnect={() => {
        void model.current?.connect().then(redirect);
      }}
      onReconnect={() => {
        void model.current?.reconnect().then(redirect);
      }}
    />
  );
}
