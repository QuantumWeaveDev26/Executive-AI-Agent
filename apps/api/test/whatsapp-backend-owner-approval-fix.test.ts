import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { defaultPolicyGateway } from '@thaara/policy';
import {
  isN8nWhatsAppInbox,
  WhatsAppConversationEnquirySchema,
  type CalendlyBookingEvidence
} from '@thaara/contracts';
import { Value } from '@sinclair/typebox/value';
import {
  isRealCustomerName,
  cleanInternalTokens,
  deduplicateParagraphs,
  buildQuantumWeaveCustomerReply,
  extractWhatsAppCustomerEnquiry
} from '../src/services/whatsapp-enquiries.js';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { whatsappDurableInboxRoutes } from '../src/routes/whatsapp-inbox.js';
import {
  WhatsAppTransactionalFixture,
  waScope,
  waBinding
} from './helpers/whatsapp-durable-fixture.js';

describe('THAARA V2 — WhatsApp Backend & Owner Approval Fix', () => {
  it('1. schema accepts referredWebsite and businessType without breaking inbox contracts', () => {
    const testEnquiry = {
      leadStatus: 'Enquired' as const,
      customerName: 'Ananya Sharma',
      businessName: 'Ananya Boutique',
      businessType: 'Retail Clothing',
      customerEmail: 'ananya@boutique.in',
      requestedService: 'WhatsApp Automation',
      enquirySummary: 'Looking for automated WhatsApp catalogue and responses',
      callbackRequested: true,
      appointmentInterest: true,
      appointmentStatus: 'REQUESTED' as const,
      referredWebsite: 'https://brandmintai.io/freemium'
    };

    expect(Value.Check(WhatsAppConversationEnquirySchema, testEnquiry)).toBe(true);

    const testInbox = {
      transport: 'n8n' as const,
      mode: 'offline_test' as const,
      liveSendingEnabled: false,
      verified: false as const,
      connectionId: 'wa_durable_test',
      revision: 1,
      conversations: [
        {
          recipientId: 'c_919972965677',
          contactName: 'Ananya Sharma',
          maskedPhone: '+91 99*** **677',
          messageCount: 5,
          lastMessageAt: new Date().toISOString(),
          lastMessagePreview: 'Could you arrange a consultation?',
          untrusted: true as const,
          enquiry: testEnquiry
        }
      ],
      messages: [],
      nextPageToken: null
    };

    expect(isN8nWhatsAppInbox(testInbox)).toBe(true);
  });

  it('2. customer name resolver rejects device labels like "Owner Test Phone"', () => {
    expect(isRealCustomerName('Owner Test Phone')).toBe(false);
    expect(isRealCustomerName('Owner Test')).toBe(false);
    expect(isRealCustomerName('Test Phone')).toBe(false);
    expect(isRealCustomerName('Owner Phone')).toBe(false);
    expect(isRealCustomerName('Test Contact')).toBe(false);
    expect(isRealCustomerName('Synthetic Phone')).toBe(false);
    expect(isRealCustomerName('Unknown')).toBe(false);

    // Real human names pass
    expect(isRealCustomerName('Kiran')).toBe(true);
    expect(isRealCustomerName('Rajesh Kumar')).toBe(true);
    expect(isRealCustomerName('Ananya')).toBe(true);
  });

  it('3. cleans internal status tokens and deduplicates identical paragraphs', () => {
    const rawTokens = '[STATUS: AWAITING_APPROVAL] Hello Rajesh, thanks for contacting Quantum Weave AI.';
    expect(cleanInternalTokens(rawTokens)).toBe('Hello Rajesh, thanks for contacting Quantum Weave AI.');

    const statusPrefix = 'CONFIRMED: Your consultation is confirmed with our team.';
    expect(cleanInternalTokens(statusPrefix)).toBe('Your consultation is confirmed with our team.');

    const duplicateText = 'First paragraph.\n\nSecond paragraph.\n\nFirst paragraph.\n\nThird paragraph.';
    expect(deduplicateParagraphs(duplicateText)).toBe('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.');
  });

  it('4. suppresses outdated pending replies when newer customer message has arrived', () => {
    const proposal = buildQuantumWeaveCustomerReply({
      enquiry: {
        leadStatus: 'Enquired',
        enquirySummary: 'General enquiry',
        callbackRequested: false,
        contactOptedIn: true,
        detectedLanguage: 'en'
      },
      latestCustomerMessage: 'Hello, what services do you provide?',
      optedIn: true,
      windowOpen: true,
      autoReplyMode: true,
      hasNewerInbound: true, // Newer inbound message arrived
      n8nAgentReply: 'We provide AI marketing and automation.'
    });

    expect(proposal.allowed).toBe(false);
    expect(proposal.reason).toBe('outdated_reply_superseded');
    expect(proposal.replyText).toBeNull();
  });

  it('5. owner approval sets AWAITING_CUSTOMER_BOOKING, dispatches approved Calendly message, and prevents duplicate sends', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    fixture.state.binding.recipients.push({
      id: 'c_919988776655',
      phoneE164: '+919988776655',
      optedIn: true,
      displayName: 'Vikram Mehta'
    });

    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway);
    await service.updateRecipientAppointment(waScope as any, waBinding.connectionId, 'c_919988776655', {
      status: 'REQUESTED',
      customerName: 'Vikram Mehta',
      business: 'Mehta Logistics',
      customerEmail: 'vikram@mehtalogistics.in'
    });

    const app = Fastify({ logger: false });
    (app as any).requireAuth = async (req: any) => {
      req.scope = waScope;
    };
    await whatsappDurableInboxRoutes(app, service);

    // Step 1: Owner approves consultation
    const approveRes = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/confirm`,
      payload: {
        recipientId: 'c_919988776655'
      }
    });

    expect(approveRes.statusCode).toBe(200);
    const approveBody = JSON.parse(approveRes.payload);
    expect(approveBody.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(approveBody.bookingLinkSent).toBe(true);
    expect(approveBody.calendlyUrl).toBe('https://calendly.com/team-brandmint/30min');
    expect(approveBody.preparedConfirmationReply).toContain('Your 30-minute consultation request has been approved');
    expect(approveBody.preparedConfirmationReply).toContain('https://calendly.com/team-brandmint/30min');

    // Verify recipient appointment state
    const recipient = await service.getRecipient(waScope as any, waBinding.connectionId, 'c_919988776655');
    expect(recipient?.recipient.appointment?.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(recipient?.recipient.appointment?.bookingLinkSent).toBe(true);

    // Step 2: While dispatch is in-flight and provider has not accepted, alreadySent is false and no duplicate dispatch is created
    const inFlightRes = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/confirm`,
      payload: {
        recipientId: 'c_919988776655'
      }
    });

    expect(inFlightRes.statusCode).toBe(200);
    const inFlightBody = JSON.parse(inFlightRes.payload);
    expect(inFlightBody.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(inFlightBody.alreadySent).toBe(false);

    // Verify exactly 1 dispatch was created so far
    let dispatches = fixture.state.dispatches.filter(d => d.draft.recipientId === 'c_919988776655');
    expect(dispatches.length).toBe(1);
    expect(dispatches[0]!.draft.bodyText).toContain('https://calendly.com/team-brandmint/30min');

    // Step 3: Provider accepts the message
    fixture.state.dispatches[0]!.receipt.providerMessageId = 'wamid.sent_001';
    fixture.state.dispatches[0]!.receipt.status = 'sent';

    // Step 4: After provider acceptance, alreadySent is true
    const duplicateRes = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/confirm`,
      payload: {
        recipientId: 'c_919988776655'
      }
    });
    expect(duplicateRes.statusCode).toBe(200);
    const duplicateBody = JSON.parse(duplicateRes.payload);
    expect(duplicateBody.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(duplicateBody.alreadySent).toBe(true);
    expect(fixture.state.dispatches.length).toBe(1);
  });

  it('6. only authentic Calendly booking evidence transitions to CONFIRMED', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    fixture.state.binding.recipients.push({
      id: 'c_919988776677',
      phoneE164: '+919988776677',
      optedIn: true,
      displayName: 'Deepa'
    });

    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway);
    await service.updateRecipientAppointment(waScope as any, waBinding.connectionId, 'c_919988776677', {
      status: 'AWAITING_CUSTOMER_BOOKING',
      customerName: 'Deepa',
      business: 'Deepa Organic Foods',
      customerEmail: 'deepa@organicfoods.in',
      calendlyUrl: 'https://calendly.com/team-brandmint/30min',
      bookingLinkSent: true
    });

    const app = Fastify({ logger: false });
    (app as any).requireAuth = async (req: any) => {
      req.scope = waScope;
    };
    await whatsappDurableInboxRoutes(app, service);

    const evidence: CalendlyBookingEvidence = {
      bookingId: 'cal_event_deepa_9988',
      eventUri: 'https://api.calendly.com/scheduled_events/evt-deepa-9988',
      inviteeUri: 'https://api.calendly.com/scheduled_events/evt-deepa-9988/invitees/inv-deepa-01',
      status: 'active'
    };

    const confirmRes = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/confirm`,
      payload: {
        recipientId: 'c_919988776677',
        calendlyBookingEvidence: evidence
      }
    });

    expect(confirmRes.statusCode).toBe(200);
    const confirmBody = JSON.parse(confirmRes.payload);
    expect(confirmBody.status).toBe('CONFIRMED');
    expect(confirmBody.calendlyBookingId).toBe('cal_event_deepa_9988');

    const updated = await service.getRecipient(waScope as any, waBinding.connectionId, 'c_919988776677');
    expect(updated?.recipient.appointment?.status).toBe('CONFIRMED');
    expect(updated?.recipient.appointment?.calendlyBookingId).toBe('cal_event_deepa_9988');
  });

  it('7. owner decline transitions appointment to CANCELLED', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    fixture.state.binding.recipients.push({
      id: 'c_919988776699',
      phoneE164: '+919988776699',
      optedIn: true,
      displayName: 'Harish'
    });

    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway);
    await service.updateRecipientAppointment(waScope as any, waBinding.connectionId, 'c_919988776699', {
      status: 'REQUESTED',
      customerName: 'Harish',
      business: 'Harish Textiles',
      customerEmail: 'harish@textiles.in'
    });

    const app = Fastify({ logger: false });
    (app as any).requireAuth = async (req: any) => {
      req.scope = waScope;
    };
    await whatsappDurableInboxRoutes(app, service);

    const declineRes = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/decline`,
      payload: {
        recipientId: 'c_919988776699'
      }
    });

    expect(declineRes.statusCode).toBe(200);
    const declineBody = JSON.parse(declineRes.payload);
    expect(declineBody.status).toBe('CANCELLED');

    const updated = await service.getRecipient(waScope as any, waBinding.connectionId, 'c_919988776699');
    expect(updated?.recipient.appointment?.status).toBe('CANCELLED');
  });
});
