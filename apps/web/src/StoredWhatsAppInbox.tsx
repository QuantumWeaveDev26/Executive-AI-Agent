import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createStoredWhatsAppModel, fillTemplate, initialStoredWhatsAppState, lastSeen, loadStoredWhatsAppAttachment, loadStoredWhatsAppTemplates, type StoredTemplate, loadStoredWhatsAppImagePreview, markSeen, ImagePreviewError, type ImagePreviewFailure, type StoredContact, type StoredWhatsAppState } from './whatsapp-stored-inbox';
import { DEFAULT_WORKSPACE_TIMEZONE } from './integration-ui';
import { whatsappDraftPreview } from '../../../packages/contracts/src/meta-whatsapp';
import type { N8nWhatsAppTemplateDraftRequest } from '../../../packages/contracts/src/whatsapp-n8n';
import type { ContactUpdate } from './whatsapp-stored-inbox';
import { WhatsAppContactsManager, WhatsAppFileComposer } from './WhatsAppComposeControls';
export { WhatsAppContactsManager } from './WhatsAppComposeControls';

type Message = NonNullable<StoredWhatsAppState['data']>['messages'][number];
type Conversation = StoredWhatsAppState['conversations'][number];

const previewErrors: Record<ImagePreviewFailure, string> = {
  not_configured: 'Image preview is not set up yet. Nothing was downloaded.',
  denied: 'You do not have access to this image.',
  rate_limited: 'Too many previews right now. Try again in a few minutes.',
  unverified: 'This image could not be safely verified, so it is not shown.'
};
/** Loads one verified image on request. Object URLs are revoked on unmount; nothing is cached or saved. */
export function WhatsAppImagePreview(p: { load(): Promise<Blob> }) {
  const [state, setState] = useState<{ phase: 'idle' | 'loading' | 'ready' | 'failed'; url?: string; reason?: ImagePreviewFailure }>({ phase: 'idle' });
  const live = useRef(true), url = useRef<string>();
  useEffect(() => () => { live.current = false; if (url.current) URL.revokeObjectURL(url.current); }, []);
  const open = async () => {
    setState({ phase: 'loading' });
    try { const blob = await p.load(); if (!live.current) return; url.current = URL.createObjectURL(blob); setState({ phase: 'ready', url: url.current }); }
    catch (error) { if (live.current) setState({ phase: 'failed', reason: error instanceof ImagePreviewError ? error.reason : 'unverified' }); }
  };
  if (state.phase === 'ready') return <figure className="wa-image"><a href={state.url} target="_blank" rel="noopener noreferrer"><img src={state.url} alt="Received WhatsApp image" referrerPolicy="no-referrer" /></a><figcaption>Checked for size, type and fingerprint. Sender content is untrusted.</figcaption></figure>;
  return <div className="wa-image wa-image--placeholder">{state.phase === 'failed' && <span role="alert">{previewErrors[state.reason ?? 'unverified']} </span>}
    <button type="button" disabled={state.phase === 'loading'} onClick={() => void open()}>{state.phase === 'loading' ? 'Checking image…' : state.phase === 'failed' ? 'Try again' : 'Load image preview'}</button></div>;
}

const zone = DEFAULT_WORKSPACE_TIMEZONE;
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: zone });
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
function dayLabel(iso: string, now = Date.now()) {
  const key = dayKey(iso);
  if (key === dayKey(new Date(now).toISOString())) return 'Today';
  if (key === dayKey(new Date(now - 86400000).toISOString())) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: zone, day: 'numeric', month: 'short', year: 'numeric' });
}
function listTime(iso: string, now = Date.now()) { const label = dayLabel(iso, now); return label === 'Today' ? clock(iso) : label; }
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]!.toUpperCase()).join('') || '?';
const hue = (seed: string) => [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
export function Avatar({ name, seed }: { name: string; seed: string }) {
  return <span className="wa-avatar" aria-hidden="true" style={{ background: `hsl(${hue(seed)} 45% 42%)` }}>{initials(name)}</span>;
}

/** Ticks only reflect saved status evidence; "Prepared, not sent" and "Outcome unknown" are never shown as delivered. */
const statusText: Record<Message['status'], string> = { received: 'Received', reserved: 'Prepared, not sent', unverified: 'Outcome unknown', sent: 'Sent', delivered: 'Delivered', read: 'Read', failed: 'Failed' };
export function StatusTicks({ status, live = false }: { status: Message['status']; live?: boolean }) {
  if (status === 'received') return null;
  const text = status === 'reserved' && live ? 'Queued, not yet sent' : statusText[status];
  const tick = (x: number) => <path d={`M${x} 8.5l3 3 6.5-7`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />;
  const icon = status === 'reserved' ? <svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
    : status === 'unverified' ? <svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" /><text x="8" y="11.5" textAnchor="middle" fontSize="9" fill="currentColor">?</text></svg>
    : status === 'failed' ? <svg viewBox="0 0 16 16" width="15" height="15"><circle cx="8" cy="8" r="6.5" fill="currentColor" /><path d="M8 4.5v4.2M8 10.8v.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /></svg>
    : <svg viewBox="0 0 22 16" width="19" height="15">{tick(1)}{status !== 'sent' && tick(6)}</svg>;
  return <span className={'wa-ticks wa-ticks--' + status} title={text} aria-label={text}>{icon}</span>;
}

const EMOJI = ['😀', '😂', '😊', '😍', '🙏', '👍', '👌', '🙌', '👏', '🎉', '❤️', '🔥', '✅', '⭐', '😢', '😮', '🤔', '😅', '😎', '🤝', '📅', '📞', '📎', '⏰', '🚗', '☕', '🌞', '🌙', '💼', '📌', '✍️', '👋'];

/** Audio plays inline from a verified blob; documents are saved through a download link and never rendered. */
export function WhatsAppFileAction(p: { kind: 'document' | 'audio'; load(): Promise<{ blob: Blob; filename: string }> }) {
  const [state, setState] = useState<{ phase: 'idle' | 'loading' | 'ready' | 'saved' | 'failed'; url?: string; reason?: ImagePreviewFailure }>({ phase: 'idle' });
  const live = useRef(true), url = useRef<string>();
  useEffect(() => () => { live.current = false; if (url.current) URL.revokeObjectURL(url.current); }, []);
  const run = async () => {
    setState({ phase: 'loading' });
    try {
      const { blob, filename } = await p.load(); if (!live.current) return;
      const href = URL.createObjectURL(blob);
      if (p.kind === 'audio') { url.current = href; setState({ phase: 'ready', url: href }); return; }
      const a = document.createElement('a'); a.href = href; a.download = filename; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000); setState({ phase: 'saved' });
    } catch (error) { if (live.current) setState({ phase: 'failed', reason: error instanceof ImagePreviewError ? error.reason : 'unverified' }); }
  };
  if (state.phase === 'ready') return <audio controls src={state.url} preload="metadata" className="wa-audio">Your browser cannot play this audio.</audio>;
  const errors = { ...previewErrors, not_configured: 'Attachment access is not set up yet. Nothing was downloaded.', unverified: 'This file could not be safely verified, so it was not downloaded.' };
  return <span className="wa-file__action">{state.phase === 'failed' && <span role="alert">{errors[state.reason ?? 'unverified']} </span>}
    {state.phase === 'saved' && <span role="status">Downloaded. </span>}
    <button type="button" disabled={state.phase === 'loading'} onClick={() => void run()}>{state.phase === 'loading' ? 'Checking file…' : p.kind === 'audio' ? 'Play audio' : state.phase === 'saved' ? 'Download again' : 'Download'}</button></span>;
}

function Attachment({ m, onLoadImage, onLoadAttachment }: { m: Message; onLoadImage?: (id: string) => Promise<Blob>; onLoadAttachment?: (id: string, kind: 'document' | 'audio') => Promise<{ blob: Blob; filename: string }> }) {
  const a = m.attachment!;
  if (a.kind === 'image') return m.providerMessageId && onLoadImage && /^image\/(jpeg|png)(;|$)/.test(a.mimeType)
    ? <WhatsAppImagePreview key={m.id} load={() => onLoadImage(m.providerMessageId!)} />
    : <div className="wa-file"><div><strong>Image attachment</strong><small>{a.mimeType} · Not downloaded</small><small>File preview and playback are unavailable. Only the attachment metadata is saved.</small></div></div>;
  return <div className="wa-file"><span className="wa-file__icon" aria-hidden="true">{a.kind === 'document' ? '📄' : '🎵'}</span>
    <div><strong>{a.kind === 'document' ? (a.filename ?? 'Document attachment') : 'Audio attachment'}</strong>
      <small>{a.kind === 'document' ? 'Document attachment · ' : ''}{a.mimeType} · Not downloaded</small>
      {m.providerMessageId && onLoadAttachment ? <WhatsAppFileAction key={m.id} kind={a.kind} load={() => onLoadAttachment(m.providerMessageId!, a.kind as 'document' | 'audio')} />
        : <small>{a.kind === 'document' ? 'Secure document download is not available here.' : 'Audio playback is not available here.'}</small>}</div></div>;
}

/** Template picker: approved templates, variables and a live preview. Sending a template is not enabled yet. */
export function WhatsAppTemplatePicker(p: { load(): Promise<StoredTemplate[]>; onClose(): void; onPrepare?(input: Omit<N8nWhatsAppTemplateDraftRequest, 'recipientId'>): void }) {
  const [state, setState] = useState<{ phase: 'loading' | 'ready' | 'failed'; items: StoredTemplate[]; message?: string }>({ phase: 'loading', items: [] });
  const [chosen, setChosen] = useState<StoredTemplate | null>(null), [values, setValues] = useState<string[]>([]), [header, setHeader] = useState('');
  useEffect(() => { let live = true; p.load().then(items => { if (live) setState({ phase: 'ready', items }); }, (error: unknown) => { if (live) setState({ phase: 'failed', items: [], message: (error as { status?: number })?.status === 503 ? 'Templates are not set up yet (Meta access key needed).' : 'Templates could not be loaded. Try again later.' }); }); return () => { live = false; }; }, []);
  const statusLabel: Record<StoredTemplate['status'], string> = { APPROVED: 'Approved', PENDING: 'Pending review', REJECTED: 'Rejected', PAUSED: 'Paused', DISABLED: 'Disabled' };
  return <div className="wa-templates" role="dialog" aria-label="WhatsApp templates">
    <div className="wa-templates__head"><strong>Message templates</strong><button type="button" className="wa-icon-btn" aria-label="Close templates" onClick={p.onClose}>×</button></div>
    {state.phase === 'loading' && <p className="wa-muted" role="status">Loading templates…</p>}
    {state.phase === 'failed' && <p className="wa-muted" role="alert">{state.message}</p>}
    {state.phase === 'ready' && !state.items.length && <p className="wa-muted">No templates exist on this WhatsApp Business Account yet.</p>}
    {state.phase === 'ready' && !chosen && <ul className="wa-templates__list">{state.items.map(t => <li key={t.name + t.language}>
      <button type="button" disabled={t.status !== 'APPROVED' || !!t.headerMedia || t.bodyParams > 20} onClick={() => { setChosen(t); setValues(Array(t.bodyParams).fill('')); setHeader(''); }}>
        <strong>{t.name}</strong> <small>{t.language} · {t.category.toLowerCase()} · {statusLabel[t.status]}</small></button></li>)}</ul>}
    {chosen && <div className="wa-templates__fill">
      <p><strong>{chosen.name}</strong> <small>{chosen.language}</small></p>
      {!!chosen.headerParams && <label>Header variable <input value={header} maxLength={200} onChange={e => setHeader(e.target.value)} /></label>}
      {values.map((v, i) => <label key={i}>Variable {i + 1} <input value={v} maxLength={200} onChange={e => setValues(values.map((x, j) => j === i ? e.target.value : x))} /></label>)}
      <div className="wa-bubble wa-bubble--out wa-templates__preview">{chosen.headerText && <p><strong>{fillTemplate(chosen.headerText, [header])}</strong></p>}<p className="wa-text">{fillTemplate(chosen.bodyText, values)}</p>{chosen.footerText && <small>{chosen.footerText}</small>}</div>
      <button type="button" disabled={!p.onPrepare || values.some(v => !v.trim()) || (!!chosen.headerParams && !header.trim())} onClick={() => { p.onPrepare?.({ name: chosen.name, language: chosen.language, ...(values.length ? { bodyParams: values } : {}), ...(chosen.headerParams ? { headerParams: [header] } : {}) }); p.onClose(); }}>Prepare template (needs approval)</button>
      <p className="wa-muted">Preparation creates a draft for your approval. Nothing is sent from this preview. Templates requiring header files are not supported here.</p>
      <button type="button" onClick={() => setChosen(null)}>Back to templates</button></div>}
  </div>;
}

export interface StoredWhatsAppInboxProps {
  state: StoredWhatsAppState; onRefresh(): void; onSelect(id: string): void; onSearch(query: string): void; onRecipient(id: string | null): void; onNext(): void;
  onPrepareReply?(text: string, replyToProviderMessageId?: string): void; onApproveReply?(): void; onDiscardReply?(): void; onLoadImage?(providerMessageId: string): Promise<Blob>; onLoadAttachment?(providerMessageId: string, kind: 'document' | 'audio'): Promise<{ blob: Blob; filename: string }>; onLoadTemplates?(): Promise<StoredTemplate[]>; now?: number;
  onPrepareTemplate?(input: Omit<N8nWhatsAppTemplateDraftRequest, 'recipientId'>): void; onPrepareMedia?(file: File, caption?: string): void;
  canManageContacts?: boolean; onSaveContacts?(input: { contacts: ContactUpdate[] }): Promise<boolean>;
  onApproveUpload?(): void;
  role?: string;
  onConfirmAppointment?(recipientId: string): Promise<void> | void;
  onDeclineAppointment?(recipientId: string): Promise<void> | void;
}
export function StoredWhatsAppInboxView(p: StoredWhatsAppInboxProps) {
  const s = p.state, now = p.now ?? Date.now(), live = s.data?.liveSendingEnabled === true;
  const label = (status: Message['status']) => status === 'reserved' && live ? 'Queued, not yet sent' : statusText[status];
  const [draft, setDraft] = useState(s.query), [reply, setReply] = useState(''), [emoji, setEmoji] = useState(false), [newChat, setNewChat] = useState(false), [templatesOpen, setTemplatesOpen] = useState(false), [quoteLatest, setQuoteLatest] = useState(true);
  const pane = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null);
  const [contactsOpen, setContactsOpen] = useState(false);
  useEffect(() => { setContactsOpen(false); setTemplatesOpen(false); setReply(''); setEmoji(false); }, [s.selectedId, s.recipientId]);
  useEffect(() => setDraft(s.query), [s.query, s.selectedId]);
  const selected = s.connections.find(c => c.connectionId === s.selectedId);
  const errors = { unauthorized: 'Sign in with an account that can access this inbox.', unavailable: 'Conversations are unavailable right now. Check the connection and try again.', changed: 'Conversations changed. Refresh to load the latest list.' };
  const list: Conversation[] = s.conversations.length ? s.conversations : (s.data && !s.recipientId ? s.data.conversations : []);
  const sorted = [...list].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  const unread = (recipientId: string) => selected ? s.recent.filter(m => m.recipientId === recipientId && m.direction === 'inbound' && Date.parse(m.timestamp) > lastSeen(selected.connectionId, recipientId)).length : 0;
  const contact: StoredContact | undefined = s.contacts?.find(c => c.recipientId === s.recipientId);
  const active = list.find(c => c.recipientId === s.recipientId);
  const name = contact?.contactName ?? active?.contactName ?? active?.maskedPhone ?? 'Conversation';
  const chat = useMemo(() => s.recipientId && s.data ? [...s.data.messages].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id)) : [], [s.data, s.recipientId]);
  const latestInbound = [...chat].reverse().find(m => m.direction === 'inbound' && m.providerMessageId);
  // Capture the previous "seen" time before marking, so the New messages divider survives this render.
  const seenAt = useMemo(() => selected && s.recipientId ? lastSeen(selected.connectionId, s.recipientId) : 0, [selected?.connectionId, s.recipientId]);
  useEffect(() => { if (selected && s.recipientId && chat.length) markSeen(selected.connectionId, s.recipientId); }, [selected?.connectionId, s.recipientId, chat.length]);
  const lastId = chat[chat.length - 1]?.id;
  useEffect(() => { const el = pane.current; if (el) el.scrollTop = el.scrollHeight; }, [s.recipientId, lastId]);
  const canCompose = !!p.onPrepareReply && !!s.recipientId && (contact ? contact.eligibility === 'eligible' : true);
  const submit = () => { if (!reply.trim() || !p.onPrepareReply || !canCompose) return; p.onPrepareReply(reply, quoteLatest && latestInbound ? latestInbound.providerMessageId! : undefined); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } };
  const insertEmoji = (value: string) => { const el = input.current, at = el?.selectionStart ?? reply.length; setReply((reply.slice(0, at) + value + reply.slice(el?.selectionEnd ?? at)).slice(0, 4096)); setEmoji(false); requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + value.length, at + value.length); }); };

  const groups: Array<{ day: string; label: string; items: Message[] }> = [];
  for (const m of chat) { const key = dayKey(m.timestamp), last = groups[groups.length - 1]; if (last?.day === key) last.items.push(m); else groups.push({ day: key, label: dayLabel(m.timestamp, now), items: [m] }); }
  const firstNew = chat.find(m => m.direction === 'inbound' && seenAt > 0 && Date.parse(m.timestamp) > seenAt)?.id;

  return <section className={'wa-app' + (s.recipientId ? ' wa-app--chat-open' : '')} aria-label="Stored WhatsApp conversations">
    <aside className="wa-sidebar" aria-label="Chats">
      <header className="wa-sidebar__head">
        <h2>Chats</h2>
        <div className="wa-sidebar__actions">
          {p.canManageContacts && p.onSaveContacts && s.contacts && <button type="button" className="wa-icon-btn" aria-label="Manage contacts" disabled={s.reply.phase === 'working'} onClick={() => setContactsOpen(true)}>⚙</button>}
          <button type="button" className="wa-icon-btn" title="New chat" aria-label="Start new conversation" disabled={!s.contacts?.length} onClick={() => setNewChat(v => !v)}>✎</button>
          <button type="button" className="wa-icon-btn" title="Refresh" aria-label="Refresh stored conversations" onClick={p.onRefresh} disabled={s.loading || s.error === 'unauthorized'}>⟳</button>
        </div>
      </header>
      {contactsOpen && p.canManageContacts && p.onSaveContacts && s.contacts && <WhatsAppContactsManager key={s.selectedId} contacts={s.contacts} onSave={p.onSaveContacts} onClose={() => setContactsOpen(false)} />}
      {s.connections.length > 1 && <label className="wa-inbox-select">Inbox <select aria-label="Stored WhatsApp account" value={s.selectedId ?? ''} onChange={e => p.onSelect(e.target.value)}>
        <option value="" disabled>Select an inbox</option>{s.connections.map((c, i) => <option key={c.connectionId} value={c.connectionId} disabled={c.disconnected}>Saved inbox {i + 1}{c.disconnected ? ' (disconnected)' : ''}</option>)}
      </select></label>}
      {s.selectedId && <form className="wa-search" role="search" onSubmit={e => { e.preventDefault(); p.onSearch(draft); }}>
        <input aria-label="Search saved messages" placeholder="Search chats and messages" value={draft} maxLength={256} onChange={e => setDraft(e.target.value)} />
      </form>}
      {newChat && s.contacts && <div className="wa-newchat" role="dialog" aria-label="Start new conversation"><p className="wa-muted">Authorized contacts</p>
        {s.contacts.map(c => <button type="button" key={c.recipientId} className="wa-chatrow" onClick={() => { setNewChat(false); p.onRecipient(c.recipientId); }}>
          <Avatar name={c.contactName} seed={c.recipientId} /><span className="wa-chatrow__body"><span className="wa-chatrow__top"><strong>{c.contactName}</strong></span>
            <span className="wa-chatrow__preview">{c.maskedPhone} · {c.eligibility === 'eligible' ? 'Can reply now' : c.eligibility === 'window_closed' ? 'Template needed (24-hour window closed)' : 'Not opted in'}</span></span></button>)}</div>}
      <div className="wa-chatlist">
        {s.loading && !list.length && <p role="status" className="wa-muted">Loading stored conversations…</p>}
        {s.error && <p role="alert" className="wa-error">{errors[s.error]}</p>}
        {!s.loading && !s.error && !s.connections.length && <p className="wa-muted">No WhatsApp inbox is connected yet.</p>}
        {!s.loading && !s.error && s.connections.length > 0 && !s.selectedId && <p className="wa-muted">{s.connections.some(c => !c.disconnected) ? 'Select an inbox to view its saved conversations.' : 'All stored inboxes are disconnected.'}</p>}
        {s.selectedId && !s.loading && !s.error && !sorted.length && <p className="wa-muted">{s.query ? 'No chats match this search.' : 'No conversations yet.'}</p>}
        {sorted.map(c => { const n = unread(c.recipientId), display = c.contactName ?? c.maskedPhone, last = s.recent.find(m => m.recipientId === c.recipientId);
          return <button type="button" key={c.recipientId} className={'wa-chatrow' + (s.recipientId === c.recipientId ? ' is-active' : '')} aria-pressed={s.recipientId === c.recipientId} onClick={() => p.onRecipient(c.recipientId)}>
            <Avatar name={display} seed={c.recipientId} />
            <span className="wa-chatrow__body">
              <span className="wa-chatrow__top"><strong>{c.contactName ? `${c.contactName} (${c.maskedPhone})` : c.maskedPhone}</strong><time dateTime={c.lastMessageAt} className={n ? 'is-unread' : ''}>{listTime(c.lastMessageAt, now)}</time></span>
              <span className="wa-chatrow__bottom"><span className="wa-chatrow__preview">{last?.direction === 'outbound' && <StatusTicks status={last.status} live={live} />}{c.lastMessagePreview}</span>
                {c.enquiry?.appointmentStatus === 'REQUESTED' && <span className="wa-badge wa-badge--action" title="Consultation Requested">Consultation</span>}
                {c.enquiry?.appointmentStatus === 'AWAITING_CUSTOMER_BOOKING' && <span className="wa-badge wa-badge--info" title="Link Sent">Link Sent</span>}
                {n > 0 && <span className="wa-badge" aria-label={`${n} new`}>{n}</span>}</span>
              <span className="wa-sr">{c.messageCount} saved records</span>
            </span>
          </button>; })}
      </div>
      <p className="wa-footnote">{live ? <strong className="wa-live">Live sending on · every message needs your approval</strong> : <strong>Saved WhatsApp records · Sending is disabled</strong>} · Statuses come from saved provider events.</p>
    </aside>

    <div className="wa-chat" aria-label="Stored messages">
      {!s.recipientId ? <div className="wa-chat__empty"><h3>Stored conversations</h3><p>Select a chat to read saved messages and prepare a reply.</p><p className="wa-muted">This inbox shows saved conversations and recorded message statuses. It does not send messages or independently verify provider delivery.</p></div> : <>
        <header className="wa-chat__head">
          <button type="button" className="wa-icon-btn wa-back" aria-label="Back to chats" onClick={() => p.onRecipient(null)}>←</button>
          <Avatar name={name} seed={s.recipientId} />
          <div><strong>{name}</strong><small>{contact?.maskedPhone ?? active?.maskedPhone ?? ''}{contact ? ' · ' + (contact.eligibility === 'eligible' ? 'Reply window open' : contact.eligibility === 'window_closed' ? '24-hour reply window closed' : 'Not opted in') : ''}</small></div>
        </header>
        <div className="wa-messages" ref={pane}>
          {s.data?.nextPageToken && <button type="button" className="wa-earlier" disabled={s.loading} onClick={p.onNext}>Load earlier messages</button>}
          {s.loading && !chat.length && <p role="status" className="wa-muted">Loading stored conversations…</p>}
          {s.error && <p role="alert" className="wa-error">{errors[s.error]}</p>}
          {!s.loading && !s.error && !chat.length && <p className="wa-muted wa-center">No messages with this contact yet.</p>}
          {groups.map(g => <div key={g.day} role="list"><div className="wa-day"><span>{g.label}</span></div>
            {g.items.map(m => <div key={m.id} role="listitem">{m.id === firstNew && <div className="wa-new"><span>New messages</span></div>}
              <article className={'wa-bubble ' + (m.direction === 'inbound' ? 'wa-bubble--in' : 'wa-bubble--out')}>
                {m.attachment && <Attachment m={m} onLoadImage={p.onLoadImage} onLoadAttachment={p.onLoadAttachment} />}
                <p className="wa-text">{m.textPreview}</p>
                <footer><time dateTime={m.timestamp}>{clock(m.timestamp)}</time>{m.direction === 'outbound' && <StatusTicks status={m.status} live={live} />}</footer>
                {m.direction === 'outbound' && ['reserved', 'unverified', 'failed'].includes(m.status) && <small className="wa-state">{label(m.status)}</small>}
                {m.deliveryEvents && <details className="wa-events"><summary>Saved delivery events</summary><ul>{m.deliveryEvents.map(e => <li key={e.status}>{statusText[e.status]} · <time dateTime={e.timestamp}>{new Date(e.timestamp).toLocaleString('en-IN', { timeZone: zone, timeZoneName: 'short' })}</time></li>)}</ul></details>}
              </article></div>)}</div>)}
        </div>
        {s.reply.phase === 'awaiting_upload_approval' && s.reply.uploadReview && <div className="wa-approval" role="group" aria-label="File upload awaiting approval">
          <p><strong>Approve uploading this file to WhatsApp?</strong></p><p className="wa-text">{s.reply.uploadReview.draft.filename} · {Math.ceil(s.reply.uploadReview.draft.bytes / 1024)} KB · {s.reply.uploadReview.draft.mimeType}</p>
          <p>This transfers the file to WhatsApp. It does not send it to {name}; a separate message approval follows.</p>
          <button type="button" className="wa-primary" onClick={p.onApproveUpload}>Approve file upload</button> <button type="button" onClick={p.onDiscardReply}>Cancel upload</button>
        </div>}
        {s.reply.phase === 'awaiting_approval' && s.reply.prepared && <div className="wa-approval" role="group" aria-label="Reply awaiting approval">
          <p><strong>Approve this WhatsApp reply?</strong> To {name}{contact ? ` (${contact.maskedPhone})` : ''}</p>
          <p className="wa-text">{whatsappDraftPreview(s.reply.prepared.draft)}</p>
          <p className="wa-muted">{live ? 'Approving sends this exact message on WhatsApp.' : 'Sending is disabled. Approving saves it as “Prepared, not sent”.'}</p>
          <div><button type="button" className="wa-primary" onClick={p.onApproveReply}>Approve reply</button> <button type="button" onClick={p.onDiscardReply}>Edit or discard</button></div></div>}
        {s.reply.phase === 'prepared' && <p role="status" className="wa-banner">{live ? 'Approved and queued. The ticks update when WhatsApp confirms sent, delivered and read.' : 'Approved and saved as “Prepared, not sent”. Nothing was sent to WhatsApp.'} <button type="button" onClick={() => { setReply(''); p.onDiscardReply?.(); }}>Write another reply</button></p>}
        {s.reply.phase === 'failed' && <p role="alert" className="wa-banner wa-banner--error">{s.reply.uploadAttempted ? 'The message could not be prepared. A file upload may already have occurred. No message was sent to the contact; there will be no automatic retry.' : 'The reply could not be prepared. Nothing was sent.'} <button type="button" onClick={p.onDiscardReply}>Review again</button></p>}
        {p.onPrepareReply && s.reply.phase !== 'awaiting_approval' && s.reply.phase !== 'awaiting_upload_approval' && s.reply.phase !== 'prepared' && <form className="wa-composer" aria-label="Prepare WhatsApp reply" onSubmit={e => { e.preventDefault(); submit(); }}>
          {templatesOpen && p.onLoadTemplates && <WhatsAppTemplatePicker key={s.selectedId + ':' + s.recipientId} load={p.onLoadTemplates} onPrepare={contact?.optedIn ? p.onPrepareTemplate : undefined} onClose={() => setTemplatesOpen(false)} />}
          {!canCompose && contact && <p className="wa-banner wa-banner--warn">{contact.eligibility === 'window_closed' ? 'Meta allows free-form replies only within 24 hours of the contact’s last message. An approved template is needed; choose one from Message templates.' : 'This contact has not opted in, so messages cannot be prepared.'}</p>}
          {latestInbound && canCompose && <label className="wa-quote"><input type="checkbox" checked={quoteLatest} onChange={e => setQuoteLatest(e.target.checked)} /> Reply to their latest message</label>}
          <div className="wa-composer__row">
            <div className="wa-emoji"><button type="button" className="wa-icon-btn" aria-label="Insert emoji" aria-expanded={emoji} disabled={!canCompose} onClick={() => setEmoji(v => !v)}>☺</button>
              {emoji && <div className="wa-emoji__grid" role="listbox" aria-label="Emoji">{EMOJI.map(e => <button type="button" key={e} role="option" aria-selected="false" onClick={() => insertEmoji(e)}>{e}</button>)}</div>}</div>
            {p.onPrepareMedia && <WhatsAppFileComposer key={s.selectedId + ':' + s.recipientId} disabled={!canCompose || s.reply.phase === 'working'} onPrepare={p.onPrepareMedia} />}
            {p.onLoadTemplates && <button type="button" className="wa-icon-btn" aria-label="Message templates" title="Message templates" aria-expanded={templatesOpen} onClick={() => setTemplatesOpen(v => !v)}>▤</button>}
            <textarea ref={input} aria-label="Reply text" placeholder={canCompose ? 'Type a message' : 'Replies unavailable'} value={reply} maxLength={4096} rows={1} disabled={!canCompose} onChange={e => setReply(e.target.value)} onKeyDown={onKey} />
            <button type="submit" className="wa-send" disabled={!canCompose || s.reply.phase === 'working' || !reply.trim()} aria-label="Prepare reply (needs approval)" title="Prepare reply (needs approval)">➤</button>
          </div>
          <small className="wa-muted">{s.reply.phase === 'working' ? 'Working…' : (live ? 'Enter prepares the message for your approval · Shift+Enter adds a new line' : 'Enter prepares the reply for your approval · Shift+Enter adds a new line · Sending is disabled')}</small>
        </form>}
      </>}
    </div>
  </section>;
}

export function StoredWhatsAppInbox({ role }: { role: string }) {
  const [view, setView] = useState({ role, state: initialStoredWhatsAppState(role) });
  const model = useRef<ReturnType<typeof createStoredWhatsAppModel> | null>(null);
  useEffect(() => { const active = createStoredWhatsAppModel(role, state => setView({ role, state })); model.current = active; void active.load(); return () => { active.dispose(); if (model.current === active) model.current = null; }; }, [role]);
  // Quiet refresh every 30 s while the tab is visible; the model skips it while loading or preparing a reply.
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') void model.current?.refresh(); }, 30000); return () => clearInterval(t); }, []);
  return <StoredWhatsAppInboxView state={view.role === role ? view.state : initialStoredWhatsAppState(role)} role={role} onRefresh={() => void model.current?.load()} onSelect={id => void model.current?.select(id)} onSearch={query => void model.current?.search(query)} onRecipient={id => void model.current?.recipient(id)} onNext={() => void model.current?.next()}
    onPrepareReply={(text, replyTo) => void model.current?.prepareReply(text, replyTo)} onApproveReply={() => void model.current?.approveReply()} onDiscardReply={() => model.current?.discardReply()}
    onPrepareTemplate={input => void model.current?.prepareTemplate(input)} onPrepareMedia={(file, caption) => void model.current?.prepareMedia(file, caption)}
    onApproveUpload={() => void model.current?.approveUpload()}
    onConfirmAppointment={recipientId => model.current?.confirmAppointment(recipientId)}
    onDeclineAppointment={recipientId => model.current?.declineAppointment(recipientId)}
    canManageContacts={['owner', 'admin'].includes(role)} onSaveContacts={input => model.current?.saveContacts(input) ?? Promise.resolve(false)}
    onLoadImage={id => { const c = view.state.connections.find(x => x.connectionId === view.state.selectedId && !x.disconnected); return c ? loadStoredWhatsAppImagePreview(c, id) : Promise.reject(new ImagePreviewError('denied')); }}
    onLoadTemplates={() => { const c = view.state.connections.find(x => x.connectionId === view.state.selectedId && !x.disconnected); return c ? loadStoredWhatsAppTemplates(c) : Promise.reject(new Error('No inbox')); }}
    onLoadAttachment={(id, kind) => { const c = view.state.connections.find(x => x.connectionId === view.state.selectedId && !x.disconnected); return c ? loadStoredWhatsAppAttachment(c, id, kind) : Promise.reject(new ImagePreviewError('denied')); }} />;
}
