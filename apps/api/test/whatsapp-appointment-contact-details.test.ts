import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { defaultPolicyGateway } from '@thaara/policy';
import {
  buildConversationMemoryState,
  buildQuantumWeaveCustomerReply,
  extractCustomerEmail,
  formatWhatsAppParagraphs,
  QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK,
  QUANTUM_WEAVE_WHATSAPP_FACTS,
  CONSULTATION_INVITATION_EN,
  CONSULTATION_INVITATION_KN,
  CONSULTATION_INVITATION_HI,
  toConversationEnquirySummary,
  extractWhatsAppCustomerEnquiry
} from '../src/services/whatsapp-enquiries.js';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { whatsappDurableInboxRoutes } from '../src/routes/whatsapp-inbox.js';
import { WhatsAppTransactionalFixture, waScope, waBinding } from './helpers/whatsapp-durable-fixture.js';

describe('WhatsApp Appointment Contact Details & Calendly Handoff', () => {
  // Scenario 1: Normal service discussion -> consultation offer
  it('1. offers 30-minute consultation naturally after meaningful service discussion', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_test',
      recipientId: 'c_919876543210',
      maskedPhone: '+91 98765 43210',
      messages: [
        {
          direction: 'inbound',
          textPreview: 'We run a clothing shop and need customer support and order updates',
          timestamp: '2026-11-09T09:00:00.000Z'
        }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: '',
        maskedPhone: '+91 98765 43210',
        requestedService: 'WhatsApp Automation',
        businessType: 'clothing',
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Enquired',
        enquirySummary: 'WhatsApp Automation enquiry',
        callbackRequested: false,
        conversationRef: {
          connectionId: 'conn_test',
          recipientId: 'c_919876543210',
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-09T09:00:00.000Z'
        }
      },
      latestCustomerMessage: 'We run a clothing shop and need customer support and order updates',
      optedIn: true,
      windowOpen: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('WhatsApp Automation');
    expect(reply.replyText).toContain(CONSULTATION_INVITATION_EN);
    // Does NOT ask for date or time
    expect(reply.replyText).not.toMatch(/\b(?:date\s+and\s+time|what\s+time|when\s+would\s+you)\b/i);
    // Does NOT append company WhatsApp contact link automatically
    expect(reply.replyText).not.toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);
  });

  // Scenario 2: Direct consultation request upfront initiates intake
  it('2. handles direct consultation request upfront and asks for missing details', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_test',
      recipientId: 'c_919876543210',
      maskedPhone: '+91 98765 43210',
      messages: [
        {
          direction: 'inbound',
          textPreview: "I'd like to book a consultation with your team",
          timestamp: '2026-11-09T10:00:00.000Z'
        }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: '',
        maskedPhone: '+91 98765 43210',
        appointmentInterest: true,
        callbackRequested: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Callback requested',
        enquirySummary: 'Appointment requested',
        conversationRef: {
          connectionId: 'conn_test',
          recipientId: 'c_919876543210',
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-09T10:00:00.000Z'
        }
      },
      latestCustomerMessage: "I'd like to book a consultation with your team",
      optedIn: true,
      windowOpen: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('30-minute consultation');
    expect(reply.replyText).toContain('https://calendly.com/team-brandmint/30min');
    // Does NOT ask for customer details first
    expect(reply.replyText).not.toContain('May I have your name, business name and email address?');
    // Does NOT contain repeated contact link
    expect(reply.replyText).not.toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);
  });

  // Scenario 3: Name and business known -> ask only for email
  it('3. reuses known customer name and business, asking only for missing email', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_test',
      recipientId: 'c_919876543210',
      contactName: 'Anand Kumar',
      maskedPhone: '+91 98765 43210',
      messages: [
        {
          direction: 'inbound',
          textPreview: 'Hi, my name is Anand from Anand Sweets',
          timestamp: '2026-11-09T09:00:00.000Z'
        },
        {
          direction: 'outbound',
          textPreview: 'Great! We can help your bakery business reach more customers.',
          timestamp: '2026-11-09T09:01:00.000Z'
        },
        {
          direction: 'inbound',
          textPreview: 'Can I book a consultation?',
          timestamp: '2026-11-09T10:00:00.000Z'
        }
      ]
    });

    expect(memory.customerName).toBe('Anand');
    expect(memory.businessName).toBe('Anand Sweets');

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: 'Anand',
        businessName: 'Anand Sweets',
        maskedPhone: '+91 98765 43210',
        appointmentInterest: true,
        callbackRequested: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Callback requested',
        enquirySummary: 'Appointment requested',
        conversationRef: {
          connectionId: 'conn_test',
          recipientId: 'c_919876543210',
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-09T10:00:00.000Z'
        }
      },
      latestCustomerMessage: 'Can I book a consultation?',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('Anand');
    expect(reply.replyText).toContain('Anand Sweets');
    expect(reply.replyText).toContain('https://calendly.com/team-brandmint/30min');
    // Does NOT re-ask name or business name
    expect(reply.replyText).not.toContain('May I have your name, business name');
    // No date/time question
    expect(reply.replyText).not.toMatch(/\b(?:what time|which date|preferred date|preferred time)\b/i);
    // No contact link
    expect(reply.replyText).not.toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);
  });

  // Scenario 4: Email validation and capture
  it('4. captures and validates customer email, transitioning state without exposing internal tokens', () => {
    const emailRes = extractCustomerEmail(['My email is anand@anandsweets.in']);
    expect(emailRes.email).toBe('anand@anandsweets.in');
    expect(emailRes.declined).toBe(false);
    expect(emailRes.invalidAttempt).toBe(false);

    const memory = buildConversationMemoryState({
      connectionId: 'conn_test',
      recipientId: 'c_919876543210',
      contactName: 'Anand',
      maskedPhone: '+91 98765 43210',
      messages: [
        {
          direction: 'inbound',
          textPreview: 'Hi, my name is Anand from Anand Sweets. I need WhatsApp Automation.',
          timestamp: '2026-11-09T09:00:00.000Z'
        },
        {
          direction: 'outbound',
          textPreview: 'May I have your email address? I will use your existing WhatsApp number for contact unless you prefer another number.',
          timestamp: '2026-11-09T09:01:00.000Z'
        },
        {
          direction: 'inbound',
          textPreview: 'My email address is anand@anandsweets.in',
          timestamp: '2026-11-09T09:02:00.000Z'
        }
      ]
    });

    expect(memory.customerEmail).toBe('anand@anandsweets.in');
    expect(memory.appointmentStatus).toBe('AWAITING_CUSTOMER_BOOKING');

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: 'Anand',
        businessName: 'Anand Sweets',
        customerEmail: 'anand@anandsweets.in',
        maskedPhone: '+91 98765 43210',
        appointmentInterest: true,
        callbackRequested: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Callback requested',
        enquirySummary: 'Appointment requested',
        conversationRef: {
          connectionId: 'conn_test',
          recipientId: 'c_919876543210',
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-09T09:02:00.000Z'
        }
      },
      latestCustomerMessage: 'My email address is anand@anandsweets.in',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('Thanks Anand!');
    expect(reply.replyText).toContain('https://calendly.com/team-brandmint/30min');
    // ZERO raw uppercase internal status tokens exposed to the customer
    expect(reply.replyText).not.toContain('REQUESTED');
    expect(reply.replyText).not.toContain('AWAITING_CUSTOMER_BOOKING');
    expect(reply.replyText).not.toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);
  });

  // Scenario 5: Invalid email clarification without inventing email
  it('5. detects invalid email and asks for clarification without inventing an address', () => {
    const invalidCheck = extractCustomerEmail(['my email is anand@'], 'customer_email');
    expect(invalidCheck.email).toBeUndefined();
    expect(invalidCheck.invalidAttempt).toBe(true);

    const memory = buildConversationMemoryState({
      connectionId: 'conn_test',
      recipientId: 'c_919876543210',
      contactName: 'Anand',
      maskedPhone: '+91 98765 43210',
      messages: [
        {
          direction: 'inbound',
          textPreview: 'Book an appointment for Anand from Anand Sweets',
          timestamp: '2026-11-09T09:00:00.000Z'
        },
        {
          direction: 'outbound',
          textPreview: 'May I have your email address?',
          timestamp: '2026-11-09T09:01:00.000Z'
        },
        {
          direction: 'inbound',
          textPreview: 'my email is anand@invalid',
          timestamp: '2026-11-09T09:02:00.000Z'
        }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: 'Anand',
        maskedPhone: '+91 98765 43210',
        appointmentInterest: true,
        callbackRequested: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Callback requested',
        enquirySummary: 'Appointment requested',
        conversationRef: {
          connectionId: 'conn_test',
          recipientId: 'c_919876543210',
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-09T09:02:00.000Z'
        }
      },
      latestCustomerMessage: 'my email is anand@invalid',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('https://calendly.com/team-brandmint/30min');
    expect(reply.replyText).not.toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);
  });

  // Scenario 6: Customer declines email naturally
  it('6. respects customer decline to share email and proceeds via WhatsApp number', () => {
    const declineCheck = extractCustomerEmail(['I do not have an email, prefer WhatsApp only']);
    expect(declineCheck.email).toBeUndefined();
    expect(declineCheck.declined).toBe(true);

    const memory = buildConversationMemoryState({
      connectionId: 'conn_test',
      recipientId: 'c_919876543210',
      contactName: 'Anand',
      maskedPhone: '+91 98765 43210',
      messages: [
        {
          direction: 'inbound',
          textPreview: 'Book an appointment for Anand from Anand Sweets',
          timestamp: '2026-11-09T09:00:00.000Z'
        },
        {
          direction: 'outbound',
          textPreview: 'May I have your email address?',
          timestamp: '2026-11-09T09:01:00.000Z'
        },
        {
          direction: 'inbound',
          textPreview: 'no email, prefer whatsapp only',
          timestamp: '2026-11-09T09:02:00.000Z'
        }
      ]
    });

    expect(memory.customerEmail).toBeUndefined();
    expect(memory.emailDeclined).toBe(true);
    expect(memory.appointmentStatus).toBe('AWAITING_CUSTOMER_BOOKING');

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: 'Anand',
        businessName: 'Anand Sweets',
        emailDeclined: true,
        maskedPhone: '+91 98765 43210',
        appointmentInterest: true,
        callbackRequested: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Callback requested',
        enquirySummary: 'Appointment requested',
        conversationRef: {
          connectionId: 'conn_test',
          recipientId: 'c_919876543210',
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-09T09:02:00.000Z'
        }
      },
      latestCustomerMessage: 'no email, prefer whatsapp only',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('Thanks Anand!');
    expect(reply.replyText).toContain('https://calendly.com/team-brandmint/30min');
    expect(reply.replyText).not.toContain('REQUESTED');
    expect(reply.replyText).not.toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);
  });

  // Scenario 7: STRICT RULE: NEVER ask for date or time
  it('7. never asks for date or time at any stage and omits legacy date/time prompt from summaries', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_test',
      recipientId: 'c_919876543210',
      maskedPhone: '+91 98765 43210',
      messages: [
        {
          direction: 'inbound',
          textPreview: 'I want a consultation tomorrow at 5pm',
          timestamp: '2026-11-09T09:00:00.000Z'
        }
      ]
    });

    const enquiry = extractWhatsAppCustomerEnquiry({
      connectionId: 'conn_test',
      recipientId: 'c_919876543210',
      maskedPhone: '+91 98765 43210',
      messages: [
        {
          direction: 'inbound',
          textPreview: 'I want a consultation tomorrow at 5pm',
          timestamp: '2026-11-09T09:00:00.000Z'
        }
      ]
    });
    const summary = enquiry?.enquirySummary ?? '';

    // Summary must NEVER say '(awaiting preferred date/time)'
    expect(summary).not.toContain('(awaiting preferred date/time)');
    expect(summary).toContain('Link shared directly (Calendly)');

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: '',
        maskedPhone: '+91 98765 43210',
        appointmentInterest: true,
        callbackRequested: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Callback requested',
        enquirySummary: summary,
        conversationRef: { connectionId: 'conn_test', recipientId: 'c_919876543210', lastInboundMessageId: null, lastMessageAt: '2026-11-09T09:00:00.000Z' }
      },
      latestCustomerMessage: 'I want a consultation tomorrow at 5pm',
      optedIn: true,
      windowOpen: true,
      memory
    });

    expect(reply.replyText).not.toMatch(/\b(?:what\s+preferred\s+date|what\s+time\s+suits|which\s+slot)\b/i);
  });

  // Scenario 8: WhatsApp contact link sent ONLY on explicit request
  it('8. provides company WhatsApp link only when customer explicitly asks for it', () => {
    // Normal consultation intake turn: NO link
    const normalTurn = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: '',
        maskedPhone: '+91 98765 43210',
        appointmentInterest: true,
        callbackRequested: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Callback requested',
        enquirySummary: 'Appointment',
        conversationRef: { connectionId: 'conn', recipientId: 'c_919876543210', lastInboundMessageId: null, lastMessageAt: '2026-11-09T00:00:00.000Z' }
      },
      latestCustomerMessage: 'Can we book a consultation?',
      optedIn: true,
      windowOpen: true
    });
    expect(normalTurn.replyText).not.toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);

    // Explicit request for WhatsApp number / contact link: YES
    const contactReq = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: '',
        maskedPhone: '+91 98765 43210',
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Enquired',
        enquirySummary: 'Contact request',
        callbackRequested: false,
        conversationRef: { connectionId: 'conn', recipientId: 'c_919876543210', lastInboundMessageId: null, lastMessageAt: '2026-11-09T00:00:00.000Z' }
      },
      latestCustomerMessage: 'Can you share your WhatsApp contact link?',
      optedIn: true,
      windowOpen: true
    });
    expect(contactReq.replyText).toContain('https://wa.me/919972965677');
  });

  // Scenario 9: Subsequent customer messages do not repeat confirmation or duplicate requests
  it('9. does not duplicate requests or repeat confirmation on subsequent customer messages', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_test',
      recipientId: 'c_919876543210',
      contactName: 'Anand',
      maskedPhone: '+91 98765 43210',
      appointmentRecord: {
        status: 'REQUESTED',
        customerName: 'Anand',
        customerEmail: 'anand@anandsweets.in',
        business: 'Anand Sweets'
      },
      messages: [
        {
          direction: 'inbound',
          textPreview: 'Hi, my email is anand@anandsweets.in',
          timestamp: '2026-11-09T09:00:00.000Z'
        },
        {
          direction: 'outbound',
          textPreview: "Thanks Anand! I've shared your consultation request with our team. Once it's approved, I'll send you the booking link.",
          timestamp: '2026-11-09T09:01:00.000Z'
        },
        {
          direction: 'inbound',
          textPreview: 'Thank you!',
          timestamp: '2026-11-09T09:02:00.000Z'
        }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: 'Anand',
        businessName: 'Anand Sweets',
        customerEmail: 'anand@anandsweets.in',
        maskedPhone: '+91 98765 43210',
        appointmentInterest: true,
        appointmentStatus: 'REQUESTED',
        callbackRequested: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Callback requested',
        enquirySummary: 'Appointment requested',
        conversationRef: {
          connectionId: 'conn_test',
          recipientId: 'c_919876543210',
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-09T09:02:00.000Z'
        }
      },
      latestCustomerMessage: 'Thank you!',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain("You're very welcome!");
    expect(reply.replyText).not.toContain("I've shared your consultation request with our team");
  });

  // Scenario 10: Owner approval sends Calendly link and sets AWAITING_CUSTOMER_BOOKING
  it('10. owner approval sends Calendly link and sets AWAITING_CUSTOMER_BOOKING, never marking CONFIRMED alone', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    fixture.state.binding.recipients.push({
      id: 'c_919900011122',
      phoneE164: '+919900011122',
      optedIn: true,
      displayName: 'Kiran'
    });

    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway);
    await service.updateRecipientAppointment(waScope as any, waBinding.connectionId, 'c_919900011122', {
      status: 'REQUESTED',
      customerName: 'Kiran',
      business: 'Kiran Tech',
      customerEmail: 'kiran@kirantech.io'
    });

    const app = Fastify({ logger: false });
    (app as any).requireAuth = async (req: any) => {
      req.scope = waScope;
    };
    await whatsappDurableInboxRoutes(app, service);

    const res = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/confirm`,
      payload: {
        recipientId: 'c_919900011122'
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(body.calendlyUrl).toBe('https://calendly.com/team-brandmint/30min');
    expect(body.preparedConfirmationReply).toContain('https://calendly.com/team-brandmint/30min');
    expect(body.preparedConfirmationReply).toContain('30-minute consultation');
    // Does NOT mark confirmed
    expect(body.status).not.toBe('CONFIRMED');

    // Verify stored record
    const updated = await service.getRecipient(waScope as any, waBinding.connectionId, 'c_919900011122');
    expect(updated?.recipient.appointment?.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(updated?.recipient.appointment?.calendlyUrl).toBe('https://calendly.com/team-brandmint/30min');

    await app.close();
  });

  // Scenario 11: Authentic Calendly evidence marks CONFIRMED
  it('11. authentic Calendly booking evidence marks appointment as CONFIRMED', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    fixture.state.binding.recipients.push({
      id: 'c_919900011133',
      phoneE164: '+919900011133',
      optedIn: true,
      displayName: 'Kiran'
    });

    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway);
    await service.updateRecipientAppointment(waScope as any, waBinding.connectionId, 'c_919900011133', {
      status: 'AWAITING_CUSTOMER_BOOKING',
      customerName: 'Kiran',
      business: 'Kiran Tech',
      customerEmail: 'kiran@kirantech.io',
      calendlyUrl: 'https://calendly.com/team-brandmint/30min'
    });

    const app = Fastify({ logger: false });
    (app as any).requireAuth = async (req: any) => {
      req.scope = waScope;
    };
    await whatsappDurableInboxRoutes(app, service);

    const res = await app.inject({
      method: 'POST',
      url: `/connectors/whatsapp/n8n/durable/${waBinding.connectionId}/appointments/confirm`,
      payload: {
        recipientId: 'c_919900011133',
        calendlyEvidence: {
          bookingId: 'calendly_booking_success_123',
          eventUri: 'https://api.calendly.com/scheduled_events/evt_123',
          inviteeUri: 'https://api.calendly.com/scheduled_events/evt_123/invitees/inv_123',
          status: 'active'
        }
      }
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('CONFIRMED');
    expect(body.calendlyBookingId).toBe('calendly_booking_success_123');
    expect(body.preparedConfirmationReply).toContain('confirmed with our team');

    await app.close();
  });

  // Scenario 12: Customer declines consultation -> respected, never repeatedly offered
  it('12. respects customer decline and never repeatedly offers consultation', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_test',
      recipientId: 'c_919876543210',
      maskedPhone: '+91 98765 43210',
      messages: [
        {
          direction: 'inbound',
          textPreview: 'Tell me about your services',
          timestamp: '2026-11-09T09:00:00.000Z'
        },
        {
          direction: 'outbound',
          textPreview: `We help businesses with WhatsApp Automation. ${CONSULTATION_INVITATION_EN}`,
          timestamp: '2026-11-09T09:01:00.000Z'
        },
        {
          direction: 'inbound',
          textPreview: 'No thanks, not interested in a call',
          timestamp: '2026-11-09T09:02:00.000Z'
        }
      ]
    });

    expect(memory.appointmentDeclined).toBe(true);
    expect(memory.appointmentStatus).toBe('NONE');

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: '',
        maskedPhone: '+91 98765 43210',
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Enquired',
        enquirySummary: 'Declined consultation',
        callbackRequested: false,
        conversationRef: { connectionId: 'conn', recipientId: 'c_919876543210', lastInboundMessageId: null, lastMessageAt: '2026-11-09T09:02:00.000Z' }
      },
      latestCustomerMessage: 'No thanks, not interested in a call',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('No problem at all!');
    expect(reply.replyText).not.toContain(CONSULTATION_INVITATION_EN);
    expect(reply.replyText).not.toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);
  });

  // Scenario 13: Multilingual natural flow (English, Kannada, Hindi)
  it('13. supports natural consultation flow in English, Kannada and Hindi without raw tokens', () => {
    // Kannada
    const knReply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: 'ಮಂಜುನಾಥ್',
        maskedPhone: '+91 98765 43210',
        appointmentInterest: true,
        callbackRequested: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'kn',
        leadStatus: 'Callback requested',
        enquirySummary: 'ಅಪಾಯಿಂಟ್‌ಮೆಂಟ್',
        conversationRef: { connectionId: 'conn', recipientId: 'c_919876543210', lastInboundMessageId: null, lastMessageAt: '2026-11-09T00:00:00.000Z' }
      },
      latestCustomerMessage: 'ನನಗೆ ಸಮಾಲೋಚನೆ ಬೇಕು',
      optedIn: true,
      windowOpen: true
    });
    expect(knReply.language).toBe('kn');
    expect(knReply.replyText).toContain('ಸಮಾಲೋಚನೆ');
    expect(knReply.replyText).not.toContain('REQUESTED');
    expect(knReply.replyText).not.toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);

    // Hindi
    const hiReply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: 'c_919876543210',
        customerName: 'रोहन',
        maskedPhone: '+91 98765 43210',
        appointmentInterest: true,
        callbackRequested: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'hi',
        leadStatus: 'Callback requested',
        enquirySummary: 'अपॉइंटमेंट',
        conversationRef: { connectionId: 'conn', recipientId: 'c_919876543210', lastInboundMessageId: null, lastMessageAt: '2026-11-09T00:00:00.000Z' }
      },
      latestCustomerMessage: 'मुझे परामर्श चाहिए',
      optedIn: true,
      windowOpen: true
    });
    expect(hiReply.language).toBe('hi');
    expect(hiReply.replyText).toContain('परामर्श');
    expect(hiReply.replyText).not.toContain('REQUESTED');
    expect(hiReply.replyText).not.toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);
  });

  // Scenario 14: Preserves existing records, services, websites, and paragraph formatting
  it('14. preserves existing historical records, services, websites, and single-message paragraph formatting', () => {
    // Existing record preservation
    const existingConfirmed = buildConversationMemoryState({
      connectionId: 'conn_test',
      recipientId: 'c_919876543210',
      maskedPhone: '+91 98765 43210',
      appointmentRecord: {
        status: 'CONFIRMED',
        customerName: 'Ramesh',
        service: 'Digital Marketing',
        date: '2026-11-10',
        time: '11:00 AM'
      },
      messages: []
    });
    expect(existingConfirmed.appointmentStatus).toBe('CONFIRMED');

    // Service links preserved
    expect(QUANTUM_WEAVE_WHATSAPP_FACTS.serviceWebsites.digitalMarketing).toBe('https://brandmintai.io/meta-growth');
    expect(QUANTUM_WEAVE_WHATSAPP_FACTS.serviceWebsites.aiFilms).toBe('https://filmsuccess.in');
    expect(QUANTUM_WEAVE_WHATSAPP_FACTS.serviceWebsites.aiAutomations).toBe('https://brandmintai.io/freemium');
    expect(QUANTUM_WEAVE_WHATSAPP_FACTS.serviceWebsites.linktree).toBe('https://linktr.ee/team.quantumweaveai');

    // Paragraph formatting creates readable 2-line blocks separated by \n\n in a SINGLE message
    const formatted = formatWhatsAppParagraphs(
      'WhatsApp Automation helps your business respond to customers automatically. It answers questions 24/7 without manual delay. Our systems capture customer details and qualify leads directly in the chat. You can also view appointment requests and send scheduling links easily.'
    );
    expect(formatted).toContain('\n\n');
    expect(formatted.split('\n\n').length).toBeGreaterThanOrEqual(2);
  });
});
