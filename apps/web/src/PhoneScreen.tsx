import React, { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_WORKSPACE_TIMEZONE,
  formatFriendlyDateTime,
  formatPhoneCallPurpose,
  formatPhoneContactName,
  formatPhoneSimpleStatus,
} from './integration-ui';
import type {
  PhoneCallDirection,
  PhoneCallLifecycleState,
  PhoneCallRecord,
  PhoneRole,
} from './phone-api';
import { PhoneScreenModel, type PhoneScreenState } from './phone-model';
import { PhoneCallingPanel, type PhoneCallingPanelState } from './PhoneCallingPanel';
import { PhoneContactsPanel, type PhoneContactsPanelState } from './PhoneContactsPanel';

export interface SimulatedDialogueTurn {
  speaker: string;
  text: string;
}

export interface PhoneScreenProps {
  workspaceId: string;
  userId: string;
  role: PhoneRole;
  timeZone?: string;
  nowMs?: number;
  initialState?: Partial<PhoneScreenState>;
  simulatedDialogueByCallId?: Record<string, ReadonlyArray<SimulatedDialogueTurn>>;
  aiCallingInitialState?: Partial<PhoneCallingPanelState>;
  contactsInitialState?: Partial<PhoneContactsPanelState>;
}

const DIRECTION_LABELS: Record<PhoneCallDirection, string> = {
  inbound: 'Incoming',
  outbound_simulated: 'Outgoing',
};

function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || seconds < 0) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function lifecycleBadgeClass(state: PhoneCallLifecycleState): string {
  switch (state) {
    case 'completed':
    case 'answered':
      return 'badge-success';
    case 'queued':
    case 'ringing':
      return 'badge-warning';
    case 'failed':
    case 'cancelled':
    default:
      return 'badge-danger';
  }
}

export function PhoneScreen({
  workspaceId,
  userId,
  role,
  timeZone = DEFAULT_WORKSPACE_TIMEZONE,
  nowMs,
  initialState,
  simulatedDialogueByCallId,
  aiCallingInitialState,
  contactsInitialState,
}: PhoneScreenProps) {
  const model = useMemo(
    () => new PhoneScreenModel(workspaceId, userId, role),
    [workspaceId, userId, role],
  );
  const [state, setState] = useState<PhoneScreenState>(() => ({
    ...model.getState(),
    ...initialState,
  }));
  const [searchInput, setSearchInput] = useState(initialState?.searchQuery ?? '');

  useEffect(() => {
    if (initialState) {
      setState({ ...model.getState(), ...initialState });
      return;
    }
    setState(model.getState());
    const unsubscribe = model.subscribe((next) => setState(next));
    void model.loadStatusAndCalls();
    return unsubscribe;
  }, [model, initialState]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void model.loadCalls({ query: searchInput, resetSelection: true });
  };

  const handleClearFilters = () => {
    setSearchInput('');
    void model.loadCalls({
      query: '',
      direction: 'all',
      lifecycleState: 'all',
      resetSelection: true,
    });
  };

  const handleDirectionChange = (direction: PhoneCallDirection | 'all') => {
    void model.loadCalls({ direction, resetSelection: true });
  };

  const handleLifecycleChange = (lifecycleState: PhoneCallLifecycleState | 'all') => {
    void model.loadCalls({ lifecycleState, resetSelection: true });
  };

  const handleSelectCall = (callRecord: PhoneCallRecord) => {
    void model.selectCall(callRecord.id);
  };

  const statusBadgeClass = (() => {
    if (!state.status) return 'badge-warning';
    switch (state.status.status) {
      case 'connected':
        return 'badge-success';
      case 'reconnect_required':
      case 'not_configured':
        return 'badge-warning';
      case 'disconnected':
      default:
        return 'badge-danger';
    }
  })();

  const isMockConnected =
    state.status?.status === 'connected' &&
    state.status.connected &&
    state.status.mode === 'mock';

  const selectedCallDialogue =
    state.selectedCall && simulatedDialogueByCallId
      ? simulatedDialogueByCallId[state.selectedCall.id]
      : undefined;

  const selectedContactInfo = state.selectedCall
    ? formatPhoneContactName(state.selectedCall)
    : null;
  const selectedPurpose = state.selectedCall
    ? formatPhoneCallPurpose(
        state.selectedCall.purposeSummary,
        state.selectedCall.lifecycleState,
      )
    : null;

  return (
    <section className="integration-card" data-testid="phone-screen" aria-labelledby="phone-heading">
      {/* Compact 1-Row Header — DEMO / MOCK shown once here */}
      <div className="integration-header-bar">
        <div className="integration-header-left">
          <h2 id="phone-heading" className="integration-title">
            Phone
          </h2>
          {state.status && (
            <span className={`badge ${statusBadgeClass}`} data-testid="phone-status-badge">
              {state.status.status === 'connected' ? 'Connected (mock)' : state.status.status}
            </span>
          )}
          {state.status?.mode === 'mock' && (
            <span
              className="badge badge-info"
              data-testid="phone-mock-mode-badge"
              title="Synthetic test calls only"
            >
              DEMO / MOCK
            </span>
          )}
        </div>

        <div className="integration-header-actions">
          {!state.unauthorized && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void model.loadStatusAndCalls()}
              disabled={state.loadingStatus || state.loadingCalls}
              data-testid="phone-refresh-btn"
              style={{ padding: '0.38rem 0.75rem', fontSize: '0.8rem' }}
            >
              {state.loadingStatus || state.loadingCalls ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {/* Unauthorized banner */}
      {state.unauthorized && (
        <div
          data-testid="phone-unauthorized-banner"
          className="error-banner"
          role="alert"
        >
          <strong>Access Restricted:</strong>{' '}
          {state.errorMessage || 'You are not authorized to access Phone telephony in this workspace.'}
        </div>
      )}

      {!state.unauthorized && <PhoneCallingPanel initialState={aiCallingInitialState} />}
      {!state.unauthorized && <PhoneContactsPanel initialState={contactsInitialState} />}

      {/* Error banner */}
      {!state.unauthorized && state.errorMessage && (
        <div data-testid="phone-error-banner" className="error-banner" role="alert">
          <strong>Phone Error:</strong> {state.errorMessage}
        </div>
      )}

      {/* Loading status state */}
      {!state.unauthorized && state.loadingStatus && !state.status && (
        <p data-testid="phone-loading-status" style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
          Checking Phone telephony connection status...
        </p>
      )}

      {/* Collapsible Connection Settings & Advanced Technical Details */}
      {!state.unauthorized && (
        <details
          className="integration-settings-drawer"
          open={Boolean(state.status && !isMockConnected)}
          data-testid="phone-connection-settings"
        >
          <summary>Connection Settings &amp; Advanced Technical Details</summary>
          <div className="integration-settings-body">
            {state.status && !isMockConnected && (
              <div data-testid="phone-not-connected-panel">
                <p style={{ margin: '0 0 0.5rem 0' }}>
                  {state.status.status === 'not_configured' &&
                    'Phone telephony connector is not configured in this environment. Enable THAARA_PHONE_MOCK_MODE=true for synthetic development call logs.'}
                  {state.status.status === 'disconnected' &&
                    'Phone telephony session is currently disconnected for this user.'}
                  {state.status.status === 'reconnect_required' &&
                    'Phone telephony session requires re-verification before call history can be read.'}
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled
                  data-testid="phone-connect-disabled-btn"
                >
                  Connect Phone Telephony (Admin setup required)
                </button>
              </div>
            )}

            {isMockConnected && (
              <div data-testid="phone-connection-meta">
                <p style={{ margin: '0 0 0.4rem 0' }}>
                  <strong>Simulated Line:</strong>{' '}
                  <span
                    data-testid="phone-masked-line-number"
                    style={{ fontFamily: 'var(--font-mono)' }}
                  >
                    {state.status?.maskedLineNumber ?? '—'}
                  </span>{' '}
                  · Showing {state.calls.length} of {state.totalCount} calls ·{' '}
                  <span data-testid="phone-recording-disabled-badge">
                    Recording &amp; Transcription Disabled
                  </span>
                </p>
                <p style={{ margin: '0 0 0.4rem 0', fontSize: '0.78rem' }}>
                  Untrusted content: external telephony summaries are sanitized and rendered as
                  plain text only.
                </p>
                <div className="integration-settings-actions">
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => void model.disconnect()}
                    disabled={state.disconnecting}
                    data-testid="phone-disconnect-btn"
                  >
                    {state.disconnecting ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </details>
      )}

      {/* Connected mock dashboard */}
      {!state.unauthorized && isMockConnected && (
        <div>
          {/* Compact Search / Type / Status Dropdown Filter Bar */}
          <form onSubmit={handleSearchSubmit} className="integration-filter-bar">
            <input
              type="text"
              className="integration-search-input"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search contact or reason for call..."
              aria-label="Search Phone calls"
              data-testid="phone-search-input"
            />

            <select
              className="integration-select"
              value={state.directionFilter}
              onChange={(e) => handleDirectionChange(e.target.value as PhoneCallDirection | 'all')}
              aria-label="Filter by call direction"
              data-testid="phone-direction-filter"
            >
              <option value="all">All Types</option>
              <option value="inbound">Incoming</option>
              <option value="outbound_simulated">Outgoing</option>
            </select>

            <select
              className="integration-select"
              value={state.lifecycleFilter}
              onChange={(e) =>
                handleLifecycleChange(e.target.value as PhoneCallLifecycleState | 'all')
              }
              aria-label="Filter by call status"
              data-testid="phone-lifecycle-filter"
            >
              <option value="all">All Statuses</option>
              <option value="queued">Waiting to call</option>
              <option value="ringing">Calling</option>
              <option value="answered">Answered</option>
              <option value="completed">Completed</option>
              <option value="failed">Could not connect</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={state.loadingCalls}
              data-testid="phone-search-submit"
              style={{ padding: '0.45rem 0.85rem', fontSize: '0.82rem' }}
            >
              Search
            </button>

            {(state.searchQuery ||
              state.directionFilter !== 'all' ||
              state.lifecycleFilter !== 'all') && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleClearFilters}
                data-testid="phone-filter-clear"
                style={{ padding: '0.45rem 0.75rem', fontSize: '0.82rem' }}
              >
                Clear
              </button>
            )}
          </form>

          {/* Main 2-column split layout: Simplified Call History + Selected Call Details */}
          <div className="integration-split-layout">
            {/* Left column: Simplified Call History */}
            <div className="integration-list-pane" data-testid="phone-call-list">
              <div className="integration-pane-header">
                <span>Call History ({state.calls.length})</span>
              </div>

              {state.loadingCalls && state.calls.length === 0 ? (
                <p
                  data-testid="phone-loading-calls"
                  style={{
                    padding: '1rem',
                    margin: 0,
                    color: 'var(--text-secondary)',
                    fontSize: '0.85rem',
                  }}
                >
                  Loading call history...
                </p>
              ) : state.calls.length === 0 ? (
                <p
                  data-testid="phone-empty-calls"
                  style={{
                    padding: '1rem',
                    margin: 0,
                    color: 'var(--text-secondary)',
                    fontSize: '0.85rem',
                  }}
                >
                  No phone calls match the current filter.
                </p>
              ) : (
                <ul className="integration-list">
                  {state.calls.map((call) => {
                    const isSelected = state.selectedCall?.id === call.id;
                    const contactInfo = formatPhoneContactName(call);
                    const simpleStatus = formatPhoneSimpleStatus(call.lifecycleState);
                    const purposeInfo = formatPhoneCallPurpose(
                      call.purposeSummary,
                      call.lifecycleState,
                    );
                    const friendlyTime = formatFriendlyDateTime(call.startedAt, {
                      timeZone,
                      nowMs,
                    });

                    return (
                      <li key={call.id}>
                        <button
                          type="button"
                          className={`integration-row-btn ${isSelected ? 'selected' : ''}`}
                          aria-pressed={isSelected}
                          onClick={() => handleSelectCall(call)}
                          data-testid={`phone-call-item-${call.id}`}
                        >
                          {/* 1. Contact name + Simple call status */}
                          <div className="integration-row-top">
                            <span
                              className="integration-row-title"
                              data-testid={`phone-call-contact-${call.id}`}
                            >
                              <strong>{contactInfo.name}</strong>
                            </span>
                            <span
                              className={`badge ${lifecycleBadgeClass(call.lifecycleState)}`}
                              data-testid={`phone-call-status-${call.id}`}
                              style={{ fontSize: '0.72rem' }}
                            >
                              {simpleStatus}
                            </span>
                          </div>

                          {/* 2. Incoming / Outgoing + Friendly local date and time */}
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: '0.76rem',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            <span data-testid={`phone-call-direction-${call.id}`}>
                              {DIRECTION_LABELS[call.direction]}
                            </span>
                            <span data-testid={`phone-call-started-${call.id}`}>
                              {friendlyTime}
                            </span>
                          </div>

                          {/* 3. One short, understandable reason for the call */}
                          <p
                            className="integration-row-snippet"
                            data-testid={`phone-call-reason-${call.id}`}
                          >
                            {purposeInfo.listReason}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {state.nextPageToken && (
                <div
                  style={{
                    padding: '0.6rem',
                    textAlign: 'center',
                    borderTop: '1px solid var(--border-color)',
                  }}
                >
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={state.loadingCalls}
                    onClick={() => void model.loadCalls({ pageToken: state.nextPageToken })}
                    data-testid="phone-load-more-btn"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                  >
                    {state.loadingCalls ? 'Loading...' : 'Load More'}
                  </button>
                </div>
              )}
            </div>

            {/* Right column: Selected Call Details */}
            <div className="integration-detail-pane" data-testid="phone-call-detail-panel">
              {state.loadingCallDetail ? (
                <p
                  data-testid="phone-loading-detail"
                  style={{
                    padding: '1rem',
                    margin: 0,
                    color: 'var(--text-secondary)',
                    fontSize: '0.85rem',
                  }}
                >
                  Loading call details...
                </p>
              ) : !state.selectedCall || !selectedContactInfo || !selectedPurpose ? (
                <p
                  data-testid="phone-no-call-selected"
                  style={{
                    padding: '1.25rem',
                    margin: 0,
                    color: 'var(--text-secondary)',
                    fontSize: '0.85rem',
                  }}
                >
                  Select a call on the left to view call details and outcome.
                </p>
              ) : (
                <>
                  {/* Selected Call Header */}
                  <div className="integration-detail-header">
                    <div>
                      <strong
                        data-testid="phone-detail-contact-name"
                        style={{ fontSize: '1.02rem', display: 'block', color: 'var(--text-primary)' }}
                      >
                        {selectedContactInfo.name}
                      </strong>
                      <span
                        data-testid="phone-detail-masked-phone"
                        style={{
                          fontSize: '0.78rem',
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        {state.selectedCall.maskedPhoneNumber}
                      </span>
                    </div>
                    <span
                      className={`badge ${lifecycleBadgeClass(state.selectedCall.lifecycleState)}`}
                      data-testid="phone-detail-lifecycle-badge"
                    >
                      {formatPhoneSimpleStatus(state.selectedCall.lifecycleState)}
                    </span>
                  </div>

                  <div className="integration-detail-body">
                    {/* Clear Call Information Block (Contact, Date, Type, Status, Reason) */}
                    <div
                      style={{
                        padding: '0.8rem 0.95rem',
                        borderRadius: '8px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--surface-muted)',
                        fontSize: '0.86rem',
                        display: 'grid',
                        gap: '0.35rem',
                      }}
                      data-testid="phone-detail-summary-card"
                    >
                      <p style={{ margin: 0 }}>
                        <strong>Contact:</strong> {selectedContactInfo.name}
                      </p>
                      <p style={{ margin: 0 }}>
                        <strong>Date:</strong>{' '}
                        <span data-testid="phone-detail-started-at">
                          {formatFriendlyDateTime(state.selectedCall.startedAt, {
                            timeZone,
                            nowMs,
                          })}
                        </span>
                      </p>
                      <p style={{ margin: 0 }}>
                        <strong>Type:</strong>{' '}
                        <span data-testid="phone-detail-direction">
                          {DIRECTION_LABELS[state.selectedCall.direction]}
                        </span>
                      </p>
                      <p style={{ margin: 0 }}>
                        <strong>Status:</strong>{' '}
                        {formatPhoneSimpleStatus(state.selectedCall.lifecycleState)}
                      </p>
                      <p style={{ margin: 0 }}>
                        <strong>Reason:</strong>{' '}
                        <span data-testid="phone-detail-reason">
                          {selectedPurpose.detailReason}
                        </span>
                      </p>
                      {state.selectedCall.durationSeconds !== undefined &&
                        state.selectedCall.durationSeconds > 0 && (
                          <p style={{ margin: 0 }}>
                            <strong>Duration:</strong>{' '}
                            <span data-testid="phone-detail-duration">
                              {formatDuration(state.selectedCall.durationSeconds)}
                            </span>
                          </p>
                        )}
                    </div>

                    {/* Completed Call Details: Actual Conversation Turns (when available) + Clear Outcome */}
                    {state.selectedCall.lifecycleState === 'completed' && (
                      <>
                        <div data-testid="phone-call-conversation">
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '0.35rem',
                              gap: '0.5rem',
                              flexWrap: 'wrap',
                            }}
                          >
                            <strong
                              style={{
                                fontSize: '0.78rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.03em',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              Call Conversation
                            </strong>
                            {selectedCallDialogue && selectedCallDialogue.length > 0 && (
                              <span
                                className="badge badge-warning"
                                data-testid="phone-simulated-dialogue-badge"
                              >
                                SIMULATED DIALOGUE FIXTURE — NO LIVE AUDIO
                              </span>
                            )}
                          </div>

                          <div className="call-conversation-box">
                            {selectedCallDialogue && selectedCallDialogue.length > 0 ? (
                              selectedCallDialogue.map((turn, idx) => {
                                const isThaara = turn.speaker.toLowerCase().includes('thaara');
                                return (
                                  <div
                                    key={`${turn.speaker}-${idx}`}
                                    className="call-dialogue-turn"
                                    data-testid={`phone-dialogue-turn-${idx}`}
                                  >
                                    <span
                                      style={{
                                        display: 'block',
                                        fontSize: '0.74rem',
                                        fontWeight: 600,
                                        color: 'var(--text-secondary)',
                                        marginBottom: '0.15rem',
                                      }}
                                    >
                                      {isThaara
                                        ? 'What Thaara said'
                                        : `What ${selectedContactInfo.name} said`}
                                    </span>
                                    <span style={{ color: 'var(--text-primary)' }}>
                                      "{turn.text}"
                                    </span>
                                  </div>
                                );
                              })
                            ) : (
                              <p
                                style={{
                                  margin: 0,
                                  color: 'var(--text-secondary)',
                                  fontSize: '0.83rem',
                                }}
                                data-testid="phone-conversation-unavailable"
                              >
                                Call conversation unavailable — this integration currently contains
                                call metadata only.
                              </p>
                            )}
                          </div>
                        </div>

                        <div data-testid="phone-call-outcome">
                          <strong
                            style={{
                              fontSize: '0.78rem',
                              textTransform: 'uppercase',
                              letterSpacing: '0.03em',
                              color: 'var(--text-secondary)',
                              display: 'block',
                              marginBottom: '0.35rem',
                            }}
                          >
                            CALL OUTCOME
                          </strong>
                          <div
                            data-testid="phone-detail-purpose-summary"
                            className="call-outcome-box"
                            style={{
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {selectedPurpose.outcomeSummary}
                          </div>
                        </div>
                      </>
                    )}

                    {state.selectedCall.failureReason && (
                      <div
                        data-testid="phone-detail-failure-reason"
                        className="error-banner"
                        style={{ marginBottom: 0 }}
                      >
                        <strong>Call Note:</strong> {state.selectedCall.failureReason}
                      </div>
                    )}

                    {/* Advanced Technical & Privacy Details */}
                    <details className="integration-settings-drawer" style={{ margin: 0 }}>
                      <summary>Technical &amp; Privacy Details</summary>
                      <div
                        className="integration-settings-body"
                        data-testid="phone-detail-privacy-controls"
                      >
                        <span>Recording Available: No (Disabled)</span>
                        <span>Transcript Available: No (Disabled)</span>
                        <span>
                          Original record summary: {state.selectedCall.purposeSummary}
                        </span>
                      </div>
                    </details>
                  </div>

                  {/* Disabled outbound call / recording footer */}
                  <div className="integration-detail-footer">
                    <span>
                      Outbound calling, audio recording, and live transcription are disabled.
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled
                      data-testid="phone-outbound-disabled-btn"
                      style={{ padding: '0.32rem 0.7rem', fontSize: '0.76rem' }}
                    >
                      Request Outbound Call (Approval Required — Disabled)
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
