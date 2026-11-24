import { describe, expect, it, vi } from 'vitest';
import {
  WhatsAppAIService,
  buildWhatsAppSystemPrompt,
  isExplicitConsultationRequest,
  isExplicitContactLinkRequest,
  isStandaloneGreeting,
  buildThaaraIntroduction
} from '../src/services/whatsapp-ai-service.js';
import type { ModelGatewayAdapter, ModelStreamChunk, ModelPromptContext } from '../src/services/model-gateway.js';
import {
  DIRECT_CALENDLY_URL,
  QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK
} from '../src/services/whatsapp-enquiries.js';

describe('WhatsAppAIService — Unified Thaara AI Engine for WhatsApp', () => {
  it('1. correctly identifies explicit consultation and meeting booking requests', () => {
    expect(isExplicitConsultationRequest('Book me a meeting.')).toBe(true);
    expect(isExplicitConsultationRequest('I need a consultation with your team')).toBe(true);
    expect(isExplicitConsultationRequest('Can we schedule a call?')).toBe(true);
    expect(isExplicitConsultationRequest('I want to discuss my requirements')).toBe(true);
    expect(isExplicitConsultationRequest('Can someone from Quantum Weave contact me?')).toBe(true);
    expect(isExplicitConsultationRequest('ಸಮಾಲೋಚನೆಗಾಗಿ ಸಮಯ ನಿಗದಿಪಡಿಸಿ')).toBe(true);
    expect(isExplicitConsultationRequest('कृपया मेरे साथ एक मीटिंग बुक करें')).toBe(true);
    // Negative cases: generic questions are not explicit booking requests
    expect(isExplicitConsultationRequest('What services do you offer?')).toBe(false);
    expect(isExplicitConsultationRequest('How much does automation cost?')).toBe(false);
  });

  it('2. correctly identifies explicit WhatsApp contact link requests', () => {
    expect(isExplicitContactLinkRequest("What's your WhatsApp contact link?")).toBe(true);
    expect(isExplicitContactLinkRequest('Share your contact number')).toBe(true);
    expect(isExplicitContactLinkRequest('ವಾಟ್ಸಾಪ್ ಲಿಂಕ್ ಕಳುಹಿಸಿ')).toBe(true);
    expect(isExplicitContactLinkRequest('अपना व्हाट्सएप संपर्क लिंक साझा करें')).toBe(true);
    // Negative cases
    expect(isExplicitContactLinkRequest('Tell me about your AI agents')).toBe(false);
  });

  it('3. directly returns Calendly link without model call when consultation is requested', async () => {
    const mockGateway: ModelGatewayAdapter = {
      streamResponse: vi.fn()
    };
    const service = new WhatsAppAIService(mockGateway);

    const result = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_1',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'Can we schedule a call to discuss our business requirements?',
      conversationHistory: []
    });

    expect(result.status).toBe('generated');
    expect(result.source).toBe('direct_link');
    expect(result.replyText).toContain(DIRECT_CALENDLY_URL);
    expect(result.replyText).toContain('30-minute slot');
    // Ensure ModelGateway was NOT called unnecessarily
    expect(mockGateway.streamResponse).not.toHaveBeenCalled();
  });

  it('4. directly returns WhatsApp contact link when customer requests team contact', async () => {
    const mockGateway: ModelGatewayAdapter = {
      streamResponse: vi.fn()
    };
    const service = new WhatsAppAIService(mockGateway);

    const result = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_1',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'Share your official WhatsApp contact link',
      conversationHistory: []
    });

    expect(result.status).toBe('generated');
    expect(result.source).toBe('direct_link');
    expect(result.replyText).toContain(QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK);
    expect(mockGateway.streamResponse).not.toHaveBeenCalled();
  });

  it('5. invokes ModelGatewayAdapter for natural conversation (filmmaker wanting AI employees)', async () => {
    let capturedContext: ModelPromptContext | undefined;

    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse(context) {
        capturedContext = context;
        yield { type: 'token', delta: 'For film production workflows, ' };
        yield { type: 'token', delta: 'Quantum Weave provides autonomous AI employees that can streamline script analysis, ' };
        yield { type: 'token', delta: 'production scheduling, and asset tagging. Would you like to focus on pre-production or post-production coordination?' };
      }
    };

    const service = new WhatsAppAIService(mockGateway);

    const result = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_film',
      phoneE164: '+919972965677',
      latestCustomerMessage: "I'm a filmmaker looking to build AI employees for my production business. How could you help?",
      conversationHistory: []
    });

    expect(result.status).toBe('generated');
    expect(result.source).toBe('ai_model');
    expect(result.replyText).toContain('For film production workflows');
    expect(result.replyText).toContain('autonomous AI employees');

    // Verify context passed to ModelGatewayAdapter
    expect(capturedContext).toBeDefined();
    expect(capturedContext!.systemPrompt).toContain('Thaara');
    expect(capturedContext!.systemPrompt).toContain('STRICT PRICING & QUOTATION POLICY');
    expect(capturedContext!.systemPrompt).toContain('LATEST REQUIREMENT PRIORITY');
    expect(capturedContext!.userMessage).toContain('filmmaker looking to build AI employees');
  });

  it('6. strictly enforces no-pricing Sarvam policy by stripping forbidden prices from AI responses', async () => {
    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse() {
        // Model hallucinates an unauthorized package price:
        yield { type: 'token', delta: 'Our Starter AI package is ₹9,750 per month, or ₹999 for trial.' };
      }
    };

    const service = new WhatsAppAIService(mockGateway);

    const result = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_price',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'How much does your AI employee solution cost?',
      conversationHistory: []
    });

    expect(result.status).toBe('generated');
    // Forbidden prices must be completely stripped by post-generation filter
    expect(result.replyText).not.toContain('₹9,750');
    expect(result.replyText).not.toContain('₹999');
    expect(result.replyText).not.toContain('9750');
  });

  it('7. gracefully returns quota_exceeded status when ModelGateway returns MODEL_QUOTA_EXCEEDED (HTTP 429)', async () => {
    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse() {
        yield {
          type: 'error',
          status: 'failed',
          errorCode: 'MODEL_QUOTA_EXCEEDED',
          message: 'Model provider quota exceeded.'
        };
      }
    };

    const service = new WhatsAppAIService(mockGateway);

    const result = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_quota',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'Can you explain how multi-department automation works?',
      conversationHistory: []
    });

    // Truthful status: signals quota_exceeded without crashing so fallback handles customer gracefully
    expect(result.status).toBe('quota_exceeded');
    expect(result.errorCode).toBe('MODEL_QUOTA_EXCEEDED');
    expect(result.source).toBe('fallback_template');
    expect(result.replyText).toBeNull();
  });

  it('8. gracefully returns not_configured status when ModelGateway is unconfigured', async () => {
    const service = new WhatsAppAIService(undefined);

    const result = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_unconf',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'What automation options are available?',
      conversationHistory: []
    });

    expect(result.status).toBe('not_configured');
    expect(result.errorCode).toBe('MODEL_GATEWAY_NOT_CONFIGURED');
    expect(result.source).toBe('fallback_template');
    expect(result.replyText).toBeNull();
  });

  it('9. prioritizes latest customer message over older conversation assumptions in prompt assembly', () => {
    const prompt = buildWhatsAppSystemPrompt({ language: 'en' });
    expect(prompt).toContain('LATEST REQUIREMENT PRIORITY');
    expect(prompt).toContain('Always prioritize the customer\'s LATEST message');
    expect(prompt).toContain('STRICT PRICING & QUOTATION POLICY (ALIGNED WITH SARVAM VOICE)');
    expect(prompt).toContain('NEVER provide numeric prices, historical amounts (such as ₹999, ₹9,750, ₹15,870, etc.)');
    expect(prompt).toContain(DIRECT_CALENDLY_URL);
  });

  it('10. end-to-end DurableWhatsAppService automatically generates AI reply and submits dispatch', async () => {
    const { DurableWhatsAppService } = await import('../src/services/whatsapp-durable.js');
    const { WhatsAppTransactionalFixture, waScope, waBinding, waNow } = await import('./helpers/whatsapp-durable-fixture.js');
    const { defaultPolicyGateway } = await import('@thaara/policy');

    const store = new WhatsAppTransactionalFixture();
    const submit = vi.fn().mockResolvedValue(undefined);

    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse(ctx) {
        if (ctx.userMessage.includes('filmmaker')) {
          yield { type: 'token', delta: 'For film production businesses, Quantum Weave builds custom AI workflows that automate scene logging and post-production scheduling.' };
        } else {
          yield { type: 'token', delta: 'We provide custom enterprise AI agents tailored to your business needs.' };
        }
      }
    };

    const durableService = new DurableWhatsAppService(
      store as any,
      defaultPolicyGateway,
      () => waNow,
      {
        profile: () => ({
          connectionId: waBinding.connectionId,
          recipientId: '*',
          maxPerDay: 50,
          expiresAt: waNow + 86400000,
          richMessages: true
        }),
        dispatcher: { submit, autoReplyEnabled: true },
        autoReply: {
          enabled: true,
          authorizeDraft: async (scope, draft, tx) => tx.createAutoReplyApproval(draft)
        },
        modelGateway: mockGateway
      }
    );

    const inboundEvent = {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: waBinding.phoneNumberId },
      messages: [{
        id: 'wamid.film_turn1',
        from: '15550000001',
        timestamp: String(Math.floor(waNow / 1000)),
        type: 'text',
        text: { body: "I'm a filmmaker looking to build AI employees for my production business. How could you help?" }
      }]
    };

    const ingestResult = await durableService.ingest(waScope, waBinding.connectionId, inboundEvent);
    expect(ingestResult.acceptedMessages).toBe(1);

    // Verify dispatch was reserved and submitted via dispatcher
    expect(store.state.dispatches).toHaveLength(1);
    const sentDraft = store.state.dispatches[0]!.draft;
    expect(sentDraft.bodyText).toContain('For film production businesses');
    expect(sentDraft.bodyText).toContain('custom AI workflows');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      connectionId: waBinding.connectionId,
      dispatchId: store.state.dispatches[0]!.id
    }));
  });

  it('11. customer memory and history are strictly isolated by recipient identity', async () => {
    const { DurableWhatsAppService } = await import('../src/services/whatsapp-durable.js');
    const { WhatsAppTransactionalFixture, waScope, waBinding, waNow } = await import('./helpers/whatsapp-durable-fixture.js');
    const { defaultPolicyGateway } = await import('@thaara/policy');

    const store = new WhatsAppTransactionalFixture();
    // Add second customer 'shyam'
    store.state.binding.recipients.push({ id: 'shyam', phoneE164: '+15550000002', optedIn: true });

    const customerPrompts: Record<string, string[]> = { ram: [], shyam: [] };

    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse(ctx) {
        if (ctx.userMessage.includes('filmmaker')) {
          customerPrompts.ram.push(ctx.userMessage);
          yield { type: 'token', delta: 'Hello filmmaker! We have film tools.' };
        } else if (ctx.userMessage.includes('clothing')) {
          customerPrompts.shyam.push(ctx.userMessage);
          yield { type: 'token', delta: 'Hello retailer! We have marketing tools.' };
        }
      }
    };

    let currentTime = waNow;
    const durableService = new DurableWhatsAppService(
      store as any,
      defaultPolicyGateway,
      () => currentTime,
      {
        profile: () => ({
          connectionId: waBinding.connectionId,
          recipientId: '*',
          maxPerDay: 50,
          expiresAt: currentTime + 86400000,
          richMessages: true
        }),
        dispatcher: { submit: vi.fn().mockResolvedValue(undefined), autoReplyEnabled: true },
        autoReply: {
          enabled: true,
          authorizeDraft: async (scope, draft, tx) => tx.createAutoReplyApproval(draft)
        },
        modelGateway: mockGateway
      }
    );

    // Turn 1 from Customer Ram (Filmmaker)
    await durableService.ingest(waScope, waBinding.connectionId, {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: waBinding.phoneNumberId },
      messages: [{
        id: 'wamid.ram_1',
        from: '15550000001',
        timestamp: String(Math.floor(currentTime / 1000)),
        type: 'text',
        text: { body: "I'm a filmmaker" }
      }]
    });

    // Advance clock by 10 seconds for Customer Shyam (Clothing store)
    currentTime += 10000;
    await durableService.ingest(waScope, waBinding.connectionId, {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: waBinding.phoneNumberId },
      messages: [{
        id: 'wamid.shyam_1',
        from: '15550000002',
        timestamp: String(Math.floor(currentTime / 1000)),
        type: 'text',
        text: { body: "I have a clothing retail shop" }
      }]
    });

    // Verify isolation: Ram's prompt never received Shyam's message, and vice versa
    expect(customerPrompts.ram).toHaveLength(1);
    expect(customerPrompts.ram[0]).toBe("I'm a filmmaker");
    expect(customerPrompts.shyam).toHaveLength(1);
    expect(customerPrompts.shyam[0]).toBe("I have a clothing retail shop");

    // Verify dispatches are properly recipient-targeted
    expect(store.state.dispatches).toHaveLength(2);
    expect(store.state.dispatches.find((d: any) => d.draft.recipientId === 'ram')?.draft.bodyText).toContain('filmmaker');
    expect(store.state.dispatches.find((d: any) => d.draft.recipientId === 'shyam')?.draft.bodyText).toContain('retailer');
  });

  it('12. supports asynchronous auto-reply processing so webhook returns immediately', async () => {
    const { DurableWhatsAppService } = await import('../src/services/whatsapp-durable.js');
    const { WhatsAppTransactionalFixture, waScope, waBinding, waNow } = await import('./helpers/whatsapp-durable-fixture.js');
    const { defaultPolicyGateway } = await import('@thaara/policy');

    const store = new WhatsAppTransactionalFixture();
    const submit = vi.fn().mockResolvedValue(undefined);

    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse() {
        yield { type: 'token', delta: 'Async generated response for high throughput.' };
      }
    };

    const durableService = new DurableWhatsAppService(
      store as any,
      defaultPolicyGateway,
      () => waNow,
      {
        profile: () => ({
          connectionId: waBinding.connectionId,
          recipientId: '*',
          maxPerDay: 50,
          expiresAt: waNow + 86400000,
          richMessages: true
        }),
        dispatcher: { submit, autoReplyEnabled: true },
        autoReply: {
          enabled: true,
          authorizeDraft: async (scope, draft, tx) => tx.createAutoReplyApproval(draft)
        },
        modelGateway: mockGateway,
        asyncAutoReply: true
      }
    );

    const startTime = Date.now();
    const ingestResult = await durableService.ingest(waScope, waBinding.connectionId, {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: waBinding.phoneNumberId },
      messages: [{
        id: 'wamid.async_01',
        from: '15550000001',
        timestamp: String(Math.floor(waNow / 1000)),
        type: 'text',
        text: { body: 'Hello! Tell me about your automations.' }
      }]
    });
    const elapsed = Date.now() - startTime;

    // Webhook ingest returns immediately (< 50ms)
    expect(elapsed).toBeLessThan(100);
    expect(ingestResult.acceptedMessages).toBe(1);

    // Wait for async queueMicrotask to settle
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(store.state.dispatches).toHaveLength(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('13. prevents competing n8nAgentReply from overriding unified backend AI engine when cutover is active', async () => {
    const { DurableWhatsAppService } = await import('../src/services/whatsapp-durable.js');
    const { WhatsAppTransactionalFixture, waScope, waBinding, waNow } = await import('./helpers/whatsapp-durable-fixture.js');
    const { defaultPolicyGateway } = await import('@thaara/policy');

    const store = new WhatsAppTransactionalFixture();
    const submit = vi.fn().mockResolvedValue(undefined);

    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse() {
        yield { type: 'token', delta: 'Unified backend AI authoritative response for filmmaker.' };
      }
    };

    const durableService = new DurableWhatsAppService(
      store as any,
      defaultPolicyGateway,
      () => waNow,
      {
        profile: () => ({
          connectionId: waBinding.connectionId,
          recipientId: '*',
          maxPerDay: 50,
          expiresAt: waNow + 86400000,
          richMessages: true
        }),
        dispatcher: { submit, autoReplyEnabled: true },
        autoReply: {
          enabled: true,
          authorizeDraft: async (scope, draft, tx) => tx.createAutoReplyApproval(draft)
        },
        modelGateway: mockGateway,
        asyncAutoReply: false
      }
    );

    // Event carries a stale/hallucinated n8nAgentReply from old n8n agent
    const inboundEvent = {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: waBinding.phoneNumberId },
      n8nAgentReply: 'OLD STALE N8N AGENT REPLY: How can we help your clothing shop with Digital Marketing?',
      messages: [{
        id: 'wamid.compete_01',
        from: '15550000001',
        timestamp: String(Math.floor(waNow / 1000)),
        type: 'text',
        text: { body: "I'm a filmmaker looking to build AI employees for my production business. How could you help?" }
      }]
    };

    await durableService.ingest(waScope, waBinding.connectionId, inboundEvent);

    expect(store.state.dispatches).toHaveLength(1);
    const sentDraft = store.state.dispatches[0]!.draft;
    // Must contain unified backend response, NOT the stale n8nAgentReply
    expect(sentDraft.bodyText).toContain('Unified backend AI authoritative response for filmmaker');
    expect(sentDraft.bodyText).not.toContain('OLD STALE N8N AGENT REPLY');
    expect(sentDraft.bodyText).not.toContain('clothing shop');
  });

  it('14. preserves legacy n8nAgentReply when modelGateway is absent (rollback mode)', async () => {
    const { DurableWhatsAppService } = await import('../src/services/whatsapp-durable.js');
    const { WhatsAppTransactionalFixture, waScope, waBinding, waNow } = await import('./helpers/whatsapp-durable-fixture.js');
    const { defaultPolicyGateway } = await import('@thaara/policy');

    const store = new WhatsAppTransactionalFixture();
    const submit = vi.fn().mockResolvedValue(undefined);

    // No modelGateway provided: simulates rollback to legacy n8n-only mode
    const durableService = new DurableWhatsAppService(
      store as any,
      defaultPolicyGateway,
      () => waNow,
      {
        profile: () => ({
          connectionId: waBinding.connectionId,
          recipientId: '*',
          maxPerDay: 50,
          expiresAt: waNow + 86400000,
          richMessages: true
        }),
        dispatcher: { submit, autoReplyEnabled: true },
        autoReply: {
          enabled: true,
          authorizeDraft: async (scope, draft, tx) => tx.createAutoReplyApproval(draft)
        },
        asyncAutoReply: false
      }
    );

    const inboundEvent = {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: waBinding.phoneNumberId },
      n8nAgentReply: 'Legacy n8n response preserved during rollback.',
      messages: [{
        id: 'wamid.rollback_01',
        from: '15550000001',
        timestamp: String(Math.floor(waNow / 1000)),
        type: 'text',
        text: { body: 'What services do you offer?' }
      }]
    };

    await durableService.ingest(waScope, waBinding.connectionId, inboundEvent);

    expect(store.state.dispatches).toHaveLength(1);
    const sentDraft = store.state.dispatches[0]!.draft;
    expect(sentDraft.bodyText).toContain('Legacy n8n response preserved during rollback');
  });

  it('15. unfamiliar multi-turn scenario: customer changes mid-conversation from clothing to film production', async () => {
    const service = new WhatsAppAIService();
    const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: 'Hi, I sell clothes in Bangalore' },
      { role: 'assistant', content: 'Hi! We can help your clothing store with marketing.' }
    ];

    // Customer explicitly corrects and switches topic to filmmaking & AI employees
    const correctionMessage = "Actually no, that was my brother's store. I run a film production company and want AI employees to automate script breakdowns and scheduling.";
    
    const systemPrompt = buildWhatsAppSystemPrompt({ language: 'en' });
    expect(systemPrompt).toContain('LATEST REQUIREMENT PRIORITY');
    expect(systemPrompt).toContain('STRICT PRICING & QUOTATION POLICY');
    expect(systemPrompt).toContain('AI Employees & Autonomous Agents');
    expect(systemPrompt).toContain('AI Production & Creative Filmmaking');

    // In quota exhaustion / fallback, the governed reply system correctly handles this unfamiliar turn
    const { buildQuantumWeaveCustomerReply, extractWhatsAppCustomerEnquiry } = await import('../src/services/whatsapp-enquiries.js');
    const enquiry = extractWhatsAppCustomerEnquiry({
      connectionId: 'conn_test',
      recipientId: 'ram',
      contactName: 'Ram',
      maskedPhone: '+1555****01',
      optedIn: true,
      messages: [
        { providerMessageId: '1', direction: 'inbound', textPreview: 'Hi, I sell clothes in Bangalore', timestamp: '2026-11-11T10:00:00.000Z' },
        { providerMessageId: '2', direction: 'outbound', textPreview: 'Hi! We can help your clothing store with marketing.', timestamp: '2026-11-11T10:01:00.000Z' },
        { providerMessageId: '3', direction: 'inbound', textPreview: correctionMessage, timestamp: '2026-11-11T10:02:00.000Z' }
      ]
    });

    const reply = buildQuantumWeaveCustomerReply({
      enquiry: enquiry!,
      latestCustomerMessage: correctionMessage,
      optedIn: true,
      windowOpen: true,
      autoReplyMode: true,
      hasPriorReply: true,
      hasNewerInbound: false
    });

    expect(reply.allowed).toBe(true);
    expect(reply.replyText).not.toContain('clothing');
    expect(reply.replyText).toMatch(/film|production|custom AI/i);
  });

  it('16. detects standalone greetings accurately in English, Kannada, and Hindi', () => {
    expect(isStandaloneGreeting('Hi')).toBe(true);
    expect(isStandaloneGreeting('Hello!')).toBe(true);
    expect(isStandaloneGreeting('Hey')).toBe(true);
    expect(isStandaloneGreeting('Good morning')).toBe(true);
    expect(isStandaloneGreeting('Namaskara')).toBe(true);
    expect(isStandaloneGreeting('Namaste')).toBe(true);
    expect(isStandaloneGreeting('ನಮಸ್ಕಾರ')).toBe(true);
    expect(isStandaloneGreeting('नमस्ते')).toBe(true);

    // Negative: greeting combined with a question/request is NOT standalone
    expect(isStandaloneGreeting('Hi, what services do you provide?')).toBe(false);
    expect(isStandaloneGreeting('Hello, I need help with automation')).toBe(false);
    expect(isStandaloneGreeting('I am Kiran')).toBe(false);
  });

  it('17. initial contact standalone greeting returns exact Thaara introduction', async () => {
    const mockGateway: ModelGatewayAdapter = {
      streamResponse: vi.fn()
    };
    const service = new WhatsAppAIService(mockGateway);

    // English
    const resEn = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_1',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'Hi!',
      conversationHistory: []
    });
    expect(resEn.status).toBe('generated');
    expect(resEn.source).toBe('direct_link');
    expect(resEn.replyText).toBe("Hi! I'm Thaara, Quantum Weave AI's assistant. May I know your name?");
    expect(mockGateway.streamResponse).not.toHaveBeenCalled();

    // Kannada
    const resKn = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_2',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'ನಮಸ್ಕಾರ',
      conversationHistory: []
    });
    expect(resKn.status).toBe('generated');
    expect(resKn.replyText).toBe("ನಮಸ್ಕಾರ! ನಾನು ಥಾರಾ, Quantum Weave AI ನ ಸಹಾಯಕ. ನಿಮ್ಮ ಹೆಸರನ್ನು ತಿಳಿಯಬಹುದೇ?");

    // Hindi
    const resHi = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_3',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'नमस्ते',
      conversationHistory: []
    });
    expect(resHi.status).toBe('generated');
    expect(resHi.replyText).toBe("नमस्ते! मैं थारा हूँ, Quantum Weave AI की सहायक। क्या मैं आपका नाम जान सकती हूँ?");
  });

  it('18. does not repeat introduction on follow-up turns', async () => {
    let capturedContext: ModelPromptContext | undefined;
    let callsCount = 0;
    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse(context) {
        callsCount++;
        capturedContext = context;
        yield { type: 'token', delta: 'Hello again! How can I help you with your business today?' };
      }
    };
    const service = new WhatsAppAIService(mockGateway);

    const result = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_1',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'Hi',
      conversationHistory: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: "Hi! I'm Thaara, an AI assistant from Quantum Weave AI. How can I assist you today?" },
        { role: 'user', content: 'What services do you offer?' },
        { role: 'assistant', content: 'We build autonomous AI agents and cross-departmental automations.' }
      ]
    });

    expect(result.status).toBe('generated');
    expect(callsCount).toBe(1);
    expect(capturedContext?.systemPrompt).toContain('FOLLOW-UP CONVERSATION: Do NOT introduce yourself again');
  });

  it('19. passes maxTokens: 350 and short concise response guidelines', async () => {
    let capturedContext: ModelPromptContext | undefined;
    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse(context) {
        capturedContext = context;
        yield { type: 'token', delta: 'We design autonomous AI agents for workflows.' };
      }
    };
    const service = new WhatsAppAIService(mockGateway);

    await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_1',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'Can you help with customer service automation?',
      conversationHistory: []
    });

    expect(capturedContext?.maxTokens).toBe(350);
    expect(capturedContext?.systemPrompt).toContain('5 short lines MAXIMUM');
    expect(capturedContext?.systemPrompt).toContain('1 to 3 short lines are sufficient');
    expect(capturedContext?.systemPrompt).toContain('AT MOST ONE relevant follow-up question');
  });

  it('20. includes natural Sarvam-style discovery cues, 5-line ceiling, and known memory without re-asking', async () => {
    const capturedContexts: ModelPromptContext[] = [];
    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse(context) {
        capturedContexts.push(context);
        if (capturedContexts.length === 1) {
          yield {
            type: 'token',
            delta:
              'We build custom AI Voice Agents for clinics to handle inbound calls and appointment booking.\nAre you looking to automate inbound enquiries, outbound reminders, or both?'
          };
        } else {
          yield {
            type: 'token',
            delta:
              `Got it, Dr. Asha — handling ~80 daily calls at Pulse Clinic is a great fit for our AI Voice Agent.\nYou can book a 30-minute consultation with our team here: ${DIRECT_CALENDLY_URL}`
          };
        }
      }
    };
    const service = new WhatsAppAIService(mockGateway);

    // Turn 1: Standalone greeting (zero-token intro)
    const turn1 = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_clinic',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'Hello',
      conversationHistory: []
    });
    expect(turn1.replyText).toContain("Hi! I'm Thaara");

    // Turn 2: Service enquiry
    const turn2 = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_clinic',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'I run Pulse Clinic and need an AI voice agent.',
      conversationHistory: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: turn1.replyText || '' }
      ]
    });
    expect(turn2.status).toBe('generated');
    expect(turn2.replyText?.split('\n').filter(Boolean).length).toBeLessThanOrEqual(5);
    expect(capturedContexts[0]?.systemPrompt).toContain('NATURAL DISCOVERY & SERVICE QUALIFICATION (SARVAM PHONE-STYLE)');
    expect(capturedContexts[0]?.systemPrompt).toContain('AI Voice / Phone Agent');
    expect(capturedContexts[0]?.systemPrompt).toContain('WhatsApp Automation / AI Chatbot');
    expect(capturedContexts[0]?.systemPrompt).toContain('Digital Marketing / BrandMint AI');
    expect(capturedContexts[0]?.systemPrompt).toContain('Website / Web App');
    expect(capturedContexts[0]?.systemPrompt).toContain('Training / Upskilling');
    expect(capturedContexts[0]?.systemPrompt).toContain('https://linktr.ee/team.quantumweaveai');
    expect(capturedContexts[0]?.systemPrompt).toContain(DIRECT_CALENDLY_URL);

    // Turn 3: Follow-up with known customer memory
    const turn3 = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_clinic',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'Mostly inbound bookings, around 80 calls a day.',
      memory: {
        connectionId: 'conn_test',
        recipientId: 'rec_clinic',
        customerName: 'Dr. Asha',
        businessName: 'Pulse Clinic',
        businessCategory: 'Healthcare',
        previousMessages: []
      },
      conversationHistory: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: turn1.replyText || '' },
        { role: 'user', content: 'I run Pulse Clinic and need an AI voice agent.' },
        { role: 'assistant', content: turn2.replyText || '' }
      ]
    });
    expect(turn3.status).toBe('generated');
    expect(turn3.replyText).toContain(DIRECT_CALENDLY_URL);
    expect(capturedContexts[1]?.systemPrompt).toContain('KNOWN CUSTOMER MEMORY');
    expect(capturedContexts[1]?.systemPrompt).toContain('Customer Name: Dr. Asha');
    expect(capturedContexts[1]?.systemPrompt).toContain('Business / Company: Pulse Clinic');
    expect(capturedContexts[1]?.systemPrompt).toContain('Industry / Type: Healthcare');
  });

  it('21. supports Scenario A (AI Calling), Scenario B (Digital Marketing), and Scenario C (WhatsApp Automation) with <=5 lines and human-touch cues', async () => {
    const prompts: string[] = [];
    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse(context) {
        prompts.push(context.systemPrompt);
        if (context.userMessage.includes('sales')) {
          yield {
            type: 'token',
            delta:
              'We help businesses grow qualified leads and conversions through BrandMint AI and performance marketing.\nAre you mainly trying to generate more enquiries or increase direct online sales?'
          };
        } else if (context.userMessage.includes('WhatsApp')) {
          yield {
            type: 'token',
            delta:
              'Understood, Rahul. Would ABC Technologies mainly use WhatsApp automation for faster replies, lead qualification, or both?'
          };
        } else {
          yield {
            type: 'token',
            delta:
              'We can help with that. Is it mainly for handling incoming customer calls or making outgoing calls?'
          };
        }
      }
    };
    const service = new WhatsAppAIService(mockGateway);

    const resA = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_a',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'I need an AI calling agent.',
      conversationHistory: []
    });
    const resB = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_b',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'I own a retail business and want more sales.',
      conversationHistory: []
    });
    const resC = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_c',
      phoneE164: '+919972965677',
      latestCustomerMessage: 'We need WhatsApp automation for our enquiries.',
      memory: {
        connectionId: 'conn_test',
        recipientId: 'rec_c',
        customerName: 'Rahul',
        businessName: 'ABC Technologies',
        previousMessages: []
      },
      conversationHistory: [
        { role: 'user', content: 'My name is Rahul and my company is ABC Technologies.' },
        { role: 'assistant', content: 'Thanks Rahul! How can Quantum Weave help ABC Technologies today?' }
      ]
    });

    for (const res of [resA, resB, resC]) {
      expect(res.status).toBe('generated');
      expect((res.replyText || '').split('\n').filter(Boolean).length).toBeLessThanOrEqual(5);
    }
    expect(prompts[0]).toContain('Understand → Answer → Acknowledge → Ask one useful next question');
    expect(prompts[0]).toContain('avoid repetitive stock openings');
    expect(prompts[2]).toContain('Customer Name: Rahul');
    expect(prompts[2]).toContain('Business / Company: ABC Technologies');
  });

  it('22. enforces Sarvam-style name -> business -> service discovery, direct Calendly sharing, and post-Calendly continuation', async () => {
    const capturedPrompts: string[] = [];
    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse(context) {
        capturedPrompts.push(context.systemPrompt);
        const msg = context.userMessage.trim();
        if (msg === 'Krishna') {
          yield { type: 'token', delta: 'Nice to meet you, Krishna. What kind of business do you run?' };
        } else if (msg === 'Okay') {
          yield {
            type: 'token',
            delta: 'Sounds good, Krishna. If you have any questions about WhatsApp automation before your consultation, feel free to ask.'
          };
        } else {
          yield { type: 'token', delta: 'Understood. What kind of support or automation are you exploring?' };
        }
      }
    };
    const service = new WhatsAppAIService(mockGateway);

    // 1. New customer greeting asks for name
    const t1 = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_krishna',
      phoneE164: '+917019624634',
      latestCustomerMessage: 'Hi',
      conversationHistory: []
    });
    expect(t1.replyText).toBe("Hi! I'm Thaara, Quantum Weave AI's assistant. May I know your name?");

    // 2. Customer provides name -> asks about business
    const t2 = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_krishna',
      phoneE164: '+917019624634',
      latestCustomerMessage: 'Krishna',
      conversationHistory: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: t1.replyText || '' }
      ]
    });
    expect(t2.replyText).toBe('Nice to meet you, Krishna. What kind of business do you run?');
    expect(capturedPrompts[0]).toContain('1) Customer name');
    expect(capturedPrompts[0]).toContain('2) Business/company name');
    expect(capturedPrompts[0]).toContain('Owner approval is NOT required merely to share the Calendly booking link');
    expect(capturedPrompts[0]).toContain('CONTINUING AFTER CALENDLY');

    // 3. Direct Calendly sharing without owner approval + keeps conversation open
    const tCalendly = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_krishna',
      phoneE164: '+917019624634',
      latestCustomerMessage: 'Can we schedule a call to discuss this?',
      memory: {
        connectionId: 'conn_test',
        recipientId: 'rec_krishna',
        customerName: 'Krishna',
        businessName: 'ABC Technologies',
        businessCategory: 'IT Services',
        previousMessages: []
      },
      conversationHistory: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: t1.replyText || '' },
        { role: 'user', content: 'Krishna' },
        { role: 'assistant', content: t2.replyText || '' }
      ]
    });
    expect(tCalendly.source).toBe('direct_link');
    expect(tCalendly.replyText).toContain('Of course, Krishna.');
    expect(tCalendly.replyText).toContain(DIRECT_CALENDLY_URL);
    expect(tCalendly.replyText).toContain('prepare for?');

    // 4. Customer replies "Okay" after Calendly -> continues naturally without repeating Calendly or restarting
    const tOkay = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_krishna',
      phoneE164: '+917019624634',
      latestCustomerMessage: 'Okay',
      memory: {
        connectionId: 'conn_test',
        recipientId: 'rec_krishna',
        customerName: 'Krishna',
        businessName: 'ABC Technologies',
        businessCategory: 'IT Services',
        previousMessages: []
      },
      conversationHistory: [
        { role: 'user', content: 'Can we discuss this on a call?' },
        { role: 'assistant', content: tCalendly.replyText || '' }
      ]
    });
    expect(tOkay.status).toBe('generated');
    expect(tOkay.replyText).not.toContain(DIRECT_CALENDLY_URL);
    expect(tOkay.replyText).toContain('Sounds good, Krishna.');
  });

  it('23. dispatch-level DurableWhatsAppService verifies exact customer-visible greeting, returning-session name check, and direct Calendly dispatch', async () => {
    const { DurableWhatsAppService } = await import('../src/services/whatsapp-durable.js');
    const { WhatsAppTransactionalFixture, waScope, waBinding, waNow } = await import('./helpers/whatsapp-durable-fixture.js');
    const { defaultPolicyGateway } = await import('@thaara/policy');

    const store = new WhatsAppTransactionalFixture();
    const submit = vi.fn().mockResolvedValue(undefined);
    const seenPrompts: string[] = [];

    let simNow = waNow;
    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse(ctx) {
        seenPrompts.push(ctx.systemPrompt);
        if (ctx.userMessage.toLowerCase().includes('what can u help')) {
          yield {
            type: 'token',
            delta: 'We help with WhatsApp automation, AI voice agents, digital marketing, and AI videos.\nMay I know your name?'
          };
        } else if (ctx.userMessage.trim().toLowerCase() === 'hi') {
          yield {
            type: 'token',
            delta: 'Hi! How can I help you today? May I know your name?'
          };
        } else {
          yield {
            type: 'token',
            delta: 'Sounds good, Krishna. Feel free to ask anything before your consultation.'
          };
        }
      }
    };

    const durableService = new DurableWhatsAppService(
      store as any,
      defaultPolicyGateway,
      () => simNow,
      {
        profile: () => ({
          connectionId: waBinding.connectionId,
          recipientId: '*',
          maxPerDay: 50,
          expiresAt: simNow + 86400000,
          richMessages: true
        }),
        dispatcher: { submit, autoReplyEnabled: true },
        autoReply: {
          enabled: true,
          authorizeDraft: async (scope, draft, tx) => tx.createAutoReplyApproval(draft)
        },
        modelGateway: mockGateway
      }
    );

    // 1. Genuine new customer sends "Hi" -> dispatched bodyText MUST introduce Thaara and ask name (not overwritten!)
    await durableService.ingest(waScope, waBinding.connectionId, {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: waBinding.phoneNumberId },
      messages: [{
        id: 'wamid.disp_hi_1',
        from: '15550000001',
        timestamp: String(Math.floor(simNow / 1000)),
        type: 'text',
        text: { body: 'Hi' }
      }]
    });
    expect(store.state.dispatches).toHaveLength(1);
    expect(store.state.dispatches[0]!.draft.bodyText).toBe(
      "Hi! I'm Thaara, Quantum Weave AI's assistant. May I know your name?"
    );

    // 2. Customer asks "what can u help me" before sharing name -> MISSING CUSTOMER IDENTITY injected & name asked
    simNow += 120_000;
    await durableService.ingest(waScope, waBinding.connectionId, {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: waBinding.phoneNumberId },
      messages: [{
        id: 'wamid.disp_help_2',
        from: '15550000001',
        timestamp: String(Math.floor(simNow / 1000)),
        type: 'text',
        text: { body: 'what can u help me' }
      }]
    });
    expect(store.state.dispatches).toHaveLength(2);
    expect(seenPrompts[0]).toContain('MISSING CUSTOMER IDENTITY');
    expect(store.state.dispatches[1]!.draft.bodyText).toContain('May I know your name?');

    // 3. Returning session greeting when name is NOT yet known -> asks name without repeating full intro
    simNow += 120_000;
    await durableService.ingest(waScope, waBinding.connectionId, {
      field: 'messages',
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: waBinding.phoneNumberId },
      messages: [{
        id: 'wamid.disp_hi_3',
        from: '15550000001',
        timestamp: String(Math.floor(simNow / 1000)),
        type: 'text',
        text: { body: 'hi' }
      }]
    });
    expect(store.state.dispatches).toHaveLength(3);
    expect(store.state.dispatches[2]!.draft.bodyText).toBe(
      'Hi! How can I help you today? May I know your name?'
    );
  });

  it('24. classifies exact failed sentence "can i book the appointment", equivalent Test G intents, contextual "go head", and enforces strict role boundaries', async () => {
    const mockGateway: ModelGatewayAdapter = {
      async *streamResponse(ctx) {
        yield {
          type: 'token',
          delta: 'Our Quantum Weave team can review your requirements and build the right solution. Would you like to discuss this with our team?'
        };
      }
    };
    const service = new WhatsAppAIService(mockGateway);

    // Test F: Exact failed sentence from live test
    expect(isExplicitConsultationRequest('can i book the appointment')).toBe(true);
    const resF = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_re',
      phoneE164: '+917019624634',
      latestCustomerMessage: 'can i book the appointment',
      memory: {
        connectionId: 'conn_test',
        recipientId: 'rec_re',
        customerName: 'Krishna',
        businessCategory: 'Real Estate',
        previousMessages: []
      },
      conversationHistory: [
        { role: 'user', content: 'We get 30 to 50 enquiries daily for real estate.' },
        { role: 'assistant', content: 'Understood, Krishna. What is the biggest challenge with those enquiries?' }
      ]
    });
    expect(resF.source).toBe('direct_link');
    expect(resF.replyText).toContain('Of course, Krishna.');
    expect(resF.replyText).toContain(DIRECT_CALENDLY_URL);
    expect(resF.replyText).not.toContain('cannot perform actions externally');

    // Test G: Equivalent appointment / team intents
    const testGPhrases = [
      'Can we schedule a call?',
      'I want to meet your team.',
      'Please share your booking link.',
      'Can I book a demo?',
      'Can I speak with someone?'
    ];
    for (const phrase of testGPhrases) {
      expect(isExplicitConsultationRequest(phrase)).toBe(true);
    }

    // Negative guard: customer discussing appointment automation for their own customers
    expect(isExplicitConsultationRequest('I want appointment booking automation for my customers')).toBe(false);
    expect(isExplicitConsultationRequest('I need appointment automation for my real estate customers')).toBe(false);

    // Contextual "go head" after team consultation offer -> shares Calendly instead of generating a project plan
    const resGoHead = await service.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_re',
      phoneE164: '+917019624634',
      latestCustomerMessage: 'go head',
      memory: {
        connectionId: 'conn_test',
        recipientId: 'rec_re',
        customerName: 'Krishna',
        previousMessages: []
      },
      conversationHistory: [
        { role: 'user', content: 'WhatsApp automation' },
        { role: 'assistant', content: 'We can set up WhatsApp automation for your enquiries. Would you like to discuss this with our team?' }
      ]
    });
    expect(resGoHead.source).toBe('direct_link');
    expect(resGoHead.replyText).toContain(DIRECT_CALENDLY_URL);

    // Test I: Out-of-scope build request -> prompt enforces STRICT ROLE BOUNDARIES
    let capturedPrompt = '';
    const spyService = new WhatsAppAIService({
      async *streamResponse(ctx) {
        capturedPrompt = ctx.systemPrompt;
        yield { type: 'token', delta: 'Our Quantum Weave team can review your workflow and build that for you. Would you like to connect with our team?' };
      }
    });
    const resOut = await spyService.generateCustomerReply({
      connectionId: 'conn_test',
      recipientId: 'rec_re',
      phoneE164: '+917019624634',
      latestCustomerMessage: 'Build me a complete n8n workflow and script right now.',
      conversationHistory: [{ role: 'assistant', content: "Hi! I'm Thaara, Quantum Weave AI's assistant. May I know your name?" }]
    });
    expect(capturedPrompt).toContain('STRICT ROLE BOUNDARIES (QUANTUM WEAVE BUSINESS REPRESENTATIVE ONLY)');
    expect(capturedPrompt).toContain('NEVER generate unsolicited implementation plans');
    expect(resOut.replyText).toContain('Quantum Weave team');
  });
});
