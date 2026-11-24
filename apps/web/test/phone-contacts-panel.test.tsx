import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pc from '../src/phone-calling';
import { PhoneContactsPanel, consentSummary } from '../src/PhoneContactsPanel';
import { PhoneScreen } from '../src/PhoneScreen';

const view = (over: Partial<pc.PhoneContactView> = {}): pc.PhoneContactView => ({
  contactId: 'pc-1', revision: 1, displayName: 'Ram', aliases: ['ರಾಮ್'], maskedPhone: '+91 ******0002', archived: false,
  consent: { callingAllowed: true, source: 'recipient_verbal', recordedAt: '2026-10-29T00:00:00.000Z', expiresAt: '2027-01-27T00:00:00.000Z', expired: false }, ...over,
});
const form = (over: Partial<pc.PhoneContactForm> = {}): pc.PhoneContactForm => ({
  displayName: ' Ram ', aliases: ['ರಾಮ್', ' ', 'ರಾಮ್'], phoneE164: '+91 90000-00002', consent: { callingAllowed: true, source: 'recipient_verbal', validDays: 90 }, ...over,
});
const respond = (data: unknown, ok = true, status = 200) => vi.fn(async () => ({ ok, status, json: async () => data }));

beforeEach(() => vi.stubGlobal('document', { cookie: 'thaara_csrf=synthetic-phone-csrf' }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Step 110 A2 phone contacts client (synthetic server responses only)', () => {
  it('creates with CSRF and a normalised body, and accepts only a masked response', async () => {
    const call = respond(view()); vi.stubGlobal('fetch', call);
    await expect(pc.createPhoneContact(form())).resolves.toMatchObject({ contactId: 'pc-1', maskedPhone: '+91 ******0002' });
    const [url, init] = call.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/connectors/phone/ai/contacts');
    expect(new Headers(init.headers).get('x-csrf-token')).toBe('synthetic-phone-csrf');
    expect(JSON.parse(String(init.body))).toEqual({ displayName: 'Ram', aliases: ['ರಾಮ್'], phoneE164: '+919000000002', consent: { callingAllowed: true, source: 'recipient_verbal', validDays: 90 } });
    for (const bad of [{ ...view(), phoneE164: '+919000000002' }, view({ maskedPhone: '+919000000002' }), view({ displayName: 'Someone else' }), { ...view(), consent: { ...view().consent, source: 'owner_guess' } }]) {
      vi.stubGlobal('fetch', respond(bad));
      await expect(pc.createPhoneContact(form())).rejects.toThrow();
    }
  });

  it('refuses invalid input before any request', async () => {
    const call = respond(view()); vi.stubGlobal('fetch', call);
    for (const bad of [form({ phoneE164: '+14155550100' }), form({ phoneE164: '' }), form({ displayName: '<b>' }), form({ consent: { callingAllowed: true, source: 'recipient_verbal', validDays: 400 } })])
      await expect(pc.createPhoneContact(bad)).rejects.toThrow(/Nothing was saved/);
    await expect(pc.updatePhoneContact('bad id', 1, form())).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });

  it('updates with the expected revision, may keep the number, and requires the next revision back', async () => {
    const call = respond(view({ revision: 2 })); vi.stubGlobal('fetch', call);
    await expect(pc.updatePhoneContact('pc-1', 1, form({ phoneE164: undefined }))).resolves.toMatchObject({ revision: 2 });
    const [url, init] = call.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/connectors/phone/ai/contacts/pc-1'); expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ expectedRevision: 1, displayName: 'Ram', aliases: ['ರಾಮ್'], consent: { callingAllowed: true, source: 'recipient_verbal', validDays: 90 } });
    vi.stubGlobal('fetch', respond(view({ revision: 5 })));
    await expect(pc.updatePhoneContact('pc-1', 1, form())).rejects.toThrow();
    vi.stubGlobal('fetch', respond(view({ revision: 3, archived: true })));
    await expect(pc.archivePhoneContact('pc-1', 2)).resolves.toMatchObject({ archived: true });
    vi.stubGlobal('fetch', respond(view({ revision: 3, archived: false })));
    await expect(pc.archivePhoneContact('pc-1', 2)).rejects.toThrow();
  });

  it('lists only valid masked contacts and surfaces the not-configured state', async () => {
    vi.stubGlobal('fetch', respond({ contacts: [view()] }));
    await expect(pc.listPhoneContacts()).resolves.toHaveLength(1);
    vi.stubGlobal('fetch', respond({ contacts: [{ ...view(), phoneE164: '+919000000002' }] }));
    await expect(pc.listPhoneContacts()).rejects.toThrow();
    vi.stubGlobal('fetch', respond({ error: { code: 'PHONE_CONTACTS_NOT_CONFIGURED', message: 'Saved phone contacts are not set up in this environment. Nothing was saved.' } }, false, 503));
    await expect(pc.listPhoneContacts()).rejects.toMatchObject({ status: 503 });
  });
});

describe('Step 110 A2 phone contacts panel', () => {
  it('explains when contact saving is not set up and shows no form', () => {
    const html = renderToStaticMarkup(<PhoneContactsPanel initialState={{ unavailable: true }} />);
    expect(html).toContain('not set up in this environment');
    expect(html).not.toContain('phone-contact-form');
  });

  it('lists masked contacts with truthful consent wording and an unticked consent box', () => {
    const contacts = [view(), view({ contactId: 'pc-2', displayName: 'Sita', aliases: [], consent: { ...view().consent, callingAllowed: false } }), view({ contactId: 'pc-3', displayName: 'Old', aliases: [], consent: { ...view().consent, expired: true } })];
    const html = renderToStaticMarkup(<PhoneContactsPanel initialState={{ contacts }} />);
    expect(html).toContain('Ram</strong> (+91 ******0002)');
    expect(html).toContain('They agreed verbally');
    expect(html).toContain('No calling consent');
    expect(html).toContain('Consent expired');
    expect(html).toContain('Saving never places a call');
    expect(html).toContain('This person agreed to receive calls from Thaara, an AI assistant');
    expect(html).not.toMatch(/data-testid="phone-contact-consent-allowed"[^>]*checked/);
    expect(html).not.toMatch(/\+91\d{10}/);
    expect(consentSummary(view())).toMatch(/valid until/);
  });

  it('asks for confirmation before archiving and labels editing without exposing the number', () => {
    const html = renderToStaticMarkup(<PhoneContactsPanel initialState={{ contacts: [view()], confirmArchive: 'pc-1', editing: { contactId: 'pc-1', revision: 1 } }} />);
    expect(html).toContain('Confirm archive');
    expect(html).toContain('leave empty to keep the saved number');
    expect(html).toContain('Save changes');
  });

  it('escapes untrusted names and is mounted on the Phone screen for authorized users only', () => {
    expect(renderToStaticMarkup(<PhoneContactsPanel initialState={{ contacts: [view({ displayName: '<img src=x>' })] }} />)).not.toContain('<img');
    const base = { workspaceId: 'w', userId: 'u', role: 'owner' };
    expect(renderToStaticMarkup(<PhoneScreen {...base} initialState={{}} aiCallingInitialState={{}} contactsInitialState={{ contacts: [] }} />)).toContain('phone-contacts-panel');
    expect(renderToStaticMarkup(<PhoneScreen {...base} initialState={{ unauthorized: true }} aiCallingInitialState={{}} contactsInitialState={{}} />)).not.toContain('phone-contacts-panel');
  });
});
