import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { authPlugin } from '../src/plugins/auth.js';
import { conversationRoutes, normalizeSpokenCommandForDetectors } from '../src/routes/conversations.js';
import { shapeSpokenTextForVoice } from '../src/routes/chat-voice.js';
import {
  asksForDetailedVoiceExplanation,
  buildVoiceConsultantTurnConfig,
  extractKnownCustomerName,
  isVoiceOpeningGreeting
} from '../src/services/chat-voice-consultant.js';
import { detectGmailChatRequest } from '../src/services/chat-gmail-assistant.js';
import { detectCalendarChatRequest } from '../src/services/chat-calendar-assistant.js';
import { detectGoogleDriveChatRequest } from '../src/services/chat-google-drive-assistant.js';
import { detectPhoneCallingIntent } from '../src/services/phone-calling-intent.js';

const WORKSPACE_ID = '10000000-0000-4000-8000-000000000001';
const USER_ID = '10000000-0000-4000-8000-000000000002';
const CONV_ID = '10000000-0000-4000-8000-000000000003';
const STREAM_ID = '10000000-0000-4000-8000-000000000004';

describe('Thaara Chat Voice — Business Solutions Consultant (Voice-Mode Only)', () => {
  it('detects multilingual opening greetings without matching substantive questions', () => {
    expect(isVoiceOpeningGreeting('Hi')).toBe(true);
    expect(isVoiceOpeningGreeting('Hello Thaara!')).toBe(true);
    expect(isVoiceOpeningGreeting('ನಮಸ್ಕಾರ ತಾರಾ')).toBe(true);
    expect(isVoiceOpeningGreeting('नमस्ते तारा')).toBe(true);
    expect(isVoiceOpeningGreeting('Hi, my sales team misses calls')).toBe(false);
    expect(isVoiceOpeningGreeting('What services does Quantum Weave offer?')).toBe(false);
  });

  it('extracts customer name from bare discovery reply, explicit intro, or consented memory and prevents repeat questions', () => {
    const history = [
      {
        role: 'assistant' as const,
        content:
          "Hello! I'm Thaara from Quantum Weave AI. I help businesses find practical solutions using AI and automation. May I know your name?"
      },
      { role: 'user' as const, content: 'Rahul' }
    ];
    expect(extractKnownCustomerName(history)).toBe('Rahul');

    const cfg = buildVoiceConsultantTurnConfig({
      userMessage: 'I run a real estate company and my team misses calls.',
      priorHistory: history
    });
    expect(cfg.alreadyIntroduced).toBe(true);
    expect(cfg.isOpeningGreeting).toBe(false);
    expect(cfg.knownCustomerName).toBe('Rahul');
    expect(cfg.maxTokens).toBe(210);
    expect(cfg.systemPrompt).toContain('NEVER say "Hello", "Hi"');
    expect(cfg.systemPrompt).toContain('KNOWN CUSTOMER NAME: "Rahul"');
    expect(cfg.systemPrompt).toContain('1 to 3 short, sweet, natural spoken sentences');
    expect(cfg.systemPrompt).toContain('at most ONE question');

    const fromMem = buildVoiceConsultantTurnConfig({
      userMessage: 'Hi',
      priorHistory: [],
      memories: [{ category: 'profile', key: 'user_name', content: 'Priya' }]
    });
    expect(fromMem.isOpeningGreeting).toBe(true);
    expect(fromMem.knownCustomerName).toBe('Priya');
    expect(fromMem.systemPrompt).toContain('Do NOT ask for their name again');
  });

  it('expands token budget only when user explicitly asks for detail or a discovery summary', () => {
    expect(asksForDetailedVoiceExplanation('My shop inventory is hard to track')).toBe(false);
    expect(asksForDetailedVoiceExplanation('Can you summarize what we discussed?')).toBe(true);
    expect(asksForDetailedVoiceExplanation('Please explain that in detail')).toBe(true);

    const detailed = buildVoiceConsultantTurnConfig({
      userMessage: 'Please summarize our discussion so far.',
      priorHistory: [{ role: 'assistant', content: 'How are you tracking stock?' }]
    });
    expect(detailed.asksForDetail).toBe(true);
    expect(detailed.maxTokens).toBe(420);
  });

  it('condenses long email/report outputs for voice playback by default while preserving approval/safety warnings', () => {
    const shortReply =
      'We could use an AI calling assistant to answer enquiries and qualify leads. Roughly how many calls do you receive daily?';
    expect(shapeSpokenTextForVoice(shortReply, 'My sales team misses calls')).toBe(shortReply);

    const longReportWithSafety = [
      'Here is a summary of your latest 5 unread customer emails from today.',
      'First, Rohan Properties asked for a follow-up call on the commercial leasing proposal.',
      'Second, Meera Textiles shared updated Q4 inventory counts across three Bengaluru warehouses and requested automated stock reconciliation.',
      'Third, Kaveri Logistics sent monthly freight invoices and vendor spreadsheets totaling forty-two line items for review.',
      'Fourth, Arun Dental Clinic inquired about WhatsApp appointment reminders and patient follow-up workflows.',
      'Note: The draft reply to Rohan Properties has not been sent and is awaiting approval in Chat.'
    ].join(' ');

    const conciseSpoken = shapeSpokenTextForVoice(longReportWithSafety, 'Thaara, check my unread emails.');
    expect(conciseSpoken.length).toBeLessThan(longReportWithSafety.length);
    expect(conciseSpoken).toContain('awaiting approval');
    expect(conciseSpoken).toContain('The full details are in Chat');

    const fullRequested = shapeSpokenTextForVoice(longReportWithSafety, 'Read the full email report in detail.');
    expect(fullRequested).toContain('Arun Dental Clinic');
    expect(fullRequested).not.toContain('The full details are in Chat');

    const longWithQuestion = [
      'Here is an overview of your five active customer support channels across email and WhatsApp.',
      'First, inbound order status questions currently wait four hours during peak morning shifts.',
      'Second, repeat fabric pricing requests require staff to look up three separate spreadsheets manually.',
      'Third, callback requests from wholesale buyers are tracked in handwritten notes rather than a shared log.',
      'Fourth, we can automate routine status replies while routing custom bulk orders to your team.',
      'Would you like to start a small pilot with phone enquiries or WhatsApp messages first?'
    ].join(' ');
    const shapedWithQ = shapeSpokenTextForVoice(longWithQuestion, 'How can we improve support?');
    expect(shapedWithQ).toContain('Would you like to start a small pilot with phone enquiries or WhatsApp messages first?');

    const kannadaWithForeignGlitch =
      'ಕೃಷ್ಣ ಅವರೇ, ನಿಮ್ಮ ಬಿಸಿನೆಸ್‌ಗೆ ನಾವು ಸೂಕ್ತ פתרון ಪರಿಹಾರ ನೀಡಬಹುದು. ನೀವು ಯಾವ ರೀತಿಯ ಬಿಸಿನೆಸ್ ಮಾಡುತ್ತಿದ್ದೀರಾ?';
    const cleanedKn = shapeSpokenTextForVoice(kannadaWithForeignGlitch, 'ಸಹಾಯ ಬೇಕು');
    expect(cleanedKn).not.toContain('פתרון');
    expect(cleanedKn).toContain('ನೀವು ಯಾವ ರೀತಿಯ ಬಿಸಿನೆಸ್ ಮಾಡುತ್ತಿದ್ದೀರಾ?');
  });

  it('tracks progressive business discovery state so Thaara remembers Krishna, asks business before challenge, and avoids repeating challenge questions', () => {
    const beforeBusiness = buildVoiceConsultantTurnConfig({
      userMessage: 'What is my name?',
      priorHistory: [
        { role: 'user', content: 'Hi' },
        {
          role: 'assistant',
          content: "Hello! I'm Thaara from Quantum Weave AI. May I know your name?"
        },
        { role: 'user', content: 'Krishna' },
        {
          role: 'assistant',
          content: 'Nice to meet you, Krishna! What kind of business do you run?'
        }
      ]
    });
    expect(beforeBusiness.knownCustomerName).toBe('Krishna');
    expect(beforeBusiness.knownBusinessReported).toBe(false);
    expect(beforeBusiness.knownChallengeReported).toBe(false);
    expect(beforeBusiness.systemPrompt).toContain('they have NOT yet shared what kind of business they run');

    const afterBusinessAndChallenge = buildVoiceConsultantTurnConfig({
      userMessage: 'My team spends too much time answering customer calls.',
      priorHistory: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'May I know your name?' },
        { role: 'user', content: 'Krishna' },
        { role: 'assistant', content: 'Nice to meet you, Krishna! What kind of business do you run?' },
        { role: 'user', content: 'I run a clothing manufacturing company.' },
        { role: 'assistant', content: "What's the biggest challenge in your manufacturing business?" }
      ]
    });
    expect(afterBusinessAndChallenge.knownCustomerName).toBe('Krishna');
    expect(afterBusinessAndChallenge.knownBusinessReported).toBe(true);
    expect(afterBusinessAndChallenge.knownChallengeReported).toBe(true);
    expect(afterBusinessAndChallenge.systemPrompt).toContain('ALREADY shared their challenge');
    expect(afterBusinessAndChallenge.systemPrompt).toContain('Quantum View');
  });

  it('Scenario F: preserves governed Gmail, Calendar, Drive, and Phone task routing in Voice Mode without forcing discovery', () => {
    expect(detectGmailChatRequest(normalizeSpokenCommandForDetectors('Thaara, check my unread emails.'))?.kind).toBe(
      'read_unread'
    );
    expect(
      detectCalendarChatRequest(normalizeSpokenCommandForDetectors('Thaara, what meetings do I have tomorrow?'))?.kind
    ).toBe('agenda_read');
    expect(
      detectGoogleDriveChatRequest(normalizeSpokenCommandForDetectors('Thaara, find my latest Google Drive report.'))
        ?.kind
    ).toBe('search_files');
    expect(
      detectGmailChatRequest(normalizeSpokenCommandForDetectors('Thaara, create an email draft for a customer.'))?.kind
    ).toBe('compose_new_email');
    expect(
      detectPhoneCallingIntent(normalizeSpokenCommandForDetectors('Thaara, call +919876543210 about the proposal.'))
    ).toBeTruthy();
  });

  it('Scenario H: strictly isolates Text Chat from Voice Mode Business Consultant behavior', async () => {
    const capturedContexts: any[] = [];
    let streamVer = 1;
    const db: any = {
      query: async (sql: string) => {
        if (sql.includes('FROM resolve_session_scope')) {
          return {
            rows: [{ session_id: STREAM_ID, workspace_id: WORKSPACE_ID, user_id: USER_ID, role: 'owner' }]
          };
        }
        if (sql.includes('FROM public.conversations')) {
          return {
            rows: [
              {
                id: CONV_ID,
                workspace_id: WORKSPACE_ID,
                user_id: USER_ID,
                title: 'Isolation Test',
                channel: 'web',
                status: 'active',
                metadata: {},
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }
            ]
          };
        }
        if (sql.includes('initiate_assistant_stream')) {
          streamVer = 1;
          return {
            rows: [
              {
                initiate_assistant_stream: {
                  stream_id: STREAM_ID,
                  status: 'queued',
                  user_message_id: CONV_ID,
                  assistant_message_id: null,
                  version: 1,
                  idempotent_replay: false
                }
              }
            ]
          };
        }
        if (sql.includes('append_assistant_stream_event')) {
          streamVer++;
          return {
            rows: [
              {
                append_assistant_stream_event: {
                  stream_id: STREAM_ID,
                  sequence_number: streamVer,
                  version: streamVer,
                  status: 'streaming'
                }
              }
            ]
          };
        }
        if (sql.includes('finalize_assistant_stream')) {
          streamVer++;
          return {
            rows: [
              {
                finalize_assistant_stream: {
                  stream_id: STREAM_ID,
                  status: 'completed',
                  assistant_message_id: STREAM_ID,
                  sequence_number: streamVer,
                  version: streamVer
                }
              }
            ]
          };
        }
        return { rows: [] };
      },
      withScopedTransaction: async (_s: any, fn: any) => fn(db)
    };

    const modelGateway: any = {
      streamResponse: vi.fn(async function* (ctx: any) {
        capturedContexts.push(ctx);
        yield {
          type: 'token',
          delta:
            'Quantum Weave helps businesses save time and grow using AI assistants, automation, and digital marketing. What kind of business do you run?'
        };
      })
    };

    const app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin, { db });
    await app.register(
      async (v1) => {
        await conversationRoutes(v1, { db, modelGateway, policyGateway: {} as any });
      },
      { prefix: '/api/v1' }
    );

    try {
      const headers = {
        cookie: 'thaara_session=synthetic-session; thaara_csrf=synthetic-csrf',
        'x-csrf-token': 'synthetic-csrf'
      };

      const textRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conversations/${CONV_ID}/stream`,
        headers,
        payload: { content: 'What does Quantum Weave do?', idempotency_key: 'text-turn-1' }
      });
      expect(textRes.statusCode).toBe(200);
      expect(textRes.body).toContain('https://linktr.ee/team.quantumweaveai');
      expect(capturedContexts.length).toBe(0);

      const textGenRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conversations/${CONV_ID}/stream`,
        headers,
        payload: {
          content: 'My employees spend hours making Excel reports.',
          idempotency_key: 'text-turn-2',
          voice_mode: false
        }
      });
      expect(textGenRes.statusCode).toBe(200);
      expect(capturedContexts.length).toBe(1);
      expect(capturedContexts[0].systemPrompt).toBeUndefined();
      expect(capturedContexts[0].maxTokens).toBeUndefined();

      const voiceRes = await app.inject({
        method: 'POST',
        url: `/api/v1/conversations/${CONV_ID}/stream`,
        headers,
        payload: {
          content: 'What does Quantum Weave do?',
          idempotency_key: 'voice-turn-1',
          voice_mode: true
        }
      });
      expect(voiceRes.statusCode).toBe(200);
      expect(voiceRes.body).not.toContain('https://linktr.ee');
      expect(capturedContexts.length).toBe(2);
      expect(capturedContexts[1].systemPrompt).toContain('QUANTUM WEAVE AI BUSINESS SOLUTIONS CONSULTANT');
      expect(capturedContexts[1].maxTokens).toBe(210);
    } finally {
      await app.close();
    }
  });
});
