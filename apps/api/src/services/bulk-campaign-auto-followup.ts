import crypto from 'node:crypto';
import type {
  BulkCampaignChannel,
  BulkCampaignContactRecord,
  BulkCampaignImportedContact,
  BulkCampaignN8nChannel,
  BulkCampaignSheetMonitorConfig,
  BulkCampaignStandingAuthorization,
  PhoneContactView
} from '@thaara/contracts';
import type { AuthenticatedScope } from '@thaara/db';
import {
  computeCampaignMaterialHash,
  evaluateContactEligibility,
  parseBulkCampaignContacts,
  submitBulkCampaignMultiContactN8nJob,
  type BulkCampaignN8nTrigger,
  type BulkCampaignState
} from './bulk-campaign.js';

export function computeStableSheetRowKey(
  spreadsheetId: string,
  tabName: string,
  contact: Pick<BulkCampaignImportedContact, 'phoneE164' | 'email' | 'enquiryDate' | 'leadSource' | 'serviceRequired'>
): string {
  const identity = contact.phoneE164 ?? contact.email ?? '';
  const payload = [
    spreadsheetId.trim(),
    tabName.trim(),
    identity.trim().toLowerCase(),
    (contact.enquiryDate ?? '').trim().toLowerCase(),
    (contact.leadSource ?? '').trim().toLowerCase(),
    (contact.serviceRequired ?? '').trim().toLowerCase()
  ].join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

export function isWithinIstCallingWindow(
  window: { startHour: number; endHour: number },
  now = new Date()
): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      hourCycle: 'h23'
    }).format(now)
  );
  return hour >= window.startHour && hour < window.endHour;
}

export interface ParsedGoogleSheetUrl {
  spreadsheetId: string;
  tabId?: string;
  canonicalUrl: string;
}

/**
 * Parses and validates a Google Sheets URL (`https://docs.google.com/spreadsheets/d/<ID>/edit#gid=<GID>`).
 * Rejects non-Google-Sheets hosts or malformed URLs. Never grants access by itself.
 */
export function parseGoogleSheetUrl(rawUrl: string): ParsedGoogleSheetUrl {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('INVALID_GOOGLE_SHEET_URL: Enter a Google Sheet URL.');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('INVALID_GOOGLE_SHEET_URL: Invalid Google Sheet URL format.');
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'docs.google.com') {
    throw new Error('INVALID_GOOGLE_SHEET_URL: Only https://docs.google.com/spreadsheets/d/... URLs are supported.');
  }
  const match = /^\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{10,128})(?:\/|$)/.exec(url.pathname);
  if (!match?.[1]) {
    throw new Error('INVALID_GOOGLE_SHEET_URL: Could not extract spreadsheet ID from Google Sheet URL.');
  }
  const spreadsheetId = match[1];
  let tabId = url.searchParams.get('gid')?.trim() || undefined;
  if (!tabId && url.hash) {
    const hashMatch = /(?:^|[#&?])gid=(\d+)/.exec(url.hash);
    if (hashMatch?.[1]) tabId = hashMatch[1];
  }
  if (tabId && !/^\d+$/.test(tabId)) {
    throw new Error('INVALID_GOOGLE_SHEET_URL: Invalid Google Sheet tab gid.');
  }
  const canonicalUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit${tabId ? `#gid=${tabId}` : ''}`;
  return { spreadsheetId, ...(tabId ? { tabId } : {}), canonicalUrl };
}

export interface ConfigureAutoFollowupInput {
  spreadsheetId: string;
  spreadsheetName: string;
  spreadsheetUrl?: string;
  tabName?: string;
  tabId?: string;
  googleConnectionId?: string;
  googleAccountEmail?: string;
  metaCampaignRef?: string;
  metaFormId?: string;
  pollIntervalSeconds?: number;
  processExistingBacklog?: boolean;
  callingHoursIst?: { startHour: number; endHour: number };
  maxAttemptsPerLead?: number;
  retryOnNoAnswer?: boolean;
  retryDelayMinutes?: number;
  maxLeadsPerDay?: number;
  allowedLeadSources?: string[];
}

/**
 * Configures Mode B (Automatic Lead Follow-up) on an existing campaign without redesigning or replacing Mode A.
 * Changing Sheet/tab/policy invalidates any prior standing authorization so fresh owner activation is required.
 */
export function configureAutomaticLeadFollowup(
  campaign: BulkCampaignState,
  input: ConfigureAutoFollowupInput,
  now = new Date()
): BulkCampaignState {
  const parsedUrl = input.spreadsheetUrl?.trim() ? parseGoogleSheetUrl(input.spreadsheetUrl) : null;
  const spreadsheetId = (input.spreadsheetId || parsedUrl?.spreadsheetId || '').trim();
  const spreadsheetName = input.spreadsheetName.trim() || 'Connected Google Sheet';
  const tabName = (input.tabName ?? 'Sheet1').trim() || 'Sheet1';
  const tabId = (input.tabId ?? parsedUrl?.tabId ?? '').trim() || undefined;
  const spreadsheetUrl = parsedUrl?.canonicalUrl ?? (input.spreadsheetUrl?.trim() || undefined);
  const googleConnectionId = input.googleConnectionId?.trim() || undefined;
  const googleAccountEmail = input.googleAccountEmail?.trim().toLowerCase() || undefined;
  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_REQUIRED: Connect a Google Sheet before configuring Automatic Lead Follow-up.');
  }

  const sameSheetAndTab =
    campaign.sheetMonitor?.spreadsheetId === spreadsheetId &&
    (campaign.sheetMonitor?.tabId ?? '') === (tabId ?? '') &&
    campaign.sheetMonitor?.tabName === tabName &&
    (campaign.sheetMonitor?.googleConnectionId ?? '') === (googleConnectionId ?? '');

  const monitor: BulkCampaignSheetMonitorConfig = {
    spreadsheetId,
    spreadsheetName,
    ...(spreadsheetUrl ? { spreadsheetUrl } : {}),
    tabName,
    ...(tabId ? { tabId } : {}),
    ...(googleConnectionId ? { googleConnectionId } : {}),
    ...(googleAccountEmail ? { googleAccountEmail } : {}),
    ...(input.metaCampaignRef?.trim() ? { metaCampaignRef: input.metaCampaignRef.trim().slice(0, 160) } : {}),
    ...(input.metaFormId?.trim() ? { metaFormId: input.metaFormId.trim().slice(0, 160) } : {}),
    pollIntervalSeconds: Math.min(3600, Math.max(15, input.pollIntervalSeconds ?? 60)),
    processExistingBacklog: Boolean(input.processExistingBacklog),
    existingBacklogProcessed: sameSheetAndTab ? Boolean(campaign.sheetMonitor?.existingBacklogProcessed) : false,
    ...(sameSheetAndTab && campaign.sheetMonitor?.existingBacklogApprovedAt
      ? { existingBacklogApprovedAt: campaign.sheetMonitor.existingBacklogApprovedAt }
      : {}),
    backlogSkippedReason: null,
    pendingDispatchContactIds: sameSheetAndTab ? [...(campaign.sheetMonitor?.pendingDispatchContactIds ?? [])] : [],
    status: 'draft',
    lastCheckpointRowNumber: sameSheetAndTab ? (campaign.sheetMonitor?.lastCheckpointRowNumber ?? 0) : 0,
    baselineRowCount: sameSheetAndTab ? (campaign.sheetMonitor?.baselineRowCount ?? 0) : 0,
    knownRowKeys: sameSheetAndTab ? [...(campaign.sheetMonitor?.knownRowKeys ?? [])] : [],
    consecutiveErrors: 0,
    existingLeadsDiscoveredCount: campaign.sheetMonitor?.existingLeadsDiscoveredCount ?? 0,
    newLeadsReceivedCount: campaign.sheetMonitor?.newLeadsReceivedCount ?? 0,
    leadsReceivedCount: campaign.sheetMonitor?.leadsReceivedCount ?? 0,
    leadsEligibleCount: campaign.sheetMonitor?.leadsEligibleCount ?? 0,
    leadsConsentBlockedCount: campaign.sheetMonitor?.leadsConsentBlockedCount ?? 0,
    leadsQueuedCount: campaign.sheetMonitor?.leadsQueuedCount ?? 0,
    followUpsScheduledCount: campaign.sheetMonitor?.followUpsScheduledCount ?? 0
  };

  const nextHash = computeCampaignMaterialHash({
    objective: campaign.objective,
    eventDetails: campaign.eventDetails,
    channels: campaign.channels,
    whatsappPlan: campaign.whatsappPlan,
    callScript: campaign.callScript,
    limits: campaign.limits,
    contacts: campaign.contacts,
    ...(campaign.knowledgeContext ? { knowledgeContext: campaign.knowledgeContext } : {})
  });

  return {
    ...campaign,
    updatedAt: now.toISOString(),
    mode: 'automatic_lead_followup',
    sheetMonitor: monitor,
    standingAuthorization: undefined,
    approval: undefined,
    liveExecutionGrant: undefined,
    materialHash: nextHash,
    status: (campaign.approval ? 'draft_requires_reapproval' : 'draft') as BulkCampaignState['status'],
    // Store policy preferences temporarily in limits/custom metadata until activated
    limits: {
      ...campaign.limits,
      maxCalls: Math.max(campaign.limits.maxCalls, input.maxLeadsPerDay ?? 100)
    }
  };
}

export function activateAutomaticLeadFollowup(
  campaign: BulkCampaignState,
  input: {
    actorUserId: string;
    role: string;
    expectedMaterialHash: string;
    baselineCsvText?: string;
    phoneDirectory?: PhoneContactView[];
    callingHoursIst?: { startHour: number; endHour: number };
    maxAttemptsPerLead?: number;
    retryOnNoAnswer?: boolean;
    retryDelayMinutes?: number;
    maxLeadsPerDay?: number;
    allowedLeadSources?: string[];
    expiresInDays?: number;
    now?: Date;
  }
): BulkCampaignState {
  if (input.role !== 'owner' && input.role !== 'admin') {
    throw new Error('Only the workspace owner or admin can activate Automatic Lead Follow-up.');
  }
  if (campaign.mode !== 'automatic_lead_followup' || !campaign.sheetMonitor) {
    throw new Error('AUTO_FOLLOWUP_NOT_CONFIGURED: Configure a Google Sheet before activating Automatic Lead Follow-up.');
  }
  if (input.expectedMaterialHash !== campaign.materialHash) {
    throw new Error('MATERIAL_HASH_MISMATCH: Campaign material changed. Review and confirm the latest campaign before activating.');
  }

  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const monitor = campaign.sheetMonitor;
  const known = new Set<string>(monitor.knownRowKeys);
  let baselineCount = monitor.baselineRowCount;
  let checkpointRow = monitor.lastCheckpointRowNumber;

  // Record existing Sheet rows as historical baseline so they are NEVER called unless processExistingBacklog is explicitly true
  if (input.baselineCsvText?.trim()) {
    const parsedBaseline = parseBulkCampaignContacts({
      sourceType: 'google_sheets',
      fileName: `${monitor.spreadsheetName}.csv`,
      rawText: input.baselineCsvText,
      phoneDirectory: input.phoneDirectory
    });
    baselineCount = parsedBaseline.validContacts.length;
    if (!monitor.processExistingBacklog) {
      for (const c of parsedBaseline.validContacts) {
        known.add(computeStableSheetRowKey(monitor.spreadsheetId, monitor.tabName, c));
        checkpointRow = Math.max(checkpointRow, c.rowNumber);
      }
    }
  }
  if (!monitor.processExistingBacklog) {
    for (const c of campaign.contacts) {
      known.add(computeStableSheetRowKey(monitor.spreadsheetId, monitor.tabName, c.contact));
    }
  }
  const backlogSkippedReason =
    !monitor.processExistingBacklog && (baselineCount > 0 || campaign.contacts.length > 0)
      ? 'HISTORICAL_ROWS_SKIPPED_BY_SETTING'
      : null;

  const expiresInDays = Math.min(90, Math.max(1, input.expiresInDays ?? 30));
  const expiresAt = new Date(now.getTime() + expiresInDays * 86_400_000).toISOString();

  const standingAuthorization: BulkCampaignStandingAuthorization = {
    grantId: `standingAuth_${crypto.randomUUID().slice(0, 12)}`,
    approvedByUserId: input.actorUserId,
    approvedAt: nowIso,
    expiresAt,
    revoked: false,
    approvedMaterialHash: campaign.materialHash,
    spreadsheetId: monitor.spreadsheetId,
    tabName: monitor.tabName,
    authorizedChannels: [...campaign.channels] as BulkCampaignChannel[],
    allowedLeadSources: input.allowedLeadSources ?? [],
    callingHoursIst: input.callingHoursIst ?? { startHour: 9, endHour: 20 },
    maxAttemptsPerLead: Math.min(5, Math.max(1, input.maxAttemptsPerLead ?? 1)),
    retryOnNoAnswer: Boolean(input.retryOnNoAnswer),
    retryDelayMinutes: Math.min(1440, Math.max(5, input.retryDelayMinutes ?? 60)),
    maxConcurrency: campaign.limits.maxConcurrency,
    rateLimitPerMinute: campaign.limits.rateLimitPerMinute,
    maxLeadsPerDay: Math.min(1000, Math.max(1, input.maxLeadsPerDay ?? 100))
  };

  return {
    ...campaign,
    updatedAt: nowIso,
    status: 'approved',
    executionMode: 'live',
    approval: {
      approvalId: `appr_auto_${crypto.randomUUID().slice(0, 8)}`,
      approvedByUserId: input.actorUserId,
      approvedAt: nowIso,
      approvedMaterialHash: campaign.materialHash,
      estimatedCostInr: 0
    },
    standingAuthorization,
    sheetMonitor: {
      ...monitor,
      status: 'active_monitoring',
      lastSyncAt: nowIso,
      lastSyncError: null,
      lastCheckpointRowNumber: checkpointRow,
      baselineRowCount: baselineCount,
      knownRowKeys: [...known].slice(-5000),
      consecutiveErrors: 0,
      existingBacklogProcessed: false,
      backlogSkippedReason,
      pendingDispatchContactIds: monitor.pendingDispatchContactIds ?? [],
      existingLeadsDiscoveredCount: monitor.existingLeadsDiscoveredCount ?? 0,
      newLeadsReceivedCount: monitor.newLeadsReceivedCount ?? 0
    }
  };
}

export function pauseAutomaticLeadFollowup(campaign: BulkCampaignState, now = new Date()): BulkCampaignState {
  if (!campaign.sheetMonitor) return campaign;
  return {
    ...campaign,
    updatedAt: now.toISOString(),
    status: 'paused',
    sheetMonitor: { ...campaign.sheetMonitor, status: 'paused' }
  };
}

export function resumeAutomaticLeadFollowup(campaign: BulkCampaignState, now = new Date()): BulkCampaignState {
  if (!campaign.sheetMonitor) return campaign;
  if (!campaign.standingAuthorization || campaign.standingAuthorization.revoked) {
    throw new Error('STANDING_AUTH_REVOKED: Standing authorization was stopped or revoked. Re-activate the campaign.');
  }
  return {
    ...campaign,
    updatedAt: now.toISOString(),
    status: 'approved',
    sheetMonitor: { ...campaign.sheetMonitor, status: 'active_monitoring', lastSyncError: null, consecutiveErrors: 0 }
  };
}

export function stopAutomaticLeadFollowup(campaign: BulkCampaignState, now = new Date()): BulkCampaignState {
  if (!campaign.sheetMonitor) return campaign;
  return {
    ...campaign,
    updatedAt: now.toISOString(),
    status: 'stopped',
    sheetMonitor: { ...campaign.sheetMonitor, status: 'stopped' },
    ...(campaign.standingAuthorization
      ? { standingAuthorization: { ...campaign.standingAuthorization, revoked: true } }
      : {})
  };
}

export function recordSheetSyncFailure(
  campaign: BulkCampaignState,
  errorMessage: string,
  now = new Date()
): BulkCampaignState {
  if (!campaign.sheetMonitor) return campaign;
  const nextErrors = (campaign.sheetMonitor.consecutiveErrors ?? 0) + 1;
  return {
    ...campaign,
    updatedAt: now.toISOString(),
    sheetMonitor: {
      ...campaign.sheetMonitor,
      consecutiveErrors: nextErrors,
      lastSyncError: errorMessage.slice(0, 500),
      status: nextErrors >= 3 ? 'attention_required' : campaign.sheetMonitor.status
    }
  };
}

export interface SyncGoogleSheetLeadsResult {
  campaign: BulkCampaignState;
  newRowsDetected: number;
  newEligibleCount: number;
  newBlockedCount: number;
  offHoursDeferredCount: number;
  batchSubmitted: boolean;
  jobId?: string;
  skippedReason?: string;
}

export interface ExistingSheetBacklogPreviewContact {
  contactId: string;
  name: string;
  maskedPhone: string | null;
  category: BulkCampaignContactRecord['category'];
  reason: string;
  alreadyProcessed: boolean;
}

export interface ExistingSheetBacklogPreviewResult {
  campaignId: string;
  totalExistingRows: number;
  previouslyProcessedCount: number;
  eligibleCount: number;
  consentBlockedCount: number;
  duplicatesCount: number;
  invalidCount: number;
  estimatedCallsWithinLimits: number;
  maxLeadsPerDay: number;
  eligibleContactIds: string[];
  previewContacts: ExistingSheetBacklogPreviewContact[];
}

export interface ProcessExistingSheetBacklogResult {
  campaign: BulkCampaignState;
  totalExistingRows: number;
  previouslyProcessedCount: number;
  eligibleCount: number;
  consentBlockedCount: number;
  duplicatesCount: number;
  queuedCount: number;
  offHoursDeferredCount: number;
  batchSubmitted: boolean;
  jobId?: string;
  skippedReason?: string;
}

function getActiveQueueContactIds(campaign: BulkCampaignState): Set<string> {
  const activeIds = new Set<string>();
  for (const job of campaign.n8nJobs ?? []) {
    if (job.status === 'queued' || job.status === 'running' || job.status === 'paused') {
      for (const q of job.recipientQueue ?? []) {
        activeIds.add(q.contactId);
      }
    }
  }
  return activeIds;
}

function isContactAlreadyProcessedOrSuppressed(
  record: BulkCampaignContactRecord,
  activeQueueIds: Set<string>
): boolean {
  if (record.contact.optedOut || record.contact.dnd) return true;
  if (activeQueueIds.has(record.contact.contactId)) return true;
  if (record.phoneStatus !== 'pending' && record.phoneStatus !== 'queued') return true;
  if (record.attendanceOutcome !== 'pending') return true;
  return false;
}

function getActiveN8nBatchChannelJob(campaign: BulkCampaignState, channel: BulkCampaignN8nChannel) {
  return (campaign.n8nJobs ?? []).find(
    j => j.mode === 'multi_contact_batch' && j.channel === channel && (j.status === 'queued' || j.status === 'running')
  );
}

function computeRemainingDailyLimit(
  campaign: BulkCampaignState,
  auth: BulkCampaignStandingAuthorization,
  now: Date
): number {
  const istDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const todayIst = istDateFormatter.format(now);
  let queuedToday = 0;
  for (const job of campaign.n8nJobs ?? []) {
    const jobDateIst = istDateFormatter.format(new Date(job.createdAt));
    if (jobDateIst === todayIst && job.status !== 'stopped') {
      queuedToday += job.recipientQueue?.length ?? job.totalContacts ?? 0;
    }
  }
  return Math.max(0, auth.maxLeadsPerDay - queuedToday);
}

/**
 * Read-only preview of existing Google Sheet rows for an automatic campaign before the owner
 * explicitly approves processing the backlog.
 */
export function previewExistingSheetBacklogForCampaign(
  campaign: BulkCampaignState,
  input: {
    csvText: string;
    phoneDirectory?: PhoneContactView[];
    now?: Date;
  }
): ExistingSheetBacklogPreviewResult {
  if (campaign.mode !== 'automatic_lead_followup' || !campaign.sheetMonitor) {
    throw new Error('AUTO_FOLLOWUP_NOT_CONFIGURED: Automatic Lead Follow-up is not configured on this campaign.');
  }
  const monitor = campaign.sheetMonitor;
  const now = input.now ?? new Date();
  const parsed = parseBulkCampaignContacts({
    sourceType: 'google_sheets',
    fileName: `${monitor.spreadsheetName}.csv`,
    rawText: input.csvText,
    phoneDirectory: input.phoneDirectory
  });

  const activeQueueIds = getActiveQueueContactIds(campaign);
  const existingByPhone = new Map<string, BulkCampaignContactRecord>();
  for (const rec of campaign.contacts) {
    if (rec.contact.phoneE164) {
      existingByPhone.set(rec.contact.phoneE164, rec);
    }
  }

  let previouslyProcessedCount = 0;
  const contactsToEvaluate: BulkCampaignImportedContact[] = [];
  const previewContacts: ExistingSheetBacklogPreviewContact[] = [];

  for (const c of parsed.validContacts) {
    const existingRec = c.phoneE164 ? existingByPhone.get(c.phoneE164) : undefined;
    if (existingRec && isContactAlreadyProcessedOrSuppressed(existingRec, activeQueueIds)) {
      previouslyProcessedCount += 1;
      if (previewContacts.length < 100) {
        previewContacts.push({
          contactId: existingRec.contact.contactId,
          name: existingRec.contact.name,
          maskedPhone: existingRec.contact.maskedPhone ?? null,
          category: existingRec.category,
          reason: existingRec.contact.optedOut
            ? 'Previously opted out (suppressed).'
            : existingRec.contact.dnd
              ? 'DND suppressed.'
              : `Previously processed (${existingRec.phoneStatus}).`,
          alreadyProcessed: true
        });
      }
      continue;
    }
    contactsToEvaluate.push({
      ...c,
      contactId: existingRec?.contact.contactId ?? c.contactId,
      sourceRowKey: computeStableSheetRowKey(monitor.spreadsheetId, monitor.tabName, c),
      sheetRowNumber: c.rowNumber
    });
  }

  const evaluated = evaluateContactEligibility(
    contactsToEvaluate,
    new Set(contactsToEvaluate.map(c => c.contactId)),
    campaign.channels,
    campaign.limits,
    campaign.whatsappPlan.messagePreview,
    campaign.emailConnected,
    undefined,
    now.toISOString(),
    campaign.emailPlan?.bodyPreview
  );

  const eligibleRecords = evaluated.filter(r => r.category === 'eligible');
  const consentBlockedRecords = evaluated.filter(r => r.category !== 'eligible');
  for (const rec of evaluated) {
    if (previewContacts.length >= 100) break;
    previewContacts.push({
      contactId: rec.contact.contactId,
      name: rec.contact.name,
      maskedPhone: rec.contact.maskedPhone ?? null,
      category: rec.category,
      reason: rec.categoryReason,
      alreadyProcessed: false
    });
  }

  const maxLeadsPerDay = campaign.standingAuthorization?.maxLeadsPerDay ?? campaign.limits.maxCalls;
  const remainingLimit = campaign.standingAuthorization
    ? computeRemainingDailyLimit(campaign, campaign.standingAuthorization, now)
    : maxLeadsPerDay;

  return {
    campaignId: campaign.campaignId,
    totalExistingRows: parsed.totalRowsParsed,
    previouslyProcessedCount,
    eligibleCount: eligibleRecords.length,
    consentBlockedCount: consentBlockedRecords.length,
    duplicatesCount: parsed.duplicates.length,
    invalidCount: parsed.invalidEntries.length,
    estimatedCallsWithinLimits: Math.min(eligibleRecords.length, remainingLimit),
    maxLeadsPerDay,
    eligibleContactIds: eligibleRecords.map(r => r.contact.contactId),
    previewContacts
  };
}

/**
 * Phase A: Explicitly owner-approved processing of existing Google Sheet backlog rows.
 * Preserves all consent/DND/opt-out/directory checks, never re-calls already-processed contacts,
 * and keeps the campaign in continuous monitoring mode (Phase B) afterwards.
 */
export async function processExistingSheetBacklogForCampaign(
  campaign: BulkCampaignState,
  input: {
    scope: AuthenticatedScope;
    explicitOwnerApproval: boolean;
    expectedMaterialHash?: string;
    csvText: string;
    phoneDirectory?: PhoneContactView[];
    liveMultiContactEnabled?: boolean;
    n8nTrigger?: BulkCampaignN8nTrigger;
    now?: Date;
  }
): Promise<ProcessExistingSheetBacklogResult> {
  if (input.scope.role !== 'owner' && input.scope.role !== 'admin') {
    throw new Error('FORBIDDEN: Only the workspace owner or admin can approve processing existing Sheet leads.');
  }
  if (!input.explicitOwnerApproval) {
    throw new Error('OWNER_APPROVAL_REQUIRED: Explicit owner approval is required before processing existing Sheet leads.');
  }
  if (campaign.mode !== 'automatic_lead_followup' || !campaign.sheetMonitor) {
    throw new Error('AUTO_FOLLOWUP_NOT_CONFIGURED: Configure and activate Automatic Lead Follow-up first.');
  }
  if (input.expectedMaterialHash && input.expectedMaterialHash !== campaign.materialHash) {
    throw new Error('MATERIAL_HASH_MISMATCH: Campaign material changed. Refresh and review before approving existing leads.');
  }
  const monitor = campaign.sheetMonitor;
  if (monitor.status === 'stopped') {
    throw new Error('MONITOR_STOPPED: Stopped campaign cannot process existing leads. Re-activate first.');
  }
  const auth = campaign.standingAuthorization;
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  if (!auth || auth.revoked || Date.parse(auth.expiresAt) <= now.getTime()) {
    throw new Error('STANDING_AUTH_INVALID_OR_EXPIRED: Active standing authorization is required.');
  }

  const parsed = parseBulkCampaignContacts({
    sourceType: 'google_sheets',
    fileName: `${monitor.spreadsheetName}.csv`,
    rawText: input.csvText,
    phoneDirectory: input.phoneDirectory
  });

  const activeQueueIds = getActiveQueueContactIds(campaign);
  const existingByPhone = new Map<string, BulkCampaignContactRecord>();
  for (const rec of campaign.contacts) {
    if (rec.contact.phoneE164) {
      existingByPhone.set(rec.contact.phoneE164, rec);
    }
  }

  const knownKeys = new Set<string>(monitor.knownRowKeys);
  let maxRow = monitor.lastCheckpointRowNumber;
  let previouslyProcessedCount = 0;
  const contactsToEvaluate: BulkCampaignImportedContact[] = [];

  for (const c of parsed.validContacts) {
    maxRow = Math.max(maxRow, c.rowNumber);
    const rowKey = computeStableSheetRowKey(monitor.spreadsheetId, monitor.tabName, c);
    knownKeys.add(rowKey);
    const existingRec = c.phoneE164 ? existingByPhone.get(c.phoneE164) : undefined;
    if (existingRec && isContactAlreadyProcessedOrSuppressed(existingRec, activeQueueIds)) {
      previouslyProcessedCount += 1;
      continue;
    }
    contactsToEvaluate.push({
      ...c,
      contactId: existingRec?.contact.contactId ?? c.contactId,
      sourceRowKey: rowKey,
      sheetRowNumber: c.rowNumber
    });
  }

  const evaluated = evaluateContactEligibility(
    contactsToEvaluate,
    new Set(contactsToEvaluate.map(c => c.contactId)),
    campaign.channels,
    campaign.limits,
    campaign.whatsappPlan.messagePreview,
    campaign.emailConnected,
    undefined,
    nowIso,
    campaign.emailPlan?.bodyPreview
  );

  // Merge evaluated contacts into campaign.contacts without duplicating existing phoneE164/contactId
  const evaluatedByPhone = new Map<string, BulkCampaignContactRecord>();
  const evaluatedById = new Map<string, BulkCampaignContactRecord>();
  for (const r of evaluated) {
    if (r.contact.phoneE164) evaluatedByPhone.set(r.contact.phoneE164, r);
    evaluatedById.set(r.contact.contactId, r);
  }
  const mergedContacts: BulkCampaignContactRecord[] = [];
  const includedIds = new Set<string>();
  for (const existingRec of campaign.contacts) {
    const replacement =
      (existingRec.contact.phoneE164 ? evaluatedByPhone.get(existingRec.contact.phoneE164) : undefined) ??
      evaluatedById.get(existingRec.contact.contactId);
    if (replacement && !isContactAlreadyProcessedOrSuppressed(existingRec, activeQueueIds)) {
      mergedContacts.push(replacement);
      includedIds.add(replacement.contact.contactId);
    } else {
      mergedContacts.push(existingRec);
      includedIds.add(existingRec.contact.contactId);
    }
  }
  for (const r of evaluated) {
    if (!includedIds.has(r.contact.contactId)) {
      mergedContacts.push(r);
      includedIds.add(r.contact.contactId);
    }
  }

  const eligibleBacklog = evaluated.filter(r => r.category === 'eligible');
  const blockedBacklog = evaluated.filter(r => r.category !== 'eligible');
  const existingDiscovered = parsed.validContacts.length;
  const newLeadsCount = monitor.newLeadsReceivedCount ?? 0;

  let nextCampaign: BulkCampaignState = {
    ...campaign,
    updatedAt: nowIso,
    contacts: mergedContacts,
    sheetMonitor: {
      ...monitor,
      processExistingBacklog: true,
      existingBacklogProcessed: true,
      existingBacklogApprovedAt: nowIso,
      backlogSkippedReason: null,
      status: monitor.status === 'paused' ? 'paused' : 'active_monitoring',
      lastSyncAt: nowIso,
      lastSyncError: null,
      lastCheckpointRowNumber: maxRow,
      baselineRowCount: existingDiscovered,
      knownRowKeys: [...knownKeys].slice(-5000),
      consecutiveErrors: 0,
      existingLeadsDiscoveredCount: existingDiscovered,
      newLeadsReceivedCount: newLeadsCount,
      leadsReceivedCount: existingDiscovered + newLeadsCount,
      leadsEligibleCount: (monitor.leadsEligibleCount ?? 0) + eligibleBacklog.length,
      leadsConsentBlockedCount: blockedBacklog.length,
      leadsQueuedCount: monitor.leadsQueuedCount ?? 0
    }
  };

  let batchSubmitted = false;
  let jobId: string | undefined;
  let offHoursDeferredCount = 0;
  let queuedCount = 0;
  let skippedReason: string | undefined;

  if (eligibleBacklog.length > 0 && monitor.status !== 'paused') {
    const primaryChannel: BulkCampaignN8nChannel | null = campaign.channels.includes('phone')
      ? 'phone_call'
      : campaign.channels.includes('whatsapp')
        ? 'whatsapp'
        : null;
    const eligibleIds = eligibleBacklog.map(r => r.contact.contactId);
    const pendingSet = new Set<string>(nextCampaign.sheetMonitor?.pendingDispatchContactIds ?? []);
    for (const id of eligibleIds) pendingSet.add(id);

    const phoneInWindow = isWithinIstCallingWindow(auth.callingHoursIst, now);
    const activeJob = primaryChannel ? getActiveN8nBatchChannelJob(nextCampaign, primaryChannel) : undefined;
    const remainingLimit = computeRemainingDailyLimit(nextCampaign, auth, now);

    if (primaryChannel === 'phone_call' && !phoneInWindow) {
      offHoursDeferredCount = eligibleIds.length;
      skippedReason = 'OFF_HOURS_DEFERRED';
      nextCampaign = {
        ...nextCampaign,
        sheetMonitor: {
          ...nextCampaign.sheetMonitor!,
          pendingDispatchContactIds: [...pendingSet]
        }
      };
    } else if (activeJob) {
      skippedReason = 'ACTIVE_BATCH_JOB_DEFERRED';
      nextCampaign = {
        ...nextCampaign,
        sheetMonitor: {
          ...nextCampaign.sheetMonitor!,
          status: 'processing_leads',
          pendingDispatchContactIds: [...pendingSet]
        }
      };
    } else if (remainingLimit <= 0) {
      skippedReason = 'DAILY_LIMIT_REACHED';
      nextCampaign = {
        ...nextCampaign,
        sheetMonitor: {
          ...nextCampaign.sheetMonitor!,
          pendingDispatchContactIds: [...pendingSet]
        }
      };
    } else if (primaryChannel && input.liveMultiContactEnabled) {
      const dispatchIds = [...pendingSet].slice(0, remainingLimit);
      const remainingPending = [...pendingSet].slice(remainingLimit);
      const dispatchCampaign: BulkCampaignState = {
        ...nextCampaign,
        standingAuthorization: { ...auth, approvedMaterialHash: nextCampaign.materialHash },
        approval: nextCampaign.approval
          ? { ...nextCampaign.approval, approvedMaterialHash: nextCampaign.materialHash }
          : undefined,
        sheetMonitor: {
          ...nextCampaign.sheetMonitor!,
          status: 'processing_leads',
          leadsQueuedCount: (nextCampaign.sheetMonitor?.leadsQueuedCount ?? 0) + dispatchIds.length,
          pendingDispatchContactIds: remainingPending
        }
      };
      const submitted = await submitBulkCampaignMultiContactN8nJob(dispatchCampaign, {
        scope: input.scope,
        channel: primaryChannel,
        liveMultiContactEnabled: input.liveMultiContactEnabled,
        phoneDirectory: input.phoneDirectory,
        n8nTrigger: input.n8nTrigger,
        onlyContactIds: dispatchIds,
        batchConfig: {
          batchSize: Math.min(100, dispatchIds.length),
          maxConcurrency: auth.maxConcurrency,
          rateLimitPerMinute: auth.rateLimitPerMinute,
          maxRetries: auth.retryOnNoAnswer ? Math.max(0, auth.maxAttemptsPerLead - 1) : 0
        }
      });
      nextCampaign = submitted.campaign;
      batchSubmitted = true;
      jobId = submitted.job.jobId;
      queuedCount = submitted.job.recipientQueue?.length ?? dispatchIds.length;
    } else {
      queuedCount = Math.min(eligibleIds.length, remainingLimit);
      nextCampaign = {
        ...nextCampaign,
        sheetMonitor: {
          ...nextCampaign.sheetMonitor!,
          leadsQueuedCount: (nextCampaign.sheetMonitor?.leadsQueuedCount ?? 0) + queuedCount,
          pendingDispatchContactIds: [...pendingSet]
        }
      };
    }
  }

  return {
    campaign: nextCampaign,
    totalExistingRows: parsed.totalRowsParsed,
    previouslyProcessedCount,
    eligibleCount: eligibleBacklog.length,
    consentBlockedCount: blockedBacklog.length,
    duplicatesCount: parsed.duplicates.length,
    queuedCount,
    offHoursDeferredCount,
    batchSubmitted,
    ...(jobId ? { jobId } : {}),
    ...(skippedReason ? { skippedReason } : {})
  };
}

/**
 * Incrementally synchronizes new rows from a campaign's connected Google Sheet and automatically
 * dispatches newly arrived eligible leads through the existing n8n batch pipeline (`ThaaraBulkCall01` / `ThaaraBulkWa0001`).
 */
export async function syncGoogleSheetLeadsForCampaign(
  campaign: BulkCampaignState,
  input: {
    scope: AuthenticatedScope;
    csvText: string;
    phoneDirectory?: PhoneContactView[];
    liveMultiContactEnabled?: boolean;
    n8nTrigger?: BulkCampaignN8nTrigger;
    now?: Date;
  }
): Promise<SyncGoogleSheetLeadsResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  if (campaign.mode !== 'automatic_lead_followup' || !campaign.sheetMonitor) {
    return { campaign, newRowsDetected: 0, newEligibleCount: 0, newBlockedCount: 0, offHoursDeferredCount: 0, batchSubmitted: false, skippedReason: 'NOT_AUTO_FOLLOWUP' };
  }
  const monitor = campaign.sheetMonitor;
  if (monitor.status === 'paused' || monitor.status === 'stopped') {
    return { campaign, newRowsDetected: 0, newEligibleCount: 0, newBlockedCount: 0, offHoursDeferredCount: 0, batchSubmitted: false, skippedReason: `MONITOR_${monitor.status.toUpperCase()}` };
  }
  const auth = campaign.standingAuthorization;
  if (!auth || auth.revoked || Date.parse(auth.expiresAt) <= now.getTime() || auth.approvedMaterialHash !== campaign.materialHash) {
    return { campaign, newRowsDetected: 0, newEligibleCount: 0, newBlockedCount: 0, offHoursDeferredCount: 0, batchSubmitted: false, skippedReason: 'STANDING_AUTH_INVALID_OR_EXPIRED' };
  }

  const parsed = parseBulkCampaignContacts({
    sourceType: 'google_sheets',
    fileName: `${monitor.spreadsheetName}.csv`,
    rawText: input.csvText,
    phoneDirectory: input.phoneDirectory
  });

  const knownKeys = new Set<string>(monitor.knownRowKeys);
  const existingPhones = new Set<string>(
    campaign.contacts.map(r => r.contact.phoneE164).filter((p): p is string => Boolean(p))
  );

  const brandNewContacts: BulkCampaignImportedContact[] = [];
  let maxRow = monitor.lastCheckpointRowNumber;
  for (const c of parsed.validContacts) {
    maxRow = Math.max(maxRow, c.rowNumber);
    const rowKey = computeStableSheetRowKey(monitor.spreadsheetId, monitor.tabName, c);
    if (knownKeys.has(rowKey) || (c.phoneE164 && existingPhones.has(c.phoneE164))) {
      knownKeys.add(rowKey);
      continue;
    }
    knownKeys.add(rowKey);
    if (c.phoneE164) existingPhones.add(c.phoneE164);
    brandNewContacts.push({
      ...c,
      sourceRowKey: rowKey,
      sheetRowNumber: c.rowNumber
    });
  }

  const newRecords: BulkCampaignContactRecord[] = brandNewContacts.length > 0
    ? evaluateContactEligibility(
        brandNewContacts,
        new Set(brandNewContacts.map(c => c.contactId)),
        campaign.channels,
        campaign.limits,
        campaign.whatsappPlan.messagePreview,
        campaign.emailConnected,
        undefined,
        nowIso,
        campaign.emailPlan?.bodyPreview
      )
    : [];

  const eligibleNew = newRecords.filter(r => r.category === 'eligible');
  const blockedNew = newRecords.filter(r => r.category !== 'eligible');
  const combinedContacts = brandNewContacts.length > 0 ? [...campaign.contacts, ...newRecords] : campaign.contacts;

  // Combine any deferred/pending contact IDs with newly arrived eligible leads (excluding already processed/in-flight)
  const activeQueueIds = getActiveQueueContactIds(campaign);
  const eligibleRecordById = new Map<string, BulkCampaignContactRecord>();
  for (const r of combinedContacts) {
    if (r.category === 'eligible' && !isContactAlreadyProcessedOrSuppressed(r, activeQueueIds)) {
      eligibleRecordById.set(r.contact.contactId, r);
    }
  }
  const pendingToDispatch = new Set<string>();
  for (const id of monitor.pendingDispatchContactIds ?? []) {
    if (eligibleRecordById.has(id)) pendingToDispatch.add(id);
  }
  for (const r of eligibleNew) {
    if (eligibleRecordById.has(r.contact.contactId)) pendingToDispatch.add(r.contact.contactId);
  }

  const primaryChannel: BulkCampaignN8nChannel | null = campaign.channels.includes('phone')
    ? 'phone_call'
    : campaign.channels.includes('whatsapp')
      ? 'whatsapp'
      : null;
  const activeBatchJob = primaryChannel ? getActiveN8nBatchChannelJob(campaign, primaryChannel) : undefined;

  const existingDiscovered = monitor.existingLeadsDiscoveredCount ?? 0;
  const nextNewLeadsCount = (monitor.newLeadsReceivedCount ?? 0) + brandNewContacts.length;

  let nextCampaign: BulkCampaignState = {
    ...campaign,
    updatedAt: nowIso,
    contacts: combinedContacts,
    sheetMonitor: {
      ...monitor,
      status: activeBatchJob ? 'processing_leads' : 'active_monitoring',
      lastSyncAt: nowIso,
      lastSyncError: null,
      lastCheckpointRowNumber: maxRow,
      knownRowKeys: [...knownKeys].slice(-5000),
      consecutiveErrors: 0,
      existingLeadsDiscoveredCount: existingDiscovered,
      newLeadsReceivedCount: nextNewLeadsCount,
      leadsReceivedCount: monitor.leadsReceivedCount + brandNewContacts.length,
      leadsEligibleCount: monitor.leadsEligibleCount + eligibleNew.length,
      leadsConsentBlockedCount: monitor.leadsConsentBlockedCount + blockedNew.length,
      pendingDispatchContactIds: [...pendingToDispatch]
    }
  };

  let batchSubmitted = false;
  let jobId: string | undefined;
  let offHoursDeferredCount = 0;
  let skippedReason: string | undefined;

  if (pendingToDispatch.size > 0) {
    const phoneInWindow = isWithinIstCallingWindow(auth.callingHoursIst, now);
    const remainingLimit = computeRemainingDailyLimit(nextCampaign, auth, now);

    if (primaryChannel === 'phone_call' && !phoneInWindow) {
      offHoursDeferredCount = pendingToDispatch.size;
      skippedReason = 'OFF_HOURS_DEFERRED';
    } else if (activeBatchJob) {
      skippedReason = 'ACTIVE_BATCH_JOB_DEFERRED';
    } else if (remainingLimit <= 0) {
      skippedReason = 'DAILY_LIMIT_REACHED';
    } else if (primaryChannel && input.liveMultiContactEnabled) {
      const dispatchIds = [...pendingToDispatch].slice(0, remainingLimit);
      const remainingPending = [...pendingToDispatch].slice(remainingLimit);
      const dispatchCampaign: BulkCampaignState = {
        ...nextCampaign,
        standingAuthorization: { ...auth, approvedMaterialHash: nextCampaign.materialHash },
        approval: nextCampaign.approval
          ? { ...nextCampaign.approval, approvedMaterialHash: nextCampaign.materialHash }
          : undefined,
        sheetMonitor: {
          ...nextCampaign.sheetMonitor!,
          status: 'processing_leads',
          leadsQueuedCount: nextCampaign.sheetMonitor!.leadsQueuedCount + dispatchIds.length,
          pendingDispatchContactIds: remainingPending
        }
      };
      const submitted = await submitBulkCampaignMultiContactN8nJob(dispatchCampaign, {
        scope: input.scope,
        channel: primaryChannel,
        liveMultiContactEnabled: input.liveMultiContactEnabled,
        phoneDirectory: input.phoneDirectory,
        n8nTrigger: input.n8nTrigger,
        onlyContactIds: dispatchIds,
        batchConfig: {
          batchSize: Math.min(100, dispatchIds.length),
          maxConcurrency: auth.maxConcurrency,
          rateLimitPerMinute: auth.rateLimitPerMinute,
          maxRetries: auth.retryOnNoAnswer ? Math.max(0, auth.maxAttemptsPerLead - 1) : 0
        }
      });
      nextCampaign = submitted.campaign;
      batchSubmitted = true;
      jobId = submitted.job.jobId;
    } else {
      // Offline / simulation mode without n8n dispatch: count eligible new leads as queued
      nextCampaign = {
        ...nextCampaign,
        sheetMonitor: {
          ...nextCampaign.sheetMonitor!,
          leadsQueuedCount: nextCampaign.sheetMonitor!.leadsQueuedCount + eligibleNew.length
        }
      };
    }
  }

  return {
    campaign: nextCampaign,
    newRowsDetected: brandNewContacts.length,
    newEligibleCount: eligibleNew.length,
    newBlockedCount: blockedNew.length,
    offHoursDeferredCount,
    batchSubmitted,
    ...(jobId ? { jobId } : {}),
    ...(skippedReason ? { skippedReason } : {})
  };
}

export function evaluateFollowUpPolicyForContact(
  campaign: BulkCampaignState,
  record: BulkCampaignContactRecord,
  now = new Date()
): {
  action: 'stop' | 'retry_scheduled' | 'human_followup' | 'none';
  scheduledFor?: string;
  reason?: string;
} {
  const auth = campaign.standingAuthorization;
  if (record.contact.optedOut || record.attendanceOutcome === 'declined' || record.attendanceOutcome === 'opted_out') {
    return { action: 'stop', reason: 'Recipient declined or opted out.' };
  }
  if (record.attendanceOutcome === 'callback_requested') {
    return {
      action: 'human_followup',
      scheduledFor: record.preferredCallbackTime ?? new Date(now.getTime() + 4 * 3_600_000).toISOString(),
      reason: 'Callback requested by recipient; scheduled without silent redialing.'
    };
  }
  if (record.attendanceOutcome === 'confirmed' || record.attendanceOutcome === 'interested') {
    return { action: 'human_followup', reason: 'Engaged lead ready for consultation follow-up.' };
  }
  if (
    (record.phoneStatus === 'not_answered' || record.attendanceOutcome === 'no_response' || record.attendanceOutcome === 'busy') &&
    auth?.retryOnNoAnswer &&
    (record.retryCount ?? 0) + 1 < auth.maxAttemptsPerLead
  ) {
    return {
      action: 'retry_scheduled',
      scheduledFor: new Date(now.getTime() + auth.retryDelayMinutes * 60_000).toISOString(),
      reason: 'No answer/busy retry permitted by standing follow-up policy.'
    };
  }
  return { action: 'none' };
}
