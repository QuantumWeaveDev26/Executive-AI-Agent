import { useEffect, useRef, useState } from 'react';
import { StoredWhatsAppInbox } from './StoredWhatsAppInbox';
import {
  DEFAULT_WORKSPACE_TIMEZONE,
  EnrichedWhatsAppMessage,
  WhatsAppStatusFilter,
  WhatsAppTypeFilter,
  classifyWhatsAppMessage,
  filterWhatsAppMessages,
  filterWhatsAppThreads,
  formatFriendlyDateTime,
  formatWhatsAppContactName,
} from './integration-ui';
import {
  WhatsAppState,
  canDisconnectWhatsApp,
  canReadWhatsApp,
  createWhatsAppModel,
  initialWhatsAppState,
} from './whatsapp-model';

const statusLabels = {
  not_configured: 'Not configured',
  disconnected: 'Disconnected',
  connected: 'Connected (mock)',
  reconnect_required: 'Reconnect required',
};

export interface WhatsAppScreenViewProps {
  state: WhatsAppState;
  draft: string;
  onDraft: (value: string) => void;
  onSearch: () => void;
  onResetFilter: () => void;
  onSelectThread: (threadId: string | null) => void;
  onSelectMessage: (messageId: string) => void;
  onNext: () => void;
  onRefresh: () => void;
  onDisconnect: () => void;
  typeFilter?: WhatsAppTypeFilter;
  onTypeFilter?: (value: WhatsAppTypeFilter) => void;
  statusFilter?: WhatsAppStatusFilter;
  onStatusFilter?: (value: WhatsAppStatusFilter) => void;
  timeZone?: string;
  nowMs?: number;
}

export function WhatsAppScreenView(p: WhatsAppScreenViewProps) {
  const s = p.state;
  const ready = canReadWhatsApp(s);
  const busy = s.connectionLoading || s.disconnecting;
  const timeZone = p.timeZone ?? DEFAULT_WORKSPACE_TIMEZONE;

  const [localTypeFilter, setLocalTypeFilter] = useState<WhatsAppTypeFilter>('all');
  const [localStatusFilter, setLocalStatusFilter] = useState<WhatsAppStatusFilter>('all');

  const activeTypeFilter = p.typeFilter ?? localTypeFilter;
  const activeStatusFilter = p.statusFilter ?? localStatusFilter;

  const handleTypeChange = (next: WhatsAppTypeFilter) => {
    setLocalTypeFilter(next);
    p.onTypeFilter?.(next);
  };

  const handleStatusChange = (next: WhatsAppStatusFilter) => {
    setLocalStatusFilter(next);
    p.onStatusFilter?.(next);
  };

  const handleResetAll = () => {
    handleTypeChange('all');
    handleStatusChange('all');
    p.onResetFilter();
  };

  const filteredThreads = filterWhatsAppThreads(s.threads, p.draft, activeStatusFilter);
  const filteredMessages = filterWhatsAppMessages(s.messages as EnrichedWhatsAppMessage[], {
    searchQuery: p.draft,
    typeFilter: activeTypeFilter,
    statusFilter: activeStatusFilter,
    threadId: s.selectedThreadId,
  });

  const activeThread =
    s.threads.find((t) => t.threadId === s.selectedThreadId) ?? filteredThreads[0] ?? null;
  const activeContactInfo = activeThread
    ? formatWhatsAppContactName(activeThread.participant)
    : null;

  const statusBadgeClass =
    s.status?.status === 'connected'
      ? 'badge badge-success'
      : s.status?.status === 'disconnected'
        ? 'badge badge-danger'
        : 'badge badge-warning';

  const previewPresentation = s.preview
    ? classifyWhatsAppMessage(s.preview as EnrichedWhatsAppMessage)
    : null;

  return (
    <section
      className="integration-card"
      aria-labelledby="whatsapp-heading"
      data-testid="whatsapp-screen"
    >
      {/* Compact 1-Row Header — DEMO / MOCK shown once here */}
      <div className="integration-header-bar">
        <div className="integration-header-left">
          <h2 id="whatsapp-heading" className="integration-title">
            WhatsApp Business
          </h2>
          {!s.unauthorized && (
            <>
              <span className={statusBadgeClass} data-testid="whatsapp-status-badge">
                {s.status ? statusLabels[s.status.status] ?? 'Unavailable' : 'Unavailable'}
              </span>
              {s.status?.mode === 'mock' && (
                <span className="badge badge-info" data-testid="whatsapp-mock-badge">
                  DEMO / MOCK
                </span>
              )}
            </>
          )}
        </div>

        <div className="integration-header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={p.onRefresh}
            style={{ padding: '0.38rem 0.75rem', fontSize: '0.8rem' }}
          >
            Refresh WhatsApp
          </button>
        </div>
      </div>

      {s.unauthorized ? (
        <p role="alert" className="error-banner" data-testid="whatsapp-unauthorized-banner">
          WhatsApp Business access is unavailable. Sign in with an authorized workspace account.
        </p>
      ) : (
        <>
          {s.connectionLoading && <p role="status">Loading WhatsApp connection…</p>}
          {s.disconnecting && <p role="status">Disconnecting WhatsApp…</p>}
          {s.connectionError && (
            <p role="alert" className="error-banner">
              Unable to load or update WhatsApp Business. Refresh the connection to retry.
            </p>
          )}

          {/* Collapsible Connection & Security Settings */}
          <details
            className="integration-settings-drawer"
            open={Boolean(s.status && s.status.status !== 'connected')}
            data-testid="whatsapp-connection-settings"
          >
            <summary>Connection Settings &amp; Security Details</summary>
            <div className="integration-settings-body">
              <p style={{ margin: 0 }}>
                <strong>Connection:</strong>{' '}
                {s.status ? statusLabels[s.status.status] ?? 'Unavailable' : 'Unavailable'}
                {s.status?.maskedBusinessPhone && (
                  <span data-testid="whatsapp-business-line">
                    {' '}
                    · Business line: {s.status.maskedBusinessPhone}
                  </span>
                )}
              </p>
              <p style={{ margin: 0 }}>
                Untrusted WhatsApp message content is rendered as plain text only. Phone numbers are
                masked and external sending is disabled in mock mode.
              </p>
              <div className="integration-settings-actions">
                <button type="button" className="btn btn-primary" disabled>
                  Connect WhatsApp Business
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={p.onDisconnect}
                  disabled={busy || !canDisconnectWhatsApp(s)}
                >
                  Local disconnect
                </button>
              </div>
            </div>
          </details>

          {ready && (
            <>
              {/* Clean Search & Filter Bar */}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  p.onSearch();
                }}
                className="integration-filter-bar"
                data-testid="whatsapp-filter-bar"
              >
                <label htmlFor="whatsapp-search" style={{ flex: '1 1 220px', margin: 0 }}>
                  <span
                    style={{
                      position: 'absolute',
                      width: 1,
                      height: 1,
                      overflow: 'hidden',
                      clip: 'rect(0,0,0,0)',
                    }}
                  >
                    Search messages
                  </span>
                  <input
                    id="whatsapp-search"
                    className="integration-search-input"
                    value={p.draft}
                    onChange={(e) => p.onDraft(e.target.value)}
                    placeholder="Search contact or message..."
                    maxLength={256}
                    disabled={s.listLoading}
                  />
                </label>

                <select
                  aria-label="Filter WhatsApp by message type"
                  data-testid="whatsapp-type-filter"
                  className="integration-select"
                  value={activeTypeFilter}
                  onChange={(e) => handleTypeChange(e.target.value as WhatsAppTypeFilter)}
                  disabled={s.listLoading}
                >
                  <option value="all">All Messages</option>
                  <option value="received">From Contact</option>
                  <option value="user_sent">Sent by User</option>
                  <option value="thaara_actions">Thaara Activity</option>
                </select>

                <select
                  aria-label="Filter WhatsApp by delivery status"
                  data-testid="whatsapp-status-filter"
                  className="integration-select"
                  value={activeStatusFilter}
                  onChange={(e) => handleStatusChange(e.target.value as WhatsAppStatusFilter)}
                  disabled={s.listLoading}
                >
                  <option value="all">All Statuses</option>
                  <option value="received">Unread</option>
                  <option value="read">Read</option>
                  <option value="draft_awaiting_approval">Thaara Draft</option>
                  <option value="sent">Sent</option>
                  <option value="failed">Failed / Unverified</option>
                </select>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={s.listLoading}
                  style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem' }}
                >
                  Search messages
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={s.listLoading}
                  onClick={handleResetAll}
                  style={{ padding: '0.45rem 0.75rem', fontSize: '0.82rem' }}
                >
                  All conversations
                </button>
              </form>

              {s.listLoading && <p role="status">Loading WhatsApp messages…</p>}
              {s.listError && (
                <p role="alert" className="error-banner">
                  {s.listError === 'invalid_search'
                    ? 'Enter a search query of up to 256 characters.'
                    : 'Unable to load WhatsApp messages. Refresh or search again.'}
                </p>
              )}

              {/* Familiar Messaging Split Layout */}
              <div className="integration-split-layout" data-testid="whatsapp-split-layout">
                {/* LEFT PANE: Clean Contact Conversation List */}
                <div className="integration-list-pane">
                  <div className="integration-pane-header">
                    <span>Conversations ({filteredThreads.length})</span>
                  </div>

                  {s.searched && !s.listLoading && !s.listError && filteredThreads.length === 0 && (
                    <p
                      style={{
                        padding: '1rem',
                        margin: 0,
                        color: 'var(--text-secondary)',
                        fontSize: '0.85rem',
                      }}
                    >
                      No WhatsApp conversations found.
                    </p>
                  )}

                  {filteredThreads.length > 0 && (
                    <ul aria-label="WhatsApp conversations" className="integration-list">
                      {filteredThreads.map((thread) => {
                        const isSelected = s.selectedThreadId === thread.threadId;
                        const contactInfo = formatWhatsAppContactName(thread.participant);
                        const friendlyTime = formatFriendlyDateTime(thread.lastMessageAt, {
                          timeZone,
                          nowMs: p.nowMs,
                        });
                        return (
                          <li key={thread.threadId}>
                            <button
                              type="button"
                              className={`integration-row-btn ${isSelected ? 'selected' : ''}`}
                              aria-pressed={isSelected}
                              disabled={s.listLoading}
                              onClick={() =>
                                p.onSelectThread(
                                  s.selectedThreadId === thread.threadId ? null : thread.threadId,
                                )
                              }
                              data-testid={`whatsapp-thread-${thread.threadId}`}
                            >
                              <div className="integration-row-top">
                                <span
                                  className="integration-row-title"
                                  data-testid={`whatsapp-thread-name-${thread.threadId}`}
                                >
                                  {thread.unreadCount > 0 && (
                                    <span className="unread-dot" aria-hidden="true" />
                                  )}
                                  <span>{contactInfo.name}</span>
                                </span>
                                <span
                                  className="integration-row-time"
                                  data-testid={`whatsapp-thread-time-${thread.threadId}`}
                                >
                                  {friendlyTime}
                                </span>
                              </div>

                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  gap: '0.4rem',
                                  fontSize: '0.76rem',
                                  color: 'var(--text-secondary)',
                                }}
                              >
                                <span style={{ fontFamily: 'var(--font-mono)' }}>
                                  {thread.participant.maskedPhone}
                                </span>
                                {thread.unreadCount > 0 && (
                                  <span className="badge badge-info" style={{ fontSize: '0.68rem' }}>
                                    Unread: {thread.unreadCount}
                                  </span>
                                )}
                              </div>

                              <p className="integration-row-snippet">{thread.lastMessagePreview}</p>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* RIGHT PANE: Real Left/Right WhatsApp Conversation View */}
                <div className="integration-detail-pane" data-testid="whatsapp-chat-pane">
                  <div className="integration-detail-header">
                    <div>
                      <strong
                        style={{ fontSize: '0.98rem', display: 'block', color: 'var(--text-primary)' }}
                        data-testid="whatsapp-active-contact-name"
                      >
                        {activeContactInfo ? activeContactInfo.name : 'All Conversations'}
                      </strong>
                      <span
                        style={{
                          fontSize: '0.77rem',
                          color: 'var(--text-secondary)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {activeThread ? activeThread.participant.maskedPhone : 'Select a contact'}
                      </span>
                    </div>
                  </div>

                  {s.searched && !s.listLoading && !s.listError && filteredMessages.length === 0 && (
                    <p
                      style={{
                        padding: '1.25rem',
                        margin: 0,
                        color: 'var(--text-secondary)',
                        fontSize: '0.85rem',
                      }}
                    >
                      No WhatsApp messages found.
                    </p>
                  )}

                  {filteredMessages.length > 0 && (
                    <ul
                      aria-label="WhatsApp messages"
                      className="wa-chat-stream"
                      data-testid="whatsapp-message-stream"
                    >
                      {filteredMessages.map((msg) => {
                        const pres = classifyWhatsAppMessage(msg);
                        const friendlyMsgTime = formatFriendlyDateTime(msg.timestamp, {
                          timeZone,
                          nowMs: p.nowMs,
                        });
                        const isSelected = s.selectedMessageId === msg.id;

                        return (
                          <li
                            key={msg.id}
                            className={
                              pres.alignment === 'right'
                                ? 'wa-bubble-row-right'
                                : 'wa-bubble-row-left'
                            }
                            data-testid={`whatsapp-msg-row-${msg.id}`}
                            data-alignment={pres.alignment}
                          >
                            <button
                              type="button"
                              className={`wa-bubble ${
                                pres.alignment === 'right'
                                  ? 'wa-bubble-outbound'
                                  : 'wa-bubble-inbound'
                              }`}
                              aria-pressed={isSelected}
                              onClick={() => p.onSelectMessage(msg.id)}
                              data-testid={`whatsapp-msg-bubble-${msg.id}`}
                            >
                              {/* Message Text — no repeated sender name & phone inside every bubble */}
                              <div
                                style={{
                                  whiteSpace: 'pre-wrap',
                                  overflowWrap: 'anywhere',
                                  fontSize: '0.88rem',
                                  lineHeight: 1.5,
                                }}
                              >
                                {msg.textPreview}
                              </div>

                              {/* Truthful Message Label + Short Local Time */}
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: '0.5rem',
                                  marginTop: '0.4rem',
                                }}
                              >
                                <span
                                  className={`badge badge-${pres.badgeVariant}`}
                                  data-testid={`whatsapp-msg-origin-${msg.id}`}
                                >
                                  {pres.senderBadge}
                                </span>
                                <span
                                  style={{
                                    fontSize: '0.73rem',
                                    color: 'var(--text-secondary)',
                                  }}
                                  data-testid={`whatsapp-msg-time-${msg.id}`}
                                >
                                  {friendlyMsgTime}
                                </span>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {s.nextPageToken && (
                    <div style={{ padding: '0.5rem 0.9rem', textAlign: 'center' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={s.listLoading}
                        onClick={p.onNext}
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                      >
                        Next page
                      </button>
                    </div>
                  )}

                  {s.previewLoading && (
                    <p
                      role="status"
                      style={{
                        padding: '0.75rem 0.95rem',
                        margin: 0,
                        color: 'var(--text-secondary)',
                        fontSize: '0.82rem',
                      }}
                    >
                      Loading WhatsApp message…
                    </p>
                  )}
                  {s.previewError && (
                    <p role="alert" className="error-banner" style={{ margin: '0.75rem 0.95rem' }}>
                      Unable to load this WhatsApp message. Select it again to retry.
                    </p>
                  )}

                  {s.preview && previewPresentation && (
                    <details
                      className="integration-settings-drawer"
                      style={{
                        margin: '0',
                        borderRadius: 0,
                        borderLeft: 'none',
                        borderRight: 'none',
                        borderBottom: 'none',
                      }}
                    >
                      <summary>Selected Message Details</summary>
                      <div className="integration-settings-body">
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '0.5rem',
                          }}
                        >
                          <span>
                            <strong>Contact:</strong>{' '}
                            {formatWhatsAppContactName(s.preview.sender).name} (
                            {s.preview.sender.maskedPhone})
                          </span>
                          <span>
                            {previewPresentation.senderBadge} · {previewPresentation.statusLabel}
                          </span>
                        </div>
                      </div>
                    </details>
                  )}

                  <div className="integration-detail-footer">
                    <span>External message sending is disabled in mock mode.</span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled
                      style={{ padding: '0.32rem 0.7rem', fontSize: '0.76rem' }}
                    >
                      Send WhatsApp message (approval required — disabled)
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

export function WhatsAppScreen({
  role,
  workspaceId,
  userId,
}: {
  role: string;
  workspaceId: string;
  userId: string;
}) {
  const subject = JSON.stringify([workspaceId, userId, role]);
  const [view, setView] = useState<{ subject: string; state: WhatsAppState }>(() => ({
    subject,
    state: initialWhatsAppState(role),
  }));
  const [draft, setDraft] = useState('');
  const [typeFilter, setTypeFilter] = useState<WhatsAppTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<WhatsAppStatusFilter>('all');
  const model = useRef<ReturnType<typeof createWhatsAppModel> | null>(null);

  useEffect(() => {
    const current = createWhatsAppModel(role, (state) => setView({ subject, state }));
    model.current = current;
    setView({ subject, state: initialWhatsAppState(role) });
    setDraft('');
    setTypeFilter('all');
    setStatusFilter('all');
    void current.loadStatus();
    return () => {
      current.dispose();
      if (model.current === current) {
        model.current = null;
      }
    };
  }, [subject, role]);

  return (
    <><StoredWhatsAppInbox key={subject} role={role} /><details><summary>Demo inbox (offline foundation)</summary><WhatsAppScreenView
      state={view.subject === subject ? view.state : initialWhatsAppState(role)}
      draft={view.subject === subject ? draft : ''}
      onDraft={setDraft}
      typeFilter={typeFilter}
      onTypeFilter={setTypeFilter}
      statusFilter={statusFilter}
      onStatusFilter={setStatusFilter}
      onSearch={() => void model.current?.search(draft)}
      onResetFilter={() => {
        setDraft('');
        void model.current?.selectThread(null);
      }}
      onSelectThread={(threadId) => void model.current?.selectThread(threadId)}
      onSelectMessage={(messageId) => void model.current?.selectMessage(messageId)}
      onNext={() => void model.current?.next()}
      onRefresh={() => void model.current?.loadStatus()}
      onDisconnect={() => void model.current?.disconnect()}
    /></details></>
  );
}
