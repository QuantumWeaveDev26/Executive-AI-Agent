/**
 * Verified Quantum Weave AI Company Knowledge Directory.
 *
 * Source of truth: https://linktr.ee/team.quantumweaveai
 * Primary Identity: Quantum Weave AI helps businesses grow using AI, digital marketing and automation.
 * Related Brand: BrandMint AI
 * STRICT PRICING RULE: Never disclose or invent pricing; always guide to team consultation.
 */

export interface VerifiedCompanyService {
  id: string;
  name: string;
  category: 'core_service' | 'education' | 'product' | 'consultation';
  verifiedUrl: string;
  description: string;
  useCases: string[];
  keywords: string[];
  verifiedDate: string;
}

export const QUANTUM_WEAVE_COMPANY_INFO = {
  name: 'Quantum Weave AI',
  relatedBrand: 'BrandMint AI',
  tagline: 'Intelligent business growth using AI, digital marketing and business automation.',
  overview: 'Quantum Weave AI helps businesses grow using AI, digital marketing, and automation to streamline operations and enhance customer communication.',
  founders: 'Kaaranji Shreedhar and Vishak B',
  founderNotice: 'Only mention founders if the user explicitly asks who founded the company. Never mention founders in standard introductions.',
  linktreeUrl: 'https://linktr.ee/team.quantumweaveai',
  supportContact: 'WhatsApp +91 99729 65677',
  calendlyUrl: 'https://calendly.com/team-brandmint/30min',
  pricingGuideline: 'Our team can understand your requirements and guide you on the next steps.'
} as const;

export const VERIFIED_SERVICES: readonly VerifiedCompanyService[] = [
  {
    id: 'digital-marketing',
    name: 'Digital Marketing & Social Media Management',
    category: 'core_service',
    verifiedUrl: 'https://brandmintai.io/meta-growth',
    description: 'Targeted social media growth, lead acquisition, and Meta advertising campaigns tailored for modern businesses.',
    useCases: ['Social media management', 'Meta ads and customer acquisition', 'Brand awareness', 'Growth marketing'],
    keywords: ['digital marketing', 'social media', 'meta', 'ads', 'marketing', 'growth', 'advertising', 'facebook', 'instagram'],
    verifiedDate: '2026-11-11'
  },
  {
    id: 'cash-flow-copy',
    name: 'Cash Flow Copy System',
    category: 'core_service',
    verifiedUrl: 'https://cashflowcopy.in',
    description: 'AI-assisted high-converting copywriting, persuasive sales messaging, and customer conversion frameworks.',
    useCases: ['Sales copy', 'Email campaigns', 'Landing page copy', 'Conversion messaging'],
    keywords: ['copywriting', 'copy', 'cash flow copy', 'messaging', 'sales letters', 'conversion copy'],
    verifiedDate: '2026-11-11'
  },
  {
    id: 'whatsapp-automation',
    name: 'WhatsApp Automation & Lead Conversion',
    category: 'core_service',
    verifiedUrl: 'https://brandmintai.io/freemium',
    description: 'Automated 24/7 WhatsApp business replies, customer enquiry handling, appointment booking, and CRM synchronization.',
    useCases: ['24/7 customer support', 'Automated enquiry handling', 'Lead capture on WhatsApp', 'After-hours messaging'],
    keywords: ['whatsapp', 'whatsapp automation', 'chat automation', 'meta whatsapp', 'enquiries', 'auto reply', 'customer support'],
    verifiedDate: '2026-11-11'
  },
  {
    id: 'ai-videos-creatives',
    name: 'AI Videos & Creative Content Production',
    category: 'core_service',
    verifiedUrl: 'https://filmsuccess.in',
    description: 'Professional AI-generated video production, cinematic commercial assets, and engaging digital creative content.',
    useCases: ['Promotional videos', 'AI product showcases', 'Social media reels', 'Cinematic marketing content'],
    keywords: ['ai videos', 'video production', 'creative content', 'filmmaking', 'commercials', 'reels', 'filmsuccess'],
    verifiedDate: '2026-11-11'
  },
  {
    id: 'ai-filmmaking-tech',
    name: 'AI Filmmaking Mastery',
    category: 'education',
    verifiedUrl: 'https://aifilmmaking.tech',
    description: 'Comprehensive education and technical mastery in modern AI-assisted filmmaking and visual production.',
    useCases: ['AI filmmaking training', 'Prompt-to-video production', 'Visual storytelling skills'],
    keywords: ['ai filmmaking', 'filmmaking course', 'video generation course', 'visual effects ai'],
    verifiedDate: '2026-11-11'
  },
  {
    id: 'appu-ai',
    name: 'Appu — AI Learning Companion',
    category: 'product',
    verifiedUrl: 'https://appuai.online',
    description: 'Interactive AI-powered learning companion designed for guided education and natural conversational assistance.',
    useCases: ['Personalized AI tutoring', 'Interactive learning companion', 'Educational guidance'],
    keywords: ['appu', 'appu ai', 'learning companion', 'tutoring', 'ai education companion'],
    verifiedDate: '2026-11-11'
  },
  {
    id: 'igr-academy',
    name: 'IGr — InstaSkills GameChanger',
    category: 'education',
    verifiedUrl: 'https://igr.academy',
    description: 'AI-powered CBSE personalized curriculum learning and academic skill advancement for students.',
    useCases: ['CBSE personalized learning', 'Student academic growth', 'AI educational tools'],
    keywords: ['igr', 'instaskills gamechanger', 'cbse', 'personalized learning', 'school curriculum'],
    verifiedDate: '2026-11-11'
  },
  {
    id: 'full-ai',
    name: '100-Day AI Full-Stack Developer Program',
    category: 'education',
    verifiedUrl: 'https://fullai.in',
    description: 'Intensive 100-day hands-on training program transforming learners into full-stack AI and software developers.',
    useCases: ['Full-stack software engineering', 'AI application development', 'Career transformation'],
    keywords: ['fullai', 'full stack developer', '100 day developer', 'coding bootcamp', 'ai engineering'],
    verifiedDate: '2026-11-11'
  },
  {
    id: 'instaskills-academy',
    name: '100-Day AI-Powered Marketing Education',
    category: 'education',
    verifiedUrl: 'https://instaskills.academy',
    description: '100-day intensive career curriculum in AI-driven digital marketing, performance advertising, and growth strategy.',
    useCases: ['Professional digital marketing skills', 'AI marketing tools mastery', 'Career training'],
    keywords: ['instaskills', 'marketing education', '100 day marketing', 'digital marketing training'],
    verifiedDate: '2026-11-11'
  },
  {
    id: 'hybrid-ai',
    name: 'AI Campus',
    category: 'education',
    verifiedUrl: 'https://hybridai.in',
    description: 'Next-generation AI learning, campus skill advancement, and emerging technology training platform.',
    useCases: ['Campus AI education', 'Emerging tech skilling', 'Student AI programs'],
    keywords: ['hybridai', 'ai campus', 'campus learning', 'ai skills platform'],
    verifiedDate: '2026-11-11'
  }
];

export const STANDARD_SERVICES_LIST = [
  '1. Digital Marketing',
  '2. AI Videos & Creative Content',
  '3. WhatsApp Automation',
  '4. AI Agents & Assistants',
  '5. AI Integration',
  '6. Business Automation'
];

/**
 * Retrieves relevant company services matching user queries.
 * Returns only the matching 1-3 services to maintain token efficiency.
 */
export function findRelevantServices(query: string): VerifiedCompanyService[] {
  const normalized = query.toLowerCase();
  const matched: VerifiedCompanyService[] = [];

  for (const service of VERIFIED_SERVICES) {
    if (
      service.keywords.some((kw) => normalized.includes(kw)) ||
      normalized.includes(service.name.toLowerCase()) ||
      normalized.includes(service.id)
    ) {
      matched.push(service);
    }
  }

  return matched.slice(0, 3);
}

/**
 * Builds a compact knowledge snippet for prompt injection.
 * Injects only the relevant matching services plus linktree URL, avoiding full directory dump.
 */
export function buildRelevantKnowledgeSnippet(query: string): string {
  const relevant = findRelevantServices(query);
  const parts: string[] = [
    `Company: ${QUANTUM_WEAVE_COMPANY_INFO.name} (${QUANTUM_WEAVE_COMPANY_INFO.tagline})`,
    `Official Directory: ${QUANTUM_WEAVE_COMPANY_INFO.linktreeUrl}`
  ];

  if (relevant.length > 0) {
    parts.push('Relevant Verified Services:');
    for (const s of relevant) {
      parts.push(`- ${s.name}: ${s.verifiedUrl} — ${s.description}`);
    }
  }

  return parts.join('\n');
}
