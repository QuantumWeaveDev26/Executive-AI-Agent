import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PhoneInboundPage } from '../src/PhoneInboundPage';
import { PhoneHistoryPage } from '../src/PhonePages';
import { formatPlainTextCallExport, PhoneCallTranscriptPanel } from '../src/PhoneCallMediaOptions';

describe('Phone Dashboard separate Call Recording & Transcript options with Copy All', () => {
  const inboundId = 'b'.repeat(64);
  const inboundSummary = {
    id: inboundId,
    occurredAt: '2026-11-17T10:21:52.000Z',
    maskedPhone: '•••• 2345',
    outcome: 'callback_requested' as const,
    providerVerified: false as const,
    customerName: 'Krishna',
    preferredContactTime: 'Tomorrow at 11 AM',
    direction: 'inbound' as const,
    durationSeconds: 112,
    callStatus: 'ended',
    enquirySummary: 'Wants an AI assistant to manage customer enquiries.',
    recordingAvailable: true,
    transcriptAvailable: true
  };

  const inboundDetail = {
    ...inboundSummary,
    callerPhone: '+919845012345',
    business: 'Real Estate',
    serviceNeeded: 'AI Voice Agent',
    callbackRequestId: 'c'.repeat(64),
    callbackConsent: 'confirmed',
    callbackPreference: 'requested',
    providerInteractionId: '20261117/cb-confirmed-01',
    transcript: [
      { speaker: 'agent' as const, text: "Hello! I'm Thaara from Quantum Weave AI.", languageBasis: 'provider_original' as const },
      { speaker: 'caller' as const, text: "I'm interested in an AI calling agent.", languageBasis: 'provider_original' as const },
      { speaker: 'agent' as const, text: 'Sure! What kind of business do you operate?', languageBasis: 'provider_original' as const },
      { speaker: 'caller' as const, text: 'Real estate.', languageBasis: 'provider_original' as const }
    ],
    transcriptExpiresAt: '2099-12-31T23:59:59.000Z',
    recordingReference: {
      interactionId: '20261117/cb-confirmed-01',
      expiresAt: '2099-12-31T23:59:59.000Z',
      noticeConfirmed: true as const
    }
  };

  it('renders separate Call Recording and Transcript buttons on Inbound Calls and displays full metadata + Copy All in Transcript view', () => {
    const listHtml = renderToStaticMarkup(
      <PhoneInboundPage
        role="owner"
        ownerIdentity={{ userId: 'owner-1', workspaceId: 'ws-1' }}
        initialState={{ status: 'ready', reports: [inboundSummary] }}
      />
    );
    expect(listHtml).toContain('data-testid="phone-option-recording"');
    expect(listHtml).toContain('data-testid="phone-option-transcript"');
    expect(listHtml).toContain('Call Recording');
    expect(listHtml).toContain('Transcript');

    const transcriptHtml = renderToStaticMarkup(
      <PhoneInboundPage
        role="owner"
        ownerIdentity={{ userId: 'owner-1', workspaceId: 'ws-1' }}
        initialState={{
          status: 'ready',
          reports: [inboundSummary],
          detail: inboundDetail,
          activeOption: { id: inboundId, tab: 'transcript' }
        }}
      />
    );
    expect(transcriptHtml).toContain('data-testid="phone-transcript-view"');
    expect(transcriptHtml).toContain('data-testid="phone-transcript-copy-all"');
    expect(transcriptHtml).toContain('Copy All');
    for (const expected of [
      'Krishna',
      '+919845012345',
      'Real Estate',
      'AI Voice Agent',
      'Wants an AI assistant to manage customer enquiries.',
      '1m 52s',
      'Callback requested (Completed)',
      "Hello! I&#x27;m Thaara from Quantum Weave AI.",
      'Real estate.'
    ]) {
      expect(transcriptHtml).toContain(expected);
    }

    const unavailableRecHtml = renderToStaticMarkup(
      <PhoneInboundPage
        role="owner"
        ownerIdentity={{ userId: 'owner-1', workspaceId: 'ws-1' }}
        initialState={{
          status: 'ready',
          reports: [{ ...inboundSummary, recordingAvailable: false }],
          detail: { ...inboundDetail, recordingAvailable: false, recordingReference: null },
          activeOption: { id: inboundId, tab: 'recording' }
        }}
      />
    );
    expect(unavailableRecHtml).toContain('data-testid="phone-recording-unavailable"');
    expect(unavailableRecHtml).toContain('Recording was not captured for this call.');
  });

  it('renders separate Call Recording and Transcript options on Outbound Calls and formats Copy All plain text accurately', () => {
    const outboundCall = {
      id: 'call-out-1',
      approvalId: '11111111-1111-4111-8111-111111111111',
      draft: {
        draftId: 'draft-out-1',
        contactId: 'priya',
        contactRevision: 1,
        contactBindingHash: 'a'.repeat(64),
        recipient: { displayName: 'Priya Nair', maskedPhone: '+91 ******2233' },
        purpose: 'Confirm Thursday demo slot',
        language: 'en-IN' as const,
        maxDurationSeconds: 300,
        aiDisclosure: 'Hello, I am Thaara from Quantum Weave AI.',
        consentReference: 'c1',
        idempotencyKey: 'idem1',
        mode: 'live' as const
      },
      state: 'completed' as const,
      createdAt: '2026-11-17T10:20:00.000Z',
      updatedAt: '2026-11-17T10:21:14.000Z',
      providerCallId: '20261117/out-01-aw654321',
      dispatchStatus: 'unverified' as const,
      verified: false as const,
      simulated: false as const,
      report: {
        text: 'Live call completed.',
        spokenText: 'Live call completed.',
        quotedResponses: ['Yes, Thursday at 4 PM works well.'],
        evidenceIds: ['e1'],
        verified: false as const,
        simulated: false as const
      },
      syncedDetails: {
        interactionId: '20261117/out-01-aw654321',
        attemptId: 'att-out-1',
        recordingAvailable: false,
        durationSeconds: 74,
        occurredAt: '2026-11-17T10:21:14.000Z',
        customerName: 'Priya Nair',
        phoneNumber: '+919811122233',
        business: 'Lotus Clinic',
        serviceNeeded: 'Appointment Reminders',
        requirements: 'Confirm Thursday demo slot',
        summary: 'Priya confirmed Thursday 4 PM demo slot.',
        outcomeLabel: 'Completed',
        callbackStatus: 'none' as const,
        transcript: [
          { speaker: 'thaara' as const, text: 'Hello Priya, I am Thaara from Quantum Weave AI.' },
          { speaker: 'customer' as const, text: 'Yes, Thursday at 4 PM works well.' }
        ]
      }
    };

    const outTranscriptHtml = renderToStaticMarkup(
      <PhoneHistoryPage
        title="Outbound calls"
        initialState={{
          calls: [outboundCall],
          activeOption: { id: 'call-out-1', tab: 'transcript' }
        }}
      />
    );
    expect(outTranscriptHtml).toContain('Outbound calls');
    expect(outTranscriptHtml).toContain('data-testid="phone-option-recording"');
    expect(outTranscriptHtml).toContain('data-testid="phone-option-transcript"');
    expect(outTranscriptHtml).toContain('Copy All');
    expect(outTranscriptHtml).toContain('Lotus Clinic');
    expect(outTranscriptHtml).toContain('Appointment Reminders');
    expect(outTranscriptHtml).toContain('1m 14s');
    expect(outTranscriptHtml).toContain('Hello Priya, I am Thaara from Quantum Weave AI.');
    expect(outTranscriptHtml).toContain('Yes, Thursday at 4 PM works well.');

    const plainExport = formatPlainTextCallExport({
      direction: 'outbound',
      callId: outboundCall.id,
      recordingAvailable: false,
      customerName: 'Priya Nair',
      phoneNumber: '+919811122233',
      business: 'Lotus Clinic',
      interestedService: 'Appointment Reminders',
      requirements: 'Confirm Thursday demo slot',
      callDate: '17/11/2026, 3:51:14 pm IST',
      durationSeconds: 74,
      outcome: 'Completed',
      transcript: outboundCall.syncedDetails.transcript
    });
    expect(plainExport).toContain('Customer: Priya Nair\nPhone: +919811122233\nDirection: Outbound\nBusiness: Lotus Clinic\nInterested Service: Appointment Reminders\nRequirements: Confirm Thursday demo slot');
    expect(plainExport).toContain('Conversation Transcript\nThaara: Hello Priya, I am Thaara from Quantum Weave AI.\nCustomer: Yes, Thursday at 4 PM works well.');
  });

  it('3. PhoneCallTranscriptPanel indicates Full transcript unavailable when no agent turns exist', () => {
    const customerOnlyHtml = renderToStaticMarkup(
      <PhoneCallTranscriptPanel
        metadata={{
          direction: 'outbound',
          callId: 'call-customer-only',
          recordingAvailable: true,
          customerName: 'Naveen',
          phoneNumber: '+91 ******5125',
          business: null,
          interestedService: null,
          requirements: null,
          callDate: '20/11/2026, 5:21:47 pm IST',
          durationSeconds: null,
          outcome: 'Completed',
          transcript: [{ speaker: 'customer', text: 'Yes.' }]
        }}
      />
    );
    expect(customerOnlyHtml).toContain('Full transcript unavailable');
    expect(customerOnlyHtml).toContain('Customer:');
    expect(customerOnlyHtml).toContain('Yes.');
  });
});
