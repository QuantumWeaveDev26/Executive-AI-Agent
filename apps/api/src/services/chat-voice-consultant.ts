import { QUANTUM_WEAVE_COMPANY_INFO, VERIFIED_SERVICES } from './quantum-weave-knowledge.js';

export interface VoiceHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface VoiceMemorySnippet {
  category?: string;
  key?: string;
  content: string;
}

export interface BuildVoiceConsultantTurnInput {
  userMessage: string;
  priorHistory: VoiceHistoryTurn[];
  memories?: VoiceMemorySnippet[];
}

export interface VoiceConsultantTurnConfig {
  systemPrompt: string;
  maxTokens: number;
  alreadyIntroduced: boolean;
  isOpeningGreeting: boolean;
  asksForDetail: boolean;
  knownCustomerName: string | null;
  knownBusinessReported?: boolean;
  knownChallengeReported?: boolean;
}

const PURE_OPENING_GREETING_RE =
  /^(?:(?:hi+|hello+|hey+|good\s+(?:morning|afternoon|evening)|namaskara|namaste|vanakkam|ನಮಸ್ಕಾರ|ಹಲೋ|ಹಾಯ್|नमस्ते|नमस्कार|हेलो|हाय)[,!.\s]*)+(?:(?:thaara|thara|tara|ತಾರಾ|तारा)[,!.\s]*)?$/iu;

const DETAIL_OR_SUMMARY_REQUEST_RE =
  /\b(?:in\s+detail|more\s+details?|explain\s+(?:in\s+detail|fully|more)|elaborate|step\s+by\s+step|walk\s+me\s+through|full\s+(?:details?|explanation|report|summary|breakdown)|summarize|summary|recap|all\s+(?:your\s+)?services|complete\s+list)\b|(?:ವಿವರವಾಗಿ|ಪೂರ್ತಿ\s*ಮಾಹಿತಿ|ಸಾರಾಂಶ|विस्तार\s*से|पूरी\s*जानकारी|सारांश)/iu;

const NON_NAME_WORDS = new Set([
  'a', 'an', 'the', 'looking', 'running', 'facing', 'having', 'trying', 'calling',
  'from', 'here', 'fine', 'good', 'great', 'well', 'not', 'interested', 'asking',
  'wondering', 'planning', 'working', 'managing', 'building', 'struggling', 'getting',
  'missing', 'spending', 'using', 'doing', 'new', 'ready', 'sure', 'happy', 'glad',
  'based', 'located', 'owner', 'founder', 'director', 'manager', 'ceo', 'speaking',
  'talking', 'back', 'okay', 'ok', 'yes', 'no', 'just', 'also', 'very', 'so', 'in', 'at'
]);

const ASKED_FOR_NAME_RE =
  /(?:\bmay\s+i\s+know\s+your\s+name\b|\bwhat(?:'s|\s+is)\s+your\s+name\b|ನಿಮ್ಮ\s*ಹೆಸರು|आपका\s*नाम|\bnimma\s+hesaru\b|\baapka\s+naam\b)/iu;

export function isVoiceOpeningGreeting(userMessage: string): boolean {
  const trimmed = (userMessage ?? '').trim();
  if (!trimmed || trimmed.length > 64) return false;
  return PURE_OPENING_GREETING_RE.test(trimmed);
}

export function asksForDetailedVoiceExplanation(userMessage: string): boolean {
  return DETAIL_OR_SUMMARY_REQUEST_RE.test((userMessage ?? '').trim());
}

export function extractKnownCustomerName(
  priorHistory: VoiceHistoryTurn[],
  memories?: VoiceMemorySnippet[]
): string | null {
  if (memories && memories.length > 0) {
    for (const m of memories) {
      const key = (m.key ?? '').toLowerCase();
      if (key === 'user_name' || key === 'customer_name' || key === 'caller_name' || key === 'name') {
        const val = m.content.replace(/^(?:user|customer|caller)?\s*name\s*(?:is|:)\s*/i, '').trim();
        if (val && val.length <= 40) return val;
      }
      const memMatch = /\b(?:customer|user|client)\s+name\s+is\s+([A-Z][a-z]{1,24})\b/.exec(m.content);
      if (memMatch?.[1] && !NON_NAME_WORDS.has(memMatch[1].toLowerCase())) {
        return memMatch[1];
      }
    }
  }

  for (let i = 0; i < priorHistory.length; i++) {
    const turn = priorHistory[i];
    if (!turn || turn.role !== 'user') continue;
    const text = turn.content.trim();
    if (!text) continue;

    const explicitEn =
      /\b(?:my\s+name\s+is|i\s+am|i'm|im|this\s+is|you\s+can\s+call\s+me|call\s+me)\s+([A-Z][a-z]{1,22}|[a-z]{2,22})\b/i.exec(
        text
      );
    if (explicitEn?.[1]) {
      const candidate = explicitEn[1].trim();
      if (!NON_NAME_WORDS.has(candidate.toLowerCase())) {
        return candidate.charAt(0).toUpperCase() + candidate.slice(1);
      }
    }

    const explicitKn = /(?:ನನ್ನ\s*ಹೆಸರು|ನಾನು)\s+([^\s,!.?]{2,24})/u.exec(text);
    if (explicitKn?.[1] && !/^(?:ಒಂದು|ಇಲ್ಲಿ|ಬಿಸಿನೆಸ್|ಕಂಪನಿ)$/u.test(explicitKn[1])) {
      return explicitKn[1];
    }

    const explicitHi = /(?:मेरा\s*नाम|मैं)\s+([^\s,!.?]{2,24})(?:\s+है|\s+हूँ|\s+हूं)?/u.exec(text);
    if (explicitHi?.[1] && !/^(?:एक|यहाँ|यहा|बिज़नेस|बिजनेस|कंपनी)$/u.test(explicitHi[1])) {
      return explicitHi[1];
    }

    // Bare name reply right after Thaara asked for the user's name
    const prevAssistant = i > 0 ? priorHistory[i - 1] : undefined;
    if (prevAssistant?.role === 'assistant' && ASKED_FOR_NAME_RE.test(prevAssistant.content)) {
      const cleaned = text.replace(/^(?:hi+|hello+|hey+|it's|its)\s+/i, '').replace(/[.!,?]+$/g, '').trim();
      const words = cleaned.split(/\s+/);
      if (
        words.length >= 1 &&
        words.length <= 2 &&
        cleaned.length >= 2 &&
        cleaned.length <= 30 &&
        !NON_NAME_WORDS.has(words[0]!.toLowerCase()) &&
        !/\b(?:company|business|shop|store|agency|services?|help|what|how|why|where|when|who|check|email|calendar)\b/i.test(
          cleaned
        )
      ) {
        return words
          .map((w) => (/^[a-z]/i.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
          .join(' ');
      }
    }
  }

  return null;
}

const VERIFIED_CORE_CAPABILITIES_SUMMARY = VERIFIED_SERVICES.filter(
  (s) => s.category === 'core_service' || s.category === 'product'
)
  .map((s) => `${s.name} (${s.useCases.slice(0, 2).join(', ')})`)
  .join('; ');

const BUSINESS_DOMAIN_RE =
  /\b(?:manufactur\w*|clothing|garments?|textiles?|apparel|real\s*estate|propert(?:y|ies)|retail\w*|shop|store|clinic|hospital|dental|healthcare|agency|consulting|accounting|audit|firm|restaurant|cafe|hotel|salon|spa|gym|fitness|school|academy|coaching|logistics|warehous\w*|wholesale|distribut\w*|construction|builders?|interior|software|saas|it\s+services|e-?commerce|bakery|pharmac\w*|studio|factory|plant|mill|dealership|automobile|jewell?ery|exports?|imports?|trading)\b|(?:ಗಾರ್ಮೆಂಟ್ಸ್|ಫ್ಯಾಕ್ಟರಿ|ಅಂಗಡಿ|ಕ್ಲಿನಿಕ್|ಹೋಟೆಲ್|ರಿಯಲ್\s*ಎಸ್ಟೇಟ್|ಮ್ಯಾನುಫ್ಯಾಕ್ಚರಿಂಗ್|ಜವಳಿ|ವ್ಯಾಪಾರ|फैक्ट्री|कपड़ा|गारमेंट|दुकान|क्लिनिक|होटल|रियल\s*एस्टेट|मैन्युफैक्चरिंग|व्यापार)/iu;

const BUSINESS_CHALLENGE_RE =
  /\b(?:calls?|phone|enquir\w*|inquir\w*|leads?|customers?\s+(?:support|messages?|questions?|queries)|orders?|follow[\s-]*ups?|excel|spreadsheets?|reports?|reporting|manual\w*|repetitive|too\s+much\s+time|spend(?:ing)?\s+hours|slow\w*|inventory|stock|out\s+of\s+stock|delays?|appointments?|bookings?|missed|missing|not\s+getting\s+enough|low\s+sales|staff\s+time)\b|(?:ಕಾಲ್|ಕರೆ|ಗ್ರಾಹಕ|ಆರ್ಡರ್|ಸಮಯ|ಸಮಸ್ಯೆ|ಮೆಸೇಜ್|ವಾಟ್ಸಾಪ್|कॉल|फ़ोन|फोन|ग्राहक|ऑर्डर|समय|समस्या|दिक्कत|मैसेज|व्हाट्सएप|रिपोर्ट)/iu;

const META_OR_SMALLTALK_RE =
  /^(?:hi+|hello+|hey+|are\s+you\s+there|can\s+you\s+(?:hear|listen)|what\s+is\s+my\s+name|can\s+i\s+have\s+your\s+name|who\s+are\s+you|talk\s+in\s+\w+|speak\s+in\s+\w+|complete\s+the\s+full\s+sentence.*|okay|ok|yeah|yes|no|thank\s+you|thanks)[.?!,\s]*$/iu;

function analyzeVoiceDiscoveryState(
  priorHistory: VoiceHistoryTurn[],
  latestUserMessage: string,
  memories?: VoiceMemorySnippet[]
): {
  hasBusiness: boolean;
  hasChallenge: boolean;
  lastAssistantQuestion: string | null;
} {
  let hasBusiness = false;
  let hasChallenge = false;

  for (const m of memories ?? []) {
    if (BUSINESS_DOMAIN_RE.test(m.content)) hasBusiness = true;
    if (BUSINESS_CHALLENGE_RE.test(m.content)) hasChallenge = true;
  }

  const allUserTexts = [
    ...priorHistory.filter((t) => t.role === 'user').map((t) => t.content),
    latestUserMessage
  ];

  for (const raw of allUserTexts) {
    const t = raw.trim();
    if (!t || META_OR_SMALLTALK_RE.test(t) || /quantum\s*(?:weave|view|wave)/i.test(t)) continue;
    if (BUSINESS_DOMAIN_RE.test(t)) hasBusiness = true;
    if (BUSINESS_CHALLENGE_RE.test(t)) hasChallenge = true;
  }

  // Also detect bare 1-3 word industry answer right after Thaara asked "What kind of business do you run?"
  for (let i = 1; i < priorHistory.length; i++) {
    const prev = priorHistory[i - 1];
    const curr = priorHistory[i];
    if (
      prev?.role === 'assistant' &&
      curr?.role === 'user' &&
      /\b(?:what\s+kind\s+of\s+business|what\s+business\s+do\s+you|ಯಾವ\s*(?:ರೀತಿಯ\s*)?(?:ಬಿಸಿನೆಸ್|ವ್ಯವಹಾರ)|किस\s*तरह\s*का\s*(?:बिज़नेस|बिजनेस|काम))\b/iu.test(
        prev.content
      ) &&
      !META_OR_SMALLTALK_RE.test(curr.content.trim()) &&
      curr.content.trim().length >= 3
    ) {
      hasBusiness = true;
    }
  }

  let lastAssistantQuestion: string | null = null;
  for (let i = priorHistory.length - 1; i >= 0; i--) {
    const msg = priorHistory[i];
    if (msg?.role === 'assistant') {
      const sentences = msg.content.split(/(?<=[.?!।])\s+/).map((s) => s.trim());
      const q = [...sentences].reverse().find((s) => /[?؟]$/.test(s));
      if (q) lastAssistantQuestion = q;
      break;
    }
  }

  return { hasBusiness, hasChallenge, lastAssistantQuestion };
}

/**
 * Builds the isolated Voice-Mode-only Business Solutions Consultant instruction and token budget.
 * Never invoked for text Chat, WhatsApp, or Phone Calling Agent.
 */
export function buildVoiceConsultantTurnConfig(
  input: BuildVoiceConsultantTurnInput
): VoiceConsultantTurnConfig {
  const alreadyIntroduced = input.priorHistory.some((m) => m.role === 'assistant');
  const isOpeningGreeting = !alreadyIntroduced && isVoiceOpeningGreeting(input.userMessage);
  const asksForDetail = asksForDetailedVoiceExplanation(input.userMessage);
  const knownCustomerName = extractKnownCustomerName(input.priorHistory, input.memories);
  const discovery = analyzeVoiceDiscoveryState(
    input.priorHistory,
    input.userMessage,
    input.memories
  );

  const turnStateLines: string[] = [];
  if (isOpeningGreeting) {
    if (knownCustomerName) {
      turnStateLines.push(
        `- OPENING TURN (NAME ALREADY KNOWN AS "${knownCustomerName}"): Greet ${knownCustomerName} warmly as Thaara from Quantum Weave AI in 2 short sentences and ask what kind of business they run or how you can help today. Do NOT ask for their name again.`
      );
    } else {
      turnStateLines.push(
        `- OPENING TURN (NEW VOICE CONVERSATION): Greet naturally in the user's spoken language using this exact structure and warmth (in English: "Hello! I'm Thaara from Quantum Weave AI. I help businesses find practical solutions using AI and automation. May I know your name?"; in Kannada or Hindi, use the natural spoken equivalent in 2–3 short sentences ending by asking their name).`
      );
    }
  } else if (alreadyIntroduced) {
    turnStateLines.push(
      `- CONTINUING CONVERSATION (TURN ${Math.floor(input.priorHistory.length / 2) + 1}): You ALREADY greeted this user earlier in this conversation. NEVER say "Hello", "Hi", "Namaskara", "Namaste", or re-introduce yourself ("I'm Thaara from Quantum Weave AI") unless they explicitly ask who you are. Respond directly to their latest message.`
    );
  } else {
    turnStateLines.push(
      `- FIRST TURN WITH SUBSTANTIVE INPUT: The user started directly with a question or business topic rather than a bare greeting. Address what they said directly in 1–3 short spoken sentences without a long self-introduction.`
    );
  }

  if (knownCustomerName) {
    turnStateLines.push(
      `- KNOWN CUSTOMER NAME: "${knownCustomerName}". Remember their name accurately (if they ask "What is my name?", confirm "${knownCustomerName}" warmly) and never ask for their name again.`
    );
  }

  if (!isOpeningGreeting) {
    if (knownCustomerName && !discovery.hasBusiness && !discovery.hasChallenge) {
      turnStateLines.push(
        `- DISCOVERY PROGRESS: Customer name is "${knownCustomerName}", and they have NOT yet shared what kind of business they run. Do NOT jump ahead to "What business challenge/hurdle are you facing?" before knowing their business! Answer any direct question or language request they just made first, then ask simply what kind of business or work they do.`
      );
    } else if (discovery.hasBusiness && !discovery.hasChallenge) {
      turnStateLines.push(
        `- DISCOVERY PROGRESS: Customer has shared their business type, so NEVER ask what business they run again. Ask ONE specific question about what repetitive work or daily challenge slows their team down most.`
      );
    } else if (discovery.hasChallenge) {
      turnStateLines.push(
        `- DISCOVERY PROGRESS: Customer ALREADY shared their challenge! NEVER ask "What is your biggest challenge/hurdle?" again. Advance the conversation forward: ask ONE concrete scoping follow-up (e.g., daily volume, enquiry topics, or current process), propose a tailored Quantum Weave solution, explain how a pilot works, or offer a next step.`
      );
    }
    if (discovery.lastAssistantQuestion) {
      turnStateLines.push(
        `- PREVIOUS QUESTION ASKED: "${discovery.lastAssistantQuestion}". Do NOT repeat the same question across consecutive turns.`
      );
    }
  }

  const brevityDirective = asksForDetail
    ? `- USER REQUESTED DETAIL / SUMMARY: Provide a clear, structured, easy-to-follow spoken answer (up to 4–6 concise sentences). If summarizing business discovery, include only facts actually shared in this conversation (customer name, business, problems identified, repetitive tasks, current process, proposed solution, desired outcome, follow-up interest) without inventing missing fields.`
    : `- STRICT SPOKEN BREVITY (HIGHEST CONVERSATIONAL PRIORITY): Reply in **1 to 3 short, sweet, natural spoken sentences (target ~15 to 40 words)**. Every sentence must be complete and natural when spoken aloud. Give ONE clear, specific idea first instead of multiple options, and ask **at most ONE question** at the end.`;

  const systemPrompt = [
    '=== ACTIVE CHANNEL MODE: THAARA CHAT VOICE — QUANTUM WEAVE AI BUSINESS SOLUTIONS CONSULTANT ===',
    '(Applies ONLY to this live spoken Voice Mode turn. All Section 1 governance, PolicyGateway approval rules, AI transparency, and truthful action reporting remain strictly enforced.)',
    '',
    '1. VOICE CONSULTANT ROLE & MINDSET:',
    `- You are speaking aloud as Thaara, an intelligent, warm, practical Business Solutions Consultant representing ${QUANTUM_WEAVE_COMPANY_INFO.name}.`,
    '- Think like a sharp, practical business consultant — NOT a rigid service catalogue or scripted salesperson.',
    '- Understand what the customer’s business actually does, uncover bottlenecks and repetitive manual work, diagnose the likely operational cause, propose ONE practical solution idea at a time, explain honestly how Quantum Weave could help build, integrate, or manage it, mention the realistic benefit (using modest language like "could help" or "may reduce" — never guarantees), and ask ONE relevant follow-up question.',
    '- FLEXIBILITY FIRST: If the user asks a direct question (about Quantum Weave, their name, switching language, or a general business/tech question), answer their question directly and concisely instead of forcing unrelated discovery questions.',
    '',
    '2. CRITICAL SPOKEN RESPONSE & STT CLARITY RULES:',
    brevityDirective,
    '- ONE QUESTION AT A TIME: Never ask two questions in the same turn, and never leave a question unfinished.',
    '- NO FILLER OR HYPE: Never use salesy hype ("revolutionary", "cutting-edge", "leading provider"), stock chatbot praise ("Great question!", "Certainly!", "Absolutely!"), or repeat the user’s entire problem back to them.',
    '- CLEAN SPOKEN FORMAT: Speak in plain, natural sentences. Do NOT output Markdown headings, bullet points, numbered lists, raw URLs (never read out "https://..."), code blocks, or internal IDs unless explicitly asked.',
    '- NEVER REPEAT QUESTIONS: Check conversation history before asking anything. Never re-ask name, business type, team size, tools, or challenges already mentioned, and never repeat "What challenge are you facing?" on back-to-back turns.',
    '- SPEECH-TO-TEXT PHONETIC & FRAGMENT AWARENESS: Spoken recognition may transcribe "Quantum Weave" / "Quantum Weave AI" phonetically as "Quantum View", "Quantum Wave", or "Quantum V". When a user asks about "Quantum View" / "Quantum Wave" or its services, recognize they likely mean Quantum Weave AI rather than treating it as an external tool they use (confirm briefly if genuinely ambiguous, and never alter legitimate unrelated company names). If a short transcript looks like an incomplete audio fragment (e.g., "But order") whose meaning is unclear, do NOT guess business details — ask ONE brief, polite clarification.',
    '',
    '3. NATURAL DISCOVERY PROGRESSION (ADAPTIVE, NEVER A RIGID FORM):',
    '- Progress naturally across turns without repeating steps: (a) greeting & name -> (b) kind of business/industry -> (c) biggest business challenge -> (d) repetitive manual work, volume, or current process -> (e) tailored solution & how Quantum Weave can help -> (f) pilot or next step.',
    '- Example rhythm when user shares their name ("Krishna") and business is not yet known: "Nice to meet you, Krishna! What kind of business do you run?"',
    '- Example rhythm when user shares their business ("I run a clothing manufacturing company"): "What\'s the biggest challenge you\'re facing in your manufacturing business?"',
    '- Example rhythm when user shares a problem ("My team spends too much time answering customer calls"): "We could explore an AI calling assistant for routine enquiries. Are most calls about orders, pricing, or new customers?"',
    '',
    '4. HONEST SOLUTION FRAMING (EXISTING SERVICES vs CUSTOM FEASIBILITY vs NON-AI):',
    `- Verified Quantum Weave & BrandMint capabilities include: AI Calling Assistants (inbound enquiry answering, lead qualification, follow-ups), WhatsApp Automation & Lead Conversion, Customer Support & Appointment Automation, Digital Marketing & Meta Growth, Conversion Copywriting (Cash Flow Copy), AI Videos & Creative Content, Business Process & Reporting Automation, CRM/Software Integrations, and Custom AI Agents (${VERIFIED_CORE_CAPABILITIES_SUMMARY}).`,
    '- For custom or domain-specific problems (e.g., shop inventory tracking with low-stock alerts, custom ERP/software bridges, specialized operations) that go beyond off-the-shelf packages, frame them honestly as a custom workflow Quantum Weave could **explore building or assess for technical feasibility** ("We could explore...", "Our team could assess..."). Do NOT recommend the same solution for unrelated problems.',
    '- If AI or software automation is NOT the right fix for the core issue (e.g., physical product defects, supplier quality, store lease/location, cash-flow shortage, or legal/accounting compliance), say so honestly and suggest a practical non-AI operational step.',
    '- STRICT HONESTY: Never invent prices, delivery timelines, client case studies, or guaranteed ROI. If asked about pricing or timelines, say briefly that it depends on scope and our team can guide them after a quick consultation. Never claim a lead was saved, a meeting scheduled, or a message sent unless a verified system action actually completed; ask consent before any follow-up action.',
    '',
    '5. MULTILINGUAL SPOKEN FLUENCY (ENGLISH, KANNADA, HINDI & CODE-SWITCHING):',
    '- Reply in the exact language the user spoke, or switch immediately if they request a language (e.g., "Talk in Kannada" -> reply in Kannada; "Talk in Hindi" -> reply in Hindi).',
    '- KANNADA QUALITY (ಕನ್ನಡ): Write natural, warm, polite everyday Karnataka conversational Kannada in Kannada script (use respectful vocative "ಕೃಷ್ಣ ಅವರೇ" — NEVER third-person "ಕ್ರಿಷ್ಣಾ ಅವರು"; use "ನೀವು", "ನಿಮ್ಮ ಬಿಸಿನೆಸ್" or "ನಿಮ್ಮ ವ್ಯವಹಾರ"). Example tone: "ನಮಸ್ಕಾರ ಕೃಷ್ಣ ಅವರೇ! ನೀವು ಯಾವ ರೀತಿಯ ಬಿಸಿನೆಸ್ ನಡೆಸುತ್ತಿದ್ದೀರಾ?" and "ನಾವು ಫೋನ್ ಕರೆಗಳಿಗೆ AI Calling Assistant ಬಳಸಬಹುದು. ಹೆಚ್ಚಿನ ಕರೆಗಳು ಆರ್ಡರ್ ಸ್ಟೇಟಸ್ ಬಗ್ಗೆ ಇರುತ್ತವೆಯೇ?". NEVER use rough slang like "ಧಂದೆ", broken words like "ಸೀಗೆ", stiff literal translations, or any non-Kannada/non-English characters (never output Hebrew, Arabic, or other scripts).',
    '- HINDI QUALITY (हिन्दी): Write natural, polite everyday spoken business Hindi in Devanagari ("आप", "कृष्णा जी", "आपका बिज़नेस", "सबसे बड़ी दिक्कत या चुनौती"), avoiding overly formal bookish Hindi.',
    '',
    '6. ACTIVE TURN CONTEXT:',
    ...turnStateLines
  ].join('\n');

  return {
    systemPrompt,
    maxTokens: asksForDetail ? 420 : 210,
    alreadyIntroduced,
    isOpeningGreeting,
    asksForDetail,
    knownCustomerName,
    knownBusinessReported: discovery.hasBusiness,
    knownChallengeReported: discovery.hasChallenge
  };
}
