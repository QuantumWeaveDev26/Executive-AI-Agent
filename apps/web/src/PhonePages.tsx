import {PhoneCallReport} from './PhoneCallReport';
import {PhoneCallbackReports} from './PhoneCallbackReports';
import {PhoneAppointmentReview} from './PhoneAppointmentReview';
import {
  PhoneCallRecordingPlayer,
  PhoneCallTranscriptPanel,
  PhoneOutgoingIcon,
  PhoneStatusBadge,
  formatCallDuration,
  formatShortDateTime,
  formatMaskedPhone,
  formatCallSecondaryLine,
  type CallMediaMetadata
} from './PhoneCallMediaOptions';
import { useEffect, useState } from 'react';
import { ApiRequestError } from './api';
import { PhoneCallChatCard } from './PhoneCallChatCard';
import {
  callReportSentence,
  createPhoneContact,
  listPhoneContacts,
  loadPhoneCallingHistory,
  phoneCallingStateLabel,
  phoneDispatchLabel,
  preparePhoneCall,
  resolvePhoneCallingContact,
  updatePhoneContact,
  type PhoneCallingCandidate,
  type PhoneCallingRecord,
  type PhoneContactView,
} from './phone-calling';

/**
 * Owner-requested Phone pages (31 Oct 2026): a simple call form, a phone-style contact list and call history.
 * Every real call still goes through the server's consent, approval, daily-limit and no-redial checks; the last step is always
 * one explicit "Call <name> now" click on a preview showing the exact person and masked number.
 */

/** Accepts a 10-digit Indian mobile (optionally with +91, 91 or 0, spaces or dashes) and returns +91XXXXXXXXXX, else null. */
export function normalizeIndianMobile(input: string): string | null {
  const s = input.replace(/[\s()-]/g, '');
  const m = /^(?:\+91|91|0)?([6-9][0-9]{9})$/.exec(s);
  return m ? `+91${m[1]}` : null;
}

/** A contact can be called only with current recorded consent; otherwise the owner re-confirms by saving it again. */
export const contactNeedsConfirmation = (c: PhoneContactView) => !c.consent.callingAllowed || c.consent.expired;

/** Saving a contact is the owner's confirmation that the person agreed to calls from Thaara (an AI); never inferred. */
const OWNER_CONFIRMED_CONSENT = { callingAllowed: true, source: 'recipient_verbal' as const, validDays: 365 };
const CONSENT_LINE = 'Saving confirms this person agreed to get calls from Thaara, an AI assistant.';

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) {
    if (err.status === 403) return 'This contact needs your confirmation before calling. Open Contacts, edit the contact and save it again.';
    if (err.status === 503) return 'Calling is not available right now. No call was made.';
    if (err.status === 429) return /daily call limit/i.test(err.message) ? err.message : (err.message || 'Calling rate limit reached. Please wait a moment and try again.');
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

// ---------- Shared: prepare a request, then show the existing call card (preview → "Call <name> now" → report) ----------

export interface CallComposerState {
  candidates: PhoneCallingCandidate[];
  approvalId: string | null;
  busy: boolean;
  error: string | null;
}
const EMPTY_COMPOSER: CallComposerState = { candidates: [], approvalId: null, busy: false, error: null };

async function prepareFor(contactQuery: string, purpose: string, selectedContactId: string) {
  return preparePhoneCall({ contactQuery, selectedContactId, purpose, language: 'en-IN' });
}

// ---------- Phone page ----------

export interface PhoneCallPageProps { initialState?: Partial<CallComposerState> & { who?: string; ask?: string } }

export function PhoneCallPage({ initialState }: PhoneCallPageProps) {
  const [who, setWho] = useState(initialState?.who ?? '');
  const [ask, setAsk] = useState(initialState?.ask ?? '');
  const [state, setState] = useState<CallComposerState>({ ...EMPTY_COMPOSER, ...initialState });
  const patch = (p: Partial<CallComposerState>) => setState((s) => ({ ...s, ...p }));

  const prepare = async (candidate: PhoneCallingCandidate) => {
    patch({ busy: true, error: null });
    try {
      const prepared = await prepareFor(candidate.displayName, ask.trim(), candidate.id);
      patch({ busy: false, candidates: [], approvalId: prepared.approvalId });
    } catch (err) {
      patch({ busy: false, error: errorMessage(err, 'The call could not be prepared. No call was made.') });
    }
  };

  const call = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!who.trim() || !ask.trim() || state.busy) return;
    patch({ busy: true, error: null, candidates: [], approvalId: null });
    try {
      const found = await resolvePhoneCallingContact(who);
      if (found.status === 'not_found') {
        patch({ busy: false, error: `No saved contact is called "${who.trim()}". Save them in Contacts first.` });
      } else if (found.status === 'ambiguous') {
        patch({ busy: false, candidates: found.candidates });
      } else {
        await prepare(found.candidates[0]!);
      }
    } catch (err) {
      patch({ busy: false, error: errorMessage(err, 'The contact could not be found. No call was made.') });
    }
  };

  const cancel = () => { setWho(''); setAsk(''); setState(EMPTY_COMPOSER); };

  return (
    <section className="integration-card phone-simple" data-testid="phone-call-page" aria-labelledby="phone-call-heading">
      <h2 id="phone-call-heading" className="integration-title">Phone</h2>
      <form onSubmit={(e) => void call(e)} className="phone-simple-form">
        <label>
          Who should Thaara call?
          <input value={who} maxLength={128} onChange={(e) => setWho(e.target.value)} placeholder="Contact name" data-testid="phone-who" />
        </label>
        <label>
          What should Thaara ask?
          <textarea value={ask} maxLength={1000} onChange={(e) => setAsk(e.target.value)} rows={3} data-testid="phone-ask" />
        </label>
        <div className="phone-simple-actions">
          <button type="submit" className="btn btn-primary" disabled={state.busy || !who.trim() || !ask.trim()} data-testid="phone-call">
            {state.busy ? 'Preparing…' : 'Call'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={cancel} data-testid="phone-cancel">Cancel</button>
        </div>
      </form>

      {state.candidates.length > 1 && (
        <div className="phone-candidates" data-testid="phone-candidates">
          <p>More than one contact matches. Choose who to call:</p>
          {state.candidates.map((c) => (
            <button key={c.id} type="button" className="btn btn-secondary" disabled={state.busy} onClick={() => void prepare(c)}>
              {c.displayName} ({c.maskedPhone})
            </button>
          ))}
        </div>
      )}
      {state.error && <div className="error-banner" role="alert" data-testid="phone-error">{state.error}</div>}
      {/* Preview with the exact person and masked number; one click on "Call <name> now" places the single call, then the report appears here. */}
      {state.approvalId && <PhoneCallChatCard key={state.approvalId} approvalId={state.approvalId} />}
    </section>
  );
}

// ---------- Contacts page ----------

type ContactModal =
  | { kind: 'save' }
  | { kind: 'edit'; contact: PhoneContactView }
  | { kind: 'call'; contact: PhoneContactView };

export interface PhoneContactsPageState {
  contacts: PhoneContactView[] | null;
  error: string | null;
  notice: string | null;
  busy: boolean;
  modal: ContactModal | null;
  approvalId: string | null;
}
export interface PhoneContactsPageProps { initialState?: Partial<PhoneContactsPageState> }
const EMPTY_CONTACTS: PhoneContactsPageState = { contacts: null, error: null, notice: null, busy: false, modal: null, approvalId: null };

export function PhoneContactsPage({ initialState }: PhoneContactsPageProps) {
  const [state, setState] = useState<PhoneContactsPageState>({ ...EMPTY_CONTACTS, ...initialState });
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [ask, setAsk] = useState('');
  const patch = (p: Partial<PhoneContactsPageState>) => setState((s) => ({ ...s, ...p }));

  const reload = async (signal?: AbortSignal) => {
    try { patch({ contacts: await listPhoneContacts(signal) }); }
    catch (err) { if (!signal?.aborted) patch({ contacts: [], error: errorMessage(err, 'Contacts could not be loaded.') }); }
  };
  useEffect(() => {
    if (initialState) return;
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [initialState]);

  const open = (modal: ContactModal) => {
    setName(modal.kind === 'save' ? '' : modal.contact.displayName); setNumber(''); setAsk('');
    patch({ modal, error: null, notice: null, approvalId: null });
  };
  const close = () => patch({ modal: null, approvalId: null });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const modal = state.modal;
    if (!modal || modal.kind === 'call' || state.busy) return;
    const phone = number.trim() ? normalizeIndianMobile(number) : null;
    if (modal.kind === 'save' && !phone) { patch({ error: 'Enter a 10-digit Indian mobile number.' }); return; }
    if (number.trim() && !phone) { patch({ error: 'Enter a 10-digit Indian mobile number, or leave it empty to keep the saved one.' }); return; }
    patch({ busy: true, error: null });
    try {
      const form = { displayName: name, aliases: modal.kind === 'edit' ? modal.contact.aliases : [], phoneE164: phone ?? undefined, consent: OWNER_CONFIRMED_CONSENT };
      const saved = modal.kind === 'save' ? await createPhoneContact(form) : await updatePhoneContact(modal.contact.contactId, modal.contact.revision, form);
      patch({ busy: false, modal: null, notice: `Saved ${saved.displayName} (${saved.maskedPhone}).` });
      await reload();
    } catch (err) {
      patch({ busy: false, error: errorMessage(err, 'The contact could not be saved.') });
    }
  };

  const startCall = (c: PhoneContactView) => (contactNeedsConfirmation(c) ? open({ kind: 'edit', contact: c }) : open({ kind: 'call', contact: c }));

  const prepareCall = async (e: React.FormEvent) => {
    e.preventDefault();
    const modal = state.modal;
    if (!modal || modal.kind !== 'call' || !ask.trim() || state.busy) return;
    patch({ busy: true, error: null });
    try {
      const prepared = await prepareFor(modal.contact.displayName, ask.trim(), modal.contact.contactId);
      patch({ busy: false, approvalId: prepared.approvalId });
    } catch (err) {
      patch({ busy: false, error: errorMessage(err, 'The call could not be prepared. No call was made.') });
    }
  };

  const modal = state.modal;
  return (
    <section className="integration-card" data-testid="phone-contacts-page" aria-labelledby="phone-contacts-heading">
      <header className="phone-list-header">
        <h2 id="phone-contacts-heading" className="integration-title">Contacts</h2>
        <button type="button" className="btn btn-primary" onClick={() => open({ kind: 'save' })} data-testid="phone-save-contact">Save contact</button>
      </header>
      {state.notice && <p role="status" data-testid="phone-contacts-notice">{state.notice}</p>}
      {!modal && state.error && <div className="error-banner" role="alert">{state.error}</div>}
      {state.contacts === null && <p className="integration-muted">Loading contacts…</p>}
      {state.contacts?.length === 0 && <p className="integration-muted" data-testid="phone-contacts-empty">No contacts yet. Use "Save contact" to add someone.</p>}
      {!!state.contacts?.length && (
        <ul className="phone-contact-list" data-testid="phone-contact-list">
          {state.contacts.map((c) => (
            <li key={c.contactId} className="phone-contact-row" data-testid="phone-contact-row">
              <span className="phone-contact-avatar" aria-hidden="true">{c.displayName.trim().charAt(0).toUpperCase()}</span>
              <span className="phone-contact-text">
                <strong>{c.displayName}</strong>
                <span className="integration-muted">{c.maskedPhone}</span>
                {contactNeedsConfirmation(c) && <span className="phone-contact-warning" data-testid="phone-contact-needs-confirmation">Needs your confirmation before calling</span>}
              </span>
              <button type="button" className="btn btn-secondary" onClick={() => open({ kind: 'edit', contact: c })} data-testid="phone-contact-edit">Edit</button>
              <button type="button" className="btn btn-primary" onClick={() => startCall(c)} data-testid="phone-contact-call">Call</button>
            </li>
          ))}
        </ul>
      )}

      {modal && (
        <div className="wa-modal" role="dialog" aria-modal="true" aria-labelledby="phone-modal-title" data-testid="phone-contact-modal">
          <div className="wa-contacts">
            {modal.kind !== 'call' ? (
              <form onSubmit={(e) => void save(e)}>
                <h3 id="phone-modal-title">{modal.kind === 'save' ? 'Save contact' : `Edit ${modal.contact.displayName}`}</h3>
                <label>Name<input value={name} maxLength={128} onChange={(e) => setName(e.target.value)} data-testid="phone-contact-name" /></label>
                <label>
                  {modal.kind === 'save' ? 'Mobile number' : 'New mobile number (leave empty to keep the saved number)'}
                  <input value={number} inputMode="tel" autoComplete="off" placeholder="10-digit mobile number" onChange={(e) => setNumber(e.target.value)} data-testid="phone-contact-number" />
                </label>
                <p className="integration-muted" data-testid="phone-consent-line">{CONSENT_LINE}</p>
                {state.error && <div className="error-banner" role="alert">{state.error}</div>}
                <footer>
                  <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={state.busy || !name.trim()} data-testid="phone-contact-submit">Save</button>
                </footer>
              </form>
            ) : (
              <div>
                <h3 id="phone-modal-title">Call {modal.contact.displayName} ({modal.contact.maskedPhone})</h3>
                {!state.approvalId && (
                  <form onSubmit={(e) => void prepareCall(e)}>
                    <label>What should Thaara ask?<textarea value={ask} maxLength={1000} rows={3} onChange={(e) => setAsk(e.target.value)} data-testid="phone-contact-ask" /></label>
                    {state.error && <div className="error-banner" role="alert">{state.error}</div>}
                    <footer>
                      <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
                      <button type="submit" className="btn btn-primary" disabled={state.busy || !ask.trim()} data-testid="phone-contact-prepare">Continue</button>
                    </footer>
                  </form>
                )}
                {state.approvalId && (
                  <>
                    <PhoneCallChatCard key={state.approvalId} approvalId={state.approvalId} />
                    <footer><button type="button" className="btn btn-secondary" onClick={close}>Close</button></footer>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- Call history page ----------

export interface PhoneHistoryPageState {
  calls: PhoneCallingRecord[] | null;
  error: string | null;
  openId: string | null;
  activeOption?: { id: string; tab: 'recording' | 'transcript' } | null;
}
export interface PhoneHistoryPageProps { initialState?: Partial<PhoneHistoryPageState>; title?: string; ownerIdentity?:{role:string;userId:string;workspaceId:string} }

function buildOutboundMediaMetadata(c: PhoneCallingRecord): CallMediaMetadata {
  const sd = c.syncedDetails;
  const fallbackTurns = (c.report.conversation?.turns ?? [])
    .filter((t) => t.speaker === 'thaara' || t.speaker === 'customer')
    .map((t) => ({ speaker: t.speaker as 'thaara' | 'customer', text: t.text }));
  const quotedFallback =
    fallbackTurns.length === 0 && Array.isArray(c.report.quotedResponses) && c.report.quotedResponses.length > 0
      ? c.report.quotedResponses.map((q) => ({
          speaker: 'customer' as const,
          text: q,
          languageBasis: 'provider_english' as const,
        }))
      : [];
  const transcript = sd && sd.transcript.length > 0 ? sd.transcript : fallbackTurns.length > 0 ? fallbackTurns : quotedFallback;
  const callbackStatus =
    sd?.callbackStatus === 'confirmed'
      ? 'Callback requested (confirmed)'
      : sd?.callbackStatus === 'needs_review'
        ? 'Needs review'
        : null;
  return {
    direction: 'outbound',
    callId: c.id,
    recordingAvailable: sd ? Boolean(sd.recordingAvailable) : Boolean(!c.simulated && c.state === 'completed' && c.providerCallId),
    customerName: sd?.customerName ?? c.draft.recipient.displayName,
    phoneNumber: sd?.phoneNumber ?? c.draft.recipient.maskedPhone,
    business: sd?.business ?? null,
    interestedService: sd?.serviceNeeded ?? null,
    requirements: sd?.requirements ?? c.draft.purpose,
    preferredCallbackTime: sd?.preferredCallbackTime ?? null,
    callDate: `${new Date(sd?.occurredAt ?? c.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
    durationSeconds: sd?.durationSeconds ?? null,
    outcome: sd?.outcomeLabel ?? phoneCallingStateLabel(c.state),
    callbackStatus,
    summary: sd?.summary ?? (quotedFallback.length > 0 ? `${callReportSentence(c)} (Full agent transcript unavailable.)` : null),
    transcript,
  };
}

export function PhoneHistoryPage({ initialState, title='Call history', ownerIdentity }: PhoneHistoryPageProps) {
  const [state, setState] = useState<PhoneHistoryPageState>({ calls: null, error: null, openId: null, activeOption: null, ...initialState });
  useEffect(() => {
    if (initialState) return;
    const controller = new AbortController();
    void loadPhoneCallingHistory(controller.signal)
      .then((h) => {
        if(controller.signal.aborted)return;
        const requested=typeof window==='undefined'?[]:new URLSearchParams(window.location.search).getAll('callId');
        const id=requested.length===1&&/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(requested[0]!)?requested[0]:null;
        // The URL chooses a view only. The authenticated history and owner review enforce access.
        const selected=id?h.calls.find(c=>c.id===id&&!c.simulated&&c.state==='completed'&&!!c.providerCallId):null;
        setState((s) => ({ ...s, calls: h.calls,...(selected?{openId:selected.id}:{}) }));
      })
      .catch((err) => { if (!controller.signal.aborted) setState((s) => ({ ...s, calls: [], error: errorMessage(err, 'Call history could not be loaded.') })); });
    return () => controller.abort();
  }, [initialState]);

  return (
    <section className="integration-card" data-testid="phone-history-page" aria-labelledby="phone-history-heading">
      <h2 id="phone-history-heading" className="integration-title">{title}</h2>
      {ownerIdentity?.role === 'owner' && <PhoneCallbackReports key={ownerIdentity.workspaceId + ':' + ownerIdentity.userId} direction="outbound" />}
      {state.error && <div className="error-banner" role="alert">{state.error}</div>}
      {state.calls === null && <p className="integration-muted">Loading calls…</p>}
      {state.calls?.length === 0 && <p className="integration-muted" data-testid="phone-history-empty">No calls yet.</p>}
      {!!state.calls?.length && (
        <ul className="phone-contact-list" data-testid="phone-history-list">
          {state.calls.map((c) => {
            const open = state.openId === c.id;
            const opt = state.activeOption?.id === c.id ? state.activeOption.tab : null;
            const isDetailsOpen = open && !opt;
            const mediaMeta = buildOutboundMediaMetadata(c);
            const durText = formatCallDuration(c.syncedDetails?.durationSeconds);
            const statusBadge = c.syncedDetails?.outcomeLabel || (c.syncedDetails?.callbackStatus === 'confirmed' ? 'Callback Requested' : (c.syncedDetails?.callbackStatus === 'needs_review' ? 'Needs Review' : (c.state === 'completed' ? 'Completed' : (c.state === 'failed' ? 'Needs Review' : phoneCallingStateLabel(c.state)))));
            const secLine = formatCallSecondaryLine({
              business: c.syncedDetails?.business,
              interestedService: c.syncedDetails?.serviceNeeded,
              durationSeconds: c.syncedDetails?.durationSeconds
            });
            const closeAll = () => setState((s) => ({ ...s, activeOption: null, openId: null }));

            return (
              <li key={c.id} className="phone-history-row phone-history-card" data-testid="phone-history-row">
                <div className="phone-card-top">
                  <div className="phone-card-icon-wrap">
                    <PhoneOutgoingIcon />
                  </div>
                  <div className="phone-card-content">
                    <div className="phone-card-header-row">
                      <span className="phone-card-name">{c.draft.recipient.displayName || c.draft.recipient.maskedPhone}</span>
                      <PhoneStatusBadge status={statusBadge} />
                    </div>
                    <div className="phone-card-subline" title={c.draft.recipient.maskedPhone}>
                      <span>{formatMaskedPhone(c.draft.recipient.maskedPhone)}</span>
                      <span className="sr-only" style={{ display: 'none' }}>{c.draft.recipient.maskedPhone}</span>
                      <span> · </span>
                      <span>{formatShortDateTime(c.syncedDetails?.occurredAt ?? c.createdAt)}</span>
                    </div>
                    {secLine && <div className="phone-card-secondary">{secLine}</div>}
                  </div>
                </div>
                <hr className="phone-card-divider" />
                <div className="phone-card-actions">
                  <button
                    type="button"
                    className={`btn btn-secondary phone-pill-btn${opt === 'recording' ? ' active' : ''}`}
                    aria-expanded={opt === 'recording'}
                    aria-label="Call Recording"
                    onClick={() => setState((s) => ({ ...s, openId: null, activeOption: opt === 'recording' ? null : { id: c.id, tab: 'recording' } }))}
                    data-testid="phone-option-recording"
                  >
                    <span aria-hidden="true" style={{ marginRight: '4px' }}>▶</span>
                    <span>Recording</span>
                    <span className="sr-only" style={{ display: 'none' }}>Call Recording</span>
                  </button>
                  <button
                    type="button"
                    className={`btn btn-secondary phone-pill-btn${opt === 'transcript' ? ' active' : ''}`}
                    aria-expanded={opt === 'transcript'}
                    aria-label="Transcript"
                    onClick={() => setState((s) => ({ ...s, openId: null, activeOption: opt === 'transcript' ? null : { id: c.id, tab: 'transcript' } }))}
                    data-testid="phone-option-transcript"
                  >
                    <span aria-hidden="true" style={{ marginRight: '4px' }}>📄</span>
                    <span>Transcript</span>
                  </button>
                  <button
                    type="button"
                    className={`btn btn-secondary phone-pill-btn${isDetailsOpen ? ' active' : ''}`}
                    aria-expanded={isDetailsOpen}
                    onClick={() => setState((s) => ({ ...s, activeOption: null, openId: isDetailsOpen ? null : c.id }))}
                    data-testid="phone-history-details"
                  >
                    <span>{isDetailsOpen ? 'Close Details' : 'Details'}</span>
                    <span className="sr-only" style={{ display: 'none' }}>Details</span>
                  </button>
                </div>
                {opt === 'recording' && (
                  <PhoneCallRecordingPlayer direction="outbound" callId={c.id} recordingAvailable={mediaMeta.recordingAvailable} onClose={closeAll} />
                )}
                {opt === 'transcript' && (
                  <PhoneCallTranscriptPanel metadata={mediaMeta} onClose={closeAll} />
                )}
                {isDetailsOpen && (
                  <div className="phone-history-details" data-testid="phone-history-detail">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <h4 style={{ margin: 0 }}>Call details</h4>
                      <button type="button" className="btn btn-secondary" onClick={closeAll} style={{ padding: '3px 10px', fontSize: '0.8rem' }}>Close</button>
                    </div>
                    <p><strong>Direction:</strong> Outbound</p>
                    <p><strong>Status:</strong> {statusBadge}</p>
                    <p><strong>Customer name:</strong> {c.draft.recipient.displayName}</p>
                    <p><strong>Contact number:</strong> {c.draft.recipient.maskedPhone}</p>
                    {c.syncedDetails?.business && <p><strong>Business:</strong> {c.syncedDetails.business}</p>}
                    {c.syncedDetails?.serviceNeeded && <p><strong>Service:</strong> {c.syncedDetails.serviceNeeded}</p>}
                    {c.syncedDetails?.requirements && <p><strong>Requirements:</strong> {c.syncedDetails.requirements}</p>}
                    <p><strong>Asked:</strong> {c.draft.purpose}</p>
                    <p><strong>Summary:</strong> {c.syncedDetails?.summary ?? callReportSentence(c)}</p>
                    <p><strong>Thaara Call ID:</strong> <code>{c.id}</code></p>
                    {c.providerCallId && <p><strong>Provider Call ID:</strong> <code>{c.providerCallId}</code></p>}
                    {durText && <p><strong>Duration:</strong> {durText}</p>}
                    {c.dispatchStatus && <p><strong>Provider:</strong> {phoneDispatchLabel(c.dispatchStatus)}</p>}
                    <PhoneCallReport call={c} />
                    {ownerIdentity?.role === 'owner' && !c.simulated && c.state === 'completed' && c.providerCallId && /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(c.id) && (
                      <PhoneAppointmentReview id={c.id} direction="outbound" owner={ownerIdentity} customerName={c.draft.recipient.displayName} requestedTime={null} consentConfirmed={false} />
                    )}
                    <p className="integration-muted">{c.simulated ? 'Test simulation — not a real call.' : 'Provider-reported result; not independently verified.'}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
