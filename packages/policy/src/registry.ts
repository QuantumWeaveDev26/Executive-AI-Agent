import { TSchema, Static, Type } from '@sinclair/typebox';
import { TypeCompiler, TypeCheck } from '@sinclair/typebox/compiler';
import { WHATSAPP_MEDIA_UPLOAD_ACTION, WhatsAppUploadIntentSchema } from '@thaara/contracts';
import {PHONE_CALL_RESULT_READ_ACTION} from '@thaara/contracts';
import {
  ActionMetadata,
  ActionClass,
  RiskLevel,
  ApprovalMode,
  RetryPolicy,
  Role,
  CapabilityScope,
  BULK_CAMPAIGN_EXECUTE_ACTION,
  ComposeEmailWorkflowInputSchema,
  DryRunEmailWorkflowInputSchema,
  N8nCreateInactiveSchema, N8nConfigureConnectionSchema,
  GmailEmptySchema, GmailSearchSchema, GmailCallbackSchema, GmailMessageIdSchema, GmailSendReplyInputSchema, GmailSendNewInputSchema,
  GoogleCalendarEmptySchema, GoogleCalendarCallbackSchema, GoogleCalendarEventIdSchema,
  GoogleCalendarListEventsSchema, GoogleCalendarAgendaQuerySchema, GoogleCalendarBriefingQuerySchema,
  GoogleCalendarCreateEventInputSchema, GoogleCalendarRescheduleEventInputSchema, GoogleCalendarCancelEventInputSchema,
  GOOGLE_DRIVE_STATUS_ACTION, GOOGLE_DRIVE_SEARCH_ACTION, GOOGLE_DRIVE_LIST_FOLDER_ACTION,
  GOOGLE_DRIVE_READ_FILE_ACTION, GOOGLE_DRIVE_SUMMARIZE_FILE_ACTION, GOOGLE_DRIVE_CREATE_FOLDER_ACTION,
  GOOGLE_DRIVE_CREATE_DOC_ACTION, GOOGLE_DRIVE_UPLOAD_FILE_ACTION, GOOGLE_DRIVE_RENAME_MOVE_ACTION,
  GOOGLE_DRIVE_SHARE_FILE_ACTION, GOOGLE_DRIVE_DELETE_FILE_ACTION,
  GoogleDriveEmptySchema, GoogleDriveSearchInputSchema, GoogleDriveListFolderInputSchema,
  GoogleDriveReadFileInputSchema, GoogleDriveCreateFolderInputSchema, GoogleDriveCreateDocInputSchema,
  GoogleDriveUploadInputSchema, GoogleDriveRenameMoveInputSchema, GoogleDriveShareInputSchema,
  GoogleDriveDeleteInputSchema,
  WhatsAppEmptySchema, WhatsAppConnectInputSchema, WhatsAppListMessagesSchema, WhatsAppMessageIdSchema, WhatsAppSendMessageDraftSchema, WhatsAppBriefingQuerySchema,
  PhoneEmptySchema, PhoneConnectInputSchema, PhoneListCallsSchema, PhoneCallIdSchema, PhoneOutboundCallRequestSchema, PhoneBriefingQuerySchema,
  PhoneCallingDraftSchema, PHONE_AI_CALL_ACTION, PhoneCallingSpeechRequestSchema, PHONE_REPORT_SPEECH_ACTION,
  PHONE_RECORDING_PLAYBACK_ACTION, PhoneRecordingPlaybackInputSchema,
  MetaWhatsAppAnySendInputSchema,
  MetaProviderMessageIdSchema,
  StageEmailWorkflowArtifactInputSchema
} from '@thaara/contracts';

export interface RegisteredActionDefinition<T extends TSchema = TSchema> {
  metadata: ActionMetadata;
  inputSchema: T;
  compiledCheck: TypeCheck<T>;
  validate(params: unknown): params is Static<T>;

  readonly name: string;
  readonly actionClass: ActionClass;
  readonly risk: RiskLevel;
  readonly approvalMode: ApprovalMode;
  readonly idempotencyRequired: boolean;
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicy;
  readonly requiredRole: Role;
  readonly auditRequired: boolean;
  readonly capabilityScope: CapabilityScope;
  readonly schemaIdentifier: string;
}

export interface ActionRegistrationInput<T extends TSchema = TSchema> {
  metadata: Omit<ActionMetadata, 'schemaIdentifier'> & {
    schemaIdentifier?: string;
  };
  inputSchema?: T;
}

export type ActionRegistration<T extends TSchema = TSchema> =
  | ActionRegistrationInput<T>
  | (Omit<ActionMetadata, 'schemaIdentifier'> & {
      schemaIdentifier?: string;
      inputSchema?: T;
    });

export class ActionRegistry {
  private actions = new Map<string, RegisteredActionDefinition>();

  constructor() {
    this.registerDefaultActions();
  }

  register<T extends TSchema = TSchema>(input: ActionRegistration<T>): RegisteredActionDefinition<T> {
    const metadataInput = 'metadata' in input ? input.metadata : input;
    const inputSchema = (('inputSchema' in input && input.inputSchema)
      ? input.inputSchema
      : Type.Object({}, { additionalProperties: true })) as T;

    const rawCapabilityScope = (metadataInput as { capabilityScope?: unknown }).capabilityScope;
    if (rawCapabilityScope !== 'core_system' && rawCapabilityScope !== 'external_connector') {
      throw new Error(
        `Action registration for '${metadataInput.name}' must explicitly provide a valid capabilityScope ('core_system' | 'external_connector'). Received: '${String(rawCapabilityScope)}'`
      );
    }
    const capabilityScope: CapabilityScope = rawCapabilityScope;
    const schemaIdentifier = metadataInput.schemaIdentifier ?? `${metadataInput.name}.v1`;

    const metadata: ActionMetadata = {
      name: metadataInput.name,
      actionClass: metadataInput.actionClass,
      risk: metadataInput.risk,
      approvalMode: metadataInput.approvalMode,
      idempotencyRequired: metadataInput.idempotencyRequired,
      timeoutMs: metadataInput.timeoutMs,
      retryPolicy: metadataInput.retryPolicy,
      requiredRole: metadataInput.requiredRole,
      auditRequired: metadataInput.auditRequired,
      capabilityScope,
      schemaIdentifier
    };

    const compiledCheck = TypeCompiler.Compile(inputSchema);

    const actionDef: RegisteredActionDefinition<T> = {
      metadata,
      inputSchema,
      compiledCheck,
      validate: (params: unknown): params is Static<T> => compiledCheck.Check(params),
      get name() { return metadata.name; },
      get actionClass() { return metadata.actionClass; },
      get risk() { return metadata.risk; },
      get approvalMode() { return metadata.approvalMode; },
      get idempotencyRequired() { return metadata.idempotencyRequired; },
      get timeoutMs() { return metadata.timeoutMs; },
      get retryPolicy() { return metadata.retryPolicy; },
      get requiredRole() { return metadata.requiredRole; },
      get auditRequired() { return metadata.auditRequired; },
      get capabilityScope() { return metadata.capabilityScope; },
      get schemaIdentifier() { return metadata.schemaIdentifier; }
    };

    this.actions.set(metadata.name, actionDef as unknown as RegisteredActionDefinition);
    return actionDef;
  }

  get(name: string): RegisteredActionDefinition | undefined {
    return this.actions.get(name);
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  list(): RegisteredActionDefinition[] {
    return Array.from(this.actions.values());
  }

  private registerDefaultActions(): void {
    this.register({metadata:{name:'automation.n8n.create_inactive_workflow',actionClass:'write',risk:'medium',
      approvalMode:'explicit',idempotencyRequired:true,timeoutMs:30000,
      retryPolicy:{maxRetries:0,backoffMs:100,exponential:false},requiredRole:'admin',
      auditRequired:true,capabilityScope:'external_connector',schemaIdentifier:'automation.n8n.create_inactive_workflow.v1'},
      inputSchema:N8nCreateInactiveSchema});


    this.register({metadata:{name:'connectors.diagnostics',requiredRole:'admin',actionClass:'read',risk:'low',approvalMode:'none',
      idempotencyRequired:false,timeoutMs:10000,retryPolicy:{maxRetries:0,backoffMs:100,exponential:false},
      auditRequired:false,capabilityScope:'external_connector',schemaIdentifier:'connectors.diagnostics.v1'},inputSchema:Type.Object({},{additionalProperties:false})});
    // Local admin controls only; external workflow mutations retain their separate explicit approval.
    for(const [name,inputSchema,actionClass] of [
      ['n8n.connection.manage_status',Type.Object({},{additionalProperties:false}),'read'],
      ['n8n.connection.configure',N8nConfigureConnectionSchema,'write'],
      ['n8n.connection.disconnect',Type.Object({},{additionalProperties:false}),'write']
    ] as const)this.register({metadata:{name,requiredRole:'admin',actionClass,risk:'low',approvalMode:'none',
      idempotencyRequired:false,timeoutMs:10000,retryPolicy:{maxRetries:0,backoffMs:100,exponential:false},
      auditRequired:true,capabilityScope:'external_connector',schemaIdentifier:name+'.v1'},inputSchema});
    // Connection operations are explicit authenticated user controls, never model-dispatched adapters.
    // External email sending requires explicit user approval via gmail.messages.send_reply or gmail.messages.send_new.
    for (const [name,inputSchema,requiredRole,actionClass] of [
      ['gmail.connection.status',GmailEmptySchema,'viewer','read'],
      ['gmail.connection.start',GmailEmptySchema,'member','write'],
      ['gmail.connection.complete',GmailCallbackSchema,'member','write'],
      ['gmail.connection.disconnect',GmailEmptySchema,'member','write'],
      ['gmail.messages.search',GmailSearchSchema,'member','read'],
      ['gmail.messages.read',Type.Object({messageId:GmailMessageIdSchema},{additionalProperties:false}),'member','read'],
      ['calendar.connection.status',GoogleCalendarEmptySchema,'viewer','read'],
      ['calendar.connection.start',GoogleCalendarEmptySchema,'member','write'],
      ['calendar.connection.complete',GoogleCalendarCallbackSchema,'member','write'],
      ['calendar.connection.disconnect',GoogleCalendarEmptySchema,'member','write'],
      ['calendar.events.list',GoogleCalendarListEventsSchema,'member','read'],
      ['calendar.events.read',Type.Object({eventId:GoogleCalendarEventIdSchema},{additionalProperties:false}),'member','read'],
      ['calendar.agenda.read',GoogleCalendarAgendaQuerySchema,'member','read'],
      ['calendar.briefing.prepare',GoogleCalendarBriefingQuerySchema,'member','read']
    ] as const) {
      this.register({metadata:{name,requiredRole,actionClass,risk:'low',approvalMode:'none',
        idempotencyRequired:false,timeoutMs:10000,retryPolicy:{maxRetries:0,backoffMs:100,exponential:false},
        auditRequired:name!=='gmail.connection.status'&&name!=='calendar.connection.status',capabilityScope:'external_connector',schemaIdentifier:name+'.v1'},inputSchema});
    }

    this.register({
      metadata: {
        name: 'gmail.messages.send_reply',
        actionClass: 'write',
        risk: 'medium',
        approvalMode: 'explicit',
        idempotencyRequired: true,
        timeoutMs: 15000,
        retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'gmail.messages.send_reply.v1'
      },
      inputSchema: GmailSendReplyInputSchema
    });

    // Step 106: brand-new standalone email to any valid address. Governed separately from replies so
    // approvals, audit records and receipts can never be confused between a threaded reply and a new email.
    this.register({
      metadata: {
        name: 'gmail.messages.send_new',
        actionClass: 'write',
        risk: 'medium',
        approvalMode: 'explicit',
        idempotencyRequired: true,
        timeoutMs: 15000,
        retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'gmail.messages.send_new.v1'
      },
      inputSchema: GmailSendNewInputSchema
    });

    // Step 107.5: governed Google Calendar mutations (create, reschedule, cancel) with explicit approval,
    // idempotency, zero automatic retries, and verified provider receipts.
    for (const [name, inputSchema] of [
      ['calendar.events.create', GoogleCalendarCreateEventInputSchema],
      ['calendar.events.reschedule', GoogleCalendarRescheduleEventInputSchema],
      ['calendar.events.cancel', GoogleCalendarCancelEventInputSchema]
    ] as const) {
      this.register({
        metadata: {
          name,
          actionClass: 'write',
          risk: 'medium',
          approvalMode: 'explicit',
          idempotencyRequired: true,
          timeoutMs: 15000,
          retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
          requiredRole: 'member',
          auditRequired: true,
          capabilityScope: 'external_connector',
          schemaIdentifier: `${name}.v1`
        },
        inputSchema
      });
    }

    // 1. Read action: safe read
    this.register({
      metadata: {
        name: 'system.read_status',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 2, backoffMs: 200, exponential: true },
        requiredRole: 'viewer',
        auditRequired: false,
        capabilityScope: 'core_system',
        schemaIdentifier: 'system.read_status.v1'
      },
      inputSchema: Type.Object({}, { additionalProperties: false })
    });

    // 2. Mutating action requiring explicit approval and idempotency
    this.register({
      metadata: {
        name: 'system.reset_connector',
        actionClass: 'write',
        risk: 'high',
        approvalMode: 'explicit',
        idempotencyRequired: true,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 3, backoffMs: 500, exponential: true },
        requiredRole: 'admin',
        auditRequired: true,
        capabilityScope: 'core_system',
        schemaIdentifier: 'system.reset_connector.v1'
      },
      inputSchema: Type.Object(
        {
          connectorName: Type.Optional(Type.String({ minLength: 1 }))
        },
        { additionalProperties: false }
      )
    });

    // 3. Critical mutating action requiring two_person approval
    this.register({
      metadata: {
        name: 'workspace.delete_data',
        actionClass: 'write',
        risk: 'critical',
        approvalMode: 'two_person',
        idempotencyRequired: true,
        timeoutMs: 30000,
        retryPolicy: { maxRetries: 1, backoffMs: 1000, exponential: false },
        requiredRole: 'owner',
        auditRequired: true,
        capabilityScope: 'core_system',
        schemaIdentifier: 'workspace.delete_data.v1'
      },
      inputSchema: Type.Object(
        {
          confirmation: Type.Optional(Type.String())
        },
        { additionalProperties: false }
      )
    });

    // 4. Test actions for deterministic verification, idempotency, and truthful outcomes
    this.register({
      metadata: {
        name: 'test.deterministic_hash_task',
        actionClass: 'write',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: true,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 2, backoffMs: 200, exponential: true },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'core_system',
        schemaIdentifier: 'test.deterministic_hash_task.v1'
      },
      inputSchema: Type.Object(
        {
          task: Type.Optional(Type.String()),
          payload: Type.Optional(Type.String())
        },
        { additionalProperties: true }
      )
    });

    this.register({
      metadata: {
        name: 'test.approval_gated_hash_task',
        actionClass: 'write',
        risk: 'medium',
        approvalMode: 'explicit',
        idempotencyRequired: true,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 2, backoffMs: 200, exponential: true },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'core_system',
        schemaIdentifier: 'test.approval_gated_hash_task.v1'
      },
      inputSchema: Type.Object(
        {
          task: Type.Optional(Type.String()),
          workflowName: Type.Optional(Type.String())
        },
        { additionalProperties: true }
      )
    });

    this.register({
      metadata: {
        name: 'test.unverified_task',
        actionClass: 'write',
        risk: 'medium',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 1, backoffMs: 200, exponential: false },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'core_system',
        schemaIdentifier: 'test.unverified_task.v1'
      },
      inputSchema: Type.Object(
        {
          task: Type.Optional(Type.String())
        },
        { additionalProperties: true }
      )
    });

    this.register({
      metadata: {
        name: 'test.failing_task',
        actionClass: 'write',
        risk: 'medium',
        approvalMode: 'none',
        idempotencyRequired: true,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 2, backoffMs: 100, exponential: false },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'core_system',
        schemaIdentifier: 'test.failing_task.v1'
      },
      inputSchema: Type.Object(
        {
          task: Type.Optional(Type.String()),
          errorMessage: Type.Optional(Type.String())
        },
        { additionalProperties: true }
      )
    });

    this.register({
      metadata: {
        name: 'test.not_configured_task',
        actionClass: 'write',
        risk: 'high',
        approvalMode: 'none',
        idempotencyRequired: true,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 1, backoffMs: 200, exponential: false },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'core_system',
        schemaIdentifier: 'test.not_configured_task.v1'
      },
      inputSchema: Type.Object(
        {
          task: Type.Optional(Type.String())
        },
        { additionalProperties: true }
      )
    });

    // 5. Disabled external connector stub declarations for Task 004
    this.register({
      metadata: {
        name: 'connector.mcp.disabled_stub',
        actionClass: 'write',
        risk: 'high',
        approvalMode: 'explicit',
        idempotencyRequired: true,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 1, backoffMs: 500, exponential: false },
        requiredRole: 'admin',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'connector.mcp.disabled_stub.v1'
      },
      inputSchema: Type.Object({}, { additionalProperties: false })
    });

    this.register({
      metadata: {
        name: 'connector.n8n.disabled_stub',
        actionClass: 'write',
        risk: 'high',
        approvalMode: 'explicit',
        idempotencyRequired: true,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 1, backoffMs: 500, exponential: false },
        requiredRole: 'admin',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'connector.n8n.disabled_stub.v1'
      },
      inputSchema: Type.Object({}, { additionalProperties: false })
    });

    // 6. Phase 1A: Safe offline email automation workflow composition and sandbox dry-run testing
    this.register({
      metadata: {
        name: 'automation.email.compose_workflow',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 2, backoffMs: 200, exponential: true },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'core_system',
        schemaIdentifier: 'automation.email.compose_workflow.v1'
      },
      inputSchema: ComposeEmailWorkflowInputSchema
    });

    this.register({
      metadata: {
        name: 'automation.email.dry_run_test',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 2, backoffMs: 200, exponential: true },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'core_system',
        schemaIdentifier: 'automation.email.dry_run_test.v1'
      },
      inputSchema: DryRunEmailWorkflowInputSchema
    });

    // 7. Phase 1B: Approval-gated offline email workflow artifact staging (write, explicit approval, inactive only)
    this.register({
      metadata: {
        name: 'automation.email.stage_workflow_artifact',
        actionClass: 'write',
        risk: 'medium',
        approvalMode: 'explicit',
        idempotencyRequired: true,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 2, backoffMs: 200, exponential: true },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'core_system',
        schemaIdentifier: 'automation.email.stage_workflow_artifact.v1'
      },
      inputSchema: StageEmailWorkflowArtifactInputSchema
    });

    // Step 108.22: owner-scoped, audited read-only preview of a saved incoming image (no send, no storage).
    this.register({
      metadata: {
        name: 'whatsapp.media.preview', actionClass: 'read', risk: 'low',
        approvalMode: 'none', idempotencyRequired: false, timeoutMs: 20000,
        retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
        requiredRole: 'member', auditRequired: true, capabilityScope: 'external_connector',
        schemaIdentifier: 'whatsapp.media.preview.v1'
      },
      inputSchema: Type.Object({ connectionId: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,128}$' }), providerMessageId: MetaProviderMessageIdSchema }, { additionalProperties: false })
    });

    this.register({ metadata: { name: WHATSAPP_MEDIA_UPLOAD_ACTION, actionClass: 'write', risk: 'high', approvalMode: 'explicit',
      idempotencyRequired: true, timeoutMs: 30000, retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
      requiredRole: 'member', auditRequired: true, capabilityScope: 'external_connector', schemaIdentifier: 'whatsapp.meta.media.upload.v1' }, inputSchema: WhatsAppUploadIntentSchema });

    // Step 108.1: separate Meta test send contract; no runtime transport is registered.
    this.register({
      metadata: {
        name: 'whatsapp.meta.messages.send', actionClass: 'write', risk: 'high',
        approvalMode: 'explicit', idempotencyRequired: true, timeoutMs: 10000,
        retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
        requiredRole: 'member', auditRequired: true, capabilityScope: 'external_connector',
        schemaIdentifier: 'whatsapp.meta.messages.send.v1'
      },
      // Step 108.25: text, approved-template or media draft (exactly one; enforced again by the service and migration 10825).
      inputSchema: MetaWhatsAppAnySendInputSchema
    });

    // 8. Step 91: WhatsApp Business read-only foundation + approval-gated outbound send contract
    this.register({
      metadata: {
        name: 'whatsapp.connection.status',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 1, backoffMs: 200, exponential: true },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'whatsapp.connection.status.v1'
      },
      inputSchema: WhatsAppEmptySchema
    });

    this.register({
      metadata: {
        name: 'whatsapp.connection.connect',
        actionClass: 'write',
        risk: 'medium',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'whatsapp.connection.connect.v1'
      },
      inputSchema: WhatsAppConnectInputSchema
    });

    this.register({
      metadata: {
        name: 'whatsapp.connection.disconnect',
        actionClass: 'write',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'whatsapp.connection.disconnect.v1'
      },
      inputSchema: WhatsAppEmptySchema
    });

    this.register({
      metadata: {
        name: 'whatsapp.messages.list',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 1, backoffMs: 250, exponential: true },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'whatsapp.messages.list.v1'
      },
      inputSchema: WhatsAppListMessagesSchema
    });

    this.register({
      metadata: {
        name: 'whatsapp.messages.read',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 1, backoffMs: 250, exponential: true },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'whatsapp.messages.read.v1'
      },
      inputSchema: Type.Object({ messageId: WhatsAppMessageIdSchema }, { additionalProperties: false })
    });

    this.register({
      metadata: {
        name: 'whatsapp.messages.send',
        actionClass: 'write',
        risk: 'high',
        approvalMode: 'explicit',
        idempotencyRequired: true,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'whatsapp.messages.send.v1'
      },
      inputSchema: WhatsAppSendMessageDraftSchema
    });

    this.register({
      metadata: {
        name: 'whatsapp.briefing.prepare',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 1, backoffMs: 250, exponential: true },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'whatsapp.briefing.prepare.v1'
      },
      inputSchema: WhatsAppBriefingQuerySchema
    });

    // Phone Telephony Foundation (Step 95)
    this.register({
      metadata: {
        name: 'phone.connection.status',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 1, backoffMs: 100, exponential: false },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'phone.connection.status.v1'
      },
      inputSchema: PhoneEmptySchema
    });

    this.register({
      metadata: {
        name: 'phone.connection.connect',
        actionClass: 'write',
        risk: 'medium',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'phone.connection.connect.v1'
      },
      inputSchema: PhoneConnectInputSchema
    });

    this.register({
      metadata: {
        name: 'phone.connection.disconnect',
        actionClass: 'write',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 5000,
        retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'phone.connection.disconnect.v1'
      },
      inputSchema: PhoneEmptySchema
    });

    this.register({
      metadata: {
        name: 'phone.calls.list',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 1, backoffMs: 250, exponential: true },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'phone.calls.list.v1'
      },
      inputSchema: PhoneListCallsSchema
    });

    this.register({
      metadata: {
        name: 'phone.calls.read',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 1, backoffMs: 250, exponential: true },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'phone.calls.read.v1'
      },
      inputSchema: Type.Object({ callId: PhoneCallIdSchema }, { additionalProperties: false })
    });

    this.register({
      metadata: {
        name: 'phone.calls.request_outbound',
        actionClass: 'write',
        risk: 'high',
        approvalMode: 'explicit',
        idempotencyRequired: true,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'phone.calls.request_outbound.v1'
      },
      inputSchema: PhoneOutboundCallRequestSchema
    });

    this.register({metadata:{name:PHONE_AI_CALL_ACTION,actionClass:'write',risk:'high',approvalMode:'explicit',idempotencyRequired:true,timeoutMs:10000,retryPolicy:{maxRetries:0,backoffMs:100,exponential:false},requiredRole:'member',auditRequired:true,capabilityScope:'external_connector',schemaIdentifier:'phone.ai.calls.request.v1'},inputSchema:PhoneCallingDraftSchema});
    this.register({metadata:{name:PHONE_REPORT_SPEECH_ACTION,actionClass:'read',risk:'low',approvalMode:'none',idempotencyRequired:false,timeoutMs:15000,retryPolicy:{maxRetries:0,backoffMs:100,exponential:false},requiredRole:'owner',auditRequired:true,capabilityScope:'external_connector',schemaIdentifier:'phone.ai.calls.report_speech.v1'},inputSchema:PhoneCallingSpeechRequestSchema});
    this.register({metadata:{name:PHONE_CALL_RESULT_READ_ACTION,actionClass:'read',risk:'low',approvalMode:'none',idempotencyRequired:false,timeoutMs:10000,retryPolicy:{maxRetries:0,backoffMs:100,exponential:false},requiredRole:'owner',auditRequired:true,capabilityScope:'external_connector',schemaIdentifier:'phone.ai.calls.result_read.v1'},inputSchema:PhoneCallingSpeechRequestSchema});

    this.register({
      metadata: {
        name: 'phone.briefing.prepare',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 10000,
        retryPolicy: { maxRetries: 1, backoffMs: 250, exponential: true },
        requiredRole: 'member',
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: 'phone.briefing.prepare.v1'
      },
      inputSchema: PhoneBriefingQuerySchema
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
      inputSchema: Type.Object(
        {
          campaignId: Type.String({ minLength: 1, maxLength: 64 }),
          title: Type.Optional(Type.String()),
          objective: Type.Optional(Type.String()),
          eventDetails: Type.Optional(Type.String()),
          channels: Type.Optional(Type.Array(Type.String())),
          materialHash: Type.String({ minLength: 8, maxLength: 128 }),
          status: Type.Optional(Type.String())
        },
        { additionalProperties: true }
      )
    });

    // Google Drive executive operations (admin/owner only, typed input validation, explicit approval for sharing & deletion)
    for (const [name, inputSchema, actionClass] of [
      [GOOGLE_DRIVE_STATUS_ACTION, GoogleDriveEmptySchema, 'read'],
      [GOOGLE_DRIVE_SEARCH_ACTION, GoogleDriveSearchInputSchema, 'read'],
      [GOOGLE_DRIVE_LIST_FOLDER_ACTION, GoogleDriveListFolderInputSchema, 'read'],
      [GOOGLE_DRIVE_READ_FILE_ACTION, GoogleDriveReadFileInputSchema, 'read'],
      [GOOGLE_DRIVE_SUMMARIZE_FILE_ACTION, GoogleDriveReadFileInputSchema, 'read'],
      [GOOGLE_DRIVE_CREATE_FOLDER_ACTION, GoogleDriveCreateFolderInputSchema, 'write'],
      [GOOGLE_DRIVE_CREATE_DOC_ACTION, GoogleDriveCreateDocInputSchema, 'write'],
      [GOOGLE_DRIVE_UPLOAD_FILE_ACTION, GoogleDriveUploadInputSchema, 'write'],
      [GOOGLE_DRIVE_RENAME_MOVE_ACTION, GoogleDriveRenameMoveInputSchema, 'write']
    ] as const) {
      this.register({
        metadata: {
          name,
          requiredRole: 'admin',
          actionClass,
          risk: actionClass === 'write' ? 'medium' : 'low',
          approvalMode: 'none',
          idempotencyRequired: false,
          timeoutMs: 15000,
          retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
          auditRequired: name !== GOOGLE_DRIVE_STATUS_ACTION,
          capabilityScope: 'external_connector',
          schemaIdentifier: `${name}.v1`
        },
        inputSchema
      });
    }

    for (const [name, inputSchema] of [
      [GOOGLE_DRIVE_SHARE_FILE_ACTION, GoogleDriveShareInputSchema],
      [GOOGLE_DRIVE_DELETE_FILE_ACTION, GoogleDriveDeleteInputSchema]
    ] as const) {
      this.register({
        metadata: {
          name,
          requiredRole: 'admin',
          actionClass: 'write',
          risk: 'high',
          approvalMode: 'explicit',
          idempotencyRequired: true,
          timeoutMs: 15000,
          retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
          auditRequired: true,
          capabilityScope: 'external_connector',
          schemaIdentifier: `${name}.v1`
        },
        inputSchema
      });
    }
    this.register({
      metadata: {
        name: PHONE_RECORDING_PLAYBACK_ACTION,
        requiredRole: 'owner',
        actionClass: 'read',
        risk: 'low',
        approvalMode: 'none',
        idempotencyRequired: false,
        timeoutMs: 15000,
        retryPolicy: { maxRetries: 0, backoffMs: 100, exponential: false },
        auditRequired: true,
        capabilityScope: 'external_connector',
        schemaIdentifier: `${PHONE_RECORDING_PLAYBACK_ACTION}.v1`
      },
      inputSchema: PhoneRecordingPlaybackInputSchema
    });
  }
}

export const defaultActionRegistry = new ActionRegistry();
