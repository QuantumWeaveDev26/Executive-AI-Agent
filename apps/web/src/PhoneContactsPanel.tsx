import React, { useEffect, useState } from 'react';
import { ApiRequestError } from './api';
import {
  CONSENT_SOURCE_LABELS,
  archivePhoneContact,
  createPhoneContact,
  listPhoneContacts,
  updatePhoneContact,
  type PhoneContactConsentSource,
  type PhoneContactView,
} from './phone-calling';

export interface PhoneContactsPanelState {
  contacts: PhoneContactView[] | null;
  unavailable: boolean;
  error: string | null;
  notice: string | null;
  busy: boolean;
  editing: { contactId: string; revision: number } | null;
  confirmArchive: string | null;
}

export interface PhoneContactsPanelProps {
  /** Tests/static rendering only; when given, nothing is loaded from the server. */
  initialState?: Partial<PhoneContactsPanelState>;
}

const EMPTY: PhoneContactsPanelState = { contacts: null, unavailable: false, error: null, notice: null, busy: false, editing: null, confirmArchive: null };
const DAY_OPTIONS = [30, 90, 180, 365];
const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Request failed.');
const date = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function consentSummary(c: PhoneContactView): string {
  if (!c.consent.callingAllowed) return 'No calling consent — Thaara will not prepare calls';
  if (c.consent.expired) return `Consent expired ${date(c.consent.expiresAt)} — record it again before calling`;
  return `${CONSENT_SOURCE_LABELS[c.consent.source]} · valid until ${date(c.consent.expiresAt)}`;
}

export function PhoneContactsPanel({ initialState }: PhoneContactsPanelProps) {
  const [state, setState] = useState<PhoneContactsPanelState>({ ...EMPTY, ...initialState });
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [phone, setPhone] = useState('');
  const [allowed, setAllowed] = useState(false);
  const [source, setSource] = useState<PhoneContactConsentSource>('recipient_verbal');
  const [days, setDays] = useState(90);
  const patch = (p: Partial<PhoneContactsPanelState>) => setState((s) => ({ ...s, ...p }));

  const reload = async (signal?: AbortSignal) => {
    try {
      patch({ contacts: await listPhoneContacts(signal), unavailable: false });
    } catch (e) {
      if (signal?.aborted) return;
      if (e instanceof ApiRequestError && e.status === 503) patch({ unavailable: true, contacts: null });
      else patch({ error: message(e) });
    }
  };

  useEffect(() => {
    if (initialState) return;
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [initialState]);

  const resetForm = () => { setName(''); setAliases(''); setPhone(''); setAllowed(false); setSource('recipient_verbal'); setDays(90); };

  const startEdit = (c: PhoneContactView) => {
    setName(c.displayName); setAliases(c.aliases.join(', ')); setPhone(''); setAllowed(c.consent.callingAllowed); setSource(c.consent.source); setDays(90);
    patch({ editing: { contactId: c.contactId, revision: c.revision }, error: null, notice: null, confirmArchive: null });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    patch({ busy: true, error: null, notice: null });
    const form = { displayName: name, aliases: aliases.split(','), phoneE164: phone || undefined, consent: { callingAllowed: allowed, source, validDays: days } };
    try {
      const saved = state.editing
        ? await updatePhoneContact(state.editing.contactId, state.editing.revision, form)
        : await createPhoneContact(form);
      resetForm();
      patch({ busy: false, editing: null, notice: `Saved ${saved.displayName} (${saved.maskedPhone}).` });
      await reload();
    } catch (err) {
      patch({ busy: false, error: message(err) });
    }
  };

  const archive = async (c: PhoneContactView) => {
    if (state.confirmArchive !== c.contactId) { patch({ confirmArchive: c.contactId, notice: null }); return; }
    patch({ busy: true, error: null, confirmArchive: null });
    try {
      await archivePhoneContact(c.contactId, c.revision);
      patch({ busy: false, notice: `Archived ${c.displayName}. Thaara can no longer prepare calls to this contact.` });
      await reload();
    } catch (err) {
      patch({ busy: false, error: message(err) });
    }
  };

  return (
    <div className="integration-detail-card" data-testid="phone-contacts-panel" aria-labelledby="phone-contacts-heading">
      <h3 id="phone-contacts-heading" className="integration-subtitle">Contacts Thaara may call</h3>

      {state.unavailable && (
        <p className="integration-muted" data-testid="phone-contacts-unavailable">
          Saving phone contacts is not set up in this environment yet. Nothing is stored.
        </p>
      )}
      {!state.unavailable && state.contacts === null && !state.error && <p data-testid="phone-contacts-loading">Loading contacts…</p>}
      {state.error && <div className="error-banner" role="alert" data-testid="phone-contacts-error">{state.error}</div>}
      {state.notice && <p role="status" data-testid="phone-contacts-notice">{state.notice}</p>}

      {state.contacts && (
        <>
          {state.contacts.length === 0 ? (
            <p className="integration-muted" data-testid="phone-contacts-empty">No saved contacts yet.</p>
          ) : (
            <ul data-testid="phone-contacts-list">
              {state.contacts.map((c) => (
                <li key={c.contactId} data-testid="phone-contact">
                  <strong>{c.displayName}</strong> ({c.maskedPhone})
                  {c.aliases.length > 0 && <span className="integration-muted"> · also called {c.aliases.join(', ')}</span>}
                  <div className="integration-muted" data-testid="phone-contact-consent">{consentSummary(c)}</div>
                  <button type="button" className="btn btn-secondary" disabled={state.busy} onClick={() => startEdit(c)} data-testid="phone-contact-edit">Edit</button>{' '}
                  <button type="button" className="btn btn-secondary" disabled={state.busy} onClick={() => void archive(c)} data-testid="phone-contact-archive">
                    {state.confirmArchive === c.contactId ? 'Confirm archive' : 'Archive'}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={(e) => void save(e)} data-testid="phone-contact-form">
            <h4>{state.editing ? 'Edit contact' : 'Add a contact'}</h4>
            <label>
              Name
              <input value={name} maxLength={128} onChange={(e) => setName(e.target.value)} data-testid="phone-contact-name" />
            </label>
            <label>
              Other names (comma separated, optional)
              <input value={aliases} onChange={(e) => setAliases(e.target.value)} data-testid="phone-contact-aliases" />
            </label>
            <label>
              {state.editing ? 'New mobile number (leave empty to keep the saved number)' : 'Mobile number (+91…)'}
              <input value={phone} inputMode="tel" autoComplete="off" placeholder="+91XXXXXXXXXX" onChange={(e) => setPhone(e.target.value)} data-testid="phone-contact-phone" />
            </label>
            <label>
              <input type="checkbox" checked={allowed} onChange={(e) => setAllowed(e.target.checked)} data-testid="phone-contact-consent-allowed" />
              This person agreed to receive calls from Thaara, an AI assistant
            </label>
            <label>
              How they agreed
              <select value={source} onChange={(e) => setSource(e.target.value as PhoneContactConsentSource)} data-testid="phone-contact-consent-source">
                {Object.entries(CONSENT_SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label>
              Consent valid for
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="phone-contact-consent-days">
                {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
            </label>
            <p className="integration-muted">
              Saving records consent from today. Without consent Thaara will not prepare calls to this person. Saving never places a call.
            </p>
            <button type="submit" className="btn btn-primary" disabled={state.busy || !name.trim() || (!state.editing && !phone.trim())} data-testid="phone-contact-save">
              {state.editing ? 'Save changes' : 'Save contact'}
            </button>
            {state.editing && (
              <button type="button" className="btn btn-secondary" onClick={() => { resetForm(); patch({ editing: null }); }} data-testid="phone-contact-cancel">Cancel</button>
            )}
          </form>
        </>
      )}
    </div>
  );
}
