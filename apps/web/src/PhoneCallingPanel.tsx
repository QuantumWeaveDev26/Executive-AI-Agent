import React, { useEffect, useState } from 'react';
import { ApiRequestError } from './api';
import {
  LANGUAGE_LABELS,
  loadPhoneCallingHistory,
  loadPhoneCallingStatus,
  phoneCallingStateLabel,
  phoneDispatchLabel,
  preparePhoneCall,
  resolvePhoneCallingContact,
  speakPhoneCallReport,
  startPhoneCall,
  loadPhoneCallingRequests,
  type PhoneCallingRequest,
  type PhoneCallingCandidate,
  type PhoneCallingLanguage,
  type PhoneCallingPrepared,
  type PhoneCallingRecord,
  type PhoneCallingStatus,
  type SpeechOutcome,
} from './phone-calling';

export interface PhoneCallingPanelState {
  status: PhoneCallingStatus | null;
  calls: PhoneCallingRecord[];
  candidates: PhoneCallingCandidate[];
  selectedContactId?: string;
  prepared: PhoneCallingPrepared | null;
  error: string | null;
  busy: boolean;
  speech?: { callId: string; outcome: SpeechOutcome };
  /** Open call requests from the server, so an approved live request can be started after a reload. */
  requests: PhoneCallingRequest[];
  /** approvalId awaiting the confirming second click. */
  confirmStart?: string;
  startedApprovalIds?: string[];
}

export interface PhoneCallingPanelProps {
  /** Tests/static rendering only; when given, nothing is loaded from the server. */
  initialState?: Partial<PhoneCallingPanelState>;
}

const EMPTY: PhoneCallingPanelState = { status: null, calls: [], candidates: [], prepared: null, error: null, busy: false, requests: [] };
const SPEECH_TEXT: Record<SpeechOutcome, string> = {
  speaking: 'Reading the report aloud.',
  unavailable: 'Voice playback is not available in this browser. The written report above is unchanged.',
  empty: 'There is nothing to read aloud for this call.',
};
const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Request failed.') + (/no call was made/i.test(String((e as Error)?.message)) ? '' : ' No call was made.');

export function PhoneCallingPanel({ initialState }: PhoneCallingPanelProps) {
  const [state, setState] = useState<PhoneCallingPanelState>({ ...EMPTY, ...initialState });
  const [contactQuery, setContactQuery] = useState('');
  const [purpose, setPurpose] = useState('');
  const [language, setLanguage] = useState<PhoneCallingLanguage>('en-IN');
  const patch = (p: Partial<PhoneCallingPanelState>) => setState((s) => ({ ...s, ...p }));

  useEffect(() => {
    if (initialState) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const [status, history] = await Promise.all([loadPhoneCallingStatus(controller.signal), loadPhoneCallingHistory(controller.signal)]);
        patch({ status, calls: history.calls });
        // Requests are a convenience: if they fail to load, calling still works from a fresh request.
        try { patch({ requests: await loadPhoneCallingRequests(controller.signal) }); } catch { /* keep empty */ }
      } catch (e) {
        if (!controller.signal.aborted) patch({ error: message(e) });
      }
    })();
    return () => controller.abort();
  }, [initialState]);

  const contactsReady = !!state.status?.contactDirectoryConfigured;

  const findContact = async (e: React.FormEvent) => {
    e.preventDefault();
    patch({ busy: true, error: null, candidates: [], selectedContactId: undefined, prepared: null, confirmStart: undefined });
    try {
      const r = await resolvePhoneCallingContact(contactQuery);
      patch({
        busy: false,
        candidates: r.candidates,
        selectedContactId: r.status === 'matched' ? r.candidates[0]!.id : undefined,
        error: r.status === 'not_found' ? 'No saved contact matches that name exactly. No call was made.' : null,
      });
    } catch (err) {
      patch({ busy: false, error: message(err) });
    }
  };

  const prepare = async () => {
    if (!state.selectedContactId) return;
    patch({ busy: true, error: null });
    try {
      const prepared = await preparePhoneCall({ contactQuery, selectedContactId: state.selectedContactId, purpose, language });
      patch({ busy: false, prepared, confirmStart: undefined });
    } catch (err) {
      patch({ busy: false, error: message(err) });
    }
  };

  // Two clicks: the first only asks for confirmation; the second sends exactly one start request.
  const started = (approvalId: string) => !!state.startedApprovalIds?.includes(approvalId);
  const start = async (target: { approvalId: string; draft: PhoneCallingPrepared['draft'] }) => {
    if (target.draft.mode !== 'live' || started(target.approvalId) || state.busy) return;
    if (state.confirmStart !== target.approvalId) { patch({ confirmStart: target.approvalId, error: null }); return; }
    patch({ busy: true, error: null });
    try {
      const call = await startPhoneCall(target);
      setState((s) => ({ ...s, busy: false, confirmStart: undefined, startedApprovalIds: [...(s.startedApprovalIds ?? []), target.approvalId],
        requests: s.requests.filter((q) => q.approvalId !== target.approvalId), calls: [call, ...s.calls.filter((c) => c.id !== call.id)] }));
    } catch (err) {
      const status = err instanceof ApiRequestError ? err.status : 0;
      patch({ busy: false, confirmStart: undefined, error: status === 403 ? 'Approve this request in Approvals first. No call was made.' : status === 503 ? 'Live calling is not enabled. No call was made.' : message(err) });
    }
  };

  const startControls = (target: { approvalId: string; draft: PhoneCallingPrepared['draft'] }) => started(target.approvalId) ? null : (
    <>
      <button type="button" className="btn btn-primary" disabled={state.busy} onClick={() => void start(target)} data-testid="phone-ai-start">
        {state.confirmStart === target.approvalId ? `Confirm: call ${target.draft.recipient.displayName} now` : 'Start this call'}
      </button>
      {state.confirmStart === target.approvalId && !state.busy && (
        <button type="button" className="btn btn-secondary" onClick={() => patch({ confirmStart: undefined })} data-testid="phone-ai-start-cancel">Cancel</button>
      )}
    </>
  );

  const speak = (call: PhoneCallingRecord) => patch({ speech: { callId: call.id, outcome: speakPhoneCallReport(call) } });

  return (
    <div className="integration-detail-card" data-testid="phone-ai-calling-panel" aria-labelledby="phone-ai-heading">
      <h3 id="phone-ai-heading" className="integration-subtitle">AI calling</h3>

      {!state.status && !state.error && <p data-testid="phone-ai-loading">Checking AI calling setup…</p>}

      {state.status && (
        <p data-testid="phone-ai-status" className="integration-muted">
          {state.status.status === 'live_enabled'
            ? 'LIVE calling is on. Each approved request can place one real call, only when you start it. Calls are not recorded.'
            : <>{state.status.status === 'not_configured'
              ? 'Setup required: a phone provider and saved contacts are not configured yet. Thaara cannot place calls.'
              : 'Test mode: calls are simulated only.'}{' '}
              Real calling is turned off. Approving a request cannot dial a number. Calls are not recorded.</>}
        </p>
      )}

      {state.error && <div className="error-banner" role="alert" data-testid="phone-ai-error">{state.error}</div>}

      {state.status && contactsReady && (
        <form onSubmit={(e) => void findContact(e)} data-testid="phone-ai-form">
          <label>
            Who should Thaara call?
            <input value={contactQuery} maxLength={128} onChange={(e) => setContactQuery(e.target.value)} data-testid="phone-ai-contact" />
          </label>
          <label>
            What should Thaara ask?
            <textarea value={purpose} maxLength={1000} onChange={(e) => setPurpose(e.target.value)} data-testid="phone-ai-purpose" />
          </label>
          <label>
            Language
            <select value={language} onChange={(e) => setLanguage(e.target.value as PhoneCallingLanguage)} data-testid="phone-ai-language">
              {state.status!.languages.map((l) => <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-secondary" disabled={state.busy || !contactQuery.trim() || !purpose.trim()} data-testid="phone-ai-find">
            Find contact
          </button>
        </form>
      )}

      {state.candidates.length > 1 && (
        <fieldset data-testid="phone-ai-candidates">
          <legend>More than one contact matches. Choose exactly one.</legend>
          {state.candidates.map((c) => (
            <label key={c.id}>
              <input type="radio" name="phone-ai-candidate" checked={state.selectedContactId === c.id} onChange={() => patch({ selectedContactId: c.id, prepared: null })} />
              {c.displayName} ({c.maskedPhone})
            </label>
          ))}
        </fieldset>
      )}

      {state.selectedContactId && !state.prepared && (
        <button type="button" className="btn btn-primary" disabled={state.busy || !purpose.trim()} onClick={() => void prepare()} data-testid="phone-ai-prepare">
          Prepare call request for approval
        </button>
      )}

      {state.prepared && (
        <div className="integration-detail-card" data-testid="phone-ai-prepared">
          <strong>Awaiting your approval</strong>
          <dl>
            <dt>Call</dt><dd>{state.prepared.draft.recipient.displayName} ({state.prepared.draft.recipient.maskedPhone})</dd>
            <dt>Purpose</dt><dd>{state.prepared.draft.purpose}</dd>
            <dt>Language</dt><dd>{LANGUAGE_LABELS[state.prepared.draft.language]}</dd>
            <dt>Maximum length</dt><dd>{state.prepared.draft.maxDurationSeconds} seconds</dd>
            <dt>Thaara will say first</dt><dd>{state.prepared.draft.aiDisclosure}</dd>
          </dl>
          {state.prepared.draft.mode === 'live' ? (
            <>
              <p className="integration-muted" data-testid="phone-ai-live-note">
                This is a LIVE request. Approve it in Approvals first. Thaara calls only when you press Start, and only once.
              </p>
              {startControls(state.prepared)}
            </>
          ) : (
            <p className="integration-muted">
              Review this request in Approvals. Real calling is turned off, so approving it will not place a call.
            </p>
          )}
        </div>
      )}

      {state.requests.length > 0 && (
        <div data-testid="phone-ai-requests">
          <h4>Your call requests</h4>
          <ul>
            {state.requests.map((q) => (
              <li key={q.approvalId} data-testid="phone-ai-request">
                <span className="badge badge-info">{q.draft.mode === 'live' ? 'LIVE' : 'Simulation'}</span>{' '}
                <strong>{q.draft.recipient.displayName}</strong> ({q.draft.recipient.maskedPhone}) · {q.status === 'approved' ? 'Approved' : 'Awaiting your approval'}
                <div className="integration-muted">{q.draft.purpose}</div>
                {q.status === 'approved' && q.draft.mode === 'live' ? startControls(q) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.status && (
        <div data-testid="phone-ai-history">
          <h4>Call reports</h4>
          {state.calls.length === 0 ? (
            <p className="integration-muted" data-testid="phone-ai-history-empty">No AI call reports yet.</p>
          ) : (
            <ul>
              {state.calls.map((call) => (
                <li key={call.id} data-testid="phone-ai-call">
                  <span className="badge badge-info">{call.simulated ? 'Simulation — not a real call' : 'LIVE call'}</span>{' '}
                  <strong>{call.draft.recipient.displayName}</strong> ({call.draft.recipient.maskedPhone}) · {phoneCallingStateLabel(call.state)}
                  {!call.simulated && <div className="integration-muted" data-testid="phone-ai-dispatch">{phoneDispatchLabel(call.dispatchStatus)}</div>}
                  <p>{call.report.text}</p>
                  <button type="button" className="btn btn-secondary" onClick={() => speak(call)} data-testid="phone-ai-speak">
                    Read report aloud
                  </button>
                  {state.speech?.callId === call.id && <span role="status" data-testid="phone-ai-speech">{SPEECH_TEXT[state.speech.outcome]}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
