import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { defaultPolicyGateway } from '@thaara/policy';
import {
  extractWhatsAppCustomerEnquiry,
  buildQuantumWeaveCustomerReply,
  QUANTUM_WEAVE_WHATSAPP_FACTS,
  QUANTUM_WEAVE_WHATSAPP_FACTS_KN,
  QUANTUM_WEAVE_WHATSAPP_FACTS_HI
} from '../src/services/whatsapp-enquiries.js';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { whatsappDurableInboxRoutes } from '../src/routes/whatsapp-inbox.js';
import {
  WhatsAppTransactionalFixture,
  waScope,
  waBinding,
  waNow
} from './helpers/whatsapp-durable-fixture.js';

describe('THAARA V2 — WhatsApp Final Release Validation', () => {
  const baseTime = Date.now();

  it('4. handles varied diverse customer questions naturally without appointment looping or repetitive intake prompts', () => {
    const variedQueries = [
      {
        question: 'Do you provide video editing and reels?',
        expectedKeyword: 'AI Videos & Creative Content',
        expectedUrl: 'https://filmsuccess.in'
      },
      {
        question: 'Can I get help with lead generation and meta ads?',
        expectedKeyword: 'Digital Marketing',
        expectedUrl: 'https://brandmintai.io/meta-growth'
      },
      {
        question: 'How does your AI voice bot work?',
        expectedKeyword: 'AI Agents & Assistants',
        expectedUrl: 'https://linktr.ee/team.quantumweaveai'
      },
      {
        question: 'Where is your office located?',
        expectedKeyword: 'Bangalore, Karnataka',
        expectedUrl: null
      },
      {
        question: 'Who are the founders of Quantum Weave?',
        expectedKeyword: 'Kaaranji Shreedhar and Vishak B.',
        expectedUrl: null
      },
      {
        question: 'Do you support Kannada language?',
        expectedKeyword: 'Kannada',
        expectedUrl: null
      },
      {
        question: 'Can you handle customer messages at night or after business hours?',
        expectedKeyword: 'after business hours',
        expectedUrl: null
      },
      {
        question: 'What are your Meta Growth packages and pricing?',
        expectedKeyword: '₹9,750',
        expectedUrl: 'https://brandmintai.io/meta-growth'
      }
    ];

    for (const [idx, item] of variedQueries.entries()) {
      const messages = [
        {
          direction: 'inbound' as const,
          textPreview: item.question,
          timestamp: new Date(baseTime + idx * 5000).toISOString()
        }
      ];

      const enquiry = extractWhatsAppCustomerEnquiry({
        connectionId: waBinding.connectionId,
        recipientId: `c_customer_${idx}`,
        contactName: `Customer ${idx}`,
        maskedPhone: '+91 99*** **000',
        optedIn: true,
        messages
      })!;

      const reply = buildQuantumWeaveCustomerReply({
        enquiry,
        latestCustomerMessage: item.question,
        optedIn: true,
        windowOpen: true
      });

      expect(reply.allowed).toBe(true);
      expect(reply.replyText).toContain(item.expectedKeyword);
      if (item.expectedUrl) {
        expect(reply.replyText).toContain(item.expectedUrl);
      }
      // CRITICAL: NEVER trapped into repetitive appointment intake
      expect(reply.replyText).not.toContain("May I have your name? I'll use your existing WhatsApp number");
      expect(reply.replyText).not.toContain("You're welcome! Our team will review your request shortly");
    }
  });

  it('5. pending consultation request does NOT prevent normal business conversations', () => {
    // Customer has a pending consultation request in progress
    const messages = [
      {
        direction: 'inbound' as const,
        textPreview: 'Hi, I would like to arrange a consultation for my retail business. My name is Suresh, email is suresh@retail.in',
        timestamp: new Date(baseTime - 30000).toISOString()
      },
      {
        direction: 'outbound' as const,
        textPreview: "Thanks Suresh! I've shared your consultation request with our team. Once it's approved, I'll send you the booking link.",
        timestamp: new Date(baseTime - 20000).toISOString()
      },
      // Now customer asks a business question while consultation is PENDING
      {
        direction: 'inbound' as const,
        textPreview: 'By the way, what other services does Quantum Weave provide?',
        timestamp: new Date(baseTime - 10000).toISOString()
      }
    ];

    const enquiry = extractWhatsAppCustomerEnquiry({
      connectionId: waBinding.connectionId,
      recipientId: 'c_suresh',
      contactName: 'Suresh',
      maskedPhone: '+91 98*** **111',
      optedIn: true,
      messages
    })!;

    expect(enquiry.appointmentStatus).toBe('REQUESTED');

    const reply = buildQuantumWeaveCustomerReply({
      enquiry,
      latestCustomerMessage: 'By the way, what other services does Quantum Weave provide?',
      optedIn: true,
      windowOpen: true
    });

    expect(reply.allowed).toBe(true);
    // MUST answer the business question directly
    expect(reply.replyText).toContain('1. Digital Marketing');
    expect(reply.replyText).toContain('3. WhatsApp Automation');
    expect(reply.replyText).toContain('https://linktr.ee/team.quantumweaveai');
    // MUST NOT repeat consultation confirmation or ask intake questions
    expect(reply.replyText).not.toContain("You're welcome!");
    expect(reply.replyText).not.toContain("I've shared your consultation request");
    expect(reply.replyText).not.toContain('May I have your name?');

    // Customer asks about video films next
    const messagesTurn4 = [
      ...messages,
      {
        direction: 'outbound' as const,
        textPreview: reply.replyText!,
        timestamp: new Date(baseTime - 5000).toISOString()
      },
      {
        direction: 'inbound' as const,
        textPreview: 'Do you create AI films and videos?',
        timestamp: new Date(baseTime).toISOString()
      }
    ];

    const enquiryTurn4 = extractWhatsAppCustomerEnquiry({
      connectionId: waBinding.connectionId,
      recipientId: 'c_suresh',
      contactName: 'Suresh',
      maskedPhone: '+91 98*** **111',
      optedIn: true,
      messages: messagesTurn4
    })!;

    const replyTurn4 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn4,
      latestCustomerMessage: 'Do you create AI films and videos?',
      optedIn: true,
      windowOpen: true
    });

    expect(replyTurn4.allowed).toBe(true);
    expect(replyTurn4.replyText).toContain('AI Videos & Creative Content');
    expect(replyTurn4.replyText).toContain('https://filmsuccess.in');
    expect(replyTurn4.replyText).not.toContain("You're welcome!");
  });

  it('6. isolated end-to-end owner approval lifecycle: click -> valid UUID approval -> audit proof -> claim -> receipt -> idempotency', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    const sendOptions = {
      profile: () => ({
        connectionId: waBinding.connectionId,
        recipientId: '*',
        expiresAt: waNow + 86400000,
        maxPerDay: 100,
        richMessages: true
      })
    };
    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway, () => waNow, sendOptions as any);

    // Initial state: appointment requested with recent customer inbound message (opens 24h Meta customer service window)
    fixture.state.messages.push({
      recipientId: 'c_919988776655',
      providerMessageId: 'wam_init_123',
      textPreview: 'Hi, please arrange a consultation for Lotus Clinic. Email is kiran@lotus.in',
      timestamp: new Date(waNow).toISOString()
    });

    await service.updateRecipientAppointment(waScope as any, waBinding.connectionId, 'c_919988776655', {
      status: 'REQUESTED',
      customerName: 'Kiran',
      business: 'Lotus Clinic',
      customerEmail: 'kiran@lotus.in'
    });

    const app = Fastify({ logger: false });
    (app as any).requireAuth = async (req: any) => {
      req.scope = waScope;
    };
    await whatsappDurableInboxRoutes(app, service);

    // 1. Authenticated owner clicks "CONFIRM & SEND LINK"
    const response = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/confirm`,
      payload: {
        recipientId: 'c_919988776655'
      }
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(body.bookingLinkSent).toBe(true);
    expect(body.calendlyUrl).toBe('https://calendly.com/team-brandmint/30min');
    expect(body.preparedConfirmationReply).toContain('https://calendly.com/team-brandmint/30min');

    // 2. Validate dispatch created in state
    expect(fixture.state.dispatches.length).toBe(1);
    const dispatch = fixture.state.dispatches[0]!;
    expect(dispatch.draft.recipientId).toBe('c_919988776655');

    // 3. Valid UUID approvalId (no string concatenation dummy IDs)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(dispatch.approvalId).toMatch(uuidRegex);

    // 4. Verify audit ledger entry contains dispatchId and revision
    const reservedAudit = fixture.audits.find(a => a.action === 'whatsapp.durable.reserved');
    expect(reservedAudit).toBeDefined();
    expect(reservedAudit!.details.dispatchId).toBe(dispatch.id);
    expect(reservedAudit!.details.revision).toBe(waBinding.revision);

    // 5. Approved dispatch claim by n8n dispatcher
    const relayScope = {
      authKind: 'whatsapp_relay' as const,
      principalId: 'relay_principal',
      workspaceId: waScope.workspaceId,
      userId: waScope.userId,
      role: 'owner' as const,
      connectionId: waBinding.connectionId,
      revision: waBinding.revision,
      operation: 'claim' as const,
      relayTokenHash: 'a'.repeat(64)
    };

    const claim = await service.claim(relayScope as any, waBinding.connectionId, dispatch.id, waBinding.revision);
    expect(claim.dispatchEnabled).toBe(true);
    expect((claim as any).textBody).toContain('https://calendly.com/team-brandmint/30min');

    // 6. Provider receipt acknowledgement
    const receiptScope = { ...relayScope, operation: 'receipts' as const };
    const acknowledged = await service.receipt(receiptScope as any, waBinding.connectionId, {
      dispatchId: dispatch.id,
      providerMessageId: 'wamid.calendly_link_delivered',
      recipientAddress: '919988776655'
    });
    expect(acknowledged.status).toBe('unverified');
    expect(acknowledged.providerMessageId).toBe('wamid.calendly_link_delivered');

    // 7. Safe idempotent retry: clicking CONFIRM & SEND LINK again does not duplicate dispatch
    const retryResponse = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/confirm`,
      payload: {
        recipientId: 'c_919988776655'
      }
    });
    expect(retryResponse.statusCode).toBe(200);
    const retryBody = JSON.parse(retryResponse.payload);
    expect(retryBody.status).toBe('AWAITING_CUSTOMER_BOOKING');
    // Ensure no duplicate dispatch was added
    expect(fixture.state.dispatches.length).toBe(1);
  });
});
