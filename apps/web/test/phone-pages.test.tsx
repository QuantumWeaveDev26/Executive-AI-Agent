import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { contactNeedsConfirmation, normalizeIndianMobile, PhoneCallPage, PhoneContactsPage, PhoneHistoryPage } from '../src/PhonePages';
import type { PhoneContactView } from '../src/phone-calling';

const contact = (over: Partial<PhoneContactView['consent']> = {}, name = 'Ram'): PhoneContactView => ({
  contactId: `c-${name.toLowerCase()}`, revision: 1, displayName: name, aliases: [], maskedPhone: '+91 ******0002', archived: false,
  consent: { callingAllowed: true, source: 'recipient_verbal', recordedAt: '2026-10-31T00:00:00Z', expiresAt: '2027-10-31T00:00:00Z', expired: false, ...over },
});
const draft = {
  draftId: 'draft-1', contactId: 'ram', contactRevision: 1, contactBindingHash: 'a'.repeat(64),
  recipient: { displayName: 'Ram', maskedPhone: '+91 ******0002' }, purpose: 'Are you free tomorrow?', language: 'en-IN' as const,
  maxDurationSeconds: 300, aiDisclosure: 'Hello, I am Thaara, an AI assistant.', consentReference: 'c', idempotencyKey: 'i', mode: 'live' as const,
};
const report = { text: 'Ram said: "Yes, after 5 pm."', spokenText: 'Ram said yes.', quotedResponses: ['Yes, after 5 pm.'], evidenceIds: ['t1'], verified: false as const, simulated: false as const };
const call = { id: 'call-1', approvalId: '11111111-1111-4111-8111-111111111111', draft, state: 'completed' as const, createdAt: '2026-10-31T10:30:00.000Z', updatedAt: '2026-10-31T10:35:00.000Z', providerCallId: null, verified: false as const, simulated: false as const, report };

describe('mobile number normalisation', () => {
  it.each([['9876543210', '+919876543210'], ['98765 43210', '+919876543210'], ['09876543210', '+919876543210'], ['919876543210', '+919876543210'], ['+91 98765-43210', '+919876543210']])(
    'accepts %s', (input, out) => expect(normalizeIndianMobile(input)).toBe(out));
  it.each(['12345', '5876543210', '98765432101', '+1 9876543210', 'abc9876543210', ''])('refuses %s', (input) => expect(normalizeIndianMobile(input)).toBeNull());
});

describe('consent confirmation is required before calling', () => {
  it('flags a contact without permission or with expired permission', () => {
    expect(contactNeedsConfirmation(contact())).toBe(false);
    expect(contactNeedsConfirmation(contact({ callingAllowed: false }))).toBe(true);
    expect(contactNeedsConfirmation(contact({ expired: true }))).toBe(true);
  });
});

describe('Phone page', () => {
  it('shows only the two questions with Call and Cancel', () => {
    const html = renderToStaticMarkup(<PhoneCallPage />);
    expect(html).toContain('>Phone<');
    expect(html).toContain('Who should Thaara call?');
    expect(html).toContain('What should Thaara ask?');
    expect(html).toContain('data-testid="phone-call"');
    expect(html).toContain('data-testid="phone-cancel"');
    for (const gone of ['Language', 'AI calling', 'Connection', 'Refresh', 'simulat']) expect(html).not.toContain(gone);
  });
  it('lets the owner choose between several matches and shows clear errors', () => {
    const html = renderToStaticMarkup(<PhoneCallPage initialState={{ candidates: [{ id: 'a', displayName: 'Ram K', maskedPhone: '+91 ******0002' }, { id: 'b', displayName: 'Ram S', maskedPhone: '+91 ******0003' }] }} />);
    expect(html).toContain('Choose who to call');
    expect(html).toContain('Ram S (+91 ******0003)');
    expect(renderToStaticMarkup(<PhoneCallPage initialState={{ error: 'No saved contact is called "Ravi".' }} />)).toContain('role="alert"');
  });
  it('shows the call card below the form once a request is prepared', () => {
    const html = renderToStaticMarkup(<PhoneCallPage initialState={{ approvalId: call.approvalId }} />);
    expect(html.indexOf('phone-cancel')).toBeLessThan(html.indexOf('phone-call-card') === -1 ? Infinity : html.indexOf('phone-call-card'));
    expect(html).not.toContain('phone-error');
  });
});

describe('Contacts page', () => {
  it('lists contacts like a phone with Call on each and flags missing confirmation', () => {
    const html = renderToStaticMarkup(<PhoneContactsPage initialState={{ contacts: [contact(), contact({ callingAllowed: false }, 'krishna')] }} />);
    expect(html).toContain('Save contact');
    expect((html.match(/data-testid="phone-contact-row"/g) ?? []).length).toBe(2);
    expect((html.match(/data-testid="phone-contact-call"/g) ?? []).length).toBe(2);
    expect(html).toContain('+91 ******0002');
    expect((html.match(/Needs your confirmation before calling/g) ?? []).length).toBe(1);
    expect(html).not.toContain('9876543210');
  });
  it('save window asks only for name and number, with the one consent sentence', () => {
    const html = renderToStaticMarkup(<PhoneContactsPage initialState={{ contacts: [], modal: { kind: 'save' } }} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-testid="phone-contact-name"');
    expect(html).toContain('data-testid="phone-contact-number"');
    expect(html).toContain('Saving confirms this person agreed to get calls from Thaara, an AI assistant.');
    for (const gone of ['This person agreed to receive calls', 'How they agreed', 'Consent valid for', 'type="checkbox"', '<select']) expect(html).not.toContain(gone);
  });
  it('call window asks what to ask the chosen contact', () => {
    const html = renderToStaticMarkup(<PhoneContactsPage initialState={{ contacts: [contact()], modal: { kind: 'call', contact: contact() } }} />);
    expect(html).toContain('Call Ram (+91 ******0002)');
    expect(html).toContain('What should Thaara ask?');
  });
  it('shows an empty state', () => {
    expect(renderToStaticMarkup(<PhoneContactsPage initialState={{ contacts: [] }} />)).toContain('No contacts yet');
  });
});

describe('Call history page', () => {
  it('shows name, masked number, status and the report, with Details', () => {
    const html = renderToStaticMarkup(<PhoneHistoryPage initialState={{ calls: [call] }} />);
    expect(html).toContain('Ram');
    expect(html).toContain('+91 ******0002');
    expect(html).toContain('data-testid="phone-history-details"');
    expect(html).not.toContain('phone-history-detail"');
    const open = renderToStaticMarkup(<PhoneHistoryPage initialState={{ calls: [call], openId: 'call-1' }} />);
    expect(open).toContain('Are you free tomorrow?');
    expect(open).toContain('not independently verified');
  });
  it('shows an empty state', () => {
    expect(renderToStaticMarkup(<PhoneHistoryPage initialState={{ calls: [] }} />)).toContain('No calls yet');
  });
  it('renders quotedResponses transcript fallback and Call/Provider IDs for completed live calls', () => {
    const liveCall = {
      ...call,
      simulated: false,
      state: 'completed' as const,
      providerCallId: '20261120/bf33c03e-17:21:53-aw16a0e0',
      report: {
        ...call.report,
        simulated: false,
        quotedResponses: ['Yes.', 'What kind of automation can I learn from it?'],
      },
    };
    const transcriptHtml = renderToStaticMarkup(
      <PhoneHistoryPage initialState={{ calls: [liveCall], activeOption: { id: 'call-1', tab: 'transcript' } }} />
    );
    expect(transcriptHtml).toContain('What kind of automation can I learn from it?');
    const detailsHtml = renderToStaticMarkup(
      <PhoneHistoryPage initialState={{ calls: [liveCall], openId: 'call-1' }} />
    );
    expect(detailsHtml).toContain('20261120/bf33c03e-17:21:53-aw16a0e0');
    expect(detailsHtml).toContain('call-1');
  });
});
