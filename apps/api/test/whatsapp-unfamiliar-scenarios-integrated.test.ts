import { describe, expect, it, vi } from 'vitest';
import {
  buildConversationMemoryState,
  extractWhatsAppCustomerEnquiry,
  buildQuantumWeaveCustomerReply,
  DIRECT_CALENDLY_URL,
  QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK
} from '../src/services/whatsapp-enquiries.js';
import { DurableWhatsAppService } from '../src/services/whatsapp-durable.js';
import { WhatsAppTransactionalFixture, waScope, waBinding, waNow, waEvent, waApproval } from './helpers/whatsapp-durable-fixture.js';
import { defaultPolicyGateway } from '@thaara/policy';
import { createPilotWhatsAppDispatcher } from '../src/services/whatsapp-pilot-dispatch.js';

describe('WhatsApp Natural Conversational Quality & Unfamiliar Scenarios', () => {
  const baseRecipientId = 'c_919876543210';
  const maskedPhone = '+91 98765 43210';

  // Scenario 1: Filmmaker wanting AI-assisted production workflows
  it('1. handles filmmaker wanting AI-assisted production workflows naturally', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_film',
      recipientId: baseRecipientId,
      maskedPhone,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'I am an independent film director and I want to explore AI-assisted production workflows for our upcoming project.',
          timestamp: '2026-11-11T12:00:00.000Z'
        }
      ]
    });

    const enquiry = extractWhatsAppCustomerEnquiry({
      connectionId: 'conn_film',
      recipientId: baseRecipientId,
      maskedPhone,
      optedIn: true,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'I am an independent film director and I want to explore AI-assisted production workflows for our upcoming project.',
          timestamp: '2026-11-11T12:00:00.000Z'
        }
      ]
    })!;

    // When n8n AI Agent produces a natural, contextual creative response
    const n8nReply = "That sounds like an exciting project! At Quantum Weave, we specialize in AI-powered visual storytelling and creative workflows—from AI concept visualization to automated post-production asset generation. What stage of production are you currently focusing on?";
    
    const replyWithAgent = buildQuantumWeaveCustomerReply({
      enquiry,
      latestCustomerMessage: 'I am an independent film director and I want to explore AI-assisted production workflows for our upcoming project.',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: false,
      memory,
      n8nAgentReply: n8nReply
    });

    expect(replyWithAgent.allowed).toBe(true);
    expect(replyWithAgent.replyText).toContain('AI-powered visual storytelling');
    expect(replyWithAgent.replyText).toContain('https://filmsuccess.in');
    // Does NOT override with hardcoded generic template
    expect(replyWithAgent.replyText).toContain('What stage of production are you currently focusing on?');
  });

  // Scenario 2: Founder wanting an AI employee or workforce multiplier
  it('2. handles founder wanting an AI employee or workforce multiplier', () => {
    const memory = buildConversationMemoryState({
      connectionId: 'conn_founder',
      recipientId: baseRecipientId,
      maskedPhone,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'I run a 10-person e-commerce agency and I need an AI employee or workforce multiplier to handle customer operations and reporting.',
          timestamp: '2026-11-11T12:05:00.000Z'
        }
      ]
    });

    const enquiry = extractWhatsAppCustomerEnquiry({
      connectionId: 'conn_founder',
      recipientId: baseRecipientId,
      maskedPhone,
      optedIn: true,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'I run a 10-person e-commerce agency and I need an AI employee or workforce multiplier to handle customer operations and reporting.',
          timestamp: '2026-11-11T12:05:00.000Z'
        }
      ]
    })!;

    const n8nReply = "We help agencies deploy Executive AI Assistants and intelligent automations that act as dedicated workforce multipliers—handling client queries, syncing CRM data, and automating status reports 24/7. Which specific operational bottleneck is taking up the most time for your team?";

    const reply = buildQuantumWeaveCustomerReply({
      enquiry,
      latestCustomerMessage: 'I run a 10-person e-commerce agency and I need an AI employee or workforce multiplier to handle customer operations and reporting.',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: false,
      memory,
      n8nAgentReply: n8nReply
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('workforce multipliers');
    expect(reply.replyText).toContain('operational bottleneck');
  });

  // Scenario 3: Company seeking AI integration across multiple departments
  it('3. handles company seeking AI integration across multiple departments', () => {
    const n8nReply = "We build custom AI integrations across marketing, sales pipelines, customer support, and internal operations so your systems communicate seamlessly. Would you like to start with client-facing automations or internal back-office workflows?";

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        appointmentInterest: false,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Enquired',
        enquirySummary: 'Cross-department integration',
        conversationRef: {
          connectionId: 'conn_corp',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T12:10:00.000Z'
        }
      },
      latestCustomerMessage: 'We are a manufacturing firm with 200 employees looking to integrate AI across sales, operations, and customer support.',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      n8nAgentReply: n8nReply
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('custom AI integrations');
    expect(reply.replyText).toContain('client-facing automations or internal back-office workflows');
  });

  // Scenario 4: Customer comparing AI automation options
  it('4. handles customer comparing WhatsApp automation vs full business automation', () => {
    const n8nReply = "WhatsApp Automation focuses on customer-facing 24/7 conversational engagement, instant query resolution, and lead qualification directly in chat. Full Business Automation connects your internal CRMs, inventory, and cross-tool workflows behind the scenes. Would you like to see how they work together for your business?";

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        appointmentInterest: false,
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Enquired',
        enquirySummary: 'Comparison query',
        conversationRef: {
          connectionId: 'conn_comp',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T12:15:00.000Z'
        }
      },
      latestCustomerMessage: 'What is the difference between WhatsApp automation and full business automation?',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      n8nAgentReply: n8nReply
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('WhatsApp Automation focuses on customer-facing');
    expect(reply.replyText).toContain('Full Business Automation connects');
  });

  // Scenario 5: Context memory on short follow-ups: "both", "explain more", "how much will it cost?"
  it('5. remembers multi-turn context and handles short replies: "both", "explain more", "how much will it cost?"', () => {
    // 5A: "both"
    const memoryBoth = buildConversationMemoryState({
      connectionId: 'conn_short',
      recipientId: baseRecipientId,
      maskedPhone,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'Do you offer WhatsApp customer support or lead generation?',
          timestamp: '2026-11-11T12:20:00.000Z'
        },
        {
          direction: 'outbound',
          textPreview: 'We provide both 24/7 customer support and automated lead conversion. Would you prefer to focus on customer support, lead generation, or both?',
          timestamp: '2026-11-11T12:20:05.000Z'
        },
        {
          direction: 'inbound',
          textPreview: 'both',
          timestamp: '2026-11-11T12:21:00.000Z'
        }
      ]
    });

    const replyBoth = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        requestedService: 'WhatsApp Automation',
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Enquired',
        enquirySummary: 'WhatsApp enquiry',
        conversationRef: {
          connectionId: 'conn_short',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T12:21:00.000Z'
        }
      },
      latestCustomerMessage: 'both',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory: memoryBoth
    });

    expect(replyBoth.allowed).toBe(true);
    expect(replyBoth.replyText.toLowerCase()).toContain('both');

    // 5B: "how much will it cost?"
    const replyCost = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        requestedService: 'WhatsApp Automation',
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Enquired',
        enquirySummary: 'Pricing query',
        conversationRef: {
          connectionId: 'conn_short',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T12:22:00.000Z'
        }
      },
      latestCustomerMessage: 'how much will it cost?',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory: memoryBoth,
      n8nAgentReply: "Our pricing depends on your specific business requirements and scope of automation."
    });

    expect(replyCost.allowed).toBe(true);
    // Mandatory pricing disclaimer is enforced
    expect(replyCost.replyText).toContain('Our team can understand your requirements and guide you on the next steps.');
    // Never quotes unverified figures
    expect(replyCost.replyText).not.toMatch(/₹|Rs\.|\$|\d{3,}/);

    // 5C: "explain more"
    const replyExplain = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        requestedService: 'WhatsApp Automation',
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Enquired',
        enquirySummary: 'Explain more query',
        conversationRef: {
          connectionId: 'conn_short',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T12:23:00.000Z'
        }
      },
      latestCustomerMessage: 'explain more',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory: memoryBoth,
      n8nAgentReply: "With WhatsApp Automation, your system instantly responds to inbound messages, answers FAQs, qualifies prospects based on their requirements, and syncs their information to your CRM so your team never misses a lead."
    });

    expect(replyExplain.allowed).toBe(true);
    expect(replyExplain.replyText).toContain('instantly responds');
  });

  // Scenario 6: Customer changing requirements mid-conversation
  it('6. adapts smoothly when customer changes requirements mid-conversation', () => {
    // Turn 1: started with digital marketing
    // Turn 2: switched to WhatsApp automation
    const memory = buildConversationMemoryState({
      connectionId: 'conn_change',
      recipientId: baseRecipientId,
      maskedPhone,
      messages: [
        {
          direction: 'inbound',
          textPreview: 'We need digital marketing for our clinic.',
          timestamp: '2026-11-11T12:30:00.000Z'
        },
        {
          direction: 'outbound',
          textPreview: 'We help clinics with digital marketing and Meta ad campaigns: https://brandmintai.io/meta-growth',
          timestamp: '2026-11-11T12:30:05.000Z'
        },
        {
          direction: 'inbound',
          textPreview: 'Actually, scratch that, our main bottleneck is that our front desk misses 50 WhatsApp inquiries a day, we need WhatsApp automation first.',
          timestamp: '2026-11-11T12:31:00.000Z'
        }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: {
        recipientId: baseRecipientId,
        customerName: '',
        maskedPhone,
        requestedService: 'WhatsApp Automation',
        businessType: 'clinic',
        contactOptedIn: true,
        consentProvenance: 'stored_contact_opt_in',
        consentRecorded: true,
        consentTimestamp: null,
        detectedLanguage: 'en',
        leadStatus: 'Enquired',
        enquirySummary: 'WhatsApp Automation for clinic',
        conversationRef: {
          connectionId: 'conn_change',
          recipientId: baseRecipientId,
          lastInboundMessageId: null,
          lastMessageAt: '2026-11-11T12:31:00.000Z'
        }
      },
      latestCustomerMessage: 'Actually, scratch that, our main bottleneck is that our front desk misses 50 WhatsApp inquiries a day, we need WhatsApp automation first.',
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory,
      n8nAgentReply: "Understood! Missing patient enquiries is a critical bottleneck. With WhatsApp Automation, we can set up instant automated replies to answer common clinic queries 24/7, route emergency requests, and capture appointment details."
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('WhatsApp Automation');
    expect(reply.replyText).toContain('clinic');
  });

  // Scenario 7: Customer asks ONLY for phone number or WhatsApp contact (Requirement 7)
  it('7. provides phone/WhatsApp contact naturally without forcing Calendly link when customer asks only for contact info', () => {
    const contactQueries = [
      'What is your phone number?',
      'Can you share your WhatsApp contact?',
      'give me your contact number',
      'how can i reach your team'
    ];

    for (const query of contactQueries) {
      const memory = buildConversationMemoryState({
        connectionId: 'conn_contact_only',
        recipientId: baseRecipientId,
        maskedPhone,
        messages: [{ direction: 'inbound', textPreview: query, timestamp: '2026-11-11T12:35:00.000Z' }]
      });

      const reply = buildQuantumWeaveCustomerReply({
        enquiry: {
          recipientId: baseRecipientId,
          customerName: '',
          maskedPhone,
          appointmentInterest: false,
          contactOptedIn: true,
          consentProvenance: 'stored_contact_opt_in',
          consentRecorded: true,
          consentTimestamp: null,
          detectedLanguage: 'en',
          leadStatus: 'Enquired',
          enquirySummary: 'Contact enquiry',
          conversationRef: {
            connectionId: 'conn_contact_only',
            recipientId: baseRecipientId,
            lastInboundMessageId: null,
            lastMessageAt: '2026-11-11T12:35:00.000Z'
          }
        },
        latestCustomerMessage: query,
        optedIn: true,
        windowOpen: true,
        hasPriorReply: true,
        memory
      });

      expect(reply.allowed).toBe(true);
      expect(reply.replyText).toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);
      expect(reply.replyText).toContain('+91 99729 65677');
      // Must NOT force consultation link when customer only asked for phone/WhatsApp
      expect(reply.replyText).not.toContain(DIRECT_CALENDLY_URL);
    }
  });

  // Scenario 8: Direct Calendly booking works without owner approval when explicitly requested (Requirement 6)
  it('8. provides direct Calendly booking without owner approval when explicitly requested', () => {
    const bookingQueries = [
      'Book me a meeting',
      'I need a consultation',
      'Can we schedule a call?',
      'Can you book the appointment?',
      'I want to discuss my requirements'
    ];

    for (const query of bookingQueries) {
      const memory = buildConversationMemoryState({
        connectionId: 'conn_direct_book',
        recipientId: baseRecipientId,
        maskedPhone,
        messages: [{ direction: 'inbound', textPreview: query, timestamp: '2026-11-11T12:40:00.000Z' }]
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
            connectionId: 'conn_direct_book',
            recipientId: baseRecipientId,
            lastInboundMessageId: null,
            lastMessageAt: '2026-11-11T12:40:00.000Z'
          }
        },
        latestCustomerMessage: query,
        optedIn: true,
        windowOpen: true,
        hasPriorReply: true,
        memory
      });

      expect(reply.allowed).toBe(true);
      expect(reply.replyText).toContain(DIRECT_CALENDLY_URL);
      expect(reply.replyText).toContain('30-minute consultation');
      // No gating questions
      expect(reply.replyText).not.toContain('May I have your name, business name and email address?');
      expect(reply.replyText).not.toMatch(/\b(?:what time|which date|preferred date)\b/i);
    }
  });

  // Scenario 9: Integrated end-to-end test with DurableWhatsAppService receiving n8nAgentReply in event payload
  it('9. integrated test: DurableWhatsAppService processes n8nAgentReply from event envelope into automated dispatch', async () => {
    const store = new WhatsAppTransactionalFixture() as WhatsAppTransactionalFixture & {
      resolveAutoReplyOwnerScope: () => Promise<typeof waScope>;
      listOwned: () => Promise<Array<{ connectionId: string; revision: number; disconnected: boolean }>>;
    };
    store.resolveAutoReplyOwnerScope = async () => waScope;
    store.listOwned = async () => [{ connectionId: waBinding.connectionId, revision: waBinding.revision, disconnected: false }];
    const origTx = store.transaction.bind(store);
    store.transaction = async (scope: any, id: string, operation: (tx: any) => Promise<any>) =>
      origTx(scope, id, async tx =>
        operation({
          ...tx,
          createAutoReplyApproval: async (draft: any) => {
            const approval = waApproval(draft);
            const approvalId = '88888888-9999-4000-8111-' + String(store.approvals.size + 1).padStart(12, '0');
            const durableApproval = {
              ...approval,
              id: approvalId,
              expiresAt: new Date(Math.max(Date.now(), waNow) + 86400000).toISOString()
            };
            store.approvals.set(approvalId, durableApproval);
            return approvalId;
          }
        })
      );

    const n8nCalls: Array<{ dispatchId: string; connectionRevision: number }> = [];
    const dispatcher = createPilotWhatsAppDispatcher({
      webhookPath: '/webhook/thaara-wa-pilot',
      headerName: 'X-Thaara-Dispatch-Secret',
      secret: 'a'.repeat(40),
      fetchImpl: (async (_url: any, init: any) => {
        n8nCalls.push(JSON.parse(String(init?.body ?? '{}')));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch
    });

    const service = new DurableWhatsAppService(store, defaultPolicyGateway, () => waNow, {
      profile: () => ({
        connectionId: waBinding.connectionId,
        recipientId: '*',
        maxPerDay: null,
        expiresAt: waNow + 3600000,
        richMessages: true
      }),
      dispatcher
    });

    expect(service.autoReplyFor(waBinding.connectionId)).toBe(true);

    const relayScope = {
      authKind: 'whatsapp_relay' as const,
      principalId: '22222222-2222-4222-8222-222222222222',
      workspaceId: waScope.workspaceId,
      userId: waScope.userId,
      role: 'owner' as const,
      connectionId: waBinding.connectionId,
      revision: waBinding.revision,
      operation: 'events' as const,
      relayTokenHash: 'b'.repeat(64)
    };

    // Simulated event containing the authoritative reply from n8n Quantum Weave AI Agent
    const incomingEvent = waEvent('wamid.n8n_integrated_1', waNow - 5000);
    incomingEvent.messages[0]!.text.body = 'We are a logistics company wanting to automate driver check-ins.';
    (incomingEvent as any).n8nAgentReply = 'We can automate driver check-ins using WhatsApp, verifying driver IDs and updating your dispatch system in real time. Would you like to see how our workflow automation works?';

    await service.ingest(relayScope, waBinding.connectionId, incomingEvent);

    expect(store.state.dispatches).toHaveLength(1);
    expect(n8nCalls).toHaveLength(1);
    const dispatch = store.state.dispatches[0]!;
    expect(dispatch.draft.bodyText).toContain('automate driver check-ins using WhatsApp');
    expect(dispatch.draft.bodyText).toContain('verifying driver IDs');
  });

  // Scenario 10: Regression test for real production failure
  // Customer previously discussed clothing & digital marketing; then switches to filmmaker & AI employees when n8n Agent fails
  it('10. handles topic transition from clothing to filmmaker looking to build AI employees even when n8n AI Agent fails/times out', () => {
    // History contains prior clothing business & digital marketing discussion
    const messages = [
      {
        direction: 'inbound' as const,
        textPreview: 'I run a clothing business and need help.',
        timestamp: '2026-11-11T10:00:00.000Z'
      },
      {
        direction: 'outbound' as const,
        textPreview: 'How can we help your clothing business with Digital Marketing?',
        timestamp: '2026-11-11T10:01:00.000Z'
      },
      // New turn: customer presents new domain and need
      {
        direction: 'inbound' as const,
        textPreview: "I'm a filmmaker looking to build AI employees for my production business. How could you help?",
        timestamp: '2026-11-11T11:32:00.000Z'
      }
    ];

    const memory = buildConversationMemoryState({
      connectionId: 'conn_film_switch',
      recipientId: baseRecipientId,
      maskedPhone,
      messages
    });

    const enquiry = extractWhatsAppCustomerEnquiry({
      connectionId: 'conn_film_switch',
      recipientId: baseRecipientId,
      maskedPhone,
      optedIn: true,
      messages
    })!;

    expect(enquiry.businessType).toBe('film production');
    expect(['Visual Storytelling', 'AI Agents']).toContain(enquiry.requestedService);

    // n8nAgentReply is undefined (simulating OpenAI no-credits error or 10s timeout)
    const reply = buildQuantumWeaveCustomerReply({
      enquiry,
      latestCustomerMessage: "I'm a filmmaker looking to build AI employees for my production business. How could you help?",
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory,
      n8nAgentReply: undefined
    });

    expect(reply.allowed).toBe(true);
    // MUST NOT mention clothing or digital marketing!
    expect(reply.replyText).not.toContain('clothing');
    expect(reply.replyText).not.toContain('Digital Marketing');
    expect(reply.replyText).not.toContain('How can we help your clothing business');

    // MUST mention film production, AI agents / workflow automation, and filmsuccess.in
    expect(reply.replyText).toContain('film production');
    expect(reply.replyText).toContain('AI agents');
    expect(reply.replyText).toContain('https://filmsuccess.in');
    expect(reply.replyText).toContain('Which part of your production workflow would you like your AI employees to handle first?');
  });

  // Scenario 11: Customer correction
  it('11. handles customer correction cleanly when correcting "not clothing, I am a filmmaker"', () => {
    const messages = [
      {
        direction: 'inbound' as const,
        textPreview: 'I need marketing help.',
        timestamp: '2026-11-11T10:00:00.000Z'
      },
      {
        direction: 'outbound' as const,
        textPreview: 'Great! We can help your clothing business reach more customers.',
        timestamp: '2026-11-11T10:01:00.000Z'
      },
      {
        direction: 'inbound' as const,
        textPreview: "No, I'm a filmmaker, not clothing. How can you help my production business?",
        timestamp: '2026-11-11T10:02:00.000Z'
      }
    ];

    const memory = buildConversationMemoryState({
      connectionId: 'conn_correction',
      recipientId: baseRecipientId,
      maskedPhone,
      messages
    });

    const enquiry = extractWhatsAppCustomerEnquiry({
      connectionId: 'conn_correction',
      recipientId: baseRecipientId,
      maskedPhone,
      optedIn: true,
      messages
    })!;

    expect(enquiry.businessType).toBe('film production');

    const reply = buildQuantumWeaveCustomerReply({
      enquiry,
      latestCustomerMessage: "No, I'm a filmmaker, not clothing. How can you help my production business?",
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true,
      memory
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('My apologies for the confusion');
    expect(reply.replyText).toContain('film production');
    expect(reply.replyText).not.toContain('clothing');
  });

  // Scenario 12: Multi-department AI integration
  it('12. handles enterprise enquiry for AI integration across multiple departments', () => {
    const text = 'Can you integrate AI across multiple departments in our company?';
    const enquiry = extractWhatsAppCustomerEnquiry({
      connectionId: 'conn_multi',
      recipientId: baseRecipientId,
      maskedPhone,
      optedIn: true,
      messages: [
        {
          direction: 'inbound' as const,
          textPreview: text,
          timestamp: '2026-11-11T12:00:00.000Z'
        }
      ]
    })!;

    const reply = buildQuantumWeaveCustomerReply({
      enquiry,
      latestCustomerMessage: text,
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('Quantum Weave specializes in end-to-end business automation and AI integration');
    expect(reply.replyText).toContain('Would you like a 30-minute consultation with our team to discuss your multi-department integration roadmap?');
  });

  // Scenario 13: Customer comparing AI automation options
  it('13. handles customer asking to compare AI automation options', () => {
    const text = 'What are my AI automation options for my business?';
    const enquiry = extractWhatsAppCustomerEnquiry({
      connectionId: 'conn_opt',
      recipientId: baseRecipientId,
      maskedPhone,
      optedIn: true,
      messages: [
        {
          direction: 'inbound' as const,
          textPreview: text,
          timestamp: '2026-11-11T12:00:00.000Z'
        }
      ]
    })!;

    const reply = buildQuantumWeaveCustomerReply({
      enquiry,
      latestCustomerMessage: text,
      optedIn: true,
      windowOpen: true,
      hasPriorReply: true
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).toContain('Quantum Weave offers three practical automation tiers');
    expect(reply.replyText).toContain('https://brandmintai.io/freemium');
    expect(reply.replyText).toContain('Which area would create the biggest impact for your business right now?');
  });
});
