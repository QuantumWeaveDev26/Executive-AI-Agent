import { useEffect, useRef, useState } from 'react';
import { validateWhatsAppFile, type ContactUpdate, type StoredContact } from './whatsapp-stored-inbox';

export function WhatsAppContactsManager(p: { contacts: StoredContact[]; onSave(input: { contacts: ContactUpdate[] }): Promise<boolean>; onClose(): void }) {
  const [rows, setRows] = useState<ContactUpdate[]>(() => p.contacts.map(c => ({ id: c.recipientId, displayName: c.contactName, optedIn: c.optedIn })));
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [consent, setConsent] = useState(false), [adding, setAdding] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'failed'>('idle'), [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null), live = useRef(true);
  useEffect(() => { live.current = true; dialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); return () => { live.current = false; }; }, []);
  const patch = (id: string, change: Partial<ContactUpdate>) => setRows(rows.map(c => c.id === id ? { ...c, ...change } : c));
  const add = () => {
    if (!name.trim() || name.trim().length > 80 || !/^\+[1-9][0-9]{7,14}$/.test(phone) || !consent || rows.length >= 5 || rows.some(c => c.phoneE164 === phone)) { setError('Enter a name, full international number and confirmed consent. Numbers must be unique; up to five contacts are supported.'); return; }
    setRows([...rows, { id: 'contact_' + crypto.randomUUID(), displayName: name.trim(), phoneE164: phone, optedIn: true }]); setName(''); setPhone(''); setConsent(false); setAdding(false); setError('');
  };
  const save = async () => {
    if (phase === 'saving' || !rows.length || rows.length > 5 || rows.some(c => !c.displayName?.trim() || c.displayName.length > 80)) return;
    setPhase('saving'); setError('');
    try { const ok = await p.onSave({ contacts: rows.map(c => ({ ...c, displayName: c.displayName!.trim() })) }); if (live.current) { if (ok) p.onClose(); else { setPhase('failed'); setError('Contacts could not be saved. Check access and try again.'); } } }
    catch { if (live.current) { setPhase('failed'); setError('Contacts could not be saved. Check access and try again.'); } }
  };
  return <div className="wa-modal" role="presentation"><div ref={dialog} className="wa-contacts" role="dialog" aria-modal="true" aria-label="Manage WhatsApp contacts" onKeyDown={e => {
    if (e.key === 'Escape' && phase !== 'saving') p.onClose();
    if (e.key === 'Tab') { const items = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)'); if (!items?.length) return; const first = items[0], last = items[items.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
  }}>
    <header><h3>Manage contacts</h3><button type="button" aria-label="Close contacts" disabled={phase === 'saving'} onClick={p.onClose}>×</button></header>
    <p>Only contacts who agreed to WhatsApp messages can receive them. Saving contacts never sends a message.</p>
    {rows.map(c => <fieldset key={c.id} disabled={phase === 'saving'}><legend>{p.contacts.find(x => x.recipientId === c.id)?.maskedPhone ?? ('New contact · +' + '*'.repeat(Math.max(4, (c.phoneE164?.length ?? 8) - 5)) + c.phoneE164?.slice(-4))}</legend>
      <label>Display name <input value={c.displayName ?? ''} maxLength={80} onChange={e => patch(c.id, { displayName: e.target.value })} /></label>
      <label><input type="checkbox" checked={c.optedIn} onChange={e => patch(c.id, { optedIn: e.target.checked })} /> Contact has opted in</label>
      <button type="button" disabled={rows.length <= 1} onClick={() => setRows(rows.filter(x => x.id !== c.id))}>Remove {c.displayName || 'contact'}</button>
    </fieldset>)}
    {!adding && <button type="button" disabled={phase === 'saving' || rows.length >= 5} onClick={() => setAdding(true)}>Add contact</button>}
    {adding && <fieldset disabled={phase === 'saving'}><legend>New contact</legend>
      <label>New contact name <input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
      <label>International phone number <input type="tel" autoComplete="off" placeholder="+91…" value={phone} maxLength={16} onChange={e => setPhone(e.target.value.trim())} /></label>
      <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I confirm this person agreed to receive WhatsApp messages.</label>
      <button type="button" disabled={!consent || !name.trim() || !/^\+[1-9][0-9]{7,14}$/.test(phone)} onClick={add}>Add confirmed contact</button>
      <button type="button" onClick={() => { setAdding(false); setName(''); setPhone(''); setConsent(false); }}>Cancel new contact</button>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" className="wa-primary" disabled={phase === 'saving' || !rows.length || adding || rows.some(c => !c.displayName?.trim())} onClick={() => void save()}>{phase === 'saving' ? 'Saving contacts…' : 'Save contacts'}</button></footer>
  </div></div>;
}

export function WhatsAppFileComposer(p: { disabled: boolean; onPrepare(file: File, caption?: string): void }) {
  const [file, setFile] = useState<File | null>(null), [caption, setCaption] = useState(''), [error, setError] = useState(''), [thumbnail, setThumbnail] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!file || !file.type.startsWith('image/')) { setThumbnail(undefined); return; } const url = URL.createObjectURL(file); setThumbnail(url); return () => URL.revokeObjectURL(url); }, [file]);
  const pick = (selected?: File) => { if (!selected) return; try { validateWhatsAppFile(selected); setFile(selected); setCaption(''); setError(''); } catch { setFile(null); setError('Unsupported file or size. Images: 5 MB; audio: 16 MB; documents: 20 MB.'); } };
  return <div className="wa-file-compose" role="group" aria-label="Prepare file attachment">
    <input ref={input} type="file" aria-label="Choose WhatsApp attachment" hidden disabled={p.disabled} accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.ogg,.mp3,.aac,.amr,.m4a" onChange={e => { pick(e.target.files?.[0]); e.target.value = ''; }} />
    <button type="button" className="wa-icon-btn" aria-label="Attach file" title="Attach image, document or audio" disabled={p.disabled} onClick={() => input.current?.click()}>📎</button>
    {error && <p role="alert">{error}</p>}
    {file && <div className="wa-file-compose__card">
      {thumbnail && <img src={thumbnail} alt="Selected image preview" />}
      <p><strong>{file.name}</strong> · {Math.ceil(file.size / 1024)} KB</p>
      {!file.type.startsWith('audio/') && <label>Attachment caption <input value={caption} maxLength={1024} disabled={p.disabled} onChange={e => setCaption(e.target.value)} /></label>}
      <p className="wa-muted">Preparation asks your permission to upload this file to WhatsApp. Sending the message needs a separate approval.</p>
      <button type="button" className="wa-primary" disabled={p.disabled} onClick={() => p.onPrepare(file, caption)}>Prepare file (needs approval)</button>
      <button type="button" disabled={p.disabled} onClick={() => { setFile(null); setCaption(''); setError(''); }}>Remove attachment</button>
    </div>}
  </div>;
}
