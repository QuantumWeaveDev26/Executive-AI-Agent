import { whatsappN8nRoutes } from './routes/whatsapp-n8n.js';
import { whatsappDurableInboxRoutes } from './routes/whatsapp-inbox.js';
import { DurableWhatsAppService, type DurableSendOptions } from './services/whatsapp-durable.js';
import { WhatsAppMediaPreviewService, createWhatsAppMediaPreviewAudit, type WhatsAppMediaProvider } from './services/whatsapp-media-preview.js';
import { WhatsAppTemplateService, type WhatsAppTemplateProvider } from './services/whatsapp-templates.js';
import { WhatsAppMediaUploadService, type WhatsAppMediaUploader } from './services/whatsapp-media-upload.js';
import { createWhatsAppUploadAdmission } from './services/whatsapp-upload-admission.js';
import { PostgresWhatsAppStateStore, PhoneContactRepository } from '@thaara/db';
import { N8nWhatsAppBridge } from './services/whatsapp-n8n.js';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastify, { FastifyInstance } from 'fastify';
import { Config, loadConfig } from '@thaara/config';
import { PostgresDatabase, TransactionalDbClient } from '@thaara/db';
import { Logger, defaultLogger, formatErrorResponse } from '@thaara/observability';
import { ConnectorAdapter, PolicyGateway, defaultPolicyGateway, defaultTestAdapter } from '@thaara/policy';
import { authPlugin } from './plugins/auth.js';
import { healthRoutes } from './routes/health.js';
import { bootstrapRoutes } from './routes/bootstrap.js';
import { authRoutes } from './routes/auth.js';
import { auditRoutes } from './routes/audit.js';
import { approvalRoutes } from './routes/approvals.js';
import { policyRoutes } from './routes/policy.js';
import { JobQueueService, jobRoutes } from './routes/jobs.js';
import { connectorRoutes } from './routes/connectors.js';
import { connectorDiagnosticsRoutes } from './routes/connector-diagnostics.js';
import { gmailRoutes } from './routes/gmail.js';
import { googleCalendarRoutes } from './routes/google-calendar.js';
import { googleDriveRoutes } from './routes/google-drive.js';
import { whatsappRoutes } from './routes/whatsapp.js';
import { phoneRoutes } from './routes/phone.js';
import { phoneCallingRoutes, phoneContactRoutes } from './routes/phone-calling.js';
import { phoneN8nSyncRoutes } from './routes/phone-n8n-sync.js';
import { phoneCallbackReportRoutes } from './routes/phone-callback-reports.js';
import { phoneCallbackAuthorizationRoutes } from './routes/phone-callback-authorization.js';
import { createRuntimePhoneN8nSyncService, type PhoneN8nSyncService } from './services/phone-n8n-sync.js';
import { PhoneContactManagementService } from './services/phone-contacts.js';
import { createPostgresPhoneContactDirectory } from './services/phone-contacts-postgres.js';
import { createPostgresPhoneCallLedger, createPostgresPhoneCallbackStore } from './services/phone-calls-postgres.js';
import { phoneProviderCallbackRoutes, type PhoneProviderCallbackOptions } from './routes/phone-provider-callbacks.js';
import { phoneSarvamWebhookRoutes } from './routes/phone-sarvam-webhook.js';
import { chatVoiceRoutes } from './routes/chat-voice.js';
import { createSarvamChatSpeech, type ChatSpeech } from './services/chat-voice-sarvam.js';
import type { PhoneCallProvider } from './services/phone-plivo.js';
import websocket from '@fastify/websocket';
import { PhoneCallingService, type PhoneCallingOptions } from './services/phone-calling.js';
import { createPhoneCallingStore } from './services/phone-calling-store.js';
import { isRuntimeLoadedPhoneProvider } from './services/phone-pilot-startup.js';
import { n8nRoutes } from './routes/n8n.js';
import { bulkCampaignRoutes } from './routes/bulk-campaign.js';
import { defaultBulkCampaignStore, resolveCampaignReplyContextForWhatsApp } from './services/bulk-campaign.js';
import { VerifiedDurableN8nTestDependency,verifiedDurableN8nOptions } from './services/n8n-durable-test.js';
import { N8nConnectionOptions } from './services/n8n-connections.js';
import { N8nCreateOnlyTransport } from '@thaara/policy';
import { GmailOptions } from './services/gmail.js';
import { GoogleCalendarOptions } from './services/google-calendar.js';
import { GoogleDriveService } from './services/google-drive.js';
import { WhatsAppOptions } from './services/whatsapp.js';
import { PhoneOptions } from './services/phone.js';
import { automationRoutes } from './routes/automations.js';
import { planRoutes } from './routes/plans.js';
import { conversationRoutes } from './routes/conversations.js';
import { memoryRoutes } from './routes/memories.js';
import { privacyRoutes } from './routes/privacy.js';
import { adminInspectionRoutes } from './routes/admin-inspection.js';
import { ModelGatewayAdapter, createModelGateway } from './services/model-gateway.js';

export interface BuildAppOptions {
  whatsappN8n?: N8nWhatsAppBridge;
  /** Separately approved pilot send options. Absent by default: claims stay dispatchEnabled=false and nothing is handed to n8n. */
  whatsappSend?: DurableSendOptions;
  /** Server-side Meta media adapter for owner image previews. Absent by default: previews report not_configured. */
  whatsappMedia?: WhatsAppMediaProvider;
  /** Server-side Meta template catalog adapter. Absent by default: templates report not_configured. */
  whatsappTemplates?: WhatsAppTemplateProvider;
  /** Server-side Meta media uploader for outbound attachments. Absent by default: uploads report not_configured. */
  whatsappMediaUpload?: WhatsAppMediaUploader;
  config?: Config;
  db?: TransactionalDbClient;
  logger?: Logger;
  policyGateway?: PolicyGateway;
  connectorAdapter?: ConnectorAdapter;
  queueService?: JobQueueService;
  modelGateway?: ModelGatewayAdapter;
  chatSpeech?: ChatSpeech;
  gmail?: GmailOptions;
  googleCalendar?: GoogleCalendarOptions;
  googleDrive?: GoogleDriveService;
  whatsapp?: WhatsAppOptions;
  whatsappAsyncAutoReply?: boolean;
  phone?: PhoneOptions;
  phoneN8nSync?: PhoneN8nSyncService;
  phoneInboundReports?: unknown;
  phoneCallbackReports?: unknown;
  phoneCallbackAuthorization?: unknown;
  phoneCallbackOutbound?: unknown;
  phoneInboundJournal?: unknown;
  phoneOwnerCalendarReview?: boolean;
  phoneAppointments?: {
    inbound?: unknown;
    inboundOwner?: unknown;
    outbound?: unknown;
  };
  /** durableContacts/durableCalls require the reviewed Step 110a/110b schemas; never enabled by default configuration. */
  /**
   * liveCalling places real calls. Outside tests it is accepted only from createPhoneStartup, after every runtime check passes.
   * Plivo callbacks additionally need a shared nonce store before any deployment.
   */
  phoneCalling?: PhoneCallingOptions & { durableContacts?: boolean; durableCalls?: boolean;
    liveCalling?: { provider: PhoneCallProvider; dailyCallLimit?: number; callbacks?: Omit<PhoneProviderCallbackOptions, 'store'>;
      /** Sarvam Voice Agents result webhook (per-call capability URL; Sarvam signs nothing). */
      sarvamWebhook?: { webhookSecret: () => Promise<string> } } };
  n8nTransports?: ReadonlyMap<string,N8nCreateOnlyTransport>;
  n8nConnections?: N8nConnectionOptions;
  n8nDurable?: VerifiedDurableN8nTestDependency;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  function captureOwnerPort(key: 'phoneCallbackReports' | 'phoneCallbackAuthorization') {
    const d = Object.getOwnPropertyDescriptor(options, key);
    if ((key in options && !d) || (d && !Object.hasOwn(d, 'value'))) {
      throw new Error('Phone callback owner production admission was denied.');
    }
    return d?.value;
  }
  const callbackOwnerReports = captureOwnerPort('phoneCallbackReports');
  const callbackOwnerAuthorization = captureOwnerPort('phoneCallbackAuthorization');
  for (const [value, kind] of [[callbackOwnerReports, 'reports'], [callbackOwnerAuthorization, 'authorization']] as const) {
    if (value !== undefined && config.NODE_ENV !== 'test') {
      const modPath = '../phone-callback-owner-admission.mjs';
      const admission = (await import(modPath)) as { isAdmittedPhoneCallbackOwnerPort(v: unknown, k: string): boolean };
      if (!Object.isFrozen(value) || !admission.isAdmittedPhoneCallbackOwnerPort(value, kind)) {
        throw new Error('Phone callback owner production admission was denied.');
      }
    }
  }
  if(options.phoneCallbackOutbound && (config.NODE_ENV!=='test' || !options.phoneCalling?.durableContacts ||
    !options.phoneCalling?.durableCalls || !options.phoneCalling.liveCalling?.sarvamWebhook))throw new Error('Outbound callback integration requires its admitted local dependencies.');
  if(options.phoneOwnerCalendarReview!==undefined&&typeof options.phoneOwnerCalendarReview!=='boolean')throw new Error('Invalid owner Calendar review switch.');
  if(options.phoneOwnerCalendarReview){
    if(options.phoneCalling?.durableContacts!==true||options.phoneCalling?.durableCalls!==true||options.phoneCalling.calls)throw new Error('Owner Calendar review requires the existing durable Phone ledger.');
    if(options.phoneAppointments?.outbound)throw new Error('Use one outbound appointment review service.');
    if(config.NODE_ENV!=='test'&&options.googleCalendar?.provider?.mode!=='live')throw new Error('Owner Calendar review requires the existing live Calendar connector.');
  }
  if(options.phoneAppointments&&config.NODE_ENV!=='test')throw new Error('Phone appointments are test-only pending production admission.');
  if(options.phoneInboundJournal&&config.NODE_ENV!=='test')throw new Error('Inbound journal feed is test-only pending production admission.');
  if(options.phoneInboundReports&&config.NODE_ENV!=='test')throw new Error('Inbound phone report reader is test-only pending durable admission.');
  if (options.whatsappN8n && config.NODE_ENV !== 'test') throw new Error('WhatsApp n8n bridge configuration is test-only.');
  if (options.gmail && config.NODE_ENV !== 'test' && options.gmail.provider?.mode !== 'live') throw new Error('Gmail mock infrastructure is test-only.');
  if (options.googleCalendar && config.NODE_ENV !== 'test' && options.googleCalendar.provider?.mode !== 'live') throw new Error('Google Calendar mock infrastructure is test-only.');
  if (options.whatsapp && config.NODE_ENV !== 'test') throw new Error('WhatsApp mock infrastructure is test-only.');
  if (options.phone && config.NODE_ENV !== 'test') throw new Error('Phone telephony mock infrastructure is test-only.');
  if (options.phoneCalling?.simulation && config.NODE_ENV !== 'test') throw new Error('Phone calling simulation is test-only.');
  if (options.phoneCalling?.liveCalling && config.NODE_ENV !== 'test' && !isRuntimeLoadedPhoneProvider(options.phoneCalling.liveCalling.provider)) throw new Error('Live phone calling is not approved outside the verified runtime loader.');
  if (options.phoneCalling?.reportVoice && config.NODE_ENV !== 'test') throw new Error('Provider report speech is not approved for deployment yet.');
  if (config.NODE_ENV !== 'test' && [...(options.n8nTransports?.values() ?? [])].some(t=>t.mode==='mock'))
    throw new Error('n8n mock infrastructure is test-only.');
  if(options.n8nConnections && config.NODE_ENV !== 'test') throw new Error('n8n ephemeral connection management is test-only.');
  if(options.n8nConnections && options.n8nTransports?.size) throw new Error('Use one n8n connection source per application.');
  if(options.n8nDurable && (options.n8nConnections || options.n8nTransports?.size)) throw new Error('Use one n8n connection source per application.');
  const durable=options.n8nDurable?verifiedDurableN8nOptions(options.n8nDurable,config,options.db??options.n8nDurable.db):undefined;
  const logger = options.logger ?? defaultLogger;
  const db = options.db ?? options.n8nDurable?.db ?? new PostgresDatabase(config.DATABASE_URL);
  const policyGateway = options.policyGateway ?? defaultPolicyGateway;
  const connectorAdapter = options.connectorAdapter ?? defaultTestAdapter;
  const modelGateway = options.modelGateway ?? createModelGateway(config);

  const app = fastify({
    bodyLimit: 1048576, // 1MB limit
    logger: false // Use custom structured redacted logger
  });

  // 1. Security Headers (Helmet)
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        // Verified WhatsApp audio plays from a same-origin blob created after server-side verification.
        mediaSrc: ["'self'", 'blob:']
      }
    },
    crossOriginEmbedderPolicy: false
  });

  // 2. CORS Allow-List
  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps, curl, server-to-server)
      if (!origin || origin === config.CORS_ORIGIN) {
        cb(null, true);
        return;
      }
      cb(new Error('CORS origin not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  });

  // 3. Cookie Parser
  await app.register(fastifyCookie, {
    secret: config.SESSION_SECRET
  });

  // 4. Rate Limiting
  await app.register(fastifyRateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_TIME_WINDOW_MS
  });

  // 5. OpenAPI Documentation
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'THAARA V2 Executive Platform API',
        description: 'Multi-tenant Executive AI Operating System API contracts',
        version: '0.1.0'
      },
      servers: [
        {
          url: `http://${config.HOST}:${config.PORT}`,
          description: 'Local development server'
        }
      ]
    }
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false
    }
  });

  // 6. Custom Redacted Structured Logging Hook
  app.addHook('onResponse', async (request, reply) => {
    logger.info('HTTP Request Handled', {
      correlationId: request.correlationId,
      workspaceId: request.scope?.workspaceId,
      userId: request.scope?.userId,
      context: {
        method: request.method,
        // OAuth authorization codes/state and private searches must never enter request logs.
        url: /^\/api\/v1\/connectors\/phone\/sarvam\/calls(?:\/|$)/.test(request.url)
          ? '/api/v1/connectors/phone/sarvam/calls/[redacted]'
          : request.url.split('?')[0],
        statusCode: reply.statusCode,
        responseTimeMs: reply.elapsedTime
      }
    });
  });

  // 7. Sanitized Error Handler (No stack traces or secrets leaked)
  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { code?: string };
    logger.error('Unhandled Route Error', {
      correlationId: request.correlationId,
      workspaceId: request.scope?.workspaceId,
      error: {
        name: err.name || 'Error',
        message: err.message || 'Unknown error',
        code: err.code
      }
    });

    if (reply.sent || reply.raw.headersSent) {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        try {
          reply.raw.end();
        } catch {
          // Socket already closed by client
        }
      }
      return;
    }

    if ((err as { statusCode?: number }).statusCode === 429) {
      reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait a moment and try again.'
        }
      });
      return;
    }

    const { statusCode, body } = formatErrorResponse(error);
    reply.status(statusCode).send(body);
  });

  // 8. Auth & Scope Resolution Plugin
  await app.register(authPlugin, { db });
  // WebSocket support exists only when a live voice runtime is configured (test-only until a separately approved deployment).
  if (options.phoneCalling?.liveCalling?.callbacks?.voice) await app.register(websocket, { options: { maxPayload: 65536 } });

  // 9. API v1 Routes
  await app.register(
    async (v1) => {
      await healthRoutes(v1);
      await bootstrapRoutes(v1, { db, config });
      await authRoutes(v1, { db, config });
      await chatVoiceRoutes(v1, {
        db,
        speech:
          options.chatSpeech ??
          createSarvamChatSpeech({
            enabled:
              process.env.THAARA_CHAT_VOICE_ENABLED === 'true' &&
              Boolean(process.env.THAARA_CHAT_SARVAM_API_KEY),
            key: () => process.env.THAARA_CHAT_SARVAM_API_KEY ?? ''
          })
      });
      await auditRoutes(v1, { db });
      const gmailDiagnostics=await gmailRoutes(v1, { db, policyGateway, gmail: options.gmail });
      const googleCalendarService = await googleCalendarRoutes(v1, {
        db,
        policyGateway,
        googleCalendar: options.googleCalendar
      });
      const googleDriveService = await googleDriveRoutes(v1, {
        db,
        policyGateway,
        modelGateway,
        googleDrive: options.googleDrive
      });
      const durableWhatsApp = new DurableWhatsAppService(
        new PostgresWhatsAppStateStore(db),
        policyGateway,
        Date.now,
        options.whatsappSend,
        {
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
        }
      );
      await approvalRoutes(v1, {
        db,
        whatsappDurable: durableWhatsApp,
        queueService: options.queueService,
        gmail: gmailDiagnostics.service,
        googleCalendar: googleCalendarService,
        ...(callbackOwnerAuthorization ? { phoneCallbackAuthorization: callbackOwnerAuthorization } : {})
      } as Parameters<typeof approvalRoutes>[1]);
      await policyRoutes(v1, { db, policyGateway });
      await jobRoutes(v1, { db, queueService: options.queueService });
      await connectorRoutes(v1, { adapter: connectorAdapter });
      const whatsappService = await whatsappRoutes(v1, {
        db,
        policyGateway,
        whatsapp: options.whatsapp
      });
      await v1.register(async child => { await whatsappN8nRoutes(child, options.whatsappN8n, options.whatsappN8n ? undefined : durableWhatsApp); });
      const whatsappMediaPreview = new WhatsAppMediaPreviewService(durableWhatsApp, policyGateway, createWhatsAppMediaPreviewAudit(db), options.whatsappMedia);
      const whatsappTemplateService = new WhatsAppTemplateService(durableWhatsApp, options.whatsappTemplates);
      await v1.register(async child => {
        await whatsappDurableInboxRoutes(
          child,
          durableWhatsApp,
          whatsappMediaPreview,
          whatsappTemplateService,
          new WhatsAppMediaUploadService(durableWhatsApp, createWhatsAppMediaPreviewAudit(db), options.whatsappMediaUpload, Date.now, createWhatsAppUploadAdmission(db, policyGateway)),
          googleCalendarService,
          db
        );
      });
      const phoneService = await phoneRoutes(v1, {
        db,
        policyGateway,
        phone: options.phone
      });
      const {durableContacts,durableCalls,liveCalling,...phoneCallingOptions}=options.phoneCalling??{};
      if(durableContacts&&phoneCallingOptions.contacts)throw new Error('Use one phone contact source per application.');
      if(durableCalls&&(phoneCallingOptions.calls||!durableContacts))throw new Error('Durable phone calls need durable contacts and one call ledger.');
      if(phoneCallingOptions.live||(liveCalling&&!durableCalls))throw new Error('Live phone calling is configured only through liveCalling with durable calls.');
      const callLedger=durableCalls?createPostgresPhoneCallLedger(db):undefined;
      const phoneCalling=new PhoneCallingService({...phoneCallingOptions,...(durableContacts?{contacts:createPostgresPhoneContactDirectory(db)}:{}),...(callLedger?{calls:callLedger}:{}),
        ...(liveCalling&&callLedger?{live:{provider:liveCalling.provider,store:callLedger,dailyCallLimit:liveCalling.dailyCallLimit}}:{}),store:createPhoneCallingStore(db),policy:policyGateway});
      const activePhoneN8nSync = options.phoneN8nSync ?? (config.NODE_ENV !== 'test' && durableCalls
        ? createRuntimePhoneN8nSyncService({ db, policyGateway })
        : undefined);
      await phoneCallingRoutes(v1,phoneCalling,activePhoneN8nSync);
      await phoneN8nSyncRoutes(v1,{syncService:activePhoneN8nSync,phoneCalling});
      if(liveCalling?.callbacks)await phoneProviderCallbackRoutes(v1,{...liveCalling.callbacks,store:createPostgresPhoneCallbackStore(db)});
      if(liveCalling?.sarvamWebhook)await phoneSarvamWebhookRoutes(v1,{webhookSecret:liveCalling.sarvamWebhook.webhookSecret,store:createPostgresPhoneCallbackStore(db)});
      const phoneContactManagementService = new PhoneContactManagementService(durableContacts?new PhoneContactRepository(db):undefined);
      await phoneContactRoutes(v1,phoneContactManagementService);
      await phoneCallbackReportRoutes(v1, callbackOwnerReports as Parameters<typeof phoneCallbackReportRoutes>[1]);
      if (callbackOwnerAuthorization) {
        await phoneCallbackAuthorizationRoutes(v1, callbackOwnerAuthorization as Parameters<typeof phoneCallbackAuthorizationRoutes>[1]);
      }
      const n8nDiagnostics=await n8nRoutes(v1, { db, policyGateway, transports: options.n8nTransports, connections: options.n8nConnections, durable });
      await connectorDiagnosticsRoutes(v1,{db,policyGateway,readers:[gmailDiagnostics,n8nDiagnostics]});
      await planRoutes(v1, { db, queueService: options.queueService });
      await automationRoutes(v1, { db });
      await bulkCampaignRoutes(v1, {
        db,
        phoneCalling,
        phoneN8nSync: activePhoneN8nSync,
        phoneContacts: phoneContactManagementService,
        phoneFallbackDirectory: phoneCallingOptions.contacts,
        dailyPhoneCallLimit: liveCalling?.dailyCallLimit,
        whatsappDurable: durableWhatsApp,
        whatsappTemplates: whatsappTemplateService,
        gmail: gmailDiagnostics.service,
        googleDrive: googleDriveService
      });
      await conversationRoutes(v1, {
        db,
        modelGateway,
        policyGateway,
        queueService: options.queueService,
        gmail: gmailDiagnostics.service,
        googleCalendar: googleCalendarService,
        googleDrive: googleDriveService,
        whatsapp: whatsappService,
        phone: phoneService,
        phoneCalling,
        phoneContacts: phoneContactManagementService,
        phoneFallbackDirectory: phoneCallingOptions.contacts,
        whatsappDurable: durableWhatsApp,
        whatsappTemplates: whatsappTemplateService
      });
      await memoryRoutes(v1, { db });
      await privacyRoutes(v1, { db });
      await adminInspectionRoutes(v1, { db });
    },
    { prefix: '/api/v1' }
  );

  return app;
}
