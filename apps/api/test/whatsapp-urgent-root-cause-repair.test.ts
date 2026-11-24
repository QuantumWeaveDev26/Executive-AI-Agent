import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { defaultPolicyGateway } from '@thaara/policy';
import {
  extractWhatsAppCustomerEnquiry,
  buildQuantumWeaveCustomerReply,
  isRealCustomerName
} from '../src/services/whatsapp-enquiries.js';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { whatsappDurableInboxRoutes } from '../src/routes/whatsapp-inbox.js';
import {
  WhatsAppTransactionalFixture,
  waScope,
  waBinding
} from './helpers/whatsapp-durable-fixture.js';

describe('THAARA V2 — Urgent WhatsApp Root-Cause Repair', () => {
  it('1. correctly extracts customer name "Krishna" and does not get trapped in repetitive consultation intake', () => {
    const baseTime = Date.now();
    const messages = [
      {
        direction: 'inbound' as const,
        textPreview: 'Hi',
        timestamp: new Date(baseTime - 30000).toISOString()
      },
      {
        direction: 'outbound' as const,
        textPreview: "I'd be happy to help arrange a consultation with our team.\n\nMay I have your name? I'll use your existing WhatsApp number for contact unless you prefer another number.",
        timestamp: new Date(baseTime - 20000).toISOString()
      },
      {
        direction: 'inbound' as const,
        textPreview: 'Krishna',
        timestamp: new Date(baseTime - 15000).toISOString()
      }
    ];

    const enquiryAfterName = extractWhatsAppCustomerEnquiry({
      connectionId: waBinding.connectionId,
      recipientId: 'c_krishna',
      contactName: 'Krishna',
      maskedPhone: '+91 99*** **677',
      optedIn: true,
      messages
    })!;

    expect(enquiryAfterName).toBeDefined();
    expect(enquiryAfterName.customerName).toBe('Krishna');
    expect(isRealCustomerName(enquiryAfterName.customerName)).toBe(true);

    // Turn 3: Customer asks "What can we expect from you?"
    const messagesTurn3 = [
      ...messages,
      {
        direction: 'outbound' as const,
        textPreview: "You're welcome! Our team will review your request shortly and I'll share the booking link as soon as it's approved.",
        timestamp: new Date(baseTime - 10000).toISOString()
      },
      {
        direction: 'inbound' as const,
        textPreview: 'What can we expect from you?',
        timestamp: new Date(baseTime - 5000).toISOString()
      }
    ];

    const enquiryTurn3 = extractWhatsAppCustomerEnquiry({
      connectionId: waBinding.connectionId,
      recipientId: 'c_krishna',
      contactName: 'Krishna',
      maskedPhone: '+91 99*** **677',
      optedIn: true,
      messages: messagesTurn3
    })!;

    const replyTurn3 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn3,
      latestCustomerMessage: 'What can we expect from you?',
      optedIn: true,
      windowOpen: true
    });

    expect(replyTurn3.allowed).toBe(true);
    // Must NOT ask for name again!
    expect(replyTurn3.replyText).not.toContain('May I have your name?');
    // Must answer with practical AI systems and linktree URL
    expect(replyTurn3.replyText).toContain('With Quantum Weave, you can expect practical AI systems');
    expect(replyTurn3.replyText).toContain('https://linktr.ee/team.quantumweaveai');

    // Turn 4: Customer asks "What services does quantum weave provide"
    const messagesTurn4 = [
      ...messagesTurn3,
      {
        direction: 'outbound' as const,
        textPreview: replyTurn3.replyText!,
        timestamp: new Date(baseTime - 4000).toISOString()
      },
      {
        direction: 'inbound' as const,
        textPreview: 'What services does quantum weave provide',
        timestamp: new Date(baseTime - 1000).toISOString()
      }
    ];

    const enquiryTurn4 = extractWhatsAppCustomerEnquiry({
      connectionId: waBinding.connectionId,
      recipientId: 'c_krishna',
      contactName: 'Krishna',
      maskedPhone: '+91 99*** **677',
      optedIn: true,
      messages: messagesTurn4
    })!;

    const replyTurn4 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn4,
      latestCustomerMessage: 'What services does quantum weave provide',
      optedIn: true,
      windowOpen: true
    });

    expect(replyTurn4.allowed).toBe(true);
    // Must NOT ask for name again!
    expect(replyTurn4.replyText).not.toContain('May I have your name?');
    // Must list services naturally
    expect(replyTurn4.replyText).toContain('1. Digital Marketing');
    expect(replyTurn4.replyText).toContain('3. WhatsApp Automation');
    expect(replyTurn4.replyText).toContain('https://linktr.ee/team.quantumweaveai');

    // Turn 5: Customer selects "whatsapp automation"
    // CRITICAL: Must explain the service and share freemium link. MUST NOT return appointment acknowledgement!
    const messagesTurn5 = [
      ...messagesTurn4,
      {
        direction: 'outbound' as const,
        textPreview: replyTurn4.replyText!,
        timestamp: new Date(baseTime - 800).toISOString()
      },
      {
        direction: 'inbound' as const,
        textPreview: 'whatsapp automation',
        timestamp: new Date(baseTime - 500).toISOString()
      }
    ];

    const enquiryTurn5 = extractWhatsAppCustomerEnquiry({
      connectionId: waBinding.connectionId,
      recipientId: 'c_krishna',
      contactName: 'Krishna',
      maskedPhone: '+91 99*** **677',
      optedIn: true,
      messages: messagesTurn5
    })!;

    const replyTurn5 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn5,
      latestCustomerMessage: 'whatsapp automation',
      optedIn: true,
      windowOpen: true
    });

    expect(replyTurn5.allowed).toBe(true);
    expect(replyTurn5.replyText).toContain('WhatsApp Automation');
    expect(replyTurn5.replyText).toContain('https://brandmintai.io/freemium');
    expect(replyTurn5.replyText).toContain('What would you like to automate first?');
    // MUST NOT hijack into consultation intake or appointment acknowledgement
    expect(replyTurn5.replyText).not.toContain("You're welcome!");
    expect(replyTurn5.replyText).not.toContain('booking link as soon as it');
    expect(replyTurn5.replyText).not.toContain('May I have your name?');

    // Turn 6: Customer asks about Meta Growth packages and pricing
    const messagesTurn6 = [
      ...messagesTurn5,
      {
        direction: 'outbound' as const,
        textPreview: replyTurn5.replyText!,
        timestamp: new Date(baseTime - 400).toISOString()
      },
      {
        direction: 'inbound' as const,
        textPreview: 'What are your Meta Growth packages and pricing?',
        timestamp: new Date(baseTime - 300).toISOString()
      }
    ];

    const enquiryTurn6 = extractWhatsAppCustomerEnquiry({
      connectionId: waBinding.connectionId,
      recipientId: 'c_krishna',
      contactName: 'Krishna',
      maskedPhone: '+91 99*** **677',
      optedIn: true,
      messages: messagesTurn6
    })!;

    const replyTurn6 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn6,
      latestCustomerMessage: 'What are your Meta Growth packages and pricing?',
      optedIn: true,
      windowOpen: true
    });

    expect(replyTurn6.allowed).toBe(true);
    expect(replyTurn6.replyText).toContain('₹9,750');
    expect(replyTurn6.replyText).toContain('₹15,870');
    expect(replyTurn6.replyText).toContain('₹24,950');
    expect(replyTurn6.replyText).toContain('https://brandmintai.io/meta-growth');
    expect(replyTurn6.replyText).toContain('regular social media page posting');

    // Turn 7: Customer asks for consultation: "I want to arrange a 30-minute consultation"
    const messagesTurn7 = [
      ...messagesTurn6,
      {
        direction: 'outbound' as const,
        textPreview: replyTurn6.replyText!,
        timestamp: new Date(baseTime - 200).toISOString()
      },
      {
        direction: 'inbound' as const,
        textPreview: 'I want to arrange a 30-minute consultation',
        timestamp: new Date(baseTime - 100).toISOString()
      }
    ];

    const enquiryTurn7 = extractWhatsAppCustomerEnquiry({
      connectionId: waBinding.connectionId,
      recipientId: 'c_krishna',
      contactName: 'Krishna',
      maskedPhone: '+91 99*** **677',
      optedIn: true,
      messages: messagesTurn7
    })!;

    const replyTurn7 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn7,
      latestCustomerMessage: 'I want to arrange a 30-minute consultation',
      optedIn: true,
      windowOpen: true
    });

    expect(replyTurn7.allowed).toBe(true);
    expect(replyTurn7.replyText).toContain('Thank you Krishna!');
    expect(replyTurn7.replyText).toContain('May I have your business name and email address?');
    // NEVER asks for date/time
    expect(replyTurn7.replyText).not.toMatch(/\b(?:date|time|slot|when\s+are\s+you\s+free)\b/i);

    // Turn 8: Customer provides business name and email
    const messagesTurn8 = [
      ...messagesTurn7,
      {
        direction: 'outbound' as const,
        textPreview: replyTurn7.replyText!,
        timestamp: new Date(baseTime - 50).toISOString()
      },
      {
        direction: 'inbound' as const,
        textPreview: 'I run Krishna Retail and my email is krishna@retail.com',
        timestamp: new Date(baseTime - 20).toISOString()
      }
    ];

    const enquiryTurn8 = extractWhatsAppCustomerEnquiry({
      connectionId: waBinding.connectionId,
      recipientId: 'c_krishna',
      contactName: 'Krishna',
      maskedPhone: '+91 99*** **677',
      optedIn: true,
      messages: messagesTurn8
    })!;

    const replyTurn8 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn8,
      latestCustomerMessage: 'I run Krishna Retail and my email is krishna@retail.com',
      optedIn: true,
      windowOpen: true
    });

    expect(replyTurn8.allowed).toBe(true);
    expect(replyTurn8.replyText).toContain('Thanks Krishna!');
    expect(replyTurn8.replyText).toContain("I've shared your consultation request with our team. Once it's approved, I'll send you the booking link.");

    // Turn 9: Customer checks status: "when will the link be sent?"
    const messagesTurn9 = [
      ...messagesTurn8,
      {
        direction: 'outbound' as const,
        textPreview: replyTurn8.replyText!,
        timestamp: new Date(baseTime - 10).toISOString()
      },
      {
        direction: 'inbound' as const,
        textPreview: 'when will the link be sent?',
        timestamp: new Date(baseTime).toISOString()
      }
    ];

    const enquiryTurn9 = extractWhatsAppCustomerEnquiry({
      connectionId: waBinding.connectionId,
      recipientId: 'c_krishna',
      contactName: 'Krishna',
      maskedPhone: '+91 99*** **677',
      optedIn: true,
      messages: messagesTurn9
    })!;

    const replyTurn9 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn9,
      latestCustomerMessage: 'when will the link be sent?',
      optedIn: true,
      windowOpen: true
    });

    expect(replyTurn9.allowed).toBe(true);
    expect(replyTurn9.replyText).toContain('Our team is currently reviewing your 30-minute consultation request.');
    expect(replyTurn9.replyText).toContain("As soon as it's approved by our team, I'll send you the Calendly booking link right here.");
    expect(replyTurn9.replyText).not.toContain("You're welcome!");
  });

  it('2. CONFIRM & SEND LINK creates a real autoReplyApproval record with UUID approvalId and dispatches to n8n relay', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway);

    await service.updateRecipientAppointment(waScope as any, waBinding.connectionId, 'c_919988776655', {
      status: 'REQUESTED',
      customerName: 'Krishna',
      business: 'Quantum Tech',
      customerEmail: 'krishna@example.com'
    });

    const app = Fastify({ logger: false });
    (app as any).requireAuth = async (req: any) => {
      req.scope = waScope;
    };
    await whatsappDurableInboxRoutes(app, service);

    // Owner clicks CONFIRM & SEND LINK -> calls POST /appointments/confirm
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

    // Verify that dispatch was created
    expect(fixture.state.dispatches.length).toBeGreaterThan(0);
    const lastDispatch = fixture.state.dispatches[fixture.state.dispatches.length - 1]!;
    expect(lastDispatch.draft.recipientId).toBe('c_919988776655');

    // Crucially: approvalId MUST NOT be owner-approval-<id>! It must be a valid UUID from createAutoReplyApproval
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(lastDispatch.approvalId).toMatch(uuidRegex);

    // Verify the body text includes the Calendly link
    expect('bodyText' in lastDispatch.draft && lastDispatch.draft.bodyText).toContain('https://calendly.com/team-brandmint/30min');
  });
});
