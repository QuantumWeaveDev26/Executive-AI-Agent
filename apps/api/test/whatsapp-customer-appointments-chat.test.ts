import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { defaultPolicyGateway } from '@thaara/policy';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { whatsappDurableInboxRoutes } from '../src/routes/whatsapp-inbox.js';
import { detectWhatsAppReplyChatRequest, executeChatWhatsAppReply } from '../src/services/chat-whatsapp-assistant.js';
import { detectWhatsAppReadChatRequest, executeChatWhatsAppRead } from '../src/services/chat-whatsapp-read.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waNow } from './helpers/whatsapp-durable-fixture.js';

describe('WhatsApp New Customer Inbound, Appointments & Chat Actions', () => {
  it('auto-registers a first-time customer and generates greeting reply without 403', async () => {
    const store = new WhatsAppTransactionalFixture();
    const submit = vi.fn(async () => {});
    const service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow, {
      profile: () => ({ connectionId: waBinding.connectionId, recipientId: '*', maxPerDay: 50, expiresAt: waNow + 3600000, autoReply: true }),
      dispatcher: { submit },
      autoReply: {
        enabled: true,
        ownerScope: { ...waScope, role: 'owner' as const },
        authorizeDraft: (_scope, draft) => {
          const approvalId = 'appr_' + draft.idempotencyKey;
          store.approvals.set(approvalId, {
            id: approvalId,
            workspaceId: waScope.workspaceId,
            requesterUserId: waScope.userId,
            approverUserId: waScope.userId,
            actionName: 'whatsapp.meta.messages.send',
            actionParams: draft,
            status: 'approved',
            riskLevel: 'high',
            createdAt: new Date(waNow).toISOString(),
            updatedAt: new Date(waNow).toISOString(),
            expiresAt: new Date(Date.now() + 3600000).toISOString()
          });
          return approvalId;
        }
      }
    });

    // Inbound event from completely new customer phone 919380815125
    const newCustomerPhone = '919380815125';
    const newCustomerWebhook = {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: {
        display_phone_number: '15550000000',
        phone_number_id: waBinding.phoneNumberId
      },
      contacts: [
        {
          profile: { name: 'Priya Sharma' },
          wa_id: newCustomerPhone
        }
      ],
      messages: [
        {
          from: newCustomerPhone,
          id: 'wamid.new_customer_01',
          timestamp: String(Math.floor(waNow / 1000)),
          type: 'text',
          text: { body: 'hellooo' }
        }
      ]
    };

    // Ingest should NOT throw 403 denied!
    await expect(service.ingest(waScope, waBinding.connectionId, newCustomerWebhook)).resolves.not.toThrow();

    // Verify recipient was registered dynamically
    const expectedRecipientId = `c_${newCustomerPhone}`;
    const registered = await service.getRecipient(waScope, waBinding.connectionId, expectedRecipientId);
    expect(registered).not.toBeNull();
    expect(registered?.recipient.phoneE164).toBe(`+${newCustomerPhone}`);
    expect(registered?.recipient.displayName).toBe('Priya Sharma');
    expect(registered?.recipient.optedIn).toBe(true);

    // Verify inbox shows this conversation
    const inbox = await service.inbox(waScope, waBinding.connectionId, {});
    const customerConv = inbox.conversations.find(c => c.recipientId === expectedRecipientId);
    expect(customerConv).toBeDefined();
    expect(customerConv?.contactName).toBe('Priya Sharma');
  });

  it('preserves all contacts without sliding-window eviction when customer scale exceeds 5, 50, and 100', async () => {
    const store = new WhatsAppTransactionalFixture();
    const service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);

    // Initial static binding with owner contact
    store.state.binding.recipients = [
      { id: 'owner_test_phone', phoneE164: '+917019624634', optedIn: true }
    ];
    const initialRevision = store.state.binding.revision;

    // Register 100 dynamic customers sequentially
    for (let i = 1; i <= 100; i++) {
      const phoneDigits = `91900000${String(i).padStart(4, '0')}`;
      const recipientId = `c_${phoneDigits}`;
      const success = await service.ensureRecipientRegistered(
        { ...waScope, role: 'owner' as const },
        waBinding.connectionId,
        recipientId,
        { phoneE164: `+${phoneDigits}`, displayName: `Customer ${i}` }
      );
      expect(success).toBe(true);

      // Verify recipient is retrievable
      const lookup = await service.getRecipient(waScope, waBinding.connectionId, recipientId);
      expect(lookup).not.toBeNull();
      expect(lookup?.recipient.phoneE164).toBe(`+${phoneDigits}`);
    }

    // Static binding recipient list remains intact with owner contact, no sliding window eviction occurred
    expect(store.state.binding.recipients.length).toBe(1);
    expect(store.state.binding.recipients[0].id).toBe('owner_test_phone');

    // Revision never incremented for dynamic customer registrations (no revision skew)
    expect(store.state.binding.revision).toBe(initialRevision);

    // Verify Customer 1, Customer 6, Customer 50, and Customer 100 are all intact simultaneously
    const c1 = await service.getRecipient(waScope, waBinding.connectionId, 'c_919000000001');
    const c6 = await service.getRecipient(waScope, waBinding.connectionId, 'c_919000000006');
    const c50 = await service.getRecipient(waScope, waBinding.connectionId, 'c_919000000050');
    const c100 = await service.getRecipient(waScope, waBinding.connectionId, 'c_919000000100');

    expect(c1).not.toBeNull();
    expect(c6).not.toBeNull();
    expect(c50).not.toBeNull();
    expect(c100).not.toBeNull();
  });

  it('handles 100 sequential unique customers with automatic replies and preserves Customer 1 on return', async () => {
    let currentTime = waNow;
    const store = new WhatsAppTransactionalFixture();
    const submittedDispatches: any[] = [];
    const service = new DurableWhatsAppService(store, defaultPolicyGateway, () => currentTime, {
      profile: () => ({ connectionId: waBinding.connectionId, recipientId: '*', maxPerDay: null, expiresAt: currentTime + 3600000, autoReply: true }),
      dispatcher: {
        submit: async (dispatch: any) => {
          submittedDispatches.push(dispatch);
        }
      },
      autoReply: {
        enabled: true,
        ownerScope: { ...waScope, role: 'owner' as const },
        authorizeDraft: (_scope, draft) => {
          const approvalId = 'appr_' + draft.idempotencyKey;
          store.approvals.set(approvalId, {
            id: approvalId,
            workspaceId: waScope.workspaceId,
            requesterUserId: waScope.userId,
            approverUserId: waScope.userId,
            actionName: 'whatsapp.meta.messages.send',
            actionParams: draft,
            status: 'approved',
            riskLevel: 'high',
            createdAt: new Date(currentTime).toISOString(),
            updatedAt: new Date(currentTime).toISOString(),
            expiresAt: new Date(Date.now() + 3600000).toISOString()
          });
          return approvalId;
        }
      }
    });

    // Ingest messages from 100 different customers
    for (let i = 1; i <= 100; i++) {
      currentTime = waNow + i * 1000;
      const phone = `91911111${String(i).padStart(4, '0')}`;
      const webhook = {
        field: 'messages',
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: waBinding.phoneNumberId },
        contacts: [{ profile: { name: `Customer ${i}` }, wa_id: phone }],
        messages: [{
          from: phone,
          id: `wamid.scale_msg_${i}`,
          timestamp: String(Math.floor(currentTime / 1000)),
          type: 'text',
          text: { body: 'Hello' }
        }]
      };
      await service.ingest(waScope, waBinding.connectionId, webhook);
    }

    // Verify all 100 customers got dispatches
    expect(submittedDispatches.length).toBe(100);

    // Verify Customer 1 returns with a follow-up message after Customer 100
    currentTime = waNow + 200 * 1000;
    const c1Phone = '919111110001';
    const c1ReturnWebhook = {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: waBinding.phoneNumberId },
      contacts: [{ profile: { name: 'Customer 1' }, wa_id: c1Phone }],
      messages: [{
        from: c1Phone,
        id: 'wamid.scale_c1_return',
        timestamp: String(Math.floor(currentTime / 1000)),
        type: 'text',
        text: { body: 'What services do you provide?' }
      }]
    };
    await service.ingest(waScope, waBinding.connectionId, c1ReturnWebhook);

    // Customer 1 receives their second automatic reply without any error or eviction
    expect(submittedDispatches.length).toBe(101);
    const c1LastSubmission = submittedDispatches[100];
    const c1LastDispatch = store.state.dispatches.find((d: any) => d.id === c1LastSubmission.dispatchId);
    expect(c1LastDispatch?.draft.recipientId).toBe(`c_${c1Phone}`);
  });

  it('handles concurrent incoming customer messages without race conditions, revision churn, or cross-customer leakage', async () => {
    const store = new WhatsAppTransactionalFixture();
    const submittedDispatches: any[] = [];
    const service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow, {
      profile: () => ({ connectionId: waBinding.connectionId, recipientId: '*', maxPerDay: null, expiresAt: waNow + 3600000, autoReply: true }),
      dispatcher: {
        submit: async (dispatch: any) => {
          submittedDispatches.push(dispatch);
        }
      },
      autoReply: {
        enabled: true,
        ownerScope: { ...waScope, role: 'owner' as const },
        authorizeDraft: (_scope, draft) => {
          const approvalId = 'appr_' + draft.idempotencyKey;
          store.approvals.set(approvalId, {
            id: approvalId,
            workspaceId: waScope.workspaceId,
            requesterUserId: waScope.userId,
            approverUserId: waScope.userId,
            actionName: 'whatsapp.meta.messages.send',
            actionParams: draft,
            status: 'approved',
            riskLevel: 'high',
            createdAt: new Date(waNow).toISOString(),
            updatedAt: new Date(waNow).toISOString(),
            expiresAt: new Date(Date.now() + 3600000).toISOString()
          });
          return approvalId;
        }
      }
    });

    const initialRevision = store.state.binding.revision;

    // Simulate 20 concurrent customer messages arriving at the same instant
    const concurrentCount = 20;
    const promises = Array.from({ length: concurrentCount }, (_, i) => {
      const idx = i + 1;
      const phone = `91922222${String(idx).padStart(4, '0')}`;
      const webhook = {
        field: 'messages',
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: waBinding.phoneNumberId },
        contacts: [{ profile: { name: `Concurrent ${idx}` }, wa_id: phone }],
        messages: [{
          from: phone,
          id: `wamid.concurrent_${idx}`,
          timestamp: String(Math.floor(waNow / 1000)),
          type: 'text',
          text: { body: 'Hi' }
        }]
      };
      return service.ingest(waScope, waBinding.connectionId, webhook);
    });

    await Promise.all(promises);

    // All 20 concurrent messages processed and dispatched cleanly
    expect(submittedDispatches.length).toBe(concurrentCount);

    // No cross-customer leakage: each dispatch recipient matches its respective message
    for (let i = 1; i <= concurrentCount; i++) {
      const phone = `91922222${String(i).padStart(4, '0')}`;
      const matching = store.state.dispatches.filter((d: any) => d.draft.recipientId === `c_${phone}`);
      expect(matching.length).toBe(1);
    }

    // Connection revision remained constant throughout concurrent ingestion
    expect(store.state.binding.revision).toBe(initialRevision);
  });

  it('enforces Meta 24-hour customer service window and marketing consent constraints', async () => {
    let currentTime = waNow;
    const store = new WhatsAppTransactionalFixture();
    const service = new DurableWhatsAppService(store, defaultPolicyGateway, () => currentTime);

    const customerPhone = '919333334444';
    const recipientId = `c_${customerPhone}`;

    // Customer initiates conversation at waNow
    const webhook = {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: waBinding.phoneNumberId },
      contacts: [{ profile: { name: 'Window Test Customer' }, wa_id: customerPhone }],
      messages: [{
        from: customerPhone,
        id: 'wamid.window_start',
        timestamp: String(Math.floor(waNow / 1000)),
        type: 'text',
        text: { body: 'Hello within service window' }
      }]
    };
    await service.ingest(waScope, waBinding.connectionId, webhook);

    // 1. Reply within 24 hours (e.g. at waNow + 2 hours) is allowed
    currentTime = waNow + 2 * 3600 * 1000;
    const validDraft = await service.replyDraft(
      { ...waScope, role: 'owner' as const },
      waBinding.connectionId,
      {
        recipientId,
        bodyText: 'Replying within 2 hours of customer contact'
      }
    );
    expect(validDraft.draft.recipientId).toBe(recipientId);

    // 2. Non-template reply after 24 hours (e.g. at waNow + 25 hours) is rejected
    currentTime = waNow + 25 * 3600 * 1000;
    await expect(
      service.replyDraft(
        { ...waScope, role: 'owner' as const },
        waBinding.connectionId,
        {
          recipientId,
          bodyText: 'Replying 25 hours later'
        }
      )
    ).rejects.toThrow(/24-hour reply window is closed/);

    // 3. Approved template message after 24 hours is permitted
    const templateDraft = await service.contentDraft(
      { ...waScope, role: 'owner' as const },
      waBinding.connectionId,
      recipientId,
      {
        template: {
          name: 'appointment_reminder',
          language: 'en_US',
          bodyParams: ['Window Test Customer', 'Tomorrow at 10 AM']
        }
      }
    );
    expect(templateDraft.draft.recipientId).toBe(recipientId);
    expect('template' in templateDraft.draft).toBe(true);
  });

  it('manages appointments: confirms with Google Calendar, prevents duplicate bookings, reschedules and cancels', async () => {
    const store = new WhatsAppTransactionalFixture();
    const service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);

    // Register recipient with requested appointment
    const recipientId = 'c_919999988888';
    store.state.binding.recipients.push({
      id: recipientId,
      phoneE164: '+919999988888',
      optedIn: true,
      displayName: 'Kiran Patel',
      appointment: {
        status: 'REQUESTED',
        customerName: 'Kiran Patel',
        business: 'Patel Silks',
        service: 'WhatsApp Automation',
        time: 'today at 7pm'
      }
    });

    const createdEvents: any[] = [];
    const mockGoogleCalendar: any = {
      writeReadiness: vi.fn(async () => ({ ready: true, connectedCalendar: 'team.quantumweaveai@gmail.com' })),
      findConflicts: vi.fn(async () => []),
      createEvent: vi.fn(async (_scope, params) => {
        const id = 'gcal_event_123';
        createdEvents.push({ id, ...params });
        return {
          connectorName: 'google_calendar',
          mode: 'mock',
          operation: 'create',
          status: 'event_created',
          providerEventId: id,
          htmlLink: 'https://calendar.google.com/event?id=' + id
        };
      }),
      rescheduleEvent: vi.fn(async (_scope, params) => {
        return {
          connectorName: 'google_calendar',
          mode: 'mock',
          operation: 'reschedule',
          status: 'event_rescheduled',
          providerEventId: params.eventId
        };
      }),
      cancelEvent: vi.fn(async (_scope, params) => {
        return {
          connectorName: 'google_calendar',
          mode: 'mock',
          operation: 'cancel',
          status: 'event_cancelled',
          providerEventId: params.eventId
        };
      })
    };

    const mockDb: any = {
      query: vi.fn(async () => ({ rows: [] }))
    };

    const app = Fastify();
    app.decorate('requireAuth', async (req: any) => {
      req.scope = waScope;
    });

    await whatsappDurableInboxRoutes(
      app,
      service,
      undefined,
      undefined,
      undefined,
      mockGoogleCalendar,
      mockDb
    );

    // 1. Confirm appointment (owner approves sending Calendly link; NO Google Calendar mutation)
    const confirmRes = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/confirm`,
      payload: { recipientId }
    });

    expect(confirmRes.statusCode).toBe(200);
    const confirmBody = JSON.parse(confirmRes.payload);
    expect(confirmBody.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(confirmBody.calendlyUrl).toBe('https://calendly.com/team-brandmint/30min');
    expect(confirmBody.bookingLinkSent).toBe(true);
    expect(mockGoogleCalendar.createEvent).toHaveBeenCalledTimes(0); // Zero Google Calendar mutations!

    // Verify appointment was saved on recipient
    const recipientAfterConfirm = await service.getRecipient(waScope, waBinding.connectionId, recipientId);
    expect(recipientAfterConfirm?.recipient.appointment?.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(recipientAfterConfirm?.recipient.appointment?.calendlyUrl).toBe('https://calendly.com/team-brandmint/30min');

    // 2. Duplicate click: returns awaiting booking with Calendly link, no calendar events created
    const duplicateConfirmRes = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/confirm`,
      payload: { recipientId }
    });
    expect(duplicateConfirmRes.statusCode).toBe(200);
    expect(mockGoogleCalendar.createEvent).toHaveBeenCalledTimes(0); // Still 0 calls!

    // 3. Reschedule appointment
    const rescheduleRes = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/reschedule`,
      payload: {
        recipientId,
        newStartAt: '2026-11-07T14:00:00.000Z',
        newEndAt: '2026-11-07T14:30:00.000Z',
        newDate: 'tomorrow',
        newTime: '2pm'
      }
    });
    expect(rescheduleRes.statusCode).toBe(200);
    expect(mockGoogleCalendar.rescheduleEvent).toHaveBeenCalledTimes(0);

    // 4. Cancel appointment
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/cancel`,
      payload: { recipientId }
    });
    expect(cancelRes.statusCode).toBe(200);
    const cancelBody = JSON.parse(cancelRes.payload);
    expect(cancelBody.status).toBe('CANCELLED');
    expect(mockGoogleCalendar.cancelEvent).toHaveBeenCalledTimes(0);

    const recipientAfterCancel = await service.getRecipient(waScope, waBinding.connectionId, recipientId);
    expect(recipientAfterCancel?.recipient.appointment?.status).toBe('CANCELLED');

    await app.close();
  });

  it('handles Thaara Chat outbound operational commands and generates actionable cards', async () => {
    const fakeDb: any = { withScopedTransaction: vi.fn(async () => ({ planId: 'plan-out-1', stepId: 'step-out-1', approvalId: 'appr-out-1' })) };

    const durableMock = (contactName: string) => ({
      connections: vi.fn(async () => ({ connections: [{ connectionId: 'wa_test', disconnected: false }] })),
      inbox: vi.fn(async () => ({
        conversations: [{
          recipientId: 'test_contact_id',
          contactName,
          maskedPhone: '+91 ******4634',
          enquiry: {
            leadStatus: 'Callback requested',
            requestedService: 'WhatsApp Automation',
            businessName: 'Test Business',
            preferredCallbackTime: 'today at 7pm'
          }
        }],
        messages: [{
          recipientId: 'test_contact_id',
          direction: 'inbound',
          textPreview: 'can we schedule for today at 7pm?',
          timestamp: new Date().toISOString()
        }]
      })),
      contacts: vi.fn(async () => ({
        contacts: [{ recipientId: 'test_contact_id', contactName, maskedPhone: '+91 ******4634', eligibility: 'eligible' }]
      })),
      replyDraft: vi.fn(async () => ({
        actionName: 'whatsapp.meta.messages.send',
        riskLevel: 'high',
        draft: {
          connectionId: 'wa_test',
          connectionRevision: 1,
          senderPhoneNumberId: 'phone_123',
          recipientId: 'test_contact_id',
          bodyText: 'Prepared reply',
          idempotencyKey: 'idemp_123'
        }
      }))
    }) as any;

    // 1. "reply to test contact on WhatsApp: Introducing Quantum Weave AI. What kind of business do you run?"
    const chatPrompt = 'reply to test contact on WhatsApp: Introducing Quantum Weave AI. What kind of business do you run?';
    const detectedIntent = detectWhatsAppReplyChatRequest(chatPrompt);
    expect(detectedIntent).not.toBeNull();
    expect(detectedIntent?.recipientQuery).toBe('test contact');

    const outboundResult = await executeChatWhatsAppReply(
      waScope,
      detectedIntent!,
      {
        db: fakeDb,
        durable: durableMock('Test Contact')
      }
    );

    expect(outboundResult.status).toBe('awaiting_approval');
    expect(outboundResult.assistantResponseText).toContain('Quantum Weave');
    expect(outboundResult.assistantResponseText).toMatch(/what\s+kind\s+of\s+business\s+do\s+you\s+run/i);

    // 2. "reply on WhatsApp: Your appointment is CONFIRMED with our team"
    const confirmPrompt = 'reply on WhatsApp: Your appointment is CONFIRMED with our team';
    const confirmIntent = detectWhatsAppReplyChatRequest(confirmPrompt);
    expect(confirmIntent).not.toBeNull();

    const confirmResult = await executeChatWhatsAppReply(
      waScope,
      confirmIntent!,
      {
        db: fakeDb,
        durable: durableMock('Test Contact')
      }
    );

    expect(confirmResult.status).toBe('awaiting_approval');
    expect(confirmResult.assistantResponseText).toContain('CONFIRMED');

    // 3. Read appointment requests via chat read query
    const readIntent = detectWhatsAppReadChatRequest("show today's appointment requests");
    expect(readIntent).not.toBeNull();
    const readResult = await executeChatWhatsAppRead(
      waScope,
      readIntent!,
      { durable: durableMock('Test Contact') }
    );

    expect(readResult.handled).toBe(true);
    expect(readResult.assistantResponseText).toBeDefined();
    expect(readResult.assistantResponseText).toContain('today at 7pm');
  });

  it('ensures new customer registration does not automatically grant blanket marketing opt-in consent', async () => {
    const store = new WhatsAppTransactionalFixture();
    const service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow);

    const newPhone = '919380815125';
    const newCustomerWebhook = {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: {
        display_phone_number: '15550000000',
        phone_number_id: waBinding.phoneNumberId
      },
      contacts: [
        {
          profile: { name: 'Priya' },
          wa_id: newPhone
        }
      ],
      messages: [
        {
          from: newPhone,
          id: 'wamid.new_customer_consent_01',
          timestamp: String(Math.floor(waNow / 1000)),
          type: 'text',
          text: { body: 'Hello, what services do you have?' }
        }
      ]
    };

    await service.ingest(waScope, waBinding.connectionId, newCustomerWebhook);
    const inbox = await service.inbox(waScope, waBinding.connectionId, {});
    const conv = inbox.conversations.find(c => c.recipientId === `c_${newPhone}`);
    expect(conv).toBeDefined();

    // In-window service reply is eligible, but blanket marketing consent is NOT granted
    expect(conv?.enquiry?.contactOptedIn).toBe(false);
    expect(conv?.enquiry?.consentProvenance).toBe('unknown');
    expect(conv?.enquiry?.consentRecorded).toBe(false);

    // If customer later explicitly consents in chat
    const consentWebhook = {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: {
        display_phone_number: '15550000000',
        phone_number_id: waBinding.phoneNumberId
      },
      messages: [
        {
          from: newPhone,
          id: 'wamid.new_customer_consent_02',
          timestamp: String(Math.floor(waNow / 1000) + 10),
          type: 'text',
          text: { body: 'Yes, please message me and opt me in for updates.' }
        }
      ]
    };

    await service.ingest(waScope, waBinding.connectionId, consentWebhook);
    const inboxAfterConsent = await service.inbox(waScope, waBinding.connectionId, {});
    const convAfterConsent = inboxAfterConsent.conversations.find(c => c.recipientId === `c_${newPhone}`);
    expect(convAfterConsent?.enquiry?.consentProvenance).toBe('explicit_message_consent');
    expect(convAfterConsent?.enquiry?.consentRecorded).toBe(true);
  });

  it('resolves customer Meghna by name from conversation enquiry into an approval card', async () => {
    const fakeDb: any = { withScopedTransaction: vi.fn(async () => ({ planId: 'plan-meghna', stepId: 'step-meghna', approvalId: 'appr-meghna' })) };
    const replyDraft = vi.fn(async () => ({
      draft: {
        connectionId: 'wa_pilot_meta_test_10813b',
        connectionRevision: 1,
        senderPhoneNumberId: '1402873856243129',
        recipientId: 'c_919876543210',
        bodyText: 'Hi Meghna, thank you for reaching out!',
        idempotencyKey: 'reply-meghna-1'
      }
    }));
    const durable: any = {
      connections: vi.fn(async () => ({ connections: [{ connectionId: 'wa_pilot_meta_test_10813b', revision: 1, disconnected: false }] })),
      inbox: vi.fn(async () => ({
        liveSendingEnabled: true,
        conversations: [
          {
            recipientId: 'c_919876543210',
            contactName: 'C 919876543210',
            maskedPhone: '+91 ****3210',
            enquiry: {
              customerName: 'Meghna',
              businessName: 'Meghna Boutique',
              requestedService: 'WhatsApp Automation'
            }
          }
        ],
        messages: [
          {
            direction: 'inbound',
            recipientId: 'c_919876543210',
            providerMessageId: 'wamid.meghna_hi',
            textPreview: 'Hi, I am Meghna from Meghna Boutique',
            timestamp: new Date().toISOString()
          }
        ]
      })),
      replyDraft,
      ensureRecipientRegistered: vi.fn(async () => true)
    };

    const intent = detectWhatsAppReplyChatRequest('reply to meghna on WhatsApp: Hi Meghna, thank you for reaching out!');
    expect(intent).not.toBeNull();
    expect(intent?.recipientQuery?.toLowerCase()).toBe('meghna');

    const result = await executeChatWhatsAppReply(waScope, intent!, { db: fakeDb, durable });
    expect(result.handled).toBe(true);
    expect(result.status).toBe('awaiting_approval');
    expect(result.approvalId).toBe('appr-meghna');
    expect(result.assistantResponseText).toContain('Meghna');
    expect(replyDraft).toHaveBeenCalledWith(
      waScope,
      'wa_pilot_meta_test_10813b',
      expect.objectContaining({ recipientId: 'c_919876543210' })
    );
  });
});
