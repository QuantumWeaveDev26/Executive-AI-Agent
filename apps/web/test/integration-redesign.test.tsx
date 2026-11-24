import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CalendarScreenView } from '../src/CalendarScreen';
import type { CalendarAgendaResult, CalendarEvent, CalendarStatus } from '../src/calendar-api';
import { initialCalendarState } from '../src/calendar-model';
import { GmailScreenView } from '../src/GmailScreen';
import { initialGmailState } from '../src/gmail-model';
import {
  classifyGmailMessage,
  classifyWhatsAppMessage,
  describeCalendarConflict,
  extractEmailAddress,
  filterCalendarAgendaDays,
  filterGmailRows,
  filterWhatsAppMessages,
  formatCalendarEventDayAndDate,
  formatCalendarSimpleStatus,
  formatFriendlyDateHeading,
  formatFriendlyDateTime,
  formatFriendlyEventTimeRange,
  formatPhoneCallPurpose,
  formatPhoneContactName,
  formatPhoneSimpleStatus,
  formatWhatsAppContactName,
  getCalendarConflictDetails,
} from '../src/integration-ui';
import { PhoneScreen } from '../src/PhoneScreen';
import type { PhoneCallRecord, PhoneStatus } from '../src/phone-api';
import { WhatsAppScreenView } from '../src/WhatsAppScreen';
import type { WhatsAppMessage, WhatsAppStatus, WhatsAppThreadSummary } from '../src/whatsapp-api';
import { initialWhatsAppState } from '../src/whatsapp-model';

const FIXED_NOW_MS = Date.parse('2026-10-22T06:00:00.000Z'); // 11:30 AM IST on Thursday, 22 Oct 2026

describe('Steps 99 & 100 — Simple, Professional Integration Experience (Canvas Blue)', () => {
  it('1. formats UTC timestamps into friendly Asia/Kolkata strings (Today, Yesterday, 19 Oct, Thursday, 22 October) and handles invalid dates', () => {
    expect(
      formatFriendlyDateTime('2026-10-22T04:40:00.000Z', {
        timeZone: 'Asia/Kolkata',
        nowMs: FIXED_NOW_MS,
      }),
    ).toBe('Today, 10:10 AM');

    expect(
      formatFriendlyDateTime('2026-10-21T11:00:00.000Z', {
        timeZone: 'Asia/Kolkata',
        nowMs: FIXED_NOW_MS,
      }),
    ).toBe('Yesterday, 4:30 PM');

    expect(
      formatFriendlyDateTime('2026-10-19T05:30:00.000Z', {
        timeZone: 'Asia/Kolkata',
        nowMs: FIXED_NOW_MS,
      }),
    ).toBe('19 Oct, 11:00 AM');

    expect(formatCalendarEventDayAndDate('2026-10-22', 'Asia/Kolkata')).toBe(
      'Thursday, 22 October',
    );
    expect(formatFriendlyDateTime(null)).toBe('—');
    expect(formatFriendlyDateTime('')).toBe('—');
    expect(formatFriendlyDateTime('not-a-valid-timestamp')).toBe('Unavailable');
    expect(
      formatFriendlyDateHeading('2026-10-22', 'Asia/Kolkata', FIXED_NOW_MS),
    ).toContain('Today');
  });

  it('2. Gmail: extracts sender email address only, classifies Thaara Activity states truthfully, and requires verified receipt outcome', () => {
    expect(extractEmailAddress('Ananya Rao <ananya.rao@board.example.test>')).toBe(
      'ananya.rao@board.example.test',
    );
    expect(extractEmailAddress('sender@example.test')).toBe('sender@example.test');
    expect(extractEmailAddress('')).toBe('Unknown sender');

    // 1. No action taken
    const received = classifyGmailMessage(
      { id: 'm1', subject: 'Board Update', from: 'Ananya Rao <chair@board.test>', unread: true },
      'exec@thaara.test',
    );
    expect(received.thaaraActivityStatus).toBe('No action taken');
    expect(received.thaaraActivitySummary).toBe('Thaara has not replied to this email.');
    expect(received.effectiveStatus).toBe('unread');

    // 2. Reply drafted by Thaara — not sent
    const thaaraDraft = classifyGmailMessage({
      id: 'm2',
      subject: 'Draft Follow-up',
      from: 'exec@thaara.test',
      origin: 'thaara_draft',
      thaaraReplyText: 'Draft reply: I have reviewed the Q4 pack.',
    });
    expect(thaaraDraft.thaaraActivityStatus).toBe('Reply drafted by Thaara — not sent');
    expect(thaaraDraft.thaaraReplyText).toBe('Draft reply: I have reviewed the Q4 pack.');
    expect(thaaraDraft.effectiveStatus).toBe('draft');

    // 3. Waiting for approval
    const awaitingApproval = classifyGmailMessage({
      id: 'm3',
      subject: 'Approval Needed',
      from: 'exec@thaara.test',
      approvalState: 'awaiting_approval',
    });
    expect(awaitingApproval.thaaraActivityStatus).toBe('Waiting for approval');
    expect(awaitingApproval.effectiveStatus).toBe('draft');

    // 4. CRITICAL: A verifiedReceiptId ALONE without receiptOutcome === 'verified' MUST NOT be treated as sent!
    const receiptWithoutVerifiedOutcome = classifyGmailMessage({
      id: 'm4',
      subject: 'Unverified Receipt Outcome',
      from: 'exec@thaara.test',
      origin: 'thaara_sent_verified',
      verifiedReceiptId: 'rcpt_999',
      receiptOutcome: 'unverified',
    });
    expect(receiptWithoutVerifiedOutcome.thaaraActivityStatus).toBe(
      'Sending failed / could not verify',
    );
    expect(receiptWithoutVerifiedOutcome.origin).toBe('thaara_unverified');
    expect(receiptWithoutVerifiedOutcome.thaaraActivityStatus).not.toBe(
      'Reply sent by Thaara — verified',
    );

    const receiptMissingOutcome = classifyGmailMessage({
      id: 'm4b',
      subject: 'Missing Receipt Outcome',
      from: 'exec@thaara.test',
      origin: 'thaara_sent_verified',
      verifiedReceiptId: 'rcpt_999',
    });
    expect(receiptMissingOutcome.thaaraActivityStatus).toBe('Sending failed / could not verify');

    // 5. Reply sent by Thaara — verified (ONLY when both verifiedReceiptId and receiptOutcome === 'verified' exist)
    const verifiedThaara = classifyGmailMessage({
      id: 'm5',
      subject: 'Verified Executive Digest',
      from: 'exec@thaara.test',
      origin: 'thaara_sent_verified',
      verifiedReceiptId: 'rcpt_verified_991',
      receiptOutcome: 'verified',
      thaaraReplyText: 'Confirmed Thursday standup at 10:47 AM IST.',
    });
    expect(verifiedThaara.thaaraActivityStatus).toBe('Reply sent by Thaara — verified');
    expect(verifiedThaara.thaaraReplyText).toBe('Confirmed Thursday standup at 10:47 AM IST.');
    expect(verifiedThaara.effectiveStatus).toBe('sent');

    // Filtering Gmail rows by Type and Status
    const rows = [
      { id: 'm1', subject: 'Board Pack', from: 'chair@board.test', unread: true },
      {
        id: 'm2',
        subject: 'Draft Summary',
        from: 'exec@thaara.test',
        origin: 'thaara_draft' as const,
      },
      {
        id: 'm3',
        subject: 'Sent Digest',
        from: 'exec@thaara.test',
        origin: 'thaara_sent_verified' as const,
        verifiedReceiptId: 'rcpt_1',
        receiptOutcome: 'verified' as const,
      },
    ];
    expect(filterGmailRows(rows, { typeFilter: 'thaara_actions' }).map((r) => r.id)).toEqual([
      'm2',
      'm3',
    ]);
    expect(filterGmailRows(rows, { statusFilter: 'draft' }).map((r) => r.id)).toEqual(['m2']);
    expect(filterGmailRows(rows, { statusFilter: 'unread' }).map((r) => r.id)).toEqual(['m1']);
    expect(filterGmailRows(rows, { searchQuery: 'board' }).map((r) => r.id)).toEqual(['m1']);
  });

  it('3. Gmail UI: displays sender email address only without repeating sender in snippet, full reading pane, and Thaara Activity section', () => {
    const connectedGmail = {
      connectorName: 'gmail' as const,
      status: 'connected' as const,
      configured: true,
      connected: true,
      mode: 'mock' as const,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      lastVerifiedAt: '2026-10-22T04:00:00.000Z',
    };
    const state = {
      ...initialGmailState('owner'),
      status: connectedGmail,
      searched: true,
      selectedId: 'msg_1',
      rows: [
        {
          id: 'msg_1',
          subject: 'Q4 Audit Readiness',
          from: 'Ananya Rao <ananya@board.test>',
          date: '2026-10-22T04:40:00.000Z',
          snippet: 'Please confirm Thursday standup.',
        },
      ],
      preview: {
        id: 'msg_1',
        subject: 'Q4 Audit Readiness',
        from: 'Ananya Rao <ananya@board.test>',
        to: 'Executive Owner <exec@thaara.test>',
        date: '2026-10-22T04:40:00.000Z',
        bodyText: 'Please confirm Thursday standup and review the Q4 pack.',
        untrusted: true as const,
        mode: 'mock' as const,
      },
    };

    const html = renderToStaticMarkup(
      <GmailScreenView
        state={state}
        draft=""
        onDraft={() => {}}
        onSearch={() => {}}
        onInbox={() => {}}
        onNext={() => {}}
        onSelect={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        timeZone="Asia/Kolkata"
        nowMs={FIXED_NOW_MS}
      />,
    );

    // Displays sender EMAIL ADDRESS only, not full name + address
    expect(html).toContain('ananya@board.test');
    expect(html).not.toContain('Ananya Rao &lt;ananya@board.test&gt;');
    // Snippet does not repeat sender info
    expect(html).toContain('Please confirm Thursday standup.');
    expect(html).not.toContain('ananya@board.test · Please confirm Thursday standup.');
    // Reading pane shows From email, To email, subject, friendly date, body, and Thaara Activity
    expect(html).toContain('exec@thaara.test');
    expect(html).toContain('Today, 10:10 AM');
    expect(html).toContain('Thaara Activity');
    expect(html).toContain('No action taken');
    expect(html).toContain('Thaara has not replied to this email.');
    expect(html).not.toContain('2026-10-22T04:40:00.000Z');
  });

  it('4. WhatsApp: strips job titles from contact names, aligns inbound messages left and outgoing/drafts right without repeating sender in every bubble', () => {
    // Contact name formatting & fallback rules
    expect(
      formatWhatsAppContactName({
        displayName: 'Ananya Rao (Board Chair)',
        maskedPhone: '+91 ******3210',
      }),
    ).toEqual({ name: 'Ananya Rao', isOwnerSaved: false });

    expect(
      formatWhatsAppContactName({
        displayName: 'Vikram Menon (General Counsel)',
        maskedPhone: '+91 ******2233',
      }),
    ).toEqual({ name: 'Vikram Menon', isOwnerSaved: false });

    expect(
      formatWhatsAppContactName({
        ownerSavedName: 'Ananya R.',
        displayName: 'Ananya Rao (Board Chair)',
        maskedPhone: '+91 ******3210',
      }),
    ).toEqual({ name: 'Ananya R.', isOwnerSaved: true });

    expect(
      formatWhatsAppContactName({
        displayName: '',
        maskedPhone: '+91 ******3210',
      }),
    ).toEqual({ name: '+91 ******3210', isOwnerSaved: false });

    const waStatus: WhatsAppStatus = {
      connectorName: 'whatsapp_business',
      status: 'connected',
      configured: true,
      connected: true,
      mode: 'mock',
      capabilities: ['whatsapp.messages.read', 'whatsapp.threads.read'],
      maskedBusinessPhone: '+91 ******9000',
      lastVerifiedAt: '2026-10-22T05:00:00.000Z',
    };

    const threads: WhatsAppThreadSummary[] = [
      {
        threadId: 'th_1',
        participant: {
          contactHash: 'wa_hash_12345678',
          maskedPhone: '+91 ******3210',
          displayName: 'Ananya Rao (Board Chair)',
        },
        lastMessageAt: '2026-10-19T05:30:00.000Z',
        lastMessagePreview: 'Confirm board call dial-in.',
        unreadCount: 1,
        untrusted: true,
        mode: 'mock',
      },
    ];

    const inboundMsg: WhatsAppMessage = {
      id: 'wa_in_1',
      threadId: 'th_1',
      direction: 'inbound',
      sender: {
        contactHash: 'wa_hash_12345678',
        maskedPhone: '+91 ******3210',
        displayName: 'Ananya Rao (Board Chair)',
      },
      textPreview: 'Confirm board call dial-in.',
      timestamp: '2026-10-19T05:30:00.000Z',
      deliveryStatus: 'received',
      untrusted: true,
      mode: 'mock',
    };

    const draftMsg: WhatsAppMessage = {
      id: 'wa_draft_2',
      threadId: 'th_1',
      direction: 'outbound_draft',
      sender: {
        contactHash: 'wa_hash_exec9999',
        maskedPhone: '+91 ******9000',
        displayName: 'Thaara Draft',
      },
      textPreview: 'Draft reply: Dial-in remains unchanged for 11:00 AM IST.',
      timestamp: '2026-10-22T04:40:00.000Z',
      deliveryStatus: 'draft_awaiting_approval',
      untrusted: true,
      mode: 'mock',
    };

    // Truthful message labels
    expect(classifyWhatsAppMessage(inboundMsg)).toMatchObject({
      alignment: 'left',
      senderBadge: 'Message from contact',
    });
    expect(classifyWhatsAppMessage(draftMsg)).toMatchObject({
      alignment: 'right',
      senderBadge: 'Thaara draft — not sent',
    });
    expect(
      classifyWhatsAppMessage({ ...inboundMsg, origin: 'user_sent' }),
    ).toMatchObject({
      alignment: 'right',
      senderBadge: 'Sent by user',
    });
    expect(
      classifyWhatsAppMessage({
        ...draftMsg,
        origin: 'thaara_sent_verified',
        verifiedReceiptId: 'rcpt_wa_1',
        receiptOutcome: 'verified',
      }),
    ).toMatchObject({
      alignment: 'right',
      senderBadge: 'Thaara reply — verified sent',
    });
    expect(
      classifyWhatsAppMessage({
        ...draftMsg,
        origin: 'thaara_sent_verified',
        verifiedReceiptId: null,
      }),
    ).toMatchObject({
      alignment: 'right',
      senderBadge: 'Failed / unverified',
    });

    const html = renderToStaticMarkup(
      <WhatsAppScreenView
        state={{
          ...initialWhatsAppState('owner'),
          status: waStatus,
          threads,
          messages: [inboundMsg, draftMsg],
          selectedThreadId: 'th_1',
          selectedMessageId: 'wa_draft_2',
          preview: draftMsg,
          searched: true,
        }}
        draft=""
        onDraft={() => {}}
        onSearch={() => {}}
        onResetFilter={() => {}}
        onSelectThread={() => {}}
        onSelectMessage={() => {}}
        onNext={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        timeZone="Asia/Kolkata"
        nowMs={FIXED_NOW_MS}
      />,
    );

    expect(html).toContain('Ananya Rao');
    expect(html).not.toContain('(Board Chair)');
    expect(html).toContain('data-testid="whatsapp-msg-row-wa_in_1" data-alignment="left"');
    expect(html).toContain('data-testid="whatsapp-msg-row-wa_draft_2" data-alignment="right"');
    expect(html).toContain('Message from contact');
    expect(html).toContain('Thaara draft — not sent');
    // DEMO / MOCK badge appears once in the page header
    expect(html.match(/DEMO \/ MOCK/g)?.length).toBe(1);
    expect(html).not.toContain('2026-10-19T05:30:00.000Z');
  });

  it('5. Phone: strips job titles from contact names, maps simple statuses, simplifies technical call purposes, and never fabricates call transcripts or completed calls', () => {
    // 1. Contact saved-name fallback & stripping of (CFO), (Board Chair), (VP Operations)
    expect(
      formatPhoneContactName({
        contactDisplayName: 'Rohan Deshmukh (CFO)',
        maskedPhoneNumber: '+91 ******9887',
      }),
    ).toEqual({ name: 'Rohan Deshmukh', isOwnerSaved: false });
    expect(
      formatPhoneContactName({
        ownerSavedName: 'Rohan D.',
        contactDisplayName: 'Rohan Deshmukh (CFO)',
        maskedPhoneNumber: '+91 ******9887',
      }),
    ).toEqual({ name: 'Rohan D.', isOwnerSaved: true });
    expect(
      formatPhoneContactName({
        contactDisplayName: '',
        maskedPhoneNumber: '+91 ******9887',
      }),
    ).toEqual({ name: '+91 ******9887', isOwnerSaved: false });

    // 2. Simple status labels while preserving backend status codes
    expect(formatPhoneSimpleStatus('queued')).toBe('Waiting to call');
    expect(formatPhoneSimpleStatus('ringing')).toBe('Calling');
    expect(formatPhoneSimpleStatus('answered')).toBe('Answered');
    expect(formatPhoneSimpleStatus('completed')).toBe('Completed');
    expect(formatPhoneSimpleStatus('failed')).toBe('Could not connect');
    expect(formatPhoneSimpleStatus('cancelled')).toBe('Cancelled');

    // 3. Plain-language purpose descriptions without guessing or implying queued calls happened
    expect(
      formatPhoneCallPurpose('Simulated liquidity forecast confirmation call.', 'queued'),
    ).toEqual({
      listReason: 'Planned call about company cash planning',
      detailReason: 'Discuss company cash planning',
      outcomeSummary: 'Planned call about company cash planning',
    });
    expect(formatPhoneCallPurpose('', 'queued')).toEqual({
      listReason: 'Call purpose unavailable',
      detailReason: 'Call purpose unavailable',
      outcomeSummary: 'Call purpose unavailable',
    });

    const phoneStatus: PhoneStatus = {
      connectorName: 'phone_telephony',
      status: 'connected',
      configured: true,
      connected: true,
      mode: 'mock',
      capabilities: ['phone.calls.read', 'phone.calls.history'],
      maskedLineNumber: '+91 ******9000',
      recordingEnabled: false,
      transcriptionEnabled: false,
    };

    const queuedCall: PhoneCallRecord = {
      id: 'phcall_exec_004',
      providerCallId: 'prov_4',
      direction: 'outbound_simulated',
      lifecycleState: 'queued',
      maskedPhoneNumber: '+91 ******9887',
      contactDisplayName: 'Rohan Deshmukh (CFO)',
      purposeSummary: 'Simulated liquidity forecast confirmation call.',
      startedAt: '2026-10-19T09:00:00.000Z', // 19 Oct, 2:30 PM IST
      recordingAvailable: false,
      transcriptAvailable: false,
      untrusted: true,
      mode: 'mock',
    };

    const completedCall: PhoneCallRecord = {
      id: 'ph_call_1',
      providerCallId: 'prov_1',
      direction: 'inbound',
      lifecycleState: 'completed',
      maskedPhoneNumber: '+91 ******3210',
      contactDisplayName: 'Ram Sharma (VP Operations)',
      purposeSummary: 'Ram said he expects to arrive around 6:30 PM.',
      startedAt: '2026-10-22T04:40:00.000Z',
      endedAt: '2026-10-22T04:42:00.000Z',
      durationSeconds: 120,
      recordingAvailable: false,
      transcriptAvailable: false,
      untrusted: true,
      mode: 'mock',
    };

    // 4. Queued call selected: shows Contact, Date, Type, Status ("Waiting to call"), Reason ("Discuss company cash planning") and never claims call completed
    const queuedHtml = renderToStaticMarkup(
      <PhoneScreen
        workspaceId="ws-1"
        userId="u-1"
        role="owner"
        timeZone="Asia/Kolkata"
        nowMs={FIXED_NOW_MS}
        initialState={{
          status: phoneStatus,
          calls: [queuedCall, completedCall],
          selectedCall: queuedCall,
          totalCount: 2,
        }}
      />,
    );

    expect(queuedHtml).toContain('Rohan Deshmukh');
    expect(queuedHtml).not.toContain('(CFO)');
    expect(queuedHtml).not.toContain('(VP Operations)');
    expect(queuedHtml).toContain('19 Oct, 2:30 PM');
    expect(queuedHtml).toContain('Outgoing');
    expect(queuedHtml).toContain('Waiting to call');
    expect(queuedHtml).toContain('Planned call about company cash planning');
    expect(queuedHtml).toContain('Discuss company cash planning');
    expect(queuedHtml).not.toContain('data-testid="phone-call-outcome"');
    expect(queuedHtml.match(/DEMO \/ MOCK/g)?.length).toBe(1);

    // 5. Completed call selected (metadata only): shows unavailable notice + CALL OUTCOME
    const metadataOnlyHtml = renderToStaticMarkup(
      <PhoneScreen
        workspaceId="ws-1"
        userId="u-1"
        role="owner"
        timeZone="Asia/Kolkata"
        nowMs={FIXED_NOW_MS}
        initialState={{
          status: phoneStatus,
          calls: [completedCall],
          selectedCall: completedCall,
          totalCount: 1,
        }}
      />,
    );

    expect(metadataOnlyHtml).toContain(
      'Call conversation unavailable — this integration currently contains call metadata only.',
    );
    expect(metadataOnlyHtml).toContain('CALL OUTCOME');
    expect(metadataOnlyHtml).toContain('Ram said he expects to arrive around 6:30 PM.');
    expect(metadataOnlyHtml).toContain('Today, 10:10 AM');
    expect(metadataOnlyHtml).not.toContain('data-testid="phone-dialogue-turn-0"');

    // 6. Completed call with explicit simulated dialogue fixture: shows What Thaara said & What Ram Sharma said
    const simulatedDialogueHtml = renderToStaticMarkup(
      <PhoneScreen
        workspaceId="ws-1"
        userId="u-1"
        role="owner"
        timeZone="Asia/Kolkata"
        nowMs={FIXED_NOW_MS}
        initialState={{
          status: phoneStatus,
          calls: [completedCall],
          selectedCall: completedCall,
          totalCount: 1,
        }}
        simulatedDialogueByCallId={{
          ph_call_1: [
            { speaker: 'Thaara', text: 'Hello Ram, what time will you arrive?' },
            { speaker: 'Ram', text: "I'll arrive around 6:30 PM." },
          ],
        }}
      />,
    );

    expect(simulatedDialogueHtml).toContain('What Thaara said');
    expect(simulatedDialogueHtml).toContain('What Ram Sharma said');
    expect(simulatedDialogueHtml).toContain('Hello Ram, what time will you arrive?');
    expect(simulatedDialogueHtml).toContain('I&#x27;ll arrive around 6:30 PM.');
    expect(simulatedDialogueHtml).toContain('CALL OUTCOME');
  });

  it('6. Calendar: presents date-first event cards in exact order, maps simple statuses (Confirmed, Maybe, Cancelled), and explains overlap once in plain language', () => {
    expect(formatCalendarSimpleStatus('confirmed')).toBe('Confirmed');
    expect(formatCalendarSimpleStatus('tentative')).toBe('Maybe');
    expect(formatCalendarSimpleStatus('cancelled')).toBe('Cancelled');

    const calStatus: CalendarStatus = {
      connectorName: 'google_calendar',
      status: 'connected',
      configured: true,
      connected: true,
      mode: 'mock',
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      lastVerifiedAt: '2026-10-22T04:00:00Z',
    };

    // 10:47 AM – 11:47 AM IST on Thursday, 22 October 2026 (05:17Z – 06:17Z)
    const evStandup: CalendarEvent = {
      id: 'ev_1',
      calendarId: 'primary',
      summary: 'Executive Morning Standup',
      location: 'Boardroom 1',
      startAt: '2026-10-22T05:17:00Z',
      endAt: '2026-10-22T06:17:00Z',
      timeZone: 'Asia/Kolkata',
      allDay: false,
      status: 'confirmed',
      attendees: [],
      untrusted: true,
      mode: 'mock',
    };

    // 11:17 AM – 12:17 PM IST on Thursday, 22 October 2026 (05:47Z – 06:47Z)
    const evPartnerSync: CalendarEvent = {
      id: 'ev_2',
      calendarId: 'primary',
      summary: 'Series B Partner Sync',
      location: 'Virtual',
      startAt: '2026-10-22T05:47:00Z',
      endAt: '2026-10-22T06:47:00Z',
      timeZone: 'Asia/Kolkata',
      allDay: false,
      status: 'tentative',
      attendees: [],
      untrusted: true,
      mode: 'mock',
    };

    const evNonConflicting: CalendarEvent = {
      id: 'ev_3',
      calendarId: 'primary',
      summary: 'Architecture Review',
      location: 'Room 302',
      startAt: '2026-10-22T09:00:00Z',
      endAt: '2026-10-22T10:00:00Z',
      timeZone: 'Asia/Kolkata',
      allDay: false,
      status: 'confirmed',
      attendees: [],
      untrusted: true,
      mode: 'mock',
    };

    const allEvents = [evStandup, evPartnerSync, evNonConflicting];
    const conflictIds = new Set(['ev_1', 'ev_2']);

    const conflictDetails = getCalendarConflictDetails(
      evStandup,
      allEvents,
      conflictIds,
      'Asia/Kolkata',
    );
    expect(conflictDetails).toEqual({
      warningText: 'You have two meetings at the same time between 11:17 AM and 11:47 AM.',
      otherMeetingNote: 'Another meeting at this time: Series B Partner Sync.',
    });

    expect(
      describeCalendarConflict(evNonConflicting, allEvents, conflictIds, 'Asia/Kolkata'),
    ).toBeNull();

    const days = [{ localDate: '2026-10-22', events: allEvents }];
    expect(
      filterCalendarAgendaDays(days, { statusFilter: 'tentative' })[0]?.events.map((e) => e.id),
    ).toEqual(['ev_2']);

    const agenda: CalendarAgendaResult = {
      windowStart: '2026-10-22T00:00:00Z',
      windowEnd: '2026-10-29T00:00:00Z',
      timeZone: 'Asia/Kolkata',
      totalEvents: 3,
      conflictEventIds: ['ev_1', 'ev_2'],
      days,
      n8nContext: {
        connector: 'google_calendar',
        operation: 'read_agenda_snapshot',
        readOnly: true,
        timeZone: 'Asia/Kolkata',
        windowStart: '2026-10-22T00:00:00Z',
        windowEnd: '2026-10-29T00:00:00Z',
        eventIds: ['ev_1', 'ev_2', 'ev_3'],
      },
      untrusted: true,
      mode: 'mock',
    };

    const html = renderToStaticMarkup(
      <CalendarScreenView
        state={{
          ...initialCalendarState('owner', { timeZone: 'Asia/Kolkata' }),
          status: calStatus,
          agenda,
          selectedId: 'ev_1',
          selectedEvent: evStandup,
          loaded: true,
        }}
        timeZoneDraft="Asia/Kolkata"
        onTimeZoneDraft={() => {}}
        onApplyTimeZone={() => {}}
        onToday={() => {}}
        onPrevRange={() => {}}
        onNextRange={() => {}}
        onToggleCancelled={() => {}}
        onSelectEvent={() => {}}
        onRefresh={() => {}}
        onDisconnect={() => {}}
        nowMs={FIXED_NOW_MS}
      />,
    );

    // Date-first card presentation in exact order
    const cardIdxDate = html.indexOf('data-testid="calendar-event-date-ev_1"');
    const cardIdxTime = html.indexOf('data-testid="calendar-event-time-ev_1"');
    const cardIdxTitle = html.indexOf('data-testid="calendar-event-title-ev_1"');
    const cardIdxLocation = html.indexOf('data-testid="calendar-event-location-ev_1"');
    const cardIdxStatus = html.indexOf('data-testid="calendar-event-status-ev_1"');
    const cardIdxConflict = html.indexOf('data-testid="calendar-event-conflict-ev_1"');

    expect(cardIdxDate).toBeGreaterThan(-1);
    expect(cardIdxTime).toBeGreaterThan(cardIdxDate);
    expect(cardIdxTitle).toBeGreaterThan(cardIdxTime);
    expect(cardIdxLocation).toBeGreaterThan(cardIdxTitle);
    expect(cardIdxStatus).toBeGreaterThan(cardIdxLocation);
    expect(cardIdxConflict).toBeGreaterThan(cardIdxStatus);

    expect(html).toContain('Thursday, 22 October');
    expect(html).toContain('10:47 AM – 11:47 AM');
    expect(html).toContain('Executive Morning Standup');
    expect(html).toContain('Boardroom 1');
    expect(html).toContain('Confirmed');
    expect(html).toContain('Maybe');
    expect(html).toContain(
      'You have two meetings at the same time between 11:17 AM and 11:47 AM.',
    );
    expect(html).toContain('Another meeting at this time: Series B Partner Sync.');
    // Free of repetitive conflict labels
    expect(html).not.toContain('Schedule conflict detected');
    expect(html).not.toContain('Conflicts with another meeting');
    expect(formatFriendlyEventTimeRange(evStandup, 'Asia/Kolkata')).toBe('10:47 AM – 11:47 AM');
  });
});
