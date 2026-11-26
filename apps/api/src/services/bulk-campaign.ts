import crypto from 'node:crypto';
import { inflateRawSync, unzipSync } from 'node:zlib';
import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', value =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

import {
  BULK_CAMPAIGN_EXECUTE_ACTION,
  computeCanonicalParameterHash,
  isValidWhatsAppTemplateParam,
  PHONE_AI_CALL_ACTION,
  PhoneCallingLanguageSchema,
  PhoneCallingPrepareSchema,
  PhoneCallingPreparedSchema,
  PhoneCallingProviderResultSchema,
  PhoneCallingRecordSchema,
  PhoneCallingRequestListSchema,
  PhoneContactListSchema,
  type ApprovalRequest,
  type BulkCampaignAiInterpretation,
  type BulkCampaignAttendanceOutcome,
  type BulkCampaignCallScript,
  type BulkCampaignChannel,
  type BulkCampaignChannelEligibilityStatus,
  type BulkCampaignContactCategory,
  type BulkCampaignExtractedFacts,
  type BulkCampaignContactRecord,
  type BulkCampaignDashboardMetrics,
  type BulkCampaignEligiblePilotContact,
  type BulkCampaignEmailDeliveryStatus,
  type BulkCampaignMode,
  type BulkCampaignSheetMonitorConfig,
  type BulkCampaignSheetConsentAttestation,
  type BulkCampaignStandingAuthorization,
  type BulkCampaignImportedContact,
  type BulkCampaignImportIssue,
  type BulkCampaignImportResult,
  type BulkCampaignKnowledgeContext,
  type BulkCampaignKnowledgeUploadInput,
  type BulkCampaignLanguage,
  type BulkCampaignLimits,
  type BulkCampaignN8nBatchConfig,
  type BulkCampaignN8nBatchRecipient,
  type BulkCampaignN8nChannel,
  type BulkCampaignN8nExecutionJob,
  type BulkCampaignPhoneCallStatus,
  type BulkCampaignPilotCallState,
  type BulkCampaignPilotWhatsAppState,
  type BulkCampaignSimulatedDialogueTurn,
  type BulkCampaignSourceType,
  type BulkCampaignStatus,
  type BulkCampaignTemplateSummary,
  type BulkCampaignWebinarDetails,
  type BulkCampaignWhatsAppDeliveryStatus,
  type BulkCampaignWhatsAppPlan,
  type BulkCampaignWorkspaceContext,
  type GmailSendNewInput,
  type MetaWhatsAppAnySendInput,
  type PhoneBatchIntegrationContract,
  type PhoneCallingDraft,
  type PhoneCallingLanguage,
  type PhoneCallingPrepare,
  type PhoneCallingPrepared,
  type PhoneCallingProviderResult,
  type PhoneCallingRecord,
  type PhoneCallingRequest,
  type PhoneCallingState,
  type PhoneContactView
} from '@thaara/contracts';
import {
  ApprovalRepository,
  AuditEventRepository,
  MembershipRepository,
  PlanRepository,
  PlanStepApprovalBindingRepository,
  PlanStepRepository,
  type AuthenticatedScope,
  type TransactionalDbClient
} from '@thaara/db';
import type { ActionAdapter, ActionExecutionContext, ActionResult } from '@thaara/policy';
import { GMAIL_SEND_NEW_ACTION, type GmailFoundation } from './gmail.js';
import type { PhoneN8nSyncService } from './phone-n8n-sync.js';
import {
  answerCampaignCustomerQuestion,
  buildSarvamBoundedFactBrief,
  enrichOrUpgradeCampaignKnowledgeContext,
  generateSampleGroundedQa,
  ingestCampaignKnowledgeFiles,
  isInternalKnowledgeGovernanceText,
  retrieveCampaignKnowledgeChunks,
  SARVAM_MAX_CALL_PURPOSE_CHARS,
  SARVAM_OUTBOUND_AGENT_LABEL
} from './bulk-campaign-knowledge.js';
import { maskPhoneCallNumber } from './phone.js';

export {
  answerCampaignCustomerQuestion,
  buildSarvamBoundedFactBrief,
  enrichOrUpgradeCampaignKnowledgeContext,
  generateSampleGroundedQa,
  ingestCampaignKnowledgeFiles,
  isInternalKnowledgeGovernanceText,
  retrieveCampaignKnowledgeChunks,
  SARVAM_MAX_CALL_PURPOSE_CHARS,
  SARVAM_OUTBOUND_AGENT_LABEL
};
import type { PhoneCallingService, PhoneContactDirectory } from './phone-calling.js';
import type { PhoneContactManagementService } from './phone-contacts.js';
import type { DurableWhatsAppService } from './whatsapp-durable.js';
import type { WhatsAppTemplateService } from './whatsapp-templates.js';

export const DEFAULT_DAILY_PHONE_CALL_LIMIT = 5;
export const MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT = 10000;

/**
 * 5 saved, owner-authorized contacts in `PhoneContactDirectory` with active calling consent
 * and supported languages (`en-IN`, `kn-IN`, `kn-en`), plus 1 duplicate row and 1 invalid row.
 */
export const SYNTHETIC_DEMO_CONTACTS_CSV = [
  'name,phone,email,language,whatsapp_consent,phone_consent,email_consent,opted_out',
  'Aarav Sharma,9876500001,aarav@example.com,en-IN,true,true,true,false',
  'Kavya Rao,+91 98765 00002,kavya@example.com,kn-IN,true,true,false,false',
  'Darshan Gowda,919876500003,darshan@example.com,kn-en,true,true,false,false',
  'Ananya Kulkarni,9876500004,ananya@example.com,en-IN,true,true,true,false',
  'Vikram Patel,9876500005,vikram@example.com,en-IN,true,true,false,false',
  'Aarav Sharma Duplicate,+919876500001,aarav.dup@example.com,en-IN,true,true,false,false',
  'Invalid Contact,12345,not-an-email,en-IN,true,true,false,false'
].join('\n');

export const DEFAULT_DEMO_PHONE_DIRECTORY: PhoneContactView[] = [
  {
    contactId: 'pdir_aarav_0001',
    revision: 1,
    displayName: 'Aarav Sharma',
    aliases: ['Aarav'],
    maskedPhone: '+91 ******0001',
    archived: false,
    consent: {
      callingAllowed: true,
      source: 'recipient_written',
      recordedAt: '2026-11-01T10:00:00.000Z',
      expiresAt: '2027-11-01T10:00:00.000Z',
      expired: false
    }
  },
  {
    contactId: 'pdir_kavya_0002',
    revision: 1,
    displayName: 'Kavya Rao',
    aliases: ['Kavya'],
    maskedPhone: '+91 ******0002',
    archived: false,
    consent: {
      callingAllowed: true,
      source: 'recipient_written',
      recordedAt: '2026-11-01T10:00:00.000Z',
      expiresAt: '2027-11-01T10:00:00.000Z',
      expired: false
    }
  },
  {
    contactId: 'pdir_darshan_0003',
    revision: 1,
    displayName: 'Darshan Gowda',
    aliases: ['Darshan'],
    maskedPhone: '+91 ******0003',
    archived: false,
    consent: {
      callingAllowed: true,
      source: 'recipient_verbal',
      recordedAt: '2026-11-01T10:00:00.000Z',
      expiresAt: '2027-11-01T10:00:00.000Z',
      expired: false
    }
  },
  {
    contactId: 'pdir_ananya_0004',
    revision: 1,
    displayName: 'Ananya Kulkarni',
    aliases: ['Ananya'],
    maskedPhone: '+91 ******0004',
    archived: false,
    consent: {
      callingAllowed: true,
      source: 'recipient_message',
      recordedAt: '2026-11-01T10:00:00.000Z',
      expiresAt: '2027-11-01T10:00:00.000Z',
      expired: false
    }
  },
  {
    contactId: 'pdir_vikram_0005',
    revision: 1,
    displayName: 'Vikram Patel',
    aliases: ['Vikram'],
    maskedPhone: '+91 ******0005',
    archived: false,
    consent: {
      callingAllowed: true,
      source: 'recipient_written',
      recordedAt: '2026-11-01T10:00:00.000Z',
      expiresAt: '2027-11-01T10:00:00.000Z',
      expired: false
    }
  }
];

export const DEFAULT_DEMO_INSTRUCTION =
  'Thaara, tomorrow we have an AI and Digital Marketing webinar at 7 PM. Send invitations to these contacts, call the eligible contacts, explain the webinar, ask if they will attend, and give me a complete report.';

export const COMPANY_INTRODUCTION_SIMULATION_INSTRUCTION =
  'Thaara, introduce Quantum Weave AI to these contacts. Explain our company and services using our verified uploaded company knowledge. Understand their business requirements, answer relevant questions naturally, identify interested businesses, and offer human follow-up where appropriate. Record the outcomes and provide a final report.';

/**
 * 5 isolated fictional business contacts for safe Company Introduction simulation testing.
 * - Unmistakably marked with `isSyntheticTestFixture: true` and `[SYNTHETIC TEST]` labels.
 * - Contain ZERO dialable E.164 phone numbers (`phoneE164` is omitted; `maskedPhone` is `TEST-FIXTURE-000X`).
 * - Never written into `phone_contacts` or customer lead tables, and unconditionally blocked from `mode: 'live'`.
 */
export const SYNTHETIC_COMPANY_SIMULATION_CONTACTS: readonly BulkCampaignImportedContact[] = Object.freeze([
  {
    contactId: 'syn_test_1',
    isUnsavedCampaignContact: false,
    isSyntheticTestFixture: true,
    syntheticScenarioKey: 'voice_agents_interested',
    syntheticScenarioTitle: 'Customer 1 — Interested in AI Voice Agents',
    rowNumber: 1,
    name: '[SYNTHETIC TEST] Arjun Mehta',
    company: 'Apex Retail Labs (Test Fixture)',
    maskedPhone: 'TEST-FIXTURE-0001',
    preferredLanguage: 'en-IN',
    consentSourceDetail: 'isolated_synthetic_simulation_fixture',
    optedOut: false,
    consent: {
      whatsapp: false,
      phone: true,
      email: false,
      source: 'owner_verified'
    }
  },
  {
    contactId: 'syn_test_2',
    isUnsavedCampaignContact: false,
    isSyntheticTestFixture: true,
    syntheticScenarioKey: 'digital_marketing_interested',
    syntheticScenarioTitle: 'Customer 2 — Interested in Digital Marketing',
    rowNumber: 2,
    name: '[SYNTHETIC TEST] Priya Nair',
    company: 'Horizon Design Studio (Test Fixture)',
    maskedPhone: 'TEST-FIXTURE-0002',
    preferredLanguage: 'en-IN',
    consentSourceDetail: 'isolated_synthetic_simulation_fixture',
    optedOut: false,
    consent: {
      whatsapp: false,
      phone: true,
      email: false,
      source: 'owner_verified'
    }
  },
  {
    contactId: 'syn_test_3',
    isUnsavedCampaignContact: false,
    isSyntheticTestFixture: true,
    syntheticScenarioKey: 'pricing_enquiry',
    syntheticScenarioTitle: 'Customer 3 — Pricing Enquiry',
    rowNumber: 3,
    name: '[SYNTHETIC TEST] Vikram Rao',
    company: 'Metro Freight Logistics (Test Fixture)',
    maskedPhone: 'TEST-FIXTURE-0003',
    preferredLanguage: 'en-IN',
    consentSourceDetail: 'isolated_synthetic_simulation_fixture',
    optedOut: false,
    consent: {
      whatsapp: false,
      phone: true,
      email: false,
      source: 'owner_verified'
    }
  },
  {
    contactId: 'syn_test_4',
    isUnsavedCampaignContact: false,
    isSyntheticTestFixture: true,
    syntheticScenarioKey: 'not_interested',
    syntheticScenarioTitle: 'Customer 4 — Not Interested',
    rowNumber: 4,
    name: '[SYNTHETIC TEST] Sneha Kulkarni',
    company: 'Sunbeam Artisan Foods (Test Fixture)',
    maskedPhone: 'TEST-FIXTURE-0004',
    preferredLanguage: 'en-IN',
    consentSourceDetail: 'isolated_synthetic_simulation_fixture',
    optedOut: false,
    consent: {
      whatsapp: false,
      phone: true,
      email: false,
      source: 'owner_verified'
    }
  },
  {
    contactId: 'syn_test_5',
    isUnsavedCampaignContact: false,
    isSyntheticTestFixture: true,
    syntheticScenarioKey: 'human_followup_callback',
    syntheticScenarioTitle: 'Customer 5 — Requests Human Follow-Up',
    rowNumber: 5,
    name: '[SYNTHETIC TEST] Karthik Gowda',
    company: 'Namma Diagnostics (Test Fixture)',
    maskedPhone: 'TEST-FIXTURE-0005',
    preferredLanguage: 'kn-en',
    consentSourceDetail: 'isolated_synthetic_simulation_fixture',
    optedOut: false,
    consent: {
      whatsapp: false,
      phone: true,
      email: false,
      source: 'owner_verified'
    }
  }
]);

export function buildSyntheticCompanyImportResult(): BulkCampaignImportResult {
  return {
    sourceType: 'csv',
    fileName: 'synthetic-business-fixtures-5.test',
    totalRowsParsed: SYNTHETIC_COMPANY_SIMULATION_CONTACTS.length,
    validContacts: SYNTHETIC_COMPANY_SIMULATION_CONTACTS.map(c => structuredClone(c)),
    duplicates: [],
    invalidEntries: [],
    consentNotice:
      'SIMULATION TEST FIXTURE ONLY: These 5 fictional business contacts contain non-dialable test IDs (no real phone numbers), are never saved to Phone Contacts or customer leads, and are permitted only inside isolated simulation. Real customer outreach still requires verified channel consent and DND clearance.'
  };
}

export function simulateSyntheticCompanyScenario(input: {
  contact: BulkCampaignImportedContact;
  openingLine: string;
  aiDisclosure: string;
  knowledgeContext?: BulkCampaignKnowledgeContext;
  eventDetails?: string;
}): {
  scenarioTitle: string;
  turns: BulkCampaignSimulatedDialogueTurn[];
  rawCustomerResponses: string[];
  reportText: string;
  outcome: 'interested' | 'wants_more_info' | 'declined' | 'callback_requested';
  followUpRequired: boolean;
  followUpReason?: string;
  preferredCallbackTime?: string;
  rationale: string;
} {
  const cleanFirstName = input.contact.name.replace(/^\[SYNTHETIC TEST\]\s*/i, '').trim();
  const renderedOpening = `${input.aiDisclosure} ${input.openingLine.replace(/\{\{name\}\}/gi, cleanFirstName)}`.trim();
  const key = input.contact.syntheticScenarioKey ?? 'voice_agents_interested';
  const scenarioTitle =
    input.contact.syntheticScenarioTitle ?? 'Simulated Business Conversation';

  const ask = (question: string) =>
    answerCampaignCustomerQuestion({
      question,
      knowledgeContext: input.knowledgeContext,
      eventDetails: input.eventDetails
    });

  if (key === 'voice_agents_interested') {
    const q1 = 'Sure, go ahead. What does Quantum Weave AI do, and what services do you offer?';
    const a1 = ask('What does Quantum Weave AI do?');
    const q2 = 'How does your AI Voice Agent work, and can it handle inbound and outbound customer enquiries?';
    const a2 = ask(q2);
    const closingCustomer =
      'Yes, we receive a high volume of retail support calls every week and I am definitely interested in exploring an AI Voice Agent for our customer enquiries.';
    const closingThaara = `Thank you, ${cleanFirstName}. I have recorded your interest in AI Voice Agents for customer enquiry handling in our campaign report so our team can share the next steps.`;
    const turns: BulkCampaignSimulatedDialogueTurn[] = [
      { speaker: 'thaara', text: renderedOpening },
      { speaker: 'customer', text: q1 },
      { speaker: 'thaara', text: a1.answer, sourceRefs: a1.sourceRefs },
      { speaker: 'customer', text: q2 },
      { speaker: 'thaara', text: a2.answer, sourceRefs: a2.sourceRefs },
      { speaker: 'customer', text: closingCustomer },
      { speaker: 'thaara', text: closingThaara }
    ];
    return {
      scenarioTitle,
      turns,
      rawCustomerResponses: [q1, q2, closingCustomer],
      reportText: formatSimulatedTranscriptReport(scenarioTitle, input.contact.name, turns),
      outcome: 'interested',
      followUpRequired: false,
      rationale:
        'SIMULATED ONLY: Fictional business prospect asked about company overview and AI Voice Agent enquiry handling, received verified grounded answers, and expressed clear interest.'
    };
  }

  if (key === 'digital_marketing_interested') {
    const q1 = 'Yes, we have two minutes. Tell me about your digital marketing services.';
    const a1 = ask('What digital marketing services do you offer?');
    const q2 = 'How could your marketing and WhatsApp automation systems help our design studio get more consistent leads?';
    const a2 = ask('How does business automation and WhatsApp automation help?');
    const closingCustomer =
      'Yes, we are interested—structured Meta lead generation paired with automated WhatsApp follow-up would really help our studio.';
    const closingThaara = `Wonderful, ${cleanFirstName}. I have noted your interest in Digital Marketing and WhatsApp lead follow-up in this report.`;
    const turns: BulkCampaignSimulatedDialogueTurn[] = [
      { speaker: 'thaara', text: renderedOpening },
      { speaker: 'customer', text: q1 },
      { speaker: 'thaara', text: a1.answer, sourceRefs: a1.sourceRefs },
      { speaker: 'customer', text: q2 },
      { speaker: 'thaara', text: a2.answer, sourceRefs: a2.sourceRefs },
      { speaker: 'customer', text: closingCustomer },
      { speaker: 'thaara', text: closingThaara }
    ];
    return {
      scenarioTitle,
      turns,
      rawCustomerResponses: [q1, q2, closingCustomer],
      reportText: formatSimulatedTranscriptReport(scenarioTitle, input.contact.name, turns),
      outcome: 'interested',
      followUpRequired: false,
      rationale:
        'SIMULATED ONLY: Fictional business prospect asked about Digital Marketing and automation lead workflows, received verified grounded answers, and confirmed interest.'
    };
  }

  if (key === 'pricing_enquiry') {
    const q1 = 'Before we discuss further, how much does your AI automation cost and how long does implementation take?';
    const a1 = ask('How much does it cost?');
    const q2 = 'Got it—how can we request a consultation or get more details on scope before we decide?';
    const a2 = ask('How can I request a consultation?');
    const closingCustomer =
      'Alright, please mark that we need more information on scope and consultation options before deciding.';
    const closingThaara = `Understood, ${cleanFirstName}. I have noted that you would like scope and consultation details before deciding—no unverified price or timeline was quoted.`;
    const turns: BulkCampaignSimulatedDialogueTurn[] = [
      { speaker: 'thaara', text: renderedOpening },
      { speaker: 'customer', text: q1 },
      { speaker: 'thaara', text: a1.answer, sourceRefs: a1.sourceRefs },
      { speaker: 'customer', text: q2 },
      { speaker: 'thaara', text: a2.answer, sourceRefs: a2.sourceRefs },
      { speaker: 'customer', text: closingCustomer },
      { speaker: 'thaara', text: closingThaara }
    ];
    return {
      scenarioTitle,
      turns,
      rawCustomerResponses: [q1, q2, closingCustomer],
      reportText: formatSimulatedTranscriptReport(scenarioTitle, input.contact.name, turns),
      outcome: 'wants_more_info',
      followUpRequired: true,
      followUpReason: 'Pricing & scope consultation requested before deciding (SIMULATED)',
      rationale:
        'SIMULATED ONLY: Fictional prospect asked about pricing; Thaara did not invent prices and offered team consultation.'
    };
  }

  if (key === 'not_interested') {
    const q1 = 'No thank you, we are not interested in AI or marketing services right now.';
    const closingThaara = `Completely understood, ${cleanFirstName}. Thank you for your time, and have a great day ahead.`;
    const turns: BulkCampaignSimulatedDialogueTurn[] = [
      { speaker: 'thaara', text: renderedOpening },
      { speaker: 'customer', text: q1 },
      { speaker: 'thaara', text: closingThaara }
    ];
    return {
      scenarioTitle,
      turns,
      rawCustomerResponses: [q1],
      reportText: formatSimulatedTranscriptReport(scenarioTitle, input.contact.name, turns),
      outcome: 'declined',
      followUpRequired: false,
      rationale:
        'SIMULATED ONLY: Fictional contact politely declined; Thaara respected the response immediately without pressure.'
    };
  }

  // Scenario 5: human_followup_callback
  const q1 = 'Namaskara—can your AI Voice Agent and WhatsApp automation handle Kannada and Kanglish for our diagnostic centre patients?';
  const a1 = ask('Can it handle Kannada?');
  const q2 = 'And what integrations can it connect with for appointment coordination?';
  const a2 = ask('What integrations can it connect with?');
  const closingCustomer =
    'This looks helpful, but we have custom lab workflows. Could a human specialist from your team call me back tomorrow at 4 PM to discuss it?';
  const closingThaara = `Certainly, ${cleanFirstName}. I have recorded your request for a human specialist callback tomorrow afternoon in this campaign report (simulated only—no live callback notification or email is sent in simulation).`;
  const turns: BulkCampaignSimulatedDialogueTurn[] = [
    { speaker: 'thaara', text: renderedOpening },
    { speaker: 'customer', text: q1 },
    { speaker: 'thaara', text: a1.answer, sourceRefs: a1.sourceRefs },
    { speaker: 'customer', text: q2 },
    { speaker: 'thaara', text: a2.answer, sourceRefs: a2.sourceRefs },
    { speaker: 'customer', text: closingCustomer },
    { speaker: 'thaara', text: closingThaara }
  ];
  return {
    scenarioTitle,
    turns,
    rawCustomerResponses: [q1, q2, closingCustomer],
    reportText: formatSimulatedTranscriptReport(scenarioTitle, input.contact.name, turns),
    outcome: 'callback_requested',
    followUpRequired: true,
    preferredCallbackTime: 'Tomorrow around 4 PM (Simulated only)',
    followUpReason: 'Human specialist callback requested (SIMULATED — isolated from Step 115 & n8n)',
    rationale:
      'SIMULATED ONLY: Fictional prospect asked multiple questions and requested a human callback; recorded strictly inside simulation report with zero real Step 115 or n8n notifications.'
  };
}

function formatSimulatedTranscriptReport(
  scenarioTitle: string,
  displayName: string,
  turns: BulkCampaignSimulatedDialogueTurn[]
): string {
  const header = `[SIMULATED — NOT AN ACTUAL CUSTOMER CONVERSATION | ${scenarioTitle}]`;
  const body = turns
    .map(t =>
      t.speaker === 'thaara'
        ? `Thaara${t.sourceRefs && t.sourceRefs.length > 0 ? ` (${t.sourceRefs.join(', ')})` : ''}: "${t.text}"`
        : `Customer (${displayName}): "${t.text}"`
    )
    .join('\n');
  return `${header}\n${body}`.slice(0, 15000);
}

export function normalizeCampaignPhone(raw: string): {
  valid: boolean;
  e164?: string;
  masked?: string;
  isIndianMobile?: boolean;
  reason?: string;
} {
  const trimmed = raw.trim();
  if (!trimmed) return { valid: false, reason: 'Missing phone number' };
  const cleaned = trimmed.replace(/[\s().-]+/g, '');
  const digits = cleaned.replace(/\D/g, '');
  let e164 = '';
  if (cleaned.startsWith('+')) {
    if (/^\+[1-9][0-9]{7,14}$/.test(cleaned)) e164 = cleaned;
  } else if (/^[6-9][0-9]{9}$/.test(digits)) {
    e164 = `+91${digits}`;
  } else if (/^91[6-9][0-9]{9}$/.test(digits)) {
    e164 = `+${digits}`;
  } else if (/^0[6-9][0-9]{9}$/.test(digits)) {
    e164 = `+91${digits.slice(1)}`;
  }
  if (!e164) {
    return { valid: false, reason: `Invalid phone number "${trimmed}" (requires valid E.164 or 10-digit Indian mobile)` };
  }
  const cc = e164.startsWith('+91') ? '+91' : e164.slice(0, Math.max(2, e164.length - 10));
  const last4 = e164.slice(-4);
  const isIndianMobile = /^\+91[6-9][0-9]{9}$/.test(e164);
  return { valid: true, e164, masked: `${cc} ******${last4}`, isIndianMobile };
}

function isValidEmail(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed) && trimmed.length <= 254;
}

function parseBooleanFlag(raw: string | undefined): boolean | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (['true', 'yes', '1', 'y', 'opted_in', 'consented'].includes(v)) return true;
  if (['false', 'no', '0', 'n', 'none'].includes(v)) return false;
  return null;
}

function parseLanguageFlag(raw: string | undefined): BulkCampaignLanguage {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'kn-en' || v === 'kanglish' || v === 'kannada-english') return 'kn-en';
  if (v === 'kn' || v === 'kn-in' || v === 'kannada') return 'kn-IN';
  if (v === 'hi' || v === 'hi-in' || v === 'hindi') return 'hi-IN';
  return 'en-IN';
}

export function isSupportedPhoneCallingLanguage(lang: string): lang is PhoneCallingLanguage {
  return Value.Check(PhoneCallingLanguageSchema, lang);
}

/**
 * Converts campaign pitch and questions into a single-line bounded `purpose` (`1..1000` chars)
 * compatible with `PhoneCallingPrepareSchema.properties.purpose`.
 */
export function buildBoundedPhonePurpose(input: {
  eventDetails: string;
  eventPitch: string;
  questions: string[];
}): string {
  const qPart = input.questions
    .slice(0, 10)
    .map((q, idx) => `Q${idx + 1}: ${q.trim()}`)
    .join(' ');
  const normalized = `${input.eventDetails}. ${input.eventPitch} Questions: ${qPart}`
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, SARVAM_MAX_CALL_PURPOSE_CHARS) || 'Campaign outreach call';
}

export function renderPersonalizedWhatsAppPreview(templatePreview: string, contactName: string): string {
  return templatePreview
    .replace(/\{\{1\}\}/g, contactName)
    .replace(/\{\{name\}\}/gi, contactName);
}

export function renderPersonalizedEmailPreview(
  bodyTemplate: string,
  contactName: string,
  company?: string
): string {
  const rendered = bodyTemplate
    .replace(/\{\{name\}\}/gi, contactName)
    .replace(/\{\{1\}\}/g, contactName)
    .replace(/\{\{company\}\}/gi, company || 'your organization');
  if (/unsubscribe/i.test(rendered)) return rendered.slice(0, 2048);
  return `${rendered}\n\nUnsubscribe: Reply UNSUBSCRIBE to opt out of future campaign emails.`.slice(0, 2048);
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}

function readZipEntries(bytes: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  // First read Central Directory (`PK\x01\x02`) if present for accurate sizes (even with data descriptors)
  const cdSizes = new Map<string, { method: number; compSize: number; localOffset: number }>();
  let offset = 0;
  while (offset + 46 <= bytes.length) {
    const idx = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset);
    if (idx === -1 || idx + 46 > bytes.length) break;
    const method = bytes.readUInt16LE(idx + 10);
    const compSize = bytes.readUInt32LE(idx + 20);
    const fnLen = bytes.readUInt16LE(idx + 28);
    const extraLen = bytes.readUInt16LE(idx + 30);
    const commentLen = bytes.readUInt16LE(idx + 32);
    const localOffset = bytes.readUInt32LE(idx + 42);
    if (idx + 46 + fnLen <= bytes.length) {
      const name = bytes.subarray(idx + 46, idx + 46 + fnLen).toString('utf8');
      cdSizes.set(name, { method, compSize, localOffset });
    }
    offset = idx + 46 + fnLen + extraLen + commentLen;
  }

  let pos = 0;
  while (pos + 30 <= bytes.length) {
    const lh = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), pos);
    if (lh === -1 || lh + 30 > bytes.length) break;
    const method = bytes.readUInt16LE(lh + 8);
    let compSize = bytes.readUInt32LE(lh + 18);
    const fnLen = bytes.readUInt16LE(lh + 26);
    const extraLen = bytes.readUInt16LE(lh + 28);
    const dataStart = lh + 30 + fnLen + extraLen;
    if (lh + 30 + fnLen > bytes.length || dataStart > bytes.length) break;
    const name = bytes.subarray(lh + 30, lh + 30 + fnLen).toString('utf8');
    const cd = cdSizes.get(name);
    if (compSize === 0 && cd && cd.compSize > 0) {
      compSize = cd.compSize;
    }
    const rawSlice =
      compSize > 0 && dataStart + compSize <= bytes.length
        ? bytes.subarray(dataStart, dataStart + compSize)
        : bytes.subarray(dataStart);
    try {
      if ((cd?.method ?? method) === 0) {
        entries.set(name, Buffer.from(rawSlice));
      } else if ((cd?.method ?? method) === 8) {
        entries.set(name, inflateRawSync(rawSlice));
      }
    } catch {
      // Ignore unreadable individual archive entries
    }
    pos = dataStart + Math.max(1, compSize);
  }
  return entries;
}

function excelColLettersToIndex(cellRef: string): number {
  const letters = (cellRef.match(/^[A-Za-z]+/)?.[0] ?? '').toUpperCase();
  if (!letters) return -1;
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

export function extractLinesFromXlsxBuffer(bytes: Buffer): string[] {
  const zip = readZipEntries(bytes);
  const sharedStrings: string[] = [];
  const ssXml = zip.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  if (ssXml) {
    for (const siMatch of ssXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
      const inner = siMatch[1] ?? '';
      const parts = [...inner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map(t =>
        decodeXmlEntities(t[1] ?? '')
      );
      sharedStrings.push(parts.join('').trim());
    }
  }

  const sheetKey =
    [...zip.keys()].sort().find(k => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k)) ??
    'xl/worksheets/sheet1.xml';
  const sheetXml = zip.get(sheetKey)?.toString('utf8') ?? '';
  if (!sheetXml) return [];

  const lines: string[] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
    const rowInner = rowMatch[1] ?? '';
    const cells: string[] = [];
    let nextAutoCol = 0;
    for (const cellMatch of rowInner.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
      const attrs = cellMatch[1] ?? '';
      const cellInner = cellMatch[2] ?? '';
      const refAttr = attrs.match(/\br="([A-Za-z]+\d+)"/i)?.[1];
      const typeAttr = attrs.match(/\bt="([^"]+)"/i)?.[1] ?? '';
      const colIdx = refAttr ? excelColLettersToIndex(refAttr) : nextAutoCol;
      const targetIdx = colIdx >= 0 ? colIdx : nextAutoCol;
      nextAutoCol = targetIdx + 1;

      let val = '';
      if (typeAttr === 'inlineStr') {
        const inlineParts = [...cellInner.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)].map(t =>
          decodeXmlEntities(t[1] ?? '')
        );
        val = inlineParts.join('').trim();
      } else {
        const rawV = cellInner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? '';
        const decodedV = decodeXmlEntities(rawV).trim();
        if (typeAttr === 's') {
          const idx = Number.parseInt(decodedV, 10);
          val = Number.isFinite(idx) && idx >= 0 ? (sharedStrings[idx] ?? '') : '';
        } else if (typeAttr === 'b') {
          val = decodedV === '1' ? 'true' : decodedV === '0' ? 'false' : decodedV;
        } else {
          val = decodedV;
        }
      }
      while (cells.length <= targetIdx) cells.push('');
      cells[targetIdx] = val.replace(/[\r\n\t]+/g, ' ').trim();
    }
    if (cells.some(Boolean)) {
      lines.push(cells.join('\t'));
    }
  }
  return lines;
}

function extractPdfOperatorsLines(pdfTextChunk: string): string[] {
  const lines: string[] = [];
  const blocks = [...pdfTextChunk.matchAll(/BT\b([\s\S]*?)\bET/g)];
  const sources = blocks.length > 0 ? blocks.map(b => b[1] ?? '') : [pdfTextChunk];

  for (const src of sources) {
    // Split on explicit PDF text-positioning / newline operators (`T*`, `Td`, `TD`, `Tm`) so rows stay separate
    const segments = src.split(/(?:\bT\*|\bT[dDm]\b|\r?\n)/);
    for (const seg of segments) {
      const segParts: string[] = [];
      for (const m of seg.matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g)) {
        const txt = (m[1] ?? '').replace(/\\([()\\])/g, '$1').trim();
        if (txt) segParts.push(txt);
      }
      for (const m of seg.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
        const inner = m[1] ?? '';
        const parts = [...inner.matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g)].map(p =>
          (p[1] ?? '').replace(/\\([()\\])/g, '$1')
        );
        const joined = parts.join('').trim();
        if (joined) segParts.push(joined);
      }
      const combined = segParts.join(' ').trim();
      if (combined) lines.push(combined);
    }
  }
  return lines;
}

export function extractLinesFromPdfBuffer(bytes: Buffer): string[] {
  const binaryStr = bytes.toString('latin1');
  const extracted: string[] = [];

  for (const streamMatch of binaryStr.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const rawStream = Buffer.from(streamMatch[1] ?? '', 'latin1');
    let decodedText: string | null = null;
    try {
      decodedText = inflateRawSync(rawStream).toString('utf8');
    } catch {
      try {
        decodedText = unzipSync(rawStream).toString('utf8');
      } catch {
        decodedText = rawStream.toString('latin1');
      }
    }
    if (decodedText) {
      extracted.push(...extractPdfOperatorsLines(decodedText));
    }
  }

  if (extracted.length === 0) {
    extracted.push(...extractPdfOperatorsLines(binaryStr));
  }
  return extracted;
}

/**
 * Extracts tabular/contact lines from CSV, Excel (OOXML .xlsx binary ZIP / SpreadsheetML XML / TSV / CSV),
 * PDF text streams (compressed FlateDecode or uncompressed), or pasted text.
 */
export function extractRawLinesFromSource(
  sourceType: BulkCampaignSourceType,
  rawText: string,
  binaryBytes?: Buffer
): string[] {
  if (binaryBytes && binaryBytes.length >= 4) {
    if (
      binaryBytes[0] === 0x50 &&
      binaryBytes[1] === 0x4b &&
      binaryBytes[2] === 0x03 &&
      binaryBytes[3] === 0x04
    ) {
      const xlsxLines = extractLinesFromXlsxBuffer(binaryBytes);
      if (xlsxLines.length > 0) return xlsxLines;
    }
    if (
      binaryBytes[0] === 0x25 &&
      binaryBytes[1] === 0x50 &&
      binaryBytes[2] === 0x44 &&
      binaryBytes[3] === 0x46 &&
      binaryBytes[4] === 0x2d
    ) {
      return extractLinesFromPdfBuffer(binaryBytes);
    }
    if (!rawText.trim()) {
      rawText = binaryBytes.toString('utf8');
    }
  }

  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // 1. Excel XML / SpreadsheetML (`<Row>...<Cell><Data>...</Data></Cell></Row>` or `<row>...<c><t>...</t></c></row>`)
  if (sourceType === 'excel' && /<(?:Row|row)\b/i.test(trimmed)) {
    const rowMatches = [...trimmed.matchAll(/<(?:Row|row)\b[^>]*>([\s\S]*?)<\/(?:Row|row)>/gi)];
    if (rowMatches.length > 0) {
      return rowMatches
        .map(m => {
          const inner = m[1] ?? '';
          const cells = [...inner.matchAll(/<(?:Data|t|v)\b[^>]*>([\s\S]*?)<\/(?:Data|t|v)>/gi)].map(c =>
            (c[1] ?? '').replace(/<[^>]+>/g, '').trim()
          );
          return cells.join('\t');
        })
        .filter(Boolean);
    }
  }

  // 2. PDF stream (`%PDF-...` with `(text) Tj`, `[(text)] TJ`, or FlateDecode streams)
  if (sourceType === 'pdf' && /^%PDF-/i.test(trimmed)) {
    return extractLinesFromPdfBuffer(Buffer.from(trimmed, 'latin1'));
  }

  return trimmed
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

function splitDelimitedLine(line: string, delimiter: ',' | '\t'): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

function matchDirectoryContact(
  name: string,
  maskedPhone: string | undefined,
  directoryContacts: PhoneContactView[]
): PhoneContactView | undefined {
  const normName = name.trim().toLowerCase();
  const isPlaceholderName = !normName || /^(?:contact\s+\d+|new\s+recipient)$/i.test(normName);
  const exact = directoryContacts.find(dc => {
    if (dc.archived) return false;
    const nameMatches =
      dc.displayName.trim().toLowerCase() === normName ||
      dc.aliases.some(a => a.trim().toLowerCase() === normName);
    if (!maskedPhone) return nameMatches;
    return nameMatches && dc.maskedPhone === maskedPhone;
  });
  if (exact) return exact;
  if (isPlaceholderName && maskedPhone) {
    const byPhone = directoryContacts.filter(dc => !dc.archived && dc.maskedPhone === maskedPhone);
    if (byPhone.length === 1) return byPhone[0];
  }
  return undefined;
}

export interface WhatsAppOptedInDirectoryEntry {
  recipientId: string;
  contactName: string;
  maskedPhone: string;
  optedIn: boolean;
}

function matchWhatsAppOptedInContact(
  name: string,
  maskedPhone: string | undefined,
  waContacts: WhatsAppOptedInDirectoryEntry[] | undefined
): WhatsAppOptedInDirectoryEntry | undefined {
  if (!waContacts || waContacts.length === 0) return undefined;
  const normName = name.trim().toLowerCase();
  const normLast4 = maskedPhone ? maskedPhone.slice(-4) : '';
  return waContacts.find(wc => {
    if (!wc.optedIn) return false;
    const wcLast4 = wc.maskedPhone.slice(-4);
    if (normLast4 && wcLast4 === normLast4) {
      return wc.contactName.trim().toLowerCase() === normName || wc.recipientId.startsWith('c_');
    }
    return !normLast4 && wc.contactName.trim().toLowerCase() === normName;
  });
}

/**
 * Stage 1: Parse uploaded CSV / Excel (XLSX binary ZIP / TSV / CSV / XML) / PDF (compressed or plain) / pasted contact list,
 * matching saved contacts in `PhoneContactDirectory` and `DurableWhatsAppService` without bypassing consent or phone validation.
 * Newly uploaded numbers are NEVER assumed authorized for calling or messaging.
 */
export const MAX_IMPORT_RAW_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * Applies a campaign-level owner consent attestation to a normalized contact during CSV/Sheet conversion.
 * Strictly preserves DND, opt-out, and explicit negative consent columns (Consent=No/False) — never overrides them.
 */
export function applyOwnerSourceConsentAttestation(
  contact: BulkCampaignImportedContact,
  attestation?: BulkCampaignSheetConsentAttestation | null
): BulkCampaignImportedContact {
  if (!attestation?.confirmed) return contact;
  if (contact.dnd || contact.dndStatus === 'dnd') return contact;
  if (contact.optedOut || contact.optedOutStatus === 'opted_out') return contact;
  // Never override an explicit negative consent column in the sheet/file
  if (contact.consent.source === 'explicit_column' && !contact.consent.phone) {
    return contact;
  }
  if (contact.consent.phone) {
    return contact;
  }
  const sourceDetail = `${attestation.consentSource}: ${attestation.evidenceReference}`.slice(0, 120);
  return {
    ...contact,
    consentSourceDetail: contact.consentSourceDetail ?? sourceDetail,
    consentRecordedAt: contact.consentRecordedAt ?? attestation.attestedAt,
    consent: {
      ...contact.consent,
      phone: true,
      source: 'owner_verified'
    }
  };
}

export function parseBulkCampaignContacts(input: {
  sourceType: BulkCampaignSourceType;
  fileName?: string;
  rawText: string;
  fileBase64?: string;
  phoneDirectory?: PhoneContactView[];
  whatsappDirectory?: WhatsAppOptedInDirectoryEntry[];
}): BulkCampaignImportResult {
  if (Buffer.byteLength(input.rawText ?? '', 'utf8') > MAX_IMPORT_RAW_TEXT_BYTES) {
    throw new Error('Uploaded contact file exceeds the maximum allowed size of 2 MB.');
  }
  let binaryBytes: Buffer | undefined;
  if (input.fileBase64) {
    const cleanB64 = input.fileBase64.replace(/^data:[^;]+;base64,/, '').trim();
    if (cleanB64.length > Math.ceil((MAX_IMPORT_RAW_TEXT_BYTES * 4) / 3) + 64) {
      throw new Error('Uploaded contact file exceeds the maximum allowed size of 2 MB.');
    }
    binaryBytes = Buffer.from(cleanB64, 'base64');
    if (binaryBytes.length > MAX_IMPORT_RAW_TEXT_BYTES) {
      throw new Error('Uploaded contact file exceeds the maximum allowed size of 2 MB.');
    }
  }

  let effectiveSourceType = input.sourceType;
  if (input.fileName) {
    const ext = input.fileName.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'xlsx' || ext === 'xls' || ext === 'tsv') effectiveSourceType = 'excel';
    else if (ext === 'pdf') effectiveSourceType = 'pdf';
    else if (ext === 'csv') effectiveSourceType = 'csv';
    else if (ext === 'txt') effectiveSourceType = 'txt';
  }

  const directoryContacts = input.phoneDirectory ?? DEFAULT_DEMO_PHONE_DIRECTORY;
  let lines = extractRawLinesFromSource(effectiveSourceType, input.rawText ?? '', binaryBytes);

  // For paste/txt without headers, expand lines containing multiple comma/semicolon-separated phone numbers
  if (
    (effectiveSourceType === 'paste' || effectiveSourceType === 'txt') &&
    lines.length > 0 &&
    !/\b(name|phone|mobile|email|consent|dnd)\b/i.test(lines[0]!)
  ) {
    const expanded: string[] = [];
    for (const line of lines) {
      const parts = line.split(/[;,]+/).map(p => p.trim()).filter(Boolean);
      if (parts.length > 1 && parts.every(p => /(?:\+?\d[\s.-]?){8,13}\d/.test(p) || /@/.test(p))) {
        expanded.push(...parts);
      } else {
        expanded.push(line);
      }
    }
    lines = expanded;
  }

  // For PDFs, strip prices, invoice/order IDs, and dates before extracting phone numbers
  if (effectiveSourceType === 'pdf' && lines.length > 0) {
    lines = lines
      .map(l =>
        l
          .replace(/(?:Rs\.?|INR|₹|\$|USD|EUR)\s*[0-9,]+(?:\.[0-9]{1,2})?/gi, ' ')
          .replace(/\b(?:INV|INVOICE|ORD|ORDER|BILL|TXN|REF)[\s#:-]*[A-Z0-9-]{4,}\b/gi, ' ')
          .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, ' ')
          .replace(/\b\d+\.\d{2}\b/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(l => /\d|@|\bname\b|\bphone\b/i.test(l));
  }

  const validContacts: BulkCampaignImportedContact[] = [];
  const duplicates: BulkCampaignImportIssue[] = [];
  const invalidEntries: BulkCampaignImportIssue[] = [];
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  if (lines.length === 0) {
    const isPdfAttempt =
      effectiveSourceType === 'pdf' &&
      (/^%PDF-/i.test((input.rawText ?? '').trim()) ||
        Boolean(binaryBytes && binaryBytes.subarray(0, 5).toString('latin1') === '%PDF-'));
    if (isPdfAttempt) {
      invalidEntries.push({
        rowNumber: 1,
        rawLine: (input.fileName ?? input.rawText.trim()).slice(0, 120) || 'uploaded.pdf',
        reason: 'PDF file contains no extractable text stream. Please upload a text-based PDF, CSV, Excel, or paste the contact list.'
      });
    }
    return {
      sourceType: effectiveSourceType,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      totalRowsParsed: invalidEntries.length,
      validContacts,
      duplicates,
      invalidEntries,
      consentNotice: 'No contacts found. Channel consent is tracked per contact and never assumed from an uploaded file.'
    };
  }

  const delimiter: ',' | '\t' = lines[0]!.includes('\t') ? '\t' : ',';
  const firstCols = splitDelimitedLine(lines[0]!, delimiter).map(h =>
    h
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  );
  const isUrlOrMetaHeader = (h: string) =>
    /(?:_url|_link|_source_url|_key|^url$|^task_id$|^run_id$|_consent$|_verified|_status$)/i.test(h);
  const hasHeader = firstCols.some(
    h =>
      [
        'name',
        'full_name',
        'contact_name',
        'customer_name',
        'lead_name',
        'patient_name',
        'client_name',
        'buyer_or_channel',
        'contact_person',
        'phone',
        'mobile',
        'phone_number',
        'mobile_number',
        'contact_number',
        'business_phone',
        'work_phone',
        'whatsapp',
        'whatsapp_number',
        'business_whatsapp',
        'country_code',
        'email',
        'business_email',
        'work_email',
        'company',
        'business_name',
        'business_category',
        'service_required',
        'service',
        'customer_requirement',
        'requirement',
        'observed_facts',
        'recommended_offer',
        'published_quantity',
        'published_budget',
        'enquiry_date',
        'lead_source',
        'whatsapp_consent',
        'phone_consent',
        'call_consent',
        'calling_consent',
        'consent',
        'consent_given',
        'opt_in',
        'marketing_consent',
        'consent_source',
        'consent_evidence',
        'consent_recorded_at',
        'consent_timestamp',
        'consent_date',
        'lead_id',
        'source_lead_id',
        'created_time',
        'ad_name',
        'form_name',
        'email_consent',
        'dnd'
      ].includes(h) ||
      (!isUrlOrMetaHeader(h) && /(?:^|_)(?:phone|mobile|whatsapp|email)(?:$|_)/.test(h))
  );

  const seenLeadIds = new Set<string>();
  const startIndex = hasHeader ? 1 : 0;
  for (let idx = startIndex; idx < lines.length; idx++) {
    const rawLine = lines[idx]!;
    const rowNumber = idx + 1;

    let name = '';
    let company = '';
    let serviceRequired = '';
    let customerRequirement = '';
    let enquiryDate = '';
    let leadSource = '';
    let sourceLeadId = '';
    let customFields: Record<string, string> = {};
    let rawPhone = '';
    let rawWhatsapp = '';
    let rawEmail = '';
    let rawLang = 'en-IN';
    let waConsentCol: boolean | null = null;
    let phoneConsentCol: boolean | null = null;
    let emailConsentCol: boolean | null = null;
    let consentSourceDetail = '';
    let consentRecordedAt = '';
    let dndCol = false;
    let hasDndCol = false;
    let optedOutCol = false;
    let hasOptedOutCol = false;

    if (hasHeader) {
      const cols = splitDelimitedLine(rawLine, delimiter);
      const usedIndexes = new Set<number>();
      const getCol = (...names: string[]) => {
        for (const n of names) {
          const colIdx = firstCols.indexOf(n);
          if (colIdx >= 0) {
            usedIndexes.add(colIdx);
            const val = (cols[colIdx] ?? '').trim();
            if (val) return val;
          }
        }
        return '';
      };
      const getColMatching = (predicate: (h: string) => boolean) => {
        const colIdx = firstCols.findIndex((h, i) => !usedIndexes.has(i) && predicate(h));
        if (colIdx >= 0) usedIndexes.add(colIdx);
        return colIdx >= 0 ? (cols[colIdx] ?? '').trim() : '';
      };
      name = getCol(
        'name',
        'full_name',
        'contact_name',
        'customer',
        'customer_name',
        'lead_name',
        'patient_name',
        'client_name',
        'contact_person',
        'buyer_name',
        'buyer_or_channel'
      );
      company = getCol('company', 'company_name', 'business', 'business_name', 'organization', 'organisation', 'org', 'clinic', 'firm');
      if (!name && company) {
        name = company;
      }
      serviceRequired = getCol(
        'service_required',
        'service',
        'service_interested',
        'interested_in',
        'recommended_offer',
        'product',
        'category',
        'business_category',
        'looking_for',
        'solution'
      );
      customerRequirement = getCol(
        'customer_requirement',
        'requirement',
        'requirements',
        'observed_facts',
        'enquiry',
        'inquiry',
        'notes',
        'team_notes',
        'message',
        'details',
        'pain_point',
        'challenge',
        'query',
        'comments'
      );
      enquiryDate = getCol('enquiry_date', 'inquiry_date', 'submitted_at', 'created_time', 'signal_posting_date', 'date', 'lead_date', 'timestamp');
      leadSource = getCol('lead_source', 'source', 'signal_type', 'campaign_name', 'ad_name', 'form_name', 'channel', 'utm_source');
      sourceLeadId = getCol('source_lead_id', 'lead_id', 'meta_lead_id', 'record_key');
      const countryCode = getCol('country_code', 'cc', 'dial_code');
      const basePhone =
        getCol(
          'phone',
          'mobile',
          'phone_number',
          'mobile_number',
          'business_phone',
          'work_phone',
          'contact_phone',
          'direct_phone',
          'lead_phone',
          'customer_phone',
          'number',
          'contact_number',
          'whatsapp_no',
          'tel',
          'cell'
        ) ||
        getColMatching(h => !isUrlOrMetaHeader(h) && /(?:^|_)(?:phone|mobile|tel|contact_no)(?:$|_)/.test(h));
      rawPhone =
        basePhone && countryCode && !basePhone.trim().startsWith('+')
          ? `${countryCode.trim().startsWith('+') ? countryCode.trim() : `+${countryCode.replace(/\D/g, '')}`}${basePhone.replace(/\D/g, '')}`
          : basePhone;
      rawWhatsapp =
        getCol('whatsapp', 'whatsapp_number', 'business_whatsapp', 'whatsapp_no') ||
        getColMatching(h => !isUrlOrMetaHeader(h) && /whatsapp/.test(h)) ||
        rawPhone;
      if (!rawPhone && rawWhatsapp) {
        rawPhone = rawWhatsapp;
      }
      rawEmail =
        getCol('email', 'email_address', 'business_email', 'work_email', 'contact_email', 'customer_email') ||
        getColMatching(h => !isUrlOrMetaHeader(h) && /(?:^|_)email(?:$|_)/.test(h));
      rawLang = getCol('language', 'preferred_language', 'lang', 'spoken_language') || 'en-IN';
      waConsentCol = parseBooleanFlag(getCol('whatsapp_consent', 'wa_consent'));
      phoneConsentCol = parseBooleanFlag(
        getCol(
          'phone_consent',
          'call_consent',
          'calling_consent',
          'consent',
          'consent_information',
          'consent_given',
          'calling_permission',
          'opt_in',
          'marketing_consent'
        )
      );
      emailConsentCol = parseBooleanFlag(getCol('email_consent'));
      consentSourceDetail = getCol('consent_source', 'consent_evidence');
      consentRecordedAt = getCol('consent_recorded_at', 'consent_timestamp', 'consent_date', 'consent_at');
      const rawDndVal = getCol('dnd', 'ndnc', 'do_not_disturb', 'telemarketing_restricted');
      hasDndCol = Boolean(rawDndVal);
      dndCol = parseBooleanFlag(rawDndVal) === true;
      const rawOptedOutVal = getCol('opted_out', 'dnc', 'do_not_call', 'unsubscribed');
      hasOptedOutCol = Boolean(rawOptedOutVal);
      optedOutCol = parseBooleanFlag(rawOptedOutVal) === true;
      for (let ci = 0; ci < firstCols.length && ci < cols.length; ci++) {
        if (usedIndexes.has(ci)) continue;
        const headerKey = firstCols[ci]!.slice(0, 64);
        // Skip internal tracking IDs, raw source URLs, and score/status housekeeping columns so customer-relevant lead fields always fit
        if (
          !headerKey ||
          /(?:_url$|_link$|_key$|^task_id$|^run_id$|^run_date|^score_|^confidence$|^review_status$|^priority_or_hold$|^contact_verified_date$|^outreach_draft|^unknowns_and_limitations$|^owner$)/i.test(
            headerKey
          )
        ) {
          continue;
        }
        const val = (cols[ci] ?? '').replace(/[\r\n\t]+/g, ' ').replace(/^[=+\-@]+/, '').trim().slice(0, 300);
        if (val && Object.keys(customFields).length < 30) {
          customFields[headerKey] = val;
        }
      }
    } else {
      const emailMatch = rawLine.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
      if (emailMatch) rawEmail = emailMatch[0]!;
      const phoneMatch = rawLine.match(/(?:\+\d{1,3}[\s.-]?)?(?:\d[\s.-]?){8,13}\d/);
      if (phoneMatch) {
        rawPhone = phoneMatch[0]!;
        rawWhatsapp = rawPhone;
      }
      const langTokenMatch = rawLine.match(/\b(en-IN|kn-IN|kn-en|hi-IN|kannada|hindi|kanglish)\b/i);
      if (langTokenMatch) {
        rawLang = langTokenMatch[1]!;
      }
      if (/\b(?:dnd|ndnc|do_not_disturb)\b/i.test(rawLine)) {
        dndCol = true;
      }
      if (/\b(?:opted_out|opt_out|do_not_call|unsubscribed)\b/i.test(rawLine)) {
        optedOutCol = true;
      }
      const stripped = rawLine
        .replace(rawEmail, '')
        .replace(rawPhone, '')
        .replace(/\b(en-IN|kn-IN|kn-en|hi-IN|kannada|hindi|kanglish|dnd|ndnc|opted_out|opt_out)\b/gi, '')
        .replace(/[,;|()-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      name = stripped || `Contact ${rowNumber}`;
    }

    const phoneNorm = rawPhone ? normalizeCampaignPhone(rawPhone) : { valid: false };
    const waNorm = rawWhatsapp ? normalizeCampaignPhone(rawWhatsapp) : phoneNorm;
    const emailValid = rawEmail ? isValidEmail(rawEmail) : false;

    if (rawPhone && !phoneNorm.valid) {
      invalidEntries.push({
        rowNumber,
        rawLine: rawLine.slice(0, 500),
        reason: phoneNorm.reason ?? 'Invalid phone number'
      });
      continue;
    }
    if (rawEmail && !emailValid) {
      invalidEntries.push({
        rowNumber,
        rawLine: rawLine.slice(0, 500),
        reason: `Invalid email address "${rawEmail}"`
      });
      continue;
    }
    if (!phoneNorm.valid && !emailValid) {
      invalidEntries.push({
        rowNumber,
        rawLine: rawLine.slice(0, 500),
        reason: 'Entry contains neither a valid phone number nor a valid email address'
      });
      continue;
    }

    if (phoneNorm.e164 && seenPhones.has(phoneNorm.e164)) {
      duplicates.push({
        rowNumber,
        rawLine: rawLine.slice(0, 500),
        reason: `Duplicate phone number ${phoneNorm.masked ?? phoneNorm.e164}`
      });
      continue;
    }
    if (emailValid && seenEmails.has(rawEmail.toLowerCase())) {
      duplicates.push({
        rowNumber,
        rawLine: rawLine.slice(0, 500),
        reason: `Duplicate email address ${rawEmail.toLowerCase()}`
      });
      continue;
    }

    const normalizedLeadId = sourceLeadId.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 128);
    if (normalizedLeadId && seenLeadIds.has(normalizedLeadId)) {
      duplicates.push({
        rowNumber,
        rawLine: rawLine.slice(0, 500),
        reason: `Duplicate lead ID ${normalizedLeadId}`
      });
      continue;
    }

    if (phoneNorm.e164) seenPhones.add(phoneNorm.e164);
    if (emailValid) seenEmails.add(rawEmail.toLowerCase());
    if (normalizedLeadId) seenLeadIds.add(normalizedLeadId);

    const sanitizedName = name.replace(/^[=+\-@]+/, '').trim();
    const resolvedName = (sanitizedName || `Contact ${validContacts.length + 1}`).slice(0, 120);
    const sanitizedCompany = company.replace(/^[=+\-@]+/, '').trim().slice(0, 160);
    const cleanLeadField = (v: string, max: number) =>
      v.replace(/[\r\n\t]+/g, ' ').replace(/^[=+\-@]+/, '').replace(/\s+/g, ' ').trim().slice(0, max);
    const sanitizedService = cleanLeadField(serviceRequired, 200);
    const sanitizedRequirement = cleanLeadField(customerRequirement, 500);
    const sanitizedEnquiryDate = cleanLeadField(enquiryDate, 80);
    const sanitizedLeadSource = cleanLeadField(leadSource, 120);
    const dirMatch = matchDirectoryContact(resolvedName, phoneNorm.masked, directoryContacts);
    const finalDisplayName = !sanitizedName && dirMatch ? dirMatch.displayName : resolvedName;
    const dirPhoneConsent = Boolean(dirMatch && dirMatch.consent.callingAllowed && !dirMatch.consent.expired);
    const waDirMatch = matchWhatsAppOptedInContact(resolvedName, waNorm.masked ?? phoneNorm.masked, input.whatsappDirectory);
    const dirWhatsappConsent = Boolean(waDirMatch && waDirMatch.optedIn);

    const hasExplicitConsentColumn = waConsentCol !== null || phoneConsentCol !== null || emailConsentCol !== null;
    // Importing a phone number NEVER automatically establishes calling permission:
    // - Saved PhoneContactDirectory contacts with active consent are authorized unless explicitly marked false/DND/opted-out.
    // - Unsaved campaign contacts require explicit calling consent (`phone_consent=true` or owner-attested consent) and `!dnd && !optedOut`,
    //   and exist strictly as campaign-scoped contacts (`onecall_`) without altering PhoneContactDirectory.
    const effectiveDnd = dndCol;
    const dndStatus: 'unknown' | 'clear' | 'dnd' = effectiveDnd
      ? 'dnd'
      : hasDndCol || dirMatch
        ? 'clear'
        : 'unknown';
    const optedOutStatus: 'unknown' | 'clear' | 'opted_out' = optedOutCol
      ? 'opted_out'
      : hasOptedOutCol || dirMatch
        ? 'clear'
        : 'unknown';

    const effectivePhoneConsent =
      optedOutCol || effectiveDnd
        ? false
        : phoneConsentCol === false
          ? false
          : dirMatch
            ? dirPhoneConsent
            : phoneConsentCol === true;

    const effectiveWhatsappConsent =
      optedOutCol || effectiveDnd
        ? false
        : waConsentCol === false
          ? false
          : Boolean(waConsentCol === true || dirWhatsappConsent);

    const isInternational = Boolean(phoneNorm.valid && !phoneNorm.isIndianMobile);
    const sanitizedConsentRecordedAt = consentRecordedAt
      ? cleanLeadField(consentRecordedAt, 80)
      : effectivePhoneConsent && sanitizedEnquiryDate
        ? sanitizedEnquiryDate
        : '';

    validContacts.push({
      contactId: `c_${validContacts.length + 1}_${(phoneNorm.e164 ?? rawEmail).replace(/[^a-zA-Z0-9]/g, '').slice(-6)}`,
      ...(dirMatch ? { phoneDirectoryContactId: dirMatch.contactId, phoneDirectoryRevision: dirMatch.revision } : {}),
      isUnsavedCampaignContact: !dirMatch,
      ...(isInternational ? { isInternational: true } : {}),
      rowNumber,
      name: finalDisplayName,
      ...(sanitizedCompany ? { company: sanitizedCompany } : {}),
      ...(sanitizedService ? { serviceRequired: sanitizedService } : {}),
      ...(sanitizedRequirement ? { customerRequirement: sanitizedRequirement } : {}),
      ...(sanitizedEnquiryDate ? { enquiryDate: sanitizedEnquiryDate } : {}),
      ...(sanitizedLeadSource ? { leadSource: sanitizedLeadSource } : {}),
      ...(normalizedLeadId ? { sourceLeadId: normalizedLeadId } : {}),
      ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
      ...(phoneNorm.e164 ? { phoneE164: phoneNorm.e164, maskedPhone: phoneNorm.masked } : {}),
      ...(waNorm.e164 ? { whatsappE164: waNorm.e164 } : {}),
      ...(emailValid ? { email: rawEmail.toLowerCase() } : {}),
      preferredLanguage: parseLanguageFlag(rawLang),
      ...(effectiveDnd ? { dnd: true } : {}),
      dndStatus,
      ...(consentSourceDetail ? { consentSourceDetail: cleanLeadField(consentSourceDetail, 120) } : {}),
      ...(sanitizedConsentRecordedAt ? { consentRecordedAt: sanitizedConsentRecordedAt } : {}),
      optedOut: optedOutCol,
      optedOutStatus,
      consent: {
        whatsapp: effectiveWhatsappConsent,
        phone: effectivePhoneConsent,
        email: optedOutCol || effectiveDnd ? false : (emailConsentCol ?? false),
        source: dirMatch && dirPhoneConsent
          ? 'phone_directory_verified'
          : dirWhatsappConsent && waConsentCol === null && phoneConsentCol === null
            ? 'whatsapp_directory_verified'
            : hasExplicitConsentColumn
              ? 'explicit_column'
              : 'unverified'
      }
    });
  }

  return {
    sourceType: effectiveSourceType,
    ...(input.fileName ? { fileName: input.fileName } : {}),
    totalRowsParsed: Math.max(0, lines.length - startIndex),
    validContacts,
    duplicates,
    invalidEntries,
    consentNotice:
      'Importing phone numbers never automatically establishes promotional calling permission. Unsaved campaign contacts remain isolated from your permanent address book and require verified channel consent and DND clearance.'
  };
}

/**
 * Builds a BulkCampaignImportResult directly from existing saved Thaara contacts (`PhoneContactDirectory`)
 * without duplicating or mutating any permanent address book entries.
 */
export function buildSavedContactsImportResult(input: {
  phoneDirectory: PhoneContactView[];
  whatsappDirectory?: WhatsAppOptedInDirectoryEntry[];
}): BulkCampaignImportResult {
  const validContacts: BulkCampaignImportedContact[] = [];
  let rowNumber = 0;
  for (const dc of input.phoneDirectory) {
    if (dc.archived) continue;
    rowNumber++;
    const waMatch = matchWhatsAppOptedInContact(dc.displayName, dc.maskedPhone, input.whatsappDirectory);
    const activePhoneConsent = Boolean(dc.consent.callingAllowed && !dc.consent.expired);
    validContacts.push({
      contactId: `c_saved_${rowNumber}_${dc.contactId.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}`,
      phoneDirectoryContactId: dc.contactId,
      phoneDirectoryRevision: dc.revision,
      isUnsavedCampaignContact: false,
      rowNumber,
      name: dc.displayName.slice(0, 120),
      maskedPhone: dc.maskedPhone,
      preferredLanguage: 'en-IN',
      consentSourceDetail: dc.consent.source,
      optedOut: false,
      consent: {
        whatsapp: Boolean(waMatch?.optedIn),
        phone: activePhoneConsent,
        email: false,
        source: activePhoneConsent ? 'phone_directory_verified' : 'unverified'
      }
    });
  }
  return {
    sourceType: 'csv',
    fileName: 'saved-thaara-contacts',
    totalRowsParsed: validContacts.length,
    validContacts,
    duplicates: [],
    invalidEntries: [],
    consentNotice:
      'Loaded existing saved Thaara contacts with their verified directory consent state. Permanent address book entries were not modified.'
  };
}

export interface BulkCampaignEmailPlan {
  subject: string;
  bodyPreview: string;
  liveSendingEnabled: false;
}

export interface BulkCampaignState {
  campaignId: string;
  workspaceId: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  instruction: string;
  title: string;
  objective: string;
  eventDetails: string;
  webinarDetails?: BulkCampaignWebinarDetails;
  channels: BulkCampaignChannel[];
  whatsappPlan: BulkCampaignWhatsAppPlan;
  callScript: BulkCampaignCallScript;
  emailPlan?: BulkCampaignEmailPlan;
  limits: BulkCampaignLimits;
  scheduledFor?: string;
  emailConnected: boolean;
  importSummary: Omit<BulkCampaignImportResult, 'validContacts'>;
  contacts: BulkCampaignContactRecord[];
  materialHash: string;
  status: BulkCampaignStatus;
  mode?: BulkCampaignMode;
  sheetMonitor?: BulkCampaignSheetMonitorConfig;
  standingAuthorization?: BulkCampaignStandingAuthorization;
  executionMode: 'planned' | 'simulation' | 'live';
  liveCallingEnabled: boolean;
  liveSendingEnabled: boolean;
  approval?: {
    approvalId: string;
    approvedByUserId: string;
    approvedAt: string;
    approvedMaterialHash: string;
    estimatedCostInr: number;
  };
  liveExecutionGrant?: {
    grantId: string;
    workspaceId: string;
    approvedByUserId: string;
    campaignId: string;
    approvedMaterialHash: string;
    authorizedChannels: BulkCampaignChannel[];
    selectedContactIds: string[];
    limits: BulkCampaignLimits;
    grantedAt: string;
    expiresAt: string;
    revoked: boolean;
  };
  governedPlanId?: string;
  governedStepId?: string;
  governedApprovalId?: string;
  knowledgeContext?: BulkCampaignKnowledgeContext;
  pilotCall?: BulkCampaignPilotCallState;
  pilotWhatsApp?: BulkCampaignPilotWhatsAppState;
  n8nJobs?: BulkCampaignN8nExecutionJob[];
  n8nJobTokenHashes?: Record<string, string>;
  dispatchedIdempotencyKeys: string[];
}

export function computeCampaignMaterialHash(input: {
  objective: string;
  eventDetails: string;
  channels: BulkCampaignChannel[];
  whatsappPlan: BulkCampaignWhatsAppPlan;
  callScript: BulkCampaignCallScript;
  limits: BulkCampaignLimits;
  contacts: BulkCampaignContactRecord[];
  knowledgeContext?: BulkCampaignKnowledgeContext;
}): string {
  const processedKnowledgeShas = (input.knowledgeContext?.files ?? [])
    .filter(f => f.status === 'processed')
    .map(f => `${f.fileName}:${f.sha256}`);
  const canonical = JSON.stringify({
    objective: input.objective,
    eventDetails: input.eventDetails,
    channels: [...input.channels].sort(),
    whatsappPlan: input.whatsappPlan,
    callScript: input.callScript,
    limits: input.limits,
    ...(processedKnowledgeShas.length > 0 ? { knowledgeShas: processedKnowledgeShas } : {}),
    contacts: input.contacts.map(c => ({
      id: c.contact.contactId,
      name: c.contact.name,
      lang: c.contact.preferredLanguage,
      dirId: c.contact.phoneDirectoryContactId ?? null,
      selected: c.selectedByOwner,
      wa: c.whatsappEligibility,
      ph: c.phoneEligibility,
      em: c.emailEligibility
    }))
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function isQueuedPhoneEligibility(status: BulkCampaignChannelEligibilityStatus): boolean {
  return (
    status === 'queued_not_in_directory' ||
    status === 'queued_unsupported_language' ||
    status === 'queued_unsupported_region' ||
    status === 'queued_daily_quota' ||
    status === 'queued_unapproved'
  );
}

function deriveContactCategoryAndReason(input: {
  selectedByOwner: boolean;
  contact: BulkCampaignImportedContact;
  whatsappEligibility: BulkCampaignChannelEligibilityStatus;
  phoneEligibility: BulkCampaignChannelEligibilityStatus;
  emailEligibility?: BulkCampaignChannelEligibilityStatus;
}): { category: BulkCampaignContactCategory; categoryReason: string } {
  if (!input.selectedByOwner) {
    return {
      category: 'deselected',
      categoryReason: 'Deselected by owner in campaign preview.'
    };
  }
  if (input.phoneEligibility === 'queued_unsupported_region') {
    return {
      category: 'unsupported',
      categoryReason:
        'International phone number is outside the currently authorized +91 Indian outbound calling region; held back from Phone calling.'
    };
  }
  if (input.phoneEligibility === 'queued_unsupported_language') {
    return {
      category: 'unsupported',
      categoryReason: `Language "${input.contact.preferredLanguage}" is not yet supported by the published Phone API (supports en-IN, kn-IN, kn-en); queued for calling.`
    };
  }
  if (input.phoneEligibility === 'queued_daily_quota') {
    return {
      category: 'unsupported',
      categoryReason: 'Exceeds the daily live Phone calling quota (5/day default, 20/day max); queued for next approved batch.'
    };
  }
  if (
    input.whatsappEligibility === 'eligible' ||
    input.phoneEligibility === 'eligible' ||
    input.emailEligibility === 'eligible'
  ) {
    if (input.contact.isSyntheticTestFixture) {
      return {
        category: 'eligible',
        categoryReason:
          'Simulated Test Eligibility (Isolated Synthetic Fixture — non-dialable test ID; blocked from live calling).'
      };
    }
    const phoneSourceLabel = input.contact.phoneDirectoryContactId
      ? 'saved-directory Phone AI call'
      : 'campaign-scoped consented Phone AI call (unsaved contact)';
    return {
      category: 'eligible',
      categoryReason:
        input.whatsappEligibility === 'eligible' && input.phoneEligibility === 'eligible'
          ? `Authorized for both WhatsApp template invitation and ${phoneSourceLabel}.`
          : input.phoneEligibility === 'eligible'
            ? `Eligible for ${phoneSourceLabel}.`
            : input.whatsappEligibility === 'eligible'
              ? 'Eligible for WhatsApp invitation only.'
              : 'Eligible for governed Email campaign outreach.'
    };
  }
  if (input.phoneEligibility === 'skipped_dnd' || input.contact.dnd) {
    return {
      category: 'unauthorized',
      categoryReason: 'Excluded: Contact is marked DND / telemarketing restricted.'
    };
  }
  if (input.phoneEligibility === 'queued_not_in_directory') {
    return {
      category: 'unauthorized',
      categoryReason: 'Unauthorized: Unsaved phone number lacks verified calling consent and is not in PhoneContactDirectory.'
    };
  }
  return {
    category: 'unauthorized',
    categoryReason: input.contact.optedOut
      ? 'Unauthorized: Contact has opted out (DNC / Unsubscribed).'
      : 'Unauthorized: Contact lacks verified WhatsApp opt-in, Phone calling consent, or Email opt-in.'
  };
}

export function evaluateContactEligibility(
  contacts: BulkCampaignImportedContact[],
  selectedIds: Set<string>,
  channels: BulkCampaignChannel[],
  limits: BulkCampaignLimits,
  whatsappTemplatePreview: string,
  emailConnected: boolean,
  existingRecords?: Map<string, BulkCampaignContactRecord>,
  nowIso = new Date().toISOString(),
  emailBodyPreview?: string
): BulkCampaignContactRecord[] {
  let eligiblePhoneCount = 0;
  const effectivePhoneCap = Math.min(limits.maxCalls, limits.dailyPhoneCallLimit);

  return contacts.map(contact => {
    const selectedByOwner = selectedIds.has(contact.contactId);
    const prev = existingRecords?.get(contact.contactId);

    let whatsappEligibility: BulkCampaignChannelEligibilityStatus = 'skipped_channel_disabled';
    if (channels.includes('whatsapp')) {
      if (!selectedByOwner) whatsappEligibility = 'skipped_channel_disabled';
      else if (contact.optedOut) whatsappEligibility = 'skipped_opted_out';
      else if (contact.dnd) whatsappEligibility = 'skipped_dnd';
      else if (!contact.whatsappE164) whatsappEligibility = 'skipped_missing_address';
      else if (!contact.consent.whatsapp) whatsappEligibility = 'skipped_no_consent';
      else whatsappEligibility = 'eligible';
    }

    let phoneEligibility: BulkCampaignChannelEligibilityStatus = 'skipped_channel_disabled';
    if (channels.includes('phone')) {
      if (!selectedByOwner) {
        phoneEligibility = 'skipped_channel_disabled';
      } else if (contact.optedOut) {
        phoneEligibility = 'skipped_opted_out';
      } else if (contact.dnd) {
        phoneEligibility = 'skipped_dnd';
      } else if (contact.isSyntheticTestFixture) {
        if (!isSupportedPhoneCallingLanguage(contact.preferredLanguage)) {
          phoneEligibility = 'queued_unsupported_language';
        } else if (eligiblePhoneCount >= effectivePhoneCap) {
          phoneEligibility = 'queued_daily_quota';
        } else {
          phoneEligibility = 'eligible';
          eligiblePhoneCount++;
        }
      } else if (!contact.phoneE164 && !contact.phoneDirectoryContactId) {
        phoneEligibility = 'skipped_missing_address';
      } else if (
        contact.isInternational ||
        (contact.phoneE164 && !/^\+91[6-9][0-9]{9}$/.test(contact.phoneE164))
      ) {
        phoneEligibility = 'queued_unsupported_region';
      } else if (!contact.consent.phone) {
        phoneEligibility = contact.phoneDirectoryContactId
          ? 'skipped_no_consent'
          : 'queued_not_in_directory';
      } else if (!isSupportedPhoneCallingLanguage(contact.preferredLanguage)) {
        phoneEligibility = 'queued_unsupported_language';
      } else if (eligiblePhoneCount >= effectivePhoneCap) {
        phoneEligibility = 'queued_daily_quota';
      } else {
        phoneEligibility = 'eligible';
        eligiblePhoneCount++;
      }
    }

    let emailEligibility: BulkCampaignChannelEligibilityStatus = 'skipped_channel_disabled';
    if (channels.includes('email')) {
      if (!emailConnected) emailEligibility = 'skipped_connector_unconfigured';
      else if (!selectedByOwner) emailEligibility = 'skipped_channel_disabled';
      else if (contact.optedOut || prev?.emailStatus === 'unsubscribed') emailEligibility = 'skipped_opted_out';
      else if (contact.dnd) emailEligibility = 'skipped_dnd';
      else if (!contact.email) emailEligibility = 'skipped_missing_address';
      else if (!contact.consent.email) emailEligibility = 'skipped_no_consent';
      else emailEligibility = 'eligible';
    }

    let defaultPhoneStatus: BulkCampaignPhoneCallStatus = 'skipped';
    if (phoneEligibility === 'eligible') {
      defaultPhoneStatus = prev?.phoneDraft
        ? prev.phoneApprovalStatus === 'approved'
          ? 'pending'
          : 'awaiting_approval'
        : 'pending';
    } else if (isQueuedPhoneEligibility(phoneEligibility)) {
      defaultPhoneStatus = 'queued';
    }

    const { category, categoryReason } = deriveContactCategoryAndReason({
      selectedByOwner,
      contact,
      whatsappEligibility,
      phoneEligibility,
      emailEligibility
    });

    const personalizedWhatsappPreview = renderPersonalizedWhatsAppPreview(
      whatsappTemplatePreview,
      contact.name
    );
    const personalizedEmailPreview = emailBodyPreview
      ? renderPersonalizedEmailPreview(emailBodyPreview, contact.name, contact.company)
      : prev?.personalizedEmailPreview;

    const defaultEmailStatus: BulkCampaignEmailDeliveryStatus =
      prev?.emailStatus === 'unsubscribed'
        ? 'unsubscribed'
        : prev?.emailStatus && !['pending', 'skipped'].includes(prev.emailStatus)
          ? prev.emailStatus
          : emailEligibility === 'eligible'
            ? 'pending'
            : channels.includes('email')
              ? 'skipped'
              : 'not_applicable';

    return {
      contact,
      selectedByOwner,
      category,
      categoryReason,
      personalizedWhatsappPreview,
      ...(personalizedEmailPreview ? { personalizedEmailPreview } : {}),
      whatsappEligibility,
      phoneEligibility,
      emailEligibility,
      whatsappStatus:
        prev?.whatsappStatus && prev.whatsappStatus !== 'pending' && prev.whatsappStatus !== 'skipped'
          ? prev.whatsappStatus
          : whatsappEligibility === 'eligible'
            ? 'pending'
            : 'skipped',
      whatsappProviderMessageId: prev?.whatsappProviderMessageId ?? null,
      ...(prev?.whatsappDispatchId !== undefined ? { whatsappDispatchId: prev.whatsappDispatchId } : {}),
      ...(prev?.whatsappCustomerReply ? { whatsappCustomerReply: prev.whatsappCustomerReply } : {}),
      ...(prev?.whatsappError ? { whatsappError: prev.whatsappError } : {}),
      emailStatus: defaultEmailStatus,
      ...(prev?.emailMessageId !== undefined ? { emailMessageId: prev.emailMessageId } : {}),
      ...(prev?.emailError ? { emailError: prev.emailError } : {}),
      phoneStatus:
        prev?.phoneStatus &&
        !['pending', 'skipped', 'queued', 'awaiting_approval'].includes(prev.phoneStatus)
          ? prev.phoneStatus
          : defaultPhoneStatus,
      ...(prev?.phoneApprovalId ? { phoneApprovalId: prev.phoneApprovalId } : {}),
      ...(prev?.phoneApprovalStatus ? { phoneApprovalStatus: prev.phoneApprovalStatus } : {}),
      ...(prev?.phoneDraft ? { phoneDraft: prev.phoneDraft } : {}),
      phoneCallId: prev?.phoneCallId ?? null,
      ...(prev?.phoneRecordState ? { phoneRecordState: prev.phoneRecordState } : {}),
      ...(prev?.phoneLanguageUsed ? { phoneLanguageUsed: prev.phoneLanguageUsed } : {}),
      ...(prev?.phoneDisclosedAi !== undefined ? { phoneDisclosedAi: prev.phoneDisclosedAi } : {}),
      phoneRawResponses: prev?.phoneRawResponses ?? [],
      ...(prev?.phoneProviderReportText ? { phoneProviderReportText: prev.phoneProviderReportText } : {}),
      phoneReportVerified: false,
      ...(prev?.simulatedScenarioTitle
        ? { simulatedScenarioTitle: prev.simulatedScenarioTitle }
        : contact.syntheticScenarioTitle
          ? { simulatedScenarioTitle: contact.syntheticScenarioTitle }
          : {}),
      ...(prev?.simulatedDialogueTurns ? { simulatedDialogueTurns: prev.simulatedDialogueTurns } : {}),
      ...(prev?.aiInterpretation ? { aiInterpretation: prev.aiInterpretation } : {}),
      ...(prev?.phoneTranscriptSummary ? { phoneTranscriptSummary: prev.phoneTranscriptSummary } : {}),
      ...(prev?.preferredCallbackTime ? { preferredCallbackTime: prev.preferredCallbackTime } : {}),
      followUpRequired: prev?.followUpRequired ?? false,
      ...(prev?.followUpReason ? { followUpReason: prev.followUpReason } : {}),
      attendanceOutcome:
        prev?.attendanceOutcome && prev.attendanceOutcome !== 'pending' && prev.attendanceOutcome !== 'skipped'
          ? prev.attendanceOutcome
          : contact.optedOut
            ? 'opted_out'
            : whatsappEligibility === 'eligible' ||
                phoneEligibility === 'eligible' ||
                emailEligibility === 'eligible' ||
                isQueuedPhoneEligibility(phoneEligibility)
              ? 'pending'
              : 'skipped',
      ...(prev?.retryCount !== undefined ? { retryCount: prev.retryCount } : {}),
      ...(prev?.interactionTimestamp ? { interactionTimestamp: prev.interactionTimestamp } : {}),
      ...(prev?.structuredNotes ? { structuredNotes: prev.structuredNotes } : {}),
      updatedAt: nowIso
    };
  });
}

/**
 * Separates contacts into clear UX buckets:
 * 1. Eligible (authorized for WhatsApp, Phone, and/or Email)
 * 2. Unauthorized (unconsented unsaved numbers, DND, or opted out)
 * 3. Unsupported (unsupported language like hi-IN, international phone, or over daily quota)
 * 4. Duplicates (from import)
 * 5. Invalid (from import)
 */
export function categorizeBulkCampaignContacts(campaign: BulkCampaignState) {
  return {
    eligible: campaign.contacts.filter(c => c.category === 'eligible'),
    unauthorized: campaign.contacts.filter(c => c.category === 'unauthorized'),
    unsupported: campaign.contacts.filter(c => c.category === 'unsupported'),
    deselected: campaign.contacts.filter(c => c.category === 'deselected'),
    duplicates: campaign.importSummary.duplicates,
    invalidEntries: campaign.importSummary.invalidEntries
  };
}

/**
 * Extracts structured webinar/campaign details from the owner's natural-language instruction
 * and lists ONLY missing details so Thaara never asks redundant questions for provided details.
 */
export function extractWebinarCampaignDetails(instruction: string): BulkCampaignWebinarDetails {
  const timeMatch = instruction.match(
    /(?:\bat\s+|\bfrom\s+)?(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))(?:\s*(IST|UTC|GMT|EST|PST))?/
  );
  const dateMatch = instruction.match(
    /\b(tomorrow|today|this\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|next\s+\w+|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+\d{4})?|\d{4}-\d{2}-\d{2})\b/i
  );
  const durationMatch = instruction.match(/\b(\d{1,3})\s*(?:min(?:ute)?s?|hrs?|hours?)\b/i);
  const platformMatch = instruction.match(
    /\b(Zoom|Google\s+Meet|Microsoft\s+Teams|Teams|YouTube\s+Live|Webex)\b/i
  );
  const langMatch = instruction.match(/\b(English|Kannada|Kanglish|en-IN|kn-IN|kn-en)\b/i);
  const regMatch = instruction.match(
    /\b(register\s+(?:at|via|through)\s+[^.,;!?]+|registration\s+(?:via|link)[:\s]+[^.,;!?]+|reply\s+yes[^.,;!?]*|whatsapp\s+link)\b/i
  );
  const benefitsMatch = instruction.match(
    /\b(?:covering|benefits?(?:\s+include)?|learn\s+about|topics?\s+include)\s+([^.!?]{5,200})/i
  );

  const topicMatch = instruction.match(
    /have\s+(?:a\s+|an\s+)?(?:free\s+)?(.{3,80}?)(?:\s+at\s+\d|\s+on\s+(?:zoom|google\s+meet)|\s+tomorrow|[.!?]|$)/i
  );
  const altTopicMatch = !topicMatch
    ? instruction.match(
        /(?:announcing|for|about|regarding)\s+(?:our\s+|my\s+|the\s+|an?\s+)?(?!these\b|the\s+contacts\b)([A-Za-z0-9][A-Za-z0-9\s,&-]{2,60}?)(?:\s+(?:using|with|to|for\s+the\s+contacts|but\s+don['’]?t|tomorrow|at\s+[0-9])|[.!?]|$)/i
      )
    : null;
  const rawTitle = (topicMatch?.[1] ?? altTopicMatch?.[1] ?? '').replace(/\btomorrow\b/gi, '').trim();
  const title = (rawTitle || 'AI and Digital Marketing Webinar').slice(0, 160);

  let durationMinutes: number | undefined;
  if (durationMatch?.[1]) {
    const num = Number.parseInt(durationMatch[1], 10);
    const isHours = /hr|hour/i.test(durationMatch[0]);
    const mins = isHours ? num * 60 : num;
    if (mins >= 5 && mins <= 480) durationMinutes = mins;
  }

  const missingDetails: string[] = [];
  if (!rawTitle && !/\bwebinar|session|workshop|event\b/i.test(instruction)) {
    missingDetails.push('Webinar / event title');
  }
  if (!dateMatch) {
    missingDetails.push('Event date');
  }
  if (!timeMatch) {
    missingDetails.push('Start time and time zone');
  }
  if (!platformMatch) {
    missingDetails.push('Webinar platform (e.g., Zoom or Google Meet)');
  }
  if (!regMatch) {
    missingDetails.push('Registration process or joining link');
  }

  return {
    title,
    ...(dateMatch?.[1] ? { dateLabel: dateMatch[1] } : {}),
    ...(timeMatch?.[1] ? { startTime: timeMatch[1].trim() } : {}),
    timeZone: (timeMatch?.[2] ?? 'IST').toUpperCase(),
    ...(durationMinutes ? { durationMinutes } : {}),
    language: langMatch?.[1] ?? 'en-IN / kn-IN / kn-en',
    ...(platformMatch?.[1] ? { platform: platformMatch[1] } : {}),
    ...(benefitsMatch?.[1] ? { benefits: benefitsMatch[1].trim().slice(0, 400) } : {}),
    ...(regMatch?.[1] ? { registrationProcess: regMatch[1].trim().slice(0, 300) } : {}),
    callingHoursWindow: '09:00–20:00 IST',
    missingDetails
  };
}

/**
 * Stage 2: AI Campaign Planning from natural-language instruction + imported contacts.
 */
export interface UniversalCampaignAnalysis {
  kind: 'webinar' | 'services' | 'universal';
  title: string;
  topic: string;
  eventDetails: string;
  objective: string;
  openingLine: string;
  aiDisclosure: string;
  eventPitch: string;
  questions: string[];
  whatsappMessagePreview: string;
  emailSubject: string;
  emailBodyPreview: string;
  webinarDetails?: BulkCampaignWebinarDetails;
}

export function extractInstructionQuestions(instruction: string): string[] {
  const lines = instruction
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  const extracted: string[] = [];
  for (const line of lines) {
    const numbered = line.match(/^(?:\d+[.)]|[-*•])\s*(.+\?)$/);
    if (numbered && numbered[1]) {
      extracted.push(numbered[1].trim().slice(0, 240));
      continue;
    }
    if (line.endsWith('?') && line.length >= 8 && line.length <= 240) {
      extracted.push(line);
    }
  }
  if (extracted.length > 0) {
    return [...new Set(extracted)].slice(0, 10);
  }
  const inlineQuestions = instruction.match(/[^.!?\n]{8,220}\?/g) ?? [];
  if (inlineQuestions.length > 0) {
    return [...new Set(inlineQuestions.map(q => q.trim()))].slice(0, 10);
  }
  const collectItems: string[] = [];
  let inCollectSection = false;
  for (const line of lines) {
    if (/^(?:for\s+[^:]+,\s*)?(?:collect|gather|ask(?:\s+for)?|capture|qualify|details\s+to\s+collect)\s*:\s*$/i.test(line)) {
      inCollectSection = true;
      continue;
    }
    if (inCollectSection) {
      const bullet = line.match(/^(?:\d+[.)]|[-*•])\s*(.{2,120})$/);
      if (bullet && bullet[1]) {
        const clean = bullet[1].trim().replace(/[.,:;]+$/, '');
        collectItems.push(`Could you share your ${clean.toLowerCase()}?`);
      } else {
        inCollectSection = false;
      }
    }
  }
  return [...new Set(collectItems)].slice(0, 10);
}

export function analyzeCampaignInstruction(
  instruction: string,
  kbFacts?: BulkCampaignExtractedFacts
): UniversalCampaignAnalysis {
  const lower = instruction.toLowerCase();
  const namesQuantumWeave = /\b(?:quantum\s*weave|brandmint)\b/i.test(instruction);
  const namesThirdPartyBrand =
    !namesQuantumWeave &&
    (/\b(?:custom\s+teamwear|kashyap\s+inc|smilecare)\b/i.test(instruction) ||
      /\b(?:act\s+as\s+(?:the\s+)?(?:owner|senior\s+sales|sales\s+advisor|founder|representative|manager)[\s\w/-]{0,30}\bof\s+[A-Z]|calling\s+(?:from|on\s+behalf\s+of)\s+(?!quantum\s*weave\b)[A-Z])/i.test(
        instruction
      ));
  const isWebinar =
    !namesThirdPartyBrand &&
    (kbFacts?.campaignType === 'webinar' ||
      /\b(webinar|seminar|workshop|masterclass|live\s+session|upcoming\s+session|conference|summit|event\s+invitation)\b/i.test(
        instruction
      ));
  const isServices = !isWebinar && !namesThirdPartyBrand && kbFacts?.campaignType === 'services';

  if (isWebinar) {
    const rawWebinarDetails = extractWebinarCampaignDetails(instruction);
    const resolvedMissingDetails = rawWebinarDetails.missingDetails.filter(item => {
      if (/date/i.test(item) && kbFacts?.dateAndTime) return false;
      if (/start time/i.test(item) && kbFacts?.dateAndTime) return false;
      if (/registration/i.test(item) && kbFacts?.registrationInfo) return false;
      if (/platform/i.test(item) && kbFacts?.registrationInfo && /zoom|meet|teams|http/i.test(kbFacts.registrationInfo)) {
        return false;
      }
      if (/title/i.test(item) && kbFacts?.title) return false;
      return true;
    });
    const webinarDetails: BulkCampaignWebinarDetails = {
      ...rawWebinarDetails,
      ...(kbFacts?.title ? { title: kbFacts.title } : {}),
      ...(kbFacts?.dateAndTime && !rawWebinarDetails.dateLabel ? { dateLabel: kbFacts.dateAndTime } : {}),
      ...(kbFacts?.registrationInfo && !rawWebinarDetails.registrationProcess
        ? { registrationProcess: kbFacts.registrationInfo }
        : {}),
      ...(kbFacts && kbFacts.agendaTopics.length > 0 && !rawWebinarDetails.benefits
        ? { benefits: kbFacts.agendaTopics.slice(0, 4).join('; ').slice(0, 400) }
        : {}),
      missingDetails: resolvedMissingDetails
    };
    const topicMatch = instruction.match(
      /have\s+(?:an?\s+)?(.{3,80}?)\s+at\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:AM|PM|am|pm)?)/i
    );
    const altTopicMatch = !topicMatch
      ? instruction.match(
          /(?:announcing|for|about|regarding)\s+(?:our\s+|my\s+|the\s+|an?\s+)?(?!these\b|the\s+contacts\b)([A-Za-z0-9][A-Za-z0-9\s,&-]{2,60}?)(?:\s+(?:using|with|to|for\s+the\s+contacts|but\s+don['’]?t|tomorrow|at\s+[0-9])|[.!?]|$)/i
        )
      : null;
    const eventTopic =
      kbFacts?.title ??
      topicMatch?.[1]?.trim() ??
      altTopicMatch?.[1]?.trim() ??
      webinarDetails.title ??
      'AI Webinar';
    const eventTime = topicMatch?.[2]?.trim() ?? webinarDetails.startTime ?? '7:00 PM';
    const isTomorrow = /\btomorrow\b/i.test(instruction);
    const platformSuffix = webinarDetails.platform ? ` on ${webinarDetails.platform}` : '';
    const eventDetails =
      kbFacts?.dateAndTime && !topicMatch && !webinarDetails.startTime
        ? `${kbFacts.dateAndTime} — ${eventTopic}${platformSuffix}`
        : `${isTomorrow ? 'Tomorrow' : webinarDetails.dateLabel ?? 'Upcoming session'} at ${eventTime} ${webinarDetails.timeZone} — ${eventTopic}${platformSuffix}`;
    const benefitsSummary =
      (kbFacts && kbFacts.agendaTopics.length > 0
        ? kbFacts.agendaTopics.slice(0, 3).join(', ')
        : webinarDetails.benefits) ?? 'the session topics';
    const speakerNote = kbFacts && kbFacts.speakers.length > 0 ? ` Led by ${kbFacts.speakers[0]}.` : '';
    const regNote = kbFacts?.registrationInfo ? ` ${kbFacts.registrationInfo}` : '';
    const extractedQs = extractInstructionQuestions(instruction);
    const questions =
      extractedQs.length > 0
        ? extractedQs
        : [
            'Is now a convenient time for a quick update about our webinar?',
            `Would you be interested in attending ${eventTopic} at ${eventTime}?`,
            'Do you have any questions about the topics or registration, or would you like a team callback?'
          ];
    return {
      kind: 'webinar',
      title: `${eventTopic} Campaign`,
      topic: eventTopic,
      eventDetails,
      objective: `Invite eligible contacts to ${eventTopic} (${eventDetails}), answer questions accurately, confirm interest/attendance within approved limits, and generate an accurate contact-level report.`,
      openingLine:
        'Am I speaking with {{name}}? This is an AI assistant from Quantum Weave AI — is now a convenient time for a brief conversation?',
      aiDisclosure:
        'Hello, this is Thaara, an AI assistant from Quantum Weave AI calling on behalf of the workspace owner.',
      eventPitch: `We are hosting ${eventTopic} (${eventDetails}) covering ${benefitsSummary}.${speakerNote}`.slice(0, 800),
      questions,
      whatsappMessagePreview: `Hello {{1}}, you are invited to ${eventTopic} (${eventDetails}) covering ${benefitsSummary}.${speakerNote}${regNote} Reply YES to confirm your seat or STOP to opt out.`.slice(
        0,
        1024
      ),
      emailSubject: `Invitation: ${eventTopic} (${eventDetails})`,
      emailBodyPreview: `Hello {{name}}, we are excited to invite you to ${eventTopic} (${eventDetails}) covering ${benefitsSummary}.${speakerNote}${regNote ? ` ${regNote.trim()}` : ''} Reply YES to reserve your spot or UNSUBSCRIBE to opt out.`,
      webinarDetails
    };
  }

  if (isServices) {
    const eventTopic = kbFacts?.title ?? kbFacts?.servicesOffered[0] ?? 'Quantum Weave AI Solutions';
    const benefitsSummary =
      kbFacts && kbFacts.servicesOffered.length > 0
        ? kbFacts.servicesOffered.slice(0, 3).join(', ')
        : 'AI automation and digital marketing services';
    const regNote = kbFacts?.registrationInfo ? ` ${kbFacts.registrationInfo}` : '';
    const eventDetails = `${eventTopic}${kbFacts && kbFacts.servicesOffered.length > 1 ? ` — ${kbFacts.servicesOffered.slice(0, 3).join(', ')}` : ''}`;
    const extractedQs = extractInstructionQuestions(instruction);
    const questions =
      extractedQs.length > 0
        ? extractedQs
        : [
            'Is now a good time for a quick introduction from Quantum Weave AI?',
            'Which customer communication or workflow challenge are you looking to automate first?',
            'Would you like a demonstration or a callback from our team?'
          ];
    return {
      kind: 'services',
      title: `${eventTopic} Campaign`,
      topic: eventTopic,
      eventDetails,
      objective: `Introduce ${eventTopic}, answer customer questions from verified campaign knowledge, qualify business requirements, and record outcomes.`,
      openingLine:
        'Am I speaking with {{name}}? This is an AI assistant from Quantum Weave AI — is now a convenient time for a brief conversation?',
      aiDisclosure:
        'Hello, this is Thaara, an AI assistant from Quantum Weave AI calling on behalf of the workspace owner.',
      eventPitch: `We help businesses streamline operations with ${benefitsSummary}.${regNote}`.slice(0, 800),
      questions,
      whatsappMessagePreview: `Hello {{1}}, I'm Thaara from Quantum Weave AI. We help businesses with ${benefitsSummary}.${regNote} Reply YES to explore how this fits your workflow or STOP to opt out.`.slice(
        0,
        1024
      ),
      emailSubject: `${eventTopic} — Tailored AI Automation for Your Business`,
      emailBodyPreview: `Hello {{name}}, I'm reaching out from Quantum Weave AI to share how our ${benefitsSummary} can support {{company}}.${regNote ? `\n\n${regNote.trim()}` : ''} Reply YES if you would like a walkthrough or UNSUBSCRIBE to opt out.`
    };
  }

  // UNIVERSAL TOPIC-INDEPENDENT CAMPAIGN UNDERSTANDING
  const brandForMatch = instruction.match(
    /(?:(?:owner\/?senior\s+sales\s+(?:advisor|executive)|senior\s+sales\s+(?:advisor|executive)|sales\s+(?:advisor|executive)|owner|founder|agent|assistant|representative|team)\s+(?:for|of)|calling\s+(?:on\s+behalf\s+of|for)|from)\s+([A-Z][A-Za-z0-9\s&().,-]{2,56}?)(?:[.,!?\n]|$)/
  );
  const enquiryMatch = instruction.match(
    /(?:enquir(?:y|ing|ed)\s+(?:for|about|regarding)|about|for|regarding)\s+(?:our\s+|my\s+|the\s+|an?\s+)?(?!these\b|the\s+contacts\b|a\s+potential\b)([A-Za-z0-9][A-Za-z0-9\s,&-]{2,48}?)(?:[.,!?\n]|$)/i
  );
  let topic =
    kbFacts?.title?.trim() ||
    (/\bcustom\s+team\s+wear\b/i.test(lower)
      ? 'Custom Team Wear'
      : /\bcustom\s+teamwear\b/i.test(lower)
        ? 'Custom Teamwear'
        : brandForMatch?.[1]?.trim() ||
          (/\breal\s+estate\b|\bproperty\b|\bapartment\b|\bvilla\b/i.test(lower)
            ? 'Real Estate'
            : /\bdigital\s+marketing\b/i.test(lower)
              ? 'Digital Marketing'
              : /\bfeedback\b/i.test(lower)
                ? 'Customer Feedback'
                : /\brecruit|\bhiring\b|\bcandidate\b/i.test(lower)
                  ? 'Recruitment Screening'
                  : /\bappointment\b|\bbooking\b/i.test(lower)
                    ? 'Appointment Confirmation'
                    : enquiryMatch?.[1]?.trim() || ''));
  if (!topic) {
    const firstLine = instruction
      .trim()
      .split(/[.!?\n]/)[0]
      ?.replace(/^(thaara,?\s*|call\s+(?:a\s+)?(?:potential\s+)?customers?\s*(?:who\s+)?)/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    topic = firstLine ? firstLine.slice(0, 42) : 'Business Outreach';
  }
  const isEnquiry = /\benquir|\bqualif|\brequirement|\bquote|\bquotation\b|\bmeta\s+lead|\bcatalogue\b|\bsample\s+visit\b/i.test(
    lower
  );
  const isFeedback = /\bfeedback\b|\bsurvey\b|\bexperience\b/i.test(lower);
  const isRecruitment = /\brecruit|\bhiring\b|\binterview\b|\bcandidate\b/i.test(lower);
  const isAppointment = /\bappointment\b|\bbooking\b|\bschedule\b/i.test(lower);

  const title = isEnquiry && !/qualif/i.test(topic)
    ? `${topic} — Enquiry Qualification`
    : /\bcustom\s+team\s*wear\b/i.test(topic)
      ? `${topic} — Enquiry Qualification`
      : topic;

  const extractedQs = extractInstructionQuestions(instruction);
  const questions =
    extractedQs.length > 0
      ? extractedQs
      : isFeedback
        ? [
            'Is now a convenient time for a brief call regarding your recent experience?',
            'How satisfied were you overall, and is there anything we could improve?'
          ]
        : isRecruitment
          ? [
              'Is now a good time for a quick screening call regarding the role?',
              'Are you currently available and interested in discussing the next step?'
            ]
          : isAppointment
            ? [
                'Is now a convenient time to confirm your upcoming appointment?',
                'Would you like to keep the current slot or reschedule?'
              ]
            : [
                `Is now a convenient time to discuss your ${topic} requirements?`,
                'What specific requirements or questions can our team help you with?',
                'Would you like to proceed with the next step or a follow-up from our team?'
              ];

  const kbFactsSummary = [
    ...(kbFacts?.servicesOffered ?? []),
    ...(kbFacts?.agendaTopics ?? [])
  ]
    .slice(0, 3)
    .join(', ');

  const openingLine = isEnquiry
    ? `Hello, am I speaking with {{name}}? I'm Thaara, an AI assistant calling regarding your ${topic} enquiry. Is this a convenient time to discuss your requirements?`
    : `Hello {{name}}, I'm Thaara, an AI assistant calling regarding ${topic}. Is this a convenient time for a brief conversation?`;

  const naturalGuidance = /\bnatural\b|\bquestionnaire\b/i.test(lower)
    ? 'Have a natural conversation without sounding like a rigid questionnaire, avoid repeating answered questions, and do not invent prices or unverified commitments.'
    : 'Have a natural, polite conversation based strictly on the owner instructions and verified campaign knowledge without inventing unverified facts.';

  const eventPitch = `${kbFactsSummary ? `Key reference: ${kbFactsSummary}. ` : ''}${naturalGuidance}`.slice(0, 800);

  const objective = isEnquiry
    ? `Understand the customer's ${topic.toLowerCase()} requirements, qualify the enquiry, and identify the appropriate next step.`
    : instruction
        .trim()
        .split(/\r?\n/)[0]
        ?.replace(/\s+/g, ' ')
        .trim()
        .slice(0, 260) || `Conduct ${topic} outreach and record verified customer outcomes.`;

  const whatsappMessagePreview = isEnquiry
    ? `Hello {{1}}, I'm Thaara following up on your ${topic} enquiry. Please reply with your requirements or let us know a good time to connect. Reply STOP to opt out.`
    : `Hello {{1}}, I'm Thaara reaching out regarding ${topic}. Reply if you would like to discuss further, or reply STOP to opt out.`;

  return {
    kind: 'universal',
    title,
    topic,
    eventDetails: title,
    objective,
    openingLine,
    aiDisclosure: 'Hello, this is Thaara, an AI assistant calling on behalf of the workspace owner.',
    eventPitch,
    questions,
    whatsappMessagePreview: whatsappMessagePreview.slice(0, 1024),
    emailSubject: `${title}`,
    emailBodyPreview: `Hello {{name}},\n\nI'm reaching out regarding ${topic}. ${objective}\n\nReply to share your details or UNSUBSCRIBE to opt out.`
  };
}
export function createBulkCampaignPlan(input: {
  workspaceId: string;
  userId: string;
  instruction: string;
  importResult: BulkCampaignImportResult;
  channels?: BulkCampaignChannel[];
  knowledgeFiles?: BulkCampaignKnowledgeUploadInput[];
  whatsappConnectionId?: string;
  whatsappBusinessLabel?: string;
  whatsappTemplateName?: string;
  whatsappTemplateLanguage?: string;
  whatsappTemplatePreview?: string;
  emailConnected?: boolean;
  liveCallingEnabled?: boolean;
  liveSendingEnabled?: boolean;
  limits?: Partial<BulkCampaignLimits>;
  phoneDirectory?: PhoneContactView[];
  now?: Date;
}): BulkCampaignState {
  const nowIso = (input.now ?? new Date()).toISOString();
  const instruction = input.instruction.trim() || DEFAULT_DEMO_INSTRUCTION;

  const knowledgeContext =
    input.knowledgeFiles && input.knowledgeFiles.length > 0
      ? ingestCampaignKnowledgeFiles({
          files: input.knowledgeFiles,
          instruction
        })
      : undefined;
  const kbFacts = knowledgeContext?.extractedFacts;
  const plan = analyzeCampaignInstruction(instruction, kbFacts);
  const eventDetails = plan.eventDetails;
  const webinarDetails = plan.webinarDetails;

  const explicitChannels =
    input.channels && input.channels.length > 0 ? [...new Set(input.channels)] : null;
  const explicitWhatsapp = /\bwhatsapp\b/i.test(instruction);
  const wantsPhone = /\b(?:call\w*|phone|speak|ask)\b/i.test(instruction);
  const wantsEmail = /\b(?:email|gmail)\b/i.test(instruction);
  const genericInvite = /\b(?:send|invit\w*|message)\b/i.test(instruction);
  const wantsWhatsapp = explicitWhatsapp || (genericInvite && !wantsEmail);

  const channels: BulkCampaignChannel[] = explicitChannels
    ? explicitChannels
    : [
        ...(wantsWhatsapp ? (['whatsapp'] as const) : []),
        ...(wantsPhone ? (['phone'] as const) : []),
        ...(wantsEmail ? (['email'] as const) : [])
      ];
  if (channels.length === 0) channels.push('whatsapp', 'phone');
  const effectiveEmailConnected = input.emailConnected ?? channels.includes('email');

  const unlimitedDailyCalls =
    input.limits?.unlimitedDailyCalls ??
    /^unlimited$/i.test((process.env.THAARA_PHONE_DAILY_CALL_LIMIT ?? '').trim());
  const defaultLimitForPlan = unlimitedDailyCalls
    ? Math.max(100, input.importResult.validContacts.length || 100)
    : DEFAULT_DAILY_PHONE_CALL_LIMIT;
  const requestedDailyLimit = input.limits?.dailyPhoneCallLimit ?? defaultLimitForPlan;
  if (requestedDailyLimit < 1 || requestedDailyLimit > MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT) {
    throw new Error(`Daily phone call limit must be 1-${MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT}.`);
  }
  const requestedMaxCalls = input.limits?.maxCalls ?? requestedDailyLimit;
  const limits: BulkCampaignLimits = {
    maxCalls: Math.min(Math.max(1, requestedMaxCalls), MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT),
    dailyPhoneCallLimit: requestedDailyLimit,
    ...(unlimitedDailyCalls ? { unlimitedDailyCalls: true } : {}),
    maxConcurrency: input.limits?.maxConcurrency ?? 2,
    rateLimitPerMinute: input.limits?.rateLimitPerMinute ?? 5,
    ...(input.limits?.scheduleAt ? { scheduleAt: input.limits.scheduleAt } : {})
  };

  const whatsappPlan: BulkCampaignWhatsAppPlan = {
    connectionId: input.whatsappConnectionId ?? 'wa_pilot_meta_test_10813b',
    businessAccountLabel: input.whatsappBusinessLabel ?? 'Quantum Weave AI (+91 91879 51539)',
    templateName: input.whatsappTemplateName ?? 'webinar_invitation_v1',
    language: input.whatsappTemplateLanguage ?? 'en_US',
    messagePreview: (input.whatsappTemplatePreview ?? plan.whatsappMessagePreview).slice(0, 1024),
    requiresTemplateOutside24h: true
  };

  const boundedPurposePreview = knowledgeContext
    ? buildSarvamBoundedFactBrief({
        instruction,
        eventDetails,
        facts: knowledgeContext.extractedFacts,
        questions: plan.questions,
        chunks: knowledgeContext.chunks
      })
    : buildBoundedPhonePurpose({
        eventDetails,
        eventPitch: plan.eventPitch,
        questions: plan.questions
      });
  if (knowledgeContext) {
    knowledgeContext.sarvamBoundedFactBrief = boundedPurposePreview;
  }

  const callScript: BulkCampaignCallScript = {
    aiDisclosure: plan.aiDisclosure,
    openingLine: plan.openingLine,
    eventPitch: plan.eventPitch,
    questions: plan.questions,
    boundedPurposePreview,
    supportedLanguages: ['en-IN', 'kn-IN', 'kn-en']
  };

  const emailPlan: BulkCampaignEmailPlan = {
    subject: plan.emailSubject,
    bodyPreview: plan.emailBodyPreview,
    liveSendingEnabled: false
  };

  const selectedIds = new Set(input.importResult.validContacts.map(c => c.contactId));
  const contacts = evaluateContactEligibility(
    input.importResult.validContacts,
    selectedIds,
    channels,
    limits,
    whatsappPlan.messagePreview,
    effectiveEmailConnected,
    undefined,
    nowIso,
    emailPlan.bodyPreview
  );

  const objective = plan.objective;
  const materialHash = computeCampaignMaterialHash({
    objective,
    eventDetails,
    channels,
    whatsappPlan,
    callScript,
    limits,
    contacts,
    ...(knowledgeContext ? { knowledgeContext } : {})
  });

  return {
    campaignId: `camp_${crypto.randomUUID().slice(0, 8)}`,
    workspaceId: input.workspaceId,
    createdByUserId: input.userId,
    createdAt: nowIso,
    updatedAt: nowIso,
    instruction,
    title: plan.title,
    objective,
    eventDetails,
    ...(webinarDetails ? { webinarDetails } : {}),
    channels,
    whatsappPlan,
    callScript,
    emailPlan,
    limits,
    ...(limits.scheduleAt ? { scheduledFor: limits.scheduleAt } : {}),
    emailConnected: effectiveEmailConnected,
    importSummary: {
      sourceType: input.importResult.sourceType,
      ...(input.importResult.fileName ? { fileName: input.importResult.fileName } : {}),
      totalRowsParsed: input.importResult.totalRowsParsed,
      duplicates: input.importResult.duplicates,
      invalidEntries: input.importResult.invalidEntries,
      consentNotice: input.importResult.consentNotice
    },
    contacts,
    ...(knowledgeContext ? { knowledgeContext } : {}),
    materialHash,
    status: 'draft',
    executionMode: 'planned',
    liveCallingEnabled: Boolean(input.liveCallingEnabled),
    liveSendingEnabled: Boolean(input.liveSendingEnabled),
    dispatchedIdempotencyKeys: []
  };
}

/**
 * Stage 2b: Edit campaign details, contact selection, contact names/languages, WhatsApp message text,
 * email draft, calling questions, schedule, or call limits.
 * Any material change after approval automatically invalidates the approval and requires renewed owner approval.
 */
export function updateBulkCampaignPlan(
  campaign: BulkCampaignState,
  patch: {
    objective?: string;
    eventDetails?: string;
    channels?: BulkCampaignChannel[];
    whatsappTemplateName?: string;
    whatsappTemplateLanguage?: string;
    whatsappMessagePreview?: string;
    emailSubject?: string;
    emailBodyPreview?: string;
    callScript?: Partial<BulkCampaignCallScript>;
    limits?: Partial<BulkCampaignLimits>;
    maxCalls?: number;
    scheduleAt?: string;
    selectedContactIds?: string[];
    contactEdits?: Record<string, { name?: string; preferredLanguage?: BulkCampaignLanguage }>;
    ownerVerifiedConsent?: Record<
      string,
      {
        whatsapp?: boolean;
        phone?: boolean;
        email?: boolean;
        source?: 'written_consent' | 'inbound_enquiry' | 'verbal_recorded' | 'owner_verified';
        recordedAt?: string;
        campaignScope?: string;
      }
    >;
    knowledgeFiles?: BulkCampaignKnowledgeUploadInput[];
    removeKnowledgeFileIds?: string[];
  },
  now = new Date()
): BulkCampaignState {
  const nowIso = now.toISOString();
  const objective = patch.objective?.trim() || campaign.objective;
  const eventDetails = patch.eventDetails?.trim() || campaign.eventDetails;
  const webinarDetails = patch.eventDetails?.trim()
    ? extractWebinarCampaignDetails(`${campaign.instruction} ${patch.eventDetails.trim()}`)
    : campaign.webinarDetails;
  const channels = patch.channels ?? campaign.channels;
  const whatsappPlan: BulkCampaignWhatsAppPlan = {
    ...campaign.whatsappPlan,
    ...(patch.whatsappTemplateName?.trim() ? { templateName: patch.whatsappTemplateName.trim() } : {}),
    ...(patch.whatsappTemplateLanguage?.trim() ? { language: patch.whatsappTemplateLanguage.trim() } : {}),
    ...(patch.whatsappMessagePreview ? { messagePreview: patch.whatsappMessagePreview.trim() } : {})
  };
  const emailPlan: BulkCampaignEmailPlan | undefined =
    campaign.emailPlan || patch.emailSubject || patch.emailBodyPreview
      ? {
          subject: patch.emailSubject?.trim() || campaign.emailPlan?.subject || `Invitation: ${campaign.title}`,
          bodyPreview:
            patch.emailBodyPreview?.trim() ||
            campaign.emailPlan?.bodyPreview ||
            `Hello {{name}}, you are invited to ${eventDetails}.`,
          liveSendingEnabled: false
        }
      : undefined;

  const nextEventPitch = patch.callScript?.eventPitch?.trim() || campaign.callScript.eventPitch;
  const nextQuestions = patch.callScript?.questions ?? campaign.callScript.questions;

  let nextKnowledgeContext: BulkCampaignKnowledgeContext | undefined = campaign.knowledgeContext
    ? structuredClone(campaign.knowledgeContext)
    : undefined;
  const removeIds = new Set(patch.removeKnowledgeFileIds ?? []);
  if (removeIds.size > 0 || (patch.knowledgeFiles && patch.knowledgeFiles.length > 0)) {
    const retainedInputs: BulkCampaignKnowledgeUploadInput[] = [];
    if (campaign.knowledgeContext) {
      for (const existingFile of campaign.knowledgeContext.files) {
        if (removeIds.has(existingFile.fileId) || existingFile.status !== 'processed') continue;
        const reconstructedText = campaign.knowledgeContext.chunks
          .filter(ch => ch.fileId === existingFile.fileId)
          .map(ch => (ch.heading ? `${ch.heading}\n${ch.text}` : ch.text))
          .join('\n\n');
        if (reconstructedText.trim()) {
          retainedInputs.push({
            fileName: existingFile.fileName,
            rawText: reconstructedText
          });
        }
      }
    }
    const combinedInputs = [...retainedInputs, ...(patch.knowledgeFiles ?? [])];
    nextKnowledgeContext =
      combinedInputs.length > 0
        ? ingestCampaignKnowledgeFiles({
            files: combinedInputs,
            instruction: campaign.instruction,
            eventDetails,
            questions: nextQuestions
          })
        : undefined;
  }

  const nextBoundedPurpose = nextKnowledgeContext
    ? buildSarvamBoundedFactBrief({
        instruction: campaign.instruction,
        eventDetails,
        facts: nextKnowledgeContext.extractedFacts,
        questions: nextQuestions
      })
    : buildBoundedPhonePurpose({
        eventDetails,
        eventPitch: nextEventPitch,
        questions: nextQuestions
      });
  if (nextKnowledgeContext) {
    nextKnowledgeContext.sarvamBoundedFactBrief = nextBoundedPurpose;
  }

  const callScript: BulkCampaignCallScript = {
    ...campaign.callScript,
    ...(patch.callScript ?? {}),
    openingLine:
      patch.callScript?.openingLine && patch.callScript.openingLine.trim().length >= 5
        ? patch.callScript.openingLine.trim()
        : campaign.callScript.openingLine,
    eventPitch: nextEventPitch,
    questions: nextQuestions,
    boundedPurposePreview: nextBoundedPurpose,
    supportedLanguages: ['en-IN', 'kn-IN', 'kn-en'],
    aiDisclosure:
      patch.callScript?.aiDisclosure && patch.callScript.aiDisclosure.trim().length >= 10
        ? patch.callScript.aiDisclosure.trim()
        : campaign.callScript.aiDisclosure
  };

  if (
    patch.limits?.dailyPhoneCallLimit !== undefined &&
    (patch.limits.dailyPhoneCallLimit < 1 || patch.limits.dailyPhoneCallLimit > MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT)
  ) {
    throw new Error(`Daily phone call limit must be 1-${MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT}.`);
  }

  const requestedMaxCalls = patch.limits?.maxCalls ?? patch.maxCalls;
  if (
    requestedMaxCalls !== undefined &&
    (!Number.isFinite(requestedMaxCalls) || requestedMaxCalls < 1 || requestedMaxCalls > MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT)
  ) {
    throw new Error(`Max phone calls must be 1-${MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT}.`);
  }
  const requestedScheduleAt = patch.limits?.scheduleAt ?? patch.scheduleAt;

  const limits: BulkCampaignLimits = {
    ...campaign.limits,
    ...(patch.limits ?? {}),
    ...(requestedMaxCalls !== undefined ? { maxCalls: Math.floor(requestedMaxCalls) } : {}),
    ...(requestedScheduleAt !== undefined
      ? requestedScheduleAt.trim()
        ? { scheduleAt: requestedScheduleAt.trim() }
        : {}
      : {})
  };

  const effectiveEmailConnected = campaign.emailConnected || channels.includes('email');

  const updatedRawContacts = campaign.contacts.map(r => {
    const consentOverride = patch.ownerVerifiedConsent?.[r.contact.contactId];
    const contactEdit = patch.contactEdits?.[r.contact.contactId];
    let nextContact = r.contact;
    if (contactEdit) {
      nextContact = {
        ...nextContact,
        ...(contactEdit.name?.trim() ? { name: contactEdit.name.trim().slice(0, 120) } : {}),
        ...(contactEdit.preferredLanguage ? { preferredLanguage: contactEdit.preferredLanguage } : {})
      };
    }
    if (consentOverride) {
      const blocked = Boolean(nextContact.optedOut || nextContact.dnd);
      const canConsentPhone = Boolean(nextContact.phoneDirectoryContactId || nextContact.phoneE164);
      const recordedMs = consentOverride.recordedAt ? Date.parse(consentOverride.recordedAt) : NaN;
      const validRecordedAt =
        Number.isFinite(recordedMs) && recordedMs <= now.getTime() + 86_400_000
          ? new Date(recordedMs).toISOString()
          : undefined;
      const allowedSource =
        consentOverride.source === 'written_consent' ||
        consentOverride.source === 'inbound_enquiry' ||
        consentOverride.source === 'verbal_recorded'
          ? ('owner_verified' as const)
          : ('owner_verified' as const);
      nextContact = {
        ...nextContact,
        consent: {
          ...nextContact.consent,
          whatsapp: blocked ? false : (consentOverride.whatsapp ?? nextContact.consent.whatsapp),
          phone: blocked || !canConsentPhone ? false : (consentOverride.phone ?? nextContact.consent.phone),
          email: blocked ? false : (consentOverride.email ?? nextContact.consent.email),
          source: allowedSource,
          ...(validRecordedAt ? { recordedAt: validRecordedAt } : {})
        }
      };
    }
    return nextContact;
  });

  const selectedIds: Set<string> = patch.selectedContactIds
    ? new Set<string>(patch.selectedContactIds)
    : new Set<string>(campaign.contacts.filter(c => c.selectedByOwner).map(c => c.contact.contactId));

  const existingMap = new Map<string, BulkCampaignContactRecord>(
    campaign.contacts.map(c => [c.contact.contactId, c])
  );
  const contacts = evaluateContactEligibility(
    updatedRawContacts,
    selectedIds,
    channels,
    limits,
    whatsappPlan.messagePreview,
    effectiveEmailConnected,
    existingMap,
    nowIso,
    emailPlan?.bodyPreview
  );

  const newMaterialHash = computeCampaignMaterialHash({
    objective,
    eventDetails,
    channels,
    whatsappPlan,
    callScript,
    limits,
    contacts,
    ...(nextKnowledgeContext ? { knowledgeContext: nextKnowledgeContext } : {})
  });

  const wasApproved = Boolean(campaign.approval);
  const materialChanged = wasApproved && campaign.approval?.approvedMaterialHash !== newMaterialHash;
  const knowledgeModified = Boolean((patch.knowledgeFiles && patch.knowledgeFiles.length > 0) || removeIds.size > 0);

  const finalContacts: BulkCampaignContactRecord[] = contacts.map(c => {
    const langChanged = existingMap.get(c.contact.contactId)?.contact.preferredLanguage !== c.contact.preferredLanguage;
    if (materialChanged || langChanged || patch.callScript || patch.eventDetails || knowledgeModified) {
      const rest = { ...c };
      delete rest.phoneApprovalId;
      delete rest.phoneApprovalStatus;
      delete rest.phoneDraft;
      if (rest.phoneEligibility === 'eligible' && rest.phoneStatus === 'awaiting_approval') {
        rest.phoneStatus = 'pending';
      }
      return rest;
    }
    return c;
  });

  const restCampaign = { ...campaign };
  delete restCampaign.knowledgeContext;

  return {
    ...restCampaign,
    updatedAt: nowIso,
    objective,
    eventDetails,
    ...(webinarDetails ? { webinarDetails } : {}),
    channels,
    whatsappPlan,
    callScript,
    ...(emailPlan ? { emailPlan } : {}),
    limits,
    emailConnected: effectiveEmailConnected,
    ...(limits.scheduleAt ? { scheduledFor: limits.scheduleAt } : {}),
    contacts: finalContacts,
    ...(nextKnowledgeContext ? { knowledgeContext: nextKnowledgeContext } : {}),
    materialHash: newMaterialHash,
    status: materialChanged ? 'draft_requires_reapproval' : campaign.status,
    executionMode: campaign.executionMode ?? 'planned',
    liveCallingEnabled: Boolean(campaign.liveCallingEnabled),
    liveSendingEnabled: Boolean(campaign.liveSendingEnabled),
    ...(materialChanged ? { approval: undefined, liveExecutionGrant: undefined, standingAuthorization: undefined } : {}),
    ...(materialChanged && campaign.sheetMonitor
      ? { sheetMonitor: { ...campaign.sheetMonitor, status: 'draft' as const } }
      : {})
  };
}

/**
 * Stage 3: Owner Approval for the campaign plan.
 * Note: Phone calls STILL require individual per-call draft creation (`POST /api/v1/connectors/phone/ai/drafts`)
 * and per-call owner approval of each `approvalId` — there is no batch token bypassing per-call Phone approval.
 */
export function approveBulkCampaign(
  campaign: BulkCampaignState,
  input: {
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    expectedMaterialHash: string;
    now?: Date;
  }
): BulkCampaignState {
  if (input.role !== 'owner' && input.role !== 'admin') {
    throw new Error('Only the workspace owner or admin can approve a bulk campaign.');
  }
  if (input.expectedMaterialHash !== campaign.materialHash) {
    throw new Error('Campaign details changed since review. Please review the updated summary and approve again.');
  }
  const eligibleWa = campaign.contacts.filter(c => c.whatsappEligibility === 'eligible').length;
  const eligiblePh = campaign.contacts.filter(c => c.phoneEligibility === 'eligible').length;
  const eligibleEm = campaign.contacts.filter(c => c.emailEligibility === 'eligible').length;
  if (eligibleWa === 0 && eligiblePh === 0 && eligibleEm === 0) {
    throw new Error('No eligible contacts with verified channel consent are selected for this campaign.');
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  const estimatedCostInr = Number((eligibleWa * 0.88 + eligiblePh * 3.5).toFixed(2));

  return {
    ...campaign,
    updatedAt: nowIso,
    status: 'approved',
    executionMode: campaign.executionMode ?? 'planned',
    liveCallingEnabled: Boolean(campaign.liveCallingEnabled),
    liveSendingEnabled: Boolean(campaign.liveSendingEnabled),
    approval: {
      approvalId: `appr_camp_${crypto.randomUUID().slice(0, 8)}`,
      approvedByUserId: input.userId,
      approvedAt: nowIso,
      approvedMaterialHash: campaign.materialHash,
      estimatedCostInr
    }
  };
}

export interface BulkCampaignWhatsAppDispatchResult {
  status: 'delivered' | 'read' | 'sent' | 'queued' | 'unverified' | 'failed';
  providerMessageId: string | null;
  dispatchId?: string | null;
  error?: string;
}

export interface BulkCampaignWhatsAppAdapter {
  readonly mode: 'mock' | 'live_durable';
  readonly liveSendingEnabled?: boolean;
  sendTemplateInvitation(input: {
    campaignId: string;
    connectionId: string;
    contact: BulkCampaignImportedContact;
    templateName: string;
    language: string;
    messagePreview: string;
    eventDetails?: string;
    executionMode?: 'simulation' | 'live';
    idempotencyKey: string;
  }): Promise<BulkCampaignWhatsAppDispatchResult>;
}

export interface BulkCampaignEmailDispatchResult {
  status: 'sent' | 'queued' | 'failed';
  messageId: string | null;
  error?: string;
}

/**
 * Isolated Promotional/Campaign Email Adapter — logically separated from Phone Step 115
 * operational callback notification emails (`phone-callback-mail.ts`).
 */
export interface BulkCampaignEmailAdapter {
  readonly mode: 'test_transport' | 'governed_email';
  readonly liveSendingEnabled?: boolean;
  sendCampaignEmail(input: {
    campaignId: string;
    contact: BulkCampaignImportedContact;
    subject: string;
    bodyText: string;
    executionMode?: 'simulation' | 'live';
    idempotencyKey: string;
  }): Promise<BulkCampaignEmailDispatchResult>;
}

export class MockBulkCampaignEmailAdapter implements BulkCampaignEmailAdapter {
  readonly mode = 'test_transport' as const;
  readonly liveSendingEnabled = false;
  async sendCampaignEmail(input: {
    campaignId: string;
    contact: BulkCampaignImportedContact;
    subject: string;
    bodyText: string;
    executionMode?: 'simulation' | 'live';
    idempotencyKey: string;
  }): Promise<BulkCampaignEmailDispatchResult> {
    if (!input.contact.email || !input.contact.consent.email || input.contact.optedOut) {
      return {
        status: 'failed',
        messageId: null,
        error: 'Recipient lacks verified email consent or valid email address.'
      };
    }
    if (input.contact.email.startsWith('bounce@') || input.contact.email.startsWith('fail@')) {
      return {
        status: 'failed',
        messageId: null,
        error: 'Simulated SMTP transient delivery failure for test verification.'
      };
    }
    const hash = crypto.createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 12);
    return {
      status: 'sent',
      messageId: `email.sim.${hash}`
    };
  }
}

/**
 * Contract-compatible Phone adapter matching the real published endpoints in `apps/api/src/routes/phone-calling.ts`
 * and schemas in `packages/contracts/src/phone-calling.ts`.
 */
export interface BulkCampaignPhoneAdapter {
  readonly mode: 'mock' | 'published_phone_api';
  readonly liveCallingEnabled?: boolean;
  readonly integrationContract: PhoneBatchIntegrationContract;
  readonly dailyCallLimit: number;
  /** `GET /api/v1/connectors/phone/ai/contacts` */
  listDirectoryContacts(): Promise<{ contacts: PhoneContactView[] }>;
  /** `POST /api/v1/connectors/phone/ai/drafts` */
  prepareDraft(payload: PhoneCallingPrepare): Promise<PhoneCallingPrepared>;
  /** `GET /api/v1/connectors/phone/ai/requests` (open pending/approved drafts only) */
  listOpenRequests(): Promise<{ requests: PhoneCallingRequest[] }>;
  /** Per-call owner approval of a specific `approvalId` */
  approveCallDraft(input: {
    approvalId: string;
    approverUserId: string;
    persistedDraft?: PhoneCallingDraft;
  }): Promise<{ approvalId: string; status: 'approved' }>;
  /** `POST /api/v1/connectors/phone/ai/simulations` or `POST /api/v1/connectors/phone/ai/calls/confirm` */
  placeOrSimulateApprovedCall(input: {
    approvalId: string;
    mode: 'simulation' | 'live';
    persistedDraft?: PhoneCallingDraft;
    persistedApproverUserId?: string;
    knowledgeContext?: BulkCampaignKnowledgeContext;
  }): Promise<PhoneCallingRecord>;
  /** Narrowly scoped single-call pilot execution through the existing Phone Calling Agent (bulk live remains disabled). */
  placeSinglePilotCall?(input: {
    approvalId: string;
    campaignId: string;
    contactId: string;
  }): Promise<PhoneCallingRecord>;
  /** `GET /api/v1/connectors/phone/ai/calls` */
  listCallHistory(): Promise<{ calls: PhoneCallingRecord[]; durable: boolean; liveCallingEnabled: boolean }>;
  /** `POST /api/v1/connectors/phone/ai/calls/:callId/result` */
  readProviderResult(callId: string): Promise<PhoneCallingProviderResult>;
}

export const CODEX_PHONE_BATCH_INTEGRATION_CONTRACT: PhoneBatchIntegrationContract = {
  contactsDirectoryEndpoint: 'GET /api/v1/connectors/phone/ai/contacts',
  prepareDraftEndpoint: 'POST /api/v1/connectors/phone/ai/drafts',
  openRequestsEndpoint: 'GET /api/v1/connectors/phone/ai/requests',
  confirmLiveCallEndpoint: 'POST /api/v1/connectors/phone/ai/calls/confirm',
  placeApprovedCallEndpoint: 'POST /api/v1/connectors/phone/ai/calls',
  simulateCallEndpoint: 'POST /api/v1/connectors/phone/ai/simulations',
  callHistoryEndpoint: 'GET /api/v1/connectors/phone/ai/calls',
  providerResultEndpoint: 'POST /api/v1/connectors/phone/ai/calls/:callId/result',
  supportedLanguages: ['en-IN', 'kn-IN', 'kn-en'],
  maxPurposeLength: SARVAM_MAX_CALL_PURPOSE_CHARS,
  defaultDailyLiveCallLimit: DEFAULT_DAILY_PHONE_CALL_LIMIT,
  maxConfiguredDailyLiveCallLimit: MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT
};

function buildMockAiDisclosure(language: PhoneCallingLanguage): string {
  if (language === 'kn-IN') {
    return 'ನಮಸ್ಕಾರ, ನಾನು ಥಾರಾ (Thaara), ಮಾಲೀಕರ ಪರವಾಗಿ ಕರೆ ಮಾಡುತ್ತಿರುವ ಎಐ ಸಹಾಯಕಿ.';
  }
  if (language === 'kn-en') {
    return 'Namaskara, naanu Thaara, workspace owner paravagi call maaduttiruva AI assistant.';
  }
  return 'Hello, this is Thaara, an AI assistant calling on behalf of the workspace owner.';
}

function computeContactBindingHash(contact: PhoneContactView): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ id: contact.contactId, rev: contact.revision, masked: contact.maskedPhone }))
    .digest('hex');
}

const MOCK_PROVIDER_BINDING_HASH = crypto
  .createHash('sha256')
  .update('sarvam_mock_provider_v1')
  .digest('hex');

/**
 * Deterministic local Mock WhatsApp Adapter for First & Next Milestone demonstration and tests.
 */
export class MockBulkCampaignWhatsAppAdapter implements BulkCampaignWhatsAppAdapter {
  readonly mode = 'mock' as const;
  readonly liveSendingEnabled = false;
  async sendTemplateInvitation(input: {
    campaignId: string;
    connectionId: string;
    contact: BulkCampaignImportedContact;
    templateName: string;
    language: string;
    messagePreview: string;
    idempotencyKey: string;
  }): Promise<BulkCampaignWhatsAppDispatchResult> {
    const hash = crypto.createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 12);
    return {
      status: 'delivered',
      providerMessageId: `wamid.mock.${hash}`
    };
  }
}

/**
 * Contract-compatible Mock Phone Adapter that strictly validates every request and response
 * against the published TypeBox schemas in `packages/contracts/src/phone-calling.ts`.
 */
export class MockBulkCampaignPhoneAdapter implements BulkCampaignPhoneAdapter {
  readonly mode = 'mock' as const;
  readonly liveCallingEnabled = false;
  readonly integrationContract = CODEX_PHONE_BATCH_INTEGRATION_CONTRACT;
  readonly dailyCallLimit: number;
  private readonly directory: PhoneContactView[];
  private readonly openRequests = new Map<string, PhoneCallingRequest & { approverUserId?: string }>();
  private readonly callsByApproval = new Map<string, PhoneCallingRecord>();
  private readonly callsById = new Map<string, PhoneCallingRecord>();

  constructor(options?: { dailyCallLimit?: number; directory?: PhoneContactView[] }) {
    const limit = options?.dailyCallLimit ?? DEFAULT_DAILY_PHONE_CALL_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT) {
      throw new Error(`Daily phone call limit must be 1-${MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT}.`);
    }
    this.dailyCallLimit = limit;
    this.directory = structuredClone(options?.directory ?? DEFAULT_DEMO_PHONE_DIRECTORY);
    for (const c of this.directory) {
      if (!Value.Check(PhoneContactListSchema, { contacts: [c] })) {
        throw new Error(`Invalid PhoneContactDirectory entry for ${c.contactId}`);
      }
    }
  }

  async listDirectoryContacts(): Promise<{ contacts: PhoneContactView[] }> {
    const payload = { contacts: structuredClone(this.directory.filter(c => !c.archived)) };
    if (!Value.Check(PhoneContactListSchema, payload)) {
      throw new Error('PhoneContactListSchema validation failed');
    }
    return payload;
  }

  async prepareDraft(payload: PhoneCallingPrepare): Promise<PhoneCallingPrepared> {
    if (!Value.Check(PhoneCallingPrepareSchema, payload)) {
      throw new Error('PHONE_CALLING_INPUT: Request does not match PhoneCallingPrepareSchema.');
    }
    const purpose = payload.purpose.replace(/\s+/g, ' ').trim();
    if (!purpose || purpose.length > SARVAM_MAX_CALL_PURPOSE_CHARS) {
      throw new Error(`PHONE_CALLING_INPUT: Purpose must be 1-${SARVAM_MAX_CALL_PURPOSE_CHARS} characters.`);
    }
    const queryTrimmed = payload.contactQuery.trim();
    const queryLower = queryTrimmed.toLowerCase();
    const matches = this.directory.filter(
      c =>
        !c.archived &&
        (c.displayName.toLowerCase().includes(queryLower) ||
          c.aliases.some(a => a.toLowerCase().includes(queryLower)))
    );
    const contact = payload.selectedContactId
      ? matches.find(c => c.contactId === payload.selectedContactId)
      : matches.length === 1
        ? matches[0]
        : undefined;

    let draft: PhoneCallingDraft;
    if (contact) {
      if (!contact.consent.callingAllowed || contact.consent.expired) {
        throw new Error('PHONE_CONSENT_REQUIRED: Contact does not have active calling consent.');
      }
      draft = {
        draftId: crypto.randomUUID(),
        contactId: contact.contactId,
        contactRevision: contact.revision,
        contactBindingHash: computeContactBindingHash(contact),
        recipient: {
          displayName: contact.displayName,
          maskedPhone: contact.maskedPhone
        },
        purpose,
        language: payload.language,
        maxDurationSeconds: payload.maxDurationSeconds ?? 180,
        aiDisclosure: payload.openingGreeting?.trim().slice(0, 300) || buildMockAiDisclosure(payload.language),
        consentReference: `consent_${contact.contactId}_r${contact.revision}`,
        idempotencyKey: crypto.randomUUID(),
        mode: 'simulation',
        providerBindingHash: MOCK_PROVIDER_BINDING_HASH
      };
    } else if (payload.newRecipient && !payload.selectedContactId && /^\+91[6-9][0-9]{9}$/.test(queryTrimmed)) {
      if (!payload.newRecipient.consentConfirmed) {
        throw new Error('PHONE_CONSENT_REQUIRED: Unsaved campaign contact requires verified calling consent.');
      }
      // Campaign-scoped one-call identity (`onecall_`) — NEVER mutates `this.directory`!
      const oneCallId = `onecall_${crypto.randomUUID()}`;
      const displayName = payload.newRecipient.displayName.trim().slice(0, 128) || 'Campaign Contact';
      const maskedPhone = `+91 ******${queryTrimmed.slice(-4)}`;
      const bindingHash = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            oneCallId,
            phoneE164: queryTrimmed,
            displayName,
            purpose,
            consentConfirmed: true
          })
        )
        .digest('hex');
      draft = {
        draftId: crypto.randomUUID(),
        newRecipient: {
          ...(payload.newRecipient.previewApprovalId
            ? { previewApprovalId: payload.newRecipient.previewApprovalId }
            : {}),
          phoneE164: queryTrimmed,
          consentConfirmed: true,
          eligibility: 'eligible'
        },
        contactId: oneCallId,
        contactRevision: 1,
        contactBindingHash: bindingHash,
        recipient: {
          displayName,
          maskedPhone
        },
        purpose,
        language: payload.language,
        maxDurationSeconds: payload.maxDurationSeconds ?? 180,
        aiDisclosure: payload.openingGreeting?.trim().slice(0, 300) || buildMockAiDisclosure(payload.language),
        consentReference: `consent_${oneCallId.slice(0, 24)}`,
        idempotencyKey: crypto.randomUUID(),
        mode: 'simulation',
        providerBindingHash: MOCK_PROVIDER_BINDING_HASH
      };
    } else {
      throw new Error('PHONE_CONTACT_NOT_FOUND: Contact must exist in PhoneContactDirectory or provide consented newRecipient.');
    }

    const approvalId = crypto.randomUUID();
    const prepared: PhoneCallingPrepared = {
      draft,
      approvalId,
      planId: crypto.randomUUID(),
      stepId: crypto.randomUUID(),
      status: 'awaiting_approval',
      liveCallingEnabled: false
    };

    if (!Value.Check(PhoneCallingPreparedSchema, prepared)) {
      throw new Error('PhoneCallingPreparedSchema validation failed.');
    }

    this.openRequests.set(approvalId, {
      approvalId,
      status: 'pending',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      draft: structuredClone(draft)
    });

    return prepared;
  }

  async listOpenRequests(): Promise<{ requests: PhoneCallingRequest[] }> {
    const requests: PhoneCallingRequest[] = [];
    for (const req of this.openRequests.values()) {
      if (!this.callsByApproval.has(req.approvalId)) {
        requests.push({
          approvalId: req.approvalId,
          status: req.status,
          expiresAt: req.expiresAt,
          draft: structuredClone(req.draft)
        });
      }
    }
    const out = { requests: requests.slice(0, 20) };
    if (!Value.Check(PhoneCallingRequestListSchema, out)) {
      throw new Error('PhoneCallingRequestListSchema validation failed.');
    }
    return out;
  }

  async approveCallDraft(input: {
    approvalId: string;
    approverUserId: string;
    persistedDraft?: PhoneCallingDraft;
  }): Promise<{ approvalId: string; status: 'approved' }> {
    let req = this.openRequests.get(input.approvalId);
    if (!req && input.persistedDraft?.contactId?.startsWith('pdir_')) {
      req = {
        approvalId: input.approvalId,
        status: 'pending',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        draft: structuredClone(input.persistedDraft)
      };
      this.openRequests.set(input.approvalId, req);
    }
    if (!req) {
      throw new Error(`PHONE_CALLING_DENIED: Unknown approvalId ${input.approvalId}`);
    }
    req.status = 'approved';
    req.approverUserId = input.approverUserId;
    return { approvalId: input.approvalId, status: 'approved' };
  }

  async placeOrSimulateApprovedCall(input: {
    approvalId: string;
    mode: 'simulation' | 'live';
    persistedDraft?: PhoneCallingDraft;
    persistedApproverUserId?: string;
    knowledgeContext?: BulkCampaignKnowledgeContext;
  }): Promise<PhoneCallingRecord> {
    const existing = this.callsByApproval.get(input.approvalId);
    if (existing) {
      return structuredClone(existing);
    }

    let req = this.openRequests.get(input.approvalId);
    if (
      !req &&
      input.mode === 'simulation' &&
      input.persistedDraft?.contactId?.startsWith('pdir_') &&
      input.persistedApproverUserId
    ) {
      req = {
        approvalId: input.approvalId,
        status: 'approved',
        approverUserId: input.persistedApproverUserId,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        draft: structuredClone(input.persistedDraft)
      };
      this.openRequests.set(input.approvalId, req);
    }
    if (!req || req.status !== 'approved' || !req.approverUserId) {
      throw new Error('PHONE_CALLING_DENIED: Per-call owner approval is required before placing or simulating a call.');
    }

    let recipientView: { displayName: string; maskedPhone: string };
    if (req.draft.newRecipient && req.draft.contactId.startsWith('onecall_')) {
      if (
        !req.draft.newRecipient.consentConfirmed ||
        req.draft.newRecipient.eligibility !== 'eligible' ||
        req.draft.providerBindingHash !== MOCK_PROVIDER_BINDING_HASH ||
        !req.draft.aiDisclosure?.trim() ||
        req.draft.aiDisclosure.length > 300
      ) {
        throw new Error('PHONE_CALLING_DENIED: Unsaved campaign contact consent or provider binding invalid.');
      }
      recipientView = {
        displayName: req.draft.recipient.displayName,
        maskedPhone: req.draft.recipient.maskedPhone
      };
    } else {
      const contact = this.directory.find(c => c.contactId === req.draft.contactId && !c.archived);
      if (
        !contact ||
        contact.revision !== req.draft.contactRevision ||
        computeContactBindingHash(contact) !== req.draft.contactBindingHash ||
        req.draft.providerBindingHash !== MOCK_PROVIDER_BINDING_HASH ||
        !req.draft.aiDisclosure?.trim() ||
        req.draft.aiDisclosure.length > 300
      ) {
        throw new Error('PHONE_CALLING_DENIED: Contact or provider binding hash mismatch.');
      }
      if (!contact.consent.callingAllowed || contact.consent.expired) {
        throw new Error('PHONE_CONSENT_REQUIRED: Contact calling consent is missing or expired.');
      }
      recipientView = {
        displayName: contact.displayName,
        maskedPhone: contact.maskedPhone
      };
    }

    if (this.callsById.size >= this.dailyCallLimit) {
      throw new Error(`PHONE_DAILY_LIMIT_EXCEEDED: Daily phone call limit of ${this.dailyCallLimit} reached.`);
    }

    const simOutcome = this.buildSimulatedCallOutcome(recipientView, req.draft, input.knowledgeContext);
    const nowIso = new Date().toISOString();
    const record: PhoneCallingRecord = {
      id: crypto.randomUUID(),
      approvalId: input.approvalId,
      draft: structuredClone(req.draft),
      state: simOutcome.state,
      createdAt: nowIso,
      updatedAt: nowIso,
      providerCallId: `20261105/sim_${req.draft.contactId}`,
      verified: false,
      simulated: input.mode === 'simulation',
      dispatchStatus: 'unverified',
      report: {
        text: simOutcome.reportText,
        spokenText: simOutcome.spokenText,
        quotedResponses: simOutcome.quotedResponses,
        evidenceIds: simOutcome.quotedResponses.map((_, idx) => `ev_${idx + 1}`),
        verified: false,
        simulated: input.mode === 'simulation'
      }
    };

    if (!Value.Check(PhoneCallingRecordSchema, record)) {
      throw new Error('PhoneCallingRecordSchema validation failed.');
    }

    this.callsByApproval.set(input.approvalId, record);
    this.callsById.set(record.id, record);
    return structuredClone(record);
  }

  async listCallHistory(): Promise<{ calls: PhoneCallingRecord[]; durable: boolean; liveCallingEnabled: boolean }> {
    return {
      calls: [...this.callsById.values()].map(c => structuredClone(c)),
      durable: false,
      liveCallingEnabled: false
    };
  }

  async readProviderResult(callId: string): Promise<PhoneCallingProviderResult> {
    const record = this.callsById.get(callId);
    if (!record) {
      const unavailable: PhoneCallingProviderResult = {
        callId,
        status: 'unavailable',
        responses: [],
        verified: false,
        source: 'provider_api'
      };
      return unavailable;
    }
    const outcome: PhoneCallingProviderResult['outcome'] =
      record.state === 'completed' || record.state === 'answered'
        ? 'completed'
        : record.state === 'no_answer'
          ? 'no_answer'
          : record.state === 'busy'
            ? 'busy'
            : 'failed';
    const result: PhoneCallingProviderResult = {
      callId,
      status: 'available',
      outcome,
      responses: [...record.report.quotedResponses],
      verified: false,
      source: 'provider_api'
    };
    if (!Value.Check(PhoneCallingProviderResultSchema, result)) {
      throw new Error('PhoneCallingProviderResultSchema validation failed.');
    }
    return result;
  }

  private buildSimulatedCallOutcome(
    contact: { displayName: string; maskedPhone: string },
    draft: PhoneCallingDraft,
    knowledgeContext?: BulkCampaignKnowledgeContext
  ): {
    state: PhoneCallingState;
    quotedResponses: string[];
    reportText: string;
    spokenText: string;
  } {
    const nameLower = contact.displayName.toLowerCase();
    const last4 = contact.maskedPhone.slice(-4);

    if (nameLower.includes('moreinfo') || nameLower.includes('meera')) {
      const quotes = ['Could you send me more details and the agenda on WhatsApp before I decide?'];
      return {
        state: 'completed',
        quotedResponses: quotes,
        reportText: `Provider report is unverified. ${contact.displayName} said: "${quotes[0]}"`,
        spokenText: `This was a test simulation. ${contact.displayName} said: ${quotes[0]}`
      };
    }
    if (nameLower.includes('busy')) {
      return {
        state: 'busy',
        quotedResponses: [],
        reportText: `Provider report is unverified. ${contact.displayName} line was busy.`,
        spokenText: `This was a test simulation. ${contact.displayName} line was busy.`
      };
    }
    if (nameLower.includes('decline') || nameLower.includes('rohan')) {
      const quotes = ['No thank you, I am not interested in attending tomorrow.'];
      return {
        state: 'completed',
        quotedResponses: quotes,
        reportText: `Provider report is unverified. ${contact.displayName} said: "${quotes[0]}"`,
        spokenText: `This was a test simulation. ${contact.displayName} said: ${quotes[0]}`
      };
    }
    if (nameLower.includes('kavya') || last4 === '0002') {
      const quotes = [
        'ನಮಸ್ಕಾರ, ನಾನು ವೆಬಿನಾರ್ ಬಗ್ಗೆ ಆಸಕ್ತಿ ಹೊಂದಿದ್ದೇನೆ. ನಾಳೆ ಸಂಜೆ 4 ಗಂಟೆಗೆ ನನಗೆ ಕಾಲ್ ಬ್ಯಾಕ್ ಮಾಡಿ.'
      ];
      return {
        state: 'completed',
        quotedResponses: quotes,
        reportText: `Provider report is unverified. ${contact.displayName} said: "${quotes[0]}"`,
        spokenText: `This was a test simulation. ${contact.displayName} said: ${quotes[0]}`
      };
    }
    if (nameLower.includes('darshan') || last4 === '0003') {
      return {
        state: 'no_answer',
        quotedResponses: [],
        reportText: `Provider report is unverified. ${contact.displayName} did not answer.`,
        spokenText: `This was a test simulation. ${contact.displayName} did not answer.`
      };
    }
    if (nameLower.includes('ananya') || last4 === '0004') {
      const quotes = [
        'Yes, I will attend the AI and Digital Marketing webinar tomorrow at 7 PM. Please send me the joining link.'
      ];
      return {
        state: 'completed',
        quotedResponses: quotes,
        reportText: `Provider report is unverified. ${contact.displayName} said: "${quotes[0]}"`,
        spokenText: `This was a test simulation. ${contact.displayName} said: ${quotes[0]}`
      };
    }
    if (nameLower.includes('vikram') || last4 === '0005') {
      const quotes = [
        'No thank you, I cannot attend tomorrow and please opt me out of future promotional calls.'
      ];
      return {
        state: 'completed',
        quotedResponses: quotes,
        reportText: `Provider report is unverified. ${contact.displayName} said: "${quotes[0]}"`,
        spokenText: `This was a test simulation. ${contact.displayName} said: ${quotes[0]}`
      };
    }

    if (knowledgeContext && knowledgeContext.files.some(f => f.status === 'processed')) {
      const isServices = knowledgeContext.extractedFacts.campaignType === 'services';
      const q1 = isServices ? 'How does an AI Voice Agent work?' : 'What will I learn?';
      const q2 = isServices ? 'How much does it cost?' : 'How do I register?';
      const a1 = answerCampaignCustomerQuestion({ question: q1, knowledgeContext });
      const a2 = answerCampaignCustomerQuestion({ question: q2, knowledgeContext });
      const closingQuote = `Yes, I am interested (${draft.language})! Count me in.`;
      const quotes = [q1, q2, closingQuote].map(s => s.slice(0, 950));
      const dialogueText = [
        `[SIMULATION-ONLY MULTI-TURN TRANSCRIPT — Unverified]`,
        `Customer (${contact.displayName}): "${q1}"`,
        `Thaara (${a1.sourceRefs.join(', ')}): "${a1.answer}"`,
        `Customer (${contact.displayName}): "${q2}"`,
        `Thaara (${a2.sourceRefs.join(', ')}): "${a2.answer}"`,
        `Customer (${contact.displayName}): "${closingQuote}"`
      ]
        .join('\n')
        .slice(0, 15000);
      return {
        state: 'completed',
        quotedResponses: quotes,
        reportText: dialogueText,
        spokenText: `This was a test simulation. ${contact.displayName} asked follow-up questions and said: ${closingQuote}`.slice(
          0,
          15000
        )
      };
    }

    const quotes = [
      `Yes, I am joining the session (${draft.language}). Count me in for 7 PM.`
    ];
    return {
      state: 'completed',
      quotedResponses: quotes,
      reportText: `Provider report is unverified. ${contact.displayName} said: "${quotes[0]}"`,
      spokenText: `This was a test simulation. ${contact.displayName} said: ${quotes[0]}`
    };
  }
}

/**
 * Derives an explicitly labelled AI interpretation from the verified call state and raw transcript responses.
 * Never marks a contact confirmed/interested without an affirmative response, and `confirmedByEvidence` is always `false`.
 */
export function deriveCampaignCallAiInterpretation(
  state: PhoneCallingState,
  rawResponses: string[]
): BulkCampaignAiInterpretation {
  if (state === 'busy') {
    return {
      attendanceClassification: 'busy',
      rationale: 'Call ended in state "busy" with no recipient transcript responses.',
      isAiInterpretation: true,
      confirmedByEvidence: false
    };
  }
  if (state === 'no_answer') {
    return {
      attendanceClassification: 'no_response',
      rationale: 'Call ended in state "no_answer" with no recipient transcript responses.',
      isAiInterpretation: true,
      confirmedByEvidence: false
    };
  }
  if (state === 'failed' || state === 'cancelled') {
    return {
      attendanceClassification: 'failed',
      rationale: `Call ended in state "${state}".`,
      isAiInterpretation: true,
      confirmedByEvidence: false
    };
  }

  const combined = rawResponses.join(' ').toLowerCase();
  if (!combined.trim()) {
    return {
      attendanceClassification: 'no_response',
      rationale: 'Call completed but no spoken response was captured in the transcript.',
      isAiInterpretation: true,
      confirmedByEvidence: false
    };
  }

  if (/\b(?:opt(?:\s+me)?\s*out|do\s+not\s+call|stop\s+calling|unsubscribe|remove\s+my\s+number)\b/i.test(combined)) {
    return {
      attendanceClassification: 'opted_out',
      rationale: 'AI interpretation of raw transcript: recipient requested opt-out from future calls (unverified).',
      isAiInterpretation: true,
      confirmedByEvidence: false
    };
  }

  if (/(?:\bcall\s*back\b|ಕರೆ\s*ಮಾಡಿ|ಕಾಲ್\s*ಬ್ಯಾಕ್|\blater\b|\b4\s*pm\b|4\s*ಗಂಟೆಗೆ)/i.test(combined)) {
    const timeMatch = combined.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|ಗಂಟೆಗೆ))/i);
    const preferredCallbackTime = timeMatch ? `Tomorrow around ${timeMatch[1]}` : 'Callback requested in transcript';
    return {
      attendanceClassification: 'callback_requested',
      preferredCallbackTime,
      rationale: 'AI interpretation of raw transcript: recipient requested a follow-up callback (unverified).',
      isAiInterpretation: true,
      confirmedByEvidence: false
    };
  }

  if (
    /\b(?:cannot\s+attend|can't\s+attend|not\s+attending|not\s+interested|no\s+thank\s+you|won't\s+make\s+it)\b/i.test(
      combined
    )
  ) {
    return {
      attendanceClassification: 'declined',
      rationale: 'AI interpretation of raw transcript: recipient declined or was not interested (unverified).',
      isAiInterpretation: true,
      confirmedByEvidence: false
    };
  }

  if (
    /\b(?:more\s+info(?:rmation)?|more\s+details|send\s+(?:me\s+)?(?:the\s+)?details|brochure|agenda|syllabus|before\s+i\s+decide)\b/i.test(
      combined
    )
  ) {
    return {
      attendanceClassification: 'wants_more_info',
      rationale: 'AI interpretation of raw transcript: recipient requested more information before deciding (unverified).',
      isAiInterpretation: true,
      confirmedByEvidence: false
    };
  }

  if (
    /(?:\b(?:yes|yes,?\s*please|yes,?\s*sure|i\s+am\s+interested|interested\s+in|consultation\s+for\s+me|book\s+(?:a|an)\s+(?:consultation|demo|appointment)|schedule\s+(?:a|an)\s+(?:call|consultation|demo)|send\s+(?:a\s+)?proposal|sounds\s+good|will\s+attend|joining|count\s+me\s+in)\b|ಹೌದು|ಬರುತ್ತೇನೆ)/i.test(
      combined
    ) &&
    !/\bnot\s+interested\b/i.test(combined)
  ) {
    return {
      attendanceClassification: 'confirmed',
      rationale: 'AI interpretation of raw transcript: recipient expressed interest or requested a consultation/next step (unverified).',
      isAiInterpretation: true,
      confirmedByEvidence: false
    };
  }

  return {
    attendanceClassification: 'pending',
    rationale: 'AI interpretation of raw transcript: response was ambiguous without clear affirmation; manual review needed (unverified).',
    isAiInterpretation: true,
    confirmedByEvidence: false
  };
}

/**
 * Derives campaign-specific structured outcome notes dynamically from the campaign's approved
 * questions/objective and the recipient's actual transcript responses. Missing items are marked "Not provided".
 */
export function extractStructuredCampaignCallOutcome(input: {
  campaign: BulkCampaignState;
  rawResponses: string[];
  aiInterpretation?: BulkCampaignAiInterpretation;
  summaryText?: string;
}): string {
  const responses = input.rawResponses.map(r => r.trim()).filter(Boolean);
  const questions = (input.campaign.callScript?.questions ?? []).slice(0, 6);
  const parts: string[] = [];

  if (questions.length > 0 && responses.length > 0) {
    questions.forEach((q, idx) => {
      const answer = responses[idx] ?? 'Not provided';
      parts.push(`${q.slice(0, 80)}: ${answer.slice(0, 160)}`);
    });
  } else if (responses.length > 0) {
    parts.push(`Customer responses: ${responses.join(' | ').slice(0, 400)}`);
  } else {
    parts.push('Customer responses: Not provided');
  }

  const cls = input.aiInterpretation?.attendanceClassification ?? 'pending';
  const nextAction =
    cls === 'confirmed'
      ? 'Follow up to confirm consultation / next step'
      : cls === 'callback_requested'
        ? `Schedule callback (${input.aiInterpretation?.preferredCallbackTime ?? 'time unspecified'})`
        : cls === 'wants_more_info'
          ? 'Share requested campaign information'
          : cls === 'declined' || cls === 'opted_out'
            ? 'Do not re-contact for this campaign'
            : 'Review transcript manually';
  parts.push(`Next action: ${nextAction}`);
  if (input.summaryText) {
    parts.push(`Summary: ${input.summaryText.slice(0, 220)}`);
  }
  return parts.join(' | ').slice(0, 1000);
}

export function mapPhoneStateToCampaignCallStatus(state: PhoneCallingState): BulkCampaignPhoneCallStatus {
  switch (state) {
    case 'completed':
    case 'answered':
      return 'answered';
    case 'no_answer':
    case 'busy':
      return 'not_answered';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'queued':
    case 'ringing':
      return 'attempted';
  }
}

/**
 * Step A: Prepare individual per-call drafts (`POST /api/v1/connectors/phone/ai/drafts`)
 * for eligible contacts — supporting BOTH saved `PhoneContactDirectory` contacts AND consented unsaved
 * campaign contacts (`PhoneCallingPrepare.newRecipient` -> `onecall_`) within the daily quota (`5/day` default, `20/day` max)
 * without altering the permanent address book.
 */
export function extractCampaignBrandName(campaign: Pick<BulkCampaignState, 'title' | 'instruction' | 'knowledgeContext'>): string | null {
  const instr = (campaign.instruction ?? '').trim();
  if (/\bcustom\s+team\s+wear\b/i.test(instr)) return 'Custom Team Wear';
  if (/\bcustom\s+teamwear\b/i.test(instr)) return 'Custom Teamwear';
  const brandMatch = instr.match(
    /(?:(?:owner\/?senior\s+sales\s+(?:advisor|executive)|senior\s+sales\s+(?:advisor|executive)|sales\s+(?:advisor|executive)|ai\s+voice\s+sales\s+executive|owner|founder|agent|assistant|representative|team)\s+(?:for|of)|calling\s+(?:on\s+behalf\s+of|for|from)|from)\s+([A-Z][A-Za-z0-9\s&.-]{2,48}?)(?:\s*\(|[.,!?\n]|$)/
  );
  if (brandMatch?.[1]?.trim()) {
    return brandMatch[1].trim().replace(/\s+/g, ' ');
  }
  const titleBase = (campaign.title ?? '')
    .replace(/\s*[—–-]\s*(?:Enquiry Qualification|Campaign|Outreach|Follow-?up).*$/i, '')
    .replace(/\s+Campaign$/i, '')
    .trim();
  if (
    titleBase &&
    !/^(?:Business Outreach|Customer Feedback|Recruitment Screening|Appointment Confirmation|AI Webinar|Bulk Campaign)/i.test(
      titleBase
    )
  ) {
    return titleBase.slice(0, 60);
  }
  return null;
}

export function isResearchedProspectContact(
  campaign: Pick<BulkCampaignState, 'instruction' | 'sheetMonitor'>,
  contact?: Pick<BulkCampaignImportedContact, 'leadSource' | 'customerRequirement' | 'customFields'>
): boolean {
  const cf = contact?.customFields ?? {};
  const cfKeys = Object.keys(cf);
  const hasResearchSignalFields = cfKeys.some(k =>
    /^(?:signal_type|signal_posting_date|observed_facts|t_shirt_hypothesis|hypothesis|recommended_offer|discovery_question|verified_location|published_quantity|published_budget|event_date_or_deadline|business_category)$/i.test(
      k
    )
  );
  if (hasResearchSignalFields) return true;
  const src = (contact?.leadSource ?? '').toLowerCase();
  if (
    src &&
    /\b(?:signal|research|hiring|offsite|public|directory|linkedin|news|press|prospect|scraped|outbound\s+list)\b/i.test(
      src
    ) &&
    !/\b(?:meta\s+lead|lead\s+ad|lead\s+form|website\s+form|web\s+form|inbound|enquiry\s+form)\b/i.test(src)
  ) {
    return true;
  }
  const instr = (campaign.instruction ?? '').toLowerCase();
  if (
    /\b(?:prospect\s+list|researched\s+prospect|cold\s+outreach|signal\s+lead|hiring\s+signal)\b/i.test(instr) &&
    !/\b(?:meta\s+lead|submitted\s+(?:an?\s+)?(?:enquiry|form))\b/i.test(instr)
  ) {
    return true;
  }
  return false;
}

export function buildCampaignOutboundGreeting(
  campaign: Pick<BulkCampaignState, 'title' | 'instruction' | 'knowledgeContext' | 'sheetMonitor'>,
  contact?: Pick<BulkCampaignImportedContact, 'name' | 'preferredLanguage' | 'leadSource' | 'customerRequirement' | 'customFields'>,
  languageOverride?: PhoneCallingLanguage
): string {
  const lang = languageOverride ?? contact?.preferredLanguage ?? 'en-IN';
  const brand = extractCampaignBrandName(campaign);
  const rawName = contact?.name?.trim() ?? '';
  const hasRealName = Boolean(rawName) && !/^(?:contact|lead|row)\s+\d+$/i.test(rawName);
  const safeName = hasRealName ? rawName.replace(/[^A-Za-z0-9\u0900-\u0DFF\s.'-]/g, '').trim().slice(0, 40) : '';
  const isProspect = isResearchedProspectContact(campaign, contact);

  if (lang === 'kn-IN') {
    const greet = safeName ? `ನಮಸ್ಕಾರ ${safeName}` : 'ನಮಸ್ಕಾರ';
    if (isProspect) {
      return brand
        ? `${greet}, ನಾನು ${brand} ಇಂದ ತಾರಾ, ಒಂದು ಸಣ್ಣ ಪರಿಚಯಕ್ಕಾಗಿ ಕರೆ ಮಾಡುತ್ತಿದ್ದೇನೆ. ಈಗ ಮಾತನಾಡಲು ಅನುಕೂಲವೇ?`.slice(0, 300)
        : `${greet}, ನಾನು ತಾರಾ, ಒಂದು ಸಣ್ಣ ಮಾತುಕತೆಗಾಗಿ ಕರೆ ಮಾಡುತ್ತಿದ್ದೇನೆ. ಈಗ ಮಾತನಾಡಲು ಅನುಕೂಲವೇ?`.slice(0, 300);
    }
    return brand
      ? `${greet}, ನಾನು ${brand} ಇಂದ ತಾರಾ, ನಿಮ್ಮ ವಿಚಾರಣೆ ಕುರಿತು ಕರೆ ಮಾಡುತ್ತಿದ್ದೇನೆ. ಈಗ ಮಾತನಾಡಲು ಅನುಕೂಲವೇ?`.slice(0, 300)
      : `${greet}, ನಾನು ತಾರಾ, ನಿಮ್ಮ ವಿಚಾರಣೆ ಕುರಿತು ಕರೆ ಮಾಡುತ್ತಿದ್ದೇನೆ. ಈಗ ಮಾತನಾಡಲು ಅನುಕೂಲವೇ?`.slice(0, 300);
  }
  if (lang === 'kn-en') {
    const greet = safeName ? `Namaskara ${safeName}` : 'Namaskara';
    if (isProspect) {
      return brand
        ? `${greet}, naanu ${brand} inda Thaara, ondu quick update ge call maadtiddini. Eega maataadoke convenient aagutta?`.slice(
            0,
            300
          )
        : `${greet}, naanu Thaara, ondu quick update ge call maadtiddini. Eega maataadoke convenient aagutta?`.slice(
            0,
            300
          );
    }
    return brand
      ? `${greet}, naanu ${brand} inda Thaara, nimma enquiry follow-up ge call maadtiddini. Eega maataadoke convenient aagutta?`.slice(
          0,
          300
        )
      : `${greet}, naanu Thaara, nimma enquiry follow-up ge call maadtiddini. Eega maataadoke convenient aagutta?`.slice(
          0,
          300
        );
  }
  const greet = safeName ? `Hello ${safeName}` : 'Hello';
  if (isProspect) {
    return brand
      ? `${greet}, I am Thaara from ${brand}, reaching out briefly to connect with you. Is now a good time to talk?`.slice(
          0,
          300
        )
      : `${greet}, I am Thaara, reaching out briefly to connect with you. Is now a good time to talk?`.slice(0, 300);
  }
  return brand
    ? `${greet}, I am Thaara from ${brand}, calling to follow up on your enquiry. Is this a good time to talk?`.slice(
        0,
        300
      )
    : `${greet}, I am Thaara calling to follow up on your enquiry. Is this a good time to talk?`.slice(0, 300);
}

function formatCustomFieldLabel(key: string): string {
  return key
    .replace(/_+/g, ' ')
    .trim()
    .replace(/\b\w/g, ch => ch.toUpperCase());
}

/**
 * Builds a bounded (<=10,000 chars) call_purpose for Sarvam combining:
 * 1) Campaign brand identity + short human owner-style reply rules
 * 2) This specific recipient's untrusted Google Sheet / CSV lead context (all columns, never mixed across rows)
 * 3) Owner-approved campaign instructions & verified PDF knowledge brief
 */
export function buildPersonalizedLeadCallPurpose(
  campaign: BulkCampaignState,
  contact?: BulkCampaignImportedContact
): string {
  const basePurpose =
    campaign.knowledgeContext?.sarvamBoundedFactBrief?.trim() ||
    campaign.callScript.boundedPurposePreview?.trim() ||
    buildBoundedPhonePurpose({
      eventDetails: campaign.eventDetails,
      eventPitch: campaign.callScript.eventPitch,
      questions: campaign.callScript.questions
    });

  const brand = extractCampaignBrandName(campaign);
  const isQuantumWeave =
    campaign.knowledgeContext?.extractedFacts.campaignType === 'services' ||
    /\bquantum\s*weave\b/i.test(campaign.instruction ?? '');
  const identityPrefix =
    !isQuantumWeave && brand
      ? `Outbound Identity: You are Thaara from ${brand}. Introduce yourself ONLY as Thaara from ${brand} (never say Quantum Weave). `
      : '';
  const stylePrefix =
    'Human Style: Talk like the owner—warm, natural, human. Keep every reply short and sweet (1-2 brief sentences, under 25 words per turn). Never give long paragraph answers or read long lists; give 2-3 quick options and ask one short question at a time.';

  const leadParts: string[] = [];
  if (contact) {
    const hasPlaceholderName = /^(?:contact|lead|row)\s+\d+$/i.test(contact.name.trim());
    if (!hasPlaceholderName && contact.name.trim()) leadParts.push(`Name: ${contact.name.trim()}`);
    if (contact.company?.trim()) leadParts.push(`Business: ${contact.company.trim()}`);
    if (contact.serviceRequired?.trim()) leadParts.push(`Service enquired: ${contact.serviceRequired.trim()}`);
    if (contact.customerRequirement?.trim()) leadParts.push(`Requirement: ${contact.customerRequirement.trim()}`);
    if (contact.leadSource?.trim()) leadParts.push(`Source: ${contact.leadSource.trim()}`);
    if (contact.enquiryDate?.trim()) leadParts.push(`Date: ${contact.enquiryDate.trim()}`);
    if (contact.customFields && typeof contact.customFields === 'object') {
      for (const [k, rawVal] of Object.entries(contact.customFields)) {
        const val = typeof rawVal === 'string' ? rawVal.trim() : '';
        if (!val) continue;
        // Skip internal/consent/URL/tracking noise columns; keep all customer lead details
        if (
          /^(?:consent|opt_in|dnd|opted_out|phone_consent|whatsapp_consent|email_consent|status|task_id|run_id|confidence|review_status|priority_or_hold|contact_verified_date|unknowns_and_limitations|owner)$/i.test(
            k
          ) ||
          /(?:_url$|_link$|_key$|^run_date|^score_|^outreach_draft)/i.test(k)
        ) {
          continue;
        }
        leadParts.push(`${formatCustomFieldLabel(k)}: ${val}`);
      }
    }
  }

  const hasSheetDetails =
    leadParts.length > 0 &&
    Boolean(
      contact?.company?.trim() ||
        contact?.serviceRequired?.trim() ||
        contact?.customerRequirement?.trim() ||
        contact?.leadSource?.trim() ||
        contact?.enquiryDate?.trim() ||
        (contact?.customFields && Object.keys(contact.customFields).length > 0)
    );

  if (!hasSheetDetails) {
    return basePurpose.slice(0, SARVAM_MAX_CALL_PURPOSE_CHARS);
  }

  const isProspect = isResearchedProspectContact(campaign, contact);
  const originRule = isProspect
    ? `Lead Origin: Researched business prospect (NOT a submitted enquiry form). NEVER claim they submitted an enquiry, filled out a form, or clicked a Meta ad; introduce naturally from ${brand ?? 'our team'} and reference their business/event context respectfully.`
    : 'Lead Origin: Genuine lead-form enquiry submitted by this customer.';

  const headerParts: string[] = [];
  if (identityPrefix) headerParts.push(identityPrefix.trim());
  headerParts.push(originRule);
  if (!/^Voice Style:/i.test(basePurpose)) headerParts.push(stylePrefix);
  headerParts.push(
    `Lead Sheet Details (untrusted, this customer only): ${leadParts.join(' | ')}. Greet by name if known, reference these exact Google Sheet details right away, never re-ask anything already mentioned here, and answer from verified facts without inventing prices.`
  );

  const headerBlock = headerParts.join(' | ');
  const remaining = Math.max(0, SARVAM_MAX_CALL_PURPOSE_CHARS - headerBlock.length - 3);
  if (remaining < 120) {
    return `${headerBlock.slice(0, SARVAM_MAX_CALL_PURPOSE_CHARS - 200)} | ${basePurpose.slice(0, 197)}`.slice(
      0,
      SARVAM_MAX_CALL_PURPOSE_CHARS
    );
  }
  return `${headerBlock} | ${basePurpose.slice(0, remaining)}`.slice(0, SARVAM_MAX_CALL_PURPOSE_CHARS);
}

export async function prepareCampaignPhoneDrafts(
  campaign: BulkCampaignState,
  phoneAdapter: BulkCampaignPhoneAdapter,
  now = new Date()
): Promise<BulkCampaignState> {
  const nowIso = now.toISOString();
  const { contacts: directoryContacts } = await phoneAdapter.listDirectoryContacts();
  const boundedPurpose = campaign.knowledgeContext?.sarvamBoundedFactBrief
    ? campaign.knowledgeContext.sarvamBoundedFactBrief.slice(0, SARVAM_MAX_CALL_PURPOSE_CHARS)
    : buildBoundedPhonePurpose({
        eventDetails: campaign.eventDetails,
        eventPitch: campaign.callScript.eventPitch,
        questions: campaign.callScript.questions
      });

  const effectiveDailyQuota = Math.min(
    campaign.limits.maxCalls,
    campaign.limits.dailyPhoneCallLimit,
    phoneAdapter.dailyCallLimit
  );
  let preparedCount = 0;
  const updatedContacts: BulkCampaignContactRecord[] = [];

  for (const record of campaign.contacts) {
    if (!campaign.channels.includes('phone') || !record.selectedByOwner) {
      updatedContacts.push(record);
      continue;
    }
    if (record.contact.optedOut) {
      updatedContacts.push({ ...record, phoneEligibility: 'skipped_opted_out', phoneStatus: 'skipped' });
      continue;
    }
    if (record.contact.dnd) {
      updatedContacts.push({
        ...record,
        category: 'unauthorized',
        categoryReason: 'Excluded: Contact is marked DND / telemarketing restricted.',
        phoneEligibility: 'skipped_dnd',
        phoneStatus: 'skipped',
        updatedAt: nowIso
      });
      continue;
    }
    if (record.contact.isSyntheticTestFixture) {
      if (!isSupportedPhoneCallingLanguage(record.contact.preferredLanguage)) {
        updatedContacts.push({
          ...record,
          category: 'unsupported',
          categoryReason: `Language "${record.contact.preferredLanguage}" is not yet supported by the published Phone API; queued.`,
          phoneEligibility: 'queued_unsupported_language',
          phoneStatus: 'queued',
          updatedAt: nowIso
        });
        continue;
      }
      if (preparedCount >= effectiveDailyQuota) {
        updatedContacts.push({
          ...record,
          category: 'unsupported',
          categoryReason: 'Exceeds the daily Phone calling quota; queued.',
          phoneEligibility: 'queued_daily_quota',
          phoneStatus: 'queued',
          updatedAt: nowIso
        });
        continue;
      }
      if (record.phoneDraft && record.phoneApprovalId) {
        preparedCount++;
        updatedContacts.push(record);
        continue;
      }
      // Isolated synthetic simulation fixture — NEVER writes to PhoneContactDirectory or live approval_requests!
      const synApprovalId = crypto.randomUUID();
      const synDraft: PhoneCallingDraft = {
        draftId: crypto.randomUUID(),
        contactId: record.contact.contactId,
        contactRevision: 1,
        contactBindingHash: crypto
          .createHash('sha256')
          .update(`synthetic_fixture:${record.contact.contactId}:${boundedPurpose}`)
          .digest('hex'),
        recipient: {
          displayName: record.contact.name.slice(0, 128),
          maskedPhone: record.contact.maskedPhone ?? 'TEST-FIXTURE'
        },
        purpose: buildPersonalizedLeadCallPurpose(campaign, record.contact),
        language: record.contact.preferredLanguage,
        maxDurationSeconds: 180,
        aiDisclosure: buildMockAiDisclosure(record.contact.preferredLanguage),
        consentReference: `synthetic_test_fixture_${record.contact.contactId}`,
        idempotencyKey: crypto.randomUUID(),
        mode: 'simulation',
        providerBindingHash: MOCK_PROVIDER_BINDING_HASH
      };
      preparedCount++;
      updatedContacts.push({
        ...record,
        category: 'eligible',
        categoryReason:
          'Simulated Test Eligibility (Isolated Synthetic Fixture — non-dialable test ID; blocked from live calling).',
        phoneEligibility: 'eligible',
        phoneStatus: 'awaiting_approval',
        phoneApprovalId: synApprovalId,
        phoneApprovalStatus: 'awaiting_approval',
        phoneDraft: synDraft,
        updatedAt: nowIso
      });
      continue;
    }
    if (record.contact.isInternational || (record.contact.phoneE164 && !/^\+91[6-9][0-9]{9}$/.test(record.contact.phoneE164))) {
      updatedContacts.push({
        ...record,
        category: 'unsupported',
        categoryReason:
          'International phone number is outside the currently authorized +91 Indian outbound calling region; held back from Phone calling.',
        phoneEligibility: 'queued_unsupported_region',
        phoneStatus: 'queued',
        updatedAt: nowIso
      });
      continue;
    }

    const dirContact = directoryContacts.find(
      dc =>
        !dc.archived &&
        (dc.contactId === record.contact.phoneDirectoryContactId ||
          (dc.displayName.toLowerCase() === record.contact.name.toLowerCase() &&
            (!record.contact.maskedPhone || dc.maskedPhone === record.contact.maskedPhone)))
    );

    if (!dirContact) {
      if (!record.contact.phoneE164) {
        updatedContacts.push({ ...record, phoneEligibility: 'skipped_missing_address', phoneStatus: 'skipped' });
        continue;
      }
      if (!record.contact.consent.phone) {
        updatedContacts.push({
          ...record,
          category: record.whatsappEligibility === 'eligible' || record.emailEligibility === 'eligible' ? 'eligible' : 'unauthorized',
          categoryReason:
            record.whatsappEligibility === 'eligible'
              ? 'Eligible for WhatsApp, but unauthorized for Phone calling (unsaved number lacks calling consent).'
              : 'Unauthorized: Unsaved phone number lacks verified calling consent and is not in PhoneContactDirectory.',
          phoneEligibility: 'queued_not_in_directory',
          phoneStatus: 'queued',
          updatedAt: nowIso
        });
        continue;
      }
      if (!isSupportedPhoneCallingLanguage(record.contact.preferredLanguage)) {
        updatedContacts.push({
          ...record,
          category: 'unsupported',
          categoryReason: `Language "${record.contact.preferredLanguage}" is not yet supported by the published Phone API; queued.`,
          phoneEligibility: 'queued_unsupported_language',
          phoneStatus: 'queued',
          updatedAt: nowIso
        });
        continue;
      }
      if (preparedCount >= effectiveDailyQuota) {
        updatedContacts.push({
          ...record,
          category: 'unsupported',
          categoryReason: 'Exceeds the daily live Phone calling quota (5/day default, 20/day max); queued for next approved batch.',
          phoneEligibility: 'queued_daily_quota',
          phoneStatus: 'queued',
          updatedAt: nowIso
        });
        continue;
      }
      if (record.phoneDraft && record.phoneApprovalId) {
        preparedCount++;
        updatedContacts.push(record);
        continue;
      }

      // Consented unsaved campaign contact — prepare one-call draft WITHOUT mutating PhoneContactDirectory!
      const prepared = await phoneAdapter.prepareDraft({
        contactQuery: record.contact.phoneE164,
        newRecipient: {
          displayName: record.contact.name.slice(0, 128),
          consentConfirmed: true
        },
        purpose: buildPersonalizedLeadCallPurpose(campaign, record.contact),
        language: record.contact.preferredLanguage,
        maxDurationSeconds: 180,
        openingGreeting: buildCampaignOutboundGreeting(campaign, record.contact)
      });
      preparedCount++;

      updatedContacts.push({
        ...record,
        category: 'eligible',
        categoryReason: 'Eligible for campaign-scoped consented Phone AI call (unsaved contact).',
        phoneEligibility: 'eligible',
        phoneStatus: 'awaiting_approval',
        phoneApprovalId: prepared.approvalId,
        phoneApprovalStatus: 'awaiting_approval',
        phoneDraft: prepared.draft,
        updatedAt: nowIso
      });
      continue;
    }

    if (!dirContact.consent.callingAllowed || dirContact.consent.expired || !record.contact.consent.phone) {
      updatedContacts.push({
        ...record,
        phoneEligibility: 'skipped_no_consent',
        phoneStatus: 'skipped',
        updatedAt: nowIso
      });
      continue;
    }

    if (!isSupportedPhoneCallingLanguage(record.contact.preferredLanguage)) {
      updatedContacts.push({
        ...record,
        category: 'unsupported',
        categoryReason: `Language "${record.contact.preferredLanguage}" is not yet supported by the published Phone API; queued.`,
        phoneEligibility: 'queued_unsupported_language',
        phoneStatus: 'queued',
        updatedAt: nowIso
      });
      continue;
    }

    if (preparedCount >= effectiveDailyQuota) {
      updatedContacts.push({
        ...record,
        category: 'unsupported',
        categoryReason: 'Exceeds the daily live Phone calling quota (5/day default, 20/day max); queued.',
        phoneEligibility: 'queued_daily_quota',
        phoneStatus: 'queued',
        updatedAt: nowIso
      });
      continue;
    }

    if (record.phoneDraft && record.phoneApprovalId) {
      preparedCount++;
      updatedContacts.push(record);
      continue;
    }

    const prepared = await phoneAdapter.prepareDraft({
      contactQuery: dirContact.displayName,
      selectedContactId: dirContact.contactId,
      purpose: buildPersonalizedLeadCallPurpose(campaign, record.contact),
      language: record.contact.preferredLanguage,
      maxDurationSeconds: 180,
      openingGreeting: buildCampaignOutboundGreeting(campaign, record.contact)
    });
    preparedCount++;

    updatedContacts.push({
      ...record,
      contact: {
        ...record.contact,
        phoneDirectoryContactId: dirContact.contactId,
        phoneDirectoryRevision: dirContact.revision
      },
      category: 'eligible',
      phoneEligibility: 'eligible',
      phoneStatus: 'awaiting_approval',
      phoneApprovalId: prepared.approvalId,
      phoneApprovalStatus: 'awaiting_approval',
      phoneDraft: prepared.draft,
      updatedAt: nowIso
    });
  }

  return {
    ...campaign,
    updatedAt: nowIso,
    contacts: updatedContacts
  };
}

/**
 * Step B: Explicit per-call owner approval of a single `approvalId` (`PhoneCallingPrepared.approvalId`).
 * Never uses or invents a batch approval token.
 */
export async function approveSingleCampaignPhoneDraft(
  campaign: BulkCampaignState,
  phoneAdapter: BulkCampaignPhoneAdapter,
  input: {
    approvalId: string;
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    now?: Date;
  }
): Promise<BulkCampaignState> {
  if (input.role !== 'owner' && input.role !== 'admin') {
    throw new Error('Only the workspace owner or admin can approve a phone call draft.');
  }
  const targetIdx = campaign.contacts.findIndex(c => c.phoneApprovalId === input.approvalId);
  if (targetIdx < 0) {
    throw new Error(`Phone call approvalId "${input.approvalId}" not found in campaign.`);
  }
  const targetRecord = campaign.contacts[targetIdx];
  if (!targetRecord?.contact.isSyntheticTestFixture) {
    await phoneAdapter.approveCallDraft({
      approvalId: input.approvalId,
      approverUserId: input.userId,
      ...(targetRecord?.phoneDraft ? { persistedDraft: targetRecord.phoneDraft } : {})
    });
  }
  const nowIso = (input.now ?? new Date()).toISOString();
  const nextContacts = campaign.contacts.map((c, idx) =>
    idx === targetIdx
      ? {
          ...c,
          phoneApprovalStatus: 'approved' as const,
          phoneStatus: 'pending' as const,
          updatedAt: nowIso
        }
      : c
  );
  return {
    ...campaign,
    updatedAt: nowIso,
    contacts: nextContacts
  };
}

function isWithinIndianCallingHours(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hourCycle: 'h23'
    }).format(now)
  );
  return hour >= 9 && hour < 20;
}

/**
 * Stage 4 & 5: Multichannel Execution (WhatsApp, Phone, Email) with per-call approval verification,
 * quota enforcement, controlled batch sizing, Indian telemarketing calling hours check in live mode,
 * verbatim transcript preservation, and unverified AI interpretation labelling.
 */
export async function executeBulkCampaign(
  campaign: BulkCampaignState,
  adapters: {
    whatsapp: BulkCampaignWhatsAppAdapter;
    phone: BulkCampaignPhoneAdapter;
    email?: BulkCampaignEmailAdapter;
    mode?: 'simulation' | 'live';
    batchSize?: number;
    enforceLiveCallingHours?: boolean;
    shouldStop?: () => boolean;
    now?: Date;
  }
): Promise<BulkCampaignState> {
  const requestedMode = adapters.mode ?? 'simulation';
  const emailAdapter = adapters.email ?? new MockBulkCampaignEmailAdapter();
  const waLiveReady = Boolean(adapters.whatsapp.liveSendingEnabled && campaign.channels.includes('whatsapp'));
  const phoneLiveReady = Boolean(adapters.phone.liveCallingEnabled && campaign.channels.includes('phone'));
  const emailLiveReady = Boolean(emailAdapter.liveSendingEnabled && campaign.channels.includes('email'));

  if (requestedMode === 'live' && campaign.contacts.some(c => c.contact.isSyntheticTestFixture)) {
    throw new Error(
      'LIVE_COMMUNICATIONS_DISABLED: Isolated synthetic test fixtures contain non-dialable test IDs and can never be executed in live mode.'
    );
  }
  if (requestedMode === 'live' && !waLiveReady && !phoneLiveReady && !emailLiveReady) {
    throw new Error(
      'LIVE_COMMUNICATIONS_DISABLED: liveCallingEnabled=false and liveSendingEnabled=false. Only simulation mode is authorized unless live WhatsApp or live Phone calling is enabled in this workspace.'
    );
  }
  if (
    campaign.status !== 'approved' &&
    campaign.status !== 'scheduled' &&
    campaign.status !== 'paused' &&
    campaign.status !== 'running'
  ) {
    throw new Error(`Campaign cannot execute in status "${campaign.status}". Explicit owner approval is required.`);
  }
  if (!campaign.approval || campaign.approval.approvedMaterialHash !== campaign.materialHash) {
    throw new Error('Campaign material hash does not match owner approval. Re-approval is required before execution.');
  }

  const effectiveNow = adapters.now ?? new Date();
  if (campaign.status === 'scheduled' && campaign.scheduledFor) {
    const dueMs = Date.parse(campaign.scheduledFor);
    if (Number.isFinite(dueMs) && dueMs > effectiveNow.getTime()) {
      throw new Error(
        `Campaign is scheduled for ${campaign.scheduledFor} and cannot run before its scheduled start time unless resumed immediately.`
      );
    }
  }

  const dispatchedKeys = new Set(campaign.dispatchedIdempotencyKeys);
  const updatedContacts: BulkCampaignContactRecord[] = [];
  let stoppedEarly = false;
  let pausedForBatchCap = false;
  let batchProcessedCount = 0;
  const maxBatchSize =
    adapters.batchSize && adapters.batchSize > 0 ? Math.floor(adapters.batchSize) : Number.POSITIVE_INFINITY;
  let phoneCallsPlaced = campaign.contacts.filter(r =>
    ['attempted', 'answered', 'not_answered', 'failed'].includes(r.phoneStatus)
  ).length;
  const maxAllowedPhoneCalls = Math.min(
    campaign.limits.maxCalls,
    campaign.limits.dailyPhoneCallLimit,
    adapters.phone.dailyCallLimit
  );
  const liveCallingHoursAllowed =
    requestedMode !== 'live' || adapters.enforceLiveCallingHours === false || isWithinIndianCallingHours(effectiveNow);

  for (const record of campaign.contacts) {
    const nowIso = effectiveNow.toISOString();
    if (adapters.shouldStop?.()) {
      stoppedEarly = true;
      updatedContacts.push({
        ...record,
        whatsappStatus: record.whatsappStatus === 'pending' ? 'cancelled' : record.whatsappStatus,
        emailStatus: record.emailStatus === 'pending' ? 'cancelled' : record.emailStatus,
        phoneStatus:
          record.phoneStatus === 'pending' || record.phoneStatus === 'awaiting_approval'
            ? 'cancelled'
            : record.phoneStatus,
        attendanceOutcome: record.attendanceOutcome === 'pending' ? 'skipped' : record.attendanceOutcome,
        updatedAt: nowIso
      });
      continue;
    }

    const hasPendingEligibleWork =
      !record.contact.optedOut &&
      !record.contact.dnd &&
      ((record.whatsappEligibility === 'eligible' && record.whatsappStatus === 'pending') ||
        (record.phoneEligibility === 'eligible' &&
          (record.phoneStatus === 'pending' || record.phoneStatus === 'awaiting_approval')) ||
        (record.emailEligibility === 'eligible' && record.emailStatus === 'pending'));

    if (hasPendingEligibleWork && batchProcessedCount >= maxBatchSize) {
      pausedForBatchCap = true;
      updatedContacts.push(record);
      continue;
    }

    let nextRecord: BulkCampaignContactRecord = { ...record };
    let didWorkForContact = false;

    // 1. WhatsApp Execution (if eligible and not yet dispatched; in live mode only if WhatsApp live sending is ready)
    if (
      nextRecord.whatsappEligibility === 'eligible' &&
      !nextRecord.contact.optedOut &&
      !nextRecord.contact.dnd &&
      (requestedMode === 'simulation' || waLiveReady)
    ) {
      const waKey = `${campaign.campaignId}:${nextRecord.contact.contactId}:whatsapp`;
      if (!dispatchedKeys.has(waKey)) {
        dispatchedKeys.add(waKey);
        didWorkForContact = true;
        const waRes = await adapters.whatsapp.sendTemplateInvitation({
          campaignId: campaign.campaignId,
          connectionId: campaign.whatsappPlan.connectionId,
          contact: nextRecord.contact,
          templateName: campaign.whatsappPlan.templateName,
          language: campaign.whatsappPlan.language,
          messagePreview: nextRecord.personalizedWhatsappPreview,
          eventDetails: campaign.eventDetails,
          executionMode: requestedMode,
          idempotencyKey: waKey
        });
        nextRecord = {
          ...nextRecord,
          whatsappStatus: waRes.status,
          ...(waRes.dispatchId !== undefined ? { whatsappDispatchId: waRes.dispatchId } : {}),
          whatsappProviderMessageId: waRes.providerMessageId,
          ...(waRes.error ? { whatsappError: waRes.error } : {}),
          interactionTimestamp: nowIso,
          structuredNotes: waRes.error
            ? `WhatsApp failed: ${waRes.error}`.slice(0, 500)
            : `WhatsApp ${waRes.status} (${campaign.whatsappPlan.templateName})`.slice(0, 500),
          updatedAt: nowIso
        };
      }
    }

    // 2. Email Execution (isolated campaign transport; never interferes with Phone Step 115 callback emails)
    if (
      campaign.channels.includes('email') &&
      nextRecord.emailEligibility === 'eligible' &&
      !nextRecord.contact.optedOut &&
      !nextRecord.contact.dnd &&
      nextRecord.emailStatus !== 'unsubscribed' &&
      (requestedMode === 'simulation' || emailLiveReady)
    ) {
      const emKey = `${campaign.campaignId}:${nextRecord.contact.contactId}:email`;
      if (!dispatchedKeys.has(emKey)) {
        dispatchedKeys.add(emKey);
        didWorkForContact = true;
        const subject = campaign.emailPlan?.subject ?? `Invitation: ${campaign.title}`;
        const bodyText =
          nextRecord.personalizedEmailPreview ??
          renderPersonalizedEmailPreview(
            campaign.emailPlan?.bodyPreview ?? `Hello {{name}}, you are invited to ${campaign.eventDetails}.`,
            nextRecord.contact.name,
            nextRecord.contact.company
          );
        const emRes = await emailAdapter.sendCampaignEmail({
          campaignId: campaign.campaignId,
          contact: nextRecord.contact,
          subject,
          bodyText,
          executionMode: requestedMode,
          idempotencyKey: emKey
        });
        nextRecord = {
          ...nextRecord,
          emailStatus: emRes.status,
          emailMessageId: emRes.messageId,
          ...(emRes.error ? { emailError: emRes.error } : {}),
          interactionTimestamp: nowIso,
          structuredNotes: emRes.error
            ? `Email failed: ${emRes.error}`.slice(0, 500)
            : `Email ${emRes.status} (${subject})`.slice(0, 500),
          updatedAt: nowIso
        };
      }
    }

    // 3. Phone AI Call Execution — strictly requires per-call draft + explicit per-call owner approval
    if (
      nextRecord.phoneEligibility === 'eligible' &&
      !nextRecord.contact.optedOut &&
      !nextRecord.contact.dnd &&
      (requestedMode === 'simulation' || phoneLiveReady)
    ) {
      if (!nextRecord.phoneApprovalId || !nextRecord.phoneDraft || nextRecord.phoneApprovalStatus !== 'approved') {
        nextRecord = {
          ...nextRecord,
          phoneEligibility: 'queued_unapproved',
          phoneStatus: 'queued',
          updatedAt: nowIso
        };
      } else if (!liveCallingHoursAllowed) {
        nextRecord = {
          ...nextRecord,
          phoneStatus: 'queued',
          structuredNotes: 'Queued: Outside Indian telemarketing calling hours (09:00–20:00 IST).',
          updatedAt: nowIso
        };
      } else if (phoneCallsPlaced >= maxAllowedPhoneCalls) {
        nextRecord = {
          ...nextRecord,
          phoneEligibility: 'queued_daily_quota',
          phoneStatus: 'queued',
          updatedAt: nowIso
        };
      } else {
        const phKey = nextRecord.phoneDraft.idempotencyKey;
        if (!dispatchedKeys.has(phKey)) {
          dispatchedKeys.add(phKey);
          didWorkForContact = true;
          phoneCallsPlaced++;

          if (nextRecord.contact.isSyntheticTestFixture) {
            const synSim = simulateSyntheticCompanyScenario({
              contact: nextRecord.contact,
              openingLine: campaign.callScript.openingLine,
              aiDisclosure: campaign.callScript.aiDisclosure,
              knowledgeContext: campaign.knowledgeContext,
              eventDetails: campaign.eventDetails
            });
            const synAiInterp: BulkCampaignAiInterpretation = {
              attendanceClassification: synSim.outcome,
              ...(synSim.preferredCallbackTime ? { preferredCallbackTime: synSim.preferredCallbackTime } : {}),
              rationale: synSim.rationale.slice(0, 500),
              isAiInterpretation: true,
              confirmedByEvidence: false
            };
            const synSummary = `[SIMULATED — NOT AN ACTUAL CUSTOMER CONVERSATION] ${synSim.scenarioTitle}: ${synSim.outcome}`;
            nextRecord = {
              ...nextRecord,
              phoneStatus: 'answered',
              phoneCallId: `sim_fixture_${nextRecord.contact.contactId}`,
              phoneRecordState: 'completed',
              phoneLanguageUsed: nextRecord.phoneDraft.language,
              phoneDisclosedAi: true,
              phoneRawResponses: synSim.rawCustomerResponses.map(s => s.slice(0, 950)),
              phoneProviderReportText: synSim.reportText,
              phoneReportVerified: false,
              simulatedScenarioTitle: synSim.scenarioTitle,
              simulatedDialogueTurns: synSim.turns,
              aiInterpretation: synAiInterp,
              phoneTranscriptSummary: synSummary,
              ...(synSim.preferredCallbackTime ? { preferredCallbackTime: synSim.preferredCallbackTime } : {}),
              followUpRequired: synSim.followUpRequired,
              ...(synSim.followUpReason ? { followUpReason: synSim.followUpReason } : {}),
              attendanceOutcome: synSim.outcome,
              interactionTimestamp: nowIso,
              structuredNotes: synSummary.slice(0, 500),
              updatedAt: nowIso
            };
          } else {
            const callRecord = await adapters.phone.placeOrSimulateApprovedCall({
              approvalId: nextRecord.phoneApprovalId,
              mode: requestedMode,
              ...(nextRecord.phoneDraft ? { persistedDraft: nextRecord.phoneDraft } : {}),
              ...(campaign.approval?.approvedByUserId
                ? { persistedApproverUserId: campaign.approval.approvedByUserId }
                : {}),
              ...(campaign.knowledgeContext ? { knowledgeContext: campaign.knowledgeContext } : {})
            });
            let providerResult: PhoneCallingProviderResult = {
              callId: callRecord.id,
              status: 'unavailable',
              responses: [],
              verified: false,
              source: 'provider_api'
            };
            try {
              providerResult = await adapters.phone.readProviderResult(callRecord.id);
            } catch {
              // Live calls in queued/ringing state may not yet have provider results
            }
            const rawResponses =
              providerResult.status === 'available' && providerResult.responses.length > 0
                ? providerResult.responses
                : callRecord.report.quotedResponses;

            const mappedCallStatus = mapPhoneStateToCampaignCallStatus(callRecord.state);
            const isInFlightCall = mappedCallStatus === 'attempted';
            const aiInterpretation = isInFlightCall
              ? undefined
              : deriveCampaignCallAiInterpretation(callRecord.state, rawResponses);
            const optedOutNow = aiInterpretation?.attendanceClassification === 'opted_out';
            const needsFollowUp =
              aiInterpretation?.attendanceClassification === 'callback_requested' ||
              aiInterpretation?.attendanceClassification === 'wants_more_info' ||
              mappedCallStatus === 'not_answered';
            const followUpReason =
              aiInterpretation?.attendanceClassification === 'callback_requested'
                ? `Callback requested (${aiInterpretation.preferredCallbackTime ?? 'time unspecified'})`
                : aiInterpretation?.attendanceClassification === 'wants_more_info'
                  ? 'Requested more webinar details before deciding'
                  : mappedCallStatus === 'not_answered'
                    ? 'Did not answer AI call — follow up via WhatsApp or manual call'
                    : undefined;

            const rawSummaryText = isInFlightCall
              ? `${callRecord.report.text} — [Call in progress / awaiting provider callback]`
              : rawResponses.length > 0
                ? `Raw responses (unverified): ${rawResponses.map(r => `"${r}"`).join(' | ')} — [AI Interpretation (unverified): ${aiInterpretation!.attendanceClassification}]`
                : `${callRecord.report.text} — [AI Interpretation (unverified): ${aiInterpretation!.attendanceClassification}]`;

            nextRecord = {
              ...nextRecord,
              contact: optedOutNow
                ? {
                    ...nextRecord.contact,
                    optedOut: true,
                    consent: { ...nextRecord.contact.consent, whatsapp: false, phone: false, email: false }
                  }
                : nextRecord.contact,
              phoneStatus: mappedCallStatus,
              phoneCallId: callRecord.id,
              phoneRecordState: callRecord.state,
              phoneLanguageUsed: callRecord.draft.language,
              phoneDisclosedAi: Boolean(callRecord.draft.aiDisclosure),
              phoneRawResponses: rawResponses,
              phoneProviderReportText: callRecord.report.text,
              phoneReportVerified: Boolean(callRecord.verified),
              ...(aiInterpretation ? { aiInterpretation } : {}),
              phoneTranscriptSummary: rawSummaryText,
              ...(aiInterpretation?.preferredCallbackTime
                ? { preferredCallbackTime: aiInterpretation.preferredCallbackTime }
                : {}),
              followUpRequired: needsFollowUp,
              ...(followUpReason ? { followUpReason } : {}),
              attendanceOutcome: aiInterpretation?.attendanceClassification ?? 'pending',
              interactionTimestamp: nowIso,
              structuredNotes: rawSummaryText.slice(0, 500),
              updatedAt: nowIso
            };
          }
        }
      }
    }

    if (didWorkForContact) {
      batchProcessedCount++;
    }
    updatedContacts.push(nextRecord);
  }

  const hasInFlightLiveWork =
    requestedMode === 'live' &&
    updatedContacts.some(
      r =>
        r.phoneStatus === 'attempted' ||
        r.whatsappStatus === 'queued' ||
        r.whatsappStatus === 'unverified' ||
        r.whatsappStatus === 'sent'
    );

  return {
    ...campaign,
    updatedAt: effectiveNow.toISOString(),
    contacts: updatedContacts,
    dispatchedIdempotencyKeys: [...dispatchedKeys],
    executionMode: requestedMode,
    liveCallingEnabled: Boolean(adapters.phone.liveCallingEnabled),
    liveSendingEnabled: Boolean(adapters.whatsapp.liveSendingEnabled),
    status: stoppedEarly
      ? 'stopped'
      : pausedForBatchCap
        ? 'paused'
        : hasInFlightLiveWork
          ? 'running'
          : 'completed'
  };
}

/**
 * Prepares an isolated 5-contact synthetic test simulation from an existing campaign (such as `company Campaign`)
 * WITHOUT modifying the original campaign's real uploaded contacts or authorization status,
 * and WITHOUT requiring the user to re-upload an already-processed DOCX knowledge base.
 */
export async function prepareSyntheticSimulationFromCampaign(
  sourceCampaign: BulkCampaignState,
  options?: {
    userId?: string;
    instruction?: string;
    now?: Date;
  }
): Promise<BulkCampaignState> {
  const now = options?.now ?? new Date();
  const nowIso = now.toISOString();
  const simInstruction = (options?.instruction?.trim() || COMPANY_INTRODUCTION_SIMULATION_INSTRUCTION).trim();
  const channels: BulkCampaignChannel[] =
    sourceCampaign.channels.length > 0 ? [...sourceCampaign.channels] : ['phone'];

  const upgradedKnowledge = enrichOrUpgradeCampaignKnowledgeContext({
    knowledgeContext: sourceCampaign.knowledgeContext,
    instruction: simInstruction,
    eventDetails: 'Quantum Weave AI — Company & Services Introduction',
    questions: [
      'Is now a convenient time for a brief introduction from Quantum Weave AI?',
      'Which business communication, marketing, or workflow challenge would you like to solve first?',
      'Would you like our human team to follow up with a consultation?'
    ]
  });

  const syntheticImport = buildSyntheticCompanyImportResult();
  const basePlan = createBulkCampaignPlan({
    workspaceId: sourceCampaign.workspaceId,
    userId: options?.userId ?? sourceCampaign.createdByUserId,
    instruction: simInstruction,
    importResult: syntheticImport,
    channels,
    emailConnected: false,
    liveCallingEnabled: false,
    liveSendingEnabled: false,
    limits: {
      dailyPhoneCallLimit: 5,
      maxCalls: 5
    },
    now
  });

  const baseTitle = sourceCampaign.title.replace(/\s*\(Synthetic Test Simulation\)\s*$/i, '').trim();
  const callQuestions = [
    'Is now a convenient time for a brief introduction from Quantum Weave AI?',
    'Which business communication, marketing, or workflow challenge would you like to solve first?',
    'Would you like our human team to follow up with a consultation?'
  ];
  const eventDetails = 'Quantum Weave AI — Company & Services Introduction';
  const objective =
    'Introduce Quantum Weave AI using verified uploaded company knowledge, understand business requirements, answer customer questions naturally, identify interested businesses, offer human follow-up where appropriate, and record simulated outcomes.';

  const boundedPurposePreview = buildSarvamBoundedFactBrief({
    instruction: simInstruction,
    eventDetails,
    facts: upgradedKnowledge.extractedFacts,
    questions: callQuestions
  });
  upgradedKnowledge.sarvamBoundedFactBrief = boundedPurposePreview;

  const callScript: BulkCampaignCallScript = {
    aiDisclosure:
      'Hello, this is Thaara, an AI assistant from Quantum Weave AI calling on behalf of the workspace owner.',
    openingLine:
      'Am I speaking with {{name}}? I am calling to briefly introduce Quantum Weave AI and understand if AI voice, automation, or digital marketing could help your business—is now a good time?',
    eventPitch:
      'Explain Quantum Weave AI services clearly using verified company knowledge, answer questions naturally without pressure, and offer a human callback where helpful.',
    questions: callQuestions,
    boundedPurposePreview,
    supportedLanguages: ['en-IN', 'kn-IN', 'kn-en']
  };

  let simState: BulkCampaignState = {
    ...basePlan,
    title: `${baseTitle} (Synthetic Test Simulation)`,
    instruction: simInstruction,
    objective,
    eventDetails,
    callScript,
    knowledgeContext: upgradedKnowledge,
    liveCallingEnabled: false,
    liveSendingEnabled: false
  };

  // Pre-prepare isolated in-memory simulation drafts (zero live directory or approval_requests writes)
  const mockAdapter = new MockBulkCampaignPhoneAdapter({ dailyCallLimit: 5, directory: [] });
  simState = await prepareCampaignPhoneDrafts(simState, mockAdapter, now);
  const recomputedHash = computeCampaignMaterialHash({
    objective: simState.objective,
    eventDetails: simState.eventDetails,
    channels: simState.channels,
    whatsappPlan: simState.whatsappPlan,
    callScript: simState.callScript,
    limits: simState.limits,
    contacts: simState.contacts,
    knowledgeContext: simState.knowledgeContext
  });
  return {
    ...simState,
    updatedAt: nowIso,
    materialHash: recomputedHash
  };
}

export function scheduleBulkCampaign(
  campaign: BulkCampaignState,
  input: {
    scheduleAt: string;
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    now?: Date;
  }
): BulkCampaignState {
  if (input.role !== 'owner' && input.role !== 'admin') {
    throw new Error('Only the workspace owner or admin can schedule an approved bulk campaign.');
  }
  if (!campaign.approval || campaign.approval.approvedMaterialHash !== campaign.materialHash) {
    throw new Error('Explicit owner approval is required before scheduling a bulk campaign.');
  }
  const parsedMs = Date.parse(input.scheduleAt);
  if (!input.scheduleAt.trim() || !Number.isFinite(parsedMs)) {
    throw new Error('A valid ISO schedule timestamp is required.');
  }
  const nowIso = (input.now ?? new Date()).toISOString();
  return {
    ...campaign,
    updatedAt: nowIso,
    scheduledFor: new Date(parsedMs).toISOString(),
    status: 'scheduled'
  };
}

export function pauseBulkCampaign(campaign: BulkCampaignState, now = new Date()): BulkCampaignState {
  if (!['draft', 'approved', 'scheduled', 'running', 'paused'].includes(campaign.status)) {
    throw new Error(`Cannot pause campaign in status "${campaign.status}".`);
  }
  return {
    ...campaign,
    updatedAt: now.toISOString(),
    status: 'paused'
  };
}

export function resumeBulkCampaign(campaign: BulkCampaignState, now = new Date()): BulkCampaignState {
  if (campaign.status !== 'paused') {
    throw new Error(`Cannot resume campaign from status "${campaign.status}".`);
  }
  if (!campaign.approval || campaign.approval.approvedMaterialHash !== campaign.materialHash) {
    throw new Error('Campaign requires valid owner approval before resuming.');
  }
  const nowMs = now.getTime();
  const futureScheduled =
    campaign.scheduledFor && Number.isFinite(Date.parse(campaign.scheduledFor)) && Date.parse(campaign.scheduledFor) > nowMs;
  return {
    ...campaign,
    updatedAt: now.toISOString(),
    status: futureScheduled ? 'scheduled' : 'approved'
  };
}

export function unsubscribeCampaignContact(
  campaign: BulkCampaignState,
  contactId: string,
  now = new Date()
): BulkCampaignState {
  const nowIso = now.toISOString();
  const targetExists = campaign.contacts.some(r => r.contact.contactId === contactId);
  if (!targetExists) {
    throw new Error(`Contact "${contactId}" not found in campaign.`);
  }
  const updatedContacts: BulkCampaignContactRecord[] = campaign.contacts.map(r =>
    r.contact.contactId === contactId
      ? {
          ...r,
          category: 'unauthorized',
          categoryReason: 'Unauthorized: Contact has opted out (DNC / Unsubscribed).',
          whatsappEligibility: 'skipped_opted_out',
          phoneEligibility: 'skipped_opted_out',
          emailEligibility: 'skipped_opted_out',
          contact: {
            ...r.contact,
            optedOut: true,
            consent: { ...r.contact.consent, whatsapp: false, phone: false, email: false }
          },
          whatsappStatus: r.whatsappStatus === 'pending' ? 'cancelled' : r.whatsappStatus,
          emailStatus: 'unsubscribed',
          phoneStatus:
            r.phoneStatus === 'pending' || r.phoneStatus === 'awaiting_approval' ? 'cancelled' : r.phoneStatus,
          followUpRequired: false,
          attendanceOutcome: 'opted_out',
          interactionTimestamp: nowIso,
          structuredNotes: 'Recipient unsubscribed / opted out from campaign.',
          updatedAt: nowIso
        }
      : r
  );
  const newMaterialHash = computeCampaignMaterialHash({
    objective: campaign.objective,
    eventDetails: campaign.eventDetails,
    channels: campaign.channels,
    whatsappPlan: campaign.whatsappPlan,
    callScript: campaign.callScript,
    limits: campaign.limits,
    contacts: updatedContacts
  });
  const hadValidApproval =
    Boolean(campaign.approval) && campaign.approval?.approvedMaterialHash === campaign.materialHash;

  return {
    ...campaign,
    updatedAt: nowIso,
    contacts: updatedContacts,
    materialHash: newMaterialHash,
    ...(hadValidApproval && campaign.approval
      ? {
          approval: {
            ...campaign.approval,
            approvedMaterialHash: newMaterialHash
          }
        }
      : {})
  };
}

/**
 * Retries ONLY transient `failed` channel attempts (up to 3 retries per contact) using retry-scoped
 * idempotency keys, strictly preserving already-succeeded (`delivered`, `sent`, `answered`, `unverified`)
 * and opted-out contacts so duplicate messages or calls NEVER happen.
 */
export async function retryFailedBulkCampaignContacts(
  campaign: BulkCampaignState,
  adapters: {
    whatsapp: BulkCampaignWhatsAppAdapter;
    phone: BulkCampaignPhoneAdapter;
    email?: BulkCampaignEmailAdapter;
    mode?: 'simulation' | 'live';
    now?: Date;
  }
): Promise<BulkCampaignState> {
  if (!campaign.approval || campaign.approval.approvedMaterialHash !== campaign.materialHash) {
    throw new Error('Explicit owner approval is required before retrying failed campaign contacts.');
  }
  const requestedMode = adapters.mode ?? (campaign.executionMode === 'live' ? 'live' : 'simulation');
  const emailAdapter = adapters.email ?? new MockBulkCampaignEmailAdapter();
  const waLiveReady = Boolean(adapters.whatsapp.liveSendingEnabled && campaign.channels.includes('whatsapp'));
  const phoneLiveReady = Boolean(adapters.phone.liveCallingEnabled && campaign.channels.includes('phone'));
  const emailLiveReady = Boolean(emailAdapter.liveSendingEnabled && campaign.channels.includes('email'));
  if (requestedMode === 'live' && campaign.contacts.some(c => c.contact.isSyntheticTestFixture)) {
    throw new Error(
      'LIVE_COMMUNICATIONS_DISABLED: Isolated synthetic test fixtures contain non-dialable test IDs and can never be executed in live mode.'
    );
  }
  if (requestedMode === 'live' && !waLiveReady && !phoneLiveReady && !emailLiveReady) {
    throw new Error(
      'LIVE_COMMUNICATIONS_DISABLED: liveCallingEnabled=false and liveSendingEnabled=false. Only simulation mode is authorized unless live WhatsApp or live Phone calling is enabled in this workspace.'
    );
  }
  const nowIso = (adapters.now ?? new Date()).toISOString();
  const dispatchedKeys = new Set(campaign.dispatchedIdempotencyKeys);
  const updatedContacts: BulkCampaignContactRecord[] = [];

  for (const record of campaign.contacts) {
    if (record.contact.optedOut || record.contact.dnd) {
      updatedContacts.push(record);
      continue;
    }
    const currentRetry = record.retryCount ?? 0;
    if (currentRetry >= 3) {
      updatedContacts.push(record);
      continue;
    }

    let nextRecord: BulkCampaignContactRecord = { ...record };
    let retried = false;
    const nextRetryNum = currentRetry + 1;

    if (nextRecord.whatsappStatus === 'failed' && nextRecord.whatsappEligibility === 'eligible') {
      const retryWaKey = `${campaign.campaignId}:${nextRecord.contact.contactId}:whatsapp:retry:${nextRetryNum}`;
      if (!dispatchedKeys.has(retryWaKey)) {
        dispatchedKeys.add(retryWaKey);
        retried = true;
        const waRes = await adapters.whatsapp.sendTemplateInvitation({
          campaignId: campaign.campaignId,
          connectionId: campaign.whatsappPlan.connectionId,
          contact: nextRecord.contact,
          templateName: campaign.whatsappPlan.templateName,
          language: campaign.whatsappPlan.language,
          messagePreview: nextRecord.personalizedWhatsappPreview,
          eventDetails: campaign.eventDetails,
          executionMode: requestedMode,
          idempotencyKey: retryWaKey
        });
        nextRecord = {
          ...nextRecord,
          whatsappStatus: waRes.status,
          ...(waRes.dispatchId !== undefined ? { whatsappDispatchId: waRes.dispatchId } : {}),
          whatsappProviderMessageId: waRes.providerMessageId,
          whatsappError: waRes.error,
          interactionTimestamp: nowIso,
          structuredNotes: `Retry #${nextRetryNum}: WhatsApp ${waRes.status}`.slice(0, 500),
          updatedAt: nowIso
        };
      }
    }

    if (nextRecord.emailStatus === 'failed' && nextRecord.emailEligibility === 'eligible') {
      const retryEmKey = `${campaign.campaignId}:${nextRecord.contact.contactId}:email:retry:${nextRetryNum}`;
      if (!dispatchedKeys.has(retryEmKey)) {
        dispatchedKeys.add(retryEmKey);
        retried = true;
        const subject = campaign.emailPlan?.subject ?? `Invitation: ${campaign.title}`;
        const bodyText =
          nextRecord.personalizedEmailPreview ??
          renderPersonalizedEmailPreview(
            campaign.emailPlan?.bodyPreview ?? `Hello {{name}}, you are invited to ${campaign.eventDetails}.`,
            nextRecord.contact.name,
            nextRecord.contact.company
          );
        const emRes = await emailAdapter.sendCampaignEmail({
          campaignId: campaign.campaignId,
          contact: nextRecord.contact,
          subject,
          bodyText,
          executionMode: requestedMode,
          idempotencyKey: retryEmKey
        });
        nextRecord = {
          ...nextRecord,
          emailStatus: emRes.status,
          emailMessageId: emRes.messageId,
          emailError: emRes.error,
          interactionTimestamp: nowIso,
          structuredNotes: `Retry #${nextRetryNum}: Email ${emRes.status}`.slice(0, 500),
          updatedAt: nowIso
        };
      }
    }

    if (
      nextRecord.phoneStatus === 'failed' &&
      nextRecord.phoneEligibility === 'eligible' &&
      nextRecord.phoneApprovalId &&
      nextRecord.phoneApprovalStatus === 'approved'
    ) {
      const retryPhKey = `${campaign.campaignId}:${nextRecord.contact.contactId}:phone:retry:${nextRetryNum}`;
      if (!dispatchedKeys.has(retryPhKey)) {
        dispatchedKeys.add(retryPhKey);
        retried = true;
        const callRecord = await adapters.phone.placeOrSimulateApprovedCall({
          approvalId: nextRecord.phoneApprovalId,
          mode: requestedMode
        });
        const mappedCallStatus = mapPhoneStateToCampaignCallStatus(callRecord.state);
        const aiInterp = deriveCampaignCallAiInterpretation(callRecord.state, callRecord.report.quotedResponses);
        nextRecord = {
          ...nextRecord,
          phoneStatus: mappedCallStatus,
          phoneCallId: callRecord.id,
          phoneRecordState: callRecord.state,
          phoneRawResponses: callRecord.report.quotedResponses,
          aiInterpretation: aiInterp,
          attendanceOutcome: aiInterp.attendanceClassification,
          interactionTimestamp: nowIso,
          structuredNotes: `Retry #${nextRetryNum}: Call ${mappedCallStatus}`.slice(0, 500),
          updatedAt: nowIso
        };
      }
    }

    if (retried) {
      nextRecord = {
        ...nextRecord,
        retryCount: nextRetryNum
      };
    }
    updatedContacts.push(nextRecord);
  }

  return {
    ...campaign,
    updatedAt: nowIso,
    contacts: updatedContacts,
    dispatchedIdempotencyKeys: [...dispatchedKeys]
  };
}

export function stopBulkCampaign(campaign: BulkCampaignState, now = new Date()): BulkCampaignState {
  const nowIso = now.toISOString();
  return {
    ...campaign,
    updatedAt: nowIso,
    status: 'stopped',
    executionMode: campaign.executionMode ?? 'planned',
    liveCallingEnabled: Boolean(campaign.liveCallingEnabled),
    liveSendingEnabled: Boolean(campaign.liveSendingEnabled),
    contacts: campaign.contacts.map(r => ({
      ...r,
      whatsappStatus: r.whatsappStatus === 'pending' ? 'cancelled' : r.whatsappStatus,
      emailStatus: r.emailStatus === 'pending' ? 'cancelled' : r.emailStatus,
      phoneStatus:
        r.phoneStatus === 'pending' || r.phoneStatus === 'awaiting_approval' ? 'cancelled' : r.phoneStatus,
      updatedAt: nowIso
    }))
  };
}

export function rejectOrCancelBulkCampaign(campaign: BulkCampaignState, now = new Date()): BulkCampaignState {
  const stopped = stopBulkCampaign(campaign, now);
  return {
    ...stopped,
    approval: undefined
  };
}

const BULK_CAMPAIGN_RECORD_KIND = 'bulk_campaign_state_v1' as const;

function normalizePersistedCampaignState(raw: BulkCampaignState): BulkCampaignState {
  return {
    ...raw,
    executionMode:
      raw.executionMode ?? (raw.status === 'completed' ? 'simulation' : 'planned'),
    liveCallingEnabled: Boolean(raw.liveCallingEnabled),
    liveSendingEnabled: Boolean(raw.liveSendingEnabled),
     ...(raw.emailPlan
      ? { emailPlan: { ...raw.emailPlan, liveSendingEnabled: false as const } }
      : {})
  };
}

/**
 * Shared tenant-scoped store so Bulk Campaigns created in Thaara Chat and the Bulk Campaign UI panel
 * operate on the exact same workspace state and survive API restarts, user logout/login, browser refreshes,
 * and software deployments via PostgreSQL RLS-scoped persistence (`public.plans` metadata).
 */
export class BulkCampaignWorkspaceStore {
  private readonly campaignsByWorkspace = new Map<string, Map<string, BulkCampaignState>>();
  private readonly approvalToCampaign = new Map<string, { workspaceId: string; campaignId: string }>();
  private db: TransactionalDbClient | undefined;

  constructor(db?: TransactionalDbClient) {
    this.db = db;
  }

  bindDb(db?: TransactionalDbClient): void {
    if (db) {
      this.db = db;
    }
  }

  listAllInMemory(): BulkCampaignState[] {
    const out: BulkCampaignState[] = [];
    for (const map of this.campaignsByWorkspace.values()) {
      for (const c of map.values()) out.push(c);
    }
    return out;
  }

  getWorkspaceMap(workspaceId: string): Map<string, BulkCampaignState> {
    let map = this.campaignsByWorkspace.get(workspaceId);
    if (!map) {
      map = new Map<string, BulkCampaignState>();
      this.campaignsByWorkspace.set(workspaceId, map);
    }
    return map;
  }

  save(workspaceId: string, campaign: BulkCampaignState): BulkCampaignState {
    const normalized = normalizePersistedCampaignState(campaign);
    const map = this.getWorkspaceMap(workspaceId);
    map.set(normalized.campaignId, normalized);
    if (normalized.governedApprovalId) {
      this.approvalToCampaign.set(normalized.governedApprovalId, {
        workspaceId,
        campaignId: normalized.campaignId
      });
    }
    return normalized;
  }

  get(workspaceId: string, campaignId: string): BulkCampaignState | null {
    return this.getWorkspaceMap(workspaceId).get(campaignId) ?? null;
  }

  getLatest(workspaceId: string): BulkCampaignState | null {
    const all = [...this.getWorkspaceMap(workspaceId).values()];
    return all[all.length - 1] ?? null;
  }

  list(workspaceId: string): BulkCampaignState[] {
    return [...this.getWorkspaceMap(workspaceId).values()];
  }

  findByGovernedApproval(approvalId: string): BulkCampaignState | null {
    const ref = this.approvalToCampaign.get(approvalId);
    if (!ref) return null;
    return this.get(ref.workspaceId, ref.campaignId);
  }

  findByN8nJobId(jobId: string): BulkCampaignState | null {
    for (const wsMap of this.campaignsByWorkspace.values()) {
      for (const campaign of wsMap.values()) {
        if ((campaign.n8nJobs ?? []).some(j => j.jobId === jobId)) {
          return campaign;
        }
      }
    }
    return null;
  }

  async findByN8nJobIdScoped(
    jobId: string,
    opts?: {
      workspaceId?: string;
      campaignId?: string;
      db?: TransactionalDbClient;
    }
  ): Promise<BulkCampaignState | null> {
    const inMemory = this.findByN8nJobId(jobId);
    if (inMemory) {
      if (opts?.workspaceId && inMemory.workspaceId !== opts.workspaceId) {
        return null;
      }
      return inMemory;
    }

    const dbClient = opts?.db ?? this.db;
    const workspaceId = opts?.workspaceId?.trim();
    if (!dbClient || !workspaceId) {
      return null;
    }

    const machineLookupScope: AuthenticatedScope = {
      workspaceId,
      userId: '00000000-0000-0000-0000-000000000000',
      role: 'owner',
      sessionTokenHash: 'n8n-machine-lookup'
    };

    try {
      if (opts?.campaignId) {
        const direct = await this.getScoped(machineLookupScope, opts.campaignId, dbClient);
        if (direct && (direct.n8nJobs ?? []).some(j => j.jobId === jobId)) {
          return direct;
        }
      }

      const persistedRows = await dbClient.withScopedTransaction(machineLookupScope, async tx => {
        const res = await tx.query<{ state: BulkCampaignState | null }>(
          `SELECT metadata->'campaignState' AS state
           FROM plans
           WHERE workspace_id = $1
             AND metadata->>'recordKind' = $2
             AND COALESCE(metadata->>'deleted', 'false') <> 'true'
           ORDER BY updated_at DESC`,
          [workspaceId, BULK_CAMPAIGN_RECORD_KIND]
        );
        return res.rows.map(r => r.state).filter((s): s is BulkCampaignState => Boolean(s));
      });

      for (const item of persistedRows) {
        if (item.workspaceId === workspaceId && (item.n8nJobs ?? []).some(j => j.jobId === jobId)) {
          return this.save(workspaceId, item);
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async saveScoped(
    scope: AuthenticatedScope,
    campaign: BulkCampaignState,
    dbOverride?: TransactionalDbClient
  ): Promise<BulkCampaignState> {
    const normalized = normalizePersistedCampaignState(campaign);
    const dbClient = dbOverride ?? this.db;
    if (!dbClient) {
      return this.save(scope.workspaceId, normalized);
    }
    try {
      await dbClient.withScopedTransaction(scope, async tx => {
        const metadataJson = JSON.stringify({
          recordKind: BULK_CAMPAIGN_RECORD_KIND,
          campaignId: normalized.campaignId,
          governedApprovalId: normalized.governedApprovalId ?? null,
          campaignState: normalized
        });
        const existingRes = await tx.query<{ id: string }>(
          `SELECT id
           FROM plans
           WHERE workspace_id = $1
             AND metadata->>'recordKind' = $2
             AND metadata->>'campaignId' = $3
           LIMIT 1`,
          [scope.workspaceId, BULK_CAMPAIGN_RECORD_KIND, normalized.campaignId]
        );
        const existingId = existingRes.rows[0]?.id;
        if (existingId) {
          const updateRes = await tx.query<{ id: string }>(
            `UPDATE plans
             SET title = $3,
                 description = $4,
                 version = version + 1,
                 metadata = $5::jsonb,
                 updated_at = NOW()
             WHERE workspace_id = $1 AND id = $2
             RETURNING id`,
            [
              scope.workspaceId,
              existingId,
              `Bulk Campaign State: ${normalized.title}`,
              normalized.objective,
              metadataJson
            ]
          );
          if (!updateRes.rows[0]?.id) {
            throw new Error('UPDATE plans returned no rows for existing campaign record.');
          }
        } else {
          const insertRes = await tx.query<{ id: string }>(
            `INSERT INTO plans (workspace_id, created_by_user_id, title, description, status, version, metadata)
             VALUES (
               $1,
               COALESCE(
                 (SELECT id FROM users WHERE id = $2 LIMIT 1),
                 (SELECT user_id FROM memberships WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1),
                 $2::uuid
               ),
               $3,
               $4,
               'draft',
               1,
               $5::jsonb
             )
             RETURNING id`,
            [
              scope.workspaceId,
              scope.userId,
              `Bulk Campaign State: ${normalized.title}`,
              normalized.objective,
              metadataJson
            ]
          );
          if (!insertRes.rows[0]?.id) {
            throw new Error('INSERT INTO plans returned no rows for new campaign record.');
          }
        }
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown database error';
      throw new Error(
        `BULK_CAMPAIGN_PERSISTENCE_FAILED: Durable PostgreSQL campaign storage failed (${detail}).`
      );
    }
    return this.save(scope.workspaceId, normalized);
  }

  async getScoped(
    scope: AuthenticatedScope,
    campaignId: string,
    dbOverride?: TransactionalDbClient
  ): Promise<BulkCampaignState | null> {
    const dbClient = dbOverride ?? this.db;
    if (!dbClient) {
      return this.get(scope.workspaceId, campaignId);
    }
    try {
      const persisted = await dbClient.withScopedTransaction(scope, async tx => {
        const res = await tx.query<{ state: BulkCampaignState | null }>(
          `SELECT metadata->'campaignState' AS state
           FROM plans
           WHERE workspace_id = $1
             AND metadata->>'recordKind' = $2
             AND metadata->>'campaignId' = $3
             AND COALESCE(metadata->>'deleted', 'false') <> 'true'
           ORDER BY updated_at DESC
           LIMIT 1`,
          [scope.workspaceId, BULK_CAMPAIGN_RECORD_KIND, campaignId]
        );
        return res.rows[0]?.state ?? null;
      });
      if (persisted && persisted.workspaceId === scope.workspaceId) {
        return this.save(scope.workspaceId, persisted);
      }
      return null;
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown database error';
      throw new Error(
        `BULK_CAMPAIGN_PERSISTENCE_FAILED: Durable PostgreSQL campaign read failed (${detail}).`
      );
    }
  }

  async listScoped(
    scope: AuthenticatedScope,
    dbOverride?: TransactionalDbClient
  ): Promise<BulkCampaignState[]> {
    const dbClient = dbOverride ?? this.db;
    if (!dbClient) {
      return this.list(scope.workspaceId);
    }
    try {
      const persistedRows = await dbClient.withScopedTransaction(scope, async tx => {
        const res = await tx.query<{ state: BulkCampaignState | null }>(
          `SELECT metadata->'campaignState' AS state
           FROM plans
           WHERE workspace_id = $1
             AND metadata->>'recordKind' = $2
             AND COALESCE(metadata->>'deleted', 'false') <> 'true'
           ORDER BY created_at ASC, id ASC`,
          [scope.workspaceId, BULK_CAMPAIGN_RECORD_KIND]
        );
        return res.rows.map(r => r.state).filter((s): s is BulkCampaignState => Boolean(s));
      });
      const wsMap = this.getWorkspaceMap(scope.workspaceId);
      wsMap.clear();
      for (const item of persistedRows) {
        if (item.workspaceId === scope.workspaceId) {
          this.save(scope.workspaceId, item);
        }
      }
      return this.list(scope.workspaceId);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown database error';
      throw new Error(
        `BULK_CAMPAIGN_PERSISTENCE_FAILED: Durable PostgreSQL campaign list failed (${detail}).`
      );
    }
  }

  async getLatestScoped(
    scope: AuthenticatedScope,
    dbOverride?: TransactionalDbClient
  ): Promise<BulkCampaignState | null> {
    const list = await this.listScoped(scope, dbOverride);
    return list[list.length - 1] ?? null;
  }

  async deleteScoped(
    scope: AuthenticatedScope,
    campaignId: string,
    dbOverride?: TransactionalDbClient
  ): Promise<boolean> {
    const dbClient = dbOverride ?? this.db;
    const wsMap = this.getWorkspaceMap(scope.workspaceId);
    const existingMem = wsMap.get(campaignId);
    if (existingMem?.governedApprovalId) {
      this.approvalToCampaign.delete(existingMem.governedApprovalId);
    }
    const deletedMem = wsMap.delete(campaignId);
    if (!dbClient) {
      return deletedMem;
    }
    try {
      const deletedDb = await dbClient.withScopedTransaction(scope, async tx => {
        const res = await tx.query<{ id: string }>(
          `UPDATE plans
           SET version = version + 1,
               metadata = jsonb_set(
                 jsonb_set(metadata, '{deleted}', 'true'::jsonb, true),
                 '{deletedAt}',
                 to_jsonb(NOW()::text),
                 true
               ),
               updated_at = NOW()
           WHERE workspace_id = $1
             AND metadata->>'recordKind' = $2
             AND metadata->>'campaignId' = $3
             AND COALESCE(metadata->>'deleted', 'false') <> 'true'
           RETURNING id`,
          [scope.workspaceId, BULK_CAMPAIGN_RECORD_KIND, campaignId]
        );
        return res.rows.length > 0;
      });
      return deletedDb || deletedMem;
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown database error';
      throw new Error(
        `BULK_CAMPAIGN_PERSISTENCE_FAILED: Durable PostgreSQL campaign delete failed (${detail}).`
      );
    }
  }

  async findByGovernedApprovalScoped(
    scope: AuthenticatedScope,
    approvalId: string,
    dbOverride?: TransactionalDbClient
  ): Promise<BulkCampaignState | null> {
    const dbClient = dbOverride ?? this.db;
    if (!dbClient) {
      const found = this.findByGovernedApproval(approvalId);
      return found && found.workspaceId === scope.workspaceId ? found : null;
    }
    try {
      const persisted = await dbClient.withScopedTransaction(scope, async tx => {
        const res = await tx.query<{ state: BulkCampaignState | null }>(
          `SELECT metadata->'campaignState' AS state
           FROM plans
           WHERE workspace_id = $1
             AND metadata->>'recordKind' = $2
             AND metadata->>'governedApprovalId' = $3
             AND COALESCE(metadata->>'deleted', 'false') <> 'true'
           ORDER BY updated_at DESC
           LIMIT 1`,
          [scope.workspaceId, BULK_CAMPAIGN_RECORD_KIND, approvalId]
        );
        return res.rows[0]?.state ?? null;
      });
      if (persisted && persisted.workspaceId === scope.workspaceId) {
        return this.save(scope.workspaceId, persisted);
      }
      return null;
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown database error';
      throw new Error(
        `BULK_CAMPAIGN_PERSISTENCE_FAILED: Durable PostgreSQL approval lookup failed (${detail}).`
      );
    }
  }
}

export const defaultBulkCampaignStore = new BulkCampaignWorkspaceStore();

/**
 * Stage 6: Live Campaign Dashboard Metrics & CSV Report Generator.
 */
export function computeBulkCampaignMetrics(campaign: BulkCampaignState): BulkCampaignDashboardMetrics {
  const c = campaign.contacts;
  return {
    totalContacts: c.length,
    eligibleContacts: c.filter(r => r.category === 'eligible').length,
    unauthorizedContacts: c.filter(r => r.category === 'unauthorized').length,
    unsupportedContacts: c.filter(r => r.category === 'unsupported').length,
    duplicateEntries: campaign.importSummary.duplicates.length,
    invalidEntries: campaign.importSummary.invalidEntries.length,
    eligibleWhatsappContacts: c.filter(r => r.whatsappEligibility === 'eligible').length,
    eligiblePhoneContacts: c.filter(r => r.phoneEligibility === 'eligible').length,
    eligibleEmailContacts: c.filter(r => r.emailEligibility === 'eligible').length,
    whatsappDelivered: c.filter(r => r.whatsappStatus === 'delivered' || r.whatsappStatus === 'read').length,
    whatsappFailed: c.filter(r => r.whatsappStatus === 'failed').length,
    whatsappPending: c.filter(r =>
      r.whatsappStatus === 'pending' ||
      r.whatsappStatus === 'queued' ||
      r.whatsappStatus === 'unverified' ||
      r.whatsappStatus === 'sent'
    ).length,
    whatsappSkipped: c.filter(r => r.whatsappStatus === 'skipped' || r.whatsappStatus === 'cancelled').length,
    emailSent: c.filter(r => r.emailStatus === 'sent').length,
    emailFailed: c.filter(r => r.emailStatus === 'failed').length,
    emailPending: c.filter(r => r.emailStatus === 'pending' || r.emailStatus === 'queued').length,
    emailUnsubscribed: c.filter(r => r.emailStatus === 'unsubscribed').length,
    phoneDraftsPrepared: c.filter(r => Boolean(r.phoneDraft && r.phoneApprovalId)).length,
    phoneAwaitingApproval: c.filter(r => r.phoneApprovalStatus === 'awaiting_approval').length,
    phoneApproved: c.filter(r => r.phoneApprovalStatus === 'approved').length,
    phoneQueued: c.filter(r => r.phoneStatus === 'queued').length,
    callsAttempted: c.filter(r => ['attempted', 'answered', 'not_answered', 'failed'].includes(r.phoneStatus)).length,
    callsCompleted: c.filter(
      r => r.phoneRecordState === 'completed' || r.phoneStatus === 'answered' || r.phoneStatus === 'not_answered'
    ).length,
    callsAnswered: c.filter(r => r.phoneStatus === 'answered').length,
    callsNotAnswered: c.filter(r => r.phoneStatus === 'not_answered').length,
    callsPending: c.filter(r => r.phoneStatus === 'pending' || r.phoneStatus === 'awaiting_approval').length,
    callsSkipped: c.filter(r => r.phoneStatus === 'skipped' || r.phoneStatus === 'cancelled').length,
    confirmed: c.filter(r => r.attendanceOutcome === 'confirmed' || r.attendanceOutcome === 'interested').length,
    declined: c.filter(r => r.attendanceOutcome === 'declined' || r.attendanceOutcome === 'not_interested').length,
    wantsMoreInfo: c.filter(r => r.attendanceOutcome === 'wants_more_info').length,
    busyCount: c.filter(r => r.attendanceOutcome === 'busy').length,
    callbackRequested: c.filter(r => r.attendanceOutcome === 'callback_requested').length,
    followUpRequiredCount: c.filter(r => r.followUpRequired).length,
    optedOut: c.filter(r => r.attendanceOutcome === 'opted_out' || r.contact.optedOut).length,
    pending: c.filter(r => r.attendanceOutcome === 'pending' || r.attendanceOutcome === 'no_response').length,
    failed: c.filter(
      r =>
        r.attendanceOutcome === 'failed' ||
        r.whatsappStatus === 'failed' ||
        r.phoneStatus === 'failed' ||
        r.emailStatus === 'failed'
    ).length,
    skipped: c.filter(r => r.attendanceOutcome === 'skipped').length
  };
}

function escapeCsvCell(value: string): string {
  const isMaskedPhone = /^\+\d{1,3}\s+\*+\d{4}$/.test(value);
  const safe = !isMaskedPhone && /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function exportBulkCampaignCsv(campaign: BulkCampaignState): string {
  const headers = [
    'Contact Name',
    'Company',
    'Masked Phone',
    'Directory Contact ID',
    'Email',
    'Language',
    'Category',
    'Category Reason',
    'Consent Source',
    'WhatsApp Consent',
    'Phone Consent',
    'Email Consent',
    'Personalized WhatsApp Message',
    'WhatsApp Status',
    'WhatsApp Customer Reply',
    'WhatsApp Error',
    'Email Status',
    'Email Error',
    'Phone Eligibility',
    'Per-Call Approval ID',
    'Call Status',
    'Phone Record State',
    'AI Disclosed',
    'Raw Transcript Responses (Unverified)',
    'AI Interpretation Attendance (Unverified)',
    'Preferred Callback Time (AI Interpretation)',
    'Follow-Up Required',
    'Follow-Up Reason',
    'Retry Count',
    'Interaction Timestamp',
    'Structured Notes',
    'Business Outcome',
    'Confirmed By Evidence',
    'Lead Source',
    'Service Required',
    'Original Enquiry',
    'Enquiry Date'
  ];
  const rows = campaign.contacts.map(r =>
    [
      r.contact.name,
      r.contact.company ?? '',
      r.contact.maskedPhone ?? '',
      r.contact.phoneDirectoryContactId ?? (r.phoneDraft?.contactId?.startsWith('onecall_') ? r.phoneDraft.contactId : ''),
      r.contact.email ?? '',
      r.contact.preferredLanguage,
      r.category,
      r.categoryReason,
      r.contact.consentSourceDetail ?? r.contact.consent.source,
      String(r.contact.consent.whatsapp),
      String(r.contact.consent.phone),
      String(r.contact.consent.email),
      r.personalizedWhatsappPreview,
      r.whatsappStatus,
      r.whatsappCustomerReply ?? '',
      r.whatsappError ?? '',
      r.emailStatus ?? 'not_applicable',
      r.emailError ?? '',
      r.phoneEligibility,
      r.phoneApprovalId ?? '',
      r.phoneStatus,
      r.phoneRecordState ?? '',
      r.phoneDisclosedAi === undefined ? '' : String(r.phoneDisclosedAi),
      r.phoneRawResponses.join(' | '),
      r.aiInterpretation
        ? `${r.aiInterpretation.attendanceClassification} (AI interpretation - unverified)`
        : r.attendanceOutcome,
      r.preferredCallbackTime ?? '',
      String(r.followUpRequired),
      r.followUpReason ?? '',
      String(r.retryCount ?? 0),
      r.interactionTimestamp ?? '',
      r.structuredNotes ?? '',
      (() => {
        const isSim = campaign.executionMode === 'simulation';
        const o = r.attendanceOutcome;
        if (o === 'confirmed' || o === 'interested') return isSim ? 'Simulated: Engaged' : 'Engaged';
        if (o === 'declined' || o === 'not_interested') return isSim ? 'Simulated: Not Aligned' : 'Not Aligned';
        if (o === 'callback_requested') return isSim ? 'Simulated: Further Discussion' : 'Further Discussion';
        if (o === 'wants_more_info') return isSim ? 'Simulated: More info' : 'Needs more info';
        if (o === 'opted_out') return 'Opted out';
        if (o === 'no_response') return 'No answer';
        if (o === 'busy') return 'Busy';
        if (o === 'failed' || o === 'invalid_number') return 'Failed';
        if (o === 'pending') return isSim ? 'Simulated: Pending' : 'Pending';
        return o.replace(/_/g, ' ');
      })(),
      String(r.aiInterpretation?.confirmedByEvidence ?? false),
      r.contact.leadSource ?? '',
      r.contact.serviceRequired ?? '',
      r.contact.customerRequirement ?? '',
      r.contact.enquiryDate ?? ''
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

/**
 * Builds a complete, human-readable Chat Summary covering:
 * - Imported contact breakdown (Eligible, Unauthorized, Unsupported, Duplicates, Invalid)
 * - Event campaign plan + missing webinar details prompt (only when missing)
 * - Approval status & per-call approvals
 * - Combined delivery/call/email outcomes & follow-up requirements
 */
export function buildBulkCampaignChatSummary(campaign: BulkCampaignState): string {
  const m = computeBulkCampaignMetrics(campaign);
  const cats = categorizeBulkCampaignContacts(campaign);
  const followUps = campaign.contacts.filter(c => c.followUpRequired);
  const eligibleEmailCount = campaign.contacts.filter(c => c.emailEligibility === 'eligible').length;
  const isLiveRun = campaign.executionMode === 'live';
  const isSimulatedRun = !isLiveRun && (campaign.executionMode === 'simulation' || campaign.status === 'completed');

  const modeBadge = isLiveRun
    ? 'LIVE GOVERNED RUN'
    : isSimulatedRun
      ? 'SIMULATION-ONLY RUN'
      : 'PLANNED DRAFT';

  const verificationLine = isLiveRun
    ? 'LIVE GOVERNED DISPATCH — Approved WhatsApp / Sarvam calls dispatched via connected providers; transcript attendance classifications remain AI interpretations until verified.'
    : isSimulatedRun
      ? 'SIMULATION-ONLY — No real calls or messages were sent; no verified real-world customer outcomes exist.'
      : 'PLANNED ONLY — Campaign has not executed; no verified real-world customer outcomes exist.';

  const lines = [
    `Campaign Summary — ${campaign.title} (${campaign.status.toUpperCase()} · ${modeBadge})`,
    `• Campaign ID: ${campaign.campaignId} | Channels: ${campaign.channels.join(', ')} | Safety Lock: liveCallingEnabled=${Boolean(campaign.liveCallingEnabled)}, liveSendingEnabled=${Boolean(campaign.liveSendingEnabled)}`,
    `• Verification Status: ${verificationLine}`,
    `• Event: ${campaign.eventDetails}${campaign.scheduledFor ? ` | Scheduled For: ${campaign.scheduledFor}` : ''}`,
    `• Contact Breakdown: ${m.eligibleContacts} eligible (${m.eligibleWhatsappContacts} WhatsApp, ${m.eligiblePhoneContacts} Phone${campaign.channels.includes('email') ? `, ${eligibleEmailCount} Email` : ''}) | ${m.unauthorizedContacts} unauthorized | ${m.unsupportedContacts} unsupported/queued | ${m.duplicateEntries} duplicates | ${m.invalidEntries} invalid`,
    `• WhatsApp Template (${campaign.whatsappPlan.templateName}): "${campaign.whatsappPlan.messagePreview}"`,
    `• Sarvam Calling Script (${campaign.callScript.supportedLanguages.join(', ')}): Disclosure: "${campaign.callScript.aiDisclosure}" | Bounded Purpose: "${campaign.callScript.boundedPurposePreview}"`,
    ...(campaign.emailPlan && campaign.channels.includes('email')
      ? [
          `• Email Campaign (${campaign.emailPlan.liveSendingEnabled ? 'Live' : 'Test/Preview Transport — Isolated from Phone Step 115'}): Subject: "${campaign.emailPlan.subject}" | Sent: ${m.emailSent ?? 0}, Failed: ${m.emailFailed ?? 0}, Unsubscribed: ${m.emailUnsubscribed ?? 0}`
        ]
      : []),
    `• Schedule & Limits: Max ${campaign.limits.maxCalls} calls (${campaign.limits.dailyPhoneCallLimit}/day limit), Calling Hours: ${campaign.webinarDetails?.callingHoursWindow ?? '09:00–20:00 IST'}, concurrency ${campaign.limits.maxConcurrency}, ${campaign.limits.rateLimitPerMinute}/min`,
    `• Phone Draft Approvals: ${m.phoneDraftsPrepared} prepared, ${m.phoneApproved} per-call approved, ${m.phoneAwaitingApproval} awaiting approval, ${m.phoneQueued} queued`,
    `• Execution Results (${isLiveRun ? 'Live' : isSimulatedRun ? 'Simulated' : 'Planned'}): WhatsApp ${m.whatsappDelivered} delivered / ${m.whatsappPending} pending / ${m.whatsappFailed} failed | Phone ${m.callsAttempted} attempted (${m.callsAnswered} answered, ${m.callsNotAnswered} not answered)`,
    `• AI-Interpreted Outcomes (${isLiveRun ? 'unverified transcript/reply interpretation' : 'simulated/unverified'}): ${m.confirmed} confirmed/interested, ${m.wantsMoreInfo ?? 0} wants more info, ${m.callbackRequested} callback requested, ${m.declined} declined, ${m.busyCount ?? 0} busy, ${m.optedOut} opted out`
  ];

  if (campaign.webinarDetails && campaign.webinarDetails.missingDetails.length > 0 && campaign.status === 'draft') {
    lines.push(
      `• Optional Details Needed Before Final Approval: Please confirm ONLY the following missing webinar details if applicable: ${campaign.webinarDetails.missingDetails.join(', ')}.`
    );
  }
  if (cats.unauthorized.length > 0) {
    lines.push(
      `• Unauthorized Contacts Held Back (${cats.unauthorized.length}): ` +
        cats.unauthorized.slice(0, 10).map(c => `${c.contact.name} (${c.categoryReason})`).join('; ') +
        (cats.unauthorized.length > 10 ? ` ...and ${cats.unauthorized.length - 10} more` : '')
    );
  }
  if (cats.unsupported.length > 0) {
    lines.push(
      `• Unsupported/Quota Contacts Queued (${cats.unsupported.length}): ` +
        cats.unsupported.slice(0, 10).map(c => `${c.contact.name} [${c.contact.preferredLanguage}]`).join(', ') +
        (cats.unsupported.length > 10 ? ` ...and ${cats.unsupported.length - 10} more` : '')
    );
  }
  if (followUps.length > 0) {
    lines.push(
      `• Follow-Up Required (${followUps.length}): ` +
        followUps.map(c => `${c.contact.name} (${c.followUpReason ?? 'Follow up'})`).join('; ')
    );
  }

  return lines.join('\n');
}

/**
 * Detects when a Thaara Chat message contains both an event campaign instruction
 * AND pasted contacts (or an uploaded file), creating the campaign directly from Chat!
 */
export function createBulkCampaignFromChatInput(input: {
  workspaceId: string;
  userId: string;
  chatMessage: string;
  channels?: BulkCampaignChannel[];
  knowledgeFiles?: BulkCampaignKnowledgeUploadInput[];
  uploadedFile?: {
    sourceType: BulkCampaignSourceType;
    fileName?: string;
    rawText: string;
    fileBase64?: string;
  };
  phoneDirectory?: PhoneContactView[];
  whatsappDirectory?: WhatsAppOptedInDirectoryEntry[];
  whatsappConnectionId?: string;
  whatsappBusinessLabel?: string;
  whatsappTemplateName?: string;
  whatsappTemplateLanguage?: string;
  whatsappTemplatePreview?: string;
  emailConnected?: boolean;
  liveCallingEnabled?: boolean;
  liveSendingEnabled?: boolean;
  dailyPhoneCallLimit?: number;
  existingCampaign?: BulkCampaignState | null;
  fallbackToDemoContactsWhenEmpty?: boolean;
}): { campaign: BulkCampaignState; summaryText: string } {
  let instruction = input.chatMessage.trim();
  let contactRawText = input.uploadedFile?.rawText ?? '';
  const contactBase64 = input.uploadedFile?.fileBase64;
  let sourceType: BulkCampaignSourceType = input.uploadedFile?.sourceType ?? 'paste';
  let fileName = input.uploadedFile?.fileName;

  if (!input.uploadedFile && /\bexcel\b/i.test(instruction)) {
    sourceType = 'excel';
    fileName = 'uploaded-contacts.xlsx';
  } else if (!input.uploadedFile && /\bpdf\b/i.test(instruction)) {
    sourceType = 'pdf';
    fileName = 'uploaded-contacts.pdf';
  } else if (!input.uploadedFile && /\bcsv\b/i.test(instruction)) {
    sourceType = 'csv';
    fileName = 'uploaded-contacts.csv';
  }

  if (!contactRawText && !contactBase64) {
    // Split multi-line chat message into instruction line(s) and pasted contact rows
    const allLines = input.chatMessage
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    const contactLines: string[] = [];
    const instructionLines: string[] = [];
    for (const line of allLines) {
      const hasPhoneOrEmail =
        /(?:\+\d{1,3}[\s.-]?)?(?:\d[\s.-]?){9,13}\d/.test(line) ||
        /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(line) ||
        /^name\s*,\s*phone/i.test(line);
      if (hasPhoneOrEmail && !/\b(?:thaara|tomorrow\s+we\s+have|send\s+invitations)\b/i.test(line)) {
        contactLines.push(line);
      } else {
        instructionLines.push(line);
      }
    }
    instruction = instructionLines.join(' ').trim() || DEFAULT_DEMO_INSTRUCTION;
    contactRawText = contactLines.join('\n');
  }

  let importResult: BulkCampaignImportResult;
  if (!contactRawText && !contactBase64 && input.existingCampaign && input.existingCampaign.contacts.length > 0) {
    importResult = {
      sourceType: input.existingCampaign.importSummary.sourceType,
      ...(input.existingCampaign.importSummary.fileName
        ? { fileName: input.existingCampaign.importSummary.fileName }
        : {}),
      totalRowsParsed: input.existingCampaign.importSummary.totalRowsParsed,
      validContacts: input.existingCampaign.contacts.map(r => r.contact),
      duplicates: input.existingCampaign.importSummary.duplicates,
      invalidEntries: input.existingCampaign.importSummary.invalidEntries,
      consentNotice: input.existingCampaign.importSummary.consentNotice
    };
  } else {
    if (!contactRawText && !contactBase64 && input.fallbackToDemoContactsWhenEmpty) {
      contactRawText = SYNTHETIC_DEMO_CONTACTS_CSV;
    }
    importResult = parseBulkCampaignContacts({
      sourceType,
      ...(fileName ? { fileName } : {}),
      rawText: contactRawText,
      ...(contactBase64 ? { fileBase64: contactBase64 } : {}),
      phoneDirectory: input.phoneDirectory,
      ...(input.whatsappDirectory ? { whatsappDirectory: input.whatsappDirectory } : {})
    });
  }

  const campaign = createBulkCampaignPlan({
    workspaceId: input.workspaceId,
    userId: input.userId,
    instruction,
    importResult,
    ...(input.channels && input.channels.length > 0 ? { channels: input.channels } : {}),
    ...(input.knowledgeFiles && input.knowledgeFiles.length > 0 ? { knowledgeFiles: input.knowledgeFiles } : {}),
    ...(input.whatsappConnectionId ? { whatsappConnectionId: input.whatsappConnectionId } : {}),
    ...(input.whatsappBusinessLabel ? { whatsappBusinessLabel: input.whatsappBusinessLabel } : {}),
    ...(input.whatsappTemplateName ? { whatsappTemplateName: input.whatsappTemplateName } : {}),
    ...(input.whatsappTemplateLanguage ? { whatsappTemplateLanguage: input.whatsappTemplateLanguage } : {}),
    ...(input.whatsappTemplatePreview ? { whatsappTemplatePreview: input.whatsappTemplatePreview } : {}),
    ...(input.emailConnected !== undefined ? { emailConnected: input.emailConnected } : {}),
    ...(input.liveCallingEnabled !== undefined ? { liveCallingEnabled: input.liveCallingEnabled } : {}),
    ...(input.liveSendingEnabled !== undefined ? { liveSendingEnabled: input.liveSendingEnabled } : {}),
    ...(input.dailyPhoneCallLimit !== undefined
      ? { limits: { dailyPhoneCallLimit: input.dailyPhoneCallLimit } }
      : {})
  });

  return {
    campaign,
    summaryText: buildBulkCampaignChatSummary(campaign)
  };
}

/**
 * Stage 7: Thaara Chat Follow-Up Commands for the Bulk Campaign Agent.
 */
export type BulkCampaignChatCommandMode =
  | 'results_summary'
  | 'campaign_preview'
  | 'who_confirmed'
  | 'who_did_not_answer'
  | 'callbacks_needed'
  | 'who_is_eligible'
  | 'prepare_script_only'
  | 'pause_campaign'
  | 'resume_campaign'
  | 'cancel_campaign'
  | 'stop_campaign';

export function detectBulkCampaignChatCommand(message: string): BulkCampaignChatCommandMode | null {
  const text = message.normalize('NFKC').trim().replace(/^(?:hey\s+|hi\s+)?thaara[,:]?\s*/i, '');
  if (!text || text.length > 260) return null;
  if (/\b(?:reject|abort|discard)\s+(?:this\s+|the\s+|my\s+)?campaign\b/i.test(text)) return 'cancel_campaign';
  if (/\bpause\s+(?:this\s+|the\s+|my\s+)?campaign\b/i.test(text)) return 'pause_campaign';
  if (/\bresume\s+(?:this\s+|the\s+|my\s+)?campaign\b/i.test(text)) return 'resume_campaign';
  if (/\b(?:stop|cancel|halt)\s+(?:this\s+|the\s+|my\s+)?campaign\b/i.test(text)) return 'stop_campaign';
  if (
    /\b(?:which|what|who)\s+contacts?\s+are\s+eligible\b/i.test(text) ||
    /\bshow\s+(?:me\s+)?(?:the\s+)?eligible\s+contacts?\b/i.test(text)
  ) {
    return 'who_is_eligible';
  }
  if (
    /\bprepare\s+(?:the\s+|an?\s+)?(?:ai\s+)?(?:call(?:ing)?\s+|phone\s+|campaign\s+|whatsapp\s+)?(?:script|campaign)\b[\s,]*but\s+(?:don['’]?t|do\s+not)\s+(?:send|call|dial|dispatch)(?:\s+anyone|\s+anything)?\b/i.test(
      text
    )
  ) {
    return 'prepare_script_only';
  }
  if (/\bwho\s+confirmed\b/i.test(text)) return 'who_confirmed';
  if (/\bwho\s+did(?:\s+not|n['’]t)\s+answer\b/i.test(text)) return 'who_did_not_answer';
  if (
    /\b(?:show\s+)?(?:customers?|contacts?|who)\s+(?:needing|need|requesting|asked\s+for)\s+(?:a\s+)?callback\b/i.test(
      text
    )
  ) {
    return 'callbacks_needed';
  }
  if (/\b(?:show|view|display|get|give\s+me)\s+(?:me\s+)?(?:the\s+|my\s+)?campaign\s+(?:preview|plan|draft)\b/i.test(text)) {
    return 'campaign_preview';
  }
  if (/\b(?:show|check|get|give\s+me)\s+(?:today['’]?s\s+|the\s+|my\s+)?campaign\s+(?:results?|report|status|summary)\b/i.test(text)) {
    return 'results_summary';
  }
  return null;
}

export function executeBulkCampaignChatCommand(
  mode: BulkCampaignChatCommandMode,
  campaign: BulkCampaignState | null
): { assistantResponseText: string; updatedCampaign?: BulkCampaignState } {
  if (!campaign) {
    return {
      assistantResponseText:
        'No active or recent bulk campaign was found in this workspace. No real or simulated campaign has executed, and no verified real-world customer outcomes exist.'
    };
  }
  const isLiveExecution = campaign.executionMode === 'live';
  const hasExecuted =
    isLiveExecution ||
    campaign.executionMode === 'simulation' ||
    campaign.status === 'completed' ||
    campaign.contacts.some(
      c =>
        c.phoneStatus !== 'pending' &&
        c.phoneStatus !== 'skipped' &&
        c.phoneStatus !== 'queued' &&
        c.phoneStatus !== 'awaiting_approval' &&
        c.phoneStatus !== 'cancelled'
    );
  const lockLabel = `liveCallingEnabled=${Boolean(campaign.liveCallingEnabled)}, liveSendingEnabled=${Boolean(campaign.liveSendingEnabled)}`;

  if (mode === 'cancel_campaign') {
    const cancelled = rejectOrCancelBulkCampaign(campaign);
    return {
      updatedCampaign: cancelled,
      assistantResponseText: `Rejected and cancelled campaign "${cancelled.title}" (${cancelled.campaignId}). Approval has been revoked and no messages or calls will be sent (${lockLabel}).`
    };
  }
  if (mode === 'pause_campaign') {
    if (!['approved', 'scheduled', 'running', 'paused'].includes(campaign.status)) {
      return {
        assistantResponseText: `Campaign "${campaign.title}" is currently in status "${campaign.status.toUpperCase()}" and cannot be paused until approved.`
      };
    }
    const paused = pauseBulkCampaign(campaign);
    return {
      updatedCampaign: paused,
      assistantResponseText: `Paused campaign "${paused.title}" (${paused.campaignId}). Pending contacts remain safely held until resumed (${lockLabel}).`
    };
  }
  if (mode === 'resume_campaign') {
    if (campaign.status !== 'paused') {
      return {
        assistantResponseText: `Campaign "${campaign.title}" is currently in status "${campaign.status.toUpperCase()}" (not paused).`
      };
    }
    const resumed = resumeBulkCampaign(campaign);
    return {
      updatedCampaign: resumed,
      assistantResponseText: `Resumed campaign "${resumed.title}" (${resumed.campaignId}) in status ${resumed.status.toUpperCase()} (${lockLabel}).`
    };
  }
  if (mode === 'stop_campaign') {
    const stopped = stopBulkCampaign(campaign);
    return {
      updatedCampaign: stopped,
      assistantResponseText: `Stopped campaign "${stopped.title}" (${stopped.campaignId}). All pending WhatsApp dispatches and outbound calls have been cancelled (${lockLabel}).`
    };
  }
  if (mode === 'who_is_eligible') {
    const cats = categorizeBulkCampaignContacts(campaign);
    if (cats.eligible.length === 0) {
      return {
        assistantResponseText: `No contacts are currently eligible in campaign "${campaign.title}" (${cats.unauthorized.length} unauthorized, ${cats.unsupported.length} unsupported/queued, ${cats.duplicates.length} duplicates, ${cats.invalidEntries.length} invalid).`
      };
    }
    return {
      assistantResponseText:
        `Eligible contacts for "${campaign.title}" (${cats.eligible.length} of ${campaign.contacts.length} valid contacts — ${isLiveExecution ? 'LIVE GOVERNED' : hasExecuted ? 'SIMULATION-ONLY' : 'PLANNED ONLY'}):\n` +
        cats.eligible
          .map(
            r =>
              `• ${r.contact.name} (${r.contact.maskedPhone ?? r.contact.email ?? 'N/A'}) [${r.contact.preferredLanguage}] — ${r.categoryReason}`
          )
          .join('\n') +
        `\n\nHeld back: ${cats.unauthorized.length} unauthorized, ${cats.unsupported.length} unsupported/queued, ${cats.duplicates.length} duplicates, ${cats.invalidEntries.length} invalid.`
    };
  }
  if (mode === 'prepare_script_only') {
    return {
      updatedCampaign: campaign,
      assistantResponseText:
        `Prepared script for "${campaign.title}" (${campaign.campaignId}) in DRAFT mode — nothing has been sent or dialed (PLANNED ONLY, ${lockLabel}):\n` +
        `• Channels: ${campaign.channels.join(', ')}\n` +
        `• WhatsApp Template (${campaign.whatsappPlan.templateName}): "${campaign.whatsappPlan.messagePreview}"\n` +
        `• Sarvam AI Disclosure: "${campaign.callScript.aiDisclosure}"\n` +
        `• Opening Line: "${campaign.callScript.openingLine}"\n` +
        `• Bounded Call Purpose: "${campaign.callScript.boundedPurposePreview}"\n` +
        `• Status: ${campaign.status.toUpperCase()} (No messages or calls dispatched; no verified real-world outcomes exist)`
    };
  }
  if (mode === 'campaign_preview') {
    return {
      assistantResponseText:
        `Campaign Preview (${isLiveExecution ? 'LIVE GOVERNED RUN' : hasExecuted ? 'SIMULATION-ONLY RUN' : 'PLANNED — NOT YET EXECUTED'} | ${lockLabel}):\n` +
        buildBulkCampaignChatSummary(campaign)
    };
  }
  if (mode === 'who_confirmed') {
    if (!hasExecuted) {
      return {
        assistantResponseText: `No real or simulated campaign has executed yet for "${campaign.title}" (current status: ${campaign.status.toUpperCase()} — PLANNED ONLY). No verified real-world customer confirmations or call outcomes exist.`
      };
    }
    const list = campaign.contacts.filter(r => r.attendanceOutcome === 'confirmed');
    if (list.length === 0) {
      return {
        assistantResponseText: isLiveExecution
          ? `LIVE CAMPAIGN RESULTS (${lockLabel}): No contacts have confirmed attendance yet (provider/AI interpretations remain unverified until confirmed).`
          : 'SIMULATION-ONLY: No simulated contacts confirmed attendance, and no verified real-world customer outcomes exist.'
      };
    }
    const header = isLiveExecution
      ? `LIVE CAMPAIGN RESULTS (${lockLabel} — AI interpretation from unverified call/WhatsApp responses — ${list.length}):`
      : `SIMULATION-ONLY RESULTS (${lockLabel} — no real campaign has executed and no verified real-world outcomes exist).\nConfirmed attendees (AI interpretation from simulated unverified transcript — ${list.length}):`;
    return {
      assistantResponseText:
        `${header}\n` +
        list
          .map(
            r =>
              `• ${r.contact.name} (${r.contact.maskedPhone ?? r.contact.email ?? 'N/A'}) — ${isLiveExecution ? 'Quote' : 'Simulated quote'}: "${r.phoneRawResponses[0] ?? r.whatsappCustomerReply ?? 'N/A'}"`
          )
          .join('\n')
    };
  }
  if (mode === 'who_did_not_answer') {
    if (!hasExecuted) {
      return {
        assistantResponseText: `No real or simulated campaign has executed yet for "${campaign.title}" (current status: ${campaign.status.toUpperCase()} — PLANNED ONLY). No verified real-world call outcomes exist.`
      };
    }
    const list = campaign.contacts.filter(r => r.phoneStatus === 'not_answered');
    if (list.length === 0) {
      return {
        assistantResponseText: isLiveExecution
          ? `LIVE CAMPAIGN RESULTS (${lockLabel}): No called contacts are currently marked unanswered.`
          : 'SIMULATION-ONLY: All simulated called contacts answered or are still pending. No verified real-world call outcomes exist.'
      };
    }
    const header = isLiveExecution
      ? `LIVE CAMPAIGN RESULTS (${lockLabel}).\nContacts who did not answer (${list.length}):`
      : `SIMULATION-ONLY RESULTS (${lockLabel} — no real campaign has executed and no verified real-world outcomes exist).\nContacts who did not answer in simulation (${list.length}):`;
    return {
      assistantResponseText:
        `${header}\n` +
        list
          .map(
            r =>
              `• ${r.contact.name} (${r.contact.maskedPhone ?? 'N/A'}) — ${isLiveExecution ? 'WhatsApp' : 'Simulated WhatsApp'}: ${r.whatsappStatus}`
          )
          .join('\n')
    };
  }
  if (mode === 'callbacks_needed') {
    if (!hasExecuted) {
      return {
        assistantResponseText: `No real or simulated campaign has executed yet for "${campaign.title}" (current status: ${campaign.status.toUpperCase()} — PLANNED ONLY). No verified real-world callback requests exist.`
      };
    }
    const list = campaign.contacts.filter(r => r.attendanceOutcome === 'callback_requested');
    if (list.length === 0) {
      return {
        assistantResponseText: isLiveExecution
          ? `LIVE CAMPAIGN RESULTS (${lockLabel}): No contacts have requested a callback yet.`
          : 'SIMULATION-ONLY: No contacts requested a callback in this simulation, and no verified real-world outcomes exist.'
      };
    }
    const header = isLiveExecution
      ? `LIVE CAMPAIGN RESULTS (${lockLabel} — AI interpretation from unverified call/WhatsApp responses — ${list.length}):`
      : `SIMULATION-ONLY RESULTS (${lockLabel} — no real campaign has executed and no verified real-world outcomes exist).\nCustomers needing a callback (AI interpretation from simulated unverified transcript — ${list.length}):`;
    return {
      assistantResponseText:
        `${header}\n` +
        list
          .map(
            r =>
              `• ${r.contact.name} (${r.contact.maskedPhone ?? 'N/A'})${r.preferredCallbackTime ? ` — Preferred time: ${r.preferredCallbackTime}` : ''} — ${isLiveExecution ? 'Quote' : 'Simulated quote'}: "${r.phoneRawResponses[0] ?? r.whatsappCustomerReply ?? 'N/A'}"`
          )
          .join('\n')
    };
  }

  return {
    assistantResponseText: buildBulkCampaignChatSummary(campaign)
  };
}

export type BulkCampaignChatIntent =
  | { kind: 'command'; mode: BulkCampaignChatCommandMode; rawMessage: string }
  | { kind: 'create_campaign'; rawMessage: string };

/**
 * Detects natural-language Bulk Campaign creation and follow-up commands in Thaara Chat
 * while leaving single-recipient WhatsApp, Phone, and Gmail commands untouched.
 */
export function detectBulkCampaignChatIntent(
  message: string,
  options?: { hasContactAttachment?: boolean }
): BulkCampaignChatIntent | null {
  const raw = message.normalize('NFKC').trim();
  if (!raw) return null;

  const commandMode = detectBulkCampaignChatCommand(raw);
  if (commandMode) {
    return { kind: 'command', mode: commandMode, rawMessage: raw };
  }

  const text = raw.replace(/^(?:hey\s+|hi\s+)?thaara[,:]?\s*/i, '');

  const explicitBulkCampaignPattern =
    /\b(?:bulk\s+(?:whatsapp|phone|call\w*|email|message|campaign)|(?:(?:webinar|event|promotional|free)\s+)?(?:whatsapp|phone|calling|call|email|webinar|outreach|marketing)\s+campaign|prepare\s+(?:a|an)\s+(?:ai\s+|webinar\s+)?(?:calling\s+|phone\s+|whatsapp\s+|email\s+)?campaign|create\s+(?:a|an)\s+(?:bulk\s+|webinar\s+)?(?:phone\s+|calling\s+|whatsapp\s+|email\s+)?campaign|start\s+(?:a|an)\s+(?:bulk\s+|webinar\s+)?campaign)\b/i;

  const multiRecipientCampaignCues =
    /\b(?:(?:for|call|message|invite|email)\s+these\s+(?:\d+\s+)?(?:customers?|contacts?|leads?|people|attendees?|numbers?|phone\s+numbers?)|here\s+are\s+\d+\s+(?:phone\s+)?(?:numbers?|contacts?|customers?|leads?|people)|for\s+the\s+contacts?\s+i\s+uploaded|using\s+this\s+(?:excel|csv|pdf)\s+contact\s+list|send\s+invitations\s+to\s+these\s+contacts|call\s+the\s+eligible\s+contacts|ee\s+contacts?\s+ge\s+(?:webinar|invite|call|message)|campaign\s+maad(?:i|u))\b/i;

  if (explicitBulkCampaignPattern.test(text) || multiRecipientCampaignCues.test(text)) {
    return { kind: 'create_campaign', rawMessage: raw };
  }

  if (
    options?.hasContactAttachment &&
    /\b(?:invit\w*|webinar|campaign|outreach|call\s+(?:them|these|eligible|contacts)|whatsapp\s+(?:them|these|contacts)|send\s+(?:messages?|invit\w*))\b/i.test(
      text
    )
  ) {
    return { kind: 'create_campaign', rawMessage: raw };
  }

  // Multi-line message containing an invitation/webinar instruction AND 2+ contact rows (or CSV header)
  const lines = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length >= 2) {
    const contactRowCount = lines.filter(
      l =>
        /^name\s*,\s*phone/i.test(l) ||
        /(?:\+\d{1,3}[\s.-]?)?(?:\d[\s.-]?){9,13}\d/.test(l)
    ).length;
    if (contactRowCount >= 2 && /\b(?:webinar|invit\w*|campaign|eligible|report)\b/i.test(raw)) {
      return { kind: 'create_campaign', rawMessage: raw };
    }
  }

  return null;
}

export interface ChatBulkCampaignStepStatus {
  stepId: string;
  stepOrder: number;
  actionName: string;
  status: string;
  receiptId: string | null;
  receiptStatus: string | null;
  verificationMethod: string | null;
  proof: Record<string, unknown> | null;
  error: string | null;
}

export interface ChatBulkCampaignOutcome {
  handled: boolean;
  status: 'awaiting_approval' | 'completed' | 'stopped' | 'cancelled' | 'draft';
  campaignId?: string;
  planId?: string;
  planStatus?: string;
  approvalId?: string | null;
  steps?: ChatBulkCampaignStepStatus[];
  assistantResponseText: string;
}

export function buildBulkCampaignPlanStepPayload(campaign: BulkCampaignState): Record<string, unknown> {
  const m = computeBulkCampaignMetrics(campaign);
  const eligibleEmailContacts = campaign.contacts.filter(c => c.emailEligibility === 'eligible').length;
  return {
    campaignId: campaign.campaignId,
    title: campaign.title,
    objective: campaign.objective,
    eventDetails: campaign.eventDetails,
    channels: campaign.channels,
    materialHash: campaign.materialHash,
    status: campaign.status,
    executionMode: campaign.executionMode,
    liveCallingEnabled: Boolean(campaign.liveCallingEnabled),
    liveSendingEnabled: Boolean(campaign.liveSendingEnabled),
    totalContactsCount: m.totalContacts,
    eligibleContactsCount: m.eligibleContacts,
    unauthorizedContactsCount: m.unauthorizedContacts,
    unsupportedContactsCount: m.unsupportedContacts,
    duplicateEntriesCount: m.duplicateEntries,
    invalidEntriesCount: m.invalidEntries,
    eligibleWhatsappContacts: m.eligibleWhatsappContacts,
    eligiblePhoneContacts: m.eligiblePhoneContacts,
    eligibleEmailContacts,
    whatsappPlan: campaign.whatsappPlan,
    callScript: campaign.callScript,
    ...(campaign.emailPlan ? { emailPlan: campaign.emailPlan } : {}),
    limits: campaign.limits,
    consentNotice: campaign.importSummary.consentNotice
  };
}

export async function executeChatBulkCampaign(
  scope: AuthenticatedScope,
  intent: BulkCampaignChatIntent,
  deps: {
    store?: BulkCampaignWorkspaceStore;
    db?: TransactionalDbClient;
    conversationId?: string;
    uploadedFile?: {
      sourceType: BulkCampaignSourceType;
      fileName?: string;
      rawText: string;
      fileBase64?: string;
    };
    phoneCalling?: PhoneCallingService;
    phoneContacts?: PhoneContactManagementService;
    phoneFallbackDirectory?: PhoneContactDirectory;
    whatsappDurable?: DurableWhatsAppService;
    whatsappTemplates?: WhatsAppTemplateService;
    gmail?: GmailFoundation;
  } = {}
): Promise<ChatBulkCampaignOutcome> {
  const store = deps.store ?? defaultBulkCampaignStore;
  if (deps.db) {
    store.bindDb(deps.db);
  }
  const hasRealConnectorDeps = Boolean(deps.phoneCalling || deps.phoneContacts || deps.whatsappDurable || deps.gmail);
  const wsContext = hasRealConnectorDeps
    ? await getBulkCampaignWorkspaceContext(scope, {
        phoneCalling: deps.phoneCalling,
        phoneContacts: deps.phoneContacts,
        phoneFallbackDirectory: deps.phoneFallbackDirectory,
        whatsappDurable: deps.whatsappDurable,
        whatsappTemplates: deps.whatsappTemplates,
        gmail: deps.gmail
      })
    : undefined;

  let existing = await store.getLatestScoped(scope, deps.db);
  if (existing && existing.executionMode === 'live' && hasRealConnectorDeps) {
    try {
      existing = await reconcileBulkCampaignOutcomes(existing, {
        scope,
        phoneCalling: deps.phoneCalling,
        whatsappDurable: deps.whatsappDurable
      });
      await store.saveScoped(scope, existing, deps.db);
    } catch {
      // Keep stored state if provider reconciliation fails
    }
  }

  const realPhoneDir =
    wsContext && wsContext.phoneContactsConfigured && wsContext.context.savedPhoneContactsCount > 0
      ? wsContext.phoneDirectory
      : undefined;
  const approvedTemplate = wsContext?.context.availableTemplates.find(t => t.usableForCampaign);

  if (intent.kind === 'command') {
    let targetCampaign = existing;
    if (
      intent.mode === 'prepare_script_only' &&
      (!targetCampaign || /\b(?:ai\s+calling\s+campaign|calling\s+campaign|whatsapp\s+campaign)\b/i.test(intent.rawMessage))
    ) {
      const createdDraft = createBulkCampaignFromChatInput({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        chatMessage: intent.rawMessage,
        ...(deps.uploadedFile ? { uploadedFile: deps.uploadedFile } : {}),
        ...(realPhoneDir ? { phoneDirectory: realPhoneDir } : {}),
        ...(wsContext?.whatsappDirectory ? { whatsappDirectory: wsContext.whatsappDirectory } : {}),
        ...(wsContext?.context.whatsappConnectionId
          ? {
              whatsappConnectionId: wsContext.context.whatsappConnectionId,
              whatsappBusinessLabel: wsContext.context.whatsappBusinessLabel
            }
          : {}),
        ...(approvedTemplate
          ? {
              whatsappTemplateName: approvedTemplate.name,
              whatsappTemplateLanguage: approvedTemplate.language,
              whatsappTemplatePreview: approvedTemplate.bodyText
            }
          : {}),
        ...(wsContext
          ? {
              emailConnected: wsContext.context.emailConnected,
              liveCallingEnabled: wsContext.context.liveCallingEnabled,
              liveSendingEnabled: wsContext.context.liveSendingEnabled,
              dailyPhoneCallLimit: wsContext.context.dailyPhoneCallLimit
            }
          : {}),
        ...(existing ? { existingCampaign: existing } : {}),
        fallbackToDemoContactsWhenEmpty: !deps.uploadedFile
      });
      targetCampaign = await store.saveScoped(scope, createdDraft.campaign, deps.db);
    }

    const res = executeBulkCampaignChatCommand(intent.mode, targetCampaign);
    if (res.updatedCampaign) {
      await store.saveScoped(scope, res.updatedCampaign, deps.db);
    }
    return {
      handled: true,
      status:
        intent.mode === 'cancel_campaign'
          ? 'cancelled'
          : intent.mode === 'stop_campaign'
            ? 'stopped'
            : intent.mode === 'prepare_script_only'
              ? 'draft'
              : 'completed',
      ...(res.updatedCampaign ? { campaignId: res.updatedCampaign.campaignId } : targetCampaign ? { campaignId: targetCampaign.campaignId } : {}),
      assistantResponseText: res.assistantResponseText
    };
  }

  // Create campaign draft from natural-language Chat request (+ optional uploaded attachment)
  const useUploadedFromExisting =
    !deps.uploadedFile &&
    /\b(?:contacts?\s+i\s+uploaded|these\s+contacts)\b/i.test(intent.rawMessage) &&
    Boolean(existing);
  const created = createBulkCampaignFromChatInput({
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    chatMessage: intent.rawMessage,
    ...(deps.uploadedFile ? { uploadedFile: deps.uploadedFile } : {}),
    ...(realPhoneDir ? { phoneDirectory: realPhoneDir } : {}),
    ...(wsContext?.whatsappDirectory ? { whatsappDirectory: wsContext.whatsappDirectory } : {}),
    ...(wsContext?.context.whatsappConnectionId
      ? {
          whatsappConnectionId: wsContext.context.whatsappConnectionId,
          whatsappBusinessLabel: wsContext.context.whatsappBusinessLabel
        }
      : {}),
    ...(approvedTemplate
      ? {
          whatsappTemplateName: approvedTemplate.name,
          whatsappTemplateLanguage: approvedTemplate.language,
          whatsappTemplatePreview: approvedTemplate.bodyText
        }
      : {}),
    ...(wsContext
      ? {
          emailConnected: wsContext.context.emailConnected,
          liveCallingEnabled: wsContext.context.liveCallingEnabled,
          liveSendingEnabled: wsContext.context.liveSendingEnabled,
          dailyPhoneCallLimit: wsContext.context.dailyPhoneCallLimit
        }
      : {}),
    ...(useUploadedFromExisting ? { existingCampaign: existing } : {}),
    fallbackToDemoContactsWhenEmpty: !deps.uploadedFile
  });

  let campaign = created.campaign;
  let planId: string | undefined;
  let stepId: string | undefined;
  let approvalId: string | undefined;

  if (deps.db) {
    try {
      const persisted = await deps.db.withScopedTransaction(scope, async tx => {
        const membership = await new MembershipRepository(tx).findByUserAndWorkspace(
          scope.workspaceId,
          scope.userId
        );
        if (!membership || membership.role === 'viewer') {
          return null;
        }
        const plans = new PlanRepository(tx);
        const steps = new PlanStepRepository(tx);
        const params = buildBulkCampaignPlanStepPayload(campaign);
        const plan = await plans.create(
          scope.workspaceId,
          scope.userId,
          `Bulk Campaign: ${campaign.title}`,
          campaign.objective,
          {
            source: 'chat_automation_orchestrator',
            workflowKind: 'bulk_campaign',
            campaignId: campaign.campaignId,
            channels: campaign.channels,
            materialHash: campaign.materialHash,
            ...(deps.conversationId ? { conversationId: deps.conversationId } : {})
          }
        );
        const step = await steps.create(
          scope.workspaceId,
          plan.id,
          0,
          BULK_CAMPAIGN_EXECUTE_ACTION,
          'write',
          'high',
          'explicit',
          params,
          computeCanonicalParameterHash(params)
        );
        await steps.transitionStatus(scope.workspaceId, step.id, ['ready', 'blocked'], 'awaiting_approval');
        await plans.transitionStatus(scope.workspaceId, plan.id, 'draft', 'awaiting_approval');
        const approval = await new ApprovalRepository(tx).create(
          scope.workspaceId,
          BULK_CAMPAIGN_EXECUTE_ACTION,
          params,
          scope.userId,
          'high',
          86400
        );
        await new PlanStepApprovalBindingRepository(tx).create(
          scope.workspaceId,
          plan.id,
          step.id,
          approval.id,
          step.parameter_hash
        );
        await new AuditEventRepository(tx).create(
          scope.workspaceId,
          'campaign.bulk.chat_prepared',
          'plan_step',
          {
            planId: plan.id,
            stepId: step.id,
            approvalId: approval.id,
            campaignId: campaign.campaignId,
            channels: campaign.channels
          },
          scope.userId,
          step.id
        );
        return { planId: plan.id, stepId: step.id, approvalId: approval.id };
      });
      if (persisted) {
        planId = persisted.planId;
        stepId = persisted.stepId;
        approvalId = persisted.approvalId;
        campaign = {
          ...campaign,
          governedPlanId: planId,
          governedStepId: stepId,
          governedApprovalId: approvalId
        };
      }
    } catch {
      // Fall back cleanly if DB tables are not initialized in lightweight unit tests
    }
  }

  await store.saveScoped(scope, campaign, deps.db);

  const reviewNotice =
    `\n\nReview the campaign summary, contact eligibility buckets, and script preview above. Nothing is sent or called without your explicit approval (liveCallingEnabled=${Boolean(campaign.liveCallingEnabled)}, liveSendingEnabled=${Boolean(campaign.liveSendingEnabled)}).`;

  return {
    handled: true,
    status: 'awaiting_approval',
    campaignId: campaign.campaignId,
    ...(planId ? { planId, planStatus: 'awaiting_approval' } : {}),
    ...(approvalId ? { approvalId } : {}),
    ...(stepId
      ? {
          steps: [
            {
              stepId,
              stepOrder: 0,
              actionName: BULK_CAMPAIGN_EXECUTE_ACTION,
              status: 'awaiting_approval',
              receiptId: null,
              receiptStatus: null,
              verificationMethod: null,
              proof: null,
              error: null
            }
          ]
        }
      : {}),
    assistantResponseText: `${created.summaryText}${reviewNotice}`
  };
}

/**
 * Policy Gateway ActionAdapter for `campaign.bulk.execute` so approving a Bulk Campaign
 * via `/api/v1/approvals/:id/decide` enforces materialHash integrity and approves the campaign.
 */
export function createBulkCampaignActionAdapter(
  store: BulkCampaignWorkspaceStore = defaultBulkCampaignStore,
  db?: TransactionalDbClient
): ActionAdapter {
  if (db) {
    store.bindDb(db);
  }
  return {
    name: BULK_CAMPAIGN_EXECUTE_ACTION,
    idempotencySupport: 'native',
    async execute(context: ActionExecutionContext): Promise<ActionResult> {
      const scope = context.scope as AuthenticatedScope | undefined;
      const params = (context.parameters ?? {}) as {
        campaignId?: string;
        materialHash?: string;
      };
      if (!scope?.workspaceId || !params.campaignId || !params.materialHash) {
        return {
          success: false,
          status: 'failed',
          verificationMethod: 'policy_gateway_context_check',
          proof: { approved: false },
          error: 'Missing workspace scope, campaignId, or materialHash.'
        };
      }
      const campaign = await store.getScoped(scope, params.campaignId, db);
      if (!campaign) {
        return {
          success: false,
          status: 'failed',
          verificationMethod: 'campaign_store_lookup',
          proof: { approved: false, campaignId: params.campaignId },
          error: `Campaign ${params.campaignId} was not found in workspace.`
        };
      }
      if (campaign.status === 'stopped') {
        return {
          success: false,
          status: 'failed',
          verificationMethod: 'campaign_status_check',
          proof: { approved: false, campaignId: campaign.campaignId, status: campaign.status },
          error: 'Campaign has been stopped or cancelled and cannot be approved.'
        };
      }
      try {
        const approved = approveBulkCampaign(campaign, {
          userId: scope.userId,
          role: scope.role,
          expectedMaterialHash: params.materialHash
        });
        await store.saveScoped(scope, approved, db);
        return {
          success: true,
          status: 'unverified',
          verificationMethod: 'bulk_campaign_plan_approval',
          proof: {
            approved: true,
            campaignId: approved.campaignId,
            materialHash: approved.materialHash,
            approvalId: approved.approval?.approvalId ?? null,
            liveCallingEnabled: Boolean(approved.liveCallingEnabled),
            liveSendingEnabled: Boolean(approved.liveSendingEnabled)
          }
        };
      } catch (err) {
        return {
          success: false,
          status: 'failed',
          verificationMethod: 'bulk_campaign_plan_approval',
          proof: { approved: false, campaignId: campaign.campaignId },
          error: (err as Error).message
        };
      }
    }
  };
}

/**
 * Approves every prepared `awaiting_approval` Phone call draft in the campaign ONE BY ONE
 * through the governed per-call approval path so every single `approvalId` gets its own
 * fresh authorization check and audit event (zero batch-token bypass).
 */
export async function approveAllCampaignPhoneDrafts(
  campaign: BulkCampaignState,
  phoneAdapter: BulkCampaignPhoneAdapter,
  input: {
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'viewer';
    now?: Date;
  }
): Promise<BulkCampaignState> {
  if (input.role !== 'owner' && input.role !== 'admin') {
    throw new Error('Only the workspace owner or admin can approve phone call drafts.');
  }
  let current = campaign;
  for (const contact of campaign.contacts) {
    if (contact.phoneApprovalId && contact.phoneApprovalStatus === 'awaiting_approval') {
      current = await approveSingleCampaignPhoneDraft(current, phoneAdapter, {
        approvalId: contact.phoneApprovalId,
        userId: input.userId,
        role: input.role,
        ...(input.now ? { now: input.now } : {})
      });
    }
  }
  return current;
}

export interface BulkCampaignWorkspaceConnectorDeps {
  db?: TransactionalDbClient;
  phoneCalling?: PhoneCallingService;
  phoneContacts?: PhoneContactManagementService;
  phoneFallbackDirectory?: PhoneContactDirectory;
  dailyPhoneCallLimit?: number;
  whatsappDurable?: DurableWhatsAppService;
  whatsappTemplates?: WhatsAppTemplateService;
  gmail?: GmailFoundation;
}

export async function getBulkCampaignWorkspaceContext(
  scope: AuthenticatedScope,
  deps: BulkCampaignWorkspaceConnectorDeps
): Promise<{
  context: BulkCampaignWorkspaceContext;
  phoneDirectory: PhoneContactView[];
  phoneContactsConfigured: boolean;
  whatsappDirectory: WhatsAppOptedInDirectoryEntry[];
}> {
  let phoneDirectory: PhoneContactView[] = [];
  let phoneContactsConfigured = false;
  let liveCallingEnabled = false;
  const unlimitedDailyCalls =
    deps.dailyPhoneCallLimit === undefined &&
    /^unlimited$/i.test((process.env.THAARA_PHONE_DAILY_CALL_LIMIT ?? '').trim());
  const dailyPhoneCallLimit = unlimitedDailyCalls
    ? 100
    : Math.min(
        MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT,
        Math.max(1, deps.dailyPhoneCallLimit ?? DEFAULT_DAILY_PHONE_CALL_LIMIT)
      );

  if (deps.phoneCalling) {
    try {
      const st = await deps.phoneCalling.status(scope);
      liveCallingEnabled = Boolean(st.liveCallingEnabled);
      phoneContactsConfigured = Boolean(st.contactDirectoryConfigured);
    } catch {
      // Viewer or unconfigured phone service
    }
  }

  if (deps.phoneContacts) {
    try {
      const listed = await deps.phoneContacts.list(scope);
      phoneDirectory = listed.contacts;
      phoneContactsConfigured = true;
    } catch {
      // Not configured in this environment unless fallback directory exists
    }
  }
  if (phoneDirectory.length === 0 && deps.phoneFallbackDirectory) {
    try {
      const raw = await deps.phoneFallbackDirectory.list(scope);
      phoneDirectory = raw.map(c => ({
        contactId: c.id,
        revision: c.revision,
        displayName: c.displayName,
        aliases: [...(c.aliases ?? [])],
        maskedPhone: maskPhoneCallNumber(c.phoneE164),
        archived: false,
        consent: {
          callingAllowed: c.consent.callingAllowed,
          source: 'recipient_written' as const,
          recordedAt: new Date().toISOString(),
          expiresAt: c.consent.expiresAt,
          expired: Date.parse(c.consent.expiresAt) <= Date.now()
        }
      }));
      phoneContactsConfigured = true;
    } catch {
      // Ignore fallback error
    }
  }

  let whatsappConnected = false;
  let whatsappConnectionId: string | null = null;
  let whatsappBusinessLabel = 'WhatsApp Business (Not Connected)';
  let liveSendingEnabled = false;
  let whatsappDirectory: WhatsAppOptedInDirectoryEntry[] = [];
  const availableTemplates: BulkCampaignTemplateSummary[] = [];

  if (deps.whatsappDurable) {
    try {
      const conns = await deps.whatsappDurable.connections(scope);
      const activeConn = conns.connections.find(c => !c.disconnected) ?? null;
      if (activeConn) {
        whatsappConnected = true;
        whatsappConnectionId = activeConn.connectionId;
        const displayNum = (activeConn as { displayPhoneNumber?: string }).displayPhoneNumber;
        whatsappBusinessLabel = displayNum
          ? `WhatsApp Business (${displayNum})`
          : `WhatsApp Business (${activeConn.connectionId})`;
        try {
          const contactsRes = await deps.whatsappDurable.contacts(scope, activeConn.connectionId);
          liveSendingEnabled = Boolean(contactsRes.liveSendingEnabled);
          whatsappDirectory = contactsRes.contacts.map(c => ({
            recipientId: c.recipientId,
            contactName: c.contactName,
            maskedPhone: c.maskedPhone,
            optedIn: c.optedIn
          }));
        } catch {
          // Connection exists but contacts lookup unavailable
        }
        if (deps.whatsappTemplates) {
          try {
            const tplCatalog = await deps.whatsappTemplates.list(scope, activeConn.connectionId);
            for (const t of tplCatalog.templates) {
              const usable =
                t.status === 'APPROVED' &&
                !t.headerMedia &&
                !t.unsupportedButtons &&
                !t.invalidPlaceholders &&
                (t.headerParams ?? 0) === 0 &&
                t.bodyParams <= 3;
              availableTemplates.push({
                name: t.name,
                language: t.language,
                status: t.status,
                category: t.category,
                bodyText: t.bodyText,
                bodyParams: t.bodyParams,
                usableForCampaign: usable
              });
            }
          } catch {
            // Meta template provider optional
          }
        }
      }
    } catch {
      // Durable WhatsApp unavailable for this role/environment
    }
  }

  let emailConnected = false;
  let connectedEmail: string | null = null;
  let emailSendReady = false;
  if (deps.gmail) {
    try {
      const gReadiness = await deps.gmail.sendReadiness(scope, 'new');
      emailConnected = gReadiness.status.status === 'connected';
      connectedEmail = gReadiness.connectedEmail ?? gReadiness.status.connectedEmail ?? null;
      emailSendReady = Boolean(gReadiness.ready);
    } catch {
      try {
        const gStatus = await deps.gmail.status(scope);
        emailConnected = gStatus.status === 'connected';
        connectedEmail = gStatus.connectedEmail ?? null;
      } catch {
        emailConnected = false;
      }
    }
  }

  // Initial Rollout Safety Gate (Condition 5): Real bulk Phone calls, WhatsApp campaign sending,
  // and Email campaign sending remain DISABLED until THAARA_BULK_CAMPAIGN_LIVE_ENABLED === 'true'.
  const liveBulkRolloutEnabled = process.env.THAARA_BULK_CAMPAIGN_LIVE_ENABLED === 'true';

  return {
    context: {
      whatsappConnected,
      whatsappConnectionId,
      whatsappBusinessLabel,
      liveSendingEnabled: liveBulkRolloutEnabled ? liveSendingEnabled : false,
      optedInWhatsappContactsCount: whatsappDirectory.filter(c => c.optedIn).length,
      availableTemplates,
      phoneContactsConfigured,
      savedPhoneContactsCount: phoneDirectory.filter(c => !c.archived).length,
      liveCallingEnabled: liveBulkRolloutEnabled ? liveCallingEnabled : false,
      dailyPhoneCallLimit,
      unlimitedDailyCalls,
      emailConnected,
      connectedEmail,
      emailSendReady,
      sarvamOutboundAgentLabel: SARVAM_OUTBOUND_AGENT_LABEL
    },
    phoneDirectory,
    phoneContactsConfigured,
    whatsappDirectory
  };
}

/**
 * Governed tenant-scoped Phone Adapter backed by the real `PhoneCallingService` and `PhoneContactManagementService`.
 * Falls back cleanly to simulation records during simulation runs so live calls are NEVER dialed unless `mode === 'live'`.
 */
export function createScopedPhoneCampaignAdapter(options: {
  scope: AuthenticatedScope;
  phoneCalling: PhoneCallingService;
  phoneContacts?: PhoneContactManagementService;
  phoneFallbackDirectory?: PhoneContactDirectory;
  db?: TransactionalDbClient;
  dailyCallLimit?: number;
  liveCallingEnabled?: boolean;
  useDemoFallbackWhenEmpty?: boolean;
}): BulkCampaignPhoneAdapter {
  const { scope, phoneCalling, db } = options;
  const limit = Math.min(
    MAX_CONFIGURED_DAILY_PHONE_CALL_LIMIT,
    Math.max(1, options.dailyCallLimit ?? DEFAULT_DAILY_PHONE_CALL_LIMIT)
  );
  const simFallbackAdapter = new MockBulkCampaignPhoneAdapter({ dailyCallLimit: limit });
  const localPreparedDrafts = new Map<string, PhoneCallingDraft>();
  const unsavedPhonesByApprovalId = new Map<string, string>();

  return {
    mode: 'published_phone_api',
    liveCallingEnabled: Boolean(options.liveCallingEnabled),
    integrationContract: CODEX_PHONE_BATCH_INTEGRATION_CONTRACT,
    dailyCallLimit: limit,

    async listDirectoryContacts() {
      if (options.phoneContacts) {
        try {
          const res = await options.phoneContacts.list(scope);
          if (res.contacts.length > 0 || !options.useDemoFallbackWhenEmpty) {
            return res;
          }
        } catch {
          // Fall through if phone contacts not configured
        }
      }
      if (options.phoneFallbackDirectory) {
        try {
          const raw = await options.phoneFallbackDirectory.list(scope);
          if (raw.length > 0 || !options.useDemoFallbackWhenEmpty) {
            return {
              contacts: raw.map(c => ({
                contactId: c.id,
                revision: c.revision,
                displayName: c.displayName,
                aliases: [...(c.aliases ?? [])],
                maskedPhone: maskPhoneCallNumber(c.phoneE164),
                archived: false,
                consent: {
                  callingAllowed: c.consent.callingAllowed,
                  source: 'recipient_written' as const,
                  recordedAt: new Date().toISOString(),
                  expiresAt: c.consent.expiresAt,
                  expired: Date.parse(c.consent.expiresAt) <= Date.now()
                }
              }))
            };
          }
        } catch {
          // Fall through
        }
      }
      if (options.useDemoFallbackWhenEmpty) {
        return simFallbackAdapter.listDirectoryContacts();
      }
      return { contacts: [] };
    },

    async prepareDraft(payload: PhoneCallingPrepare) {
      // Omit hardcoded maxDurationSeconds when delegating to PhoneCallingService so live agents with enforced caps never fail PHONE_DURATION_MISMATCH
      const cleanPayload: PhoneCallingPrepare = {
        contactQuery: payload.contactQuery,
        ...(payload.selectedContactId ? { selectedContactId: payload.selectedContactId } : {}),
        ...(payload.newRecipient ? { newRecipient: payload.newRecipient } : {}),
        purpose: payload.purpose,
        language: payload.language,
        ...(payload.openingGreeting ? { openingGreeting: payload.openingGreeting } : {})
      };
      const isUnsavedConsented = Boolean(
        payload.newRecipient?.consentConfirmed === true &&
          !payload.selectedContactId &&
          /^\+91[6-9][0-9]{9}$/.test(payload.contactQuery)
      );
      const releaseLease = isUnsavedConsented
        ? phoneCalling.authorizeCampaignRecipient(scope, payload.contactQuery)
        : null;
      try {
        const prepared = await phoneCalling.prepare(scope, cleanPayload);
        localPreparedDrafts.set(prepared.approvalId, structuredClone(prepared.draft));
        if (isUnsavedConsented) {
          unsavedPhonesByApprovalId.set(prepared.approvalId, payload.contactQuery);
        }
        return prepared;
      } catch (err) {
        if (options.useDemoFallbackWhenEmpty) {
          const mockPrep = await simFallbackAdapter.prepareDraft(payload);
          localPreparedDrafts.set(mockPrep.approvalId, structuredClone(mockPrep.draft));
          return mockPrep;
        }
        throw err;
      } finally {
        releaseLease?.();
      }
    },

    async listOpenRequests() {
      try {
        return await phoneCalling.requests(scope);
      } catch {
        return simFallbackAdapter.listOpenRequests();
      }
    },

    async approveCallDraft(input: {
      approvalId: string;
      approverUserId: string;
      persistedDraft?: PhoneCallingDraft;
    }) {
      if (scope.role !== 'owner' && scope.role !== 'admin') {
        throw new Error('PHONE_CALLING_DENIED: Only owner or admin can approve a call draft.');
      }
      if (db) {
        const transitioned = await db.withScopedTransaction(scope, async tx => {
          const repo = new ApprovalRepository(tx);
          const existing = await repo.findById(scope.workspaceId, input.approvalId);
          if (!existing) return false;
          if (
            existing.action_name !== PHONE_AI_CALL_ACTION ||
            existing.requester_user_id !== scope.userId ||
            new Date(existing.expires_at).getTime() <= Date.now()
          ) {
            throw new Error('PHONE_CALLING_DENIED: Phone call approval is invalid or expired.');
          }
          if (existing.status === 'pending') {
            await repo.transitionStatus(scope.workspaceId, input.approvalId, 'pending', 'approved', input.approverUserId);
            await new AuditEventRepository(tx).create(
              scope.workspaceId,
              'phone.ai.call_confirmed',
              'approval_request',
              { approvalId: input.approvalId, channel: 'bulk_campaign_per_call' },
              input.approverUserId,
              input.approvalId
            );
          } else if (existing.status !== 'approved') {
            throw new Error(`PHONE_CALLING_DENIED: Approval is in status "${existing.status}".`);
          }
          return true;
        });
        if (transitioned) {
          return { approvalId: input.approvalId, status: 'approved' as const };
        }
      }
      return simFallbackAdapter.approveCallDraft({
        approvalId: input.approvalId,
        approverUserId: input.approverUserId,
        ...(options.useDemoFallbackWhenEmpty && input.persistedDraft ? { persistedDraft: input.persistedDraft } : {})
      });
    },

    async placeSinglePilotCall(input: {
      approvalId: string;
      campaignId: string;
      contactId: string;
    }) {
      if (scope.role !== 'owner') {
        throw new Error('PHONE_CALLING_DENIED: Only the workspace owner can place a pilot call.');
      }
      const st = await phoneCalling.status(scope);
      if (!st.liveCallingEnabled) {
        throw new Error('LIVE_COMMUNICATIONS_DISABLED: Real phone calling is not enabled in this workspace.');
      }
      const unsavedPhone = unsavedPhonesByApprovalId.get(input.approvalId);
      const releaseLease = unsavedPhone
        ? phoneCalling.authorizeCampaignRecipient(scope, unsavedPhone)
        : null;
      try {
        return await phoneCalling.placeCall(scope, input.approvalId);
      } finally {
        releaseLease?.();
        unsavedPhonesByApprovalId.delete(input.approvalId);
      }
    },

    async placeOrSimulateApprovedCall(input: {
      approvalId: string;
      mode: 'simulation' | 'live';
      persistedDraft?: PhoneCallingDraft;
      persistedApproverUserId?: string;
      knowledgeContext?: BulkCampaignKnowledgeContext;
    }) {
      if (input.mode === 'live') {
        if (!options.liveCallingEnabled) {
          throw new Error('LIVE_COMMUNICATIONS_DISABLED: Bulk campaign live calling is disabled.');
        }
        const st = await phoneCalling.status(scope);
        if (!st.liveCallingEnabled) {
          throw new Error('LIVE_COMMUNICATIONS_DISABLED: Real phone calling is not enabled in this workspace.');
        }
        const unsavedPhone =
          (input.persistedDraft?.newRecipient?.consentConfirmed === true
            ? input.persistedDraft.newRecipient.phoneE164
            : undefined) ?? unsavedPhonesByApprovalId.get(input.approvalId);
        const releaseLease = unsavedPhone
          ? phoneCalling.authorizeCampaignRecipient(scope, unsavedPhone)
          : null;
        try {
          return await phoneCalling.placeCall(scope, input.approvalId);
        } finally {
          releaseLease?.();
          unsavedPhonesByApprovalId.delete(input.approvalId);
        }
      }

      if (
        options.useDemoFallbackWhenEmpty &&
        input.persistedDraft?.contactId?.startsWith('pdir_') &&
        input.persistedApproverUserId
      ) {
        return simFallbackAdapter.placeOrSimulateApprovedCall(input);
      }

      // Simulation mode: NEVER place a real phone call!
      const hasProcessedKnowledge = Boolean(
        input.knowledgeContext && input.knowledgeContext.files.some(f => f.status === 'processed')
      );
      if (!hasProcessedKnowledge) {
        try {
          const st = await phoneCalling.status(scope);
          if (st.simulationEnabled && !st.liveCallingEnabled) {
            const simRec = await phoneCalling.simulate(scope, input.approvalId);
            await phoneCalling.simulationEvent(scope, simRec.id, {
              eventId: `ring-${simRec.id.slice(0, 8)}`,
              sequence: 1,
              kind: 'state',
              state: 'ringing'
            });
            await phoneCalling.simulationEvent(scope, simRec.id, {
              eventId: `ans-${simRec.id.slice(0, 8)}`,
              sequence: 2,
              kind: 'state',
              state: 'answered'
            });
            await phoneCalling.simulationEvent(scope, simRec.id, {
              eventId: `turn-${simRec.id.slice(0, 8)}`,
              sequence: 3,
              kind: 'recipient_final',
              text: `Yes, I received the invitation (${simRec.draft.language}) and will attend.`
            });
            return await phoneCalling.simulationEvent(scope, simRec.id, {
              eventId: `done-${simRec.id.slice(0, 8)}`,
              sequence: 4,
              kind: 'state',
              state: 'completed'
            });
          }
        } catch {
          // Fall through to local deterministic simulation record when PhoneCallingService has simulation=false or live-mode drafts
        }
      }

      let draft = localPreparedDrafts.get(input.approvalId) ?? input.persistedDraft;
      if (!draft) {
        try {
          const open = await phoneCalling.requests(scope);
          draft = open.requests.find(r => r.approvalId === input.approvalId)?.draft;
        } catch {
          // ignore
        }
      }
      if (!draft) {
        return simFallbackAdapter.placeOrSimulateApprovedCall({
          approvalId: input.approvalId,
          mode: 'simulation',
          ...(input.knowledgeContext ? { knowledgeContext: input.knowledgeContext } : {})
        });
      }
      const nowIso = new Date().toISOString();
      if (hasProcessedKnowledge && input.knowledgeContext) {
        const isServices = input.knowledgeContext.extractedFacts.campaignType === 'services';
        const q1 = isServices ? 'How does an AI Voice Agent work?' : 'What will I learn?';
        const q2 = isServices ? 'How much does it cost?' : 'How do I register?';
        const a1 = answerCampaignCustomerQuestion({ question: q1, knowledgeContext: input.knowledgeContext });
        const a2 = answerCampaignCustomerQuestion({ question: q2, knowledgeContext: input.knowledgeContext });
        const closingQuote = `Yes, I am interested (${draft.language})! Count me in.`;
        const quotes = [q1, q2, closingQuote].map(s => s.slice(0, 950));
        const reportText = [
          `[SIMULATION-ONLY MULTI-TURN TRANSCRIPT — Unverified]`,
          `Customer (${draft.recipient.displayName}): "${q1}"`,
          `Thaara (${a1.sourceRefs.join(', ')}): "${a1.answer}"`,
          `Customer (${draft.recipient.displayName}): "${q2}"`,
          `Thaara (${a2.sourceRefs.join(', ')}): "${a2.answer}"`,
          `Customer (${draft.recipient.displayName}): "${closingQuote}"`
        ]
          .join('\n')
          .slice(0, 15000);
        return {
          id: crypto.randomUUID(),
          approvalId: input.approvalId,
          draft: { ...structuredClone(draft), mode: 'simulation' },
          state: 'completed',
          createdAt: nowIso,
          updatedAt: nowIso,
          providerCallId: `sim_${draft.contactId}`,
          verified: false,
          simulated: true,
          dispatchStatus: 'unverified',
          report: {
            text: reportText,
            spokenText: `This was a test simulation. ${draft.recipient.displayName} asked follow-up questions and said: ${closingQuote}`.slice(
              0,
              15000
            ),
            quotedResponses: quotes,
            evidenceIds: quotes.map((_, idx) => `ev_sim_${idx + 1}`),
            verified: false,
            simulated: true
          }
        };
      }

      const quote = `Yes, I am joining the session (${draft.language}). Count me in.`;
      return {
        id: crypto.randomUUID(),
        approvalId: input.approvalId,
        draft: { ...structuredClone(draft), mode: 'simulation' },
        state: 'completed',
        createdAt: nowIso,
        updatedAt: nowIso,
        providerCallId: `sim_${draft.contactId}`,
        verified: false,
        simulated: true,
        dispatchStatus: 'unverified',
        report: {
          text: `This was a test simulation. ${draft.recipient.displayName} said: "${quote}"`,
          spokenText: `This was a test simulation. ${draft.recipient.displayName} said: ${quote}`,
          quotedResponses: [quote],
          evidenceIds: ['ev_sim_1'],
          verified: false,
          simulated: true
        }
      };
    },

    async listCallHistory() {
      try {
        return await phoneCalling.history(scope);
      } catch {
        return simFallbackAdapter.listCallHistory();
      }
    },

    async readProviderResult(callId: string) {
      try {
        return await phoneCalling.providerResult(scope, callId);
      } catch {
        return {
          callId,
          status: 'unavailable' as const,
          responses: [],
          verified: false as const,
          source: 'provider_api' as const
        };
      }
    }
  };
}

function sanitizeTemplateVariable(value: string, fallback: string): string {
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 120);
  const candidate = cleaned || fallback;
  return isValidWhatsAppTemplateParam(candidate) ? candidate : fallback;
}

/**
 * Governed tenant-scoped WhatsApp Adapter backed by `DurableWhatsAppService` and `WhatsAppTemplateService`.
 * - Simulation mode: zero external calls, returns deterministic simulated status.
 * - Live mode: requires `liveSendingEnabled === true`, enforces Meta 24h window / APPROVED template rules,
 *   creates an audited `ApprovalRequest` (`whatsapp.meta.messages.send`), calls `durableWhatsApp.reserve()`,
 *   and returns truthful `queued` / `unverified` / `sent` / `delivered` / `failed` status.
 */
export function createScopedWhatsAppCampaignAdapter(options: {
  scope: AuthenticatedScope;
  durableWhatsApp?: DurableWhatsAppService;
  whatsappTemplates?: WhatsAppTemplateService;
  db?: TransactionalDbClient;
  liveSendingEnabled?: boolean;
}): BulkCampaignWhatsAppAdapter {
  const simAdapter = new MockBulkCampaignWhatsAppAdapter();
  const { scope, durableWhatsApp, whatsappTemplates, db } = options;

  return {
    mode: durableWhatsApp ? 'live_durable' : 'mock',
    liveSendingEnabled: Boolean(options.liveSendingEnabled),

    async sendTemplateInvitation(input) {
      const execMode = input.executionMode ?? 'simulation';
      if (execMode === 'simulation' || !durableWhatsApp) {
        return simAdapter.sendTemplateInvitation(input);
      }

      if (!options.liveSendingEnabled) {
        throw new Error(
          'LIVE_COMMUNICATIONS_DISABLED: Live WhatsApp sending is not enabled for this workspace connection.'
        );
      }
      if (!input.contact.whatsappE164 || !input.contact.consent.whatsapp || input.contact.optedOut) {
        return {
          status: 'failed',
          providerMessageId: null,
          error: 'Contact lacks verified WhatsApp opt-in consent or valid E.164 WhatsApp number.'
        };
      }

      try {
        const contactsInfo = await durableWhatsApp.contacts(scope, input.connectionId);
        if (!contactsInfo.liveSendingEnabled) {
          throw new Error(
            'LIVE_COMMUNICATIONS_DISABLED: Live WhatsApp send profile is inactive or expired for this connection.'
          );
        }

        const cleanDigits = input.contact.whatsappE164.replace(/\D/g, '');
        const recipientId = `c_${cleanDigits}`;
        await durableWhatsApp.ensureRecipientRegistered(scope, input.connectionId, recipientId, {
          phoneE164: input.contact.whatsappE164,
          displayName: input.contact.name
        });

        let preparedDraft: MetaWhatsAppAnySendInput | null = null;

        // 1. Prefer APPROVED Meta template via WhatsAppTemplateService (works both inside and outside 24h window)
        if (whatsappTemplates) {
          try {
            const catalog = await whatsappTemplates.list(scope, input.connectionId);
            const matched = catalog.templates.find(
              t =>
                t.name === input.templateName &&
                t.language === input.language &&
                t.status === 'APPROVED' &&
                !t.headerMedia &&
                !t.unsupportedButtons &&
                !t.invalidPlaceholders
            );
            if (matched) {
              const paramPool = [
                sanitizeTemplateVariable(input.contact.name, 'Guest'),
                sanitizeTemplateVariable(input.eventDetails ?? 'Upcoming Session', 'Upcoming Session'),
                sanitizeTemplateVariable(input.messagePreview.slice(0, 80), 'Invitation')
              ];
              const bodyParams = Array.from({ length: matched.bodyParams }, (_, idx) => paramPool[idx] ?? 'Details');
              const headerParams =
                (matched.headerParams ?? 0) > 0
                  ? [sanitizeTemplateVariable(input.contact.name, 'Guest')]
                  : undefined;
              const prepared = await whatsappTemplates.prepare(scope, input.connectionId, {
                recipientId,
                name: matched.name,
                language: matched.language,
                ...(bodyParams.length > 0 ? { bodyParams } : {}),
                ...(headerParams ? { headerParams } : {})
              });
              preparedDraft = prepared.draft;
            }
          } catch {
            // Fall back to open 24h window check below if template catalog is unconfigured
          }
        }

        // 2. If template could not be prepared from Meta catalog, allow text draft ONLY when 24h customer-service window is open
        if (!preparedDraft) {
          const refreshedContacts = await durableWhatsApp.contacts(scope, input.connectionId);
          const matchedRecipient = refreshedContacts.contacts.find(
            c =>
              c.recipientId === recipientId ||
              c.maskedPhone === maskPhoneCallNumber(input.contact.whatsappE164!)
          );
          const effectiveRecipientId = matchedRecipient?.recipientId ?? recipientId;
          if (matchedRecipient?.eligibility === 'eligible') {
            const replyPrepared = await durableWhatsApp.replyDraft(scope, input.connectionId, {
              recipientId: effectiveRecipientId,
              bodyText: input.messagePreview
            });
            preparedDraft = replyPrepared.draft;
          } else {
            return {
              status: 'failed',
              providerMessageId: null,
              error:
                '24-hour WhatsApp customer-service window is closed for this contact and no matching APPROVED Meta template was found in the connected Business Account.'
            };
          }
        }

        const deterministicKey =
          'camp-wa-' + crypto.createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 32);
        const finalDraft: MetaWhatsAppAnySendInput = {
          ...preparedDraft,
          idempotencyKey: deterministicKey
        };

        if (!db) {
          return {
            status: 'failed',
            providerMessageId: null,
            error: 'Durable database client is required to record governed WhatsApp send approvals.'
          };
        }

        const approvalId = await db.withScopedTransaction(scope, async tx => {
          const repo = new ApprovalRepository(tx);
          const created = await repo.create(
            scope.workspaceId,
            'whatsapp.meta.messages.send',
            finalDraft as unknown as Record<string, unknown>,
            scope.userId,
            'high',
            3600
          );
          await repo.transitionStatus(scope.workspaceId, created.id, 'pending', 'approved', scope.userId);
          await new AuditEventRepository(tx).create(
            scope.workspaceId,
            'campaign.bulk.whatsapp_dispatch_authorized',
            'approval_request',
            {
              campaignId: input.campaignId,
              approvalId: created.id,
              connectionId: input.connectionId,
              recipientId: finalDraft.recipientId,
              idempotencyKey: deterministicKey
            },
            scope.userId,
            created.id
          );
          return created.id;
        });

        const receipt = await durableWhatsApp.reserve(scope, input.connectionId, finalDraft, approvalId);
        const mappedStatus: BulkCampaignWhatsAppDispatchResult['status'] =
          receipt.status === 'delivered'
            ? 'delivered'
            : receipt.status === 'read'
              ? 'read'
              : receipt.status === 'sent'
                ? 'sent'
                : receipt.status === 'unverified'
                  ? 'unverified'
                  : receipt.status === 'not_configured'
                    ? 'queued'
                    : 'failed';

        return {
          status: mappedStatus,
          dispatchId: receipt.dispatchId,
          providerMessageId: receipt.providerMessageId
        };
      } catch (err) {
        if ((err as Error).message.includes('LIVE_COMMUNICATIONS_DISABLED')) {
          throw err;
        }
        return {
          status: 'failed',
          providerMessageId: null,
          error: (err as Error).message.slice(0, 240)
        };
      }
    }
  };
}

/**
 * Reconciles live Phone call history/provider results AND DurableWhatsApp delivery receipts + customer replies
 * into the stored campaign state so the Unified Campaign Dashboard and CSV/Chat reports reflect real progress!
 */
export async function reconcileBulkCampaignOutcomes(
  campaign: BulkCampaignState,
  deps: {
    scope: AuthenticatedScope;
    phoneCalling?: PhoneCallingService;
    phoneN8nSync?: PhoneN8nSyncService;
    phoneAdapter?: BulkCampaignPhoneAdapter;
    whatsappDurable?: DurableWhatsAppService;
    refreshProviderResults?: boolean;
    now?: Date;
  }
): Promise<BulkCampaignState> {
  const nowIso = (deps.now ?? new Date()).toISOString();
  let callsById = new Map<string, PhoneCallingRecord>();
  let callsByProviderId = new Map<string, PhoneCallingRecord>();
  let liveCallingFlag = Boolean(campaign.liveCallingEnabled);
  let liveSendingFlag = Boolean(campaign.liveSendingEnabled);

  if (deps.phoneCalling) {
    try {
      const baseHist = await deps.phoneCalling.history(deps.scope);
      const hist = deps.phoneN8nSync
        ? await deps.phoneN8nSync.enrichOutboundHistory(deps.scope, baseHist)
        : baseHist;
      liveCallingFlag = Boolean(hist.liveCallingEnabled);
      callsById = new Map(hist.calls.map(c => [c.id, c]));
      callsByProviderId = new Map(hist.calls.filter(c => c.providerCallId).map(c => [c.providerCallId!, c]));
    } catch {
      // ignore
    }
  } else if (deps.phoneAdapter) {
    try {
      const hist = await deps.phoneAdapter.listCallHistory();
      liveCallingFlag = Boolean(hist.liveCallingEnabled);
      callsById = new Map(hist.calls.map(c => [c.id, c]));
      callsByProviderId = new Map(hist.calls.filter(c => c.providerCallId).map(c => [c.providerCallId!, c]));
    } catch {
      // ignore
    }
  }

  let inboxThreads: Array<{
    recipientId: string;
    maskedPhone: string;
    messages: Array<{
      direction: 'inbound' | 'outbound';
      text: string;
      timestamp: string;
      status?: string;
      providerMessageId?: string | null;
      dispatchId?: string;
    }>;
  }> = [];

  if (deps.whatsappDurable && campaign.whatsappPlan.connectionId) {
    try {
      const inbox = await deps.whatsappDurable.inbox(deps.scope, campaign.whatsappPlan.connectionId);
      liveSendingFlag = Boolean(inbox.liveSendingEnabled);
      const rawThreads: typeof inboxThreads = [];
      for (const conv of inbox.conversations) {
        const inlineMessages = (
          conv as unknown as {
            messages?: Array<{
              direction: 'inbound' | 'outbound';
              textPreview?: string;
              text?: string;
              timestamp: string;
              deliveryStatus?: string;
              status?: string;
              providerMessageId?: string | null;
              dispatchId?: string;
            }>;
          }
        ).messages;
        let resolvedMessages = inlineMessages;
        if (!resolvedMessages && typeof (deps.whatsappDurable as { conversation?: unknown }).conversation === 'function') {
          try {
            const detail = await (
              deps.whatsappDurable as unknown as {
                conversation: (
                  s: AuthenticatedScope,
                  connId: string,
                  recipientId: string
                ) => Promise<{
                  messages: Array<{
                    direction: 'inbound' | 'outbound';
                    textPreview: string;
                    timestamp: string;
                    deliveryStatus?: string;
                    providerMessageId?: string | null;
                    dispatchId?: string;
                  }>;
                }>;
              }
            ).conversation(deps.scope, campaign.whatsappPlan.connectionId, conv.recipientId);
            resolvedMessages = detail.messages;
          } catch {
            resolvedMessages = [];
          }
        } else if (!resolvedMessages && typeof deps.whatsappDurable.inbox === 'function') {
          try {
            const detail = await deps.whatsappDurable.inbox(deps.scope, campaign.whatsappPlan.connectionId, {
              recipientId: conv.recipientId,
              pageSize: 50
            });
            resolvedMessages = (detail.messages ?? []).map(m => ({
              direction: m.direction,
              textPreview: m.textPreview,
              timestamp: m.timestamp,
              status: m.status,
              providerMessageId: m.providerMessageId,
              ...(typeof (m as { dispatchId?: string }).dispatchId === 'string'
                ? { dispatchId: (m as { dispatchId?: string }).dispatchId }
                : {})
            }));
          } catch {
            resolvedMessages = [];
          }
        }
        rawThreads.push({
          recipientId: conv.recipientId,
          maskedPhone: conv.maskedPhone,
          messages: (resolvedMessages ?? []).map(m => ({
            direction: m.direction,
            text: m.textPreview ?? m.text ?? '',
            timestamp: m.timestamp,
            ...(m.deliveryStatus ?? m.status ? { status: m.deliveryStatus ?? m.status } : {}),
            ...(m.providerMessageId !== undefined ? { providerMessageId: m.providerMessageId } : {}),
            ...(m.dispatchId ? { dispatchId: m.dispatchId } : {})
          }))
        });
      }
      inboxThreads = rawThreads;
    } catch {
      // ignore when WhatsApp connection is absent in offline tests
    }
  }

  const campaignStartMs = Date.parse(campaign.approval?.approvedAt ?? campaign.createdAt) || 0;

  const reconciledContacts: BulkCampaignContactRecord[] = [];
  for (const rec of campaign.contacts) {
    let next: BulkCampaignContactRecord = { ...rec };

    // 1. Reconcile Phone Call Record
    const rawMatchedCallRecord =
      (next.phoneCallId ? callsById.get(next.phoneCallId) ?? callsByProviderId.get(next.phoneCallId) : undefined) ??
      (next.phoneProviderCallId ? callsByProviderId.get(next.phoneProviderCallId) : undefined);
    const contactLast4 = next.contact?.maskedPhone?.replace(/\D/g, '').slice(-4) ?? '';
    const recordLast4 = rawMatchedCallRecord?.draft?.recipient?.maskedPhone?.replace(/\D/g, '').slice(-4) ?? '';
    const matchedCallRecord =
      rawMatchedCallRecord &&
      (contactLast4.length !== 4 || recordLast4.length !== 4 || contactLast4 === recordLast4)
        ? rawMatchedCallRecord
        : undefined;
    if (matchedCallRecord) {
      const callRecord = matchedCallRecord;
      let rawResponses = [...callRecord.report.quotedResponses];
      let effectiveState = callRecord.state;
      if (deps.refreshProviderResults && !callRecord.simulated && (callRecord.state === 'queued' || callRecord.state === 'ringing' || rawResponses.length === 0)) {
        try {
          const pr = deps.phoneCalling
            ? await deps.phoneCalling.providerResult(deps.scope, callRecord.id)
            : deps.phoneAdapter
              ? await deps.phoneAdapter.readProviderResult(callRecord.id)
              : null;
          if (pr && pr.status === 'available') {
            if (pr.responses.length > 0) rawResponses = pr.responses;
            if (effectiveState === 'queued' || effectiveState === 'ringing') {
              effectiveState = 'completed';
            }
          }
        } catch {
          // Provider result read optional
        }
      }

      const mappedCallStatus = mapPhoneStateToCampaignCallStatus(effectiveState);
      const isInFlight = mappedCallStatus === 'attempted';
      const aiInterp = isInFlight
        ? next.aiInterpretation
        : deriveCampaignCallAiInterpretation(effectiveState, rawResponses);
      const optedOutNow = aiInterp?.attendanceClassification === 'opted_out';
      const needsFollowUp =
        aiInterp?.attendanceClassification === 'callback_requested' ||
        aiInterp?.attendanceClassification === 'wants_more_info' ||
        mappedCallStatus === 'not_answered';
      const followUpReason =
        aiInterp?.attendanceClassification === 'callback_requested'
          ? `Callback requested (${aiInterp.preferredCallbackTime ?? 'time unspecified'})`
          : aiInterp?.attendanceClassification === 'wants_more_info'
            ? 'Requested more details before deciding'
            : mappedCallStatus === 'not_answered'
              ? 'Did not answer AI call — follow up via WhatsApp or manual call'
              : undefined;
      const derivedSummary =
        callRecord.syncedDetails?.summary ??
        (rawResponses.length > 0
          ? `${next.contact.name} said: ${rawResponses.join(' ')}`
          : callRecord.report.text);
      const derivedStructured =
        callRecord.syncedDetails?.requirements ??
        (!isInFlight
          ? extractStructuredCampaignCallOutcome({
              campaign,
              rawResponses,
              aiInterpretation: aiInterp,
              summaryText: derivedSummary
            })
          : next.structuredNotes);

      next = {
        ...next,
        contact: optedOutNow
          ? {
              ...next.contact,
              optedOut: true,
              consent: { ...next.contact.consent, whatsapp: false, phone: false, email: false }
            }
          : next.contact,
        phoneStatus: mappedCallStatus,
        phoneCallId: callRecord.id,
        ...(callRecord.providerCallId || next.phoneProviderCallId
          ? { phoneProviderCallId: callRecord.providerCallId ?? next.phoneProviderCallId ?? null }
          : {}),
        ...(typeof callRecord.syncedDetails?.durationSeconds === 'number'
          ? { phoneDurationSeconds: Math.max(0, Math.round(callRecord.syncedDetails.durationSeconds)) }
          : {}),
        ...(!callRecord.simulated &&
        (callRecord.syncedDetails?.recordingAvailable || Boolean(callRecord.providerCallId))
          ? {
              phoneRecordingUrl: `/api/v1/connectors/phone/recordings/outbound/${encodeURIComponent(callRecord.id)}`
            }
          : {}),
        ...(derivedSummary ? { phoneTranscriptSummary: derivedSummary } : {}),
        ...(derivedStructured ? { structuredNotes: derivedStructured } : {}),
        phoneRecordState: effectiveState,
        phoneRawResponses: rawResponses,
        phoneProviderReportText: callRecord.report.text,
        phoneReportVerified: Boolean(callRecord.verified),
        ...(aiInterp ? { aiInterpretation: aiInterp } : {}),
        ...(callRecord.syncedDetails?.preferredCallbackTime || aiInterp?.preferredCallbackTime
          ? { preferredCallbackTime: callRecord.syncedDetails?.preferredCallbackTime ?? aiInterp?.preferredCallbackTime }
          : {}),
        followUpRequired: needsFollowUp,
        ...(followUpReason ? { followUpReason } : {}),
        attendanceOutcome: aiInterp?.attendanceClassification ?? next.attendanceOutcome,
        interactionTimestamp: callRecord.updatedAt ?? next.interactionTimestamp ?? nowIso,
        updatedAt: nowIso
      };
    }

    // 2. Reconcile WhatsApp Delivery Status & Post-Dispatch Customer Replies
    if (inboxThreads.length > 0 && (next.contact.whatsappE164 || next.contact.maskedPhone)) {
      const cleanDigits = next.contact.whatsappE164?.replace(/\D/g, '') ?? '';
      const expectedCid = cleanDigits ? `c_${cleanDigits}` : '';
      const thread = inboxThreads.find(
        t =>
          (expectedCid && t.recipientId === expectedCid) ||
          (next.contact.maskedPhone && t.maskedPhone.slice(-4) === next.contact.maskedPhone.slice(-4))
      );
      if (thread) {
        const matchedOutbound = thread.messages.find(
          m =>
            m.direction === 'outbound' &&
            ((next.whatsappDispatchId && m.dispatchId === next.whatsappDispatchId) ||
              (next.whatsappProviderMessageId && m.providerMessageId === next.whatsappProviderMessageId))
        );
        if (matchedOutbound?.status) {
          const st = matchedOutbound.status as BulkCampaignWhatsAppDeliveryStatus;
          if (['queued', 'unverified', 'sent', 'delivered', 'read', 'failed'].includes(st)) {
            next = {
              ...next,
              whatsappStatus: st,
              ...(matchedOutbound.providerMessageId ? { whatsappProviderMessageId: matchedOutbound.providerMessageId } : {}),
              updatedAt: nowIso
            };
          }
        }

        const postCampaignInbounds = thread.messages.filter(
          m => m.direction === 'inbound' && (Date.parse(m.timestamp) || 0) >= campaignStartMs
        );
        const latestReply = postCampaignInbounds[postCampaignInbounds.length - 1];
        if (latestReply?.text) {
          next = {
            ...next,
            whatsappCustomerReply: latestReply.text.slice(0, 1000),
            updatedAt: nowIso
          };
          if (!next.aiInterpretation || next.attendanceOutcome === 'pending' || next.attendanceOutcome === 'no_response') {
            const replyInterp = deriveCampaignCallAiInterpretation('completed', [latestReply.text]);
            const optedOutViaWa = replyInterp.attendanceClassification === 'opted_out';
            const needsWaFollowUp =
              replyInterp.attendanceClassification === 'callback_requested' ||
              replyInterp.attendanceClassification === 'wants_more_info';
            const waFollowUpReason =
              replyInterp.attendanceClassification === 'callback_requested'
                ? `WhatsApp callback requested (${replyInterp.preferredCallbackTime ?? 'time unspecified'})`
                : replyInterp.attendanceClassification === 'wants_more_info'
                  ? 'WhatsApp reply requested more webinar details before deciding'
                  : undefined;
            next = {
              ...next,
              contact: optedOutViaWa
                ? {
                    ...next.contact,
                    optedOut: true,
                    consent: { ...next.contact.consent, whatsapp: false, phone: false, email: false }
                  }
                : next.contact,
              aiInterpretation: replyInterp,
              ...(replyInterp.preferredCallbackTime
                ? { preferredCallbackTime: replyInterp.preferredCallbackTime }
                : {}),
              followUpRequired: next.followUpRequired || needsWaFollowUp,
              ...(waFollowUpReason ? { followUpReason: waFollowUpReason } : {}),
              attendanceOutcome: replyInterp.attendanceClassification
            };
          }
        }
      }
    }

    reconciledContacts.push(next);
  }

  const byContactId = new Map(reconciledContacts.map(c => [c.contact.contactId, c]));
  const reconciledJobs = (campaign.n8nJobs ?? []).map(job => {
    if (job.channel !== 'phone_call' || !Array.isArray(job.recipientQueue)) return job;
    let changed = false;
    const nextQueue = job.recipientQueue.map(item => {
      const c = byContactId.get(item.contactId);
      if (!c || c.phoneStatus === 'attempted' || c.phoneStatus === 'pending' || c.phoneStatus === 'queued') {
        return item;
      }
      const nextStatus: BulkCampaignN8nBatchRecipient['status'] =
        c.phoneStatus === 'failed' ? 'failed' : c.phoneStatus === 'skipped' ? 'skipped' : 'completed';
      const nextProviderId = c.phoneProviderCallId ?? c.phoneCallId ?? item.providerId ?? null;
      const nextOutcome = c.phoneTranscriptSummary ?? c.phoneProviderReportText ?? item.outcome ?? null;
      if (item.status !== nextStatus || item.providerId !== nextProviderId || item.outcome !== nextOutcome) {
        changed = true;
        return { ...item, status: nextStatus, providerId: nextProviderId, outcome: nextOutcome, updatedAt: nowIso };
      }
      return item;
    });
    if (!changed) return job;
    return {
      ...job,
      recipientQueue: nextQueue,
      outcomeSummary: nextQueue[nextQueue.length - 1]?.outcome ?? job.outcomeSummary
    };
  });

  const stillRunning =
    campaign.status === 'running' &&
    reconciledContacts.some(
      r =>
        r.phoneStatus === 'attempted' ||
        r.whatsappStatus === 'queued' ||
        r.whatsappStatus === 'unverified' ||
        r.whatsappStatus === 'sent'
    );

  return {
    ...campaign,
    updatedAt: nowIso,
    liveCallingEnabled: liveCallingFlag,
    liveSendingEnabled: liveSendingFlag,
    contacts: reconciledContacts,
    ...(campaign.n8nJobs ? { n8nJobs: reconciledJobs } : {}),
    status: campaign.status === 'running' && !stillRunning ? 'completed' : campaign.status
  };
}

/**
 * Governed tenant-scoped Email Adapter backed by the existing `GmailFoundation` (`gmail.messages.send_new`).
 * - Simulation mode: zero external emails sent, delegates to `MockBulkCampaignEmailAdapter`.
 * - Live mode: strictly requires `liveSendingEnabled === true`, verified `gmail.send` scope + connected account,
 *   creates an audited `ApprovalRequest` (`gmail.messages.send_new`) in PostgreSQL, and invokes `gmail.sendNew(...)`.
 *   Remains completely isolated from Phone Step 115 operational callback notifications.
 */
export function createScopedEmailCampaignAdapter(options: {
  scope: AuthenticatedScope;
  gmail?: GmailFoundation;
  db?: TransactionalDbClient;
  liveSendingEnabled?: boolean;
}): BulkCampaignEmailAdapter {
  const simAdapter = new MockBulkCampaignEmailAdapter();
  const { scope, gmail, db } = options;

  return {
    mode: gmail ? 'governed_email' : 'test_transport',
    liveSendingEnabled: Boolean(options.liveSendingEnabled),

    async sendCampaignEmail(input) {
      const execMode = input.executionMode ?? 'simulation';
      if (execMode === 'simulation' || !gmail) {
        return simAdapter.sendCampaignEmail(input);
      }

      if (!options.liveSendingEnabled) {
        throw new Error(
          'LIVE_COMMUNICATIONS_DISABLED: Bulk campaign live email sending is disabled in this workspace.'
        );
      }
      if (!input.contact.email || !input.contact.consent.email || input.contact.optedOut) {
        return {
          status: 'failed',
          messageId: null,
          error: 'Recipient lacks verified email consent or valid email address.'
        };
      }

      try {
        const readiness = await gmail.sendReadiness(scope, 'new');
        if (!readiness.ready || !readiness.connectedEmail) {
          return {
            status: 'failed',
            messageId: null,
            error: `Gmail send is not ready (${readiness.reason}). Connect an authorized Gmail account with send permission.`
          };
        }
        if (!db) {
          return {
            status: 'failed',
            messageId: null,
            error: 'Durable database client is required to record governed Gmail send approvals.'
          };
        }

        const sendInput: GmailSendNewInput = {
          to: input.contact.email,
          subject: input.subject.slice(0, 200),
          bodyText: input.bodyText.slice(0, 8000),
          connectedEmail: readiness.connectedEmail
        };

        const approvedRequest: ApprovalRequest = await db.withScopedTransaction(scope, async tx => {
          const repo = new ApprovalRepository(tx);
          const created = await repo.create(
            scope.workspaceId,
            GMAIL_SEND_NEW_ACTION,
            sendInput as unknown as Record<string, unknown>,
            scope.userId,
            'high',
            3600
          );
          const transitioned = await repo.transitionStatus(
            scope.workspaceId,
            created.id,
            'pending',
            'approved',
            scope.userId
          );
          const record = transitioned ?? { ...created, status: 'approved' as const, approver_user_id: scope.userId };
          await new AuditEventRepository(tx).create(
            scope.workspaceId,
            'campaign.bulk.email_dispatch_authorized',
            'approval_request',
            {
              campaignId: input.campaignId,
              approvalId: record.id,
              connectedEmail: readiness.connectedEmail,
              idempotencyKey: input.idempotencyKey
            },
            scope.userId,
            record.id
          );
          return {
            id: record.id,
            workspaceId: record.workspace_id,
            actionName: record.action_name,
            actionParams: record.action_params,
            requesterUserId: record.requester_user_id,
            approverUserId: record.approver_user_id,
            status: record.status,
            riskLevel: record.risk_level,
            expiresAt: record.expires_at,
            createdAt: record.created_at,
            updatedAt: record.updated_at
          };
        });

        const deterministicKey =
          'camp-em-' + crypto.createHash('sha256').update(input.idempotencyKey).digest('hex').slice(0, 32);
        const receipt = await gmail.sendNew(scope, sendInput, approvedRequest, deterministicKey);
        return {
          status: 'sent',
          messageId: receipt.providerMessageId
        };
      } catch (err) {
        if ((err as Error).message.includes('LIVE_COMMUNICATIONS_DISABLED')) {
          throw err;
        }
        return {
          status: 'failed',
          messageId: null,
          error: (err as Error).message.slice(0, 240)
        };
      }
    }
  };
}

export interface ActiveWhatsAppCampaignReplyContext {
  campaignId: string;
  title: string;
  relevantFacts: string;
  groundedAnswer: string;
  grounded: boolean;
  pricingExplicitlyProvided: boolean;
  sourceRefs: string[];
}

/**
 * Resolves workspace-scoped and campaign-scoped verified knowledge when an inbound WhatsApp customer
 * replies to an approved/active/completed Bulk Campaign in the same workspace.
 * Never leaks contacts or uploaded documents across campaigns or across workspaces.
 */
export async function resolveCampaignReplyContextForWhatsApp(input: {
  scope: AuthenticatedScope;
  phoneE164: string;
  customerMessage: string;
  store?: BulkCampaignWorkspaceStore;
  db?: TransactionalDbClient;
}): Promise<ActiveWhatsAppCampaignReplyContext | null> {
  const cleanDigits = (input.phoneE164 || '').replace(/\D/g, '');
  if (!cleanDigits || cleanDigits.length < 10) return null;
  const workspaceStore = input.store ?? defaultBulkCampaignStore;

  let campaigns: BulkCampaignState[] = [];
  try {
    campaigns = await workspaceStore.listScoped(input.scope, input.db);
  } catch {
    campaigns = workspaceStore.list(input.scope.workspaceId);
  }

  const eligibleStatuses: ReadonlySet<BulkCampaignStatus> = new Set([
    'approved',
    'scheduled',
    'running',
    'completed'
  ]);

  const matching = campaigns
    .filter(
      c =>
        c.workspaceId === input.scope.workspaceId &&
        c.channels.includes('whatsapp') &&
        eligibleStatuses.has(c.status) &&
        c.contacts.some(rec => {
          if (!rec.selectedByOwner || rec.contact.optedOut) return false;
          const waDigits = (rec.contact.whatsappE164 ?? rec.contact.phoneE164 ?? '').replace(/\D/g, '');
          return waDigits.length >= 10 && waDigits.slice(-10) === cleanDigits.slice(-10);
        })
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const target = matching[0];
  if (!target) return null;

  const qa = answerCampaignCustomerQuestion({
    question: input.customerMessage,
    knowledgeContext: target.knowledgeContext,
    eventDetails: target.eventDetails
  });
  const topChunks = retrieveCampaignKnowledgeChunks(target.knowledgeContext, input.customerMessage, 3);
  const chunkLines = topChunks.map(
    ch => `[Source: ${ch.fileName}${ch.heading ? ` — ${ch.heading}` : ''}] ${ch.text.slice(0, 420)}`
  );

  const relevantFacts = [
    `Active Campaign: ${target.title}`,
    `Event / Offer: ${target.eventDetails}`,
    ...(target.knowledgeContext?.sarvamBoundedFactBrief
      ? [`Verified Brief: ${target.knowledgeContext.sarvamBoundedFactBrief}`]
      : []),
    ...chunkLines,
    `Verified Grounded Answer Candidate: ${qa.answer}`
  ]
    .join('\n')
    .slice(0, 2400);

  return {
    campaignId: target.campaignId,
    title: target.title,
    relevantFacts,
    groundedAnswer: qa.answer,
    grounded: qa.grounded,
    pricingExplicitlyProvided: Boolean(target.knowledgeContext?.extractedFacts.pricingExplicitlyProvided),
    sourceRefs: qa.sourceRefs
  };
}

/**
 * Lists strictly eligible non-synthetic contacts authorized for a single-call pilot.
 * Never promotes unverified uploaded numbers or synthetic demo fixtures.
 */
export function listEligiblePilotContacts(
  campaign: BulkCampaignState,
  phoneDirectory: PhoneContactView[]
): BulkCampaignEligiblePilotContact[] {
  const out: BulkCampaignEligiblePilotContact[] = [];
  const seen = new Set<string>();

  for (const dir of phoneDirectory) {
    if (
      dir.archived ||
      dir.contactId.startsWith('pdir_') ||
      dir.consent?.callingAllowed !== true ||
      dir.consent?.expired === true
    ) {
      continue;
    }
    seen.add(dir.contactId);
    out.push({
      contactId: dir.contactId,
      displayName: dir.displayName,
      maskedPhone: dir.maskedPhone,
      consentExpiresAt: dir.consent.expiresAt,
      source: 'phone_directory'
    });
  }

  for (const rec of campaign.contacts) {
    const c = rec.contact;
    if (
      c.isSyntheticTestFixture ||
      c.dnd ||
      rec.phoneEligibility !== 'eligible' ||
      c.consent.phone !== true ||
      c.contactId.startsWith('pdir_') ||
      c.contactId.startsWith('syn_test_')
    ) {
      continue;
    }
    const dirId = c.phoneDirectoryContactId ?? c.contactId;
    if (seen.has(dirId)) continue;
    const dirMatch = phoneDirectory.find(d => d.contactId === dirId);
    // If a real directory was supplied, require the contact to still exist with valid consent in that directory
    if (phoneDirectory.length > 0 && !dirMatch) {
      continue;
    }
    seen.add(dirId);
    out.push({
      contactId: dirId,
      displayName: c.name,
      maskedPhone: c.maskedPhone ?? maskPhoneCallNumber(c.phoneE164 ?? ''),
      consentExpiresAt: dirMatch?.consent.expiresAt ?? new Date(Date.now() + 86400000).toISOString(),
      source: 'campaign_eligible'
    });
  }

  return out;
}

/**
 * Prepares ONE owner-authorized pilot call using the existing PhoneCallingService.prepare() path
 * and the campaign's grounded <= 1,000-char Sarvam call purpose. Does not place any call.
 */
export async function prepareBulkCampaignPilotCall(
  campaign: BulkCampaignState,
  phoneAdapter: BulkCampaignPhoneAdapter,
  input: {
    userId: string;
    role: string;
    phoneDirectory: PhoneContactView[];
    contactId: string;
    language?: BulkCampaignLanguage;
  }
): Promise<BulkCampaignState> {
  if (input.role !== 'owner') {
    throw new Error('PHONE_CALLING_DENIED: Only the workspace owner can prepare a pilot call.');
  }
  if (!campaign.channels.includes('phone')) {
    throw new Error('PILOT_CHANNEL_REQUIRED: AI Calling channel must be selected on the campaign.');
  }
  if (campaign.pilotCall?.status === 'placing') {
    throw new Error('PILOT_CALL_IN_PROGRESS: A pilot call is currently being placed.');
  }

  const eligible = listEligiblePilotContacts(campaign, input.phoneDirectory);
  const chosen = eligible.find(c => c.contactId === input.contactId);
  if (!chosen) {
    throw new Error(
      'PILOT_CONTACT_NOT_ELIGIBLE: Selected contact is not authorized for calling (missing consent, DND, archived, or synthetic).'
    );
  }

  const callPurpose = buildPersonalizedLeadCallPurpose(
    campaign,
    campaign.contacts.find(r => r.contact.contactId === chosen.contactId)?.contact
  );
  const language: PhoneCallingLanguage =
    input.language === 'kn-IN' || input.language === 'kn-en' ? input.language : 'en-IN';
  const prepared = await phoneAdapter.prepareDraft({
    contactQuery: chosen.displayName,
    selectedContactId: chosen.contactId,
    purpose: callPurpose,
    language,
    openingGreeting: buildCampaignOutboundGreeting(
      campaign,
      { name: chosen.displayName, preferredLanguage: language },
      language
    )
  });

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  return {
    ...campaign,
    updatedAt: now,
    pilotCall: {
      pilotId: crypto.randomUUID(),
      campaignId: campaign.campaignId,
      contactId: chosen.contactId,
      displayName: chosen.displayName,
      maskedPhone: prepared.draft.recipient.maskedPhone || chosen.maskedPhone,
      language,
      callPurpose: prepared.draft.purpose,
      approvalId: prepared.approvalId,
      preparedAt: now,
      expiresAt,
      status: 'prepared',
      isRealCall: true
    }
  };
}

/**
 * Executes AT MOST ONE owner-approved pilot call through the existing PhoneCallingService.placeCall() path.
 * Idempotent on duplicate clicks for the same approvalId; never auto-redials on failure.
 */
export async function executeBulkCampaignPilotCall(
  campaign: BulkCampaignState,
  phoneAdapter: BulkCampaignPhoneAdapter,
  input: {
    userId: string;
    role: string;
    approvalId: string;
  }
): Promise<BulkCampaignState> {
  if (input.role !== 'owner') {
    throw new Error('PHONE_CALLING_DENIED: Only the workspace owner can execute a pilot call.');
  }
  const pilot = campaign.pilotCall;
  if (!pilot || pilot.approvalId !== input.approvalId) {
    throw new Error('PILOT_NOT_PREPARED: Prepare a single-call pilot request before approving.');
  }

  // Idempotent replay protection: never place a second call for the same approval
  if (['placing', 'queued', 'ringing', 'answered', 'completed'].includes(pilot.status)) {
    return campaign;
  }
  if (pilot.status === 'failed') {
    throw new Error(
      'PILOT_RETRY_REQUIRES_NEW_APPROVAL: Previous pilot attempt failed. Prepare a new pilot approval before retrying.'
    );
  }
  if (Date.parse(pilot.expiresAt) <= Date.now()) {
    throw new Error('PILOT_APPROVAL_EXPIRED: Pilot authorization expired. Prepare a new pilot request.');
  }
  if (!phoneAdapter.placeSinglePilotCall) {
    throw new Error('LIVE_COMMUNICATIONS_DISABLED: Single-call pilot adapter is not available.');
  }

  await phoneAdapter.approveCallDraft({
    approvalId: input.approvalId,
    approverUserId: input.userId
  });

  const now = new Date().toISOString();
  try {
    const record = await phoneAdapter.placeSinglePilotCall({
      approvalId: input.approvalId,
      campaignId: campaign.campaignId,
      contactId: pilot.contactId
    });
    return {
      ...campaign,
      updatedAt: new Date().toISOString(),
      pilotCall: {
        ...pilot,
        approvedAt: now,
        approvedByUserId: input.userId,
        status: record.state,
        callId: record.id,
        providerCallId: record.providerCallId ?? null,
        startedAt: record.createdAt,
        endedAt: record.updatedAt,
        summary: record.report?.text ?? null,
        error: null
      }
    };
  } catch (err) {
    return {
      ...campaign,
      updatedAt: new Date().toISOString(),
      pilotCall: {
        ...pilot,
        approvedAt: now,
        approvedByUserId: input.userId,
        status: 'failed',
        error: (err as Error).message
      }
    };
  }
}

/**
 * Refreshes actual pilot call status, timestamps, transcript, and recording availability
 * from the existing Phone Integration call history without fabricating missing fields.
 */
export async function refreshBulkCampaignPilotResult(
  campaign: BulkCampaignState,
  phoneAdapter: BulkCampaignPhoneAdapter
): Promise<BulkCampaignState> {
  const pilot = campaign.pilotCall;
  if (!pilot?.callId) return campaign;

  const history = await phoneAdapter.listCallHistory();
  const match = history.calls.find(c => c.id === pilot.callId);
  if (!match) return campaign;

  const sd = match.syncedDetails;
  return {
    ...campaign,
    updatedAt: new Date().toISOString(),
    pilotCall: {
      ...pilot,
      status: match.state,
      providerCallId: match.providerCallId ?? pilot.providerCallId ?? null,
      startedAt: sd?.occurredAt ?? match.createdAt,
      endedAt: match.updatedAt,
      durationSeconds: sd?.durationSeconds ?? pilot.durationSeconds ?? null,
      recordingAvailable: Boolean(sd?.recordingAvailable),
      ...(sd?.transcript && sd.transcript.length > 0 ? { transcript: sd.transcript } : {}),
      summary: sd?.summary ?? match.report?.text ?? pilot.summary ?? null,
      outcomeLabel: sd?.outcomeLabel ?? pilot.outcomeLabel ?? null,
      ...(sd?.callbackStatus ? { callbackStatus: sd.callbackStatus } : {}),
      requirements: sd?.requirements ?? pilot.requirements ?? null
    }
  };
}

// ---------------------------------------------------------------------------
// n8n Campaign Orchestration (Dedicated AI Calling & WhatsApp Workflows)
// ---------------------------------------------------------------------------

export const BULK_CAMPAIGN_N8N_CALLING_WORKFLOW_ID = 'ThaaraBulkCall01';
export const BULK_CAMPAIGN_N8N_WHATSAPP_WORKFLOW_ID = 'ThaaraBulkWa0001';
export const BULK_CAMPAIGN_N8N_CALLING_WEBHOOK_PATH = '/webhook/thaara-bulk-campaign-calling-v1';
export const BULK_CAMPAIGN_N8N_WHATSAPP_WEBHOOK_PATH = '/webhook/thaara-bulk-campaign-whatsapp-v1';
export const PILOT_N8N_INTERNAL_ORIGIN = 'http://n8n-n8n-1:5678';

export interface BulkCampaignN8nTrigger {
  triggerWorkflow(input: {
    webhookPath: string;
    payload: {
      jobId: string;
      campaignId: string;
      workspaceId?: string;
      executionToken: string;
      channel: BulkCampaignN8nChannel;
      mode?: 'one_contact_pilot' | 'multi_contact_batch';
      maxContacts: number;
      rateLimitPerMinute?: number;
    };
  }): Promise<{ accepted: boolean; reason?: string; n8nExecutionId?: string | null }>;
}

export function createDefaultBulkCampaignN8nTrigger(options?: {
  liveEnabled?: boolean;
  webhookSecret?: string | null;
  origin?: string;
  fetchImpl?: typeof fetch;
}): BulkCampaignN8nTrigger {
  const origin = options?.origin ?? PILOT_N8N_INTERNAL_ORIGIN;
  const doFetch = options?.fetchImpl ?? fetch;
  return {
    async triggerWorkflow({ webhookPath, payload }) {
      if (!options?.liveEnabled || !options.webhookSecret) {
        return { accepted: false, reason: 'N8N_ORCHESTRATION_NOT_CONFIGURED' };
      }
      if (!/^\/webhook\/[a-z0-9][a-z0-9-]{0,79}$/.test(webhookPath)) {
        return { accepted: false, reason: 'INVALID_N8N_WEBHOOK_PATH' };
      }
      const res = await doFetch(`${origin}${webhookPath}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: {
          'content-type': 'application/json',
          'x-thaara-bulk-campaign-webhook-secret': options.webhookSecret
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        return { accepted: false, reason: `N8N_WEBHOOK_HTTP_${res.status}` };
      }
      let n8nExecutionId: string | null = null;
      try {
        const body = (await res.json()) as { executionId?: unknown };
        if (typeof body?.executionId === 'string') {
          n8nExecutionId = body.executionId.slice(0, 128);
        }
      } catch {
        // Webhook may return empty 200/202
      }
      return { accepted: true, n8nExecutionId };
    }
  };
}

export function verifyBulkCampaignN8nToken(providedHeader: string | undefined, expectedToken: string | undefined): boolean {
  if (!providedHeader || !expectedToken || expectedToken.length < 16) return false;
  const a = Buffer.from(providedHeader.trim(), 'utf8');
  const b = Buffer.from(expectedToken.trim(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hashExecutionToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function verifyExecutionTokenHash(providedToken: string, expectedHash: string | undefined): boolean {
  if (!providedToken || !expectedHash) return false;
  const actual = Buffer.from(hashExecutionToken(providedToken), 'utf8');
  const expected = Buffer.from(expectedHash, 'utf8');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function listEligibleWhatsAppPilotContacts(campaign: BulkCampaignState): BulkCampaignEligiblePilotContact[] {
  const seen = new Set<string>();
  const out: BulkCampaignEligiblePilotContact[] = [];
  for (const row of campaign.contacts) {
    const c = row.contact;
    if (
      c.whatsappE164 &&
      c.consent.whatsapp &&
      !c.dnd &&
      !c.optedOut &&
      !c.isSyntheticTestFixture &&
      !seen.has(c.contactId)
    ) {
      seen.add(c.contactId);
      out.push({
        contactId: c.contactId,
        displayName: c.name,
        maskedPhone: maskPhoneCallNumber(c.whatsappE164),
        consentExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        source: 'campaign_eligible'
      });
    }
  }
  return out;
}

export async function submitBulkCampaignN8nJob(
  campaign: BulkCampaignState,
  input: {
    scope: AuthenticatedScope;
    channel: BulkCampaignN8nChannel;
    contactId: string;
    language?: BulkCampaignLanguage;
    connectionId?: string;
    templateName?: string;
    phoneDirectory?: PhoneContactView[];
    phoneAdapter?: BulkCampaignPhoneAdapter;
    n8nTrigger?: BulkCampaignN8nTrigger;
  }
): Promise<{
  campaign: BulkCampaignState;
  job: BulkCampaignN8nExecutionJob;
  executionToken: string;
  webhookDispatched: boolean;
  webhookReason?: string;
}> {
  if (input.scope.role !== 'owner') {
    throw new Error('FORBIDDEN: Only workspace owners can submit live n8n campaign jobs.');
  }
  if (campaign.status !== 'approved' && campaign.status !== 'completed') {
    throw new Error('CAMPAIGN_NOT_APPROVED: Owner campaign approval is required before n8n orchestration.');
  }

  const existingActive = (campaign.n8nJobs ?? []).find(
    j =>
      j.channel === input.channel &&
      j.targetContactId === input.contactId &&
      (j.status === 'queued' || j.status === 'running')
  );
  if (existingActive) {
    throw new Error('DUPLICATE_N8N_JOB: An active n8n execution job already exists for this contact and channel.');
  }

  let chosen: BulkCampaignEligiblePilotContact | undefined;
  let updatedCampaign = campaign;
  let approvalId: string | undefined;

  if (input.channel === 'phone_call') {
    const eligible = listEligiblePilotContacts(campaign, input.phoneDirectory ?? []);
    chosen = eligible.find(c => c.contactId === input.contactId);
    if (!chosen) {
      throw new Error(
        'PILOT_CONTACT_NOT_ELIGIBLE: Selected contact is not authorized for AI calling (missing consent, DND, or synthetic).'
      );
    }
    if (input.phoneAdapter) {
      updatedCampaign = await prepareBulkCampaignPilotCall(campaign, input.phoneAdapter, {
        userId: input.scope.userId,
        role: input.scope.role,
        phoneDirectory: input.phoneDirectory ?? [],
        contactId: input.contactId,
        language: input.language
      });
      approvalId = updatedCampaign.pilotCall?.approvalId;
    }
  } else {
    const eligible = listEligibleWhatsAppPilotContacts(campaign);
    chosen = eligible.find(c => c.contactId === input.contactId);
    if (!chosen) {
      throw new Error(
        'PILOT_CONTACT_NOT_ELIGIBLE: Selected contact is not authorized for WhatsApp (missing opt-in, opted out, DND, or synthetic).'
      );
    }
    const nowWa = new Date().toISOString();
    updatedCampaign = {
      ...campaign,
      pilotWhatsApp: {
        pilotId: `wapilot_${crypto.randomUUID().slice(0, 8)}`,
        campaignId: campaign.campaignId,
        contactId: chosen.contactId,
        displayName: chosen.displayName,
        maskedPhone: chosen.maskedPhone,
        connectionId: input.connectionId || 'default',
        mode: input.templateName ? 'template' : 'window_text',
        templateName: input.templateName || campaign.whatsappPlan.templateName,
        language: input.language || campaign.whatsappPlan.language || 'en_US',
        messagePreview: campaign.whatsappPlan.messagePreview.slice(0, 1000),
        status: 'prepared',
        updatedAt: nowWa,
        isRealMessage: true
      }
    };
  }

  const now = new Date().toISOString();
  const jobId = `n8njob_${crypto.randomUUID().slice(0, 10)}`;
  const executionToken = crypto.randomBytes(24).toString('base64url');
  const workflowId =
    input.channel === 'phone_call'
      ? BULK_CAMPAIGN_N8N_CALLING_WORKFLOW_ID
      : BULK_CAMPAIGN_N8N_WHATSAPP_WORKFLOW_ID;
  const webhookPath =
    input.channel === 'phone_call'
      ? BULK_CAMPAIGN_N8N_CALLING_WEBHOOK_PATH
      : BULK_CAMPAIGN_N8N_WHATSAPP_WEBHOOK_PATH;

  let webhookDispatched = false;
  let webhookReason: string | undefined;
  let n8nExecutionId: string | null = null;
  if (input.n8nTrigger) {
    const trig = await input.n8nTrigger.triggerWorkflow({
      webhookPath,
      payload: {
        jobId,
        campaignId: campaign.campaignId,
        workspaceId: campaign.workspaceId,
        executionToken,
        channel: input.channel,
        mode: 'one_contact_pilot',
        maxContacts: 1
      }
    });
    webhookDispatched = trig.accepted;
    webhookReason = trig.reason;
    n8nExecutionId = trig.n8nExecutionId ?? null;
  }

  const job: BulkCampaignN8nExecutionJob = {
    jobId,
    campaignId: campaign.campaignId,
    channel: input.channel,
    mode: 'one_contact_pilot',
    workflowId,
    webhookPath,
    targetContactId: chosen.contactId,
    targetDisplayName: chosen.displayName,
    targetMaskedPhone: chosen.maskedPhone,
    status: 'queued',
    createdAt: now,
    createdByUserId: input.scope.userId,
    ...(approvalId ? { approvalId } : {}),
    ...(n8nExecutionId ? { n8nExecutionId } : {}),
    webhookDispatched,
    isSimulated: false
  };

  return {
    campaign: {
      ...updatedCampaign,
      updatedAt: now,
      n8nJobs: [...(updatedCampaign.n8nJobs ?? []), job],
      n8nJobTokenHashes: {
        ...(updatedCampaign.n8nJobTokenHashes ?? {}),
        [jobId]: hashExecutionToken(executionToken)
      }
    },
    job,
    executionToken,
    webhookDispatched,
    ...(webhookReason ? { webhookReason } : {})
  };
}

export function cancelBulkCampaignN8nJob(
  campaign: BulkCampaignState,
  scope: AuthenticatedScope,
  jobId: string,
  reason = 'Cancelled by owner.'
): BulkCampaignState {
  if (scope.role !== 'owner') {
    throw new Error('FORBIDDEN: Only workspace owners can cancel n8n campaign jobs.');
  }
  const jobs = campaign.n8nJobs ?? [];
  const idx = jobs.findIndex(j => j.jobId === jobId);
  if (idx === -1) {
    throw new Error('N8N_JOB_NOT_FOUND: Execution job not found.');
  }
  const current = jobs[idx]!;
  if (current.status === 'completed' || current.status === 'cancelled') {
    return campaign;
  }
  const now = new Date().toISOString();
  const updatedJob: BulkCampaignN8nExecutionJob = {
    ...current,
    status: 'cancelled',
    cancelledAt: now,
    failureReason: reason.slice(0, 500)
  };
  const nextJobs = [...jobs];
  nextJobs[idx] = updatedJob;
  return {
    ...campaign,
    updatedAt: now,
    n8nJobs: nextJobs
  };
}


export function claimNextBulkCampaignN8nJob(
  campaign: BulkCampaignState,
  input: {
    jobId: string;
    executionToken: string;
    channel: BulkCampaignN8nChannel;
    phoneDirectory?: PhoneContactView[];
  }
): {
  campaign: BulkCampaignState;
  proceed: boolean;
  reason?: string;
  contactId?: string;
  displayName?: string;
  channel?: BulkCampaignN8nChannel;
  approvalId?: string;
  callPurpose?: string;
  language?: string;
  templateName?: string;
  templateLanguage?: string;
  messagePreview?: string;
  connectionId?: string;
} {
  const jobs = campaign.n8nJobs ?? [];
  const idx = jobs.findIndex(j => j.jobId === input.jobId);
  if (idx === -1) {
    return { campaign, proceed: false, reason: 'JOB_NOT_FOUND' };
  }
  const job = jobs[idx]!;
  const expectedHash = campaign.n8nJobTokenHashes?.[input.jobId];
  if (!verifyExecutionTokenHash(input.executionToken, expectedHash)) {
    return { campaign, proceed: false, reason: 'INVALID_EXECUTION_TOKEN' };
  }
  if (job.channel !== input.channel) {
    return { campaign, proceed: false, reason: 'CHANNEL_MISMATCH' };
  }
  if (job.status === 'cancelled' || job.status === 'stopped' || job.status === 'completed' || job.status === 'failed') {
    return { campaign, proceed: false, reason: `JOB_${job.status.toUpperCase()}` };
  }
  if (job.claimedAt) {
    return { campaign, proceed: false, reason: 'DUPLICATE_CLAIM_PREVENTED' };
  }
  if (campaign.status !== 'approved' && campaign.status !== 'completed') {
    return { campaign, proceed: false, reason: 'CAMPAIGN_APPROVAL_REVOKED' };
  }

  const eligible =
    input.channel === 'phone_call'
      ? listEligiblePilotContacts(campaign, input.phoneDirectory ?? [])
      : listEligibleWhatsAppPilotContacts(campaign);
  const chosen = eligible.find(c => c.contactId === job.targetContactId);
  if (!chosen) {
    const nowFail = new Date().toISOString();
    const nextJobs = [...jobs];
    nextJobs[idx] = { ...job, status: 'stopped', failureReason: 'CONSENT_OR_ELIGIBILITY_FAILED', completedAt: nowFail };
    return {
      campaign: { ...campaign, updatedAt: nowFail, n8nJobs: nextJobs },
      proceed: false,
      reason: 'CONSENT_OR_ELIGIBILITY_FAILED'
    };
  }

  const now = new Date().toISOString();
  const nextJobs = [...jobs];
  nextJobs[idx] = { ...job, status: 'running', claimedAt: now };

  const callPurpose =
    campaign.pilotCall?.callPurpose ||
    campaign.knowledgeContext?.sarvamBoundedFactBrief?.slice(0, SARVAM_MAX_CALL_PURPOSE_CHARS) ||
    campaign.callScript.boundedPurposePreview?.slice(0, SARVAM_MAX_CALL_PURPOSE_CHARS) ||
    buildBoundedPhonePurpose({
      eventDetails: campaign.eventDetails,
      eventPitch: campaign.callScript.eventPitch,
      questions: campaign.callScript.questions
    });

  return {
    campaign: { ...campaign, updatedAt: now, n8nJobs: nextJobs },
    proceed: true,
    contactId: chosen.contactId,
    displayName: chosen.displayName,
    channel: input.channel,
    approvalId: job.approvalId ?? campaign.pilotCall?.approvalId,
    callPurpose,
    language: campaign.pilotCall?.language ?? 'en-IN',
    templateName: campaign.pilotWhatsApp?.templateName ?? campaign.whatsappPlan.templateName,
    templateLanguage: campaign.pilotWhatsApp?.language ?? campaign.whatsappPlan.language,
    messagePreview: campaign.pilotWhatsApp?.messagePreview ?? campaign.whatsappPlan.messagePreview,
    connectionId: campaign.pilotWhatsApp?.connectionId ?? 'default'
  };
}

export async function executeBulkCampaignN8nPhoneJob(
  campaign: BulkCampaignState,
  input: {
    jobId: string;
    scope: AuthenticatedScope;
    phoneAdapter: BulkCampaignPhoneAdapter;
    phoneDirectory?: PhoneContactView[];
    contactId?: string;
  }
): Promise<{
  campaign: BulkCampaignState;
  ok: boolean;
  callId?: string;
  providerCallId?: string | null;
  status?: string;
  failureReason?: string;
}> {
  const jobs = campaign.n8nJobs ?? [];
  const idx = jobs.findIndex(j => j.jobId === input.jobId);
  if (idx === -1) return { campaign, ok: false, failureReason: 'JOB_NOT_FOUND' };
  const job = jobs[idx]!;

  if (job.mode === 'multi_contact_batch') {
    if (job.emergencyStopped || job.status !== 'running') {
      return { campaign, ok: false, failureReason: `JOB_NOT_RUNNING_OR_${job.status.toUpperCase()}` };
    }
    const queue = [...(job.recipientQueue ?? [])];
    const qIdx = input.contactId
      ? queue.findIndex(q => q.contactId === input.contactId)
      : queue.findIndex(q => q.status === 'claimed');
    if (qIdx === -1) {
      return { campaign, ok: false, failureReason: 'BATCH_CONTACT_NOT_CLAIMED' };
    }
    const item = queue[qIdx]!;
    if (item.providerId || item.status === 'dispatched' || item.status === 'completed') {
      return { campaign, ok: false, failureReason: 'DUPLICATE_CALL_PREVENTED' };
    }
    if (item.status !== 'claimed') {
      return { campaign, ok: false, failureReason: `CONTACT_NOT_CLAIMED_${item.status.toUpperCase()}` };
    }
    const row = campaign.contacts.find(r => r.contact.contactId === item.contactId);
    const contact = row?.contact;
    const directoryEligible = contact
      ? isSavedPhoneDirectoryContactCurrentlyEligible(contact, input.phoneDirectory)
      : false;
    if (
      !row?.selectedByOwner ||
      !contact ||
      !directoryEligible ||
      !contact.consent.phone ||
      contact.dnd ||
      contact.optedOut ||
      contact.isSyntheticTestFixture
    ) {
      return { campaign, ok: false, failureReason: 'CONSENT_DND_OR_OPTOUT_FAILED' };
    }
    if (!input.phoneAdapter.placeSinglePilotCall) {
      return { campaign, ok: false, failureReason: 'LIVE_CALLING_ADAPTER_UNAVAILABLE' };
    }

    const callPurpose = buildPersonalizedLeadCallPurpose(campaign, contact);
    const language: PhoneCallingLanguage = isSupportedPhoneCallingLanguage(contact.preferredLanguage)
      ? contact.preferredLanguage
      : 'en-IN';
    try {
      const dirContactName = contact.phoneDirectoryContactId
        ? input.phoneDirectory?.find(d => d.contactId === contact.phoneDirectoryContactId)?.displayName
        : undefined;
      const prepared = await input.phoneAdapter.prepareDraft({
        contactQuery: contact.phoneDirectoryContactId ? (dirContactName ?? contact.name) : contact.phoneE164!,
        ...(contact.phoneDirectoryContactId
          ? { selectedContactId: contact.phoneDirectoryContactId }
          : {
              newRecipient: {
                displayName: contact.name.slice(0, 128),
                consentConfirmed: true
              }
            }),
        purpose: callPurpose,
        language,
        openingGreeting: buildCampaignOutboundGreeting(campaign, contact, language)
      });
      await input.phoneAdapter.approveCallDraft({
        approvalId: prepared.approvalId,
        approverUserId: input.scope.userId
      });
      const record = await input.phoneAdapter.placeSinglePilotCall({
        approvalId: prepared.approvalId,
        campaignId: campaign.campaignId,
        contactId: contact.contactId
      });
      const now = new Date().toISOString();
      const providerRef = record.providerCallId ?? record.id;
      queue[qIdx] = {
        ...item,
        status: 'dispatched',
        providerId: providerRef,
        updatedAt: now
      };
      const nextJobs = [...jobs];
      nextJobs[idx] = { ...job, recipientQueue: queue };
      const mappedStatus = mapPhoneStateToCampaignCallStatus(record.state);
      const nextContacts = campaign.contacts.map(r =>
        r.contact.contactId === contact.contactId
          ? {
              ...r,
              phoneApprovalId: prepared.approvalId,
              phoneApprovalStatus: 'approved' as const,
              phoneCallId: record.id,
              phoneProviderCallId: record.providerCallId ?? null,
              ...(typeof record.syncedDetails?.durationSeconds === 'number'
                ? { phoneDurationSeconds: Math.max(0, Math.round(record.syncedDetails.durationSeconds)) }
                : {}),
              phoneRecordState: record.state,
              phoneLanguageUsed: language,
              phoneStatus: mappedStatus,
              interactionTimestamp: record.createdAt ?? now,
              updatedAt: now
            }
          : r
      );
      return {
        campaign: {
          ...campaign,
          updatedAt: now,
          contacts: nextContacts,
          n8nJobs: nextJobs
        },
        ok: true,
        callId: record.id,
        providerCallId: record.providerCallId ?? null,
        status: record.state
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PHONE_BATCH_EXECUTION_FAILED';
      const now = new Date().toISOString();
      const isDailyQuotaLimit = /daily.*limit|limit.*reached|quota/i.test(msg);
      if (isDailyQuotaLimit) {
        queue[qIdx] = {
          ...item,
          status: 'pending',
          attempts: Math.max(0, item.attempts - 1),
          failureReason: 'DAILY_CALL_LIMIT_REACHED',
          updatedAt: now
        };
        const nextJobs = [...jobs];
        nextJobs[idx] = {
          ...job,
          status: 'paused',
          failureReason: 'DAILY_CALL_LIMIT_REACHED',
          recipientQueue: queue
        };
        return {
          campaign: { ...campaign, updatedAt: now, n8nJobs: nextJobs },
          ok: false,
          failureReason: 'DAILY_CALL_LIMIT_REACHED'
        };
      }
      queue[qIdx] = { ...item, status: 'failed', failureReason: msg.slice(0, 300), updatedAt: now };
      const nextJobs = [...jobs];
      nextJobs[idx] = { ...job, recipientQueue: queue };
      return {
        campaign: { ...campaign, updatedAt: now, n8nJobs: nextJobs },
        ok: false,
        failureReason: msg
      };
    }
  }

  if (job.status !== 'running' || !job.claimedAt) {
    return { campaign, ok: false, failureReason: `JOB_NOT_CLAIMED_OR_${job.status.toUpperCase()}` };
  }
  if (job.dispatchedAt || job.providerCallId) {
    return { campaign, ok: false, failureReason: 'DUPLICATE_CALL_PREVENTED' };
  }
  if (!campaign.pilotCall || campaign.pilotCall.contactId !== job.targetContactId) {
    return { campaign, ok: false, failureReason: 'PILOT_CALL_NOT_PREPARED' };
  }

  try {
    const updated = await executeBulkCampaignPilotCall(campaign, input.phoneAdapter, {
      userId: input.scope.userId,
      role: input.scope.role,
      approvalId: campaign.pilotCall.approvalId
    });
    const now = new Date().toISOString();
    const nextJobs = [...(updated.n8nJobs ?? jobs)];
    nextJobs[idx] = {
      ...job,
      dispatchedAt: now,
      providerCallId: updated.pilotCall?.providerCallId ?? updated.pilotCall?.callId ?? null
    };
    return {
      campaign: { ...updated, updatedAt: now, n8nJobs: nextJobs },
      ok: true,
      callId: updated.pilotCall?.callId,
      providerCallId: updated.pilotCall?.providerCallId ?? null,
      status: updated.pilotCall?.status
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'PHONE_EXECUTION_FAILED';
    const now = new Date().toISOString();
    const nextJobs = [...jobs];
    nextJobs[idx] = { ...job, status: 'failed', failureReason: msg.slice(0, 500), completedAt: now };
    return {
      campaign: { ...campaign, updatedAt: now, n8nJobs: nextJobs },
      ok: false,
      failureReason: msg
    };
  }
}

export async function pollBulkCampaignN8nPhoneJob(
  campaign: BulkCampaignState,
  input: {
    jobId: string;
    phoneAdapter: BulkCampaignPhoneAdapter;
    contactId?: string;
  }
): Promise<{
  campaign: BulkCampaignState;
  status: string;
  durationSeconds: number | null;
  summary: string | null;
}> {
  const job = (campaign.n8nJobs ?? []).find(j => j.jobId === input.jobId);
  if (job?.mode === 'multi_contact_batch') {
    const queueItem = input.contactId
      ? (job.recipientQueue ?? []).find(q => q.contactId === input.contactId)
      : (job.recipientQueue ?? []).find(q => q.status === 'dispatched');
    const row = queueItem ? campaign.contacts.find(r => r.contact.contactId === queueItem.contactId) : undefined;
    if (row?.phoneCallId || row?.phoneProviderCallId || queueItem?.providerId) {
      const history = await input.phoneAdapter.listCallHistory();
      const match = history.calls.find(
        c =>
          (row?.phoneCallId && (c.id === row.phoneCallId || c.providerCallId === row.phoneCallId)) ||
          (row?.phoneProviderCallId && c.providerCallId === row.phoneProviderCallId) ||
          (queueItem?.providerId && c.providerCallId === queueItem.providerId)
      );
      if (match) {
        const now = new Date().toISOString();
        const summary = match.syncedDetails?.summary ?? match.report?.text ?? null;
        const durationSeconds = match.syncedDetails?.durationSeconds ?? null;
        const nextContacts = campaign.contacts.map(r =>
          r.contact.contactId === row!.contact.contactId
            ? {
                ...r,
                phoneCallId: match.id,
                ...(match.providerCallId || r.phoneProviderCallId
                  ? { phoneProviderCallId: match.providerCallId ?? r.phoneProviderCallId ?? null }
                  : {}),
                ...(typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)
                  ? { phoneDurationSeconds: Math.max(0, Math.round(durationSeconds)) }
                  : {}),
                phoneRecordState: match.state,
                phoneStatus: mapPhoneStateToCampaignCallStatus(match.state),
                ...(summary ? { phoneTranscriptSummary: summary } : {}),
                ...(match.syncedDetails?.requirements ? { structuredNotes: match.syncedDetails.requirements } : {}),
                ...(match.syncedDetails?.preferredCallbackTime
                  ? { preferredCallbackTime: match.syncedDetails.preferredCallbackTime }
                  : {}),
                interactionTimestamp: match.updatedAt ?? now,
                updatedAt: now
              }
            : r
        );
        return {
          campaign: { ...campaign, updatedAt: now, contacts: nextContacts },
          status: match.state,
          durationSeconds,
          summary
        };
      }
    }
    return { campaign, status: row?.phoneRecordState ?? 'queued', durationSeconds: null, summary: null };
  }

  const updated = await refreshBulkCampaignPilotResult(campaign, input.phoneAdapter);
  const pilot = updated.pilotCall;
  return {
    campaign: updated,
    status: pilot?.status ?? 'unknown',
    durationSeconds: pilot?.durationSeconds ?? null,
    summary: pilot?.summary ?? null
  };
}

export async function executeBulkCampaignN8nWhatsAppJob(
  campaign: BulkCampaignState,
  input: {
    jobId: string;
    whatsappAdapter: BulkCampaignWhatsAppAdapter;
    contactId?: string;
  }
): Promise<{
  campaign: BulkCampaignState;
  ok: boolean;
  dispatchId?: string | null;
  providerMessageId?: string | null;
  status?: string;
  failureReason?: string;
}> {
  const jobs = campaign.n8nJobs ?? [];
  const idx = jobs.findIndex(j => j.jobId === input.jobId);
  if (idx === -1) return { campaign, ok: false, failureReason: 'JOB_NOT_FOUND' };
  const job = jobs[idx]!;

  if (job.mode === 'multi_contact_batch') {
    if (job.emergencyStopped || job.status !== 'running') {
      return { campaign, ok: false, failureReason: `JOB_NOT_RUNNING_OR_${job.status.toUpperCase()}` };
    }
    const queue = [...(job.recipientQueue ?? [])];
    const qIdx = input.contactId
      ? queue.findIndex(q => q.contactId === input.contactId)
      : queue.findIndex(q => q.status === 'claimed');
    if (qIdx === -1) {
      return { campaign, ok: false, failureReason: 'BATCH_CONTACT_NOT_CLAIMED' };
    }
    const item = queue[qIdx]!;
    if (item.providerId || item.status === 'dispatched' || item.status === 'completed') {
      return { campaign, ok: false, failureReason: 'DUPLICATE_WHATSAPP_PREVENTED' };
    }
    if (item.status !== 'claimed') {
      return { campaign, ok: false, failureReason: `CONTACT_NOT_CLAIMED_${item.status.toUpperCase()}` };
    }
    const row = campaign.contacts.find(c => c.contact.contactId === item.contactId);
    const contact = row?.contact;
    if (!row?.selectedByOwner || !contact || !contact.whatsappE164 || !contact.consent.whatsapp || contact.dnd || contact.optedOut) {
      return { campaign, ok: false, failureReason: 'WHATSAPP_CONSENT_OR_OPT_OUT_FAILED' };
    }

    try {
      const result = await input.whatsappAdapter.sendTemplateInvitation({
        campaignId: campaign.campaignId,
        connectionId: campaign.whatsappPlan.connectionId || 'default',
        contact,
        templateName: campaign.whatsappPlan.templateName,
        language: campaign.whatsappPlan.language,
        messagePreview: row.personalizedWhatsappPreview || campaign.whatsappPlan.messagePreview,
        eventDetails: campaign.eventDetails,
        executionMode: 'live',
        idempotencyKey: item.idempotencyKey
      });
      const now = new Date().toISOString();
      const ok = result.status !== 'failed';
      queue[qIdx] = {
        ...item,
        status: ok ? 'dispatched' : 'failed',
        providerId: result.providerMessageId ?? null,
        ...(result.error ? { failureReason: result.error.slice(0, 300) } : {}),
        updatedAt: now
      };
      const nextJobs = [...jobs];
      nextJobs[idx] = { ...job, recipientQueue: queue };
      const nextContacts = campaign.contacts.map(r =>
        r.contact.contactId === contact.contactId
          ? {
              ...r,
              whatsappStatus: result.status,
              whatsappProviderMessageId: result.providerMessageId,
              ...(result.error ? { whatsappError: result.error } : {}),
              updatedAt: now
            }
          : r
      );
      return {
        campaign: { ...campaign, updatedAt: now, contacts: nextContacts, n8nJobs: nextJobs },
        ok,
        providerMessageId: result.providerMessageId,
        status: result.status,
        ...(result.error ? { failureReason: result.error } : {})
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'WHATSAPP_BATCH_EXECUTION_FAILED';
      const now = new Date().toISOString();
      queue[qIdx] = { ...item, status: 'failed', failureReason: msg.slice(0, 300), updatedAt: now };
      const nextJobs = [...jobs];
      nextJobs[idx] = { ...job, recipientQueue: queue };
      return {
        campaign: { ...campaign, updatedAt: now, n8nJobs: nextJobs },
        ok: false,
        failureReason: msg
      };
    }
  }

  if (job.status !== 'running' || !job.claimedAt) {
    return { campaign, ok: false, failureReason: `JOB_NOT_CLAIMED_OR_${job.status.toUpperCase()}` };
  }
  if (job.dispatchedAt || job.providerMessageId || job.dispatchId) {
    return { campaign, ok: false, failureReason: 'DUPLICATE_WHATSAPP_PREVENTED' };
  }
  const row = campaign.contacts.find(c => c.contact.contactId === job.targetContactId);
  const contact = row?.contact;
  if (!contact || !contact.whatsappE164 || !contact.consent.whatsapp || contact.optedOut) {
    return { campaign, ok: false, failureReason: 'WHATSAPP_CONSENT_OR_OPT_OUT_FAILED' };
  }

  const pilotWa = campaign.pilotWhatsApp;
  const idempotencyKey = `n8n-wa-${job.jobId}-${contact.contactId}`;
  try {
    const result = await input.whatsappAdapter.sendTemplateInvitation({
      campaignId: campaign.campaignId,
      connectionId: pilotWa?.connectionId ?? 'default',
      contact,
      templateName: pilotWa?.templateName ?? campaign.whatsappPlan.templateName,
      language: pilotWa?.language ?? campaign.whatsappPlan.language,
      messagePreview: pilotWa?.messagePreview ?? campaign.whatsappPlan.messagePreview,
      eventDetails: campaign.eventDetails,
      executionMode: 'live',
      idempotencyKey
    });

    const now = new Date().toISOString();
    const ok = result.status !== 'failed';
    const nextJobs = [...jobs];
    nextJobs[idx] = {
      ...job,
      dispatchedAt: now,
      providerMessageId: result.providerMessageId,
      deliveryStatus: result.status,
      ...(result.error ? { failureReason: result.error.slice(0, 500) } : {})
    };
    const nextPilotWa: BulkCampaignPilotWhatsAppState | undefined = pilotWa
      ? {
          ...pilotWa,
          status: ok ? 'queued' : 'failed',
          providerMessageId: result.providerMessageId,
          error: result.error ?? null,
          updatedAt: now
        }
      : undefined;

    return {
      campaign: {
        ...campaign,
        updatedAt: now,
        n8nJobs: nextJobs,
        ...(nextPilotWa ? { pilotWhatsApp: nextPilotWa } : {})
      },
      ok,
      providerMessageId: result.providerMessageId,
      status: result.status,
      ...(result.error ? { failureReason: result.error } : {})
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'WHATSAPP_EXECUTION_FAILED';
    const now = new Date().toISOString();
    const nextJobs = [...jobs];
    nextJobs[idx] = { ...job, status: 'failed', failureReason: msg.slice(0, 500), completedAt: now };
    return {
      campaign: {
        ...campaign,
        updatedAt: now,
        n8nJobs: nextJobs,
        ...(pilotWa ? { pilotWhatsApp: { ...pilotWa, status: 'failed', error: msg.slice(0, 500), updatedAt: now } } : {})
      },
      ok: false,
      failureReason: msg
    };
  }
}

export async function pollBulkCampaignN8nWhatsAppJob(
  campaign: BulkCampaignState,
  input: {
    jobId: string;
    scope: AuthenticatedScope;
    durableWhatsApp?: Pick<DurableWhatsAppService, 'inbox'>;
    contactId?: string;
  }
): Promise<{
  campaign: BulkCampaignState;
  deliveryStatus: string;
  replyReceived: boolean;
  latestReplyPreview: string | null;
  optOutDetected: boolean;
}> {
  const job = (campaign.n8nJobs ?? []).find(j => j.jobId === input.jobId);
  if (job?.mode === 'multi_contact_batch') {
    const targetId =
      input.contactId ??
      (job.recipientQueue ?? []).find(q => q.status === 'dispatched')?.contactId;
    const row = targetId ? campaign.contacts.find(r => r.contact.contactId === targetId) : undefined;
    if (!row) {
      return {
        campaign,
        deliveryStatus: 'unknown',
        replyReceived: false,
        latestReplyPreview: null,
        optOutDetected: false
      };
    }
    let replyReceived = Boolean(row.whatsappCustomerReply);
    let latestReplyPreview = row.whatsappCustomerReply ?? null;
    let optOutDetected = Boolean(row.contact.optedOut);
    let deliveryStatus: string = row.whatsappStatus;

    if (input.durableWhatsApp) {
      try {
        const inbox = await input.durableWhatsApp.inbox(
          input.scope,
          campaign.whatsappPlan.connectionId || 'default',
          { pageSize: 25 }
        );
        const inboundMsg = inbox.messages?.find(
          m =>
            m.direction === 'inbound' &&
            (m.recipientId === row.contact.contactId ||
              (row.contact.whatsappE164 && m.recipientId === row.contact.whatsappE164))
        );
        if (inboundMsg?.textPreview) {
          replyReceived = true;
          latestReplyPreview = inboundMsg.textPreview.slice(0, 400);
          deliveryStatus = 'replied';
          if (/\b(?:stop|unsubscribe|opt\s*out|cancel|remove)\b/i.test(latestReplyPreview)) {
            optOutDetected = true;
          }
        }
      } catch {
        // Preserve last known status if inbox is temporarily unavailable
      }
    }

    const now = new Date().toISOString();
    const updatedContacts = campaign.contacts.map(r =>
      r.contact.contactId === row.contact.contactId
        ? {
            ...r,
            contact: optOutDetected ? { ...r.contact, optedOut: true } : r.contact,
            ...(latestReplyPreview ? { whatsappCustomerReply: latestReplyPreview } : {}),
            ...(optOutDetected ? { attendanceOutcome: 'opted_out' as const } : {}),
            updatedAt: now
          }
        : r
    );
    return {
      campaign: { ...campaign, updatedAt: now, contacts: updatedContacts },
      deliveryStatus,
      replyReceived,
      latestReplyPreview,
      optOutDetected
    };
  }

  const pilotWa = campaign.pilotWhatsApp;
  if (!pilotWa) {
    return {
      campaign,
      deliveryStatus: 'unknown',
      replyReceived: false,
      latestReplyPreview: null,
      optOutDetected: false
    };
  }
  let replyReceived = Boolean(pilotWa.replyReceived);
  let latestReplyPreview = pilotWa.latestReplyPreview ?? null;
  let optOutDetected = Boolean(pilotWa.optOutDetected);
  let deliveryStatus: BulkCampaignPilotWhatsAppState['status'] = pilotWa.status;

  if (input.durableWhatsApp) {
    try {
      const inbox = await input.durableWhatsApp.inbox(input.scope, pilotWa.connectionId, { pageSize: 20 });
      const inboundMsg = inbox.messages?.find(
        m => m.direction === 'inbound' && m.recipientId === pilotWa.contactId
      );
      if (inboundMsg?.textPreview) {
        replyReceived = true;
        latestReplyPreview = inboundMsg.textPreview.slice(0, 400);
        deliveryStatus = 'replied';
        if (/\b(?:stop|unsubscribe|opt\s*out|cancel|remove)\b/i.test(latestReplyPreview)) {
          optOutDetected = true;
        }
      }
    } catch {
      // Preserve last known status if inbox is temporarily unavailable
    }
  }

  const now = new Date().toISOString();
  const updatedContacts = optOutDetected
    ? campaign.contacts.map(r =>
        r.contact.contactId === pilotWa.contactId ? { ...r, contact: { ...r.contact, optedOut: true } } : r
      )
    : campaign.contacts;

  return {
    campaign: {
      ...campaign,
      updatedAt: now,
      contacts: updatedContacts,
      pilotWhatsApp: {
        ...pilotWa,
        status: deliveryStatus,
        replyReceived,
        latestReplyPreview,
        optOutDetected,
        updatedAt: now
      }
    },
    deliveryStatus,
    replyReceived,
    latestReplyPreview,
    optOutDetected
  };
}

export function completeBulkCampaignN8nJob(
  campaign: BulkCampaignState,
  input: {
    jobId: string;
    status: 'completed' | 'failed' | 'stopped';
    outcomeSummary?: string;
    failureReason?: string;
    n8nExecutionId?: string;
  }
): BulkCampaignState {
  const jobs = campaign.n8nJobs ?? [];
  const idx = jobs.findIndex(j => j.jobId === input.jobId);
  if (idx === -1) return campaign;
  const current = jobs[idx]!;
  if (current.status === 'cancelled' || current.status === 'paused' || current.status === 'stopped') {
    return campaign;
  }

  const now = new Date().toISOString();
  const nextJobs = [...jobs];
  nextJobs[idx] = {
    ...current,
    status: input.status,
    completedAt: now,
    ...(input.outcomeSummary ? { outcomeSummary: input.outcomeSummary.slice(0, 1000) } : {}),
    ...(input.failureReason ? { failureReason: input.failureReason.slice(0, 500) } : {}),
    ...(input.n8nExecutionId ? { n8nExecutionId: input.n8nExecutionId.slice(0, 128) } : {}),
    ...(campaign.pilotWhatsApp
      ? {
          deliveryStatus: campaign.pilotWhatsApp.status,
          replyReceived: Boolean(campaign.pilotWhatsApp.replyReceived),
          latestReplyPreview: campaign.pilotWhatsApp.latestReplyPreview ?? null,
          optOutDetected: Boolean(campaign.pilotWhatsApp.optOutDetected)
        }
      : {})
  };
  return {
    ...campaign,
    updatedAt: now,
    n8nJobs: nextJobs
  };
}


// ---------------------------------------------------------------------------
// Controlled Multi-Contact Batch n8n Orchestration (Offline-Gated)
// ---------------------------------------------------------------------------

function isSavedPhoneDirectoryContactCurrentlyEligible(
  contact: BulkCampaignImportedContact,
  phoneDirectory?: PhoneContactView[]
): boolean {
  if (contact.phoneDirectoryContactId) {
    if (phoneDirectory === undefined) {
      return true;
    }
    const dirEntry = phoneDirectory.find(d => d.contactId === contact.phoneDirectoryContactId);
    return Boolean(dirEntry && !dirEntry.archived && dirEntry.consent.callingAllowed && !dirEntry.consent.expired);
  }
  return Boolean(contact.phoneE164);
}

export async function submitBulkCampaignMultiContactN8nJob(
  campaign: BulkCampaignState,
  input: {
    scope: AuthenticatedScope;
    channel: BulkCampaignN8nChannel;
    batchConfig?: Partial<BulkCampaignN8nBatchConfig>;
    liveMultiContactEnabled?: boolean;
    phoneDirectory?: PhoneContactView[];
    n8nTrigger?: BulkCampaignN8nTrigger;
    onlyContactIds?: string[];
  }
): Promise<{
  campaign: BulkCampaignState;
  job: BulkCampaignN8nExecutionJob;
  executionToken: string;
  webhookDispatched: boolean;
}> {
  if (input.scope.role !== 'owner') {
    throw new Error('FORBIDDEN: Only workspace owners can submit multi-contact n8n batch jobs.');
  }
  if (!input.liveMultiContactEnabled) {
    throw new Error(
      'MULTI_CONTACT_LIVE_DISABLED: Global multi-contact live execution (THAARA_BULK_CAMPAIGN_LIVE_ENABLED) is disabled.'
    );
  }
  if (campaign.status !== 'approved' && campaign.status !== 'completed') {
    throw new Error('CAMPAIGN_NOT_APPROVED: Owner campaign approval is required before batch execution.');
  }
  if (!campaign.approval || campaign.approval.approvedMaterialHash !== campaign.materialHash) {
    throw new Error(
      'CAMPAIGN_REAPPROVAL_REQUIRED: Campaign details, recipients, or limits changed after approval. Fresh owner approval is required.'
    );
  }

  const existingActive = (campaign.n8nJobs ?? []).find(
    j =>
      j.mode === 'multi_contact_batch' &&
      j.channel === input.channel &&
      (j.status === 'queued' || j.status === 'running')
  );
  if (existingActive) {
    throw new Error('DUPLICATE_BATCH_JOB: An active multi-contact n8n batch job already exists for this channel.');
  }

  const batchSize = Math.max(1, Math.min(100, input.batchConfig?.batchSize ?? campaign.limits.maxCalls ?? 10));
  const maxConcurrency = Math.max(1, Math.min(5, input.batchConfig?.maxConcurrency ?? campaign.limits.maxConcurrency ?? 1));
  const rateLimitPerMinute = Math.max(1, Math.min(30, input.batchConfig?.rateLimitPerMinute ?? campaign.limits.rateLimitPerMinute ?? 5));
  const maxRetries = Math.max(0, Math.min(2, input.batchConfig?.maxRetries ?? 0));
  const batchConfig: BulkCampaignN8nBatchConfig = {
    batchSize,
    maxConcurrency,
    rateLimitPerMinute,
    maxRetries
  };

  const now = new Date().toISOString();
  const jobId = `n8nbatch_${crypto.randomUUID().slice(0, 10)}`;
  const queue: BulkCampaignN8nBatchRecipient[] = [];
  const seenRecipientKeys = new Set<string>();

  const onlySet = input.onlyContactIds && input.onlyContactIds.length > 0 ? new Set(input.onlyContactIds) : null;
  for (const row of campaign.contacts) {
    if (queue.length >= batchSize) break;
    const c = row.contact;
    if (onlySet && !onlySet.has(c.contactId)) continue;
    if (!row.selectedByOwner || c.dnd || c.optedOut || c.isSyntheticTestFixture) continue;
    let dedupeKey = '';
    if (input.channel === 'phone_call') {
      if (!c.consent.phone || !isSavedPhoneDirectoryContactCurrentlyEligible(c, input.phoneDirectory)) continue;
      dedupeKey = c.phoneDirectoryContactId ? `pdir:${c.phoneDirectoryContactId}` : `e164:${c.phoneE164!}`;
    } else {
      if (!c.consent.whatsapp || !c.whatsappE164) continue;
      dedupeKey = `wa:${c.whatsappE164}`;
    }
    if (seenRecipientKeys.has(dedupeKey)) continue;
    seenRecipientKeys.add(dedupeKey);
    const maskedPhone =
      input.channel === 'phone_call'
        ? c.maskedPhone || (c.phoneE164 ? maskPhoneCallNumber(c.phoneE164) : '+91 ******0000')
        : maskPhoneCallNumber(c.whatsappE164!);
    queue.push({
      contactId: c.contactId,
      displayName: c.name,
      maskedPhone,
      status: 'pending',
      attempts: 0,
      idempotencyKey: `${jobId}-${c.contactId}`,
      updatedAt: now
    });
  }

  if (queue.length === 0) {
    throw new Error('NO_ELIGIBLE_BATCH_CONTACTS: No owner-selected, consented, non-DND contacts available.');
  }

  const executionToken = crypto.randomBytes(24).toString('base64url');
  const workflowId =
    input.channel === 'phone_call'
      ? BULK_CAMPAIGN_N8N_CALLING_WORKFLOW_ID
      : BULK_CAMPAIGN_N8N_WHATSAPP_WORKFLOW_ID;
  const webhookPath =
    input.channel === 'phone_call'
      ? BULK_CAMPAIGN_N8N_CALLING_WEBHOOK_PATH
      : BULK_CAMPAIGN_N8N_WHATSAPP_WEBHOOK_PATH;

  let webhookDispatched = false;
  let n8nExecutionId: string | null = null;
  if (input.n8nTrigger) {
    const trig = await input.n8nTrigger.triggerWorkflow({
      webhookPath,
      payload: {
        jobId,
        campaignId: campaign.campaignId,
        workspaceId: campaign.workspaceId,
        executionToken,
        channel: input.channel,
        mode: 'multi_contact_batch',
        maxContacts: queue.length,
        rateLimitPerMinute: batchConfig.rateLimitPerMinute
      }
    });
    webhookDispatched = trig.accepted;
    n8nExecutionId = trig.n8nExecutionId ?? null;
  }

  const job: BulkCampaignN8nExecutionJob = {
    jobId,
    campaignId: campaign.campaignId,
    channel: input.channel,
    mode: 'multi_contact_batch',
    workflowId,
    webhookPath,
    targetContactId: queue[0]!.contactId,
    targetDisplayName: `${queue.length} approved contacts`,
    targetMaskedPhone: queue[0]!.maskedPhone,
    batchConfig,
    recipientQueue: queue,
    totalContacts: queue.length,
    processedCount: 0,
    succeededCount: 0,
    failedCount: 0,
    skippedCount: 0,
    emergencyStopped: false,
    status: 'queued',
    createdAt: now,
    createdByUserId: input.scope.userId,
    ...(n8nExecutionId ? { n8nExecutionId } : {}),
    webhookDispatched,
    isSimulated: false
  };

  return {
    campaign: {
      ...campaign,
      executionMode: 'live',
      updatedAt: now,
      n8nJobs: [...(campaign.n8nJobs ?? []), job],
      n8nJobTokenHashes: {
        ...(campaign.n8nJobTokenHashes ?? {}),
        [jobId]: hashExecutionToken(executionToken)
      }
    },
    job,
    executionToken,
    webhookDispatched
  };
}

export function claimNextBatchContactForN8nJob(
  campaign: BulkCampaignState,
  input: {
    jobId: string;
    executionToken: string;
    channel: BulkCampaignN8nChannel;
    phoneDirectory?: PhoneContactView[];
    staleClaimTimeoutMs?: number;
  }
): {
  campaign: BulkCampaignState;
  proceed: boolean;
  hasMore: boolean;
  reason?: string;
  contactId?: string;
  displayName?: string;
  idempotencyKey?: string;
  callPurpose?: string;
  rateLimitDelaySeconds?: number;
  language?: string;
  templateName?: string;
  templateLanguage?: string;
  messagePreview?: string;
  connectionId?: string;
} {
  const jobs = campaign.n8nJobs ?? [];
  const idx = jobs.findIndex(j => j.jobId === input.jobId);
  if (idx === -1) return { campaign, proceed: false, hasMore: false, reason: 'JOB_NOT_FOUND' };
  const job = jobs[idx]!;
  if (!verifyExecutionTokenHash(input.executionToken, campaign.n8nJobTokenHashes?.[input.jobId])) {
    return { campaign, proceed: false, hasMore: false, reason: 'INVALID_EXECUTION_TOKEN' };
  }
  if (job.channel !== input.channel) {
    return { campaign, proceed: false, hasMore: false, reason: 'CHANNEL_MISMATCH' };
  }
  if (job.status === 'paused') {
    return { campaign, proceed: false, hasMore: true, reason: 'JOB_PAUSED' };
  }
  if (job.emergencyStopped || job.status === 'cancelled' || job.status === 'stopped' || job.status === 'completed') {
    return { campaign, proceed: false, hasMore: false, reason: `JOB_${job.status.toUpperCase()}` };
  }
  if (campaign.status !== 'approved' && campaign.status !== 'completed') {
    return { campaign, proceed: false, hasMore: false, reason: 'CAMPAIGN_APPROVAL_REVOKED' };
  }
  if (campaign.approval && campaign.approval.approvedMaterialHash !== campaign.materialHash) {
    return { campaign, proceed: false, hasMore: false, reason: 'CAMPAIGN_APPROVAL_REVOKED' };
  }

  const maxRetries = job.batchConfig?.maxRetries ?? 1;
  const maxConcurrency = Math.max(1, Math.min(5, job.batchConfig?.maxConcurrency ?? campaign.limits.maxConcurrency ?? 1));
  const staleClaimTimeoutMs = Math.max(1_000, input.staleClaimTimeoutMs ?? 5 * 60_000);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const queue = [...(job.recipientQueue ?? [])];

  // Recover any stale claimed recipient that timed out BEFORE dispatch (strictly no providerId => zero duplicate risk)
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    if (
      item.status === 'claimed' &&
      !item.providerId &&
      nowMs - Date.parse(item.updatedAt) >= staleClaimTimeoutMs
    ) {
      queue[i] = {
        ...item,
        status: item.attempts <= maxRetries ? 'failed' : 'failed',
        failureReason: 'STALE_CLAIM_TIMEOUT_RECOVERED',
        updatedAt: now
      };
    }
  }

  // Enforce configured maxConcurrency across currently active (claimed/dispatched) recipients
  const inFlightCount = queue.filter(q => q.status === 'claimed' || q.status === 'dispatched').length;
  if (inFlightCount >= maxConcurrency) {
    const hasRemaining = queue.some(
      q => q.status === 'pending' || (q.status === 'failed' && q.attempts <= maxRetries)
    );
    return {
      campaign,
      proceed: false,
      hasMore: hasRemaining,
      reason: 'MAX_CONCURRENCY_REACHED'
    };
  }

  let chosenIdx = -1;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]!;
    const eligiblePending = item.status === 'pending';
    const eligibleRetry = item.status === 'failed' && item.attempts <= maxRetries;
    if (!eligiblePending && !eligibleRetry) continue;

    // Revalidate consent, live phone directory status, DND, language & opt-out dynamically before claiming
    const row = campaign.contacts.find(r => r.contact.contactId === item.contactId);
    const c = row?.contact;
    const hasConsent =
      Boolean(row?.selectedByOwner) &&
      Boolean(c) &&
      !c!.dnd &&
      !c!.optedOut &&
      !c!.isSyntheticTestFixture &&
      (input.channel === 'phone_call'
        ? Boolean(c!.consent.phone && isSavedPhoneDirectoryContactCurrentlyEligible(c!, input.phoneDirectory))
        : Boolean(c!.consent.whatsapp && c!.whatsappE164));

    if (!hasConsent) {
      queue[i] = { ...item, status: 'skipped', failureReason: 'CONSENT_DND_OR_OPTOUT_REVOKED', updatedAt: now };
      continue;
    }
    if (input.channel === 'phone_call' && !isSupportedPhoneCallingLanguage(c!.preferredLanguage)) {
      queue[i] = { ...item, status: 'skipped', failureReason: 'UNSUPPORTED_PHONE_LANGUAGE', updatedAt: now };
      continue;
    }

    queue[i] = {
      ...item,
      status: 'claimed',
      attempts: item.attempts + 1,
      updatedAt: now
    };
    chosenIdx = i;
    break;
  }

  const skippedCount = queue.filter(q => q.status === 'skipped').length;
  const hasMore = queue.some((q, i) => i !== chosenIdx && (q.status === 'pending' || (q.status === 'failed' && q.attempts <= maxRetries)));

  if (chosenIdx === -1) {
    const allSkippedOrFailed = (job.succeededCount ?? 0) === 0 && (skippedCount > 0 || (job.failedCount ?? 0) > 0);
    const firstFailure = queue.find(q => q.failureReason)?.failureReason;
    const nextJobs = [...jobs];
    nextJobs[idx] = {
      ...job,
      status: allSkippedOrFailed ? 'failed' : 'completed',
      ...(allSkippedOrFailed && firstFailure ? { failureReason: firstFailure } : {}),
      completedAt: now,
      recipientQueue: queue,
      skippedCount,
      processedCount: queue.filter(q => q.status !== 'pending').length
    };
    return {
      campaign: { ...campaign, updatedAt: now, n8nJobs: nextJobs },
      proceed: false,
      hasMore: false,
      reason: allSkippedOrFailed ? (firstFailure ?? 'ALL_RECIPIENTS_SKIPPED_OR_FAILED') : 'BATCH_QUEUE_COMPLETE'
    };
  }

  const chosen = queue[chosenIdx]!;
  const chosenRow = campaign.contacts.find(r => r.contact.contactId === chosen.contactId);
  const nextJobs = [...jobs];
  nextJobs[idx] = {
    ...job,
    status: 'running',
    recipientQueue: queue,
    skippedCount
  };
  const callPurpose = buildPersonalizedLeadCallPurpose(
    campaign,
    campaign.contacts.find(r => r.contact.contactId === chosen.contactId)?.contact
  );
  const rateLimitPerMinute = Math.max(1, job.batchConfig?.rateLimitPerMinute ?? campaign.limits.rateLimitPerMinute ?? 5);
  const rateLimitDelaySeconds = Math.max(2, Math.ceil(60 / rateLimitPerMinute));

  return {
    campaign: { ...campaign, updatedAt: now, n8nJobs: nextJobs },
    proceed: true,
    hasMore,
    contactId: chosen.contactId,
    displayName: chosen.displayName,
    idempotencyKey: chosen.idempotencyKey,
    callPurpose,
    rateLimitDelaySeconds,
    language: chosenRow?.contact.preferredLanguage ?? 'en-IN',
    templateName: campaign.whatsappPlan.templateName,
    templateLanguage: campaign.whatsappPlan.language,
    messagePreview: chosenRow?.personalizedWhatsappPreview ?? campaign.whatsappPlan.messagePreview,
    connectionId: campaign.whatsappPlan.connectionId || 'default'
  };
}

export function recordBatchContactOutcomeForN8nJob(
  campaign: BulkCampaignState,
  input: {
    jobId: string;
    contactId: string;
    status: 'completed' | 'failed' | 'skipped';
    providerId?: string | null;
    thaaraCallId?: string | null;
    durationSeconds?: number | null;
    callOutcome?: 'interested' | 'not_interested' | 'callback_requested' | 'no_answer' | 'busy' | 'failed' | 'opted_out' | null;
    outcome?: string | null;
    failureReason?: string | null;
    optOutDetected?: boolean;
  }
): BulkCampaignState {
  const jobs = campaign.n8nJobs ?? [];
  const idx = jobs.findIndex(j => j.jobId === input.jobId);
  if (idx === -1) return campaign;
  const job = jobs[idx]!;
  const queue = [...(job.recipientQueue ?? [])];
  const qIdx = queue.findIndex(q => q.contactId === input.contactId);
  if (qIdx === -1) return campaign;

  const existingItem = queue[qIdx]!;
  const unbackedPhoneCompletion =
    job.channel === 'phone_call' &&
    input.status === 'completed' &&
    !input.thaaraCallId &&
    !input.providerId &&
    !existingItem.providerId &&
    (Boolean(existingItem.failureReason) ||
      (input.callOutcome !== 'no_answer' &&
        input.callOutcome !== 'busy' &&
        input.callOutcome !== 'failed' &&
        input.callOutcome !== 'opted_out'));
  if (unbackedPhoneCompletion) {
    return campaign;
  }
  const now = new Date().toISOString();
  queue[qIdx] = {
    ...existingItem,
    status: input.status,
    ...(input.providerId !== undefined ? { providerId: input.providerId } : {}),
    ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
    ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
    updatedAt: now
  };

  const maxRetries = job.batchConfig?.maxRetries ?? 1;
  const remaining = queue.some(q => q.status === 'pending' || q.status === 'claimed' || (q.status === 'failed' && q.attempts <= maxRetries));
  const succeededCount = queue.filter(q => q.status === 'completed').length;
  const failedCount = queue.filter(q => q.status === 'failed').length;
  const skippedCount = queue.filter(q => q.status === 'skipped').length;
  const processedCount = succeededCount + failedCount + skippedCount;

  const nextJobs = [...jobs];
  nextJobs[idx] = {
    ...job,
    status: remaining ? 'running' : 'completed',
    ...(remaining ? {} : { completedAt: now }),
    recipientQueue: queue,
    processedCount,
    succeededCount,
    failedCount,
    skippedCount
  };

  const updatedContacts = campaign.contacts.map(r => {
    if (r.contact.contactId !== input.contactId) return r;
    const nextContact = input.optOutDetected ? { ...r.contact, optedOut: true } : r.contact;
    const isPhone = job.channel === 'phone_call';
    const nextOutcome: BulkCampaignAttendanceOutcome = input.optOutDetected || input.callOutcome === 'opted_out'
      ? 'opted_out'
      : input.callOutcome === 'interested'
        ? 'interested'
        : input.callOutcome === 'not_interested'
          ? 'not_interested'
          : input.callOutcome === 'callback_requested'
            ? 'callback_requested'
            : input.callOutcome === 'busy'
              ? 'busy'
              : input.callOutcome === 'no_answer'
                ? 'no_response'
                : input.status === 'failed' || input.callOutcome === 'failed'
                  ? 'failed'
                  : input.status === 'skipped'
                    ? 'skipped'
                    : r.attendanceOutcome;
    const resolvedCallId = input.thaaraCallId ?? r.phoneCallId ?? input.providerId ?? undefined;
    return {
      ...r,
      contact: nextContact,
      ...(isPhone
        ? {
            phoneStatus:
              input.callOutcome === 'no_answer' || input.callOutcome === 'busy'
                ? ('not_answered' as const)
                : input.status === 'completed'
                  ? ('answered' as const)
                  : input.status === 'failed'
                    ? ('failed' as const)
                    : ('skipped' as const),
            ...(resolvedCallId ? { phoneCallId: resolvedCallId } : {}),
            ...(input.providerId ? { phoneProviderCallId: input.providerId } : {}),
            ...(typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds)
              ? { phoneDurationSeconds: Math.max(0, Math.round(input.durationSeconds)) }
              : {}),
            ...(input.outcome ? { phoneTranscriptSummary: input.outcome } : {}),
            ...(input.callOutcome === 'callback_requested' ? { followUpRequired: true } : {})
          }
        : {
            whatsappStatus:
              input.status === 'completed'
                ? ('delivered' as const)
                : input.status === 'failed'
                  ? ('failed' as const)
                  : ('skipped' as const),
            ...(input.providerId ? { whatsappProviderMessageId: input.providerId } : {}),
            ...(input.failureReason ? { whatsappError: input.failureReason } : {})
          }),
      attendanceOutcome: nextOutcome,
      interactionTimestamp: now,
      updatedAt: now
    };
  });

  const anyActiveBatchJob = nextJobs.some(
    j => j.mode === 'multi_contact_batch' && (j.status === 'queued' || j.status === 'running')
  );
  const nextSheetMonitor =
    campaign.mode === 'automatic_lead_followup' &&
    campaign.sheetMonitor &&
    !anyActiveBatchJob &&
    campaign.sheetMonitor.status === 'processing_leads'
      ? { ...campaign.sheetMonitor, status: 'active_monitoring' as const }
      : campaign.sheetMonitor;

  return {
    ...campaign,
    updatedAt: now,
    contacts: updatedContacts,
    n8nJobs: nextJobs,
    ...(nextSheetMonitor ? { sheetMonitor: nextSheetMonitor } : {})
  };
}

export function pauseBulkCampaignN8nJob(
  campaign: BulkCampaignState,
  scope: AuthenticatedScope,
  jobId: string,
  reason = 'Paused by owner.'
): BulkCampaignState {
  if (scope.role !== 'owner') {
    throw new Error('FORBIDDEN: Only workspace owners can pause n8n campaign jobs.');
  }
  const jobs = campaign.n8nJobs ?? [];
  const idx = jobs.findIndex(j => j.jobId === jobId);
  if (idx === -1) {
    throw new Error('N8N_JOB_NOT_FOUND: Execution job not found.');
  }
  const current = jobs[idx]!;
  if (current.mode !== 'multi_contact_batch') {
    throw new Error('PAUSE_UNSUPPORTED: Only multi-contact batch n8n jobs can be paused.');
  }
  if (current.status !== 'queued' && current.status !== 'running') {
    return campaign;
  }
  const now = new Date().toISOString();
  const nextJobs = [...jobs];
  nextJobs[idx] = {
    ...current,
    status: 'paused',
    pausedAt: now,
    failureReason: reason.slice(0, 500)
  };
  return {
    ...campaign,
    updatedAt: now,
    n8nJobs: nextJobs
  };
}


export async function resumeBulkCampaignN8nJob(
  campaign: BulkCampaignState,
  scope: AuthenticatedScope,
  jobId: string,
  input?: {
    n8nTrigger?: BulkCampaignN8nTrigger;
  }
): Promise<{
  campaign: BulkCampaignState;
  job: BulkCampaignN8nExecutionJob;
  executionToken: string;
  webhookDispatched: boolean;
}> {
  if (scope.role !== 'owner') {
    throw new Error('FORBIDDEN: Only workspace owners can resume n8n campaign jobs.');
  }
  if (campaign.status !== 'approved' && campaign.status !== 'completed') {
    throw new Error('CAMPAIGN_NOT_APPROVED: Owner campaign approval is required to resume batch execution.');
  }
  const jobs = campaign.n8nJobs ?? [];
  const idx = jobs.findIndex(j => j.jobId === jobId);
  if (idx === -1) {
    throw new Error('N8N_JOB_NOT_FOUND: Execution job not found.');
  }
  const current = jobs[idx]!;
  if (current.mode !== 'multi_contact_batch') {
    throw new Error('RESUME_UNSUPPORTED: Only multi-contact batch n8n jobs can be resumed.');
  }
  if (current.status !== 'paused') {
    throw new Error(`JOB_NOT_PAUSED: Cannot resume job in status ${current.status}.`);
  }

  const now = new Date().toISOString();
  // Reset any interrupted pre-dispatch claim (no providerId) back to pending so zero duplicates can occur
  const recoveredQueue = (current.recipientQueue ?? []).map(q =>
    q.status === 'claimed' && !q.providerId
      ? { ...q, status: 'pending' as const, updatedAt: now }
      : q
  );
  const maxRetries = current.batchConfig?.maxRetries ?? 1;
  const remaining = recoveredQueue.filter(
    q => q.status === 'pending' || (q.status === 'failed' && q.attempts <= maxRetries)
  );
  if (remaining.length === 0) {
    throw new Error('BATCH_QUEUE_COMPLETE: No pending contacts remain to resume.');
  }

  const executionToken = crypto.randomBytes(24).toString('base64url');
  let webhookDispatched = false;
  let n8nExecutionId = current.n8nExecutionId ?? null;
  if (input?.n8nTrigger) {
    const trig = await input.n8nTrigger.triggerWorkflow({
      webhookPath: current.webhookPath,
      payload: {
        jobId: current.jobId,
        campaignId: campaign.campaignId,
        workspaceId: campaign.workspaceId,
        executionToken,
        channel: current.channel,
        mode: 'multi_contact_batch',
        maxContacts: remaining.length,
        rateLimitPerMinute: current.batchConfig?.rateLimitPerMinute ?? campaign.limits.rateLimitPerMinute ?? 5
      }
    });
    webhookDispatched = trig.accepted;
    if (trig.n8nExecutionId) {
      n8nExecutionId = trig.n8nExecutionId;
    }
  }

  const resumedJob: BulkCampaignN8nExecutionJob = {
    ...current,
    status: 'queued',
    resumedAt: now,
    failureReason: null,
    recipientQueue: recoveredQueue,
    ...(n8nExecutionId ? { n8nExecutionId } : {}),
    webhookDispatched
  };
  const nextJobs = [...jobs];
  nextJobs[idx] = resumedJob;

  return {
    campaign: {
      ...campaign,
      updatedAt: now,
      n8nJobs: nextJobs,
      n8nJobTokenHashes: {
        ...(campaign.n8nJobTokenHashes ?? {}),
        [jobId]: hashExecutionToken(executionToken)
      }
    },
    job: resumedJob,
    executionToken,
    webhookDispatched
  };
}

export function isCampaignAllowlistedForLive(
  campaignId: string,
  envValue = process.env.THAARA_BULK_CAMPAIGN_LIVE_ALLOW_CAMPAIGN_IDS
): boolean {
  const raw = (envValue ?? '').trim();
  if (!raw) return true;
  const allowed = new Set(
    raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
  return allowed.has(campaignId);
}

export function createBulkCampaignLiveExecutionGrant(
  campaign: BulkCampaignState,
  scope: AuthenticatedScope,
  options?: { now?: Date; ttlHours?: number }
): NonNullable<BulkCampaignState['liveExecutionGrant']> {
  if (scope.role !== 'owner') {
    throw new Error('FORBIDDEN: Only workspace owners can grant live campaign execution.');
  }
  if (campaign.workspaceId !== scope.workspaceId) {
    throw new Error('FORBIDDEN: Cross-workspace live execution grant denied.');
  }
  if (!campaign.approval || campaign.approval.approvedMaterialHash !== campaign.materialHash) {
    throw new Error('APPROVAL_REQUIRED: Campaign must be approved for its current material hash.');
  }
  const now = options?.now ?? new Date();
  const ttlHours = Math.min(Math.max(1, options?.ttlHours ?? 24), 72);
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
  const selectedContactIds = campaign.contacts
    .filter(c => c.selectedByOwner && c.category === 'eligible')
    .map(c => c.contact.contactId);

  return {
    grantId: `grant_${crypto.randomUUID().slice(0, 12)}`,
    workspaceId: campaign.workspaceId,
    approvedByUserId: scope.userId,
    campaignId: campaign.campaignId,
    approvedMaterialHash: campaign.approval.approvedMaterialHash,
    authorizedChannels: [...campaign.channels],
    selectedContactIds,
    limits: { ...campaign.limits },
    grantedAt: now.toISOString(),
    expiresAt,
    revoked: false
  };
}

export function isCampaignAuthorizedForLiveExecution(
  campaign: BulkCampaignState,
  scope: AuthenticatedScope,
  options?: {
    allowCampaignIdsEnv?: string;
    allowOwnerApprovedEnv?: string;
    now?: Date;
  }
): { authorized: boolean; reason?: string } {
  if (scope.role !== 'owner' || campaign.workspaceId !== scope.workspaceId) {
    return { authorized: false, reason: 'Only the workspace owner can authorize live campaign execution.' };
  }
  if (!campaign.approval || campaign.approval.approvedMaterialHash !== campaign.materialHash) {
    return {
      authorized: false,
      reason: 'Campaign material changed or is not approved. Fresh owner approval is required.'
    };
  }

  const allowIdsRaw = (options?.allowCampaignIdsEnv ?? process.env.THAARA_BULK_CAMPAIGN_LIVE_ALLOW_CAMPAIGN_IDS ?? '').trim();
  const ownerApprovedPolicyEnabled =
    (options?.allowOwnerApprovedEnv ?? process.env.THAARA_BULK_CAMPAIGN_LIVE_ALLOW_OWNER_APPROVED ?? '').trim() === 'true';

  // If a strict pilot allowlist is configured and owner-approved durable policy is not enabled,
  // enforce the exact pilot campaign allowlist.
  if (allowIdsRaw && !ownerApprovedPolicyEnabled) {
    if (!isCampaignAllowlistedForLive(campaign.campaignId, allowIdsRaw)) {
      return {
        authorized: false,
        reason: `Campaign "${campaign.campaignId}" is not enabled in the current restricted pilot allowlist.`
      };
    }
    return { authorized: true };
  }

  // Automatic Lead Follow-up (Mode B): validate durable standing authorization bound to Sheet + materialHash
  if (campaign.mode === 'automatic_lead_followup') {
    const sg = campaign.standingAuthorization;
    if (!sg) {
      return { authorized: false, reason: 'Automatic Lead Follow-up lacks a standing owner authorization.' };
    }
    if (sg.revoked) {
      return { authorized: false, reason: 'Standing authorization for Automatic Lead Follow-up was revoked.' };
    }
    if (sg.approvedByUserId !== scope.userId) {
      return { authorized: false, reason: 'Standing authorization owner identity mismatch.' };
    }
    if (sg.approvedMaterialHash !== campaign.materialHash) {
      return {
        authorized: false,
        reason: 'Campaign instructions, Sheet, or policy changed after activation. Fresh owner activation is required.'
      };
    }
    if (!campaign.sheetMonitor || sg.spreadsheetId !== campaign.sheetMonitor.spreadsheetId || sg.tabName !== campaign.sheetMonitor.tabName) {
      return {
        authorized: false,
        reason: 'Connected Google Sheet or tab changed after activation. Fresh owner activation is required.'
      };
    }
    const nowMs = (options?.now ?? new Date()).getTime();
    if (Date.parse(sg.expiresAt) <= nowMs) {
      return { authorized: false, reason: 'Standing authorization expired. Owner renewal is required.' };
    }
    const allowedCh = new Set(sg.authorizedChannels);
    if (campaign.channels.some(ch => !allowedCh.has(ch))) {
      return { authorized: false, reason: 'Campaign channels exceed standing authorization scope.' };
    }
    return { authorized: true };
  }

  // Durable, narrowly-scoped persisted grant check
  const grant = campaign.liveExecutionGrant;
  if (!grant) {
    return {
      authorized: false,
      reason: 'Campaign lacks a persisted owner-authorized live execution grant.'
    };
  }
  if (grant.revoked) {
    return { authorized: false, reason: 'Live execution grant for this campaign was revoked.' };
  }
  if (grant.workspaceId !== campaign.workspaceId || grant.campaignId !== campaign.campaignId) {
    return { authorized: false, reason: 'Live execution grant scope mismatch.' };
  }
  if (grant.approvedByUserId !== scope.userId) {
    return { authorized: false, reason: 'Live execution grant owner identity mismatch.' };
  }
  if (grant.approvedMaterialHash !== campaign.materialHash) {
    return {
      authorized: false,
      reason: 'Campaign material changed after authorization. Fresh owner approval is required.'
    };
  }
  const allowedContacts = new Set(grant.selectedContactIds);
  const currentSelectedIds = campaign.contacts
    .filter(c => c.selectedByOwner && c.category === 'eligible')
    .map(c => c.contact.contactId);
  if (currentSelectedIds.some(id => !allowedContacts.has(id))) {
    return {
      authorized: false,
      reason: 'Campaign recipients changed after authorization. Fresh owner approval is required.'
    };
  }
  const allowedChannels = new Set(grant.authorizedChannels);
  if (campaign.channels.some(ch => !allowedChannels.has(ch))) {
    return {
      authorized: false,
      reason: 'Campaign channels changed after authorization. Fresh owner approval is required.'
    };
  }
  if (
    grant.limits.maxCalls !== campaign.limits.maxCalls ||
    grant.limits.dailyPhoneCallLimit !== campaign.limits.dailyPhoneCallLimit ||
    grant.limits.rateLimitPerMinute !== campaign.limits.rateLimitPerMinute ||
    grant.limits.maxConcurrency !== campaign.limits.maxConcurrency
  ) {
    return {
      authorized: false,
      reason: 'Campaign execution limits changed after authorization. Fresh owner approval is required.'
    };
  }
  const nowMs = (options?.now ?? new Date()).getTime();
  if (!Number.isFinite(Date.parse(grant.expiresAt)) || Date.parse(grant.expiresAt) <= nowMs) {
    return {
      authorized: false,
      reason: 'Live execution authorization window has expired. Please re-approve to continue.'
    };
  }
  return { authorized: true };
}

export function isChannelAllowlistedForLive(
  channel: 'phone' | 'phone_call' | 'whatsapp' | 'email',
  envValue = process.env.THAARA_BULK_CAMPAIGN_LIVE_ALLOW_CHANNELS
): boolean {
  const normalized = channel === 'phone' ? 'phone_call' : channel;
  const raw = (envValue ?? '').trim();
  if (!raw) {
    // Bulk email remains hard-blocked by default unless explicitly opted in via THAARA_BULK_CAMPAIGN_LIVE_ALLOW_CHANNELS
    return normalized !== 'email';
  }
  const allowed = new Set(
    raw
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
      .map(s => (s === 'phone' ? 'phone_call' : s))
  );
  return allowed.has(normalized);
}

export function emergencyStopAllBulkCampaignN8nJobs(
  campaign: BulkCampaignState,
  scope: AuthenticatedScope,
  reason = 'Emergency stop triggered by owner.'
): BulkCampaignState {
  if (scope.role !== 'owner') {
    throw new Error('FORBIDDEN: Only workspace owners can trigger an emergency stop.');
  }
  const now = new Date().toISOString();
  const nextJobs = (campaign.n8nJobs ?? []).map(job => {
    if (job.status !== 'queued' && job.status !== 'running' && job.status !== 'paused') return job;
    const updatedQueue = job.recipientQueue?.map(q =>
      q.status === 'pending' || q.status === 'claimed' ? { ...q, status: 'cancelled' as const, updatedAt: now } : q
    );
    return {
      ...job,
      status: 'stopped' as const,
      emergencyStopped: true,
      cancelledAt: now,
      failureReason: reason.slice(0, 500),
      ...(updatedQueue ? { recipientQueue: updatedQueue } : {})
    };
  });
  return {
    ...campaign,
    updatedAt: now,
    n8nJobs: nextJobs
  };
}

export interface BulkCampaignWhatsAppTranscriptMessage {
  id: string;
  speaker: 'thaara' | 'customer';
  text: string;
  timestamp: string;
  status?: string;
  providerMessageId?: string | null;
  deliveryEvents?: Array<{ status: string; timestamp: string }>;
}

export interface BulkCampaignWhatsAppTranscriptResult {
  campaignId: string;
  contactId: string;
  contactName: string;
  maskedPhone: string | null;
  attributionStatus: 'attributed' | 'simulated' | 'unassigned' | 'ambiguous' | 'unavailable';
  attributionNote?: string;
  isSimulated: boolean;
  language: string;
  conversationRecipientId: string | null;
  messages: BulkCampaignWhatsAppTranscriptMessage[];
}

export async function getBulkCampaignContactWhatsAppTranscript(
  campaign: BulkCampaignState,
  contactId: string,
  deps: {
    scope: AuthenticatedScope;
    whatsappDurable?: DurableWhatsAppService;
  }
): Promise<BulkCampaignWhatsAppTranscriptResult> {
  const row = campaign.contacts.find(c => c.contact.contactId === contactId);
  if (!row) {
    throw new Error('Contact not found in campaign.');
  }

  const baseResult: Omit<BulkCampaignWhatsAppTranscriptResult, 'attributionStatus' | 'isSimulated' | 'messages'> = {
    campaignId: campaign.campaignId,
    contactId: row.contact.contactId,
    contactName: row.contact.name,
    maskedPhone: row.contact.maskedPhone ?? null,
    language: row.contact.preferredLanguage,
    conversationRecipientId: null
  };

  const hasRealDispatch = Boolean(row.whatsappDispatchId || row.whatsappProviderMessageId);
  if (!hasRealDispatch && row.simulatedDialogueTurns && row.simulatedDialogueTurns.length > 0 && campaign.executionMode !== 'live') {
    return {
      ...baseResult,
      attributionStatus: 'simulated',
      isSimulated: true,
      messages: row.simulatedDialogueTurns.map((t, idx) => ({
        id: `sim_wa_${idx + 1}`,
        speaker: t.speaker,
        text: t.text,
        timestamp: row.interactionTimestamp ?? row.updatedAt,
        status: t.speaker === 'thaara' ? row.whatsappStatus : 'received'
      }))
    };
  }

  if (!hasRealDispatch) {
    return {
      ...baseResult,
      attributionStatus: 'unassigned',
      attributionNote:
        'No campaign-attributed WhatsApp dispatch ID or provider message ID is recorded for this contact. Unrelated conversations are not linked.',
      isSimulated: false,
      messages: []
    };
  }

  if (!deps.whatsappDurable || !campaign.whatsappPlan.connectionId) {
    const fallbackMessages: BulkCampaignWhatsAppTranscriptMessage[] = [];
    if (row.personalizedWhatsappPreview) {
      fallbackMessages.push({
        id: row.whatsappProviderMessageId ?? row.whatsappDispatchId ?? 'wa_outbound_1',
        speaker: 'thaara',
        text: row.personalizedWhatsappPreview,
        timestamp: row.interactionTimestamp ?? row.updatedAt,
        status: row.whatsappStatus,
        providerMessageId: row.whatsappProviderMessageId ?? null
      });
    }
    if (row.whatsappCustomerReply) {
      fallbackMessages.push({
        id: 'wa_inbound_1',
        speaker: 'customer',
        text: row.whatsappCustomerReply,
        timestamp: row.interactionTimestamp ?? row.updatedAt,
        status: 'received'
      });
    }
    return {
      ...baseResult,
      attributionStatus: fallbackMessages.length > 0 ? 'attributed' : 'unavailable',
      isSimulated: false,
      messages: fallbackMessages
    };
  }

  try {
    const inbox = await deps.whatsappDurable.inbox(deps.scope, campaign.whatsappPlan.connectionId);
    const cleanDigits = row.contact.whatsappE164?.replace(/\D/g, '') ?? '';
    const expectedCid = cleanDigits ? `c_${cleanDigits}` : '';
    const thread = inbox.conversations.find(
      t =>
        (expectedCid && t.recipientId === expectedCid) ||
        (row.contact.maskedPhone && t.maskedPhone.slice(-4) === row.contact.maskedPhone.slice(-4))
    );
    if (!thread) {
      return {
        ...baseResult,
        attributionStatus: 'unassigned',
        attributionNote: 'No matching WhatsApp thread found for this contact in the workspace inbox.',
        isSimulated: false,
        messages: []
      };
    }

    const detail = await deps.whatsappDurable.inbox(deps.scope, campaign.whatsappPlan.connectionId, {
      recipientId: thread.recipientId,
      pageSize: 50
    });
    const rawMessages = detail.messages ?? [];
    const matchedOutboundIdx = rawMessages.findIndex(
      m =>
        m.direction === 'outbound' &&
        ((row.whatsappProviderMessageId && m.providerMessageId === row.whatsappProviderMessageId) ||
          (row.whatsappDispatchId && (m as { dispatchId?: string }).dispatchId === row.whatsappDispatchId))
    );

    if (matchedOutboundIdx < 0) {
      return {
        ...baseResult,
        conversationRecipientId: thread.recipientId,
        attributionStatus: 'ambiguous',
        attributionNote:
          'Unable to match the exact outbound campaign message ID in this thread. Unrelated private messages are hidden.',
        isSimulated: false,
        messages: []
      };
    }

    const campaignWindowMessages = rawMessages
      .slice(matchedOutboundIdx)
      .sort((a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0));

    return {
      ...baseResult,
      language: thread.enquiry?.detectedLanguage ?? row.contact.preferredLanguage,
      conversationRecipientId: thread.recipientId,
      attributionStatus: 'attributed',
      isSimulated: false,
      messages: campaignWindowMessages.map(m => ({
        id: m.id,
        speaker: m.direction === 'outbound' ? 'thaara' : 'customer',
        text: m.textPreview,
        timestamp: m.timestamp,
        status: m.status,
        providerMessageId: m.providerMessageId,
        ...(m.deliveryEvents ? { deliveryEvents: m.deliveryEvents } : {})
      }))
    };
  } catch {
    return {
      ...baseResult,
      attributionStatus: 'unavailable',
      attributionNote: 'WhatsApp conversation storage is temporarily unavailable.',
      isSimulated: false,
      messages: []
    };
  }
}
