import { FastifyInstance } from 'fastify';
import type { AuthenticatedScope, TransactionalDbClient } from '@thaara/db';
import { ForbiddenError, ValidationError } from '@thaara/observability';
import {
  answerCampaignCustomerQuestion,
  approveAllCampaignPhoneDrafts,
  approveBulkCampaign,
  approveSingleCampaignPhoneDraft,
  buildBulkCampaignChatSummary,
  buildSavedContactsImportResult,
  BulkCampaignWorkspaceStore,
  cancelBulkCampaignN8nJob,
  categorizeBulkCampaignContacts,
  claimNextBatchContactForN8nJob,
  claimNextBulkCampaignN8nJob,
  completeBulkCampaignN8nJob,
  computeBulkCampaignMetrics,
  createBulkCampaignFromChatInput,
  createBulkCampaignLiveExecutionGrant,
  createBulkCampaignPlan,
  createDefaultBulkCampaignN8nTrigger,
  createScopedEmailCampaignAdapter,
  createScopedPhoneCampaignAdapter,
  createScopedWhatsAppCampaignAdapter,
  defaultBulkCampaignStore,
  DEFAULT_DEMO_PHONE_DIRECTORY,
  detectBulkCampaignChatCommand,
  detectBulkCampaignChatIntent,
  emergencyStopAllBulkCampaignN8nJobs,
  enrichOrUpgradeCampaignKnowledgeContext,
  executeBulkCampaign,
  executeBulkCampaignChatCommand,
  executeBulkCampaignN8nPhoneJob,
  executeBulkCampaignN8nWhatsAppJob,
  executeBulkCampaignPilotCall,
  exportBulkCampaignCsv,
  getBulkCampaignContactWhatsAppTranscript,
  getBulkCampaignWorkspaceContext,
  isCampaignAllowlistedForLive,
  isCampaignAuthorizedForLiveExecution,
  isChannelAllowlistedForLive,
  isInternalKnowledgeGovernanceText,
  listEligiblePilotContacts,
  listEligibleWhatsAppPilotContacts,
  MockBulkCampaignEmailAdapter,
  MockBulkCampaignPhoneAdapter,
  MockBulkCampaignWhatsAppAdapter,
  parseBulkCampaignContacts,
  pauseBulkCampaign,
  pauseBulkCampaignN8nJob,
  pollBulkCampaignN8nPhoneJob,
  pollBulkCampaignN8nWhatsAppJob,
  prepareBulkCampaignPilotCall,
  prepareCampaignPhoneDrafts,
  prepareSyntheticSimulationFromCampaign,
  reconcileBulkCampaignOutcomes,
  recordBatchContactOutcomeForN8nJob,
  refreshBulkCampaignPilotResult,
  rejectOrCancelBulkCampaign,
  resumeBulkCampaign,
  resumeBulkCampaignN8nJob,
  retryFailedBulkCampaignContacts,
  SARVAM_OUTBOUND_AGENT_LABEL,
  scheduleBulkCampaign,
  submitBulkCampaignMultiContactN8nJob,
  submitBulkCampaignN8nJob,
  verifyBulkCampaignN8nToken,
  type BulkCampaignN8nTrigger,
  stopBulkCampaign,
  SYNTHETIC_DEMO_CONTACTS_CSV,
  unsubscribeCampaignContact,
  updateBulkCampaignPlan,
  type BulkCampaignEmailAdapter,
  type BulkCampaignPhoneAdapter,
  type BulkCampaignState,
  type BulkCampaignWhatsAppAdapter
} from '../services/bulk-campaign.js';
import type {
  BulkCampaignChannel,
  BulkCampaignKnowledgeUploadInput,
  BulkCampaignLanguage,
  BulkCampaignSourceType
} from '@thaara/contracts';
import type { GmailFoundation } from '../services/gmail.js';
import type { GoogleDriveService } from '../services/google-drive.js';
import { queryCampaignKnowledge, verifyCampaignKnowledgeToken } from '../services/bulk-campaign-knowledge.js';
import {
  activateAutomaticLeadFollowup,
  configureAutomaticLeadFollowup,
  parseGoogleSheetUrl,
  pauseAutomaticLeadFollowup,
  previewExistingSheetBacklogForCampaign,
  processExistingSheetBacklogForCampaign,
  recordSheetSyncFailure,
  resumeAutomaticLeadFollowup,
  stopAutomaticLeadFollowup,
  syncGoogleSheetLeadsForCampaign
} from '../services/bulk-campaign-auto-followup.js';
import type { PhoneCallingService, PhoneContactDirectory } from '../services/phone-calling.js';
import { GoogleSheetsAccessError, GoogleSheetsConnectionsService } from '../services/google-sheets-connections.js';
import type { PhoneContactManagementService } from '../services/phone-contacts.js';
import type { DurableWhatsAppService } from '../services/whatsapp-durable.js';
import type { WhatsAppTemplateService } from '../services/whatsapp-templates.js';

export interface BulkCampaignRouteOptions {
  db?: TransactionalDbClient;
  whatsappAdapter?: BulkCampaignWhatsAppAdapter;
  phoneAdapter?: BulkCampaignPhoneAdapter;
  emailAdapter?: BulkCampaignEmailAdapter;
  store?: BulkCampaignWorkspaceStore;
  phoneCalling?: PhoneCallingService;
  phoneContacts?: PhoneContactManagementService;
  phoneFallbackDirectory?: PhoneContactDirectory;
  dailyPhoneCallLimit?: number;
  whatsappDurable?: DurableWhatsAppService;
  whatsappTemplates?: WhatsAppTemplateService;
  gmail?: GmailFoundation;
  googleDrive?: GoogleDriveService;
  googleSheetsConnections?: GoogleSheetsConnectionsService;
  n8nTrigger?: BulkCampaignN8nTrigger;
  n8nMachineToken?: string;
  allowBatchOfflineTest?: boolean;
}

function requireScope(request: { scope?: AuthenticatedScope }): AuthenticatedScope {
  if (!request.scope) throw new ForbiddenError('Authentication required.');
  return request.scope;
}

function isSyntheticDemoCampaign(campaign: BulkCampaignState | null | undefined): boolean {
  if (!campaign) return false;
  return campaign.contacts.some(
    c => Boolean(c.contact.phoneDirectoryContactId?.startsWith('pdir_') || c.contact.isSyntheticTestFixture)
  );
}

function maybeHydrateTruncatedDocAView(campaign: BulkCampaignState): BulkCampaignState {
  if (!campaign.knowledgeContext) return campaign;
  const hasDocA = campaign.knowledgeContext.files.some(
    f => f.status === 'processed' && /(?:document[_\s-]*a|quantum[_\s-]*weave)/i.test(f.fileName)
  );
  if (!hasDocA) return campaign;
  const nonMeta = campaign.knowledgeContext.chunks.filter(c => !isInternalKnowledgeGovernanceText(c.text));
  if (nonMeta.length >= 3) return campaign;
  const upgradedKb = enrichOrUpgradeCampaignKnowledgeContext({
    knowledgeContext: campaign.knowledgeContext,
    instruction: campaign.instruction,
    eventDetails: campaign.eventDetails,
    questions: campaign.callScript.questions
  });
  return {
    ...campaign,
    knowledgeContext: upgradedKb
  };
}

function formatCampaignEnvelope(
  campaign: BulkCampaignState,
  liveFlags?: { liveCallingEnabled?: boolean; liveSendingEnabled?: boolean; phoneDirectory?: any[] }
) {
  const hydrated = maybeHydrateTruncatedDocAView(campaign);
  const liveCallingEnabled = Boolean(liveFlags?.liveCallingEnabled ?? hydrated.liveCallingEnabled);
  const liveSendingEnabled = Boolean(liveFlags?.liveSendingEnabled ?? hydrated.liveSendingEnabled);
  const { n8nJobTokenHashes: _omittedHashes, ...safeCampaign } = hydrated;
  const enriched: BulkCampaignState = {
    ...safeCampaign,
    liveCallingEnabled,
    liveSendingEnabled
  };
  return {
    campaign: enriched,
    metrics: computeBulkCampaignMetrics(enriched),
    categories: categorizeBulkCampaignContacts(enriched),
    eligiblePilotContacts: listEligiblePilotContacts(enriched, liveFlags?.phoneDirectory ?? []),
    eligibleWhatsAppPilotContacts: listEligibleWhatsAppPilotContacts(enriched),
    chatSummary: buildBulkCampaignChatSummary(enriched),
    liveCallingEnabled,
    liveSendingEnabled
  };
}

export async function bulkCampaignRoutes(app: FastifyInstance, options: BulkCampaignRouteOptions = {}) {
  const workspaceStore = options.store ?? defaultBulkCampaignStore;
  if (options.db) {
    workspaceStore.bindDb(options.db);
  }
  const hasRealConnectors = Boolean(
    options.phoneCalling || options.phoneContacts || options.whatsappDurable || options.gmail
  );
  const staticWaAdapter = options.whatsappAdapter ?? new MockBulkCampaignWhatsAppAdapter();
  const staticPhoneAdapter = options.phoneAdapter ?? new MockBulkCampaignPhoneAdapter();
  const staticEmailAdapter = options.emailAdapter ?? new MockBulkCampaignEmailAdapter();
  const base = app.prefix.endsWith('/api/v1') ? '/campaigns/bulk' : '/api/v1/campaigns/bulk';
  const authGuard =
    typeof (app as { requireAuth?: unknown }).requireAuth === 'function'
      ? { preHandler: [app.requireAuth] }
      : {};

  async function resolveWorkspaceRuntime(scope: AuthenticatedScope, forDemo = false) {
    if (!hasRealConnectors) {
      const { contacts } = await staticPhoneAdapter.listDirectoryContacts();
      return {
        wsInfo: null,
        phoneAdapter: staticPhoneAdapter,
        waAdapter: staticWaAdapter,
        pilotWaAdapter: staticWaAdapter,
        emailAdapter: staticEmailAdapter,
        phoneDirectory: contacts,
        liveCallingEnabled: Boolean(staticPhoneAdapter.liveCallingEnabled),
        liveSendingEnabled: Boolean(staticWaAdapter.liveSendingEnabled),
        n8nLiveEnabled: process.env.THAARA_BULK_CAMPAIGN_N8N_LIVE_ENABLED === 'true'
      };
    }

    const wsInfo = await getBulkCampaignWorkspaceContext(scope, {
      db: options.db,
      phoneCalling: options.phoneCalling,
      phoneContacts: options.phoneContacts,
      phoneFallbackDirectory: options.phoneFallbackDirectory,
      dailyPhoneCallLimit: options.dailyPhoneCallLimit,
      whatsappDurable: options.whatsappDurable,
      whatsappTemplates: options.whatsappTemplates,
      gmail: options.gmail
    });

    const liveRolloutEnabled = process.env.THAARA_BULK_CAMPAIGN_LIVE_ENABLED === 'true';
    const effectiveLiveCalling =
      !forDemo && liveRolloutEnabled && isChannelAllowlistedForLive('phone_call') && wsInfo.context.liveCallingEnabled;
    const effectiveLiveSending =
      !forDemo && liveRolloutEnabled && isChannelAllowlistedForLive('whatsapp') && wsInfo.context.liveSendingEnabled;
    const effectiveLiveEmail =
      !forDemo && liveRolloutEnabled && isChannelAllowlistedForLive('email') && Boolean(wsInfo.context.emailSendReady);

    const phoneAdapter = options.phoneAdapter
      ? options.phoneAdapter
      : options.phoneCalling
        ? createScopedPhoneCampaignAdapter({
            scope,
            phoneCalling: options.phoneCalling,
            phoneContacts: options.phoneContacts,
            phoneFallbackDirectory: options.phoneFallbackDirectory,
            db: options.db,
            dailyCallLimit: wsInfo.context.dailyPhoneCallLimit,
            liveCallingEnabled: effectiveLiveCalling,
            useDemoFallbackWhenEmpty: forDemo
          })
        : staticPhoneAdapter;

    const waAdapter = options.whatsappAdapter
      ? options.whatsappAdapter
      : createScopedWhatsAppCampaignAdapter({
          scope,
          durableWhatsApp: effectiveLiveSending ? options.whatsappDurable : undefined,
          whatsappTemplates: effectiveLiveSending ? options.whatsappTemplates : undefined,
          db: options.db,
          liveSendingEnabled: effectiveLiveSending
        });

    const n8nLiveEnabled = !forDemo && process.env.THAARA_BULK_CAMPAIGN_N8N_LIVE_ENABLED === 'true';
    const pilotWaLiveSending = n8nLiveEnabled && wsInfo.context.liveSendingEnabled;
    const pilotWaAdapter = options.whatsappAdapter
      ? options.whatsappAdapter
      : createScopedWhatsAppCampaignAdapter({
          scope,
          durableWhatsApp: pilotWaLiveSending ? options.whatsappDurable : undefined,
          whatsappTemplates: pilotWaLiveSending ? options.whatsappTemplates : undefined,
          db: options.db,
          liveSendingEnabled: pilotWaLiveSending
        });

    const emailAdapter = options.emailAdapter
      ? options.emailAdapter
      : createScopedEmailCampaignAdapter({
          scope,
          gmail: effectiveLiveEmail ? options.gmail : undefined,
          db: options.db,
          liveSendingEnabled: effectiveLiveEmail
        });

    const phoneDirectory = forDemo
      ? DEFAULT_DEMO_PHONE_DIRECTORY
      : wsInfo.phoneContactsConfigured
        ? wsInfo.phoneDirectory
        : [];

    return {
      wsInfo,
      phoneAdapter,
      waAdapter,
      pilotWaAdapter,
      emailAdapter,
      phoneDirectory,
      liveCallingEnabled: effectiveLiveCalling,
      liveSendingEnabled: effectiveLiveSending,
      n8nLiveEnabled
    };
  }

  app.get(`${base}/context`, authGuard, async request => {
    const scope = requireScope(request);
    if (!hasRealConnectors) {
      const { contacts } = await staticPhoneAdapter.listDirectoryContacts();
      return {
        whatsappConnected: false,
        whatsappConnectionId: null,
        whatsappBusinessLabel: 'Quantum Weave AI (Simulation Mode)',
        liveSendingEnabled: Boolean(staticWaAdapter.liveSendingEnabled),
        optedInWhatsappContactsCount: 0,
        availableTemplates: [],
        phoneContactsConfigured: false,
        savedPhoneContactsCount: contacts.length,
        liveCallingEnabled: Boolean(staticPhoneAdapter.liveCallingEnabled),
        dailyPhoneCallLimit: staticPhoneAdapter.dailyCallLimit,
        emailConnected: false,
        connectedEmail: null,
        emailSendReady: false,
        sarvamOutboundAgentLabel: SARVAM_OUTBOUND_AGENT_LABEL
      };
    }
    const { wsInfo } = await resolveWorkspaceRuntime(scope, false);
    return wsInfo!.context;
  });

  app.get(base, authGuard, async request => {
    const scope = requireScope(request);
    const query = (request.query ?? {}) as { limit?: string; offset?: string };
    const rt = await resolveWorkspaceRuntime(scope, false);
    const list = await workspaceStore.listScoped(scope, options.db);
    const latest = list[list.length - 1] ?? null;
    const total = list.length;
    const parsedLimit = query.limit !== undefined ? Number(query.limit) : undefined;
    const parsedOffset = query.offset !== undefined ? Number(query.offset) : 0;
    const sliced =
      parsedLimit !== undefined && Number.isFinite(parsedLimit) && parsedLimit > 0
        ? list
            .slice()
            .sort((a, b) => (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0))
            .slice(Math.max(0, Number.isFinite(parsedOffset) ? parsedOffset : 0), Math.max(0, Number.isFinite(parsedOffset) ? parsedOffset : 0) + Math.min(100, parsedLimit))
        : list;
    if (hasRealConnectors) {
      for (let i = 0; i < sliced.length; i++) {
        const c = sliced[i]!;
        if (c.contacts.some(r => r.phoneStatus === 'attempted' && Boolean(r.phoneCallId && !r.phoneCallId.startsWith('sim_')))) {
          try {
            const rec = await reconcileBulkCampaignOutcomes(c, {
              scope,
              phoneCalling: options.phoneCalling,
              phoneAdapter: rt.phoneAdapter,
              whatsappDurable: options.whatsappDurable
            });
            sliced[i] = await workspaceStore.saveScoped(scope, rec, options.db);
          } catch {
            // Preserve stored campaign if reconciliation fails
          }
        }
      }
    }
    const liveFlags = {
      liveCallingEnabled: rt.liveCallingEnabled,
      liveSendingEnabled: rt.liveSendingEnabled,
      phoneDirectory: rt.phoneDirectory
    };
    return {
      campaigns: sliced.map(c =>
        formatCampaignEnvelope(c, isSyntheticDemoCampaign(c) ? { liveCallingEnabled: false, liveSendingEnabled: false } : liveFlags)
      ),
      total,
      latest: latest
        ? formatCampaignEnvelope(
            latest,
            isSyntheticDemoCampaign(latest) ? { liveCallingEnabled: false, liveSendingEnabled: false } : liveFlags
          )
        : null,
      liveCallingEnabled: rt.liveCallingEnabled,
      liveSendingEnabled: rt.liveSendingEnabled,
      ...(rt.wsInfo ? { context: rt.wsInfo.context } : {})
    };
  });

  app.get(`${base}/:campaignId`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    let existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const isDemo = isSyntheticDemoCampaign(existing);
    const rt = await resolveWorkspaceRuntime(scope, isDemo);
    const hasBatchOrLiveCalls =
      existing.executionMode === 'live' ||
      (existing.n8nJobs ?? []).some(j => j.mode === 'multi_contact_batch') ||
      existing.contacts.some(c => Boolean(c.phoneCallId && !c.phoneCallId.startsWith('sim_')));
    if (hasBatchOrLiveCalls && hasRealConnectors) {
      try {
        existing = await reconcileBulkCampaignOutcomes(existing, {
          scope,
          phoneCalling: options.phoneCalling,
          phoneAdapter: rt.phoneAdapter,
          whatsappDurable: options.whatsappDurable,
          refreshProviderResults: existing.contacts.some(
            c => c.phoneStatus === 'attempted' && Boolean(c.phoneCallId && !c.phoneCallId.startsWith('sim_'))
          )
        });
        existing = await workspaceStore.saveScoped(scope, existing, options.db);
      } catch {
        // Return stored state if live reconciliation fails
      }
    }
    return formatCampaignEnvelope(existing, {
      liveCallingEnabled: rt.liveCallingEnabled,
      liveSendingEnabled: rt.liveSendingEnabled,
      phoneDirectory: rt.phoneDirectory
    });
  });

  app.get(`${base}/:campaignId/contacts/:contactId/whatsapp-transcript`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId, contactId } = request.params as { campaignId: string; contactId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    try {
      return await getBulkCampaignContactWhatsAppTranscript(existing, contactId, {
        scope,
        whatsappDurable: options.whatsappDurable
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  const uploadRouteOpts = {
    ...authGuard,
    bodyLimit: 12 * 1024 * 1024
  };

  app.post(`${base}/import-preview`, uploadRouteOpts, async request => {
    const scope = requireScope(request);
    if (scope.role === 'viewer') throw new ForbiddenError('Viewers cannot import campaign contacts.');
    const body = (request.body ?? {}) as {
      sourceType?: BulkCampaignSourceType;
      fileName?: string;
      rawText?: string;
      fileBase64?: string;
      useSyntheticDemo?: boolean;
    };
    const rt = await resolveWorkspaceRuntime(scope, Boolean(body.useSyntheticDemo));
    const rawText = body.useSyntheticDemo ? SYNTHETIC_DEMO_CONTACTS_CSV : (body.rawText ?? '');
    const sourceType: BulkCampaignSourceType = body.sourceType ?? 'csv';
    try {
      return parseBulkCampaignContacts({
        sourceType,
        ...(body.fileName ? { fileName: body.fileName } : {}),
        rawText,
        ...(body.fileBase64 ? { fileBase64: body.fileBase64 } : {}),
        phoneDirectory: rt.phoneDirectory,
        ...(rt.wsInfo?.whatsappDirectory ? { whatsappDirectory: rt.wsInfo.whatsappDirectory } : {})
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.get(`${base}/saved-contacts`, authGuard, async request => {
    const scope = requireScope(request);
    const rt = await resolveWorkspaceRuntime(scope, false);
    return {
      contacts: rt.phoneDirectory.map(c => ({
        contactId: c.contactId,
        name: c.displayName,
        maskedPhone: c.maskedPhone,
        callingAllowed: Boolean(c.consent.callingAllowed && !c.consent.expired && !c.archived),
        expired: Boolean(c.consent.expired),
        archived: Boolean(c.archived),
        consentSource: c.consent.source
      }))
    };
  });

  app.post(`${base}/import-saved-contacts`, uploadRouteOpts, async request => {
    const scope = requireScope(request);
    if (scope.role === 'viewer') throw new ForbiddenError('Viewers cannot import campaign contacts.');
    const body = (request.body ?? {}) as {
      instruction?: string;
      channels?: BulkCampaignChannel[];
      knowledgeFiles?: BulkCampaignKnowledgeUploadInput[];
      selectedContactIds?: string[];
    };
    const rt = await resolveWorkspaceRuntime(scope, false);
    const approvedTemplate = rt.wsInfo?.context.availableTemplates.find(t => t.usableForCampaign);
    try {
      let targetPhoneDirectory = rt.phoneDirectory;
      if (Array.isArray(body.selectedContactIds)) {
        const selectedSet = new Set(body.selectedContactIds.map(id => String(id).trim()).filter(Boolean));
        if (selectedSet.size === 0) {
          throw new ValidationError('Select at least one saved contact before creating the campaign.');
        }
        targetPhoneDirectory = rt.phoneDirectory.filter(c => selectedSet.has(c.contactId));
        if (targetPhoneDirectory.length === 0) {
          throw new ValidationError('None of the selected saved contacts were found in the Phone Directory.');
        }
      }
      const importResult = buildSavedContactsImportResult({
        phoneDirectory: targetPhoneDirectory,
        ...(rt.wsInfo?.whatsappDirectory && !Array.isArray(body.selectedContactIds)
          ? { whatsappDirectory: rt.wsInfo.whatsappDirectory }
          : {})
      });
      const plan = createBulkCampaignPlan({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        instruction: body.instruction ?? '',
        importResult,
        ...(body.channels && body.channels.length > 0 ? { channels: body.channels } : {}),
        ...(body.knowledgeFiles && body.knowledgeFiles.length > 0 ? { knowledgeFiles: body.knowledgeFiles } : {}),
        ...(rt.wsInfo?.context.whatsappConnectionId
          ? {
              whatsappConnectionId: rt.wsInfo.context.whatsappConnectionId,
              whatsappBusinessLabel: rt.wsInfo.context.whatsappBusinessLabel
            }
          : {}),
        ...(approvedTemplate
          ? {
              whatsappTemplateName: approvedTemplate.name,
              whatsappTemplateLanguage: approvedTemplate.language,
              whatsappTemplatePreview: approvedTemplate.bodyText
            }
          : {}),
        ...(rt.wsInfo
          ? {
              emailConnected: rt.wsInfo.context.emailConnected,
              liveCallingEnabled: rt.liveCallingEnabled,
              liveSendingEnabled: rt.liveSendingEnabled,
              limits: { dailyPhoneCallLimit: rt.wsInfo.context.dailyPhoneCallLimit }
            }
          : {})
      });
      const saved = await workspaceStore.saveScoped(scope, plan, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/chat-create`, uploadRouteOpts, async request => {
    const scope = requireScope(request);
    if (scope.role === 'viewer') throw new ForbiddenError('Viewers cannot create bulk campaigns.');
    const body = (request.body ?? {}) as {
      chatMessage?: string;
      useSyntheticDemo?: boolean;
      channels?: BulkCampaignChannel[];
      knowledgeFiles?: BulkCampaignKnowledgeUploadInput[];
      uploadedFile?: {
        sourceType: BulkCampaignSourceType;
        fileName?: string;
        rawText: string;
        fileBase64?: string;
      };
    };
    const rt = await resolveWorkspaceRuntime(scope, Boolean(body.useSyntheticDemo));
    const approvedTemplate = rt.wsInfo?.context.availableTemplates.find(t => t.usableForCampaign);
    try {
      const existing = await workspaceStore.getLatestScoped(scope, options.db);
      const { campaign } = createBulkCampaignFromChatInput({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        chatMessage: body.chatMessage ?? '',
        ...(body.channels && body.channels.length > 0 ? { channels: body.channels } : {}),
        ...(body.knowledgeFiles && body.knowledgeFiles.length > 0 ? { knowledgeFiles: body.knowledgeFiles } : {}),
        ...(body.uploadedFile
          ? { uploadedFile: body.uploadedFile }
          : body.useSyntheticDemo
            ? {
                uploadedFile: {
                  sourceType: 'csv',
                  fileName: 'synthetic-demo-contacts.csv',
                  rawText: SYNTHETIC_DEMO_CONTACTS_CSV
                }
              }
            : {}),
        ...(existing && !body.uploadedFile && !body.useSyntheticDemo ? { existingCampaign: existing } : {}),
        phoneDirectory: rt.phoneDirectory,
        ...(rt.wsInfo?.whatsappDirectory ? { whatsappDirectory: rt.wsInfo.whatsappDirectory } : {}),
        ...(rt.wsInfo?.context.whatsappConnectionId
          ? {
              whatsappConnectionId: rt.wsInfo.context.whatsappConnectionId,
              whatsappBusinessLabel: rt.wsInfo.context.whatsappBusinessLabel
            }
          : {}),
        ...(approvedTemplate
          ? {
              whatsappTemplateName: approvedTemplate.name,
              whatsappTemplateLanguage: approvedTemplate.language,
              whatsappTemplatePreview: approvedTemplate.bodyText
            }
          : {}),
        ...(rt.wsInfo
          ? {
              emailConnected: rt.wsInfo.context.emailConnected,
              liveCallingEnabled: rt.liveCallingEnabled,
              liveSendingEnabled: rt.liveSendingEnabled,
              dailyPhoneCallLimit: rt.wsInfo.context.dailyPhoneCallLimit
            }
          : {})
      });
      const saved = await workspaceStore.saveScoped(scope, campaign, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/plan`, uploadRouteOpts, async request => {
    const scope = requireScope(request);
    if (scope.role === 'viewer') throw new ForbiddenError('Viewers cannot create bulk campaigns.');
    const body = (request.body ?? {}) as {
      instruction?: string;
      sourceType?: BulkCampaignSourceType;
      fileName?: string;
      rawText?: string;
      fileBase64?: string;
      useSyntheticDemo?: boolean;
      channels?: BulkCampaignChannel[];
      knowledgeFiles?: BulkCampaignKnowledgeUploadInput[];
    };
    const rt = await resolveWorkspaceRuntime(scope, Boolean(body.useSyntheticDemo));
    const approvedTemplate = rt.wsInfo?.context.availableTemplates.find(t => t.usableForCampaign);
    try {
      const importResult = parseBulkCampaignContacts({
        sourceType: body.sourceType ?? 'csv',
        ...(body.fileName ? { fileName: body.fileName } : {}),
        rawText: body.useSyntheticDemo ? SYNTHETIC_DEMO_CONTACTS_CSV : (body.rawText ?? ''),
        ...(body.fileBase64 && !body.useSyntheticDemo ? { fileBase64: body.fileBase64 } : {}),
        phoneDirectory: rt.phoneDirectory,
        ...(rt.wsInfo?.whatsappDirectory ? { whatsappDirectory: rt.wsInfo.whatsappDirectory } : {})
      });
      const plan = createBulkCampaignPlan({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        instruction: body.instruction ?? '',
        importResult,
        ...(body.channels && body.channels.length > 0 ? { channels: body.channels } : {}),
        ...(body.knowledgeFiles && body.knowledgeFiles.length > 0 ? { knowledgeFiles: body.knowledgeFiles } : {}),
        ...(rt.wsInfo?.context.whatsappConnectionId
          ? {
              whatsappConnectionId: rt.wsInfo.context.whatsappConnectionId,
              whatsappBusinessLabel: rt.wsInfo.context.whatsappBusinessLabel
            }
          : {}),
        ...(approvedTemplate
          ? {
              whatsappTemplateName: approvedTemplate.name,
              whatsappTemplateLanguage: approvedTemplate.language,
              whatsappTemplatePreview: approvedTemplate.bodyText
            }
          : {}),
        ...(rt.wsInfo
          ? {
              emailConnected: rt.wsInfo.context.emailConnected,
              liveCallingEnabled: rt.liveCallingEnabled,
              liveSendingEnabled: rt.liveSendingEnabled,
              limits: { dailyPhoneCallLimit: rt.wsInfo.context.dailyPhoneCallLimit }
            }
          : {})
      });
      const saved = await workspaceStore.saveScoped(scope, plan, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.patch(`${base}/:campaignId`, uploadRouteOpts, async request => {
    const scope = requireScope(request);
    if (scope.role === 'viewer') throw new ForbiddenError('Viewers cannot edit bulk campaigns.');
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, isSyntheticDemoCampaign(existing));
    try {
      const updated = updateBulkCampaignPlan(existing, (request.body ?? {}) as any);
      const saved = await workspaceStore.saveScoped(scope, updated, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/ask-question`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as { question?: string };
    const question = (body.question ?? '').trim();
    if (!question) throw new ValidationError('A customer question is required.');
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const hydrated = maybeHydrateTruncatedDocAView(existing);
    const qa = answerCampaignCustomerQuestion({
      question,
      knowledgeContext: hydrated.knowledgeContext,
      eventDetails: hydrated.eventDetails
    });
    return {
      campaignId: existing.campaignId,
      qa
    };
  });

  app.post(`${base}/:campaignId/prepare-synthetic-simulation`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role === 'viewer') {
      throw new ForbiddenError('Viewers cannot prepare campaign simulations.');
    }
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as { instruction?: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    try {
      // Original campaign and its real uploaded contacts remain 100% untouched!
      const isolatedSim = await prepareSyntheticSimulationFromCampaign(existing, {
        userId: scope.userId,
        ...(body.instruction ? { instruction: body.instruction } : {})
      });
      const saved = await workspaceStore.saveScoped(scope, isolatedSim, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: false,
        liveSendingEnabled: false
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/phone-drafts/prepare`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role === 'viewer') throw new ForbiddenError('Viewers cannot prepare phone call drafts.');
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, isSyntheticDemoCampaign(existing));
    try {
      const withDrafts = await prepareCampaignPhoneDrafts(existing, rt.phoneAdapter);
      const saved = await workspaceStore.saveScoped(scope, withDrafts, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/phone-drafts/approve-all`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, isSyntheticDemoCampaign(existing));
    try {
      const approvedAll = await approveAllCampaignPhoneDrafts(existing, rt.phoneAdapter, {
        userId: scope.userId,
        role: scope.role
      });
      const saved = await workspaceStore.saveScoped(scope, approvedAll, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      if (scope.role !== 'owner' && scope.role !== 'admin') {
        throw new ForbiddenError((error as Error).message);
      }
      throw new ValidationError((error as Error).message);
    }
  });


  app.post(`${base}/:campaignId/phone-drafts/:approvalId/approve`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId, approvalId } = request.params as { campaignId: string; approvalId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, isSyntheticDemoCampaign(existing));
    try {
      const approved = await approveSingleCampaignPhoneDraft(existing, rt.phoneAdapter, {
        approvalId,
        userId: scope.userId,
        role: scope.role
      });
      const saved = await workspaceStore.saveScoped(scope, approved, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      if (scope.role !== 'owner' && scope.role !== 'admin') {
        throw new ForbiddenError((error as Error).message);
      }
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/approve-and-start`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner') {
      throw new ForbiddenError('Only workspace owners can approve and start campaigns.');
    }
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as { expectedMaterialHash?: string; mode?: 'live' | 'simulation' };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const expectedHash = (body.expectedMaterialHash ?? '').trim();
    if (!expectedHash) {
      throw new ValidationError('expectedMaterialHash is required to approve and start this campaign.');
    }
    if (existing.materialHash !== expectedHash) {
      throw new ValidationError(
        'Campaign details changed after review. Please review the updated campaign before approving.'
      );
    }

    const isDemo = isSyntheticDemoCampaign(existing);
    const rt = await resolveWorkspaceRuntime(scope, isDemo);
    const requestedMode: 'live' | 'simulation' = body.mode === 'live' ? 'live' : 'simulation';

    const hasActiveOrDoneBatchJob = (existing.n8nJobs ?? []).some(
      j =>
        j.mode === 'multi_contact_batch' &&
        (j.status === 'queued' || j.status === 'running' || j.status === 'paused' || j.status === 'completed')
    );

    if (
      existing.approval?.approvedMaterialHash === expectedHash &&
      (existing.status === 'running' || existing.status === 'completed' || hasActiveOrDoneBatchJob)
    ) {
      return {
        ok: true,
        idempotentReuse: true,
        approved: true,
        executionStarted: true,
        mode: existing.executionMode === 'live' ? 'live' : 'simulation',
        campaign: formatCampaignEnvelope(existing, {
          liveCallingEnabled: rt.liveCallingEnabled,
          liveSendingEnabled: rt.liveSendingEnabled,
          phoneDirectory: rt.phoneDirectory
        })
      };
    }

    let approvedState = existing;
    if (
      existing.status === 'draft' ||
      existing.status === 'draft_requires_reapproval' ||
      existing.approval?.approvedMaterialHash !== expectedHash
    ) {
      try {
        const nextApproved = approveBulkCampaign(existing, {
          userId: scope.userId,
          role: scope.role,
          expectedMaterialHash: expectedHash
        });
        approvedState = await workspaceStore.saveScoped(scope, nextApproved, options.db);
      } catch (error) {
        throw new ValidationError((error as Error).message);
      }
    }

    if (requestedMode === 'simulation') {
      try {
        const executed = await executeBulkCampaign(approvedState, {
          mode: 'simulation',
          phone: rt.phoneAdapter,
          whatsapp: rt.waAdapter,
          email: rt.emailAdapter
        });
        const saved = await workspaceStore.saveScoped(scope, executed, options.db);
        return {
          ok: true,
          approved: true,
          executionStarted: true,
          mode: 'simulation',
          campaign: formatCampaignEnvelope(saved, {
            liveCallingEnabled: rt.liveCallingEnabled,
            liveSendingEnabled: rt.liveSendingEnabled,
            phoneDirectory: rt.phoneDirectory
          })
        };
      } catch (error) {
        return {
          ok: false,
          approved: true,
          executionStarted: false,
          mode: 'simulation',
          error: (error as Error).message,
          campaign: formatCampaignEnvelope(approvedState, {
            liveCallingEnabled: rt.liveCallingEnabled,
            liveSendingEnabled: rt.liveSendingEnabled,
            phoneDirectory: rt.phoneDirectory
          })
        };
      }
    }

    // Live execution path (strictly gated by THAARA_BULK_CAMPAIGN_LIVE_ENABLED + allowlists)
    if (isDemo) {
      throw new ForbiddenError('Synthetic demo campaigns cannot be dispatched to live workflows.');
    }
    const liveMultiEnabled =
      process.env.THAARA_BULK_CAMPAIGN_LIVE_ENABLED === 'true' || Boolean(options.allowBatchOfflineTest);
    if (!liveMultiEnabled) {
      return {
        ok: false,
        approved: true,
        executionStarted: false,
        mode: 'live',
        error: 'Live calling is currently unavailable.',
        campaign: formatCampaignEnvelope(approvedState, {
          liveCallingEnabled: rt.liveCallingEnabled,
          liveSendingEnabled: rt.liveSendingEnabled,
          phoneDirectory: rt.phoneDirectory
        })
      };
    }

    // Issue narrowly-scoped persisted live execution grant bound to this exact owner, workspace, campaign, material hash, contacts, and limits
    if (!approvedState.liveExecutionGrant || approvedState.liveExecutionGrant.approvedMaterialHash !== approvedState.materialHash) {
      const grant = createBulkCampaignLiveExecutionGrant(approvedState, scope);
      approvedState = await workspaceStore.saveScoped(
        scope,
        { ...approvedState, liveExecutionGrant: grant },
        options.db
      );
    }

    const authCheck = isCampaignAuthorizedForLiveExecution(approvedState, scope);
    if (!authCheck.authorized) {
      return {
        ok: false,
        approved: true,
        executionStarted: false,
        mode: 'live',
        error: authCheck.reason ?? `Campaign "${approvedState.campaignId}" is not enabled for live execution.`,
        campaign: formatCampaignEnvelope(approvedState, {
          liveCallingEnabled: rt.liveCallingEnabled,
          liveSendingEnabled: rt.liveSendingEnabled,
          phoneDirectory: rt.phoneDirectory
        })
      };
    }

    const n8nChannels: Array<'phone_call' | 'whatsapp'> = [];
    if (approvedState.channels.includes('phone') && isChannelAllowlistedForLive('phone_call')) {
      n8nChannels.push('phone_call');
    }
    if (approvedState.channels.includes('whatsapp') && isChannelAllowlistedForLive('whatsapp')) {
      n8nChannels.push('whatsapp');
    }
    if (n8nChannels.length === 0) {
      return {
        ok: false,
        approved: true,
        executionStarted: false,
        mode: 'live',
        error: 'No live communication channel is currently enabled for this campaign.',
        campaign: formatCampaignEnvelope(approvedState, {
          liveCallingEnabled: rt.liveCallingEnabled,
          liveSendingEnabled: rt.liveSendingEnabled,
          phoneDirectory: rt.phoneDirectory
        })
      };
    }

    const authoritativePhoneDirectory =
      hasRealConnectors || Boolean(options.phoneFallbackDirectory) ? rt.phoneDirectory : undefined;
    let current = approvedState;
    const submittedJobs: unknown[] = [];
    try {
      for (const ch of n8nChannels) {
        const alreadySubmitted = (current.n8nJobs ?? []).some(
          j =>
            j.mode === 'multi_contact_batch' &&
            j.channel === ch &&
            (j.status === 'queued' || j.status === 'running' || j.status === 'paused' || j.status === 'completed')
        );
        if (alreadySubmitted) continue;
        const result = await submitBulkCampaignMultiContactN8nJob(current, {
          scope,
          channel: ch,
          batchConfig: { maxRetries: 0 },
          liveMultiContactEnabled: liveMultiEnabled,
          ...(authoritativePhoneDirectory !== undefined ? { phoneDirectory: authoritativePhoneDirectory } : {}),
          n8nTrigger
        });
        current = await workspaceStore.saveScoped(scope, result.campaign, options.db);
        submittedJobs.push(result.job);
      }
      return {
        ok: true,
        approved: true,
        executionStarted: true,
        mode: 'live',
        jobs: submittedJobs,
        campaign: formatCampaignEnvelope(current, {
          liveCallingEnabled: rt.liveCallingEnabled,
          liveSendingEnabled: rt.liveSendingEnabled,
          phoneDirectory: rt.phoneDirectory
        })
      };
    } catch (error) {
      return {
        ok: false,
        approved: true,
        executionStarted: false,
        mode: 'live',
        error: (error as Error).message,
        campaign: formatCampaignEnvelope(current, {
          liveCallingEnabled: rt.liveCallingEnabled,
          liveSendingEnabled: rt.liveSendingEnabled,
          phoneDirectory: rt.phoneDirectory
        })
      };
    }
  });

  app.post(`${base}/:campaignId/approve`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as { expectedMaterialHash?: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, isSyntheticDemoCampaign(existing));
    try {
      const approved = approveBulkCampaign(existing, {
        userId: scope.userId,
        role: scope.role,
        expectedMaterialHash: body.expectedMaterialHash ?? ''
      });
      const saved = await workspaceStore.saveScoped(scope, approved, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      if (scope.role !== 'owner' && scope.role !== 'admin') {
        throw new ForbiddenError((error as Error).message);
      }
      throw new ValidationError((error as Error).message);
    }
  });


  app.post(`${base}/:campaignId/schedule`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as { scheduleAt?: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, isSyntheticDemoCampaign(existing));
    try {
      const scheduled = scheduleBulkCampaign(existing, {
        scheduleAt: body.scheduleAt ?? '',
        userId: scope.userId,
        role: scope.role
      });
      const saved = await workspaceStore.saveScoped(scope, scheduled, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      if (scope.role !== 'owner' && scope.role !== 'admin') {
        throw new ForbiddenError((error as Error).message);
      }
      throw new ValidationError((error as Error).message);
    }
  });


  app.post(`${base}/:campaignId/execute`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner' && scope.role !== 'admin') {
      throw new ForbiddenError('Only owner or admin can execute an approved bulk campaign.');
    }
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as { mode?: 'simulation' | 'live'; batchSize?: number };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const isDemo = isSyntheticDemoCampaign(existing);
    const requestedMode = body.mode === 'live' ? 'live' : 'simulation';
    if (requestedMode === 'live' && isDemo) {
      throw new ValidationError(
        'LIVE_COMMUNICATIONS_DISABLED: Synthetic sample demo contacts can only run in simulation mode. Upload or select real authorized contacts for live campaigns.'
      );
    }
    if (requestedMode === 'live' && !isCampaignAllowlistedForLive(existing.campaignId)) {
      throw new ValidationError(
        `LIVE_CAMPAIGN_NOT_ALLOWLISTED: Campaign "${existing.campaignId}" is not in THAARA_BULK_CAMPAIGN_LIVE_ALLOW_CAMPAIGN_IDS.`
      );
    }
    const rt = await resolveWorkspaceRuntime(scope, isDemo);
    try {
      const completed = await executeBulkCampaign(existing, {
        whatsapp: rt.waAdapter,
        phone: rt.phoneAdapter,
        email: rt.emailAdapter,
        mode: requestedMode,
        ...(body.batchSize !== undefined ? { batchSize: body.batchSize } : {})
      });
      const saved = await workspaceStore.saveScoped(scope, completed, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/pilot/prepare`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner') {
      throw new ForbiddenError('Only the workspace owner can prepare a single-call pilot.');
    }
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as { contactId?: string; language?: 'en-IN' | 'kn-IN' | 'kn-en' };
    if (!body.contactId || typeof body.contactId !== 'string') {
      throw new ValidationError('Select exactly one authorized contact for the pilot call.');
    }
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, false);
    try {
      const prepared = await prepareBulkCampaignPilotCall(existing, rt.phoneAdapter, {
        userId: scope.userId,
        role: scope.role,
        phoneDirectory: rt.phoneDirectory,
        contactId: body.contactId,
        ...(body.language ? { language: body.language } : {})
      });
      const saved = await workspaceStore.saveScoped(scope, prepared, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled,
        phoneDirectory: rt.phoneDirectory
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/pilot/execute`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner') {
      throw new ForbiddenError('Only the workspace owner can approve and place a pilot call.');
    }
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as { approvalId?: string };
    if (!body.approvalId || typeof body.approvalId !== 'string') {
      throw new ValidationError('Explicit pilot approvalId is required.');
    }
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, false);
    try {
      const executed = await executeBulkCampaignPilotCall(existing, rt.phoneAdapter, {
        userId: scope.userId,
        role: scope.role,
        approvalId: body.approvalId
      });
      const saved = await workspaceStore.saveScoped(scope, executed, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled,
        phoneDirectory: rt.phoneDirectory
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/pilot/refresh`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, false);
    try {
      const refreshed = await refreshBulkCampaignPilotResult(existing, rt.phoneAdapter);
      const saved = await workspaceStore.saveScoped(scope, refreshed, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled,
        phoneDirectory: rt.phoneDirectory
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/retry-failed`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner' && scope.role !== 'admin') {
      throw new ForbiddenError('Only owner or admin can retry failed campaign contacts.');
    }
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as { mode?: 'simulation' | 'live' };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const isDemo = isSyntheticDemoCampaign(existing);
    const rt = await resolveWorkspaceRuntime(scope, isDemo);
    try {
      const retried = await retryFailedBulkCampaignContacts(existing, {
        whatsapp: rt.waAdapter,
        phone: rt.phoneAdapter,
        email: rt.emailAdapter,
        ...(body.mode ? { mode: body.mode } : {})
      });
      const saved = await workspaceStore.saveScoped(scope, retried, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/pause`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role === 'viewer') throw new ForbiddenError('Viewers cannot pause bulk campaigns.');
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, isSyntheticDemoCampaign(existing));
    try {
      const paused = pauseBulkCampaign(existing);
      const saved = await workspaceStore.saveScoped(scope, paused, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/resume`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role === 'viewer') throw new ForbiddenError('Viewers cannot resume bulk campaigns.');
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, isSyntheticDemoCampaign(existing));
    try {
      const resumed = resumeBulkCampaign(existing);
      const saved = await workspaceStore.saveScoped(scope, resumed, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/contacts/:contactId/unsubscribe`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role === 'viewer') throw new ForbiddenError('Viewers cannot modify campaign contacts.');
    const { campaignId, contactId } = request.params as { campaignId: string; contactId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, isSyntheticDemoCampaign(existing));
    try {
      const updated = unsubscribeCampaignContact(existing, contactId);
      const saved = await workspaceStore.saveScoped(scope, updated, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/reconcile`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as { refreshProviderResults?: boolean };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, isSyntheticDemoCampaign(existing));
    try {
      const reconciled = await reconcileBulkCampaignOutcomes(existing, {
        scope,
        phoneCalling: options.phoneCalling,
        phoneAdapter: rt.phoneAdapter,
        whatsappDurable: options.whatsappDurable,
        refreshProviderResults: Boolean(body.refreshProviderResults)
      });
      const saved = await workspaceStore.saveScoped(scope, reconciled, options.db);
      return formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      });
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/stop`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role === 'viewer') throw new ForbiddenError('Viewers cannot stop bulk campaigns.');
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, isSyntheticDemoCampaign(existing));
    const stopped = stopBulkCampaign(existing);
    const saved = await workspaceStore.saveScoped(scope, stopped, options.db);
    return formatCampaignEnvelope(saved, {
      liveCallingEnabled: rt.liveCallingEnabled,
      liveSendingEnabled: rt.liveSendingEnabled
    });
  });

  app.post(`${base}/:campaignId/cancel`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role === 'viewer') throw new ForbiddenError('Viewers cannot cancel bulk campaigns.');
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, isSyntheticDemoCampaign(existing));
    const cancelled = rejectOrCancelBulkCampaign(existing);
    const saved = await workspaceStore.saveScoped(scope, cancelled, options.db);
    return formatCampaignEnvelope(saved, {
      liveCallingEnabled: rt.liveCallingEnabled,
      liveSendingEnabled: rt.liveSendingEnabled
    });
  });

  app.get(`${base}/:campaignId/export.csv`, authGuard, async (request, reply) => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    reply.header('content-type', 'text/csv; charset=utf-8');
    return exportBulkCampaignCsv(existing);
  });

  app.post(`${base}/chat-command`, authGuard, async request => {
    const scope = requireScope(request);
    const body = (request.body ?? {}) as { message?: string; campaignId?: string };
    const rawMsg = body.message ?? '';
    const rt = await resolveWorkspaceRuntime(scope, false);
    const mode = detectBulkCampaignChatCommand(rawMsg);
    if (mode) {
      let target = body.campaignId
        ? await workspaceStore.getScoped(scope, body.campaignId, options.db)
        : await workspaceStore.getLatestScoped(scope, options.db);
      if (!target && mode === 'prepare_script_only' && scope.role !== 'viewer') {
        const created = createBulkCampaignFromChatInput({
          workspaceId: scope.workspaceId,
          userId: scope.userId,
          chatMessage: rawMsg,
          phoneDirectory: rt.phoneDirectory.length > 0 ? rt.phoneDirectory : DEFAULT_DEMO_PHONE_DIRECTORY,
          ...(rt.wsInfo?.whatsappDirectory ? { whatsappDirectory: rt.wsInfo.whatsappDirectory } : {}),
          fallbackToDemoContactsWhenEmpty: true
        });
        target = await workspaceStore.saveScoped(scope, created.campaign, options.db);
      }
      const out = executeBulkCampaignChatCommand(mode, target);
      if (out.updatedCampaign) {
        await workspaceStore.saveScoped(scope, out.updatedCampaign, options.db);
      }
      return {
        handled: true,
        mode,
        assistantResponseText: out.assistantResponseText,
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      };
    }

    const intent = detectBulkCampaignChatIntent(rawMsg);
    if (intent?.kind === 'create_campaign') {
      if (scope.role === 'viewer') throw new ForbiddenError('Viewers cannot create bulk campaigns.');
      const existing = await workspaceStore.getLatestScoped(scope, options.db);
      const created = createBulkCampaignFromChatInput({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        chatMessage: rawMsg,
        ...(existing ? { existingCampaign: existing } : {}),
        phoneDirectory: rt.phoneDirectory.length > 0 ? rt.phoneDirectory : DEFAULT_DEMO_PHONE_DIRECTORY,
        ...(rt.wsInfo?.whatsappDirectory ? { whatsappDirectory: rt.wsInfo.whatsappDirectory } : {}),
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled,
        fallbackToDemoContactsWhenEmpty: true
      });
      const saved = await workspaceStore.saveScoped(scope, created.campaign, options.db);
      return {
        handled: true,
        mode: 'create_campaign',
        campaign: formatCampaignEnvelope(saved, {
          liveCallingEnabled: rt.liveCallingEnabled,
          liveSendingEnabled: rt.liveSendingEnabled
        }),
        assistantResponseText: `${created.summaryText}\n\nReview the campaign summary, contact eligibility buckets, and script preview above. Nothing is sent or called without your explicit approval (liveCallingEnabled=${rt.liveCallingEnabled}, liveSendingEnabled=${rt.liveSendingEnabled}).`,
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled
      };
    }

    return { handled: false };
  });

  // -------------------------------------------------------------------------
  // n8n Campaign Orchestration Routes (1-Contact Pilot for AI Calling & WhatsApp)
  // -------------------------------------------------------------------------
  const n8nTrigger =
    options.n8nTrigger ??
    createDefaultBulkCampaignN8nTrigger({
      liveEnabled: process.env.THAARA_BULK_CAMPAIGN_N8N_LIVE_ENABLED === 'true',
      webhookSecret: process.env.THAARA_BULK_CAMPAIGN_N8N_WEBHOOK_SECRET ?? null
    });

  app.post(`${base}/:campaignId/n8n/jobs`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner') {
      throw new ForbiddenError('Only workspace owners can submit n8n campaign jobs.');
    }
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as {
      channel?: 'phone_call' | 'whatsapp';
      contactId?: string;
      language?: string;
      connectionId?: string;
      templateName?: string;
    };
    if ((body.channel !== 'phone_call' && body.channel !== 'whatsapp') || !body.contactId) {
      throw new ValidationError('channel (phone_call | whatsapp) and contactId are required.');
    }
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    if (isSyntheticDemoCampaign(existing)) {
      throw new ForbiddenError('Synthetic demo campaigns cannot be dispatched to live n8n workflows.');
    }
    const rt = await resolveWorkspaceRuntime(scope, false);
    const result = await submitBulkCampaignN8nJob(existing, {
      scope,
      channel: body.channel,
      contactId: body.contactId,
      language:
        body.language === 'en-IN' || body.language === 'kn-IN' || body.language === 'kn-en' || body.language === 'hi-IN'
          ? (body.language as BulkCampaignLanguage)
          : undefined,
      connectionId: body.connectionId,
      templateName: body.templateName,
      phoneDirectory: rt.phoneDirectory,
      phoneAdapter: rt.phoneAdapter,
      n8nTrigger
    });
    const saved = await workspaceStore.saveScoped(scope, result.campaign, options.db);
    return {
      ok: true,
      job: result.job,
      webhookDispatched: result.webhookDispatched,
      ...(result.webhookReason ? { webhookReason: result.webhookReason } : {}),
      campaign: formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled,
        phoneDirectory: rt.phoneDirectory
      })
    };
  });

  app.post(`${base}/:campaignId/n8n/jobs/:jobId/cancel`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner') {
      throw new ForbiddenError('Only workspace owners can cancel n8n campaign jobs.');
    }
    const { campaignId, jobId } = request.params as { campaignId: string; jobId: string };
    const body = (request.body ?? {}) as { reason?: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, false);
    const updated = cancelBulkCampaignN8nJob(existing, scope, jobId, body.reason);
    const saved = await workspaceStore.saveScoped(scope, updated, options.db);
    return {
      ok: true,
      campaign: formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled,
        phoneDirectory: rt.phoneDirectory
      })
    };
  });

  app.post(`${base}/:campaignId/n8n/jobs/:jobId/pause`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner') {
      throw new ForbiddenError('Only workspace owners can pause n8n campaign jobs.');
    }
    const { campaignId, jobId } = request.params as { campaignId: string; jobId: string };
    const body = (request.body ?? {}) as { reason?: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, false);
    try {
      const updated = pauseBulkCampaignN8nJob(existing, scope, jobId, body.reason);
      const saved = await workspaceStore.saveScoped(scope, updated, options.db);
      return {
        ok: true,
        campaign: formatCampaignEnvelope(saved, {
          liveCallingEnabled: rt.liveCallingEnabled,
          liveSendingEnabled: rt.liveSendingEnabled,
          phoneDirectory: rt.phoneDirectory
        })
      };
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/n8n/jobs/:jobId/resume`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner') {
      throw new ForbiddenError('Only workspace owners can resume n8n campaign jobs.');
    }
    const { campaignId, jobId } = request.params as { campaignId: string; jobId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, false);
    const liveMultiEnabled =
      process.env.THAARA_BULK_CAMPAIGN_LIVE_ENABLED === 'true' || Boolean(options.allowBatchOfflineTest);
    if (!liveMultiEnabled) {
      throw new ValidationError(
        'MULTI_CONTACT_LIVE_DISABLED: Global multi-contact live execution (THAARA_BULK_CAMPAIGN_LIVE_ENABLED) is disabled.'
      );
    }
    const targetJob = (existing.n8nJobs ?? []).find(j => j.jobId === jobId);
    if (!isCampaignAllowlistedForLive(existing.campaignId)) {
      throw new ValidationError(
        `LIVE_CAMPAIGN_NOT_ALLOWLISTED: Campaign "${existing.campaignId}" is not in THAARA_BULK_CAMPAIGN_LIVE_ALLOW_CAMPAIGN_IDS.`
      );
    }
    if (targetJob && !isChannelAllowlistedForLive(targetJob.channel)) {
      throw new ValidationError(
        `LIVE_CHANNEL_NOT_ALLOWLISTED: Channel "${targetJob.channel}" is not enabled in THAARA_BULK_CAMPAIGN_LIVE_ALLOW_CHANNELS.`
      );
    }
    try {
      const result = await resumeBulkCampaignN8nJob(existing, scope, jobId, { n8nTrigger });
      const saved = await workspaceStore.saveScoped(scope, result.campaign, options.db);
      return {
        ok: true,
        job: result.job,
        webhookDispatched: result.webhookDispatched,
        campaign: formatCampaignEnvelope(saved, {
          liveCallingEnabled: rt.liveCallingEnabled,
          liveSendingEnabled: rt.liveSendingEnabled,
          phoneDirectory: rt.phoneDirectory
        })
      };
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  });

  app.post(`${base}/:campaignId/n8n/batch-jobs`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner') {
      throw new ForbiddenError('Only workspace owners can submit multi-contact n8n batch jobs.');
    }
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as {
      channel?: 'phone_call' | 'whatsapp';
      batchConfig?: { batchSize?: number; maxConcurrency?: number; rateLimitPerMinute?: number; maxRetries?: number };
    };
    if (body.channel !== 'phone_call' && body.channel !== 'whatsapp') {
      throw new ValidationError('channel (phone_call | whatsapp) is required.');
    }
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    if (isSyntheticDemoCampaign(existing)) {
      throw new ForbiddenError('Synthetic demo campaigns cannot be dispatched to live n8n workflows.');
    }
    const rt = await resolveWorkspaceRuntime(scope, false);
    const liveMultiEnabled =
      process.env.THAARA_BULK_CAMPAIGN_LIVE_ENABLED === 'true' || Boolean(options.allowBatchOfflineTest);
    if (liveMultiEnabled && !isCampaignAllowlistedForLive(existing.campaignId)) {
      throw new ValidationError(
        `LIVE_CAMPAIGN_NOT_ALLOWLISTED: Campaign "${existing.campaignId}" is not in THAARA_BULK_CAMPAIGN_LIVE_ALLOW_CAMPAIGN_IDS.`
      );
    }
    if (liveMultiEnabled && !isChannelAllowlistedForLive(body.channel)) {
      throw new ValidationError(
        `LIVE_CHANNEL_NOT_ALLOWLISTED: Channel "${body.channel}" is not enabled in THAARA_BULK_CAMPAIGN_LIVE_ALLOW_CHANNELS.`
      );
    }
    const authoritativePhoneDirectory =
      hasRealConnectors || Boolean(options.phoneFallbackDirectory) ? rt.phoneDirectory : undefined;
    const result = await submitBulkCampaignMultiContactN8nJob(existing, {
      scope,
      channel: body.channel,
      batchConfig: body.batchConfig,
      liveMultiContactEnabled: liveMultiEnabled,
      ...(authoritativePhoneDirectory !== undefined ? { phoneDirectory: authoritativePhoneDirectory } : {}),
      n8nTrigger
    });
    const saved = await workspaceStore.saveScoped(scope, result.campaign, options.db);
    return {
      ok: true,
      job: result.job,
      webhookDispatched: result.webhookDispatched,
      campaign: formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled,
        phoneDirectory: rt.phoneDirectory
      })
    };
  });

  app.post(`${base}/:campaignId/n8n/emergency-stop`, authGuard, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner') {
      throw new ForbiddenError('Only workspace owners can trigger an emergency stop.');
    }
    const { campaignId } = request.params as { campaignId: string };
    const body = (request.body ?? {}) as { reason?: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const rt = await resolveWorkspaceRuntime(scope, false);
    const updated = emergencyStopAllBulkCampaignN8nJobs(existing, scope, body.reason);
    const saved = await workspaceStore.saveScoped(scope, updated, options.db);
    return {
      ok: true,
      campaign: formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled,
        phoneDirectory: rt.phoneDirectory
      })
    };
  });

  const requireN8nMachineAuth = (request: { headers: Record<string, string | string[] | undefined>; scope?: unknown }) => {
    if (request.headers.cookie || request.scope) {
      throw new ForbiddenError('Browser session auth cannot invoke n8n machine callbacks.');
    }
    const expectedToken = options.n8nMachineToken ?? process.env.THAARA_BULK_CAMPAIGN_N8N_TOKEN;
    const rawHeader = request.headers['x-thaara-bulk-campaign-n8n-token'];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!verifyBulkCampaignN8nToken(provided, expectedToken)) {
      throw new ForbiddenError('Invalid or missing n8n machine token.');
    }
  };

  const resolveMachineWorkspaceScope = async (workspaceId: string, userId = ''): Promise<AuthenticatedScope> => {
    let sessionTokenHash = '0'.repeat(64);
    if (options.db && userId) {
      try {
        const probeScope: AuthenticatedScope = {
          workspaceId,
          userId,
          role: 'owner',
          sessionTokenHash
        };
        const resolvedHash = await options.db.withScopedTransaction(probeScope, async tx => {
          const existing = await tx.query<{ token_hash: string }>(
            `SELECT token_hash FROM public.sessions
             WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > clock_timestamp()
             ORDER BY expires_at DESC LIMIT 1`,
            [workspaceId, userId]
          );
          if (existing.rows[0]?.token_hash) return existing.rows[0].token_hash;
          const created = await tx.query<{ token_hash: string }>(
            `INSERT INTO public.sessions (workspace_id, user_id, token_hash, expires_at)
             VALUES ($1, $2, encode(gen_random_bytes(32), 'hex'), clock_timestamp() + interval '7 days')
             RETURNING token_hash`,
            [workspaceId, userId]
          );
          return created.rows[0]?.token_hash ?? null;
        });
        if (resolvedHash) {
          sessionTokenHash = resolvedHash;
        }
      } catch {
        // Fallback to non-empty static marker when sessions table is unavailable (e.g. unit tests)
      }
    }
    return {
      workspaceId,
      userId,
      role: 'owner',
      sessionTokenHash
    };
  };

  const resolveMachineJobScope = async (campaign: BulkCampaignState, jobId: string): Promise<AuthenticatedScope> => {
    const job = (campaign.n8nJobs ?? []).find(j => j.jobId === jobId);
    const userId = job?.createdByUserId ?? campaign.createdByUserId;
    return resolveMachineWorkspaceScope(campaign.workspaceId, userId);
  };

  app.post(`${base}/n8n/jobs/:jobId/claim-next`, { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async request => {
    requireN8nMachineAuth(request);
    const { jobId } = request.params as { jobId: string };
    const body = (request.body ?? {}) as {
      executionToken?: string;
      channel?: 'phone_call' | 'whatsapp';
      workspaceId?: string;
      campaignId?: string;
    };
    const campaign = await workspaceStore.findByN8nJobIdScoped(jobId, {
      workspaceId: body.workspaceId,
      campaignId: body.campaignId,
      db: options.db
    });
    if (!campaign) return { proceed: false, reason: 'JOB_NOT_FOUND' };
    const scope = await resolveMachineJobScope(campaign, jobId);
    const matchedJob = (campaign.n8nJobs ?? []).find(j => j.jobId === jobId);
    if (matchedJob?.mode === 'multi_contact_batch') {
      const rtBatch =
        hasRealConnectors || Boolean(options.phoneFallbackDirectory)
          ? await resolveWorkspaceRuntime(scope, false)
          : null;
      const batchOut = claimNextBatchContactForN8nJob(campaign, {
        jobId,
        executionToken: body.executionToken ?? '',
        channel: body.channel ?? 'phone_call',
        ...(rtBatch ? { phoneDirectory: rtBatch.phoneDirectory } : {})
      });
      await workspaceStore.saveScoped(scope, batchOut.campaign, options.db);
      return {
        proceed: batchOut.proceed,
        hasMore: batchOut.hasMore,
        mode: 'multi_contact_batch',
        ...(batchOut.reason ? { reason: batchOut.reason } : {}),
        ...(batchOut.contactId ? { contactId: batchOut.contactId } : {}),
        ...(batchOut.displayName ? { displayName: batchOut.displayName } : {}),
        ...(batchOut.idempotencyKey ? { idempotencyKey: batchOut.idempotencyKey } : {}),
        ...(batchOut.callPurpose ? { callPurpose: batchOut.callPurpose } : {}),
        ...(batchOut.rateLimitDelaySeconds ? { rateLimitDelaySeconds: batchOut.rateLimitDelaySeconds } : {}),
        ...(batchOut.language ? { language: batchOut.language } : {}),
        ...(batchOut.templateName ? { templateName: batchOut.templateName } : {}),
        ...(batchOut.templateLanguage ? { templateLanguage: batchOut.templateLanguage } : {}),
        ...(batchOut.messagePreview ? { messagePreview: batchOut.messagePreview } : {}),
        ...(batchOut.connectionId ? { connectionId: batchOut.connectionId } : {})
      };
    }
    const rt = await resolveWorkspaceRuntime(scope, false);
    const out = claimNextBulkCampaignN8nJob(campaign, {
      jobId,
      executionToken: body.executionToken ?? '',
      channel: body.channel ?? 'phone_call',
      phoneDirectory: rt.phoneDirectory
    });
    await workspaceStore.saveScoped(scope, out.campaign, options.db);
    return {
      proceed: out.proceed,
      ...(out.reason ? { reason: out.reason } : {}),
      ...(out.contactId ? { contactId: out.contactId } : {}),
      ...(out.displayName ? { displayName: out.displayName } : {}),
      ...(out.channel ? { channel: out.channel } : {}),
      ...(out.approvalId ? { approvalId: out.approvalId } : {}),
      ...(out.callPurpose ? { callPurpose: out.callPurpose } : {}),
      ...(out.language ? { language: out.language } : {}),
      ...(out.templateName ? { templateName: out.templateName } : {}),
      ...(out.templateLanguage ? { templateLanguage: out.templateLanguage } : {}),
      ...(out.messagePreview ? { messagePreview: out.messagePreview } : {}),
      ...(out.connectionId ? { connectionId: out.connectionId } : {})
    };
  });

  app.post(`${base}/n8n/jobs/:jobId/execute-phone`, { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async request => {
    requireN8nMachineAuth(request);
    const { jobId } = request.params as { jobId: string };
    const body = (request.body ?? {}) as { contactId?: string; workspaceId?: string; campaignId?: string };
    const campaign = await workspaceStore.findByN8nJobIdScoped(jobId, {
      workspaceId: body.workspaceId,
      campaignId: body.campaignId,
      db: options.db
    });
    if (!campaign) return { ok: false, failureReason: 'JOB_NOT_FOUND' };
    const scope = await resolveMachineJobScope(campaign, jobId);
    const rt = await resolveWorkspaceRuntime(scope, false);
    const job = (campaign.n8nJobs ?? []).find(j => j.jobId === jobId);
    if (job?.mode === 'multi_contact_batch') {
      const authCheck = isCampaignAuthorizedForLiveExecution(campaign, scope);
      if (!authCheck.authorized && !options.allowBatchOfflineTest) {
        return { ok: false, failureReason: authCheck.reason ?? 'LIVE_CAMPAIGN_NOT_AUTHORIZED' };
      }
      if (!isChannelAllowlistedForLive('phone_call')) {
        return { ok: false, failureReason: 'LIVE_CHANNEL_NOT_ALLOWLISTED' };
      }
    }
    const batchAllowed =
      job?.mode !== 'multi_contact_batch' ||
      rt.liveCallingEnabled ||
      Boolean(options.allowBatchOfflineTest) ||
      Boolean(options.phoneAdapter);
    if (!batchAllowed) {
      return { ok: false, failureReason: 'MULTI_CONTACT_LIVE_DISABLED' };
    }
    if (!rt.n8nLiveEnabled && !options.phoneAdapter && !options.allowBatchOfflineTest) {
      return { ok: false, failureReason: 'N8N_LIVE_EXECUTION_DISABLED' };
    }
    const authoritativePhoneDirectory =
      hasRealConnectors || Boolean(options.phoneFallbackDirectory) ? rt.phoneDirectory : undefined;
    const out = await executeBulkCampaignN8nPhoneJob(campaign, {
      jobId,
      scope,
      phoneAdapter: rt.phoneAdapter,
      ...(authoritativePhoneDirectory !== undefined ? { phoneDirectory: authoritativePhoneDirectory } : {}),
      ...(body.contactId ? { contactId: body.contactId } : {})
    });
    await workspaceStore.saveScoped(scope, out.campaign, options.db);
    return {
      ok: out.ok,
      ...(out.callId ? { callId: out.callId } : {}),
      ...(out.providerCallId !== undefined ? { providerCallId: out.providerCallId } : {}),
      ...(out.status ? { status: out.status } : {}),
      ...(out.failureReason ? { failureReason: out.failureReason } : {})
    };
  });

  app.post(`${base}/n8n/jobs/:jobId/poll-phone`, { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async request => {
    requireN8nMachineAuth(request);
    const { jobId } = request.params as { jobId: string };
    const body = (request.body ?? {}) as { contactId?: string; workspaceId?: string; campaignId?: string };
    const campaign = await workspaceStore.findByN8nJobIdScoped(jobId, {
      workspaceId: body.workspaceId,
      campaignId: body.campaignId,
      db: options.db
    });
    if (!campaign) return { status: 'unknown', durationSeconds: null, summary: null };
    const scope = await resolveMachineJobScope(campaign, jobId);
    const rt = await resolveWorkspaceRuntime(scope, false);
    const out = await pollBulkCampaignN8nPhoneJob(campaign, {
      jobId,
      phoneAdapter: rt.phoneAdapter,
      ...(body.contactId ? { contactId: body.contactId } : {})
    });
    await workspaceStore.saveScoped(scope, out.campaign, options.db);
    return {
      status: out.status,
      durationSeconds: out.durationSeconds,
      summary: out.summary
    };
  });

  app.post(`${base}/n8n/jobs/:jobId/execute-whatsapp`, { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async request => {
    requireN8nMachineAuth(request);
    const { jobId } = request.params as { jobId: string };
    const body = (request.body ?? {}) as { contactId?: string; workspaceId?: string; campaignId?: string };
    const campaign = await workspaceStore.findByN8nJobIdScoped(jobId, {
      workspaceId: body.workspaceId,
      campaignId: body.campaignId,
      db: options.db
    });
    if (!campaign) return { ok: false, failureReason: 'JOB_NOT_FOUND' };
    const scope = await resolveMachineJobScope(campaign, jobId);
    const rt = await resolveWorkspaceRuntime(scope, false);
    const job = (campaign.n8nJobs ?? []).find(j => j.jobId === jobId);
    if (job?.mode === 'multi_contact_batch') {
      if (!isCampaignAllowlistedForLive(campaign.campaignId)) {
        return { ok: false, failureReason: 'LIVE_CAMPAIGN_NOT_ALLOWLISTED' };
      }
      if (!isChannelAllowlistedForLive('whatsapp')) {
        return { ok: false, failureReason: 'LIVE_CHANNEL_NOT_ALLOWLISTED' };
      }
    }
    const batchAllowed =
      job?.mode !== 'multi_contact_batch' ||
      rt.liveSendingEnabled ||
      Boolean(options.allowBatchOfflineTest) ||
      Boolean(options.whatsappAdapter);
    if (!batchAllowed) {
      return { ok: false, failureReason: 'MULTI_CONTACT_LIVE_DISABLED' };
    }
    if (!rt.n8nLiveEnabled && !options.whatsappAdapter && !options.allowBatchOfflineTest) {
      return { ok: false, failureReason: 'N8N_LIVE_EXECUTION_DISABLED' };
    }
    const out = await executeBulkCampaignN8nWhatsAppJob(campaign, {
      jobId,
      whatsappAdapter: job?.mode === 'multi_contact_batch' ? rt.waAdapter : rt.pilotWaAdapter,
      ...(body.contactId ? { contactId: body.contactId } : {})
    });
    await workspaceStore.saveScoped(scope, out.campaign, options.db);
    return {
      ok: out.ok,
      ...(out.providerMessageId !== undefined ? { providerMessageId: out.providerMessageId } : {}),
      ...(out.status ? { status: out.status } : {}),
      ...(out.failureReason ? { failureReason: out.failureReason } : {})
    };
  });

  app.post(`${base}/n8n/jobs/:jobId/poll-whatsapp`, { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async request => {
    requireN8nMachineAuth(request);
    const { jobId } = request.params as { jobId: string };
    const body = (request.body ?? {}) as { contactId?: string; workspaceId?: string; campaignId?: string };
    const campaign = await workspaceStore.findByN8nJobIdScoped(jobId, {
      workspaceId: body.workspaceId,
      campaignId: body.campaignId,
      db: options.db
    });
    if (!campaign) {
      return { deliveryStatus: 'unknown', replyReceived: false, latestReplyPreview: null, optOutDetected: false };
    }
    const scope = await resolveMachineJobScope(campaign, jobId);
    const out = await pollBulkCampaignN8nWhatsAppJob(campaign, {
      jobId,
      scope,
      durableWhatsApp: options.whatsappDurable,
      ...(body.contactId ? { contactId: body.contactId } : {})
    });
    await workspaceStore.saveScoped(scope, out.campaign, options.db);
    return {
      deliveryStatus: out.deliveryStatus,
      replyReceived: out.replyReceived,
      latestReplyPreview: out.latestReplyPreview,
      optOutDetected: out.optOutDetected
    };
  });

  app.post(`${base}/n8n/jobs/:jobId/complete`, { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async request => {
    requireN8nMachineAuth(request);
    const { jobId } = request.params as { jobId: string };
    const body = (request.body ?? {}) as {
      status?: 'completed' | 'failed' | 'stopped';
      outcomeSummary?: string;
      failureReason?: string;
      n8nExecutionId?: string;
      workspaceId?: string;
      campaignId?: string;
    };
    const campaign = await workspaceStore.findByN8nJobIdScoped(jobId, {
      workspaceId: body.workspaceId,
      campaignId: body.campaignId,
      db: options.db
    });
    if (!campaign) return { ok: false, reason: 'JOB_NOT_FOUND' };
    const scope = await resolveMachineJobScope(campaign, jobId);
    const existingJob = (campaign.n8nJobs ?? []).find(j => j.jobId === jobId);
    const effectiveStatus =
      existingJob?.mode === 'multi_contact_batch' &&
      existingJob.status === 'failed' &&
      existingJob.succeededCount === 0 &&
      (body.status ?? 'completed') === 'completed'
        ? 'failed'
        : (body.status ?? 'completed');
    const updated = completeBulkCampaignN8nJob(campaign, {
      jobId,
      status: effectiveStatus,
      outcomeSummary: body.outcomeSummary,
      failureReason: body.failureReason ?? existingJob?.failureReason ?? undefined,
      n8nExecutionId: body.n8nExecutionId
    });
    await workspaceStore.saveScoped(scope, updated, options.db);
    return { ok: true };
  });

  app.post(`${base}/n8n/jobs/:jobId/contact-outcome`, { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } }, async request => {
    requireN8nMachineAuth(request);
    const { jobId } = request.params as { jobId: string };
    const body = (request.body ?? {}) as {
      contactId?: string;
      status?: 'completed' | 'failed' | 'skipped';
      providerId?: string | null;
      thaaraCallId?: string | null;
      durationSeconds?: number | null;
      callOutcome?: 'interested' | 'not_interested' | 'callback_requested' | 'no_answer' | 'busy' | 'failed' | 'opted_out' | null;
      outcome?: string | null;
      failureReason?: string | null;
      optOutDetected?: boolean;
      workspaceId?: string;
      campaignId?: string;
    };
    const campaign = await workspaceStore.findByN8nJobIdScoped(jobId, {
      workspaceId: body.workspaceId,
      campaignId: body.campaignId,
      db: options.db
    });
    if (!campaign || !body.contactId || !body.status) return { ok: false };
    const scope = await resolveMachineJobScope(campaign, jobId);
    const updated = recordBatchContactOutcomeForN8nJob(campaign, {
      jobId,
      contactId: body.contactId,
      status: body.status,
      providerId: body.providerId,
      thaaraCallId: body.thaaraCallId,
      durationSeconds: body.durationSeconds,
      callOutcome: body.callOutcome,
      outcome: body.outcome,
      failureReason: body.failureReason,
      optOutDetected: body.optOutDetected
    });
    await workspaceStore.saveScoped(scope, updated, options.db);
    return { ok: true };
  });

  const googleSheetsConnections =
    options.googleSheetsConnections ?? new GoogleSheetsConnectionsService({ db: options.db });

  const resolveGoogleOAuthRedirectUri = (request: { headers: Record<string, string | string[] | undefined>; protocol?: string }) => {
    const configuredOrigin = (process.env.GOOGLE_OAUTH_ORIGIN || process.env.THAARA_PHONE_CALLBACK_ORIGIN || '').trim().replace(/\/+$/, '');
    if (configuredOrigin) {
      return `${configuredOrigin}/api/v1/campaigns/bulk/google-sheets/oauth/callback`;
    }
    const hostRaw = request.headers['x-forwarded-host'] ?? request.headers.host;
    const host = (Array.isArray(hostRaw) ? hostRaw[0] : hostRaw)?.split(',')[0]?.trim() || 'localhost:3002';
    const isLocalHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
    const protoRaw = request.headers['x-forwarded-proto'];
    const proto = !isLocalHost
      ? 'https'
      : (Array.isArray(protoRaw) ? protoRaw[0] : protoRaw)?.split(',')[0]?.trim() || request.protocol || 'http';
    return `${proto}://${host}/api/v1/campaigns/bulk/google-sheets/oauth/callback`;
  };

  const readLiveGoogleSheetCsv = async (
    scope: AuthenticatedScope,
    input: {
      connectionId?: string;
      spreadsheetId: string;
      spreadsheetName?: string;
      gid?: string;
      tabName?: string;
    }
  ): Promise<{
    csvText: string;
    spreadsheetName?: string;
    tabName?: string;
    tabId?: string;
    googleConnectionId?: string;
    googleAccountEmail?: string;
  }> => {
    const connections = await googleSheetsConnections.listConnections(scope, options.db);
    if (input.connectionId) {
      const res = await googleSheetsConnections.readSpreadsheetTabCsv(
        scope,
        {
          connectionId: input.connectionId,
          spreadsheetId: input.spreadsheetId,
          ...(input.gid ? { gid: input.gid } : {}),
          ...(input.tabName ? { tabName: input.tabName } : {})
        },
        options.db
      );
      return {
        csvText: res.csvText,
        spreadsheetName: res.spreadsheetName,
        tabName: res.tabName,
        tabId: res.tabId,
        googleConnectionId: input.connectionId,
        googleAccountEmail: res.accountEmail
      };
    }

    const activeConn = connections.find(c => c.status === 'connected');
    if (activeConn) {
      const res = await googleSheetsConnections.readSpreadsheetTabCsv(
        scope,
        {
          connectionId: activeConn.connectionId,
          spreadsheetId: input.spreadsheetId,
          ...(input.gid ? { gid: input.gid } : {}),
          ...(input.tabName ? { tabName: input.tabName } : {})
        },
        options.db
      );
      return {
        csvText: res.csvText,
        spreadsheetName: res.spreadsheetName,
        tabName: res.tabName,
        tabId: res.tabId,
        googleConnectionId: activeConn.connectionId,
        googleAccountEmail: res.accountEmail
      };
    }

    if (options.googleDrive) {
      let st = await options.googleDrive.getStatus(scope);
      if (!st.connected) {
        st = await options.googleDrive.getStatus(scope, { verify: true });
      }
      if (!st.connected) {
        throw new ValidationError(
          connections.length > 0
            ? connections[0]?.lastError || `Google authorization expired for ${connections[0]?.accountEmail}. Please reconnect.`
            : st.message || 'No Google account is connected in this workspace. Connect a Google account to access Google Sheets.'
        );
      }
      const readRes = await options.googleDrive.readFile(scope, input.spreadsheetId, input.spreadsheetName, {
        ...(input.gid ? { gid: input.gid } : {}),
        ...(input.tabName ? { tabName: input.tabName } : {})
      });
      if (!readRes.success || !readRes.file?.content) {
        throw new ValidationError(
          readRes.message || 'Connected Google account does not have authorized read access to this Google Sheet.'
        );
      }
      return {
        csvText: readRes.file.content,
        spreadsheetName: readRes.file?.name || input.spreadsheetName
      };
    }

    throw new ValidationError('Google account not connected. Connect a Google account in Bulk Campaigns → Create.');
  };

  // Multi-account Google Sheets OAuth & connection management (tokens never leave backend)
  app.get(`${base}/google-sheets/connections`, async request => {
    const scope = requireScope(request);
    const [oauthConfigured, connections] = await Promise.all([
      googleSheetsConnections.isOAuthConfigured(),
      googleSheetsConnections.listConnections(scope, options.db)
    ]);
    return { oauthConfigured, connections };
  });

  app.post(`${base}/google-sheets/oauth/start`, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner' && scope.role !== 'admin') {
      throw new ForbiddenError('Only workspace owners or admins can connect Google accounts.');
    }
    const body = (request.body ?? {}) as { label?: string; returnTo?: string };
    try {
      return await googleSheetsConnections.createAuthorizationUrl(scope, {
        redirectUri: resolveGoogleOAuthRedirectUri(request),
        label: body.label,
        returnTo: body.returnTo
      });
    } catch (err) {
      if (err instanceof GoogleSheetsAccessError) {
        throw new ValidationError(err.message);
      }
      throw err;
    }
  });

  app.get(`${base}/google-sheets/oauth/callback`, async (request, reply) => {
    const scope = requireScope(request);
    const query = (request.query ?? {}) as { code?: string; state?: string; error?: string };
    const fallbackRedirect = '/integrations/bulk-campaign/create';
    if (query.error) {
      return reply.redirect(`${fallbackRedirect}?google_error=${encodeURIComponent(query.error)}`);
    }
    if (!query.code || !query.state) {
      return reply.redirect(`${fallbackRedirect}?google_error=${encodeURIComponent('Missing Google OAuth authorization code.')}`);
    }
    try {
      const res = await googleSheetsConnections.handleOAuthCallback(
        scope,
        { code: query.code, state: query.state },
        options.db
      );
      const target = res.returnTo && res.returnTo.startsWith('/') ? res.returnTo : fallbackRedirect;
      const sep = target.includes('?') ? '&' : '?';
      return reply.redirect(`${target}${sep}google_connected=${encodeURIComponent(res.connection.accountEmail)}`);
    } catch (err) {
      return reply.redirect(`${fallbackRedirect}?google_error=${encodeURIComponent((err as Error).message)}`);
    }
  });

  app.delete(`${base}/google-sheets/connections/:connectionId`, async request => {
    const scope = requireScope(request);
    if (scope.role !== 'owner' && scope.role !== 'admin') {
      throw new ForbiddenError('Only workspace owners or admins can disconnect Google accounts.');
    }
    const { connectionId } = request.params as { connectionId: string };
    const removed = await googleSheetsConnections.disconnectConnection(scope, connectionId, options.db);
    return { ok: removed };
  });

  // Read-only Google Sheets listing (supports multiple Google accounts + GoogleDriveService fallback)
  app.get(`${base}/google-sheets`, async request => {
    const scope = requireScope(request);
    const query = (request.query ?? {}) as { connectionId?: string };
    const [oauthConfigured, connections] = await Promise.all([
      googleSheetsConnections.isOAuthConfigured(),
      googleSheetsConnections.listConnections(scope, options.db)
    ]);
    const requestedConnId = query.connectionId?.trim();
    const selectedConn = requestedConnId
      ? connections.find(c => c.connectionId === requestedConnId)
      : connections.find(c => c.status === 'connected') ?? connections[0];

    if (selectedConn) {
      try {
        const sheets = await googleSheetsConnections.listSpreadsheets(scope, selectedConn.connectionId, options.db);
        return {
          connected: true,
          oauthConfigured,
          connections,
          selectedConnectionId: selectedConn.connectionId,
          sheets
        };
      } catch (err) {
        return {
          connected: false,
          oauthConfigured,
          connections: await googleSheetsConnections.listConnections(scope, options.db),
          selectedConnectionId: selectedConn.connectionId,
          error: (err as Error).message,
          sheets: []
        };
      }
    }

    if (!options.googleDrive) {
      return { connected: false, oauthConfigured, connections, sheets: [] };
    }
    try {
      let st = await options.googleDrive.getStatus(scope);
      if (!st.connected) {
        st = await options.googleDrive.getStatus(scope, { verify: true });
      }
      if (!st.connected) {
        return { connected: false, oauthConfigured, connections, error: st.message, sheets: [] };
      }
      const res = await options.googleDrive.searchFiles(scope, {
        mimeTypeFilter: 'application/vnd.google-apps.spreadsheet',
        limit: 25
      });
      const sheets = (res.files ?? []).map(f => ({
        id: f.id,
        name: f.name,
        modifiedTime: f.modifiedTime ?? null
      }));
      return { connected: true, oauthConfigured, connections, sheets };
    } catch {
      return { connected: false, oauthConfigured, connections, sheets: [] };
    }
  });

  // Read-only Google Sheets preview & auto-column detection (never treats Sheet presence as consent)
  app.post(`${base}/google-sheets/preview`, async request => {
    const scope = requireScope(request);
    const body = (request.body ?? {}) as {
      connectionId?: string;
      spreadsheetId?: string;
      spreadsheetUrl?: string;
      tabId?: string;
      tabName?: string;
      fileName?: string;
      rawText?: string;
    };
    let parsedUrl: ReturnType<typeof parseGoogleSheetUrl> | null = null;
    if (body.spreadsheetUrl?.trim()) {
      try {
        parsedUrl = parseGoogleSheetUrl(body.spreadsheetUrl);
      } catch (err) {
        throw new ValidationError((err as Error).message);
      }
    }
    const resolvedSpreadsheetId = (parsedUrl?.spreadsheetId ?? body.spreadsheetId ?? '').trim();
    let resolvedTabId = (parsedUrl?.tabId ?? body.tabId ?? '').trim() || undefined;
    let resolvedTabName = body.tabName?.trim() || undefined;
    let resolvedConnectionId = body.connectionId?.trim() || undefined;
    let resolvedAccountEmail: string | undefined;
    let rawCsv = typeof body.rawText === 'string' ? body.rawText : '';
    let sheetName = body.fileName?.trim() || 'google-sheet.csv';
    if (!rawCsv) {
      if (!resolvedSpreadsheetId) {
        throw new ValidationError('Select a Google Sheet or paste a valid Google Sheet URL before previewing.');
      }
      try {
        const liveRead = await readLiveGoogleSheetCsv(scope, {
          ...(resolvedConnectionId ? { connectionId: resolvedConnectionId } : {}),
          spreadsheetId: resolvedSpreadsheetId,
          spreadsheetName: body.fileName,
          ...(resolvedTabId ? { gid: resolvedTabId } : {}),
          ...(resolvedTabName ? { tabName: resolvedTabName } : {})
        });
        rawCsv = liveRead.csvText;
        if (liveRead.spreadsheetName) sheetName = `${liveRead.spreadsheetName}.csv`;
        if (liveRead.tabName) resolvedTabName = liveRead.tabName;
        if (liveRead.tabId) resolvedTabId = liveRead.tabId;
        if (liveRead.googleConnectionId) resolvedConnectionId = liveRead.googleConnectionId;
        if (liveRead.googleAccountEmail) resolvedAccountEmail = liveRead.googleAccountEmail;
      } catch (err) {
        if (err instanceof GoogleSheetsAccessError) {
          throw new ValidationError(err.message);
        }
        throw err;
      }
    }

    const rt = await resolveWorkspaceRuntime(scope, false);
    const lines = rawCsv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean);
    const headerCols = (lines[0] ?? '').split(/[,\t]/).map(h => h.trim());
    const findHeader = (patterns: RegExp[]) => headerCols.find(h => patterns.some(p => p.test(h))) ?? null;
    const detectedColumns = {
      phoneColumn: findHeader([/phone|mobile|number|whatsapp|tel|cell/i]),
      nameColumn: findHeader([/^name$|full.?name|contact.?name|customer|lead|patient|client/i]),
      businessColumn: findHeader([/company|business|organization|org|clinic|firm/i]),
      serviceColumn: findHeader([/service|interested.?in|product|category|looking.?for|solution/i]),
      requirementColumn: findHeader([/requirement|notes|enquiry|inquiry|message|details|pain.?point|challenge|query/i]),
      countryCodeColumn: findHeader([/country.?code|^cc$|dial.?code/i]),
      consentColumns: headerCols.filter(h => /consent|opt|dnd/i.test(h))
    };
    const importResult = parseBulkCampaignContacts({
      sourceType: 'google_sheets',
      fileName: sheetName,
      rawText: rawCsv,
      phoneDirectory: rt.phoneDirectory
    });
    return {
      connected: true,
      spreadsheetId: resolvedSpreadsheetId || null,
      ...(resolvedTabId ? { tabId: resolvedTabId } : {}),
      ...(resolvedTabName ? { tabName: resolvedTabName } : {}),
      ...(resolvedConnectionId ? { googleConnectionId: resolvedConnectionId } : {}),
      ...(resolvedAccountEmail ? { googleAccountEmail: resolvedAccountEmail } : {}),
      ...(parsedUrl?.canonicalUrl ? { spreadsheetUrl: parsedUrl.canonicalUrl } : {}),
      sheetName,
      detectedColumns,
      previewRows: lines.slice(0, 6),
      rawText: rawCsv,
      importResult
    };
  });

  // Campaign-isolated Sarvam HTTPS Tool knowledge retrieval endpoint
  app.post(
    `${base}/:campaignId/sarvam-knowledge-query`,
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { campaignId } = request.params as { campaignId: string };
      const body = (request.body ?? {}) as { query?: string; maxChars?: number; workspaceId?: string };
      const headerToken =
        typeof request.headers['x-thaara-knowledge-token'] === 'string'
          ? request.headers['x-thaara-knowledge-token']
          : typeof request.headers.authorization === 'string' && request.headers.authorization.startsWith('Bearer ')
            ? request.headers.authorization.slice(7).trim()
            : undefined;

      let campaign: BulkCampaignState | null = null;
      if (request.scope) {
        campaign = await workspaceStore.getScoped(request.scope, campaignId, options.db);
      } else {
        const wsId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : '';
        const secret =
          process.env.THAARA_SARVAM_WEBHOOK_SECRET ||
          process.env.THAARA_BULK_CAMPAIGN_N8N_TOKEN ||
          options.n8nMachineToken ||
          '';
        if (!wsId || !secret || !verifyCampaignKnowledgeToken(secret, headerToken, wsId, campaignId)) {
          return reply.code(403).send({
            found: false,
            campaignId,
            answers: [],
            excerpt: '',
            fallbackMessage: 'Unauthorized knowledge request.'
          });
        }
        campaign = await workspaceStore.getScoped(
          await resolveMachineWorkspaceScope(wsId),
          campaignId,
          options.db
        );
      }

      if (!campaign) {
        return reply.code(404).send({
          found: false,
          campaignId,
          answers: [],
          excerpt: '',
          fallbackMessage: 'Campaign knowledge is unavailable.'
        });
      }

      return queryCampaignKnowledge(campaign.campaignId, campaign.knowledgeContext, {
        query: body.query ?? '',
        maxChars: body.maxChars
      });
    }
  );

  // Mode B — Automatic Multi-Campaign Meta Lead Follow-up (configure, activate once, pause/resume/stop, sync, n8n poll-all)
  app.post(`${base}/:campaignId/auto-followup/configure`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const body = (request.body ?? {}) as {
      spreadsheetId?: string;
      spreadsheetName?: string;
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
    };
    let resolvedAccountEmail = body.googleAccountEmail?.trim() || undefined;
    if (body.googleConnectionId && !resolvedAccountEmail) {
      const connView = await googleSheetsConnections.getConnectionView(scope, body.googleConnectionId, options.db);
      if (!connView) {
        throw new ValidationError('Selected Google account connection was not found in this workspace.');
      }
      resolvedAccountEmail = connView.accountEmail;
    }
    const updated = configureAutomaticLeadFollowup(existing, {
      spreadsheetId: body.spreadsheetId ?? '',
      spreadsheetName: body.spreadsheetName ?? 'Connected Google Sheet',
      spreadsheetUrl: body.spreadsheetUrl,
      tabName: body.tabName,
      tabId: body.tabId,
      googleConnectionId: body.googleConnectionId,
      googleAccountEmail: resolvedAccountEmail,
      metaCampaignRef: body.metaCampaignRef,
      metaFormId: body.metaFormId,
      pollIntervalSeconds: body.pollIntervalSeconds,
      processExistingBacklog: body.processExistingBacklog,
      callingHoursIst: body.callingHoursIst,
      maxAttemptsPerLead: body.maxAttemptsPerLead,
      retryOnNoAnswer: body.retryOnNoAnswer,
      retryDelayMinutes: body.retryDelayMinutes,
      maxLeadsPerDay: body.maxLeadsPerDay,
      allowedLeadSources: body.allowedLeadSources
    });
    const saved = await workspaceStore.saveScoped(scope, updated, options.db);
    const rt = await resolveWorkspaceRuntime(scope, false);
    return formatCampaignEnvelope(saved, {
      liveCallingEnabled: rt.liveCallingEnabled,
      liveSendingEnabled: rt.liveSendingEnabled,
      phoneDirectory: rt.phoneDirectory
    });
  });

  app.post(`${base}/:campaignId/auto-followup/activate`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const body = (request.body ?? {}) as {
      expectedMaterialHash?: string;
      baselineCsvText?: string;
      callingHoursIst?: { startHour: number; endHour: number };
      maxAttemptsPerLead?: number;
      retryOnNoAnswer?: boolean;
      retryDelayMinutes?: number;
      maxLeadsPerDay?: number;
      allowedLeadSources?: string[];
      expiresInDays?: number;
    };
    const rt = await resolveWorkspaceRuntime(scope, false);
    let baselineCsvText = body.baselineCsvText;
    if (!baselineCsvText && existing.sheetMonitor?.spreadsheetId) {
      try {
        const liveRead = await readLiveGoogleSheetCsv(scope, {
          ...(existing.sheetMonitor.googleConnectionId ? { connectionId: existing.sheetMonitor.googleConnectionId } : {}),
          spreadsheetId: existing.sheetMonitor.spreadsheetId,
          spreadsheetName: existing.sheetMonitor.spreadsheetName,
          ...(existing.sheetMonitor.tabId ? { gid: existing.sheetMonitor.tabId } : {}),
          tabName: existing.sheetMonitor.tabName
        });
        baselineCsvText = liveRead.csvText;
      } catch {
        // Non-fatal if Sheet is temporarily unavailable on activation
      }
    }
    const activated = activateAutomaticLeadFollowup(existing, {
      actorUserId: scope.userId,
      role: scope.role,
      expectedMaterialHash: body.expectedMaterialHash ?? existing.materialHash,
      baselineCsvText,
      phoneDirectory: rt.phoneDirectory,
      callingHoursIst: body.callingHoursIst,
      maxAttemptsPerLead: body.maxAttemptsPerLead,
      retryOnNoAnswer: body.retryOnNoAnswer,
      retryDelayMinutes: body.retryDelayMinutes,
      maxLeadsPerDay: body.maxLeadsPerDay,
      allowedLeadSources: body.allowedLeadSources,
      expiresInDays: body.expiresInDays
    });
    const saved = await workspaceStore.saveScoped(scope, activated, options.db);
    return formatCampaignEnvelope(saved, {
      liveCallingEnabled: rt.liveCallingEnabled,
      liveSendingEnabled: rt.liveSendingEnabled,
      phoneDirectory: rt.phoneDirectory
    });
  });

  app.post(`${base}/:campaignId/auto-followup/pause`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const saved = await workspaceStore.saveScoped(scope, pauseAutomaticLeadFollowup(existing), options.db);
    const rt = await resolveWorkspaceRuntime(scope, false);
    return formatCampaignEnvelope(saved, { liveCallingEnabled: rt.liveCallingEnabled, liveSendingEnabled: rt.liveSendingEnabled, phoneDirectory: rt.phoneDirectory });
  });

  app.post(`${base}/:campaignId/auto-followup/resume`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const saved = await workspaceStore.saveScoped(scope, resumeAutomaticLeadFollowup(existing), options.db);
    const rt = await resolveWorkspaceRuntime(scope, false);
    return formatCampaignEnvelope(saved, { liveCallingEnabled: rt.liveCallingEnabled, liveSendingEnabled: rt.liveSendingEnabled, phoneDirectory: rt.phoneDirectory });
  });

  app.post(`${base}/:campaignId/auto-followup/stop`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const saved = await workspaceStore.saveScoped(scope, stopAutomaticLeadFollowup(existing), options.db);
    const rt = await resolveWorkspaceRuntime(scope, false);
    return formatCampaignEnvelope(saved, { liveCallingEnabled: rt.liveCallingEnabled, liveSendingEnabled: rt.liveSendingEnabled, phoneDirectory: rt.phoneDirectory });
  });

  app.post(`${base}/:campaignId/auto-followup/sync`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const body = (request.body ?? {}) as { csvText?: string };
    const rt = await resolveWorkspaceRuntime(scope, false);
    let csvText = typeof body.csvText === 'string' ? body.csvText : '';
    if (!csvText && existing.sheetMonitor?.spreadsheetId) {
      try {
        const liveRead = await readLiveGoogleSheetCsv(scope, {
          ...(existing.sheetMonitor.googleConnectionId ? { connectionId: existing.sheetMonitor.googleConnectionId } : {}),
          spreadsheetId: existing.sheetMonitor.spreadsheetId,
          spreadsheetName: existing.sheetMonitor.spreadsheetName,
          ...(existing.sheetMonitor.tabId ? { gid: existing.sheetMonitor.tabId } : {}),
          tabName: existing.sheetMonitor.tabName
        });
        csvText = liveRead.csvText;
      } catch (err) {
        const msg = (err as Error).message;
        const failedCamp = await workspaceStore.saveScoped(scope, recordSheetSyncFailure(existing, msg), options.db);
        return { syncResult: { newRowsDetected: 0, newEligibleCount: 0, newBlockedCount: 0, batchSubmitted: false, error: msg }, ...formatCampaignEnvelope(failedCamp, { liveCallingEnabled: rt.liveCallingEnabled, liveSendingEnabled: rt.liveSendingEnabled, phoneDirectory: rt.phoneDirectory }) };
      }
    }
    const syncRes = await syncGoogleSheetLeadsForCampaign(existing, {
      scope,
      csvText,
      phoneDirectory: rt.phoneDirectory,
      liveMultiContactEnabled: rt.n8nLiveEnabled,
      n8nTrigger: options.n8nTrigger
    });
    const saved = await workspaceStore.saveScoped(scope, syncRes.campaign, options.db);
    return {
      syncResult: {
        newRowsDetected: syncRes.newRowsDetected,
        newEligibleCount: syncRes.newEligibleCount,
        newBlockedCount: syncRes.newBlockedCount,
        offHoursDeferredCount: syncRes.offHoursDeferredCount,
        batchSubmitted: syncRes.batchSubmitted,
        ...(syncRes.jobId ? { jobId: syncRes.jobId } : {}),
        ...(syncRes.skippedReason ? { skippedReason: syncRes.skippedReason } : {})
      },
      ...formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled,
        phoneDirectory: rt.phoneDirectory
      })
    };
  });

  app.post(`${base}/:campaignId/auto-followup/existing-leads/preview`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const body = (request.body ?? {}) as { csvText?: string };
    const rt = await resolveWorkspaceRuntime(scope, false);
    let csvText = typeof body.csvText === 'string' ? body.csvText : '';
    if (!csvText && existing.sheetMonitor?.spreadsheetId) {
      const liveRead = await readLiveGoogleSheetCsv(scope, {
        ...(existing.sheetMonitor.googleConnectionId ? { connectionId: existing.sheetMonitor.googleConnectionId } : {}),
        spreadsheetId: existing.sheetMonitor.spreadsheetId,
        spreadsheetName: existing.sheetMonitor.spreadsheetName,
        ...(existing.sheetMonitor.tabId ? { gid: existing.sheetMonitor.tabId } : {}),
        tabName: existing.sheetMonitor.tabName
      });
      csvText = liveRead.csvText;
    }
    const preview = previewExistingSheetBacklogForCampaign(existing, {
      csvText,
      phoneDirectory: rt.phoneDirectory
    });
    return {
      preview,
      ...formatCampaignEnvelope(existing, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled,
        phoneDirectory: rt.phoneDirectory
      })
    };
  });

  app.post(`${base}/:campaignId/auto-followup/existing-leads/process`, authGuard, async request => {
    const scope = requireScope(request);
    const { campaignId } = request.params as { campaignId: string };
    const existing = await workspaceStore.getScoped(scope, campaignId, options.db);
    if (!existing) throw new ValidationError('Campaign not found in workspace.');
    const body = (request.body ?? {}) as {
      explicitOwnerApproval?: boolean;
      expectedMaterialHash?: string;
      csvText?: string;
    };
    const rt = await resolveWorkspaceRuntime(scope, false);
    let csvText = typeof body.csvText === 'string' ? body.csvText : '';
    if (!csvText && existing.sheetMonitor?.spreadsheetId) {
      try {
        const liveRead = await readLiveGoogleSheetCsv(scope, {
          ...(existing.sheetMonitor.googleConnectionId ? { connectionId: existing.sheetMonitor.googleConnectionId } : {}),
          spreadsheetId: existing.sheetMonitor.spreadsheetId,
          spreadsheetName: existing.sheetMonitor.spreadsheetName,
          ...(existing.sheetMonitor.tabId ? { gid: existing.sheetMonitor.tabId } : {}),
          tabName: existing.sheetMonitor.tabName
        });
        csvText = liveRead.csvText;
      } catch (err) {
        const msg = (err as Error).message;
        await workspaceStore.saveScoped(scope, recordSheetSyncFailure(existing, msg), options.db);
        throw new ValidationError(`Google Sheet read failed: ${msg}`);
      }
    }
    const backlogRes = await processExistingSheetBacklogForCampaign(existing, {
      scope,
      explicitOwnerApproval: Boolean(body.explicitOwnerApproval),
      expectedMaterialHash: body.expectedMaterialHash,
      csvText,
      phoneDirectory: rt.phoneDirectory,
      liveMultiContactEnabled: rt.n8nLiveEnabled || Boolean(options.allowBatchOfflineTest),
      n8nTrigger: options.n8nTrigger
    });
    const saved = await workspaceStore.saveScoped(scope, backlogRes.campaign, options.db);
    return {
      backlogResult: {
        totalExistingRows: backlogRes.totalExistingRows,
        previouslyProcessedCount: backlogRes.previouslyProcessedCount,
        eligibleCount: backlogRes.eligibleCount,
        consentBlockedCount: backlogRes.consentBlockedCount,
        duplicatesCount: backlogRes.duplicatesCount,
        queuedCount: backlogRes.queuedCount,
        offHoursDeferredCount: backlogRes.offHoursDeferredCount,
        batchSubmitted: backlogRes.batchSubmitted,
        ...(backlogRes.jobId ? { jobId: backlogRes.jobId } : {}),
        ...(backlogRes.skippedReason ? { skippedReason: backlogRes.skippedReason } : {})
      },
      ...formatCampaignEnvelope(saved, {
        liveCallingEnabled: rt.liveCallingEnabled,
        liveSendingEnabled: rt.liveSendingEnabled,
        phoneDirectory: rt.phoneDirectory
      })
    };
  });

  // Machine endpoint for n8n scheduled Google Sheets monitoring (polls all active Mode B campaigns)
  app.post(`${base}/n8n/auto-followup/poll-all`, { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async request => {
    requireN8nMachineAuth(request);
    const body = (request.body ?? {}) as { sheetsByCampaignId?: Record<string, string>; workspaceId?: string };
    let candidates = options.db && body.workspaceId
      ? await workspaceStore.listScoped(await resolveMachineWorkspaceScope(body.workspaceId), options.db)
      : await workspaceStore.listAllInMemory?.() ?? [];
    if (options.db && !body.workspaceId && candidates.length === 0) {
      try {
        const wsRes = await options.db.query<{ id: string }>('SELECT id FROM workspaces');
        const seenIds = new Set<string>();
        const recovered: typeof candidates = [];
        for (const row of wsRes.rows) {
          const wsCampaigns = await workspaceStore.listScoped(await resolveMachineWorkspaceScope(row.id), options.db);
          for (const c of wsCampaigns) {
            if (!seenIds.has(c.campaignId)) {
              seenIds.add(c.campaignId);
              recovered.push(c);
            }
          }
        }
        candidates = recovered;
      } catch {
        // Fall back to in-memory list if workspaces query is unavailable
      }
    }
    const results: Array<{ campaignId: string; newRowsDetected: number; newEligibleCount: number; batchSubmitted: boolean; jobId?: string; skippedReason?: string }> = [];
    for (const camp of candidates) {
      if (camp.mode !== 'automatic_lead_followup' || !camp.sheetMonitor || camp.sheetMonitor.status === 'paused' || camp.sheetMonitor.status === 'stopped') {
        continue;
      }
      const scope = await resolveMachineWorkspaceScope(camp.workspaceId, camp.createdByUserId);
      const rt = await resolveWorkspaceRuntime(scope, false);
      let csvText = body.sheetsByCampaignId?.[camp.campaignId] ?? '';
      if (!csvText) {
        try {
          const liveRead = await readLiveGoogleSheetCsv(scope, {
            ...(camp.sheetMonitor.googleConnectionId ? { connectionId: camp.sheetMonitor.googleConnectionId } : {}),
            spreadsheetId: camp.sheetMonitor.spreadsheetId,
            spreadsheetName: camp.sheetMonitor.spreadsheetName,
            ...(camp.sheetMonitor.tabId ? { gid: camp.sheetMonitor.tabId } : {}),
            tabName: camp.sheetMonitor.tabName
          });
          csvText = liveRead.csvText;
        } catch (err) {
          const reasonCode = err instanceof GoogleSheetsAccessError ? err.code : 'SHEET_READ_ERROR';
          await workspaceStore.saveScoped(scope, recordSheetSyncFailure(camp, (err as Error).message), options.db);
          results.push({ campaignId: camp.campaignId, newRowsDetected: 0, newEligibleCount: 0, batchSubmitted: false, skippedReason: reasonCode });
          continue;
        }
      }
      const syncRes = await syncGoogleSheetLeadsForCampaign(camp, {
        scope,
        csvText,
        phoneDirectory: rt.phoneDirectory,
        liveMultiContactEnabled: rt.n8nLiveEnabled || Boolean(options.allowBatchOfflineTest),
        n8nTrigger: options.n8nTrigger
      });
      await workspaceStore.saveScoped(scope, syncRes.campaign, options.db);
      results.push({
        campaignId: camp.campaignId,
        newRowsDetected: syncRes.newRowsDetected,
        newEligibleCount: syncRes.newEligibleCount,
        batchSubmitted: syncRes.batchSubmitted,
        ...(syncRes.jobId ? { jobId: syncRes.jobId } : {}),
        ...(syncRes.skippedReason ? { skippedReason: syncRes.skippedReason } : {})
      });
    }
    return { ok: true, polledCount: results.length, results };
  });
}
