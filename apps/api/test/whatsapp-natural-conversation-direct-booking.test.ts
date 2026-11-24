import { describe, expect, it } from 'vitest';
import {
  buildConversationMemoryState,
  buildQuantumWeaveCustomerReply,
  DIRECT_CALENDLY_URL,
  QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK
} from '../src/services/whatsapp-enquiries.js';

describe('WhatsApp Natural AI Conversation & Direct Calendly Booking', () => {
  const baseRecipientId = 'c_919876543210';
  const maskedPhone = '+91 98765 43210';

  it('1. standardizes initial greeting for first inbound greeting', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_1',
      recipientId: baseRecipientId,
      maskedPhone,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'Hi',
          timestamp: '2026-11-11T10:00:00.000Z'
        }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        requestedService: null,
        businessType: null,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Enquired',
        enquirySummary: 'Greeting',
        callbackRequested: false,
        conversationRef: {
          connectionId: 'conn_1',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T10:00:00.000Z'
        }
      },
      latestCustomerMessage: 'Hi',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: false,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toBe("Hi! I'm Thaara, Quantum Weave AI's assistant. May I know your name?");
  });

  it('2. provides returning customer greeting on subsequent greeting turns', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_1',
      recipientId: baseRecipientId,
      maskedPhone,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'Hi',
          timestamp: '2026-11-11T10:00:00.000Z'
        },
        {
          direction: 'outbound',
          textPreview: "Hi! I'm Thaara, Quantum Weave AI's assistant. How can I help you today?",
          timestamp: '2026-11-11T10:00:05.000Z'
        },
        {
          direction: 'inbound',
          textPreview: 'Hello again',
          timestamp: '2026-11-11T10:05:00.000Z'
        }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        requestedService: null,
        businessType: null,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Enquired',
        enquirySummary: 'Greeting',
        callbackRequested: false,
        conversationRef: {
          connectionId: 'conn_1',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T10:05:00.000Z'
        }
      },
      latestCustomerMessage: 'Hello again',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toBe('Hi! How can I help you today? May I know your name?');
  });

  it('3. directly provides Calendly link for various booking expressions without intake barriers', () => {
    const expressions = [
      'Book me a meeting.',
      'I need a consultation.',
      'Can I speak with your team?',
      'Can we schedule a call?',
      'Can you connect me with your team?',
      'can u book the appointment',
      'I want to discuss my requirements.',
      'Can someone from Quantum Weave contact me?'
    ];

    for (const expression of expressions) {
      const memory = buildConversationMemoryState({
        connectionId: 'conn_1',
        recipientId: baseRecipientId,
        maskedPhone,
        messages: [
          {
            direction: 'inbound',
            textPreview: expression,
            timestamp: '2026-11-11T10:10:00.000Z'
          }
        ]
      });

      const reply = buildQuantumWeaveCustomerReply({
        enquiry: {
          recipientId: baseRecipientId,
          customerName: '',
          maskedPhone,
          appointmentInterest: true,
          contactOptedIn: true,
          consentProvenance: 'stored_contact_opt_in',
          consentRecorded: true,
          consentTimestamp: null,
          detectedLanguage: 'en',
          leadStatus: 'Callback requested',
          enquirySummary: 'Appointment requested',
          conversationRef: {
            connectionId: 'conn_1',
            recipientId: baseRecipientId,
            lastInboundMessageId: null,
            lastMessageAt: '2026-11-11T10:10:00.000Z'
          }
        },
        latestCustomerMessage: expression,
        optedIn: true,
        windowOpen: true,
        hasPriorReply: true,
        memory
      });

      expect(reply.allowed).toBe(true);
      expect(reply.replyText).toContain(DIRECT_CALENDLY_URL);
      expect(reply.replyText).toContain('30-minute consultation');
      // Must NOT gate by asking for name, business name, or email
      expect(reply.replyText).not.toContain('May I have your name, business name and email address?');
      expect(reply.replyText).not.toMatch(/\b(?:what time|which date|preferred date|preferred time)\b/i);
    }
  });

  it('4. provides human handoff WhatsApp link alongside Calendly link when customer asks for human/team contact', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_1',
      recipientId: baseRecipientId,
      maskedPhone,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'can u connect me with ur team',
          timestamp: '2026-11-11T10:15:00.000Z'
        }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        appointmentInterest: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Callback requested',
        enquirySummary: 'Handoff requested',
        conversationRef: {
          connectionId: 'conn_1',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T10:15:00.000Z'
        }
      },
      latestCustomerMessage: 'can u connect me with ur team',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);
    expect(reply.replyText).toContain(DIRECT_CALENDLY_URL);
    expect(reply.replyText).not.toContain('human agent has joined');
  });

  it('5. handles Kannada direct booking smoothly', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_1',
      recipientId: baseRecipientId,
      maskedPhone,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'ನನಗೆ ಮೀಟಿಂಗ್ ಬುಕ್ ಮಾಡಿ',
          timestamp: '2026-11-11T10:20:00.000Z'
        }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        appointmentInterest: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'kn',
        leadStatus: 'Callback requested',
        enquirySummary: 'Appointment requested',
        conversationRef: {
          connectionId: 'conn_1',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T10:20:00.000Z'
        }
      },
      latestCustomerMessage: 'ನನಗೆ ಮೀಟಿಂಗ್ ಬುಕ್ ಮಾಡಿ',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain(DIRECT_CALENDLY_URL);
    expect(reply.replyText).toContain('30 ನಿಮಿಷಗಳ ಸಮಾಲೋಚನೆ');
  });

  it('6. handles Hindi direct booking smoothly', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_1',
      recipientId: baseRecipientId,
      maskedPhone,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'मुझे मीटिंग बुक करनी है',
          timestamp: '2026-11-11T10:25:00.000Z'
        }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        appointmentInterest: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'hi',
        leadStatus: 'Callback requested',
        enquirySummary: 'Appointment requested',
        conversationRef: {
          connectionId: 'conn_1',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T10:25:00.000Z'
        }
      },
      latestCustomerMessage: 'मुझे मीटिंग बुक करनी है',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain(DIRECT_CALENDLY_URL);
    expect(reply.replyText).toContain('30 मिनट का परामर्श');
  });

  it('7. maintains conversational memory across multi-turn exploration', () => {
    // Multi-turn: services -> what is quantum weave -> whatsapp automation -> both
    const memory = buildConversationMemoryState({
      connectionId: 'conn_1',
      recipientId: baseRecipientId,
      maskedPhone,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'What kind of service do u provide',
          timestamp: '2026-11-11T10:00:00.000Z'
        },
        {
          direction: 'outbound',
          textPreview: 'We provide:\n1. Digital Marketing\n2. AI Videos & Creative Content\n3. WhatsApp Automation\n4. AI Agents & Assistants\n5. AI Integration\n6. Business Automation\n\nExplore our services and websites:\nhttps://linktr.ee/team.quantumweaveai\n\nWhich service interests you?',
          timestamp: '2026-11-11T10:00:05.000Z'
        },
        {
          direction: 'inbound',
          textPreview: 'whatsapp automation',
          timestamp: '2026-11-11T10:01:00.000Z'
        },
        {
          direction: 'outbound',
          textPreview: 'With WhatsApp Automation, we can help your business automatically answer customer messages and handle enquiries 24/7, turning more conversations into customers.\n\nLearn more about our conversion systems here: https://brandmintai.io/freemium\n\nWhat would you like to automate first?',
          timestamp: '2026-11-11T10:01:05.000Z'
        },
        {
          direction: 'inbound',
          textPreview: 'both',
          timestamp: '2026-11-11T10:02:00.000Z'
        }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        requestedService: 'WhatsApp Automation',
        businessType: null,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Enquired',
        enquirySummary: 'WhatsApp Automation enquiry',
        conversationRef: {
          connectionId: 'conn_1',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T10:02:00.000Z'
        }
      },
      latestCustomerMessage: 'both',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText.toLowerCase()).toContain('both');
  });

  it('8. cleanly extracts customer name from multi-line format without attaching email or business', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_1',
      recipientId: baseRecipientId,
      maskedPhone,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'book me consultation\nname krishna\nbusiness clothing business\nemail example@gmail.com',
          timestamp: '2026-11-11T10:30:00.000Z'
        }
      ]
    });

    expect(memory.customerName).toBe('Krishna');
    expect(memory.customerEmail).toBe('example@gmail.com');
    expect(memory.businessType).toBe('clothing / fashion');

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: memory.customerName ?? '',
        maskedPhone,
        appointmentInterest: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Callback requested',
        enquirySummary: 'Appointment requested',
        conversationRef: {
          connectionId: 'conn_1',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T10:30:00.000Z'
        }
      },
      latestCustomerMessage: 'book me consultation\nname krishna\nbusiness clothing business\nemail example@gmail.com',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('Krishna');
    expect(reply.replyText).toContain(DIRECT_CALENDLY_URL);
    // Name is clean, not "krishna example@gmail.com"
    expect(reply.replyText).not.toContain('krishna example@gmail.com');
    // Does NOT say "Once it's approved, I'll send you the booking link"
    expect(reply.replyText).not.toContain("Once it's approved");
  });

  it('9. provides direct Calendly booking without intake gating when customer says "can u book the appointment"', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_1',
      recipientId: baseRecipientId,
      maskedPhone,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'can u book the appointment',
          timestamp: '2026-11-11T10:35:00.000Z'
        }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        appointmentInterest: true,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Callback requested',
        enquirySummary: 'Appointment requested',
        conversationRef: {
          connectionId: 'conn_1',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T10:35:00.000Z'
        }
      },
      latestCustomerMessage: 'can u book the appointment',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain(DIRECT_CALENDLY_URL);
    expect(reply.replyText).not.toContain('May I have your name, business name and email address?');
  });
});
