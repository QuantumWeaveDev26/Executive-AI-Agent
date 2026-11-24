/**
 * Lightweight Business-Intent Classifier and Token Optimizer for Thaara Chat.
 *
 * Evaluates inbound user messages before model gateway invocation:
 * - Immediately returns deterministic, token-free business redirections for unrelated questions.
 * - Recognizes technology queries (Python, AI) and frames them for business automation.
 * - Identifies valid business requests, document questions, and marketing queries.
 * - Supports English, Kannada, and Hindi inquiries.
 */

import {
  findRelevantServices,
  QUANTUM_WEAVE_COMPANY_INFO,
  STANDARD_SERVICES_LIST
} from './quantum-weave-knowledge.js';

export type ClassificationType =
  | 'unrelated_out_of_scope'
  | 'company_overview'
  | 'services_directory'
  | 'technology_query'
  | 'business_inquiry'
  | 'document_analysis'
  | 'governed_action';

export interface ClassificationResult {
  type: ClassificationType;
  deterministic: boolean;
  replyText?: string;
  relevantServices?: Array<{ name: string; url: string }>;
  suggestedKnowledgeSnippet?: string;
}

// Common patterns for unrelated questions
const UNRELATED_PATTERNS = [
  // General trivia & geography
  /\b(?:capital of|currency of|population of|president of|prime minister of|who is the king of)\b/i,
  /\b(?:weather in|temperature in|forecast for|is it raining in)\b/i,
  /\b(?:how far is|distance between|tallest mountain|longest river)\b/i,

  // Entertainment, sports, jokes
  /\b(?:tell me a joke|make me laugh|tell a joke|crack a joke)\b/i,
  /\b(?:cricket match|football match|who won|world cup|score of|ipl)\b/i,
  /\b(?:movie recommendation|latest movie|song lyrics|sing a song)\b/i,
  /\b(?:horoscope|zodiac|astrology|tarot)\b/i,

  // Recipes, cooking, casual non-business chat
  /\b(?:recipe for|how to cook|bake a cake|make coffee)\b/i,
  /\b(?:what are you wearing|do you have a boyfriend|are you human|marry me)\b/i
];

// Technology queries that should be connected to business
const TECH_PATTERNS = [
  /\b(?:what is python|explain python|learn python)\b/i,
  /\b(?:what is javascript|what is typescript|what is react|what is node)\b/i,
  /\b(?:what is artificial intelligence|what is machine learning|what is deep learning|what is llm)\b/i
];

// Company overview & services queries
const COMPANY_QUERY_PATTERNS = [
  /\b(?:what is quantum weave|about quantum weave|who is quantum weave|what does quantum weave do)\b/i,
  /\b(?:who founded|who are the founders|kaaranji|vishak)\b/i
];

const SERVICES_QUERY_PATTERNS = [
  /\b(?:what services? do you (?:provide|offer|have)|list your services|what are your services|all services)\b/i,
  /\b(?:what service do u produce|tell me your services|services list)\b/i
];

export class ChatBusinessClassifier {
  /**
   * Classifies user message intent and returns either a deterministic response or context for the AI model.
   */
  static classify(userMessage: string, hasAttachments = false): ClassificationResult {
    const text = userMessage.trim();
    const lower = text.toLowerCase();

    // 1. If files are attached, it is a document analysis inquiry
    if (hasAttachments) {
      return {
        type: 'document_analysis',
        deterministic: false
      };
    }

    // 2. Check for company services list inquiry
    for (const pattern of SERVICES_QUERY_PATTERNS) {
      if (pattern.test(lower)) {
        const reply = [
          'Sure! Here are our verified services:',
          ...STANDARD_SERVICES_LIST,
          '',
          `Explore our complete services and website directory:`,
          QUANTUM_WEAVE_COMPANY_INFO.linktreeUrl,
          '',
          'Which service would you like to explore for your business?'
        ].join('\n');

        return {
          type: 'services_directory',
          deterministic: true,
          replyText: reply
        };
      }
    }

    // 3. Check for specific company founder question
    if (/\b(?:who founded|who are the founders|who started)\b/i.test(lower) && /\b(?:quantum weave|company|agency)\b/i.test(lower)) {
      return {
        type: 'company_overview',
        deterministic: true,
        replyText: `Quantum Weave AI was co-founded by ${QUANTUM_WEAVE_COMPANY_INFO.founders}. We help businesses grow using AI, digital marketing, and automation. How can we assist your business today?`
      };
    }

    // 4. Check for company overview inquiry
    for (const pattern of COMPANY_QUERY_PATTERNS) {
      if (pattern.test(lower)) {
        const reply = `${QUANTUM_WEAVE_COMPANY_INFO.name} helps businesses grow using AI, digital marketing, and automation to streamline everyday operations. Explore our verified services and websites at ${QUANTUM_WEAVE_COMPANY_INFO.linktreeUrl}. What kind of business do you run?`;
        return {
          type: 'company_overview',
          deterministic: true,
          replyText: reply
        };
      }
    }

    // 5. Check for Technology explanation queries
    for (const pattern of TECH_PATTERNS) {
      if (pattern.test(lower)) {
        if (/python/i.test(lower)) {
          return {
            type: 'technology_query',
            deterministic: true,
            replyText: `Python is a powerful programming language widely used in AI, data analysis, and automation. Quantum Weave AI leverages modern AI frameworks to build robust automation solutions for growing businesses. Would you like to explore how automation can help your operations?`
          };
        }
        if (/artificial intelligence|machine learning|llm/i.test(lower)) {
          return {
            type: 'technology_query',
            deterministic: true,
            replyText: `Artificial Intelligence enables software systems to analyze information, automate workflows, and communicate naturally with customers. At Quantum Weave AI, we apply practical AI to digital marketing, custom assistants, and business processes. How are you looking to use AI in your business?`
          };
        }
      }
    }

    // 6. Check for clearly unrelated out-of-scope questions (Trivia, Weather, Sports, Jokes, etc.)
    for (const pattern of UNRELATED_PATTERNS) {
      if (pattern.test(lower)) {
        // Formulate a polite, concise (1-3 sentences, 40-80 words) business redirection
        let redirection = `I focus on Quantum Weave AI's business, marketing, and automation solutions.`;

        if (/capital of|country|city|currency/i.test(lower)) {
          redirection = `I mainly assist with Quantum Weave AI's business services. If you are looking to expand your business or target customers in specific markets, we can help design effective digital marketing and customer acquisition campaigns.`;
        } else if (/joke|laugh/i.test(lower)) {
          redirection = `I'm here to help with business growth and AI solutions. Would you like to explore how AI can make your customer communication more engaging and responsive?`;
        } else if (/weather|temperature|rain/i.test(lower)) {
          redirection = `I focus on business solutions rather than weather updates. If seasonal trends or weather patterns influence your retail or service demand, we can help plan automated marketing campaigns to match customer interest.`;
        } else if (/cricket|football|match|score|won/i.test(lower)) {
          redirection = `I focus on Quantum Weave's business solutions rather than sports updates. If you are interested in sports-related marketing, creator content, or event automation, I would be glad to help explore possibilities.`;
        } else {
          redirection = `I am Quantum Weave AI's business assistant, focused on helping companies with digital marketing, creative AI content, and automation. How can we support your business goals?`;
        }

        return {
          type: 'unrelated_out_of_scope',
          deterministic: true,
          replyText: redirection
        };
      }
    }

    // 7. Legitimate business inquiries -> Retrieve relevant knowledge and let the model generate rich response
    const relevantServices = findRelevantServices(text);
    return {
      type: 'business_inquiry',
      deterministic: false,
      relevantServices: relevantServices.map((s) => ({ name: s.name, url: s.verifiedUrl }))
    };
  }
}
