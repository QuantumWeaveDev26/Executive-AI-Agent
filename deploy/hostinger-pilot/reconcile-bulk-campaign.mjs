import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function reconcileAppJsCode(appCode) {
  let next = appCode;
  if (!next.includes("from './routes/bulk-campaign.js'")) {
    next = "import { bulkCampaignRoutes } from './routes/bulk-campaign.js';\n" + next;
  }
  if (!next.includes('resolveCampaignReplyContextForWhatsApp')) {
    next =
      "import { defaultBulkCampaignStore, resolveCampaignReplyContextForWhatsApp } from './services/bulk-campaign.js';\n" +
      next;
  }

  if (!next.includes('resolveCampaignContext:') && next.includes('asyncAutoReply: options.whatsappAsyncAutoReply')) {
    next = next.replace(
      /\{\s*modelGateway,\s*asyncAutoReply:\s*options\.whatsappAsyncAutoReply\s*\?\?\s*\(config\.NODE_ENV\s*!==\s*'test'\)\s*\}/,
      `{
            modelGateway,
            asyncAutoReply: options.whatsappAsyncAutoReply ?? (config.NODE_ENV !== 'test'),
            resolveCampaignContext: ({ scope, phoneE164, customerMessage }) =>
                resolveCampaignReplyContextForWhatsApp({
                    scope,
                    phoneE164,
                    customerMessage,
                    store: defaultBulkCampaignStore,
                    db
                })
        }`
    );
  }

  const wiredBlock = `const bulkPhoneContacts = typeof phoneContactManagementService !== 'undefined'
            ? phoneContactManagementService
            : new PhoneContactManagementService(durableContacts ? new PhoneContactRepository(db) : undefined);
        const bulkWhatsappTemplates = typeof whatsappTemplateService !== 'undefined'
            ? whatsappTemplateService
            : new WhatsAppTemplateService(durableWhatsApp, options.whatsappTemplates);
        await bulkCampaignRoutes(v1, {
            db,
            phoneCalling,
            phoneContacts: bulkPhoneContacts,
            phoneFallbackDirectory: phoneCallingOptions.contacts,
            dailyPhoneCallLimit: liveCalling?.dailyCallLimit,
            whatsappDurable: durableWhatsApp,
            whatsappTemplates: bulkWhatsappTemplates,
            gmail: gmailDiagnostics.service
        });`;

  if (next.includes('await bulkCampaignRoutes(v1, { db });')) {
    next = next.replace('await bulkCampaignRoutes(v1, { db });', wiredBlock);
  } else if (!next.includes('bulkCampaignRoutes(v1,')) {
    if (!next.includes('await automationRoutes(v1, { db });')) {
      throw new Error('Cannot locate automationRoutes anchor in app.js');
    }
    next = next.replace(
      'await automationRoutes(v1, { db });',
      `await automationRoutes(v1, { db });\n        ${wiredBlock}`
    );
  }

  if (
    next.includes('await conversationRoutes(v1, {') &&
    !next.includes('phoneFallbackDirectory:') &&
    next.includes('phoneCalling,\n            whatsappDurable: durableWhatsApp')
  ) {
    next = next.replace(
      'phoneCalling,\n            whatsappDurable: durableWhatsApp',
      `phoneCalling,
            phoneContacts: typeof bulkPhoneContacts !== 'undefined' ? bulkPhoneContacts : phoneContactManagementService,
            phoneFallbackDirectory: phoneCallingOptions.contacts,
            whatsappDurable: durableWhatsApp,
            whatsappTemplates: typeof bulkWhatsappTemplates !== 'undefined' ? bulkWhatsappTemplates : whatsappTemplateService`
    );
  }
  return next;
}

export function reconcileApprovalsJsCode(approvalsCode) {
  let next = approvalsCode;
  if (!next.includes('createBulkCampaignActionAdapter')) {
    next =
      "import { BULK_CAMPAIGN_EXECUTE_ACTION } from '@thaara/contracts';\n" +
      "import { createBulkCampaignActionAdapter, defaultBulkCampaignStore, rejectOrCancelBulkCampaign } from '../services/bulk-campaign.js';\n" +
      next;
    next = next.replace(
      "const personalWhatsApp = existing.action_name === 'whatsapp.meta.messages.send' || existing.action_name === 'whatsapp.meta.media.upload';",
      "const personalWhatsApp = existing.action_name === 'whatsapp.meta.messages.send' || existing.action_name === 'whatsapp.meta.media.upload';\n            const isBulkCampaignApproval = existing.action_name === BULK_CAMPAIGN_EXECUTE_ACTION;"
    );
    next = next.replace(
      'existing.requester_user_id === scope.userId && !personalWhatsApp)',
      'existing.requester_user_id === scope.userId && !personalWhatsApp && !isBulkCampaignApproval)'
    );
    next = next.replace(
      'await stepRepo.cancelNonTerminalSteps(scope.workspaceId, step.plan_id);',
      `await stepRepo.cancelNonTerminalSteps(scope.workspaceId, step.plan_id);
                    if (isBulkCampaignApproval) {
                        const cid = existing.action_params?.campaignId;
                        if (cid) {
                            const currentCampaign = await defaultBulkCampaignStore.getScoped(scope, cid, db);
                            if (currentCampaign) {
                                await defaultBulkCampaignStore.saveScoped(scope, rejectOrCancelBulkCampaign(currentCampaign), db);
                            }
                        }
                    }`
    );
    next = next.replace(
      'const adapters = new Map(defaultActionAdapters);',
      'const adapters = new Map(defaultActionAdapters);\n                defaultBulkCampaignStore.bindDb(db);\n                adapters.set(BULK_CAMPAIGN_EXECUTE_ACTION, createBulkCampaignActionAdapter(defaultBulkCampaignStore, db));'
    );
  } else {
    if (!next.includes('defaultBulkCampaignStore.bindDb(db)')) {
      next = next.replace(
        'const { db, queueService, gmail, googleCalendar, whatsappDurable } = options;',
        'const { db, queueService, gmail, googleCalendar, whatsappDurable } = options;\n    defaultBulkCampaignStore.bindDb(db);'
      );
    }
    if (next.includes('createBulkCampaignActionAdapter()')) {
      next = next.replace(
        'createBulkCampaignActionAdapter()',
        'createBulkCampaignActionAdapter(defaultBulkCampaignStore, db)'
      );
    } else if (next.includes('createBulkCampaignActionAdapter(defaultBulkCampaignStore)')) {
      next = next.replace(
        'createBulkCampaignActionAdapter(defaultBulkCampaignStore)',
        'createBulkCampaignActionAdapter(defaultBulkCampaignStore, db)'
      );
    }
  }
  return next;
}

export function reconcileConversationsJsCode(convCode) {
  let next = convCode;
  if (next.includes('hasContactAttachment')) {
    return next;
  }

  const inputExpr = next.includes('const detectorInput =') ? 'detectorInput' : 'content';
  const hasAttachmentStore = next.includes('globalChatAttachmentStore');

  const attachmentExtractSnippet = hasAttachmentStore
    ? `const turnAttachmentIds = request.body?.attachment_ids ?? [];
            let campaignUploadedFile;
            if (!automationProposal && turnAttachmentIds.length > 0) {
                for (const attId of turnAttachmentIds) {
                    const att = await globalChatAttachmentStore.findById(scope, attId);
                    if (!att) continue;
                    const ext = att.filename.split('.').pop()?.toLowerCase() ?? '';
                    if (
                        att.mimeType === 'text/csv' ||
                        att.mimeType === 'text/plain' ||
                        att.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
                        att.mimeType === 'application/pdf' ||
                        ['csv', 'tsv', 'xlsx', 'xls', 'pdf', 'txt'].includes(ext)
                    ) {
                        const sourceType = att.mimeType === 'text/csv' || ext === 'csv'
                            ? 'csv'
                            : att.mimeType.includes('spreadsheetml') || ext === 'xlsx' || ext === 'xls' || ext === 'tsv'
                                ? 'excel'
                                : att.mimeType === 'application/pdf' || ext === 'pdf'
                                    ? 'pdf'
                                    : 'paste';
                        const isBinaryDoc = att.mimeType.includes('spreadsheetml') || att.mimeType === 'application/pdf' || ext === 'xlsx' || ext === 'pdf';
                        campaignUploadedFile = {
                            sourceType,
                            fileName: att.filename,
                            rawText: isBinaryDoc ? '' : att.bytes.toString('utf8'),
                            ...(isBinaryDoc ? { fileBase64: att.bytes.toString('base64') } : {})
                        };
                        break;
                    }
                }
            }`
    : 'let campaignUploadedFile = undefined;';

  if (next.includes('detectBulkCampaignChatIntent')) {
    next = next.replace(
      /const bulkCampaignIntent = !automationProposal\s*\?\s*detectBulkCampaignChatIntent\([^)]+\)\s*:\s*null;\s*const bulkCampaignOutcome = bulkCampaignIntent\s*\?\s*await executeChatBulkCampaign\(scope,\s*bulkCampaignIntent,\s*\{\s*db,\s*conversationId\s*\}\)\s*:\s*null;/,
      `${attachmentExtractSnippet}
            const bulkCampaignIntent = !automationProposal
                ? detectBulkCampaignChatIntent(${inputExpr}, { hasContactAttachment: Boolean(campaignUploadedFile) })
                : null;
            const bulkCampaignOutcome = bulkCampaignIntent
                ? await executeChatBulkCampaign(scope, bulkCampaignIntent, {
                    db,
                    conversationId,
                    ...(campaignUploadedFile ? { uploadedFile: campaignUploadedFile } : {}),
                    phoneCalling: options.phoneCalling,
                    phoneContacts: options.phoneContacts,
                    phoneFallbackDirectory: options.phoneFallbackDirectory,
                    whatsappDurable: options.whatsappDurable,
                    whatsappTemplates: options.whatsappTemplates,
                    gmail: options.gmail
                })
                : null;`
    );
    return next;
  }

  next =
    "import { detectBulkCampaignChatIntent, executeChatBulkCampaign } from '../services/bulk-campaign.js';\n" +
    next;
  next = next.replace(
    `const explicitPhoneIntent = !automationProposal ? detectPhoneCallingIntent(${inputExpr}) : null;`,
    `${attachmentExtractSnippet}
            const bulkCampaignIntent = !automationProposal
                ? detectBulkCampaignChatIntent(${inputExpr}, { hasContactAttachment: Boolean(campaignUploadedFile) })
                : null;
            const bulkCampaignOutcome = bulkCampaignIntent
                ? await executeChatBulkCampaign(scope, bulkCampaignIntent, {
                    db,
                    conversationId,
                    ...(campaignUploadedFile ? { uploadedFile: campaignUploadedFile } : {}),
                    phoneCalling: options.phoneCalling,
                    phoneContacts: options.phoneContacts,
                    phoneFallbackDirectory: options.phoneFallbackDirectory,
                    whatsappDurable: options.whatsappDurable,
                    whatsappTemplates: options.whatsappTemplates,
                    gmail: options.gmail
                })
                : null;
            const explicitPhoneIntent = !automationProposal && !bulkCampaignOutcome ? detectPhoneCallingIntent(${inputExpr}) : null;`
  );
  next = next.replace(
    'const earlyCalendarIntent = !automationProposal && !explicitPhoneIntent',
    'const earlyCalendarIntent = !automationProposal && !bulkCampaignOutcome && !explicitPhoneIntent'
  );
  next = next.replace(
    `const whatsappReplyIntent = !automationProposal && !earlyCalendarIntent ? detectWhatsAppReplyChatRequest(${inputExpr}) : null;`,
    `const whatsappReplyIntent = !automationProposal && !bulkCampaignOutcome && !earlyCalendarIntent ? detectWhatsAppReplyChatRequest(${inputExpr}) : null;`
  );
  next = next.replace(
    `const whatsappReadIntent = !automationProposal && !earlyCalendarIntent && !whatsappReplyIntent ? detectWhatsAppReadChatRequest(${inputExpr}) : null;`,
    `const whatsappReadIntent = !automationProposal && !bulkCampaignOutcome && !earlyCalendarIntent && !whatsappReplyIntent ? detectWhatsAppReadChatRequest(${inputExpr}) : null;`
  );
  next = next.replace(
    'const phoneCallingIntent = !automationProposal && !earlyCalendarIntent && !whatsappReplyOutcome ? explicitPhoneIntent : null;',
    'const phoneCallingIntent = !automationProposal && !bulkCampaignOutcome && !earlyCalendarIntent && !whatsappReplyOutcome ? explicitPhoneIntent : null;'
  );
  next = next.replace(
    'const gmailChatIntent = automationProposal || isExplicitGmailToCalendar || whatsappReplyOutcome || phoneCallingOutcome',
    'const gmailChatIntent = automationProposal || bulkCampaignOutcome || isExplicitGmailToCalendar || whatsappReplyOutcome || phoneCallingOutcome'
  );
  next = next.replace(
    'const calendarChatIntent = !automationProposal && !whatsappReplyOutcome && !phoneCallingOutcome',
    'const calendarChatIntent = !automationProposal && !bulkCampaignOutcome && !whatsappReplyOutcome && !phoneCallingOutcome'
  );
  next = next.replace(
    'else if ((phoneCallingOutcome ?? whatsappReplyOutcome ?? gmailOutcomeEarly)?.handled) {',
    'else if ((bulkCampaignOutcome ?? phoneCallingOutcome ?? whatsappReplyOutcome ?? gmailOutcomeEarly)?.handled) {'
  );
  next = next.replace(
    'const gmailOutcome = (phoneCallingOutcome ?? whatsappReplyOutcome ?? gmailOutcomeEarly);',
    'const gmailOutcome = (bulkCampaignOutcome ?? phoneCallingOutcome ?? whatsappReplyOutcome ?? gmailOutcomeEarly);'
  );
  return next;
}

async function runInContainerReconciliation() {
  // 1. Reconcile @thaara/contracts without overwriting phone-sarvam-compat.js, chat-voice.js, or whatsapp-n8n.js
  const contractsIndexFile = fs.realpathSync(fileURLToPath(import.meta.resolve('@thaara/contracts')));
  const contractsDir = dirname(contractsIndexFile);
  for (const f of ['bulk-campaign.js', 'bulk-campaign.d.ts']) {
    const src = '/app/packages/contracts/dist/' + f;
    const dst = join(contractsDir, f);
    if (src !== dst) fs.copyFileSync(src, dst);
  }
  let contractsIndex = fs.readFileSync(contractsIndexFile, 'utf8');
  if (!contractsIndex.includes('./bulk-campaign.js')) {
    contractsIndex = contractsIndex.trimEnd() + "\nexport * from './bulk-campaign.js';\n";
    fs.writeFileSync(contractsIndexFile, contractsIndex, 'utf8');
  }

  // 2. Reconcile @thaara/policy registry.js in-place
  const policyIndexFile = fs.realpathSync(fileURLToPath(import.meta.resolve('@thaara/policy')));
  const policyRegistryFile = join(dirname(policyIndexFile), 'registry.js');
  let registryCode = fs.readFileSync(policyRegistryFile, 'utf8');
  if (!registryCode.includes('BULK_CAMPAIGN_EXECUTE_ACTION')) {
    registryCode =
      "import { BULK_CAMPAIGN_EXECUTE_ACTION } from '@thaara/contracts';\n" +
      registryCode.replace(
        'inputSchema: PhoneBriefingQuerySchema\n        });',
        `inputSchema: PhoneBriefingQuerySchema
        });
        this.register({
            metadata: {
                name: BULK_CAMPAIGN_EXECUTE_ACTION,
                actionClass: 'write',
                risk: 'high',
                approvalMode: 'explicit',
                idempotencyRequired: true,
                timeoutMs: 30000,
                retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
                requiredRole: 'admin',
                auditRequired: true,
                capabilityScope: 'external_connector',
                schemaIdentifier: 'campaign.bulk.execute.v1'
            },
            inputSchema: Type.Object({
                campaignId: Type.String({ minLength: 1, maxLength: 64 }),
                title: Type.Optional(Type.String()),
                objective: Type.Optional(Type.String()),
                eventDetails: Type.Optional(Type.String()),
                channels: Type.Optional(Type.Array(Type.String())),
                materialHash: Type.String({ minLength: 8, maxLength: 128 }),
                status: Type.Optional(Type.String())
            }, { additionalProperties: true })
        });`
      );
    fs.writeFileSync(policyRegistryFile, registryCode, 'utf8');
  }

  // 3. Reconcile /app/apps/api/dist/app.js in-place
  const appFile = '/app/apps/api/dist/app.js';
  fs.writeFileSync(appFile, reconcileAppJsCode(fs.readFileSync(appFile, 'utf8')), 'utf8');

  // 4. Reconcile /app/apps/api/dist/routes/approvals.js in-place
  const approvalsFile = '/app/apps/api/dist/routes/approvals.js';
  fs.writeFileSync(approvalsFile, reconcileApprovalsJsCode(fs.readFileSync(approvalsFile, 'utf8')), 'utf8');

  // 5. Reconcile /app/apps/api/dist/routes/conversations.js in-place
  const convFile = '/app/apps/api/dist/routes/conversations.js';
  fs.writeFileSync(convFile, reconcileConversationsJsCode(fs.readFileSync(convFile, 'utf8')), 'utf8');

  // 5b. Reconcile /app/apps/api/pilot-start.mjs in-place so browser refresh on /integrations/bulk-campaign serves index.html
  const pilotStartFile = '/app/apps/api/pilot-start.mjs';
  if (fs.existsSync(pilotStartFile)) {
    try {
      let pilotStartCode = fs.readFileSync(pilotStartFile, 'utf8');
      if (!pilotStartCode.includes("'/integrations/bulk-campaign'")) {
        pilotStartCode = pilotStartCode.replace(
          "'/integrations/calendar','/calendar',",
          "'/integrations/calendar','/calendar','/integrations/bulk-campaign','/integrations/bulk-campaigns','/bulk-campaign','/bulk-campaigns',"
        );
        fs.unlinkSync(pilotStartFile);
        fs.writeFileSync(pilotStartFile, pilotStartCode, 'utf8');
      }
    } catch {
      // Ignore if pilot-start.mjs is immutable in parent layer
    }
  }

  // 6. Comprehensive in-container verification
  const c = await import('@thaara/contracts');
  if (!c.BULK_CAMPAIGN_EXECUTE_ACTION || !c.BulkCampaignKnowledgeContextSchema) {
    throw Error('Missing Bulk Campaign or Campaign Knowledge schemas in @thaara/contracts');
  }
  if (!c.WhatsAppConversationEnquirySchema || !c.CalendlyBookingEvidenceSchema) throw Error('Missing WhatsApp/Calendly contracts');
  if (!c.PHONE_AI_CALL_ACTION || typeof c.capturePhoneCallEvidence !== 'function') throw Error('Missing Phone/Sarvam contracts');
  if (!c.PhoneN8nCallSyncBatchRequestSchema || !c.PHONE_RECORDING_PLAYBACK_ACTION) throw Error('Missing Phone n8n Sync / Recording contracts');

  const p = await import('@thaara/policy');
  if (!p.defaultActionRegistry.get('campaign.bulk.execute')) throw Error('Missing campaign.bulk.execute in ActionRegistry');
  if (!p.defaultActionRegistry.get('phone.recordings.read')) throw Error('Missing phone.recordings.read in ActionRegistry');

  const bc = await import('/app/apps/api/dist/services/bulk-campaign.js');
  if (
    typeof bc.ingestCampaignKnowledgeFiles !== 'function' ||
    typeof bc.answerCampaignCustomerQuestion !== 'function' ||
    typeof bc.prepareSyntheticSimulationFromCampaign !== 'function' ||
    typeof bc.submitBulkCampaignN8nJob !== 'function' ||
    typeof bc.submitBulkCampaignMultiContactN8nJob !== 'function' ||
    typeof bc.emergencyStopAllBulkCampaignN8nJobs !== 'function' ||
    !Array.isArray(bc.SYNTHETIC_COMPANY_SIMULATION_CONTACTS) ||
    bc.SYNTHETIC_COMPANY_SIMULATION_CONTACTS.length !== 5
  ) {
    throw Error('Missing Campaign Knowledge, n8n orchestration, or 5-contact synthetic simulation functions in bulk-campaign.js');
  }
  const bck = await import('/app/apps/api/dist/services/bulk-campaign-knowledge.js');
  if (typeof bck.enrichOrUpgradeCampaignKnowledgeContext !== 'function') {
    throw Error('Missing improved DOCX knowledge enrichment in bulk-campaign-knowledge.js');
  }
  const samplePlan = bc.createBulkCampaignPlan({
    workspaceId: '11111111-1111-4111-8111-111111111111',
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    instruction: bc.DEFAULT_DEMO_INSTRUCTION,
    importResult: bc.parseBulkCampaignContacts({
      sourceType: 'csv',
      rawText: bc.SYNTHETIC_DEMO_CONTACTS_CSV,
      phoneDirectory: bc.DEFAULT_DEMO_PHONE_DIRECTORY
    }),
    knowledgeFiles: [
      {
        fileName: 'verify-agenda.txt',
        rawText: 'Speaker: Kaaranji Shreedhar\nAgenda: Practical AI Voice Agents\nRegistration: https://quantumweave.ai/join'
      }
    ]
  });
  if (
    samplePlan.liveCallingEnabled !== false ||
    samplePlan.liveSendingEnabled !== false ||
    samplePlan.executionMode !== 'planned' ||
    !samplePlan.knowledgeContext ||
    samplePlan.knowledgeContext.files[0]?.status !== 'processed'
  ) {
    throw Error('Simulation-only safety lock or knowledge ingestion failed on sample plan');
  }

  const chatVoiceCode = fs.readFileSync('/app/apps/api/dist/services/chat-voice-sarvam.js', 'utf8');
  if (!chatVoiceCode.includes('chaitra_kn_conversation') || !chatVoiceCode.includes('bulbul:v4-flash')) {
    throw Error('Missing Chaitra Chat Voice configuration (chaitra_kn_conversation / bulbul:v4-flash) in chat-voice-sarvam.js');
  }
  if (fs.existsSync('/app/apps/api/pilot-start.mjs')) {
    const pilotStartCheck = fs.readFileSync('/app/apps/api/pilot-start.mjs', 'utf8');
    if (!pilotStartCheck.includes('pilotChatVoiceApiKey') || !pilotStartCheck.includes("'/integrations/bulk-campaign'")) {
      throw Error('pilot-start.mjs missing pilotChatVoiceApiKey or Bulk Campaign SPA routes');
    }
  }

  const enq = await import('/app/apps/api/dist/services/whatsapp-enquiries.js');
  if (enq.QUANTUM_WEAVE_WHATSAPP_CONTACT_LINK !== 'https://wa.me/919972965677') throw Error('Invalid WhatsApp contact link');
  const sarvam = await import('/app/apps/api/dist/services/phone-sarvam-calls.js');
  if (typeof sarvam.createSarvamCallProvider !== 'function') throw Error('Missing Sarvam provider');
  const pns = await import('/app/apps/api/dist/services/phone-n8n-sync.js');
  if (typeof pns.PhoneN8nSyncService !== 'function') throw Error('Missing PhoneN8nSyncService');
  const pcm = await import('/app/apps/api/dist/services/phone-callback-mail.js');
  if (!pcm) throw Error('Missing phone-callback-mail.js');
  const appMod = await import('/app/apps/api/dist/app.js');
  if (typeof appMod.buildApp !== 'function') throw Error('Missing buildApp');

  const assets = fs.readdirSync('/app/apps/web/dist/assets');
  const jsBundle = assets.find(n => n.endsWith('.js') && n.startsWith('index-')) ?? assets.find(n => n.endsWith('.js'));
  if (!jsBundle) throw Error('Missing web JS bundle');
  const indexHtml = fs.readFileSync('/app/apps/web/dist/index.html', 'utf8');
  if (!indexHtml.includes('/assets/' + jsBundle)) {
    throw Error('index.html does not reference active JS bundle: ' + jsBundle);
  }
  if (!fs.existsSync('/app/apps/web/dist/assets/chat-voice-processor-v1.js')) throw Error('Missing chat-voice-processor-v1.js worklet');
  const webJs = fs.readFileSync('/app/apps/web/dist/assets/' + jsBundle, 'utf8');
  for (const marker of [
    'bulk-campaign-page',
    'Create a Campaign',
    'campaign-knowledge-plus-button',
    'prepare-campaign-primary-button',
    'simulation-mode-banner',
    'bulk-campaign-chat-card',
    'simplified-review-stage',
    'approve-and-start-campaign-button',
    'Engaged',
    'Not Aligned',
    'Further Discussion',
    'Transcript'
  ]) {
    if (!webJs.includes(marker)) throw Error('Web bundle missing marker: ' + marker);
  }
  console.log('Thaara Bulk Campaign release candidate verified in-container: Chaitra Voice, Phone History UI, Phone n8n Sync, Callback Email, WhatsApp, Drive, and Bulk Campaign Simulation intact.');
}

const isMainModule =
  process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isMainModule) {
  await runInContainerReconciliation();
}
