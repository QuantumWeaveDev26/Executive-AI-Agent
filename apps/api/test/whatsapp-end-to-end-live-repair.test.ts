import { describe, expect, it } from 'vitest';
import { defaultPolicyGateway } from '@thaara/policy';
import {
  extractWhatsAppCustomerEnquiry,
  buildQuantumWeaveCustomerReply,
  buildConversationMemoryState,
  isRealCustomerName,
  extractCustomerName,
  extractCustomerEmail
} from '../src/services/whatsapp-enquiries.js';
import { QUANTUM_WEAVE_COMPANY_INFO } from '../src/services/quantum-weave-knowledge.js';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import {
  WhatsAppTransactionalFixture,
  waScope,
  waBinding
} from './helpers/whatsapp-durable-fixture.js';

describe('THAARA V2 — WhatsApp End-to-End Live Repair Verification', () => {
  it('1. Strict Name validation: rejects email addresses, domains, labels, and business terms', () => {
    expect(isRealCustomerName('krishna')).toBe(true);
    expect(isRealCustomerName('Krishna Rao')).toBe(true);
    expect(isRealCustomerName('krishna example@gmail.com')).toBe(false);
    expect(isRealCustomerName('example@gmail.com')).toBe(false);
    expect(isRealCustomerName('name: krishna')).toBe(false);
    expect(isRealCustomerName('clothing business')).toBe(false);
    expect(isRealCustomerName('whatsapp automation')).toBe(false);
    expect(isRealCustomerName('owner test')).toBe(false);
    expect(isRealCustomerName('test user')).toBe(false);
    expect(isRealCustomerName('https://example.com')).toBe(false);
  });

  it('2. Multi-line extraction cleanly isolates name and email without concatenation', () => {
    const multiLineInput = ['krishna\nexample@gmail.com'];
    const extractedName = extractCustomerName(multiLineInput, undefined, 'customer_name');
    expect(extractedName).toBe('Krishna');

    const emailInfo = extractCustomerEmail(multiLineInput);
    expect(emailInfo.email).toBe('example@gmail.com');
  });

  it('3. Structured key-value labels cleanly extract name, business, and email', () => {
    const structuredInput = [
      'book me consultation\nname krishna\nbusiness clothing business\nemail example@gmail.com'
    ];
    const extractedName = extractCustomerName(structuredInput);
    expect(extractedName).toBe('Krishna');

    const emailInfo = extractCustomerEmail(structuredInput);
    expect(emailInfo.email).toBe('example@gmail.com');

    const enquiry = extractWhatsAppCustomerEnquiry({
      connectionId: 'conn-test',
      recipientId: 'rec-test',
      contactName: 'Owner Test Phone',
      maskedPhone: '+91 ******4634',
      optedIn: true,
      messages: [
        {
          direction: 'inbound',
          textPreview: structuredInput[0],
          timestamp: '2026-11-11T11:47:00.000Z'
        }
      ]
    });

    expect(enquiry).not.toBeNull();
    expect(enquiry!.customerName).toBe('Krishna');
    expect(enquiry!.customerEmail).toBe('example@gmail.com');
    expect(enquiry!.businessCategory).toBe('Clothing / Fashion');
    expect(enquiry!.appointmentStatus).toBe('REQUESTED');
    expect(enquiry!.leadStatus).toBe('Callback requested');
  });

  it('4. Real WhatsApp live test sequence: human handoff and multi-turn consultation intake', () => {
    const messages: Array<{ direction: 'inbound' | 'outbound'; textPreview: string; timestamp: string }> = [
      { direction: 'inbound', textPreview: 'Hi', timestamp: '2026-11-11T11:37:00.000Z' },
      { direction: 'outbound', textPreview: 'Hi! How can I help you today?', timestamp: '2026-11-11T11:38:00.000Z' },
      { direction: 'inbound', textPreview: 'What can u help me', timestamp: '2026-11-11T11:38:30.000Z' },
      { direction: 'outbound', textPreview: 'Which service do you need for your business, and how can Quantum Weave AI help you today?', timestamp: '2026-11-11T11:38:40.000Z' },
      { direction: 'inbound', textPreview: 'What is quantum weave', timestamp: '2026-11-11T11:39:00.000Z' },
      { direction: 'outbound', textPreview: 'I am Thaara, Quantum Weave\'s AI assistant... What kind of business do you run?', timestamp: '2026-11-11T11:39:30.000Z' },
      { direction: 'inbound', textPreview: 'What kind of service do u provide', timestamp: '2026-11-11T11:40:00.000Z' },
      { direction: 'outbound', textPreview: 'We provide: 1. Digital Marketing 2. AI Videos & Creative Content 3. WhatsApp Automation 4. AI Agents & Assistants 5. AI Integration 6. Business Automation\n\nExplore our services: https://linktr.ee/team.quantumweaveai\n\nWhich service interests you?', timestamp: '2026-11-11T11:40:30.000Z' },
      { direction: 'inbound', textPreview: 'whatsapp automation', timestamp: '2026-11-11T11:41:00.000Z' },
      { direction: 'outbound', textPreview: 'With WhatsApp Automation, we can help your business automatically answer customer messages... Learn more: https://brandmintai.io/freemium\n\nWhat would you like to automate first?', timestamp: '2026-11-11T11:41:30.000Z' },
      { direction: 'inbound', textPreview: 'both', timestamp: '2026-11-11T11:42:00.000Z' },
      { direction: 'outbound', textPreview: 'Sure, we can help with both. What questions do customers usually ask your business?', timestamp: '2026-11-11T11:42:30.000Z' }
    ];

    // Turn: "can u connect me with ur team"
    const handoffInbound = {
      direction: 'inbound' as const,
      textPreview: 'can u connect me with ur team',
      timestamp: '2026-11-11T11:43:00.000Z'
    };
    messages.push(handoffInbound);

    const inputTurn1 = {
      connectionId: 'c1',
      recipientId: 'r1',
      contactName: 'Owner Test Phone',
      maskedPhone: '+91 ******4634',
      optedIn: true,
      messages
    };
    const enquiryTurn1 = extractWhatsAppCustomerEnquiry(inputTurn1)!;
    const memoryTurn1 = buildConversationMemoryState(inputTurn1);
    const replyTurn1 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn1,
      latestCustomerMessage: handoffInbound.textPreview,
      optedIn: true,
      windowOpen: true,
      autoReplyMode: true,
      hasPriorReply: true,
      hasNewerInbound: false,
      memory: memoryTurn1
    });

    expect(replyTurn1.allowed).toBe(true);
    expect(replyTurn1.replyText).toContain('https://wa.me/919972965677');
    expect(replyTurn1.replyText).toContain('consultation');

    // Customer proceeds with: "can u book the appointment"
    messages.push({
      direction: 'outbound',
      textPreview: replyTurn1.replyText!,
      timestamp: '2026-11-11T11:43:30.000Z'
    });
    const bookInbound = {
      direction: 'inbound' as const,
      textPreview: 'can u book the appointment',
      timestamp: '2026-11-11T11:44:00.000Z'
    };
    messages.push(bookInbound);

    const inputTurn2 = { ...inputTurn1, messages };
    const enquiryTurn2 = extractWhatsAppCustomerEnquiry(inputTurn2)!;
    const memoryTurn2 = buildConversationMemoryState(inputTurn2);
    const replyTurn2 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn2,
      latestCustomerMessage: bookInbound.textPreview,
      optedIn: true,
      windowOpen: true,
      autoReplyMode: true,
      hasPriorReply: true,
      hasNewerInbound: false,
      memory: memoryTurn2
    });

    expect(replyTurn2.allowed).toBe(true);
    expect(replyTurn2.replyText).toContain('arrange a consultation');

    // Customer provides name and email on two lines:
    messages.push({
      direction: 'outbound',
      textPreview: replyTurn2.replyText!,
      timestamp: '2026-11-11T11:44:30.000Z'
    });
    const detailsInbound = {
      direction: 'inbound' as const,
      textPreview: 'krishna\nexample@gmail.com',
      timestamp: '2026-11-11T11:45:00.000Z'
    };
    messages.push(detailsInbound);

    const inputTurn3 = { ...inputTurn1, messages };
    const enquiryTurn3 = extractWhatsAppCustomerEnquiry(inputTurn3)!;
    const memoryTurn3 = buildConversationMemoryState(inputTurn3);
    const replyTurn3 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn3,
      latestCustomerMessage: detailsInbound.textPreview,
      optedIn: true,
      windowOpen: true,
      autoReplyMode: true,
      hasPriorReply: true,
      hasNewerInbound: false,
      memory: memoryTurn3
    });

    expect(enquiryTurn3.customerName).toBe('Krishna');
    expect(enquiryTurn3.customerEmail).toBe('example@gmail.com');
    // Name must NOT be concatenated with email:
    expect(enquiryTurn3.customerName).not.toContain('@');
    expect(enquiryTurn3.customerName).not.toContain('example');
    // Prompt asks for the missing business detail:
    expect(replyTurn3.replyText).toContain('business');

    // Customer provides business name: "Clothing Business"
    messages.push({
      direction: 'outbound',
      textPreview: replyTurn3.replyText!,
      timestamp: '2026-11-11T11:45:30.000Z'
    });
    const bizInbound = {
      direction: 'inbound' as const,
      textPreview: 'Clothing Business',
      timestamp: '2026-11-11T11:46:00.000Z'
    };
    messages.push(bizInbound);

    const inputTurn4 = { ...inputTurn1, messages };
    const enquiryTurn4 = extractWhatsAppCustomerEnquiry(inputTurn4)!;
    const memoryTurn4 = buildConversationMemoryState(inputTurn4);
    const replyTurn4 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn4,
      latestCustomerMessage: bizInbound.textPreview,
      optedIn: true,
      windowOpen: true,
      autoReplyMode: true,
      hasPriorReply: true,
      hasNewerInbound: false,
      memory: memoryTurn4
    });

    expect(enquiryTurn4.customerName).toBe('Krishna');
    expect(enquiryTurn4.customerEmail).toBe('example@gmail.com');
    expect(enquiryTurn4.businessCategory).toBe('Clothing / Fashion');
    expect(enquiryTurn4.appointmentStatus).toBe('REQUESTED');
    expect(replyTurn4.replyText).toContain('shared your consultation request with our team');

    // Customer asks regular question while consultation is pending:
    messages.push({
      direction: 'outbound',
      textPreview: replyTurn4.replyText!,
      timestamp: '2026-11-11T11:46:30.000Z'
    });
    const questionInbound = {
      direction: 'inbound' as const,
      textPreview: 'What services does Quantum Weave provide?',
      timestamp: '2026-11-11T11:47:00.000Z'
    };
    messages.push(questionInbound);

    const inputTurn5 = { ...inputTurn1, messages };
    const enquiryTurn5 = extractWhatsAppCustomerEnquiry(inputTurn5)!;
    const memoryTurn5 = buildConversationMemoryState(inputTurn5);
    const replyTurn5 = buildQuantumWeaveCustomerReply({
      enquiry: enquiryTurn5,
      latestCustomerMessage: questionInbound.textPreview,
      optedIn: true,
      windowOpen: true,
      autoReplyMode: true,
      hasPriorReply: true,
      hasNewerInbound: false,
      memory: memoryTurn5
    });

    expect(replyTurn5.replyText).toContain('1. Digital Marketing');
    expect(replyTurn5.replyText).toContain('https://linktr.ee/team.quantumweaveai');
    expect(replyTurn5.replyText).not.toContain('shared your consultation request');
  });

  it('5. Verified Company Knowledge matches Linktree directory and official 30-min Calendly URL', () => {
    expect(QUANTUM_WEAVE_COMPANY_INFO.calendlyUrl).toBe('https://calendly.com/team-brandmint/30min');
    expect(QUANTUM_WEAVE_COMPANY_INFO.linktreeUrl).toBe('https://linktr.ee/team.quantumweaveai');
    expect(QUANTUM_WEAVE_COMPANY_INFO.supportContact).toContain('+91 99729 65677');
  });

  it('6. Owner CONFIRM & SEND LINK dispatches approved booking link without mutating binding.recipients', async () => {
    const fixture = new WhatsAppTransactionalFixture();
    const service = new DurableWhatsAppService(fixture as any, defaultPolicyGateway);

    const approvedMessage = `Your 30-minute consultation request has been approved.\n\nPlease select and confirm your preferred slot here:\nhttps://calendly.com/team-brandmint/30min\n\nWe look forward to speaking with you.`;

    const apptRecord = {
      status: 'AWAITING_CUSTOMER_BOOKING' as const,
      calendlyUrl: 'https://calendly.com/team-brandmint/30min',
      linkSentAt: new Date().toISOString(),
      customerName: 'Krishna',
      customerEmail: 'example@gmail.com',
      business: 'Clothing / Fashion',
      service: 'WhatsApp Automation',
      bookingLinkSent: true as const
    };

    const recipientsBefore = JSON.stringify(fixture.state.binding.recipients);

    const result = await service.dispatchAppointmentApproval(
      waScope as any,
      waBinding.connectionId,
      'c_919972964634',
      apptRecord,
      approvedMessage
    );

    expect(result.status).toBe('AWAITING_CUSTOMER_BOOKING');
    expect(result.bookingLinkSent).toBe(true);
    expect(result.preparedConfirmationReply).toBe(approvedMessage);

    // Verify binding.recipients was NEVER mutated (protecting PostgreSQL trigger guard_whatsapp_offline_state)
    expect(JSON.stringify(fixture.state.binding.recipients)).toBe(recipientsBefore);

    // Verify dispatch was successfully created in fixture state
    expect(fixture.state.dispatches.length).toBe(1);
    const dispatch = fixture.state.dispatches[0]!;
    expect(dispatch.draft.recipientId).toBe('c_919972964634');
    expect('bodyText' in dispatch.draft ? dispatch.draft.bodyText : '').toBe(approvedMessage);
    expect(dispatch.approvalId).toMatch(/^[0-9a-f-]{36}$|^owner-approval-/);
  });
});
