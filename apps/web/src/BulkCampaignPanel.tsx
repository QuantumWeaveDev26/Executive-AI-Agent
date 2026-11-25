import { useEffect, useRef, useState } from 'react';
import { PhoneCallRecordingPlayer, PhoneCallTranscriptPanel } from './PhoneCallMediaOptions';
import {
  BulkCampaignDetailsView,
  BulkCampaignHistorySummaryItem,
  BulkCampaignHistoryView,
  BulkCampaignResultsSection
} from './BulkCampaignHistoryAndResults';
import { extractBulkCampaignIdFromLocation, type WorkspacePageId } from './navigation';
import type { PhoneCallingLanguage } from '../../../packages/contracts/src/phone-calling';
import type {
  BulkCampaignChannel,
  BulkCampaignContactRecord,
  BulkCampaignDashboardMetrics,
  BulkCampaignEligiblePilotContact,
  BulkCampaignGroundedQaItem,
  BulkCampaignImportResult,
  BulkCampaignKnowledgeContext,
  BulkCampaignKnowledgeUploadInput,
  BulkCampaignLanguage,
  BulkCampaignMode,
  BulkCampaignN8nBatchConfig,
  BulkCampaignN8nChannel,
  BulkCampaignN8nExecutionJob,
  BulkCampaignPilotCallState,
  BulkCampaignPilotWhatsAppState,
  BulkCampaignSheetMonitorConfig,
  BulkCampaignSourceType,
  BulkCampaignStandingAuthorization,
  BulkCampaignStatus,
  BulkCampaignWebinarDetails,
  BulkCampaignWorkspaceContext,
  GoogleSheetsConnectionView
} from '../../../packages/contracts/src/bulk-campaign';
import { request, type ApprovalRequestItem, type PlanWithStepsItem } from './api';

export interface BulkCampaignEmailPlanView {
  subject: string;
  bodyPreview: string;
  liveSendingEnabled: false;
}

export interface SavedDirectoryContactOption {
  contactId: string;
  name: string;
  maskedPhone: string;
  callingAllowed: boolean;
  expired?: boolean;
  archived?: boolean;
  consentSource?: string;
}

export interface BulkCampaignCreateViewProps {
  initialInstruction?: string;
  initialChannels?: BulkCampaignChannel[];
  busy?: boolean;
  campaignsHistory?: Array<{
    campaignId: string;
    title: string;
    status: string;
    executionMode?: 'planned' | 'simulation' | 'live';
    updatedAt?: string;
  }>;
  workspaceContext?: BulkCampaignWorkspaceContext;
  onLoadSavedContacts?(): Promise<SavedDirectoryContactOption[]>;
  onPrepareCampaign?(payload: {
    instruction: string;
    channels: BulkCampaignChannel[];
    knowledgeFiles: BulkCampaignKnowledgeUploadInput[];
    contactSourceType: BulkCampaignSourceType;
    contactFileName?: string;
    contactRawText?: string;
    contactFileBase64?: string;
    useSyntheticDemo?: boolean;
    campaignMode?: BulkCampaignMode;
    sourceConsentAttestation?: {
      confirmed: boolean;
      consentSource: 'lead_form_disclosure' | 'inbound_enquiry' | 'written_consent' | 'verbal_recorded';
      evidenceReference?: string;
    };
    autoFollowupConfig?: {
      spreadsheetId: string;
      spreadsheetName: string;
      spreadsheetUrl?: string;
      tabName?: string;
      tabId?: string;
      googleConnectionId?: string;
      googleAccountEmail?: string;
      metaCampaignRef?: string;
      metaFormId?: string;
      processExistingBacklog?: boolean;
      callingHoursIst?: { startHour: number; endHour: number };
      maxAttemptsPerLead?: number;
      retryOnNoAnswer?: boolean;
      retryDelayMinutes?: number;
      maxLeadsPerDay?: number;
      sheetConsentAttestation?: {
        confirmed: boolean;
        consentSource: 'lead_form_disclosure' | 'inbound_enquiry' | 'written_consent' | 'verbal_recorded';
        evidenceReference?: string;
      };
    };
  }): void;
  onImportSavedContacts?(payload: {
    instruction: string;
    channels: BulkCampaignChannel[];
    knowledgeFiles: BulkCampaignKnowledgeUploadInput[];
    selectedContactIds?: string[];
  }): void;
  onLoadSampleSimulation?(payload: {
    instruction: string;
    channels: BulkCampaignChannel[];
    knowledgeFiles: BulkCampaignKnowledgeUploadInput[];
  }): void;
  onSelectCampaign?(campaignId: string): void;
  onBackToHistory?(): void;
  resumeCampaign?: {
    campaignId: string;
    title: string;
    instruction: string;
    channels: BulkCampaignChannel[];
    contactsCount: number;
    knowledgeFilesCount: number;
    onResumeReview: () => void;
  };
}

export interface BulkCampaignViewProps {
  campaignId: string;
  sourceType?: BulkCampaignSourceType;
  title: string;
  objective: string;
  eventDetails: string;
  webinarDetails?: BulkCampaignWebinarDetails;
  knowledgeContext?: BulkCampaignKnowledgeContext;
  instruction: string;
  status: BulkCampaignStatus;
  scheduledFor?: string;
  channels: BulkCampaignChannel[];
  businessAccountLabel: string;
  whatsappTemplateName: string;
  whatsappMessagePreview: string;
  aiDisclosure: string;
  callOpeningLine: string;
  callEventPitch: string;
  callQuestions: string[];
  boundedPurposePreview?: string;
  supportedLanguages: PhoneCallingLanguage[];
  emailPlan?: BulkCampaignEmailPlanView;
  maxCalls: number;
  dailyPhoneCallLimit?: number;
  maxConcurrency: number;
  rateLimitPerMinute: number;
  scheduleAt?: string;
  materialHash: string;
  approvedMaterialHash?: string;
  estimatedCostInr: number;
  importSummary: Omit<BulkCampaignImportResult, 'validContacts'>;
  contacts: BulkCampaignContactRecord[];
  metrics: BulkCampaignDashboardMetrics;
  csvReportText: string;
  chatSummaryText?: string;
  chatFollowUpResponse?: string;
  executionMode?: 'planned' | 'simulation' | 'live';
  liveCallingEnabled?: boolean;
  liveSendingEnabled?: boolean;
  workspaceContext?: BulkCampaignWorkspaceContext;
  eligiblePilotContacts?: BulkCampaignEligiblePilotContact[];
  eligibleWhatsAppPilotContacts?: BulkCampaignEligiblePilotContact[];
  pilotCall?: BulkCampaignPilotCallState;
  pilotWhatsApp?: BulkCampaignPilotWhatsAppState;
  n8nJobs?: BulkCampaignN8nExecutionJob[];
  onPreparePilotCall?(contactId: string, language?: BulkCampaignLanguage): void;
  onExecutePilotCall?(approvalId: string): void;
  onRefreshPilotResult?(): void;
  onSubmitN8nJob?(channel: BulkCampaignN8nChannel, contactId: string, language?: BulkCampaignLanguage): void;
  onSubmitN8nBatchJob?(channel: BulkCampaignN8nChannel, batchConfig: BulkCampaignN8nBatchConfig): void;
  onPauseN8nJob?(jobId: string): void;
  onResumeN8nJob?(jobId: string): void;
  onCancelN8nJob?(jobId: string): void;
  onEmergencyStopN8nJobs?(): void;
  onRefreshCampaign?(): void;
  onImport?(
    sourceType: BulkCampaignSourceType,
    rawText: string,
    fileName?: string,
    fileBase64?: string
  ): void;
  onChatCreate?(
    chatMessage: string,
    uploadedFile?: {
      sourceType: BulkCampaignSourceType;
      fileName?: string;
      rawText: string;
      fileBase64?: string;
    }
  ): void;
  onUpdatePlan?(patch: {
    objective?: string;
    eventDetails?: string;
    channels?: BulkCampaignChannel[];
    whatsappTemplateName?: string;
    whatsappTemplateLanguage?: string;
    whatsappMessagePreview?: string;
    emailSubject?: string;
    emailBodyPreview?: string;
    callScript?: { openingLine?: string; eventPitch?: string; questions?: string[] };
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
    maxCalls?: number;
    scheduleAt?: string;
  }): void;
  onAskQuestion?(question: string): Promise<BulkCampaignGroundedQaItem | null>;
  onPrepareSyntheticSimulation?(): void;
  onApproveForSimulation?(expectedMaterialHash: string): void;
  campaignsHistory?: Array<{
    campaignId: string;
    title: string;
    status: string;
    executionMode?: 'planned' | 'simulation' | 'live';
    updatedAt?: string;
  }>;
  onSelectCampaign?(campaignId: string): void;
  onNewCampaign?(): void;
  onBackToCreate?(): void;
  onBackToHistory?(): void;
  onLoadSampleSimulation?(): void;
  onImportSavedContacts?(): void;
  onPreparePhoneDrafts?(): void;
  onApproveAllPhoneDrafts?(): void;
  onApprovePhoneDraft?(approvalId: string): void;
  onApprove?(expectedMaterialHash: string): void;
  onApproveAndStart?(expectedMaterialHash: string, mode: 'live' | 'simulation'): void;
  approveAndStartError?: string | null;
  mode?: BulkCampaignMode;
  sheetMonitor?: BulkCampaignSheetMonitorConfig;
  standingAuthorization?: BulkCampaignStandingAuthorization;
  autoFollowupError?: string | null;
  onActivateAutoFollowup?(expectedMaterialHash: string, baselineCsvText?: string): void;
  onPauseAutoFollowup?(): void;
  onResumeAutoFollowup?(): void;
  onStopAutoFollowup?(): void;
  onSyncAutoFollowupNow?(): void;
  existingBacklogPreview?: {
    totalExistingRows: number;
    previouslyProcessedCount: number;
    eligibleCount: number;
    consentBlockedCount: number;
    duplicatesCount: number;
    estimatedCallsWithinLimits: number;
    maxLeadsPerDay: number;
  } | null;
  onPreviewExistingBacklog?(): Promise<void> | void;
  onProcessExistingBacklog?(expectedMaterialHash: string): Promise<void> | void;
  onVerifyUnsavedLeadConsent?(input: {
    contactId: string;
    consentSource: 'written_consent' | 'inbound_enquiry' | 'verbal_recorded' | 'lead_form_disclosure';
    evidenceReference: string;
    recordedAt?: string;
    explicitOwnerApproval: boolean;
  }): Promise<void> | void;
  onEnableSheetConsent?(input: {
    confirmed: boolean;
    consentSource: 'lead_form_disclosure' | 'inbound_enquiry' | 'written_consent' | 'verbal_recorded';
    evidenceReference?: string;
  }): Promise<void> | void;
  onSchedule?(scheduleAt: string): void;
  onExecute?(mode?: 'simulation' | 'live', batchSize?: number): void;
  onRetryFailed?(): void;
  onReconcile?(): void;
  onPause?(): void;
  onResume?(): void;
  onStop?(): void;
  onCancel?(): void;
  onUnsubscribeContact?(contactId: string): void;
  onChatCommand?(command: string): void;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function readKnowledgeFileAsInput(file: File): Promise<BulkCampaignKnowledgeUploadInput> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isBinary = ext === 'pdf' || ext === 'docx' || ext === 'xlsx';
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}`));
    if (isBinary) {
      reader.onload = () => {
        const b64 = reader.result instanceof ArrayBuffer ? arrayBufferToBase64(reader.result) : '';
        resolve({
          fileName: file.name,
          mimeType: file.type || undefined,
          fileBase64: b64
        });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => {
        resolve({
          fileName: file.name,
          mimeType: file.type || undefined,
          rawText: typeof reader.result === 'string' ? reader.result : ''
        });
      };
      reader.readAsText(file);
    }
  });
}

/**
 * Clean, executive-friendly Campaign Creation Card following the exact reference design:
 *  - Section A: Natural-language instructions + right-side `+` button for Campaign Knowledge (PDF, DOCX, TXT, CSV, XLSX)
 *  - Section B: Separate dashed "Upload your contacts" area (Excel, CSV or paste phone numbers)
 *  - Section C: Selectable channel pills (WhatsApp, AI Calling, Email)
 *  - Section D: Single primary "Prepare Campaign" CTA
 */
export function BulkCampaignCreateView(props: BulkCampaignCreateViewProps) {
  const [instruction, setInstruction] = useState(
    props.resumeCampaign?.instruction ?? props.initialInstruction ?? ''
  );
  const [channels, setChannels] = useState<BulkCampaignChannel[]>(
    props.resumeCampaign?.channels && props.resumeCampaign.channels.length > 0
      ? props.resumeCampaign.channels
      : props.initialChannels && props.initialChannels.length > 0
        ? props.initialChannels
        : ['whatsapp', 'phone']
  );
  const [knowledgeFiles, setKnowledgeFiles] = useState<BulkCampaignKnowledgeUploadInput[]>([]);
  const [contactFileName, setContactFileName] = useState<string | undefined>(undefined);
  const [contactSourceType, setContactSourceType] = useState<BulkCampaignSourceType>('csv');
  const [contactRawText, setContactRawText] = useState('');
  const [contactFileBase64, setContactFileBase64] = useState<string | undefined>(undefined);
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [showSavedPicker, setShowSavedPicker] = useState(false);
  const [showSheetsPicker, setShowSheetsPicker] = useState(false);
  const [sheetsList, setSheetsList] = useState<Array<{ id: string; name: string; modifiedTime: string | null }>>([]);
  const [sheetsConnected, setSheetsConnected] = useState<boolean | null>(null);
  const [googleConnections, setGoogleConnections] = useState<GoogleSheetsConnectionView[]>([]);
  const [selectedGoogleConnectionId, setSelectedGoogleConnectionId] = useState<string>('');
  const [googleOAuthConfigured, setGoogleOAuthConfigured] = useState<boolean>(false);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [sheetsError, setSheetsError] = useState<string | null>(null);
  const [sheetsPreview, setSheetsPreview] = useState<{
    spreadsheetId: string;
    spreadsheetUrl?: string;
    tabId?: string;
    googleConnectionId?: string;
    googleAccountEmail?: string;
    sheetName: string;
    detectedColumns: {
      phoneColumn: string | null;
      nameColumn: string | null;
      serviceColumn?: string | null;
      requirementColumn?: string | null;
      countryCodeColumn: string | null;
      consentColumns: string[];
    };
    previewRows: string[];
    totalValid: number;
  } | null>(null);
  const [savedContacts, setSavedContacts] = useState<SavedDirectoryContactOption[]>([]);
  const [selectedSavedContactIds, setSelectedSavedContactIds] = useState<string[]>([]);
  const [savedContactsLoading, setSavedContactsLoading] = useState(false);
  const [savedContactsError, setSavedContactsError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [campaignMode, setCampaignMode] = useState<BulkCampaignMode>('one_time');
  const [sheetUrlInput, setSheetUrlInput] = useState('');
  const [autoTabName, setAutoTabName] = useState('Sheet1');
  const [metaCampaignRef, setMetaCampaignRef] = useState('');
  const [metaFormId, setMetaFormId] = useState('');
  const [callingStartHour, setCallingStartHour] = useState(9);
  const [callingEndHour, setCallingEndHour] = useState(20);
  const [maxAttemptsPerLead, setMaxAttemptsPerLead] = useState(2);
  const [retryOnNoAnswer, setRetryOnNoAnswer] = useState(true);
  const [retryDelayMinutes, setRetryDelayMinutes] = useState(60);
  const [maxLeadsPerDay, setMaxLeadsPerDay] = useState(250);
  const [skipHistoricalRows, setSkipHistoricalRows] = useState(true);
  const [autoApplySourceConsent, setAutoApplySourceConsent] = useState(false);
  const [sourceConsentType, setSourceConsentType] = useState<
    'lead_form_disclosure' | 'inbound_enquiry' | 'written_consent' | 'verbal_recorded'
  >('lead_form_disclosure');
  const [sourceConsentRef, setSourceConsentRef] = useState('');
  const [autoModeError, setAutoModeError] = useState<string | null>(null);

  const extractApiErrorText = (payload: unknown, fallback: string): string => {
    if (!payload || typeof payload !== 'object') return fallback;
    const obj = payload as { message?: unknown; error?: unknown };
    if (typeof obj.message === 'string' && obj.message.trim()) return obj.message;
    if (typeof obj.error === 'string' && obj.error.trim()) return obj.error;
    if (obj.error && typeof obj.error === 'object') {
      const nestedMsg = (obj.error as { message?: unknown }).message;
      if (typeof nestedMsg === 'string' && nestedMsg.trim()) return nestedMsg;
    }
    return fallback;
  };

  const loadGoogleSheetsList = async (connectionIdOverride?: string, preferredEmail?: string) => {
    setSheetsLoading(true);
    setSheetsError(null);
    try {
      const targetConnId = connectionIdOverride ?? selectedGoogleConnectionId;
      const qs = targetConnId ? `?connectionId=${encodeURIComponent(targetConnId)}` : '';
      const res = await fetch(`/api/v1/campaigns/bulk/google-sheets${qs}`, { credentials: 'include' });
      const data = (await res.json().catch(() => ({}))) as {
        connected?: boolean;
        oauthConfigured?: boolean;
        connections?: GoogleSheetsConnectionView[];
        selectedConnectionId?: string;
        error?: unknown;
        message?: unknown;
        sheets?: Array<{ id: string; name: string; modifiedTime: string | null }>;
      };
      if (!res.ok) {
        setSheetsConnected(false);
        setSheetsList([]);
        setSheetsError(extractApiErrorText(data, `Google Sheets lookup failed (HTTP ${res.status}).`));
        return;
      }
      setSheetsConnected(Boolean(data.connected));
      setGoogleOAuthConfigured(Boolean(data.oauthConfigured));
      const conns = Array.isArray(data.connections) ? data.connections : [];
      if (Array.isArray(data.connections)) setGoogleConnections(conns);
      if (preferredEmail) {
        const matched = conns.find(c => c.accountEmail.toLowerCase() === preferredEmail.toLowerCase());
        if (matched && matched.connectionId !== data.selectedConnectionId) {
          setSelectedGoogleConnectionId(matched.connectionId);
          setSheetsList([]);
          void loadGoogleSheetsList(matched.connectionId);
          return;
        }
      }
      if (data.selectedConnectionId && !connectionIdOverride) {
        setSelectedGoogleConnectionId(data.selectedConnectionId);
      }
      if (data.error) setSheetsError(extractApiErrorText(data, 'Google Sheets lookup returned an error.'));
      setSheetsList(data.sheets ?? []);
    } catch (err) {
      setSheetsError((err as Error).message);
    } finally {
      setSheetsLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const connectedEmail = params.get('google_connected')?.trim();
    const googleErr = params.get('google_error')?.trim();
    if (connectedEmail) {
      setCampaignMode('automatic_lead_followup');
      setChannels(['phone']);
      void loadGoogleSheetsList(undefined, connectedEmail);
    } else if (googleErr) {
      setCampaignMode('automatic_lead_followup');
      setChannels(['phone']);
      setSheetsError(googleErr);
      void loadGoogleSheetsList();
    }
  }, []);

  const connectGoogleAccountOAuth = async () => {
    setSheetsLoading(true);
    setSheetsError(null);
    try {
      const r = await fetch('/api/v1/campaigns/bulk/google-sheets/oauth/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ returnTo: '/integrations/bulk-campaign/create' })
      });
      const d = (await r.json().catch(() => ({}))) as { authUrl?: string; message?: unknown; error?: unknown };
      if (!r.ok || !d.authUrl) {
        throw new Error(extractApiErrorText(d, 'Could not start Google account authorization.'));
      }
      window.location.assign(d.authUrl);
    } catch (err) {
      setSheetsError((err as Error).message);
      setSheetsLoading(false);
    }
  };

  const selectGoogleSheetForPreview = async (sh: { id?: string; name?: string; spreadsheetUrl?: string }) => {
    setSheetsLoading(true);
    setSheetsError(null);
    setAutoModeError(null);
    try {
      const r = await fetch('/api/v1/campaigns/bulk/google-sheets/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...(selectedGoogleConnectionId ? { connectionId: selectedGoogleConnectionId } : {}),
          ...(sh.id ? { spreadsheetId: sh.id } : {}),
          ...(sh.name ? { fileName: sh.name } : {}),
          ...(sh.spreadsheetUrl ? { spreadsheetUrl: sh.spreadsheetUrl } : {}),
          ...(autoTabName.trim() ? { tabName: autoTabName.trim() } : {})
        })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(extractApiErrorText(d, 'Failed to preview Google Sheet'));
      setSheetsPreview({
        spreadsheetId: d.spreadsheetId || sh.id || '',
        ...(d.spreadsheetUrl ? { spreadsheetUrl: d.spreadsheetUrl } : {}),
        ...(d.tabId ? { tabId: d.tabId } : {}),
        ...(d.googleConnectionId ? { googleConnectionId: d.googleConnectionId } : {}),
        ...(d.googleAccountEmail ? { googleAccountEmail: d.googleAccountEmail } : {}),
        sheetName: d.sheetName || sh.name || 'Google Sheet',
        detectedColumns: d.detectedColumns,
        previewRows: d.previewRows || [],
        totalValid: d.importResult?.validContacts?.length ?? 0
      });
      setContactSourceType('google_sheets');
      setContactFileName(d.sheetName || `${sh.name || 'google-sheet'}.csv`);
      setContactRawText(d.rawText || (d.previewRows ? d.previewRows.join('\n') : ''));
      setContactFileBase64(undefined);
    } catch (err) {
      setSheetsError((err as Error).message);
    } finally {
      setSheetsLoading(false);
    }
  };

  const knowledgeInputRef = useRef<HTMLInputElement | null>(null);
  const contactsInputRef = useRef<HTMLInputElement | null>(null);

  const toggleChannel = (ch: BulkCampaignChannel) => {
    setChannels(prev => {
      if (prev.includes(ch)) {
        return prev.length > 1 ? prev.filter(item => item !== ch) : prev;
      }
      return [...prev, ch];
    });
  };

  const handleKnowledgeFilesPicked = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const picked: BulkCampaignKnowledgeUploadInput[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList.item(i);
      if (!f) continue;
      const item = await readKnowledgeFileAsInput(f);
      picked.push(item);
    }
    setKnowledgeFiles(prev => {
      const existingNames = new Set(prev.map(x => x.fileName));
      const deduped = picked.filter(x => !existingNames.has(x.fileName));
      return [...prev, ...deduped].slice(0, 10);
    });
    if (knowledgeInputRef.current) {
      knowledgeInputRef.current.value = '';
    }
  };

  const handleContactFilePicked = (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const detectedType: BulkCampaignSourceType =
      ext === 'pdf'
        ? 'pdf'
        : ext === 'xlsx' || ext === 'xls' || ext === 'tsv'
          ? 'excel'
          : ext === 'txt'
            ? 'txt'
            : 'csv';
    setContactSourceType(detectedType);
    setContactFileName(file.name);
    const isBinary = ext === 'xlsx' || ext === 'xls' || ext === 'pdf';
    const reader = new FileReader();
    if (isBinary) {
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          setContactFileBase64(arrayBufferToBase64(reader.result));
          setContactRawText('');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => {
        setContactFileBase64(undefined);
        setContactRawText(typeof reader.result === 'string' ? reader.result : '');
      };
      reader.readAsText(file);
    }
  };

  const hasContactsAttached = Boolean(contactFileName || contactRawText.trim() || contactFileBase64);

  return (
    <section
      className="bulk-campaign-create-shell"
      aria-label="Thaara Bulk Campaign Agent"
      data-testid="bulk-campaign-create-view"
      style={{
        padding: '1.75rem 1.25rem 2.5rem',
        background: 'linear-gradient(180deg, #f8fafc 0%, #f3f4f8 100%)',
        minHeight: 'calc(100vh - 80px)'
      }}
    >
      {props.campaignsHistory && props.campaignsHistory.length > 0 && props.onSelectCampaign && (
        <div
          style={{
            maxWidth: '720px',
            margin: '0 auto 0.9rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '0.6rem',
            flexWrap: 'wrap',
            padding: '0.6rem 1rem',
            background: '#ffffff',
            border: '1px solid #e0e7ff',
            borderRadius: '14px',
            fontSize: '0.83rem',
            color: '#1e293b'
          }}
        >
          <span>
            Continue your latest campaign:{' '}
            <strong>{props.campaignsHistory[props.campaignsHistory.length - 1]!.title}</strong>
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="continue-latest-campaign-button"
            style={{ fontSize: '0.78rem', padding: '0.24rem 0.7rem' }}
            onClick={() =>
              props.onSelectCampaign?.(props.campaignsHistory![props.campaignsHistory!.length - 1]!.campaignId)
            }
          >
            Open Campaign →
          </button>
        </div>
      )}

      {/* Main Clean White Card matching attached reference UI */}
      <div
        data-testid="create-campaign-card"
        style={{
          maxWidth: '720px',
          margin: '0 auto',
          background: '#ffffff',
          borderRadius: '22px',
          border: '1px solid #eceef5',
          boxShadow: '0 10px 36px rgba(15, 23, 42, 0.06)',
          padding: '2.25rem 2.5rem'
        }}
      >
        {/* Header */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1rem',
            marginBottom: '1.75rem'
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: '1.55rem',
                fontWeight: 700,
                color: '#111827',
                letterSpacing: '-0.02em'
              }}
            >
              Create a Campaign
            </h2>
            <p
              style={{
                margin: '0.35rem 0 0',
                fontSize: '0.94rem',
                color: '#6b7280'
              }}
            >
              Let Thaara prepare your customer outreach.
            </p>
          </div>
          <div
            aria-hidden="true"
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: '#f3f0ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 11 18-5v12L3 14v-3z" />
              <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
            </svg>
          </div>
        </header>

        {(props.onBackToHistory || props.resumeCampaign) && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
              marginBottom: '1rem'
            }}
          >
            {props.onBackToHistory && (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="create-back-to-history-button"
                onClick={props.onBackToHistory}
                style={{ fontSize: '0.82rem', padding: '0.35rem 0.75rem' }}
              >
                &larr; Back to Campaign History
              </button>
            )}
            {props.resumeCampaign && (
              <div
                data-testid="create-resume-campaign-banner"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem',
                  flexWrap: 'wrap',
                  background: '#eef2ff',
                  border: '1px solid #c7d2fe',
                  borderRadius: '10px',
                  padding: '0.45rem 0.75rem',
                  fontSize: '0.8rem',
                  color: '#312e81'
                }}
              >
                <span>
                  Editing <strong>{props.resumeCampaign.title}</strong> ({props.resumeCampaign.contactsCount} contacts,{' '}
                  {props.resumeCampaign.knowledgeFilesCount} knowledge files preserved)
                </span>
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="create-continue-to-review-button"
                  onClick={props.resumeCampaign.onResumeReview}
                  style={{ fontSize: '0.78rem', padding: '0.28rem 0.65rem' }}
                >
                  Continue to Review &rarr;
                </button>
              </div>
            )}
          </div>
        )}

        {/* Campaign Execution Mode Selector */}
        <div
          role="group"
          aria-label="Campaign Execution Mode"
          data-testid="campaign-execution-mode-selector"
          style={{ marginBottom: '1.35rem' }}
        >
          <div style={{ fontSize: '0.94rem', fontWeight: 600, color: '#1f2937', marginBottom: '0.55rem' }}>
            Campaign Execution Mode
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.7rem' }}>
            <button
              type="button"
              aria-pressed={campaignMode === 'one_time'}
              data-testid="execution-mode-one-time"
              onClick={() => {
                setCampaignMode('one_time');
                setAutoModeError(null);
              }}
              style={{
                textAlign: 'left',
                padding: '0.8rem 0.95rem',
                borderRadius: '12px',
                border: campaignMode === 'one_time' ? '1.5px solid #4f46e5' : '1px solid #e2e8f0',
                background: campaignMode === 'one_time' ? '#eef2ff' : '#ffffff',
                cursor: 'pointer'
              }}
            >
              <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0f172a' }}>
                Option A: One-Time Bulk Campaign
              </div>
              <div style={{ fontSize: '0.76rem', color: '#475569', marginTop: '0.2rem' }}>
                Upload or select contacts once, review, and run a single outreach batch.
              </div>
            </button>
            <button
              type="button"
              aria-pressed={campaignMode === 'automatic_lead_followup'}
              data-testid="execution-mode-auto-followup"
              onClick={() => {
                setCampaignMode('automatic_lead_followup');
                setAutoModeError(null);
                setChannels(['phone']);
                if (sheetsConnected === null) {
                  void loadGoogleSheetsList();
                }
              }}
              style={{
                textAlign: 'left',
                padding: '0.8rem 0.95rem',
                borderRadius: '12px',
                border: campaignMode === 'automatic_lead_followup' ? '1.5px solid #4f46e5' : '1px solid #e2e8f0',
                background: campaignMode === 'automatic_lead_followup' ? '#eef2ff' : '#ffffff',
                cursor: 'pointer'
              }}
            >
              <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#0f172a' }}>
                Option B: Automatic Lead Follow-up
              </div>
              <div style={{ fontSize: '0.76rem', color: '#475569', marginTop: '0.2rem' }}>
                Connect a Meta Lead Ads Google Sheet to continuously call new consented leads.
              </div>
            </button>
          </div>
        </div>

        {/* Section A — Campaign Instructions + Knowledge '+' Attachment Button */}
        <div style={{ marginBottom: '1.5rem' }}>
          <label
            htmlFor="thaara-campaign-instructions-input"
            style={{
              display: 'block',
              fontSize: '0.94rem',
              fontWeight: 600,
              color: '#1f2937',
              marginBottom: '0.6rem'
            }}
          >
            What do you want Thaara to do?
          </label>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              border: '1.5px solid #cbd5e1',
              borderRadius: '14px',
              background: '#ffffff',
              padding: '0.55rem 0.65rem 0.55rem 1rem',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.03)'
            }}
          >
            <textarea
              id="thaara-campaign-instructions-input"
              aria-label="What do you want Thaara to do?"
              data-testid="campaign-instruction-textarea"
              rows={2}
              placeholder="Type your instructions, e.g., ‘Invite my customers to tomorrow’s AI webinar at 7 PM...’"
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                resize: 'vertical',
                fontSize: '0.93rem',
                lineHeight: 1.45,
                color: '#111827',
                background: 'transparent',
                fontFamily: 'inherit'
              }}
            />

            <div
              aria-hidden="true"
              style={{
                width: '1px',
                height: '32px',
                background: '#e2e8f0',
                margin: '0 0.65rem',
                flexShrink: 0
              }}
            />

            <input
              ref={knowledgeInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.csv,.xlsx"
              aria-label="Upload campaign knowledge files (PDF, DOCX, TXT, CSV, XLSX)"
              data-testid="campaign-knowledge-file-input"
              style={{ display: 'none' }}
              onChange={e => void handleKnowledgeFilesPicked(e.target.files)}
            />

            <button
              type="button"
              title="Attach campaign knowledge (PDF, DOCX, TXT, CSV, XLSX)"
              aria-label="Attach campaign knowledge files"
              data-testid="campaign-knowledge-plus-button"
              onClick={() => knowledgeInputRef.current?.click()}
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                border: '1px solid #ddd6fe',
                background: '#ede9fe',
                color: '#4f46e5',
                fontSize: '1.35rem',
                fontWeight: 600,
                lineHeight: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0
              }}
            >
              +
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.45rem',
              marginTop: '0.55rem',
              color: '#64748b',
              fontSize: '0.8rem',
              lineHeight: 1.45
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '2px', flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            <span>
              You can type instructions or upload your company knowledge, webinar details, product/service information, or a campaign brief so Thaara can answer customer questions better.
            </span>
          </div>

          {/* Removable Knowledge Attachment Chips */}
          {knowledgeFiles.length > 0 && (
            <div
              data-testid="campaign-knowledge-chips"
              aria-label="Uploaded campaign knowledge files"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.45rem',
                marginTop: '0.65rem'
              }}
            >
              {knowledgeFiles.map(kf => {
                const extBadge = (kf.fileName.split('.').pop() ?? 'DOC').toUpperCase();
                return (
                  <span
                    key={kf.fileName}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      padding: '0.28rem 0.65rem',
                      borderRadius: '999px',
                      background: '#f5f3ff',
                      border: '1px solid #ddd6fe',
                      color: '#3730a3',
                      fontSize: '0.78rem',
                      fontWeight: 500
                    }}
                  >
                    <span
                      style={{
                        fontSize: '0.66rem',
                        fontWeight: 700,
                        padding: '0.08rem 0.35rem',
                        borderRadius: '4px',
                        background: '#e0e7ff',
                        color: '#4338ca'
                      }}
                    >
                      {extBadge}
                    </span>
                    <span>{kf.fileName}</span>
                    <button
                      type="button"
                      aria-label={`Remove knowledge file ${kf.fileName}`}
                      onClick={() => setKnowledgeFiles(prev => prev.filter(x => x.fileName !== kf.fileName))}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#6366f1',
                        cursor: 'pointer',
                        fontSize: '0.95rem',
                        lineHeight: 1,
                        padding: 0
                      }}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Section B — Separate Customer Contacts Upload Area (Mode A) or Google Sheets Monitor Setup (Mode B) */}
        {campaignMode === 'automatic_lead_followup' ? (
          <div
            data-testid="auto-followup-config-section"
            style={{
              marginBottom: '1.5rem',
              padding: '1.1rem 1.2rem',
              borderRadius: '14px',
              border: '1px solid #c7d2fe',
              background: '#f8fafc'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <div>
                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#0f172a' }}>
                  1. Connect Meta Lead Ads Google Sheet
                </div>
                <div style={{ fontSize: '0.77rem', color: '#475569' }}>
                  No repeated contact uploads needed — Thaara monitors new rows automatically after you approve.
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  data-testid="auto-followup-connect-google-account-button"
                  className="btn btn-primary"
                  disabled={sheetsLoading}
                  onClick={() => void connectGoogleAccountOAuth()}
                  style={{ fontSize: '0.76rem', padding: '0.32rem 0.7rem' }}
                >
                  {googleConnections.length > 0 ? '+ Add / Reconnect Google Account' : 'Connect Google Account'}
                </button>
                <button
                  type="button"
                  data-testid="auto-followup-refresh-sheets-button"
                  className="btn btn-secondary"
                  onClick={() => void loadGoogleSheetsList()}
                  style={{ fontSize: '0.76rem', padding: '0.3rem 0.65rem' }}
                >
                  {sheetsLoading ? 'Loading Sheets...' : 'Refresh Google Sheets'}
                </button>
              </div>
            </div>

            {googleConnections.length > 0 && (
              <div style={{ marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <label htmlFor="auto-followup-google-account-select" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#334155' }}>
                  Google Account:
                </label>
                <select
                  id="auto-followup-google-account-select"
                  data-testid="auto-followup-google-account-select"
                  value={selectedGoogleConnectionId}
                  onChange={e => {
                    const nextId = e.target.value;
                    setSelectedGoogleConnectionId(nextId);
                    setSheetsList([]);
                    setSheetsPreview(null);
                    void loadGoogleSheetsList(nextId);
                  }}
                  style={{ padding: '0.35rem 0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.78rem', background: '#ffffff' }}
                >
                  {googleConnections.map(c => (
                    <option key={c.connectionId} value={c.connectionId}>
                      {c.accountEmail} ({c.status === 'connected' ? 'Connected' : c.status === 'expired' ? 'Expired — Reconnect' : c.status})
                    </option>
                  ))}
                </select>
                {googleOAuthConfigured && (
                  <span style={{ fontSize: '0.73rem', color: '#64748b' }}>
                    Private Sheets shared with the selected account are also supported via URL below.
                  </span>
                )}
              </div>
            )}

            {sheetsError && <div style={{ color: '#b91c1c', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{sheetsError}</div>}
            {!sheetsLoading && sheetsConnected === false && (
              <div data-testid="auto-followup-sheets-disconnected" style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '0.6rem' }}>
                Google Drive/Sheets is not connected yet. Connect Google Workspace in Integrations to select a Sheet.
              </div>
            )}
            {!sheetsLoading && sheetsConnected && sheetsList.length === 0 && (
              <div style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '0.6rem' }}>
                No accessible Google Sheets found in your connected Drive.
              </div>
            )}
            {sheetsList.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.8rem' }}>
                {sheetsList.map(sh => {
                  const selected = sheetsPreview?.spreadsheetId === sh.id;
                  return (
                    <button
                      key={sh.id}
                      type="button"
                      data-testid={`auto-followup-sheet-${sh.id}`}
                      onClick={() => void selectGoogleSheetForPreview(sh)}
                      style={{
                        fontSize: '0.78rem',
                        padding: '0.35rem 0.7rem',
                        borderRadius: '8px',
                        border: selected ? '1.5px solid #4f46e5' : '1px solid #cbd5e1',
                        background: selected ? '#eef2ff' : '#ffffff',
                        color: selected ? '#312e81' : '#1e293b',
                        fontWeight: selected ? 600 : 500,
                        cursor: 'pointer'
                      }}
                    >
                      {sh.name}
                    </button>
                  );
                })}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              <input
                type="url"
                data-testid="auto-followup-sheet-url-input"
                value={sheetUrlInput}
                onChange={e => setSheetUrlInput(e.target.value)}
                placeholder="Or paste live Google Sheet URL (https://docs.google.com/spreadsheets/d/.../edit#gid=0)"
                style={{
                  flex: 1,
                  minWidth: '240px',
                  padding: '0.42rem 0.65rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.8rem',
                  background: '#ffffff'
                }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="auto-followup-connect-url-button"
                disabled={sheetsLoading || !sheetUrlInput.trim()}
                onClick={() => void selectGoogleSheetForPreview({ spreadsheetUrl: sheetUrlInput.trim() })}
                style={{ fontSize: '0.78rem', padding: '0.38rem 0.75rem' }}
              >
                {sheetsLoading ? 'Verifying...' : 'Connect & Preview Sheet'}
              </button>
            </div>

            {sheetsPreview && (
              <div
                data-testid="auto-followup-sheet-preview"
                style={{
                  padding: '0.65rem 0.8rem',
                  borderRadius: '10px',
                  border: '1px solid #e2e8f0',
                  background: '#ffffff',
                  fontSize: '0.78rem',
                  marginBottom: '0.85rem'
                }}
              >
                <div>
                  <strong>Connected Sheet:</strong> {sheetsPreview.sheetName}
                  {sheetsPreview.tabId ? <> · Tab gid: <code>{sheetsPreview.tabId}</code></> : null}
                  {' · '}<strong>{sheetsPreview.totalValid}</strong> existing row(s) detected
                </div>
                <div style={{ color: '#475569', marginTop: '0.25rem' }}>
                  Detected columns — Phone: <code>{sheetsPreview.detectedColumns.phoneColumn ?? 'Auto'}</code> · Name:{' '}
                  <code>{sheetsPreview.detectedColumns.nameColumn ?? 'Auto'}</code>
                  {sheetsPreview.detectedColumns.serviceColumn ? <> · Service: <code>{sheetsPreview.detectedColumns.serviceColumn}</code></> : null}
                  {sheetsPreview.detectedColumns.requirementColumn ? <> · Requirement: <code>{sheetsPreview.detectedColumns.requirementColumn}</code></> : null}
                  {sheetsPreview.detectedColumns.consentColumns.length > 0 && (
                    <> · Consent: <code>{sheetsPreview.detectedColumns.consentColumns.join(', ')}</code></>
                  )}
                </div>
                <div style={{ color: '#64748b', fontSize: '0.73rem', marginTop: '0.2rem' }}>
                  Consent eligibility: Only rows with verified calling consent (not DND or opted-out) will be called.
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.65rem', marginBottom: '0.75rem' }}>
              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.77rem', color: '#334155', fontWeight: 600 }}>
                Sheet Tab Name
                <input
                  type="text"
                  data-testid="auto-followup-tab-input"
                  value={autoTabName}
                  onChange={e => setAutoTabName(e.target.value)}
                  placeholder="Sheet1"
                  style={{ padding: '0.4rem 0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.77rem', color: '#334155', fontWeight: 600 }}>
                Meta Campaign Ref (optional)
                <input
                  type="text"
                  data-testid="auto-followup-meta-campaign-input"
                  value={metaCampaignRef}
                  onChange={e => setMetaCampaignRef(e.target.value)}
                  placeholder="e.g., Meta Webinar Q4"
                  style={{ padding: '0.4rem 0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.77rem', color: '#334155', fontWeight: 600 }}>
                Meta Form ID (optional)
                <input
                  type="text"
                  data-testid="auto-followup-meta-form-input"
                  value={metaFormId}
                  onChange={e => setMetaFormId(e.target.value)}
                  placeholder="e.g., form_12345"
                  style={{ padding: '0.4rem 0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                />
              </label>
            </div>

            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.45rem' }}>
              2. Calling Hours, Retries & Daily Limits
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem', marginBottom: '0.7rem' }}>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>
                Start Hour (IST)
                <input
                  type="number"
                  min={0}
                  max={23}
                  data-testid="auto-followup-start-hour"
                  value={callingStartHour}
                  onChange={e => setCallingStartHour(Number(e.target.value))}
                  style={{ padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>
                End Hour (IST)
                <input
                  type="number"
                  min={1}
                  max={24}
                  data-testid="auto-followup-end-hour"
                  value={callingEndHour}
                  onChange={e => setCallingEndHour(Number(e.target.value))}
                  style={{ padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>
                Max Attempts / Lead
                <input
                  type="number"
                  min={1}
                  max={5}
                  data-testid="auto-followup-max-attempts"
                  value={maxAttemptsPerLead}
                  onChange={e => setMaxAttemptsPerLead(Number(e.target.value))}
                  style={{ padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>
                Retry Delay (min)
                <input
                  type="number"
                  min={5}
                  max={1440}
                  data-testid="auto-followup-retry-delay"
                  value={retryDelayMinutes}
                  onChange={e => setRetryDelayMinutes(Number(e.target.value))}
                  style={{ padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.75rem', color: '#334155', fontWeight: 600 }}>
                Max Leads / Day
                <input
                  type="number"
                  min={1}
                  max={2000}
                  data-testid="auto-followup-max-daily"
                  value={maxLeadsPerDay}
                  onChange={e => setMaxLeadsPerDay(Number(e.target.value))}
                  style={{ padding: '0.35rem 0.5rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                />
              </label>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.78rem', color: '#334155' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  data-testid="auto-followup-retry-checkbox"
                  checked={retryOnNoAnswer}
                  onChange={e => setRetryOnNoAnswer(e.target.checked)}
                />
                Retry unanswered/busy leads
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  data-testid="auto-followup-skip-historical"
                  checked={skipHistoricalRows}
                  onChange={e => setSkipHistoricalRows(e.target.checked)}
                />
                Skip historical rows already in sheet (Recommended)
              </label>
            </div>

            <div
              style={{
                marginTop: '0.7rem',
                padding: '0.65rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #bfdbfe',
                background: '#f0f9ff',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.45rem'
              }}
            >
              <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.45rem', cursor: 'pointer', fontSize: '0.78rem', color: '#0f172a', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  data-testid="auto-followup-sheet-consent-checkbox"
                  checked={autoApplySourceConsent}
                  onChange={e => setAutoApplySourceConsent(e.target.checked)}
                />
                <span>
                  Auto-set verified calling consent during Google Sheet → CSV conversion (no manual consent column needed; DND, opt-out &amp; explicit Consent=No rows remain blocked)
                </span>
              </label>
              {autoApplySourceConsent && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingLeft: '1.35rem' }}>
                  <select
                    aria-label="Google Sheet consent source"
                    data-testid="auto-followup-sheet-consent-source"
                    value={sourceConsentType}
                    onChange={e => setSourceConsentType(e.target.value as typeof sourceConsentType)}
                    style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff' }}
                  >
                    <option value="lead_form_disclosure">Meta / Web Lead-Form Disclosure</option>
                    <option value="inbound_enquiry">Inbound Enquiry</option>
                    <option value="written_consent">Written Consent</option>
                    <option value="verbal_recorded">Verbal Recorded Consent</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Lead Form / Sheet reference (optional)"
                    data-testid="auto-followup-sheet-consent-ref"
                    value={sourceConsentRef}
                    onChange={e => setSourceConsentRef(e.target.value)}
                    style={{ flex: 1, minWidth: '180px', fontSize: '0.78rem', padding: '0.3rem 0.55rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff' }}
                  />
                </div>
              )}
            </div>

            {autoModeError && (
              <div role="alert" data-testid="auto-followup-config-error" style={{ marginTop: '0.6rem', color: '#b91c1c', fontSize: '0.8rem', fontWeight: 600 }}>
                {autoModeError}
              </div>
            )}
          </div>
        ) : (
        <div style={{ marginBottom: '1.5rem' }}>
          <input
            ref={contactsInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.tsv,.txt,.pdf"
            aria-label="Upload customer contacts file"
            data-testid="campaign-contacts-file-input"
            style={{ display: 'none' }}
            onChange={e => handleContactFilePicked(e.target.files?.[0])}
          />

          <div
            role="button"
            tabIndex={0}
            data-testid="campaign-contacts-dropzone"
            onClick={() => contactsInputRef.current?.click()}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                contactsInputRef.current?.click();
              }
            }}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              handleContactFilePicked(e.dataTransfer.files?.[0]);
            }}
            style={{
              background: '#faf8ff',
              border: '1.5px dashed #c7d2fe',
              borderRadius: '16px',
              padding: '1.85rem 1.25rem',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.15s ease'
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: '42px',
                height: '42px',
                margin: '0 auto 0.55rem',
                borderRadius: '999px',
                background: '#eef2ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                <path d="M12 13v6" />
                <path d="m9.5 15.5 2.5-2.5 2.5 2.5" />
              </svg>
            </div>
            <div style={{ fontSize: '1.02rem', fontWeight: 600, color: '#1e293b' }}>
              Upload your contacts
            </div>
            <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.2rem' }}>
              Excel, CSV or paste phone numbers
            </div>

            {hasContactsAttached && (
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  marginTop: '0.75rem',
                  padding: '0.28rem 0.75rem',
                  borderRadius: '999px',
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  color: '#065f46',
                  fontSize: '0.78rem',
                  fontWeight: 500
                }}
              >
                <span>
                  ✓ {contactFileName ? `Recipient list: ${contactFileName}` : 'Pasted recipient numbers ready'}
                </span>
                <button
                  type="button"
                  aria-label="Clear uploaded contacts"
                  onClick={() => {
                    setContactFileName(undefined);
                    setContactRawText('');
                    setContactFileBase64(undefined);
                    if (contactsInputRef.current) contactsInputRef.current.value = '';
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#047857',
                    cursor: 'pointer',
                    fontWeight: 700,
                    padding: 0
                  }}
                >
                  ×
                </button>
              </div>
            )}
          </div>

          {hasContactsAttached && (
            <div
              style={{
                marginTop: '0.6rem',
                padding: '0.6rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #bfdbfe',
                background: '#f0f9ff',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.45rem'
              }}
            >
              <label style={{ display: 'inline-flex', alignItems: 'flex-start', gap: '0.45rem', cursor: 'pointer', fontSize: '0.78rem', color: '#0f172a', fontWeight: 600 }}>
                <input
                  type="checkbox"
                  data-testid="upload-source-consent-checkbox"
                  checked={autoApplySourceConsent}
                  onChange={e => setAutoApplySourceConsent(e.target.checked)}
                />
                <span>
                  Auto-set verified calling consent during Excel/CSV conversion (no manual consent column needed; DND, opt-out &amp; explicit Consent=No rows remain blocked)
                </span>
              </label>
              {autoApplySourceConsent && (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingLeft: '1.35rem' }}>
                  <select
                    aria-label="Uploaded file consent source"
                    data-testid="upload-source-consent-source"
                    value={sourceConsentType}
                    onChange={e => setSourceConsentType(e.target.value as typeof sourceConsentType)}
                    style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff' }}
                  >
                    <option value="lead_form_disclosure">Meta / Web Lead-Form Disclosure</option>
                    <option value="inbound_enquiry">Inbound Enquiry</option>
                    <option value="written_consent">Written Consent</option>
                    <option value="verbal_recorded">Verbal Recorded Consent</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Lead Form / File reference (optional)"
                    data-testid="upload-source-consent-ref"
                    value={sourceConsentRef}
                    onChange={e => setSourceConsentRef(e.target.value)}
                    style={{ flex: 1, minWidth: '180px', fontSize: '0.78rem', padding: '0.3rem 0.55rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff' }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Clean secondary contact source options */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '0.85rem',
              flexWrap: 'wrap',
              marginTop: '0.55rem',
              fontSize: '0.79rem'
            }}
          >
            <button
              type="button"
              onClick={() => setShowPasteBox(v => !v)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#4f46e5',
                fontWeight: 500,
                cursor: 'pointer',
                padding: 0
              }}
            >
              {showPasteBox ? 'Hide paste box' : 'Paste phone numbers'}
            </button>
            {props.onImportSavedContacts && (
              <>
                <span style={{ color: '#cbd5e1' }}>·</span>
                <button
                  type="button"
                  data-testid="import-saved-contacts-button"
                  onClick={async () => {
                    if (!props.onLoadSavedContacts) {
                      props.onImportSavedContacts?.({
                        instruction:
                          instruction.trim() ||
                          'Invite eligible customers, answer their questions accurately, and share the final report.',
                        channels,
                        knowledgeFiles
                      });
                      return;
                    }
                    const nextOpen = !showSavedPicker;
                    setShowSavedPicker(nextOpen);
                    if (nextOpen && savedContacts.length === 0) {
                      setSavedContactsLoading(true);
                      setSavedContactsError(null);
                      try {
                        const list = await props.onLoadSavedContacts();
                        setSavedContacts(list);
                      } catch (err) {
                        setSavedContactsError((err as Error).message);
                      } finally {
                        setSavedContactsLoading(false);
                      }
                    }
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#4f46e5',
                    fontWeight: 500,
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  Use saved Thaara contacts{selectedSavedContactIds.length > 0 ? ` (${selectedSavedContactIds.length} selected)` : ''}
                </button>
              </>
            )}
            <span style={{ color: '#cbd5e1' }}>·</span>
            <button
              type="button"
              data-testid="import-google-sheets-button"
              onClick={async () => {
                const next = !showSheetsPicker;
                setShowSheetsPicker(next);
                if (next && sheetsConnected === null) {
                  setSheetsLoading(true);
                  setSheetsError(null);
                  try {
                    const res = await fetch('/api/v1/campaigns/bulk/google-sheets', { credentials: 'include' });
                    const data = (await res.json()) as {
                      connected?: boolean;
                      sheets?: Array<{ id: string; name: string; modifiedTime: string | null }>;
                    };
                    setSheetsConnected(Boolean(data.connected));
                    setSheetsList(data.sheets ?? []);
                  } catch (err) {
                    setSheetsError((err as Error).message);
                  } finally {
                    setSheetsLoading(false);
                  }
                }
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#4f46e5',
                fontWeight: 500,
                cursor: 'pointer',
                padding: 0
              }}
            >
              {showSheetsPicker ? 'Hide Google Sheets' : 'Import from Google Sheets'}
            </button>
            {props.onLoadSampleSimulation && (
              <>
                <span style={{ color: '#cbd5e1' }}>·</span>
                <button
                  type="button"
                  data-testid="load-sample-simulation-button"
                  onClick={() =>
                    props.onLoadSampleSimulation?.({
                      instruction:
                        instruction.trim() ||
                        'Thaara, invite these customers to tomorrow’s AI webinar at 7 PM, answer their questions, and give me the final report.',
                      channels,
                      knowledgeFiles
                    })
                  }
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#64748b',
                    fontWeight: 500,
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  Try sample contacts
                </button>
              </>
            )}
          </div>

          {showSavedPicker && (
            <div
              data-testid="saved-contacts-picker"
              style={{
                marginTop: '0.65rem',
                border: '1px solid #c7d2fe',
                borderRadius: '12px',
                background: '#f8fafc',
                padding: '0.75rem 0.9rem',
                textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1e293b' }}>
                  Select Saved Phone Directory Contacts ({selectedSavedContactIds.length} selected)
                </span>
                <button
                  type="button"
                  onClick={() => setShowSavedPicker(false)}
                  style={{ border: 'none', background: 'transparent', color: '#64748b', fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  Done
                </button>
              </div>
              {savedContactsLoading && <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Loading saved contacts...</div>}
              {savedContactsError && <div style={{ fontSize: '0.8rem', color: '#b91c1c' }}>{savedContactsError}</div>}
              {!savedContactsLoading && !savedContactsError && savedContacts.length === 0 && (
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>No saved Phone Directory contacts found.</div>
              )}
              {!savedContactsLoading && savedContacts.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {savedContacts.map(c => {
                    const checked = selectedSavedContactIds.includes(c.contactId);
                    return (
                      <label
                        key={c.contactId}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.5rem',
                          padding: '0.4rem 0.55rem',
                          borderRadius: '8px',
                          background: checked ? '#eef2ff' : '#ffffff',
                          border: `1px solid ${checked ? '#818cf8' : '#e2e8f0'}`,
                          cursor: 'pointer',
                          fontSize: '0.82rem'
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                          <input
                            type="checkbox"
                            data-testid={`saved-contact-checkbox-${c.contactId}`}
                            checked={checked}
                            onChange={() =>
                              setSelectedSavedContactIds(prev =>
                                prev.includes(c.contactId)
                                  ? prev.filter(id => id !== c.contactId)
                                  : [...prev, c.contactId]
                              )
                            }
                          />
                          <strong style={{ color: '#0f172a' }}>{c.name}</strong>
                          <span style={{ color: '#64748b' }}>{c.maskedPhone}</span>
                        </span>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            color: c.callingAllowed ? '#15803d' : '#b45309'
                          }}
                        >
                          {c.callingAllowed ? 'Consent verified' : c.archived ? 'Archived' : 'Not consented'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {showSheetsPicker && (
            <div
              data-testid="google-sheets-picker-panel"
              style={{
                marginTop: '0.75rem',
                padding: '0.85rem',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                fontSize: '0.8rem'
              }}
            >
              {sheetsLoading && <div style={{ color: '#64748b' }}>Loading accessible Google Sheets...</div>}
              {sheetsError && <div style={{ color: '#b91c1c' }}>{sheetsError}</div>}
              {!sheetsLoading && sheetsConnected === false && (
                <div style={{ color: '#64748b' }}>
                  Google Drive/Sheets is not connected yet. Connect Google Workspace in Integrations to select a Sheet.
                </div>
              )}
              {!sheetsLoading && sheetsConnected && sheetsList.length === 0 && (
                <div style={{ color: '#64748b' }}>No accessible Google Sheets found in your connected Drive.</div>
              )}
              {!sheetsLoading && sheetsConnected && sheetsList.length > 0 && (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  <div style={{ fontWeight: 600, color: '#0f172a' }}>Select a connected Google Sheet (read-only):</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {sheetsList.map(sh => (
                      <button
                        key={sh.id}
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '0.76rem', padding: '0.25rem 0.6rem' }}
                        onClick={async () => {
                          setSheetsLoading(true);
                          setSheetsError(null);
                          try {
                            const r = await fetch('/api/v1/campaigns/bulk/google-sheets/preview', {
                              method: 'POST',
                              headers: { 'content-type': 'application/json' },
                              credentials: 'include',
                              body: JSON.stringify({ spreadsheetId: sh.id, fileName: sh.name })
                            });
                            const d = await r.json();
                            if (!r.ok) throw new Error(d?.message || 'Failed to preview Google Sheet');
                            setSheetsPreview({
                              spreadsheetId: sh.id,
                              sheetName: d.sheetName || sh.name,
                              detectedColumns: d.detectedColumns,
                              previewRows: d.previewRows || [],
                              totalValid: d.importResult?.validContacts?.length ?? 0
                            });
                            setContactSourceType('google_sheets');
                            setContactFileName(d.sheetName || `${sh.name}.csv`);
                            setContactRawText(d.rawText || (d.previewRows ? d.previewRows.join('\n') : ''));
                            setContactFileBase64(undefined);
                          } catch (err) {
                            setSheetsError((err as Error).message);
                          } finally {
                            setSheetsLoading(false);
                          }
                        }}
                      >
                        {sh.name}
                      </button>
                    ))}
                  </div>
                  {sheetsPreview && (
                    <div style={{ padding: '0.55rem', background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <div>
                        <strong>Preview ({sheetsPreview.sheetName}):</strong> {sheetsPreview.totalValid} valid contact(s) detected · Phone column:{' '}
                        <code>{sheetsPreview.detectedColumns.phoneColumn ?? 'Auto'}</code> · Name:{' '}
                        <code>{sheetsPreview.detectedColumns.nameColumn ?? 'Auto'}</code>
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.25rem' }}>
                        Presence in Google Sheets never grants calling consent; verified consent is checked per recipient in Review.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {showPasteBox && (
            <div style={{ marginTop: '0.6rem' }}>
              <textarea
                aria-label="Paste customer contacts"
                data-testid="paste-contacts-textarea"
                rows={3}
                placeholder="Paste customer names, phone numbers, or emails (one per line)..."
                value={contactRawText}
                onChange={e => {
                  setContactSourceType('paste');
                  setContactFileName(undefined);
                  setContactFileBase64(undefined);
                  setContactRawText(e.target.value);
                }}
                style={{
                  width: '100%',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  padding: '0.6rem 0.75rem',
                  fontSize: '0.84rem',
                  fontFamily: 'inherit'
                }}
              />
            </div>
          )}
        </div>
        )}

        {/* Section C — Communication Channels */}
        <div
          role="group"
          aria-label="Communication channels"
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '0.75rem',
            flexWrap: 'wrap',
            marginBottom: '1.75rem'
          }}
        >
          {(
            [
              {
                key: 'whatsapp' as const,
                label: 'WhatsApp',
                accent: '#16a34a',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                  </svg>
                )
              },
              {
                key: 'phone' as const,
                label: 'AI Calling',
                accent: '#4f46e5',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                )
              },
              {
                key: 'email' as const,
                label: 'Email',
                accent: '#475569',
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="20" height="16" x="2" y="4" rx="2" />
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                )
              }
            ] as const
          ).map(item => {
            const active = channels.includes(item.key);
            return (
              <button
                key={item.key}
                type="button"
                aria-pressed={active}
                data-testid={`create-channel-${item.key}`}
                onClick={() => toggleChannel(item.key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.55rem 1.25rem',
                  borderRadius: '999px',
                  border: active ? '1.5px solid #6366f1' : '1px solid #e2e8f0',
                  background: active ? '#f5f3ff' : '#ffffff',
                  color: active ? '#1e1b4b' : '#475569',
                  fontSize: '0.9rem',
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                  boxShadow: active ? '0 2px 8px rgba(99, 102, 241, 0.12)' : '0 1px 2px rgba(15, 23, 42, 0.03)'
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Section D — Primary Action */}
        <div style={{ textAlign: 'center' }}>
          <button
            type="button"
            disabled={props.busy}
            data-testid="prepare-campaign-primary-button"
            onClick={() => {
              const resolvedInstruction =
                instruction.trim() ||
                'Invite these customers, explain the details clearly, answer their questions accurately, and share the final report.';
              if (campaignMode === 'automatic_lead_followup') {
                if (!sheetsPreview) {
                  setAutoModeError('Select a connected Google Sheet before continuing to Review.');
                  return;
                }
                setAutoModeError(null);
                props.onPrepareCampaign?.({
                  instruction: resolvedInstruction,
                  channels: channels.length > 0 ? channels : ['phone'],
                  knowledgeFiles,
                  contactSourceType: 'google_sheets',
                  contactFileName: sheetsPreview.sheetName,
                  ...(contactRawText.trim() ? { contactRawText } : {}),
                  useSyntheticDemo: false,
                  campaignMode: 'automatic_lead_followup',
                  ...(autoApplySourceConsent
                    ? {
                        sourceConsentAttestation: {
                          confirmed: true,
                          consentSource: sourceConsentType,
                          ...(sourceConsentRef.trim() ? { evidenceReference: sourceConsentRef.trim() } : {})
                        }
                      }
                    : {}),
                  autoFollowupConfig: {
                    spreadsheetId: sheetsPreview.spreadsheetId,
                    spreadsheetName: sheetsPreview.sheetName,
                    ...(sheetsPreview.spreadsheetUrl ? { spreadsheetUrl: sheetsPreview.spreadsheetUrl } : {}),
                    tabName: autoTabName.trim() || 'Sheet1',
                    ...(sheetsPreview.tabId ? { tabId: sheetsPreview.tabId } : {}),
                    ...(sheetsPreview.googleConnectionId || selectedGoogleConnectionId
                      ? { googleConnectionId: sheetsPreview.googleConnectionId || selectedGoogleConnectionId }
                      : {}),
                    ...(sheetsPreview.googleAccountEmail ? { googleAccountEmail: sheetsPreview.googleAccountEmail } : {}),
                    ...(metaCampaignRef.trim() ? { metaCampaignRef: metaCampaignRef.trim() } : {}),
                    ...(metaFormId.trim() ? { metaFormId: metaFormId.trim() } : {}),
                    processExistingBacklog: !skipHistoricalRows,
                    callingHoursIst: { startHour: callingStartHour, endHour: callingEndHour },
                    maxAttemptsPerLead,
                    retryOnNoAnswer,
                    retryDelayMinutes,
                    maxLeadsPerDay,
                    ...(autoApplySourceConsent
                      ? {
                          sheetConsentAttestation: {
                            confirmed: true,
                            consentSource: sourceConsentType,
                            ...(sourceConsentRef.trim() ? { evidenceReference: sourceConsentRef.trim() } : {})
                          }
                        }
                      : {})
                  }
                });
                return;
              }
              if (selectedSavedContactIds.length > 0 && props.onImportSavedContacts) {
                props.onImportSavedContacts({
                  instruction: resolvedInstruction,
                  channels,
                  knowledgeFiles,
                  selectedContactIds: selectedSavedContactIds
                });
                return;
              }
              props.onPrepareCampaign?.({
                instruction: resolvedInstruction,
                channels,
                knowledgeFiles,
                contactSourceType,
                ...(contactFileName ? { contactFileName } : {}),
                ...(contactRawText.trim() ? { contactRawText } : {}),
                ...(contactFileBase64 ? { contactFileBase64 } : {}),
                ...(autoApplySourceConsent && hasContactsAttached
                  ? {
                      sourceConsentAttestation: {
                        confirmed: true,
                        consentSource: sourceConsentType,
                        ...(sourceConsentRef.trim() ? { evidenceReference: sourceConsentRef.trim() } : {})
                      }
                    }
                  : {}),
                useSyntheticDemo: !hasContactsAttached
              });
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.55rem',
              minWidth: '250px',
              padding: '0.88rem 2.3rem',
              borderRadius: '12px',
              border: 'none',
              background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
              color: '#ffffff',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: props.busy ? 'wait' : 'pointer',
              boxShadow: '0 6px 18px rgba(79, 70, 229, 0.28)'
            }}
          >
            <span aria-hidden="true">→</span>
            <span>{props.busy ? 'Preparing Review...' : 'Review Campaign'}</span>
          </button>
          <p
            style={{
              margin: '0.6rem 0 0',
              fontSize: '0.81rem',
              color: '#64748b'
            }}
          >
            Thaara creates everything for your review.
          </p>
        </div>
      </div>

      {/* Optional collapsed Past Campaigns & Advanced Details below main card */}
      <div style={{ maxWidth: '720px', margin: '1rem auto 0' }}>
        <details
          data-testid="create-advanced-details"
          style={{
            background: 'rgba(255, 255, 255, 0.75)',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '0.6rem 0.95rem',
            fontSize: '0.8rem',
            color: '#475569'
          }}
        >
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#475569' }}>
            Recent Campaigns &amp; Advanced Details
          </summary>
          <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <nav
              aria-label="Campaign status filters"
              data-testid="campaign-status-filters"
              style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}
            >
              {(
                [
                  ['all', 'All Campaigns'],
                  ['draft', 'Drafts'],
                  ['scheduled', 'Scheduled'],
                  ['running', 'Active'],
                  ['completed', 'Completed']
                ] as const
              ).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  className={statusFilter === key ? 'btn btn-primary' : 'btn btn-secondary'}
                  style={{ fontSize: '0.73rem', padding: '0.18rem 0.5rem' }}
                  onClick={() => {
                    setStatusFilter(key);
                    const match = (props.campaignsHistory ?? []).find(h =>
                      key === 'all' ? true : h.status === key
                    );
                    if (match) props.onSelectCampaign?.(match.campaignId);
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
            {props.campaignsHistory && props.campaignsHistory.length > 0 && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                {props.campaignsHistory.slice(-5).map(h => (
                  <button
                    key={h.campaignId}
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: '0.74rem', padding: '0.2rem 0.55rem' }}
                    onClick={() => props.onSelectCampaign?.(h.campaignId)}
                  >
                    Open: {h.title} ({h.status.toUpperCase()})
                  </button>
                ))}
              </div>
            )}
            {props.workspaceContext && (
              <div style={{ fontSize: '0.76rem', color: '#64748b' }}>
                Connected Integrations: WhatsApp ({props.workspaceContext.whatsappBusinessLabel}) · AI Calling (
                {props.workspaceContext.sarvamOutboundAgentLabel ?? 'Thaara AI — Sarvam outbound v6'}) · Email (
                {props.workspaceContext.connectedEmail
                  ? `${props.workspaceContext.connectedEmail}${props.workspaceContext.emailSendReady ? ' — Send Ready' : ' — Read Only'}`
                  : props.workspaceContext.emailConnected
                    ? 'Connected'
                    : 'Draft / Preview Mode'}
                )
              </div>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}

export function BulkCampaignDashboardView(p: BulkCampaignViewProps) {
  const [rawImportText, setRawImportText] = useState('');
  const [uploadedFileBase64, setUploadedFileBase64] = useState<string | undefined>(undefined);
  const [sourceType, setSourceType] = useState<BulkCampaignSourceType>('csv');
  const [uploadedFileName, setUploadedFileName] = useState<string | undefined>(undefined);
  const [chatInstructionInput, setChatInstructionInput] = useState(p.instruction);
  const [editableEventDetails, setEditableEventDetails] = useState(p.eventDetails);
  const [editableOpeningLine, setEditableOpeningLine] = useState(p.callOpeningLine);
  const [editableEventPitch, setEditableEventPitch] = useState(p.callEventPitch);
  const [editableWhatsappText, setEditableWhatsappText] = useState(p.whatsappMessagePreview);
  const [editableEmailSubject, setEditableEmailSubject] = useState(p.emailPlan?.subject ?? '');
  const [editableEmailBody, setEditableEmailBody] = useState(p.emailPlan?.bodyPreview ?? '');
  const [editableMaxCalls, setEditableMaxCalls] = useState(p.maxCalls);
  const [batchSizeChoice, setBatchSizeChoice] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'stopped'
  >('all');
  const [scheduleInput, setScheduleInput] = useState(p.scheduledFor ?? p.scheduleAt ?? '');
  const [showMoreQuestions, setShowMoreQuestions] = useState(false);
  const [testQuestionInput, setTestQuestionInput] = useState('');
  const [consentEvidenceByContact, setConsentEvidenceByContact] = useState<
    Record<string, { source: string; recordedAt: string; phone: boolean; whatsapp: boolean }>
  >({});
  const [testedQaResult, setTestedQaResult] = useState<BulkCampaignGroundedQaItem | null>(null);
  const [askingQuestion, setAskingQuestion] = useState(false);
  const [viewStageOverride, setViewStageOverride] = useState<'review' | 'execution' | 'results' | null>(null);
  const [showBacklogCard, setShowBacklogCard] = useState(false);
  const [backlogExplicitApproved, setBacklogExplicitApproved] = useState(false);
  const [backlogBusy, setBacklogBusy] = useState(false);
  const [consentVerifyContactId, setConsentVerifyContactId] = useState<string | null>(null);
  const [consentSourceInput, setConsentSourceInput] = useState<'lead_form_disclosure' | 'written_consent' | 'inbound_enquiry' | 'verbal_recorded'>('lead_form_disclosure');
  const [consentEvidenceInput, setConsentEvidenceInput] = useState('');
  const [consentExplicitApproved, setConsentExplicitApproved] = useState(false);
  const [consentVerifyBusy, setConsentVerifyBusy] = useState(false);
  const [batchConsentSource, setBatchConsentSource] = useState('');
  const [batchConsentDate, setBatchConsentDate] = useState('');
  const [batchConsentPhone, setBatchConsentPhone] = useState(true);
  const [batchConsentWhatsapp, setBatchConsentWhatsapp] = useState(false);

  const reviewKnowledgeInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setViewStageOverride(null);
  }, [p.campaignId, p.status]);

  useEffect(() => {
    setChatInstructionInput(p.instruction);
    setEditableEventDetails(p.eventDetails);
    setEditableOpeningLine(p.callOpeningLine);
    setEditableEventPitch(p.callEventPitch);
    setEditableWhatsappText(p.whatsappMessagePreview);
    setEditableEmailSubject(p.emailPlan?.subject ?? '');
    setEditableEmailBody(p.emailPlan?.bodyPreview ?? '');
    setEditableMaxCalls(p.maxCalls);
    setScheduleInput(p.scheduledFor ?? p.scheduleAt ?? '');
    setTestedQaResult(null);
  }, [
    p.campaignId,
    p.instruction,
    p.eventDetails,
    p.callOpeningLine,
    p.callEventPitch,
    p.whatsappMessagePreview,
    p.emailPlan?.subject,
    p.emailPlan?.bodyPreview,
    p.callQuestions,
    p.maxCalls,
    p.scheduledFor,
    p.scheduleAt
  ]);

  const needsReapproval =
    p.status === 'draft_requires_reapproval' ||
    (p.approvedMaterialHash && p.approvedMaterialHash !== p.materialHash);

  const eligibleContacts = p.contacts.filter(c => c.category === 'eligible');
  const unauthorizedContacts = p.contacts.filter(c => c.category === 'unauthorized');
  const unsupportedContacts = p.contacts.filter(c => c.category === 'unsupported');
  const isSyntheticFixtureRun = p.contacts.some(c => Boolean(c.contact.isSyntheticTestFixture));
  const hasAnyLiveChannel = Boolean(!isSyntheticFixtureRun && (p.liveCallingEnabled || p.liveSendingEnabled));
  const canStartLive =
    hasAnyLiveChannel &&
    eligibleContacts.length > 0 &&
    p.channels.length > 0 &&
    p.channels.every(ch =>
      ch === 'phone' ? Boolean(p.liveCallingEnabled) : ch === 'whatsapp' ? Boolean(p.liveSendingEnabled) : false
    );
  const filteredHistory = (p.campaignsHistory ?? []).filter(h => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'draft') {
      return h.status === 'draft' || h.status === 'draft_requires_reapproval' || h.status === 'approved';
    }
    return h.status === statusFilter;
  });

  const contactedCount = p.contacts.filter(
    r =>
      r.whatsappStatus === 'delivered' ||
      r.whatsappStatus === 'read' ||
      r.whatsappStatus === 'sent' ||
      r.phoneStatus === 'answered' ||
      r.emailStatus === 'sent'
  ).length;
  const notContactedCount = Math.max(0, p.metrics.totalContacts - contactedCount);

  const batchJobs = (p.n8nJobs ?? []).filter(j => j.mode === 'multi_contact_batch');
  const hasAnyBatchJob = batchJobs.length > 0;
  const hasActiveBatchJob = batchJobs.some(
    j => j.status === 'queued' || j.status === 'running' || j.status === 'paused'
  );
  const allBatchJobsTerminal =
    hasAnyBatchJob &&
    batchJobs.every(j => j.status === 'completed' || j.status === 'stopped' || j.status === 'cancelled' || j.status === 'failed');
  const allBatchJobsCompletedWithWork =
    allBatchJobsTerminal &&
    batchJobs.some(j => (j.succeededCount ?? 0) > 0 || j.status === 'stopped');

  const isAutoFollowup = p.mode === 'automatic_lead_followup';
  const autoMonitorStatus = p.sheetMonitor?.status;
  const isAutoActivated =
    isAutoFollowup &&
    Boolean(p.standingAuthorization) &&
    autoMonitorStatus !== 'draft';

  const derivedStage: 'review' | 'execution' | 'results' = isAutoFollowup
    ? isAutoActivated
      ? 'execution'
      : 'review'
    : p.status === 'completed' || p.status === 'stopped' || allBatchJobsCompletedWithWork
      ? 'results'
      : p.status === 'running' || p.status === 'paused' || hasActiveBatchJob || hasAnyBatchJob
        ? 'execution'
        : 'review';

  const effectiveStage = viewStageOverride ?? derivedStage;
  const isViewingEarlierReadOnlyStage =
    viewStageOverride !== null &&
    viewStageOverride !== derivedStage &&
    (p.status === 'running' ||
      p.status === 'paused' ||
      p.status === 'completed' ||
      p.status === 'stopped' ||
      hasActiveBatchJob ||
      allBatchJobsTerminal);

  const isReviewStage = effectiveStage === 'review';
  const isExecutionStage = effectiveStage === 'execution';
  const isResultsStage = effectiveStage === 'results';
  const hasBatchOrRealResults = Boolean(
    hasAnyBatchJob ||
      p.contacts.some(r =>
        Boolean(
          (r.phoneCallId && !r.phoneCallId.startsWith('sim_')) ||
            r.whatsappProviderMessageId ||
            r.emailMessageId
        )
      )
  );
  const showResultsSection = isResultsStage || (isExecutionStage && hasBatchOrRealResults);

  const activeStageIndex = isResultsStage ? 3 : isExecutionStage ? 2 : 1;

  const handleStageBack = () => {
    if (effectiveStage === 'results') {
      setViewStageOverride('execution');
      return;
    }
    if (effectiveStage === 'execution') {
      setViewStageOverride('review');
      return;
    }
    if (effectiveStage === 'review') {
      p.onBackToCreate?.();
    }
  };

  const handleFileUpload = (file: File | undefined) => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    const detectedType: BulkCampaignSourceType =
      ext === 'pdf'
        ? 'pdf'
        : ext === 'xlsx' || ext === 'xls' || ext === 'tsv'
          ? 'excel'
          : ext === 'txt'
            ? 'txt'
            : 'csv';
    setSourceType(detectedType);
    setUploadedFileName(file.name);

    const isBinaryDocument = ext === 'xlsx' || ext === 'xls' || ext === 'pdf';
    const reader = new FileReader();
    if (isBinaryDocument) {
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          const b64 = arrayBufferToBase64(reader.result);
          setUploadedFileBase64(b64);
          setRawImportText('');
          p.onImport?.(detectedType, '', file.name, b64);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = () => {
        const content = typeof reader.result === 'string' ? reader.result : '';
        setUploadedFileBase64(undefined);
        setRawImportText(content);
        p.onImport?.(detectedType, content, file.name);
      };
      reader.readAsText(file);
    }
  };

  const handleAddKnowledgeOnReview = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !p.onUpdatePlan) return;
    const uploaded: BulkCampaignKnowledgeUploadInput[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList.item(i);
      if (!f) continue;
      uploaded.push(await readKnowledgeFileAsInput(f));
    }
    if (uploaded.length > 0) {
      p.onUpdatePlan({ knowledgeFiles: uploaded });
    }
    if (reviewKnowledgeInputRef.current) {
      reviewKnowledgeInputRef.current.value = '';
    }
  };

  const downloadCsv = () => {
    const blob = new Blob([p.csvReportText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${p.campaignId}-report.csv`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const missingInfoList = [
    ...(p.knowledgeContext?.missingDetails ?? []),
    ...(p.webinarDetails?.missingDetails ?? [])
  ].filter((v, idx, arr) => arr.indexOf(v) === idx);

  const processedKnowledgeFiles = (p.knowledgeContext?.files ?? []).filter(f => f.status === 'processed');
  const allQaItems = p.knowledgeContext?.sampleGroundedQa ?? [];
  const visibleQaItems = showMoreQuestions ? allQaItems : allQaItems.slice(0, 4);

  const selectedChannelLabels = p.channels.map(ch =>
    ch === 'phone' ? 'AI Calling' : ch === 'whatsapp' ? 'WhatsApp' : 'Email'
  );

  return (
    <section
      className="bulk-campaign-agent"
      aria-label="Thaara Bulk Campaign Agent"
      data-testid="bulk-campaign-dashboard-view"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        padding: '1.5rem 1.25rem 2.5rem',
        maxWidth: '880px',
        margin: '0 auto'
      }}
    >
      {/* Five-Stage Workflow Stepper: Create → Review → Approve → Run → Results */}
      <div
        aria-label="Campaign workflow stages"
        data-testid="campaign-workflow-stepper"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.65rem',
          padding: '0.85rem 1.15rem',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '14px',
          boxShadow: '0 2px 10px rgba(15, 23, 42, 0.03)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="campaign-stage-back-button"
              onClick={handleStageBack}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                fontSize: '0.84rem',
                fontWeight: 600,
                padding: '0.28rem 0.65rem',
                borderRadius: '8px'
              }}
            >
              &larr; Back
            </button>
            {p.onBackToHistory && (
              <button
                type="button"
                className="btn btn-secondary"
                data-testid="campaign-back-to-history-button"
                onClick={p.onBackToHistory}
                style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', borderRadius: '8px' }}
              >
                Campaign History
              </button>
            )}
          </div>
          <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 500 }}>
            Step {activeStageIndex + 1} of 4
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            flexWrap: 'wrap'
          }}
        >
          {(['Create', 'Review', 'Execution', 'Results'] as const).map((stepName, idx) => {
            const isCompleted = idx < activeStageIndex;
            const isCurrent = idx === activeStageIndex;
            return (
              <div
                key={stepName}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  fontSize: '0.84rem',
                  fontWeight: isCurrent ? 700 : 500,
                  color: isCurrent ? '#4f46e5' : isCompleted ? '#059669' : '#94a3b8'
                }}
              >
                <span
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '999px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    background: isCurrent ? '#ede9fe' : isCompleted ? '#d1fae5' : '#f1f5f9',
                    color: isCurrent ? '#4f46e5' : isCompleted ? '#047857' : '#64748b'
                  }}
                >
                  {isCompleted ? '✓' : idx + 1}
                </span>
                <span>{stepName}</span>
              </div>
            );
          })}
        </div>

        <div
          style={{
            borderTop: '1px solid #f1f5f9',
            paddingTop: '0.45rem',
            fontSize: '0.78rem',
            color: isViewingEarlierReadOnlyStage ? '#92400e' : '#64748b'
          }}
        >
          {isViewingEarlierReadOnlyStage
            ? `Viewing earlier stage in read-only mode (${p.status.toUpperCase()}) — campaign data, approval hash, and results are preserved.`
            : 'Previous stages retain the entered information, selected contacts and campaign settings.'}
        </div>
      </div>

      {/* Clean Top Bar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.65rem',
          background: '#ffffff',
          padding: '0.95rem 1.25rem',
          borderRadius: '14px',
          border: '1px solid #e2e8f0'
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#111827' }}>{p.title}</h2>
          <div style={{ marginTop: '0.2rem', fontSize: '0.82rem', color: '#64748b' }}>
            {hasAnyLiveChannel ? 'Governed workspace mode' : 'Simulation mode · No real calls or messages'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          {p.campaignsHistory && p.campaignsHistory.length > 1 && (
            <select
              aria-label="Campaign history switcher"
              data-testid="campaign-history-select"
              value={
                filteredHistory.some(h => h.campaignId === p.campaignId)
                  ? p.campaignId
                  : (filteredHistory[0]?.campaignId ?? p.campaignId)
              }
              onChange={e => p.onSelectCampaign?.(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '0.3rem 0.55rem', borderRadius: '8px', border: '1px solid #cbd5e1' }}
            >
              {(filteredHistory.length > 0 ? filteredHistory : p.campaignsHistory).map(h => (
                <option key={h.campaignId} value={h.campaignId}>
                  {h.title} ({h.status.toUpperCase()})
                </option>
              ))}
            </select>
          )}
          {p.onNewCampaign && (
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="new-campaign-button"
              onClick={() => p.onNewCampaign?.()}
              style={{ fontSize: '0.8rem', padding: '0.32rem 0.75rem' }}
            >
              + New Campaign
            </button>
          )}
        </div>
      </header>

      {/* Minimal Contextual Execution Status Banner */}
      {p.approveAndStartError ? (
        <div
          role="alert"
          data-testid="live-connector-readiness-banner"
          style={{
            padding: '0.65rem 0.95rem',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '12px',
            fontSize: '0.82rem',
            color: '#991b1b'
          }}
        >
          <strong>Live execution unavailable.</strong> {p.approveAndStartError}
        </div>
      ) : isReviewStage && canStartLive ? (
        <div
          role="status"
          aria-label="Campaign readiness"
          data-testid="live-connector-readiness-banner"
          style={{
            padding: '0.65rem 0.95rem',
            background: '#f0fdf4',
            border: '1px solid #86efac',
            borderRadius: '12px',
            fontSize: '0.82rem',
            color: '#166534'
          }}
        >
          <strong>Ready to start.</strong>
        </div>
      ) : isReviewStage && hasAnyLiveChannel ? (
        <div
          role="status"
          aria-label="Campaign readiness"
          data-testid="live-connector-readiness-banner"
          style={{
            padding: '0.65rem 0.95rem',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '12px',
            fontSize: '0.82rem',
            color: '#92400e'
          }}
        >
          {eligibleContacts.length === 0
            ? 'No eligible contacts selected.'
            : 'Selected channel is not enabled for live execution.'}
        </div>
      ) : !hasAnyLiveChannel ? (
        <div
          role="status"
          aria-label="Test mode status"
          data-testid="simulation-mode-banner"
          style={{
            padding: '0.65rem 0.95rem',
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '12px',
            fontSize: '0.82rem',
            color: '#1e3a8a'
          }}
        >
          <strong>Test mode</strong> — No real calls or messages will be sent.
        </div>
      ) : null}

      {/* Conflict Warnings from Uploaded Knowledge */}
      {p.knowledgeContext && p.knowledgeContext.conflicts.length > 0 && (
        <div
          role="alert"
          data-testid="campaign-knowledge-conflicts-banner"
          style={{
            padding: '0.65rem 0.95rem',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '12px',
            fontSize: '0.82rem',
            color: '#991b1b'
          }}
        >
          <strong>Conflicting Campaign Information Detected:</strong>
          <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem' }}>
            {p.knowledgeContext.conflicts.map(conf => (
              <li key={conf}>{conf}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Missing Essential Information Check */}
      {missingInfoList.length > 0 && p.status === 'draft' && (
        <div
          role="note"
          aria-label="Missing webinar details check"
          data-testid="missing-webinar-details-banner"
          style={{
            padding: '0.6rem 0.95rem',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            borderRadius: '12px',
            fontSize: '0.81rem',
            color: '#92400e'
          }}
        >
          <strong>Please confirm missing details if needed:</strong> {missingInfoList.join(', ')}.
        </div>
      )}

      {/* ========================================================================
          STAGE 1: CLEAN SIMPLIFIED REVIEW SCREEN (Section 6)
         ======================================================================== */}
      {isReviewStage && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} data-testid="simplified-review-stage">
          {/* 1. Campaign Summary */}
          <section
            aria-label="Campaign summary"
            data-testid="campaign-summary-card"
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              padding: '1.25rem 1.4rem',
              boxShadow: '0 4px 16px rgba(15, 23, 42, 0.03)'
            }}
          >
            <h3 style={{ margin: '0 0 0.85rem', fontSize: '1.02rem', fontWeight: 700, color: '#111827' }}>
              Campaign summary
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '0.75rem 1.25rem',
                fontSize: '0.86rem',
                color: '#334155'
              }}
            >
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Campaign name</div>
                <div style={{ fontWeight: 600, color: '#0f172a', marginTop: '0.15rem' }}>{p.title}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Selected channel</div>
                <div style={{ fontWeight: 600, color: '#4338ca', marginTop: '0.15rem' }}>
                  {selectedChannelLabels.join(' · ')} selected
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Uploaded knowledge</div>
                <div style={{ fontWeight: 500, color: '#0f172a', marginTop: '0.15rem' }}>
                  {processedKnowledgeFiles.length > 0
                    ? processedKnowledgeFiles.map(f => f.fileName).join(', ')
                    : p.knowledgeContext?.extractedFacts?.campaignType === 'services' || /quantum\s*weave/i.test(p.instruction)
                      ? 'Quantum Weave Company Knowledge'
                      : 'Owner instructions only'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Test contacts</div>
                <div style={{ fontWeight: 600, color: '#0f172a', marginTop: '0.15rem' }}>
                  {isSyntheticFixtureRun
                    ? `${eligibleContacts.length} synthetic test contacts`
                    : `${eligibleContacts.length} eligible (${p.metrics.totalContacts} uploaded)`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Mode</div>
                <div style={{ marginTop: '0.15rem' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.18rem 0.6rem',
                      borderRadius: '999px',
                      background: '#eef2ff',
                      color: '#3730a3',
                      fontSize: '0.76rem',
                      fontWeight: 600
                    }}
                  >
                    {hasAnyLiveChannel ? 'Governed mode' : 'Simulation mode'}
                  </span>
                </div>
              </div>
            </div>
            <div
              style={{
                marginTop: '0.85rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid #f1f5f9',
                fontSize: '0.86rem',
                color: '#334155'
              }}
            >
              <strong style={{ color: '#0f172a' }}>Goal:</strong> {p.instruction || p.objective}
            </div>
          </section>

          {/* 2. What Thaara will say (ONLY selected channels — never show WhatsApp templates when only AI Calling is selected!) */}
          <section
            aria-label="What Thaara will say"
            data-testid="prepared-communication-card"
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              padding: '1.25rem 1.4rem',
              boxShadow: '0 4px 16px rgba(15, 23, 42, 0.03)'
            }}
          >
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.02rem', fontWeight: 700, color: '#111827' }}>
              What Thaara will say
            </h3>

            {p.channels.includes('phone') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', fontSize: '0.85rem' }}>
                <div>
                  <label
                    htmlFor="review-opening-message-input"
                    style={{ display: 'block', fontWeight: 600, color: '#1e293b', marginBottom: '0.28rem' }}
                  >
                    Opening message
                  </label>
                  <textarea
                    id="review-opening-message-input"
                    aria-label="Edit opening message"
                    rows={2}
                    value={editableOpeningLine}
                    onChange={e => setEditableOpeningLine(e.target.value)}
                    style={{
                      width: '100%',
                      fontSize: '0.85rem',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      padding: '0.5rem 0.7rem',
                      fontFamily: 'inherit'
                    }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="review-campaign-objective-input"
                    style={{ display: 'block', fontWeight: 600, color: '#1e293b', marginBottom: '0.28rem' }}
                  >
                    Main campaign objective
                  </label>
                  <textarea
                    id="review-campaign-objective-input"
                    aria-label="Edit main campaign objective"
                    rows={2}
                    value={editableEventPitch}
                    onChange={e => setEditableEventPitch(e.target.value)}
                    style={{
                      width: '100%',
                      fontSize: '0.85rem',
                      borderRadius: '10px',
                      border: '1px solid #cbd5e1',
                      padding: '0.5rem 0.7rem',
                      fontFamily: 'inherit'
                    }}
                  />
                </div>
              </div>
            )}

            {p.channels.includes('whatsapp') && (
              <div style={{ marginTop: p.channels.includes('phone') ? '0.85rem' : 0, fontSize: '0.85rem' }}>
                <label style={{ display: 'block', fontWeight: 600, color: '#1e293b', marginBottom: '0.28rem' }}>
                  WhatsApp message ({p.whatsappTemplateName})
                </label>
                <textarea
                  aria-label="Edit WhatsApp template message"
                  rows={2}
                  value={editableWhatsappText}
                  onChange={e => setEditableWhatsappText(e.target.value)}
                  style={{
                    width: '100%',
                    fontSize: '0.84rem',
                    borderRadius: '10px',
                    border: '1px solid #cbd5e1',
                    padding: '0.5rem 0.7rem',
                    fontFamily: 'inherit'
                  }}
                />
              </div>
            )}

            {p.emailPlan && p.channels.includes('email') && (
              <div
                style={{
                  marginTop: '0.85rem',
                  padding: '0.75rem',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  fontSize: '0.84rem'
                }}
              >
                <div style={{ marginBottom: '0.4rem' }}>
                  <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.2rem' }}>Email subject</label>
                  <input
                    type="text"
                    aria-label="Edit email campaign subject"
                    value={editableEmailSubject}
                    onChange={e => setEditableEmailSubject(e.target.value)}
                    style={{
                      width: '100%',
                      fontSize: '0.83rem',
                      padding: '0.35rem 0.55rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.2rem' }}>Email message</label>
                  <textarea
                    aria-label="Edit email campaign body"
                    rows={2}
                    value={editableEmailBody}
                    onChange={e => setEditableEmailBody(e.target.value)}
                    style={{
                      width: '100%',
                      fontSize: '0.83rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      padding: '0.4rem 0.55rem',
                      fontFamily: 'inherit'
                    }}
                  />
                </div>
              </div>
            )}

            {p.onUpdatePlan && (
              <div style={{ marginTop: '0.7rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.8rem', padding: '0.32rem 0.8rem' }}
                  onClick={() =>
                    p.onUpdatePlan?.({
                      ...(p.channels.includes('whatsapp') ? { whatsappMessagePreview: editableWhatsappText } : {}),
                      ...(p.channels.includes('email')
                        ? { emailSubject: editableEmailSubject, emailBodyPreview: editableEmailBody }
                        : {}),
                      callScript: {
                        openingLine: editableOpeningLine,
                        eventPitch: editableEventPitch
                      }
                    })
                  }
                >
                  Save Message Edits
                </button>
              </div>
            )}
          </section>

          {/* 3. Customer questions (3–4 concise, natural example Q&As + "View More Questions") */}
          <section
            aria-label="Customer questions"
            data-testid="sample-grounded-qa-section"
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              padding: '1.25rem 1.4rem',
              boxShadow: '0 4px 16px rgba(15, 23, 42, 0.03)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.5rem',
                flexWrap: 'wrap',
                marginBottom: '0.75rem'
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700, color: '#111827' }}>
                Customer questions
              </h3>
              {allQaItems.length > 4 && (
                <button
                  type="button"
                  data-testid="view-more-questions-button"
                  onClick={() => setShowMoreQuestions(v => !v)}
                  style={{
                    border: '1px solid #ddd6fe',
                    background: '#f5f3ff',
                    color: '#4338ca',
                    borderRadius: '999px',
                    padding: '0.24rem 0.75rem',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {showMoreQuestions ? 'Show Fewer Questions' : 'View More Questions'}
                </button>
              )}
            </div>

            {visibleQaItems.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                  gap: '0.65rem'
                }}
              >
                {visibleQaItems.map(qa => (
                  <div
                    key={qa.question}
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '12px',
                      padding: '0.7rem 0.85rem',
                      fontSize: '0.83rem'
                    }}
                  >
                    <div style={{ fontWeight: 600, color: '#0f172a' }}>“{qa.question}”</div>
                    <div style={{ color: '#334155', marginTop: '0.28rem', lineHeight: 1.45 }}>{qa.answer}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '0.84rem', color: '#475569' }}>
                Thaara answers customer questions naturally using your verified company knowledge and offers a human
                follow-up whenever a detail is unconfirmed.
              </div>
            )}

            {p.onAskQuestion && showMoreQuestions && (
              <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  aria-label="Test a customer question against this campaign"
                  data-testid="ask-campaign-question-input"
                  placeholder="Ask a sample customer question to preview Thaara’s answer..."
                  value={testQuestionInput}
                  onChange={e => setTestQuestionInput(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: '220px',
                    padding: '0.4rem 0.65rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.82rem'
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="ask-campaign-question-button"
                  disabled={askingQuestion || !testQuestionInput.trim()}
                  onClick={async () => {
                    if (!p.onAskQuestion || !testQuestionInput.trim()) return;
                    setAskingQuestion(true);
                    try {
                      const res = await p.onAskQuestion(testQuestionInput.trim());
                      setTestedQaResult(res);
                    } finally {
                      setAskingQuestion(false);
                    }
                  }}
                >
                  {askingQuestion ? 'Checking...' : 'Preview Answer'}
                </button>
              </div>
            )}

            {testedQaResult && (
              <div
                data-testid="tested-qa-answer-box"
                style={{
                  marginTop: '0.55rem',
                  padding: '0.6rem 0.8rem',
                  background: '#f5f3ff',
                  border: '1px solid #ddd6fe',
                  borderRadius: '10px',
                  fontSize: '0.82rem'
                }}
              >
                <div style={{ fontWeight: 600 }}>“{testedQaResult.question}”</div>
                <div style={{ marginTop: '0.2rem', color: '#1e293b' }}>{testedQaResult.answer}</div>
              </div>
            )}
          </section>

          {/* 4. Contact readiness (Distinguishes Simulated Test Eligibility vs Verified Real-World Consent) */}
          <section
            aria-label="Contact readiness"
            data-testid="contact-readiness-card"
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              padding: '1.25rem 1.4rem',
              boxShadow: '0 4px 16px rgba(15, 23, 42, 0.03)'
            }}
          >
            <h3 style={{ margin: '0 0 0.55rem', fontSize: '1.02rem', fontWeight: 700, color: '#111827' }}>
              Contact readiness
            </h3>
            {!isSyntheticFixtureRun && (
              <div
                data-testid="import-success-summary"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '8px',
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  color: '#065f46',
                  marginBottom: '0.55rem',
                  fontSize: '0.82rem',
                  fontWeight: 600
                }}
              >
                ✓ Imported Successfully: {p.metrics.totalContacts} contact{p.metrics.totalContacts === 1 ? '' : 's'}
                {p.metrics.invalidEntries > 0 ? ` · ${p.metrics.invalidEntries} invalid skipped` : ''}
                {p.metrics.duplicateEntries > 0 ? ` · ${p.metrics.duplicateEntries} duplicate skipped` : ''}
                {' · '}Ready to Call: {eligibleContacts.length}
                {' · '}Awaiting Consent: {unauthorizedContacts.filter(r => !r.contact.dnd && !r.contact.optedOut).length}
                {' · '}DND / Opt-out Blocked: {p.contacts.filter(r => r.contact.dnd || r.contact.optedOut).length}
              </div>
            )}
            {isSyntheticFixtureRun ? (
              <div style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 1.5 }}>
                <div
                  style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: '10px',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    color: '#14532d',
                    marginBottom: '0.55rem'
                  }}
                >
                  <strong>Simulated Test Eligibility ({eligibleContacts.length} fictional business contacts):</strong>{' '}
                  These synthetic contacts contain non-dialable test IDs (not real phone numbers), are never saved to
                  your Phone Contacts directory, and are enabled strictly inside this non-sending simulation.
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  <strong>Real-World Calling Consent Unchanged:</strong> Any real customer campaign continues to require
                  verified calling consent, DND clearance, and per-call owner approval.
                </div>
              </div>
            ) : eligibleContacts.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 1.5 }}>
                <div
                  style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: '10px',
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    color: '#92400e',
                    marginBottom: '0.65rem'
                  }}
                >
                  <strong>0 of {p.metrics.totalContacts} uploaded contacts have verified calling consent:</strong> All{' '}
                  {unauthorizedContacts.length} uploaded phone numbers were safely held back because they lacked
                  verified calling consent and were not matched to consented Phone Contacts. Consent rules are never
                  bypassed.
                </div>
                {unauthorizedContacts.some(r => !r.contact.optedOut && !r.contact.dnd) && p.onUpdatePlan && (
                  <div
                    data-testid="review-per-recipient-consent-panel"
                    style={{
                      marginBottom: '0.65rem',
                      padding: '0.65rem',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      display: 'grid',
                      gap: '0.45rem'
                    }}
                  >
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a' }}>
                      Verify Existing Consent Per Unsaved Recipient (source, date &amp; channel required):
                    </div>
                    {(() => {
                      const awaitingList = unauthorizedContacts.filter(r => !r.contact.optedOut && !r.contact.dnd);
                      if (awaitingList.length < 2) return null;
                      const todayIso = new Date().toISOString().slice(0, 10);
                      const usePhone = p.channels.includes('phone') && batchConsentPhone;
                      const useWa = p.channels.includes('whatsapp') && batchConsentWhatsapp;
                      const canBatchConfirm =
                        Boolean(batchConsentSource) &&
                        Boolean(batchConsentDate) &&
                        batchConsentDate <= todayIso &&
                        (usePhone || useWa) &&
                        !isViewingEarlierReadOnlyStage;
                      return (
                        <div
                          data-testid="review-batch-consent-bar"
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '0.4rem',
                            padding: '0.45rem 0.55rem',
                            background: '#eff6ff',
                            borderRadius: '6px',
                            border: '1px solid #bfdbfe',
                            fontSize: '0.75rem'
                          }}
                        >
                          <strong style={{ color: '#1e3a8a' }}>Apply genuine shared consent ({awaitingList.length}):</strong>
                          <select
                            aria-label="Shared consent source"
                            value={batchConsentSource}
                            onChange={e => setBatchConsentSource(e.target.value)}
                            style={{ fontSize: '0.74rem', padding: '0.2rem 0.35rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                          >
                            <option value="">Select consent source...</option>
                            <option value="written_consent">Written / form consent</option>
                            <option value="inbound_enquiry">Inbound enquiry opt-in</option>
                            <option value="verbal_recorded">Recorded verbal consent</option>
                          </select>
                          <input
                            type="date"
                            aria-label="Shared consent date"
                            max={todayIso}
                            value={batchConsentDate}
                            onChange={e => setBatchConsentDate(e.target.value)}
                            style={{ fontSize: '0.74rem', padding: '0.18rem 0.35rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                          />
                          {p.channels.includes('phone') && (
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                              <input type="checkbox" checked={batchConsentPhone} onChange={e => setBatchConsentPhone(e.target.checked)} />
                              Call
                            </label>
                          )}
                          {p.channels.includes('whatsapp') && (
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                              <input type="checkbox" checked={batchConsentWhatsapp} onChange={e => setBatchConsentWhatsapp(e.target.checked)} />
                              WhatsApp
                            </label>
                          )}
                          <button
                            type="button"
                            className="btn btn-primary"
                            data-testid="review-confirm-all-consent-button"
                            disabled={!canBatchConfirm}
                            onClick={() => {
                              const patchMap: Record<
                                string,
                                { phone?: boolean; whatsapp?: boolean; source: 'written_consent' | 'inbound_enquiry' | 'verbal_recorded'; recordedAt: string }
                              > = {};
                              for (const rec of awaitingList) {
                                patchMap[rec.contact.contactId] = {
                                  ...(p.channels.includes('phone') && rec.contact.phoneE164 ? { phone: batchConsentPhone } : {}),
                                  ...(p.channels.includes('whatsapp') && rec.contact.whatsappE164 ? { whatsapp: batchConsentWhatsapp } : {}),
                                  source: batchConsentSource as 'written_consent' | 'inbound_enquiry' | 'verbal_recorded',
                                  recordedAt: batchConsentDate
                                };
                              }
                              p.onUpdatePlan?.({ ownerVerifiedConsent: patchMap });
                            }}
                            style={{ fontSize: '0.74rem', padding: '0.25rem 0.6rem' }}
                          >
                            Confirm Genuine Consent for All ({awaitingList.length})
                          </button>
                        </div>
                      );
                    })()}
                    {unauthorizedContacts
                      .filter(r => !r.contact.optedOut && !r.contact.dnd)
                      .map(r => {
                        const cid = r.contact.contactId;
                        const ev = consentEvidenceByContact[cid] ?? {
                          source: '',
                          recordedAt: '',
                          phone: p.channels.includes('phone') && Boolean(r.contact.phoneE164),
                          whatsapp: p.channels.includes('whatsapp') && Boolean(r.contact.whatsappE164)
                        };
                        const todayIso = new Date().toISOString().slice(0, 10);
                        const canConfirm =
                          Boolean(ev.source) &&
                          Boolean(ev.recordedAt) &&
                          ev.recordedAt <= todayIso &&
                          (ev.phone || ev.whatsapp) &&
                          !isViewingEarlierReadOnlyStage;
                        return (
                          <div
                            key={cid}
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              gap: '0.4rem',
                              padding: '0.4rem 0.5rem',
                              background: '#ffffff',
                              borderRadius: '6px',
                              border: '1px solid #e2e8f0',
                              fontSize: '0.75rem'
                            }}
                          >
                            <span style={{ fontWeight: 600, minWidth: '130px' }}>
                              {r.contact.name} ({r.contact.maskedPhone ?? 'N/A'})
                            </span>
                            <select
                              aria-label={`Consent source for ${r.contact.name}`}
                              value={ev.source}
                              onChange={e =>
                                setConsentEvidenceByContact(prev => ({
                                  ...prev,
                                  [cid]: { ...ev, source: e.target.value }
                                }))
                              }
                              style={{ fontSize: '0.74rem', padding: '0.2rem 0.35rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                            >
                              <option value="">Select consent source...</option>
                              <option value="written_consent">Written / form consent</option>
                              <option value="inbound_enquiry">Inbound enquiry opt-in</option>
                              <option value="verbal_recorded">Recorded verbal consent</option>
                            </select>
                            <input
                              type="date"
                              aria-label={`Consent date for ${r.contact.name}`}
                              max={todayIso}
                              value={ev.recordedAt}
                              onChange={e =>
                                setConsentEvidenceByContact(prev => ({
                                  ...prev,
                                  [cid]: { ...ev, recordedAt: e.target.value }
                                }))
                              }
                              style={{ fontSize: '0.74rem', padding: '0.18rem 0.35rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                            />
                            {p.channels.includes('phone') && r.contact.phoneE164 && (
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                <input
                                  type="checkbox"
                                  checked={ev.phone}
                                  onChange={e =>
                                    setConsentEvidenceByContact(prev => ({
                                      ...prev,
                                      [cid]: { ...ev, phone: e.target.checked }
                                    }))
                                  }
                                />
                                Call
                              </label>
                            )}
                            {p.channels.includes('whatsapp') && r.contact.whatsappE164 && (
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                <input
                                  type="checkbox"
                                  checked={ev.whatsapp}
                                  onChange={e =>
                                    setConsentEvidenceByContact(prev => ({
                                      ...prev,
                                      [cid]: { ...ev, whatsapp: e.target.checked }
                                    }))
                                  }
                                />
                                WhatsApp
                              </label>
                            )}
                            <button
                              type="button"
                              className="btn btn-secondary"
                              data-testid={`review-confirm-consent-${cid}`}
                              disabled={!canConfirm}
                              onClick={() =>
                                p.onUpdatePlan?.({
                                  ownerVerifiedConsent: {
                                    [cid]: {
                                      phone: ev.phone,
                                      whatsapp: ev.whatsapp,
                                      source: ev.source as 'written_consent' | 'inbound_enquiry' | 'verbal_recorded',
                                      recordedAt: ev.recordedAt,
                                      campaignScope: p.campaignId
                                    }
                                  }
                                })
                              }
                              style={{ fontSize: '0.74rem', padding: '0.2rem 0.5rem', fontWeight: 600 }}
                            >
                              Confirm Written Consent
                            </button>
                          </div>
                        );
                      })}
                  </div>
                )}
                {p.onPrepareSyntheticSimulation && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="prepare-synthetic-simulation-button"
                    onClick={() => p.onPrepareSyntheticSimulation?.()}
                    style={{ fontSize: '0.83rem', fontWeight: 600 }}
                  >
                    Prepare Safe 5-Contact Synthetic Simulation (Uses This Uploaded Knowledge)
                  </button>
                )}
              </div>
            ) : (
              <div style={{ fontSize: '0.85rem', color: '#334155', lineHeight: 1.5 }}>
                {p.sourceType === 'pdf' && (
                  <div
                    data-testid="pdf-verification-notice"
                    style={{
                      padding: '0.55rem 0.75rem',
                      borderRadius: '8px',
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      color: '#92400e',
                      marginBottom: '0.55rem',
                      fontSize: '0.8rem'
                    }}
                  >
                    <strong>PDF Contact Verification Required:</strong> Numbers were extracted from an uploaded PDF. Please verify the masked numbers below before approving.
                  </div>
                )}
                <strong>{eligibleContacts.length}</strong> of <strong>{p.metrics.totalContacts}</strong> contacts have
                verified channel consent and are ready to participate
                {unauthorizedContacts.length > 0
                  ? ` (${unauthorizedContacts.length} held back without verified consent)`
                  : ''}
                .
                {unauthorizedContacts.some(r => !r.contact.optedOut && !r.contact.dnd) && p.onUpdatePlan && (
                  <div
                    data-testid="review-per-recipient-consent-panel"
                    style={{
                      marginTop: '0.6rem',
                      padding: '0.65rem',
                      borderRadius: '8px',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      display: 'grid',
                      gap: '0.45rem'
                    }}
                  >
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#0f172a' }}>
                      Verify Existing Consent Per Unsaved Recipient (source, date &amp; channel required):
                    </div>
                    {(() => {
                      const awaitingList = unauthorizedContacts.filter(r => !r.contact.optedOut && !r.contact.dnd);
                      if (awaitingList.length < 2) return null;
                      const todayIso = new Date().toISOString().slice(0, 10);
                      const usePhone = p.channels.includes('phone') && batchConsentPhone;
                      const useWa = p.channels.includes('whatsapp') && batchConsentWhatsapp;
                      const canBatchConfirm =
                        Boolean(batchConsentSource) &&
                        Boolean(batchConsentDate) &&
                        batchConsentDate <= todayIso &&
                        (usePhone || useWa) &&
                        !isViewingEarlierReadOnlyStage;
                      return (
                        <div
                          data-testid="review-batch-consent-bar"
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '0.4rem',
                            padding: '0.45rem 0.55rem',
                            background: '#eff6ff',
                            borderRadius: '6px',
                            border: '1px solid #bfdbfe',
                            fontSize: '0.75rem'
                          }}
                        >
                          <strong style={{ color: '#1e3a8a' }}>Apply genuine shared consent ({awaitingList.length}):</strong>
                          <select
                            aria-label="Shared consent source"
                            value={batchConsentSource}
                            onChange={e => setBatchConsentSource(e.target.value)}
                            style={{ fontSize: '0.74rem', padding: '0.2rem 0.35rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                          >
                            <option value="">Select consent source...</option>
                            <option value="written_consent">Written / form consent</option>
                            <option value="inbound_enquiry">Inbound enquiry opt-in</option>
                            <option value="verbal_recorded">Recorded verbal consent</option>
                          </select>
                          <input
                            type="date"
                            aria-label="Shared consent date"
                            max={todayIso}
                            value={batchConsentDate}
                            onChange={e => setBatchConsentDate(e.target.value)}
                            style={{ fontSize: '0.74rem', padding: '0.18rem 0.35rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                          />
                          {p.channels.includes('phone') && (
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                              <input type="checkbox" checked={batchConsentPhone} onChange={e => setBatchConsentPhone(e.target.checked)} />
                              Call
                            </label>
                          )}
                          {p.channels.includes('whatsapp') && (
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                              <input type="checkbox" checked={batchConsentWhatsapp} onChange={e => setBatchConsentWhatsapp(e.target.checked)} />
                              WhatsApp
                            </label>
                          )}
                          <button
                            type="button"
                            className="btn btn-primary"
                            data-testid="review-confirm-all-consent-button"
                            disabled={!canBatchConfirm}
                            onClick={() => {
                              const patchMap: Record<
                                string,
                                { phone?: boolean; whatsapp?: boolean; source: 'written_consent' | 'inbound_enquiry' | 'verbal_recorded'; recordedAt: string }
                              > = {};
                              for (const rec of awaitingList) {
                                patchMap[rec.contact.contactId] = {
                                  ...(p.channels.includes('phone') && rec.contact.phoneE164 ? { phone: batchConsentPhone } : {}),
                                  ...(p.channels.includes('whatsapp') && rec.contact.whatsappE164 ? { whatsapp: batchConsentWhatsapp } : {}),
                                  source: batchConsentSource as 'written_consent' | 'inbound_enquiry' | 'verbal_recorded',
                                  recordedAt: batchConsentDate
                                };
                              }
                              p.onUpdatePlan?.({ ownerVerifiedConsent: patchMap });
                            }}
                            style={{ fontSize: '0.74rem', padding: '0.25rem 0.6rem' }}
                          >
                            Confirm Genuine Consent for All ({awaitingList.length})
                          </button>
                        </div>
                      );
                    })()}
                    {unauthorizedContacts
                      .filter(r => !r.contact.optedOut && !r.contact.dnd)
                      .map(r => {
                        const cid = r.contact.contactId;
                        const ev = consentEvidenceByContact[cid] ?? {
                          source: '',
                          recordedAt: '',
                          phone: p.channels.includes('phone') && Boolean(r.contact.phoneE164),
                          whatsapp: p.channels.includes('whatsapp') && Boolean(r.contact.whatsappE164)
                        };
                        const todayIso = new Date().toISOString().slice(0, 10);
                        const canConfirm =
                          Boolean(ev.source) &&
                          Boolean(ev.recordedAt) &&
                          ev.recordedAt <= todayIso &&
                          (ev.phone || ev.whatsapp) &&
                          !isViewingEarlierReadOnlyStage;
                        return (
                          <div
                            key={cid}
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                              gap: '0.4rem',
                              padding: '0.4rem 0.5rem',
                              background: '#ffffff',
                              borderRadius: '6px',
                              border: '1px solid #e2e8f0',
                              fontSize: '0.75rem'
                            }}
                          >
                            <span style={{ fontWeight: 600, minWidth: '130px' }}>
                              {r.contact.name} ({r.contact.maskedPhone ?? 'N/A'})
                            </span>
                            <select
                              aria-label={`Consent source for ${r.contact.name}`}
                              value={ev.source}
                              onChange={e =>
                                setConsentEvidenceByContact(prev => ({
                                  ...prev,
                                  [cid]: { ...ev, source: e.target.value }
                                }))
                              }
                              style={{ fontSize: '0.74rem', padding: '0.2rem 0.35rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                            >
                              <option value="">Select consent source...</option>
                              <option value="written_consent">Written / form consent</option>
                              <option value="inbound_enquiry">Inbound enquiry opt-in</option>
                              <option value="verbal_recorded">Recorded verbal consent</option>
                            </select>
                            <input
                              type="date"
                              aria-label={`Consent date for ${r.contact.name}`}
                              max={todayIso}
                              value={ev.recordedAt}
                              onChange={e =>
                                setConsentEvidenceByContact(prev => ({
                                  ...prev,
                                  [cid]: { ...ev, recordedAt: e.target.value }
                                }))
                              }
                              style={{ fontSize: '0.74rem', padding: '0.18rem 0.35rem', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                            />
                            {p.channels.includes('phone') && r.contact.phoneE164 && (
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                <input
                                  type="checkbox"
                                  checked={ev.phone}
                                  onChange={e =>
                                    setConsentEvidenceByContact(prev => ({
                                      ...prev,
                                      [cid]: { ...ev, phone: e.target.checked }
                                    }))
                                  }
                                />
                                Call
                              </label>
                            )}
                            {p.channels.includes('whatsapp') && r.contact.whatsappE164 && (
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                                <input
                                  type="checkbox"
                                  checked={ev.whatsapp}
                                  onChange={e =>
                                    setConsentEvidenceByContact(prev => ({
                                      ...prev,
                                      [cid]: { ...ev, whatsapp: e.target.checked }
                                    }))
                                  }
                                />
                                WhatsApp
                              </label>
                            )}
                            <button
                              type="button"
                              className="btn btn-secondary"
                              data-testid={`review-confirm-consent-${cid}`}
                              disabled={!canConfirm}
                              onClick={() =>
                                p.onUpdatePlan?.({
                                  ownerVerifiedConsent: {
                                    [cid]: {
                                      phone: ev.phone,
                                      whatsapp: ev.whatsapp,
                                      source: ev.source as 'written_consent' | 'inbound_enquiry' | 'verbal_recorded',
                                      recordedAt: ev.recordedAt,
                                      campaignScope: p.campaignId
                                    }
                                  }
                                })
                              }
                              style={{ fontSize: '0.74rem', padding: '0.2rem 0.5rem', fontWeight: 600 }}
                            >
                              Confirm Written Consent
                            </button>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 5. Next action (Single obvious primary CTA) */}
          <section
            aria-label="Next action"
            data-testid="review-next-action-card"
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              padding: '1.25rem 1.4rem',
              textAlign: 'center',
              boxShadow: '0 4px 16px rgba(15, 23, 42, 0.03)'
            }}
          >
            {needsReapproval && (
              <p role="alert" className="wa-error" style={{ margin: '0 0 0.65rem', fontSize: '0.83rem' }}>
                Campaign details changed since review. Please approve the updated summary to continue.
              </p>
            )}
            {!hasAnyLiveChannel && (
              <div
                data-testid="review-live-unavailable-notice"
                style={{
                  marginBottom: '0.75rem',
                  padding: '0.6rem 0.9rem',
                  borderRadius: '10px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  fontSize: '0.82rem',
                  color: '#475569'
                }}
              >
                <strong>Live calling is currently unavailable.</strong> Test mode — No real calls or messages will be sent.
              </div>
            )}
            {p.approveAndStartError && (
              <div
                role="alert"
                data-testid="review-approve-and-start-error"
                style={{
                  marginBottom: '0.75rem',
                  padding: '0.6rem 0.9rem',
                  borderRadius: '10px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  fontSize: '0.82rem',
                  color: '#991b1b'
                }}
              >
                {p.approveAndStartError}
              </div>
            )}
            {isAutoFollowup ? (
              <div
                data-testid="auto-followup-review-card"
                style={{
                  textAlign: 'left',
                  padding: '1rem 1.15rem',
                  borderRadius: '14px',
                  border: '1px solid #c7d2fe',
                  background: '#f8fafc',
                  marginBottom: '0.75rem'
                }}
              >
                <div style={{ fontSize: '0.96rem', fontWeight: 700, color: '#0f172a', marginBottom: '0.55rem' }}>
                  Standing Authorization — Automatic Lead Follow-up Review
                </div>
                <div style={{ display: 'grid', gap: '0.35rem', fontSize: '0.82rem', color: '#334155', marginBottom: '0.85rem' }}>
                  <div><strong>Campaign Name:</strong> {p.title}</div>
                  <div>
                    <strong>Connected Google Sheet:</strong> {p.sheetMonitor?.spreadsheetName ?? 'Connected Sheet'} · Tab:{' '}
                    <code>{p.sheetMonitor?.tabName ?? 'Sheet1'}</code>
                    {p.sheetMonitor?.googleAccountEmail ? (
                      <> · Account: <code>{p.sheetMonitor.googleAccountEmail}</code></>
                    ) : null}
                  </div>
                  {(p.sheetMonitor?.metaCampaignRef || p.sheetMonitor?.metaFormId) && (
                    <div>
                      <strong>Meta Association:</strong>{' '}
                      {[p.sheetMonitor?.metaCampaignRef, p.sheetMonitor?.metaFormId].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  <div><strong>Authorized Channels:</strong> {p.channels.join(', ')}</div>
                  <div>
                    <strong>Calling Policy & Limits:</strong>{' '}
                    {p.standingAuthorization?.callingHoursIst.startHour ?? 9}:00–{p.standingAuthorization?.callingHoursIst.endHour ?? 20}:00 IST · Max{' '}
                    {p.standingAuthorization?.maxAttemptsPerLead ?? 2} attempt(s)/lead ·{' '}
                    {(p.standingAuthorization?.retryOnNoAnswer ?? true) ? `Retry after ${p.standingAuthorization?.retryDelayMinutes ?? 60} min` : 'No auto-retry'} ·{' '}
                    Max {p.standingAuthorization?.maxLeadsPerDay ?? 250} leads/day
                  </div>
                  <div>
                    <strong>Existing Rows:</strong>{' '}
                    {p.sheetMonitor?.processExistingBacklog
                      ? 'Existing historical rows will be processed.'
                      : `Historical rows will be skipped on activation (${p.contacts.length} existing row(s) recorded as baseline).`}
                  </div>
                  <div>
                    <strong>Consent Requirements:</strong> Only new rows with verified calling consent (not DND or opted-out) will be called.
                  </div>
                </div>
                {p.autoFollowupError && (
                  <div role="alert" data-testid="auto-followup-activate-error" style={{ marginBottom: '0.65rem', color: '#991b1b', fontSize: '0.82rem', fontWeight: 600 }}>
                    {p.autoFollowupError}
                  </div>
                )}
                <div style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    data-testid="approve-activate-auto-followup-button"
                    disabled={isViewingEarlierReadOnlyStage}
                    onClick={() => p.onActivateAutoFollowup?.(p.materialHash)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      minWidth: '280px',
                      padding: '0.85rem 2.2rem',
                      borderRadius: '12px',
                      border: 'none',
                      background: isViewingEarlierReadOnlyStage
                        ? '#94a3b8'
                        : 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                      color: '#ffffff',
                      fontSize: '0.96rem',
                      fontWeight: 600,
                      cursor: isViewingEarlierReadOnlyStage ? 'not-allowed' : 'pointer',
                      boxShadow: isViewingEarlierReadOnlyStage ? 'none' : '0 6px 18px rgba(79, 70, 229, 0.25)'
                    }}
                  >
                    <span>→</span>
                    <span>Approve &amp; Activate Automatic Follow-up</span>
                  </button>
                  <div style={{ marginTop: '0.45rem', fontSize: '0.78rem', color: '#64748b' }}>
                    Standing authorization only activates when you click above. No historical rows or calls start automatically.
                  </div>
                </div>
              </div>
            ) : eligibleContacts.length === 0 ? (
              <div
                data-testid="no-eligible-contacts-notice"
                style={{
                  padding: '0.75rem 1.25rem',
                  borderRadius: '12px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#991b1b',
                  fontSize: '0.86rem',
                  fontWeight: 600,
                  textAlign: 'center'
                }}
              >
                {unauthorizedContacts.length > 0
                  ? 'Calling is paused until consent is verified: Confirm genuine existing consent per recipient above (source, date & channel) before approving — no CSV reformatting needed.'
                  : 'No valid contacts were imported. Paste numbers, upload TXT/CSV/Excel/PDF, or select saved contacts.'}
              </div>
            ) : (
              <button
                type="button"
                data-testid={hasAnyLiveChannel ? 'approve-and-start-campaign-button' : 'approve-and-run-test-button'}
                disabled={eligibleContacts.length === 0 || isViewingEarlierReadOnlyStage}
                onClick={() => {
                  const targetMode: 'live' | 'simulation' = hasAnyLiveChannel ? 'live' : 'simulation';
                  if (p.onApproveAndStart) {
                    p.onApproveAndStart(p.materialHash, targetMode);
                  } else if (p.onApproveForSimulation && targetMode === 'simulation') {
                    p.onApproveForSimulation(p.materialHash);
                  } else {
                    p.onApprove?.(p.materialHash);
                  }
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  minWidth: '260px',
                  padding: '0.85rem 2.2rem',
                  borderRadius: '12px',
                  border: 'none',
                  background:
                    eligibleContacts.length === 0 || isViewingEarlierReadOnlyStage
                      ? '#94a3b8'
                      : 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                  color: '#ffffff',
                  fontSize: '0.96rem',
                  fontWeight: 600,
                  cursor: eligibleContacts.length === 0 || isViewingEarlierReadOnlyStage ? 'not-allowed' : 'pointer',
                  boxShadow:
                    eligibleContacts.length === 0 || isViewingEarlierReadOnlyStage
                      ? 'none'
                      : '0 6px 18px rgba(79, 70, 229, 0.25)'
                }}
              >
                <span>→</span>
                <span>
                  {p.status === 'approved' && !hasAnyBatchJob
                    ? 'Retry Start Campaign'
                    : hasAnyLiveChannel
                      ? 'Approve & Start Campaign'
                      : 'Approve & Run Test'}
                </span>
              </button>
            )}
            <div style={{ marginTop: '0.45rem', fontSize: '0.79rem', color: '#64748b' }}>
              {hasAnyLiveChannel
                ? 'Approving authorizes this exact campaign and starts execution immediately.'
                : 'Test mode only — no real calls or WhatsApp messages will be sent.'}
            </div>
          </section>
        </div>
      )}

      {/* ========================================================================
          STAGE 3: OWNER-FRIENDLY EXECUTION PROGRESS DASHBOARD
         ======================================================================== */}
      {isExecutionStage && isAutoFollowup && (() => {
        const mon = p.sheetMonitor;
        const monStatus = mon?.status ?? 'active_monitoring';
        const isMonPaused = monStatus === 'paused';
        const isMonStopped = monStatus === 'stopped';
        const isMonError = monStatus === 'attention_required';
        const statusLabel = isMonPaused
          ? 'Status: Paused'
          : isMonStopped
            ? 'Status: Stopped'
            : isMonError
              ? 'Status: Sync Error (Retrying)'
              : 'Status: Active — Monitoring Leads';
        const attemptedCalls = p.contacts.filter(
          c =>
            c.phoneStatus === 'attempted' ||
            c.phoneStatus === 'answered' ||
            c.phoneStatus === 'not_answered' ||
            c.phoneStatus === 'failed'
        ).length;
        const completedCalls = p.contacts.filter(
          c => c.phoneStatus === 'answered' || c.phoneStatus === 'not_answered' || c.phoneStatus === 'failed'
        ).length;
        const followupsScheduled = p.contacts.filter(
          c => c.attendanceOutcome === 'callback_requested' || c.attendanceOutcome === 'interested'
        ).length;
        const historicalRowsCount = mon?.baselineRowCount ?? p.contacts.length;
        const historicalSkipped =
          !mon?.processExistingBacklog &&
          !mon?.existingBacklogProcessed &&
          (historicalRowsCount > 0 || mon?.backlogSkippedReason === 'HISTORICAL_ROWS_SKIPPED_BY_SETTING');
        const existingDiscovered = mon?.existingLeadsDiscoveredCount ?? (mon?.existingBacklogProcessed ? historicalRowsCount : 0);
        const newLeadsReceived = mon?.newLeadsReceivedCount ?? mon?.leadsReceivedCount ?? 0;

        return (
          <section
            aria-label="Automatic Lead Follow-up Monitor"
            data-testid="auto-followup-monitor-dashboard"
            style={{
              border: '1px solid #c7d2fe',
              borderRadius: '16px',
              padding: '1.4rem 1.5rem',
              background: '#ffffff',
              boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)',
              marginBottom: '1rem'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.9rem' }}>
              <div>
                <h3 data-testid="auto-followup-status-heading" style={{ margin: 0, fontSize: '1.08rem', fontWeight: 700, color: '#0f172a' }}>
                  {statusLabel}
                </h3>
                <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: '0.2rem' }}>
                  Connected Google Sheet: <strong>{mon?.spreadsheetName ?? 'Google Sheet'}</strong> (<code>{mon?.tabName ?? 'Sheet1'}</code>)
                  {mon?.googleAccountEmail ? <> · Account: <code>{mon.googleAccountEmail}</code></> : null}
                  {' · '}Last sync: <strong>{mon?.lastSyncAt ? new Date(mon.lastSyncAt).toLocaleString() : 'Awaiting first poll'}</strong>
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                {!isMonStopped && !mon?.existingBacklogProcessed && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="auto-followup-process-existing-button"
                    disabled={backlogBusy}
                    onClick={async () => {
                      setBacklogExplicitApproved(false);
                      setShowBacklogCard(true);
                      setBacklogBusy(true);
                      try {
                        await p.onPreviewExistingBacklog?.();
                      } finally {
                        setBacklogBusy(false);
                      }
                    }}
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
                  >
                    {backlogBusy ? 'Checking Sheet...' : 'Process Existing Leads'}
                  </button>
                )}
                {!isMonPaused && !isMonStopped && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="auto-followup-sync-button"
                    onClick={() => p.onSyncAutoFollowupNow?.()}
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                  >
                    Sync Now
                  </button>
                )}
                {!isMonPaused && !isMonStopped && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="auto-followup-pause-button"
                    onClick={() => p.onPauseAutoFollowup?.()}
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                  >
                    Pause
                  </button>
                )}
                {isMonPaused && !isMonStopped && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="auto-followup-resume-button"
                    onClick={() => p.onResumeAutoFollowup?.()}
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                  >
                    Resume
                  </button>
                )}
                {!isMonStopped && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="auto-followup-stop-button"
                    onClick={() => p.onStopAutoFollowup?.()}
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', color: '#b91c1c', borderColor: '#fecaca' }}
                  >
                    Stop
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="auto-followup-view-results-button"
                  onClick={() => setViewStageOverride('results')}
                  style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}
                >
                  View Results
                </button>
              </div>
            </div>

            {historicalSkipped && (
              <div
                data-testid="auto-followup-historical-skipped-notice"
                style={{
                  marginBottom: '0.85rem',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '10px',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  color: '#92400e',
                  fontSize: '0.82rem',
                  lineHeight: 1.45
                }}
              >
                <strong>Historical rows intentionally skipped ({historicalRowsCount} existing row{historicalRowsCount === 1 ? '' : 's'}):</strong>{' '}
                Existing rows in <code>{mon?.spreadsheetName ?? 'the connected Sheet'}</code> were recorded as the baseline when activated with{' '}
                <em>Skip historical rows</em> enabled, so only newly arriving rows are called automatically. Click{' '}
                <strong>Process Existing Leads</strong> to review consent and approve calling eligible existing leads.
              </div>
            )}

            {showBacklogCard && !isMonStopped && (
              <div
                data-testid="auto-followup-backlog-preview-card"
                style={{
                  marginBottom: '0.9rem',
                  padding: '0.95rem 1.05rem',
                  borderRadius: '12px',
                  border: '1px solid #93c5fd',
                  background: '#eff6ff'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.55rem' }}>
                  <strong style={{ fontSize: '0.92rem', color: '#1e3a8a' }}>Review Existing Google Sheet Leads (Phase A)</strong>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem' }}
                    onClick={() => setShowBacklogCard(false)}
                  >
                    Close
                  </button>
                </div>
                {p.existingBacklogPreview ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      {[
                        { label: 'Total Existing Sheet Rows', value: p.existingBacklogPreview.totalExistingRows },
                        { label: 'Previously Processed', value: p.existingBacklogPreview.previouslyProcessedCount },
                        { label: 'Eligible Contacts', value: p.existingBacklogPreview.eligibleCount },
                        { label: 'Consent-Blocked', value: p.existingBacklogPreview.consentBlockedCount },
                        { label: 'Duplicates', value: p.existingBacklogPreview.duplicatesCount },
                        { label: 'Est. Calls Within Limits', value: p.existingBacklogPreview.estimatedCallsWithinLimits }
                      ].map(item => (
                        <div key={item.label} style={{ padding: '0.5rem 0.65rem', borderRadius: '8px', background: '#ffffff', border: '1px solid #bfdbfe' }}>
                          <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 600 }}>{item.label}</div>
                          <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                    {p.existingBacklogPreview.consentBlockedCount > 0 && !mon?.sheetConsentAttestation?.confirmed && p.onEnableSheetConsent && (
                      <div
                        data-testid="enable-sheet-consent-banner"
                        style={{
                          marginBottom: '0.75rem',
                          padding: '0.65rem 0.8rem',
                          borderRadius: '8px',
                          border: '1px solid #fdba74',
                          background: '#fff7ed',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.45rem'
                        }}
                      >
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#9a3412' }}>
                          Sheet rows have no consent column — enable automatic consent for this Google Sheet
                        </div>
                        <div style={{ fontSize: '0.76rem', color: '#7c2d12' }}>
                          Confirm once that leads in <code>{mon?.spreadsheetName ?? 'this Google Sheet'}</code> already have genuine calling consent. Thaara will automatically set verified consent during conversion for existing and all future rows (DND, opt-out &amp; Consent=No rows stay blocked).
                        </div>
                        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <select
                            aria-label="Sheet consent source"
                            value={consentSourceInput}
                            onChange={e => setConsentSourceInput(e.target.value as typeof consentSourceInput)}
                            style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff' }}
                          >
                            <option value="lead_form_disclosure">Meta / Web Lead-Form Disclosure</option>
                            <option value="inbound_enquiry">Inbound Enquiry</option>
                            <option value="written_consent">Written Consent</option>
                            <option value="verbal_recorded">Verbal Recorded Consent</option>
                          </select>
                          <button
                            type="button"
                            className="btn btn-primary"
                            data-testid="enable-sheet-consent-button"
                            disabled={consentVerifyBusy}
                            style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                            onClick={async () => {
                              setConsentVerifyBusy(true);
                              try {
                                await p.onEnableSheetConsent?.({
                                  confirmed: true,
                                  consentSource: consentSourceInput,
                                  evidenceReference: mon?.spreadsheetName || 'Connected Google Sheet'
                                });
                                await p.onPreviewExistingBacklog?.();
                              } finally {
                                setConsentVerifyBusy(false);
                              }
                            }}
                          >
                            {consentVerifyBusy ? 'Enabling...' : 'Enable Auto-Consent for This Sheet'}
                          </button>
                        </div>
                      </div>
                    )}
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.82rem', color: '#1e293b', marginBottom: '0.7rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        data-testid="auto-followup-backlog-approve-checkbox"
                        checked={backlogExplicitApproved}
                        onChange={e => setBacklogExplicitApproved(e.target.checked)}
                      />
                      <span>
                        I explicitly approve expanding this active campaign&apos;s authorization to queue and call the{' '}
                        <strong>{p.existingBacklogPreview.estimatedCallsWithinLimits}</strong> eligible existing lead(s) within the approved daily limit (
                        {p.existingBacklogPreview.maxLeadsPerDay}/day). Consent-blocked and previously processed contacts will remain excluded.
                      </span>
                    </label>
                    <button
                      type="button"
                      className="btn btn-primary"
                      data-testid="auto-followup-backlog-start-button"
                      disabled={!backlogExplicitApproved || backlogBusy || p.existingBacklogPreview.eligibleCount === 0}
                      onClick={async () => {
                        setBacklogBusy(true);
                        try {
                          await p.onProcessExistingBacklog?.(p.materialHash);
                          setShowBacklogCard(false);
                        } finally {
                          setBacklogBusy(false);
                        }
                      }}
                      style={{ fontSize: '0.82rem', padding: '0.45rem 0.95rem' }}
                    >
                      {backlogBusy ? 'Queueing Existing Leads...' : 'Approve & Queue Existing Leads'}
                    </button>
                  </>
                ) : (
                  <div style={{ fontSize: '0.82rem', color: '#475569' }}>Loading live Google Sheet row eligibility...</div>
                )}
              </div>
            )}

            {mon?.lastSyncError && (
              <div role="alert" style={{ marginBottom: '0.8rem', padding: '0.55rem 0.8rem', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '0.8rem' }}>
                Last sync warning: {mon.lastSyncError}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '0.65rem' }}>
              {[
                { label: 'Imported Contacts', value: p.contacts.length },
                { label: 'Existing Leads Discovered', value: existingDiscovered },
                { label: 'New Leads Received', value: newLeadsReceived },
                { label: 'Eligible for Calling', value: mon?.leadsEligibleCount ?? 0 },
                { label: 'Awaiting Consent', value: p.contacts.filter(c => c.category === 'unauthorized' && !c.contact.dnd && !c.contact.optedOut).length },
                { label: 'DND / Opt-out Blocked', value: p.contacts.filter(c => c.contact.dnd || c.contact.optedOut).length },
                { label: 'Consent-Blocked', value: mon?.leadsConsentBlockedCount ?? 0 },
                { label: 'Calls Queued', value: mon?.leadsQueuedCount ?? 0 },
                { label: 'Calls Attempted', value: attemptedCalls },
                { label: 'Calls Completed', value: completedCalls },
                { label: 'Follow-ups Scheduled', value: followupsScheduled }
              ].map(card => (
                <div key={card.label} style={{ padding: '0.65rem 0.75rem', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>{card.label}</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#0f172a', marginTop: '0.15rem' }}>{card.value}</div>
                </div>
              ))}
            </div>

            {(() => {
              const awaitingConsentLeads = p.contacts.filter(
                c => c.category === 'unauthorized' && !c.contact.dnd && !c.contact.optedOut
              );
              if (awaitingConsentLeads.length === 0 || isMonStopped) return null;
              return (
                <div
                  data-testid="auto-followup-awaiting-consent-section"
                  style={{
                    marginTop: '0.9rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '10px',
                    border: '1px solid #fed7aa',
                    background: '#fff7ed'
                  }}
                >
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#9a3412', marginBottom: '0.45rem' }}>
                    Awaiting Calling Consent Verification ({awaitingConsentLeads.length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                    {awaitingConsentLeads.map(c => (
                      <div
                        key={c.contact.contactId}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.45rem',
                          padding: '0.55rem 0.7rem',
                          borderRadius: '8px',
                          background: '#ffffff',
                          border: '1px solid #fdba74'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div style={{ fontSize: '0.8rem', color: '#1e293b' }}>
                            <strong>{c.contact.name}</strong> ({c.contact.maskedPhone ?? 'No phone'}) ·{' '}
                            <span style={{ color: '#9a3412' }}>Awaiting Calling Consent Verification</span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            data-testid={`verify-unsaved-consent-${c.contact.contactId}`}
                            onClick={() => {
                              setConsentVerifyContactId(
                                consentVerifyContactId === c.contact.contactId ? null : c.contact.contactId
                              );
                              setConsentEvidenceInput('');
                              setConsentExplicitApproved(false);
                            }}
                            style={{ fontSize: '0.76rem', padding: '0.3rem 0.65rem' }}
                          >
                            {consentVerifyContactId === c.contact.contactId ? 'Cancel' : 'Verify Calling Consent'}
                          </button>
                        </div>
                        {consentVerifyContactId === c.contact.contactId && (
                          <div
                            data-testid={`verify-unsaved-consent-form-${c.contact.contactId}`}
                            style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', paddingTop: '0.35rem', borderTop: '1px solid #fed7aa' }}
                          >
                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              <select
                                aria-label="Consent Source"
                                value={consentSourceInput}
                                onChange={e => setConsentSourceInput(e.target.value as typeof consentSourceInput)}
                                style={{ fontSize: '0.78rem', padding: '0.3rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                              >
                                <option value="lead_form_disclosure">Meta / Web Lead-Form Disclosure</option>
                                <option value="inbound_enquiry">Inbound Enquiry</option>
                                <option value="written_consent">Written Consent</option>
                                <option value="verbal_recorded">Verbal Recorded Consent</option>
                              </select>
                              <input
                                type="text"
                                placeholder="Genuine consent evidence / Lead Form ID"
                                value={consentEvidenceInput}
                                onChange={e => setConsentEvidenceInput(e.target.value)}
                                style={{ flex: 1, minWidth: '210px', fontSize: '0.78rem', padding: '0.3rem 0.55rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                              />
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.78rem', color: '#1e293b' }}>
                              <input
                                type="checkbox"
                                checked={consentExplicitApproved}
                                onChange={e => setConsentExplicitApproved(e.target.checked)}
                              />
                              I confirm genuine consent evidence exists and explicitly approve calling this unsaved lead (without saving to Phone Contacts).
                            </label>
                            <div>
                              <button
                                type="button"
                                className="btn btn-primary"
                                data-testid={`submit-unsaved-consent-${c.contact.contactId}`}
                                disabled={consentVerifyBusy || !consentExplicitApproved || consentEvidenceInput.trim().length < 3}
                                onClick={async () => {
                                  setConsentVerifyBusy(true);
                                  try {
                                    await p.onVerifyUnsavedLeadConsent?.({
                                      contactId: c.contact.contactId,
                                      consentSource: consentSourceInput,
                                      evidenceReference: consentEvidenceInput.trim(),
                                      explicitOwnerApproval: true
                                    });
                                    setConsentVerifyContactId(null);
                                  } finally {
                                    setConsentVerifyBusy(false);
                                  }
                                }}
                                style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
                              >
                                {consentVerifyBusy ? 'Authorizing & Queueing...' : 'Verify Consent & Queue Call'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </section>
        );
      })()}

      {isExecutionStage && !isAutoFollowup && (() => {
        const activeJobs = batchJobs.filter(j => j.status === 'queued' || j.status === 'running' || j.status === 'paused');
        const primaryJob = activeJobs[0] ?? batchJobs[batchJobs.length - 1];
        const queueItems = batchJobs.flatMap(j => j.recipientQueue ?? []);
        const totalEligible = eligibleContacts.length;
        const processedContactsCount = eligibleContacts.filter(r => {
          const phoneDone =
            !p.channels.includes('phone') ||
            r.phoneStatus === 'answered' ||
            r.phoneStatus === 'not_answered' ||
            r.phoneStatus === 'failed' ||
            r.phoneStatus === 'skipped';
          const waDone =
            !p.channels.includes('whatsapp') ||
            r.whatsappStatus === 'sent' ||
            r.whatsappStatus === 'delivered' ||
            r.whatsappStatus === 'read' ||
            r.whatsappStatus === 'failed' ||
            r.whatsappStatus === 'skipped';
          return phoneDone && waDone && (r.phoneStatus !== 'pending' || r.whatsappStatus !== 'pending');
        }).length;
        const inProgressCount = eligibleContacts.filter(
          r => r.phoneStatus === 'attempted' || r.phoneStatus === 'queued' || r.whatsappStatus === 'queued'
        ).length;
        const failedOrSkippedCount = eligibleContacts.filter(
          r =>
            (p.channels.includes('phone') && (r.phoneStatus === 'failed' || r.phoneStatus === 'skipped')) ||
            (p.channels.includes('whatsapp') && (r.whatsappStatus === 'failed' || r.whatsappStatus === 'skipped'))
        ).length;
        const pendingCount = Math.max(0, totalEligible - processedContactsCount - inProgressCount);
        const progressPct = totalEligible > 0 ? Math.min(100, Math.round((processedContactsCount / totalEligible) * 100)) : 0;

        const isStopped = p.status === 'stopped' || primaryJob?.status === 'stopped';
        const isPaused = !isStopped && (p.status === 'paused' || batchJobs.some(j => j.status === 'paused'));
        const isJobBlockedOrFailed = !isStopped && !isPaused && primaryJob?.status === 'failed';
        const quotaReached =
          !isStopped &&
          batchJobs.some(j => j.failureReason === 'DAILY_CALL_LIMIT_REACHED' || j.status === 'paused') &&
          (queueItems.some(q => q.status === 'pending') || pendingCount > 0);

        const formatContactExecStatus = (r: BulkCampaignContactRecord) => {
          const parts: string[] = [];
          if (p.channels.includes('phone')) {
            if (r.phoneStatus === 'attempted') parts.push('AI Calling: Calling');
            else if (r.phoneStatus === 'answered' && r.attendanceOutcome === 'pending' && !r.phoneTranscriptSummary)
              parts.push('AI Calling: Processing results');
            else if (r.phoneStatus === 'answered') parts.push('AI Calling: Completed');
            else if (r.phoneStatus === 'not_answered') parts.push('AI Calling: No answer');
            else if (r.phoneStatus === 'failed') parts.push('AI Calling: Failed');
            else if (r.phoneStatus === 'queued') parts.push('AI Calling: Waiting');
            else if (quotaReached && r.phoneStatus === 'pending') parts.push('AI Calling: Deferred due to quota');
            else parts.push('AI Calling: Waiting');
          }
          if (p.channels.includes('whatsapp')) {
            if (r.whatsappCustomerReply) parts.push('WhatsApp: Replied');
            else if (r.whatsappStatus === 'read') parts.push('WhatsApp: Read');
            else if (r.whatsappStatus === 'delivered') parts.push('WhatsApp: Delivered');
            else if (r.whatsappStatus === 'sent') parts.push('WhatsApp: Sent');
            else if (r.whatsappStatus === 'queued') parts.push('WhatsApp: Sending');
            else if (r.whatsappStatus === 'failed') parts.push('WhatsApp: Failed');
            else parts.push('WhatsApp: Waiting');
          }
          return parts.join(' · ');
        };

        return (
          <section
            aria-label="Campaign execution progress"
            data-testid="campaign-execution-progress-card"
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              padding: '1.4rem 1.5rem',
              background: '#ffffff',
              boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.6rem',
                marginBottom: '0.9rem'
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 700, color: '#0f172a' }}>
                  {isPaused
                    ? 'Campaign Paused'
                    : isJobBlockedOrFailed
                      ? 'Campaign Dispatch Blocked'
                      : 'Campaign Execution in Progress'}
                </h3>
                <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.2rem' }}>
                  {selectedChannelLabels.join(' · ')} ·{' '}
                  {hasAnyLiveChannel ? 'Live mode' : 'Test mode — No real calls or messages'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {!isViewingEarlierReadOnlyStage && !isPaused && (p.onPause || (primaryJob && p.onPauseN8nJob)) && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="execution-pause-button"
                    onClick={() => {
                      if (primaryJob && p.onPauseN8nJob) p.onPauseN8nJob(primaryJob.jobId);
                      else p.onPause?.();
                    }}
                    style={{ fontSize: '0.82rem', padding: '0.38rem 0.85rem' }}
                  >
                    Pause
                  </button>
                )}
                {!isViewingEarlierReadOnlyStage && isPaused && (p.onResume || (primaryJob && p.onResumeN8nJob)) && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    data-testid="execution-resume-button"
                    onClick={() => {
                      if (primaryJob && p.onResumeN8nJob) p.onResumeN8nJob(primaryJob.jobId);
                      else p.onResume?.();
                    }}
                    style={{ fontSize: '0.82rem', padding: '0.38rem 0.85rem' }}
                  >
                    Resume
                  </button>
                )}
                {!isViewingEarlierReadOnlyStage && (p.onEmergencyStopN8nJobs || p.onStop) && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="execution-stop-button"
                    onClick={() => {
                      if (batchJobs.length > 0 && p.onEmergencyStopN8nJobs) p.onEmergencyStopN8nJobs();
                      else p.onStop?.();
                    }}
                    style={{ fontSize: '0.82rem', padding: '0.38rem 0.85rem', color: '#b91c1c', borderColor: '#fecaca' }}
                  >
                    Stop Campaign
                  </button>
                )}
              </div>
            </div>

            {quotaReached && (
              <div
                data-testid="execution-quota-limit-banner"
                style={{
                  marginBottom: '0.9rem',
                  padding: '0.6rem 0.85rem',
                  borderRadius: '10px',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  fontSize: '0.82rem',
                  color: '#92400e'
                }}
              >
                Daily calling limit reached. Remaining contacts are pending.
              </div>
            )}

            {/* Progress Bar & Summary Counts */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', fontWeight: 600, color: '#0f172a', marginBottom: '0.35rem' }}>
                <span>{processedContactsCount} of {totalEligible} contacts processed</span>
                <span>{progressPct}%</span>
              </div>
              <div style={{ height: '10px', borderRadius: '999px', background: '#e2e8f0', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${progressPct}%`,
                    height: '100%',
                    background: isPaused ? '#f59e0b' : '#4f46e5',
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: '0.5rem',
                  marginTop: '0.75rem'
                }}
              >
                <div style={{ padding: '0.5rem 0.65rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Eligible</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>{totalEligible}</div>
                </div>
                <div style={{ padding: '0.5rem 0.65rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Processed</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#16a34a' }}>{processedContactsCount}</div>
                </div>
                <div style={{ padding: '0.5rem 0.65rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>In Progress</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#4f46e5' }}>{inProgressCount}</div>
                </div>
                <div style={{ padding: '0.5rem 0.65rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Pending</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#64748b' }}>{pendingCount}</div>
                </div>
                <div style={{ padding: '0.5rem 0.65rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Failed / Skipped</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#dc2626' }}>{failedOrSkippedCount}</div>
                </div>
              </div>
            </div>

            {/* Individual Contact Progress */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              {eligibleContacts.map(r => (
                <div
                  key={r.contact.contactId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '0.4rem',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '10px',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.82rem'
                  }}
                >
                  <div>
                    <strong style={{ color: '#0f172a' }}>{r.contact.name}</strong>{' '}
                    <span style={{ color: '#64748b' }}>{r.contact.maskedPhone ?? ''}</span>
                  </div>
                  <div style={{ color: '#475569', fontWeight: 500 }}>{formatContactExecStatus(r)}</div>
                </div>
              ))}
            </div>
          </section>
        );
      })()}

      {/* STAGE 5: SHARED AUTHORITATIVE BULK CAMPAIGN RESULTS */}
      {showResultsSection && (
        <BulkCampaignResultsSection
          campaignId={p.campaignId}
          status={p.status}
          executionMode={p.executionMode}
          channels={p.channels}
          contacts={p.contacts}
          metrics={p.metrics}
          hasBatchOrRealResults={hasBatchOrRealResults}
          onRefresh={p.onReconcile ? () => p.onReconcile?.() : p.onRefreshCampaign}
          onDownloadCsv={downloadCsv}
        />
      )}

      {/* ========================================================================
          COLLAPSED ADVANCED DETAILS (Technical APIs, IDs, Source Attribution, Sarvam 1,000-Char Brief & Raw Table)
         ======================================================================== */}
      <details
        data-testid="campaign-advanced-details"
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '12px',
          padding: '0.75rem 1rem',
          fontSize: '0.8rem'
        }}
      >
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#475569' }}>
          Advanced Details
        </summary>
        <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {/* Technical Metadata & Sarvam Outbound v6 <=1,000-char Runtime Fact Brief Distinction */}
          <div
            style={{
              padding: '0.65rem 0.8rem',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              fontSize: '0.77rem',
              color: '#334155'
            }}
          >
            <div>
              <strong>Campaign ID:</strong> <code>{p.campaignId}</code> ·{' '}
              <strong>Status:</strong> <span data-testid="campaign-status-badge">{p.status.toUpperCase()}</span> ·{' '}
              <strong>Approval Verification Hash:</strong> <code>{p.materialHash.slice(0, 16)}</code>
            </div>
            <div style={{ marginTop: '0.25rem' }}>
              <strong>Phone Agent Preservation:</strong>{' '}
              {p.workspaceContext?.sarvamOutboundAgentLabel ?? 'Thaara AI — Sarvam outbound v6'} ·{' '}
              <strong>Supported Languages:</strong> {p.supportedLanguages.join(', ')} ·{' '}
              <strong>Phone Call Readiness:</strong> {p.metrics.phoneDraftsPrepared} prepared ·{' '}
              {p.metrics.phoneApproved} per-call approved · {p.metrics.phoneAwaitingApproval} awaiting approval ·{' '}
              {p.metrics.phoneQueued} queued
            </div>
            {p.boundedPurposePreview && (
              <div style={{ marginTop: '0.35rem' }}>
                <strong>Sarvam Outbound v6 Condensed Fact Brief ({p.boundedPurposePreview.length}/1000 chars):</strong>{' '}
                <span>{p.boundedPurposePreview}</span>
                <div style={{ color: '#64748b', marginTop: '0.18rem' }}>
                  Architecture Note: Offline simulation retrieves across all processed sections of your uploaded
                  knowledge document, whereas live <code>Thaara AI — Sarvam outbound v6</code> receives only this
                  condensed ≤1,000-character <code>agent_variables.call_purpose</code> brief (not the full DOCX mid-call).
                </div>
              </div>
            )}
          </div>

          {/* Knowledge Source Attribution & Add/Remove Knowledge */}
          <div
            data-testid="campaign-knowledge-summary"
            style={{
              padding: '0.65rem 0.8rem',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>Knowledge Source Attribution &amp; Files:</strong>
              {p.onUpdatePlan && (
                <div>
                  <input
                    ref={reviewKnowledgeInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.docx,.txt,.csv,.xlsx"
                    aria-label="Attach additional campaign knowledge files"
                    style={{ display: 'none' }}
                    onChange={e => void handleAddKnowledgeOnReview(e.target.files)}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="review-add-knowledge-button"
                    onClick={() => reviewKnowledgeInputRef.current?.click()}
                    style={{ fontSize: '0.74rem', padding: '0.18rem 0.55rem' }}
                  >
                    + Add Knowledge File
                  </button>
                </div>
              )}
            </div>
            {p.knowledgeContext && p.knowledgeContext.files.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.4rem' }}>
                {p.knowledgeContext.files.map(f => (
                  <span
                    key={f.fileId}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.2rem 0.55rem',
                      borderRadius: '999px',
                      background: '#eef2ff',
                      color: '#312e81',
                      fontSize: '0.74rem'
                    }}
                  >
                    <strong>{f.format.toUpperCase()}</strong>
                    <span>{f.fileName}</span>
                    <span>({f.statusMessage})</span>
                    {p.onUpdatePlan && (
                      <button
                        type="button"
                        aria-label={`Remove knowledge ${f.fileName}`}
                        onClick={() => p.onUpdatePlan?.({ removeKnowledgeFileIds: [f.fileId] })}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 700 }}
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {allQaItems.length > 0 && (
              <ul style={{ margin: '0.45rem 0 0', paddingLeft: '1.15rem', fontSize: '0.75rem', color: '#475569' }}>
                {allQaItems.map(qa => (
                  <li key={`src-${qa.question}`}>
                    <strong>{qa.question}</strong> → Source: {qa.sourceRefs.join(', ')}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Advanced Channel, Event, Limit, Schedule & Batch Controls */}
          <div
            style={{
              padding: '0.65rem 0.8rem',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '8px'
            }}
          >
            <div style={{ marginBottom: '0.45rem' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.2rem' }}>
                Event / Offer Details:
              </label>
              <input
                type="text"
                aria-label="Edit campaign event details"
                value={editableEventDetails}
                onChange={e => setEditableEventDetails(e.target.value)}
                style={{ width: '100%', fontSize: '0.78rem', padding: '0.28rem 0.45rem', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.45rem' }}>
              <span>
                <strong>Choose Channels:</strong>
              </span>
              {(['whatsapp', 'phone', 'email'] as BulkCampaignChannel[]).map(ch => {
                const checked = p.channels.includes(ch);
                return (
                  <label key={ch} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.28rem' }}>
                    <input
                      type="checkbox"
                      aria-label={`Channel ${ch}`}
                      checked={checked}
                      onChange={e => {
                        const next = e.target.checked
                          ? [...new Set([...p.channels, ch])]
                          : p.channels.filter(x => x !== ch);
                        if (next.length > 0) p.onUpdatePlan?.({ channels: next });
                      }}
                    />
                    {ch === 'whatsapp' ? 'WhatsApp' : ch === 'phone' ? 'AI Calling' : 'Email'}
                  </label>
                );
              })}

              <span>
                <strong>Max Calls:</strong>
              </span>
              <input
                type="number"
                aria-label="Max phone calls"
                min={1}
                max={20}
                value={editableMaxCalls}
                onChange={e => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(parsed)) setEditableMaxCalls(Math.min(20, Math.max(1, parsed)));
                }}
                style={{ width: '54px', fontSize: '0.76rem', padding: '0.18rem 0.35rem', borderRadius: '6px' }}
              />

              <select
                aria-label="Controlled batch size"
                data-testid="campaign-batch-size-select"
                value={batchSizeChoice}
                onChange={e => setBatchSizeChoice(Number.parseInt(e.target.value, 10) || 0)}
                style={{ fontSize: '0.76rem', padding: '0.22rem 0.4rem', borderRadius: '6px' }}
              >
                <option value={0}>Batch: All Eligible</option>
                <option value={2}>Batch of 2 Contacts</option>
                <option value={5}>Batch of 5 Contacts</option>
                <option value={10}>Batch of 10 Contacts</option>
              </select>
            </div>

            {p.channels.includes('whatsapp') && eligibleContacts.length > 0 && (
              <div style={{ fontSize: '0.76rem', marginBottom: '0.45rem' }}>
                <strong>Personalized WhatsApp Previews:</strong>{' '}
                {eligibleContacts
                  .slice(0, 2)
                  .map(r => `${r.contact.name}: “${r.personalizedWhatsappPreview}”`)
                  .join(' · ')}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {p.onPreparePhoneDrafts && p.channels.includes('phone') && (
                <button type="button" className="btn btn-secondary" onClick={() => p.onPreparePhoneDrafts?.()}>
                  Prepare Phone Call Drafts
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={
                  p.status === 'approved' ||
                  p.status === 'scheduled' ||
                  p.status === 'completed' ||
                  p.status === 'running'
                }
                onClick={() => p.onApprove?.(p.materialHash)}
              >
                {p.status === 'approved' || p.status === 'scheduled' ? 'Campaign Approved' : 'Approve Campaign Plan'}
              </button>
              {p.onSchedule && (p.status === 'approved' || p.status === 'scheduled') && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                  <input
                    type="datetime-local"
                    aria-label="Schedule campaign start time"
                    value={scheduleInput}
                    onChange={e => setScheduleInput(e.target.value)}
                    style={{ fontSize: '0.75rem', padding: '0.18rem 0.35rem' }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    data-testid="schedule-campaign-button"
                    disabled={!scheduleInput.trim()}
                    onClick={() => p.onSchedule?.(scheduleInput)}
                  >
                    Schedule Campaign
                  </button>
                </span>
              )}
              {p.onPause && (p.status === 'approved' || p.status === 'scheduled' || p.status === 'running') && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="pause-campaign-button"
                  onClick={() => p.onPause?.()}
                >
                  Pause Campaign
                </button>
              )}
              {p.onResume && p.status === 'paused' && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="resume-campaign-button"
                  onClick={() => p.onResume?.()}
                >
                  Resume Campaign
                </button>
              )}
              {p.onRetryFailed && p.metrics.failed > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid="retry-failed-campaign-button"
                  onClick={() => p.onRetryFailed?.()}
                >
                  Retry Failed ({p.metrics.failed})
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={p.status === 'stopped' || p.status === 'completed'}
                onClick={() => p.onStop?.()}
              >
                Stop Campaign
              </button>
              {p.onCancel && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={p.status === 'stopped' || p.status === 'completed'}
                  onClick={() => p.onCancel?.()}
                >
                  Reject &amp; Cancel Campaign
                </button>
              )}
              {p.channels.includes('phone') && (
                <a
                  href="/integrations/phone/history"
                  data-testid="open-phone-dashboard-link"
                  className="btn btn-secondary"
                  style={{ fontSize: '0.75rem', textDecoration: 'none' }}
                >
                  Open Call History in Phone Dashboard
                </a>
              )}
              <button type="button" className="btn btn-secondary" onClick={downloadCsv}>
                Download CSV Report
              </button>
            </div>
          </div>

          {/* 5 Contact Classification Buckets */}
          <div
            aria-label="Contact classification breakdown"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
              gap: '0.45rem',
              fontSize: '0.76rem'
            }}
          >
            <div style={{ padding: '0.45rem', background: '#f0fdf4', borderRadius: '8px' }}>
              <strong>Eligible Contacts ({eligibleContacts.length}):</strong>
              <div>{eligibleContacts.map(c => c.contact.name).join(', ') || 'None'}</div>
            </div>
            <div style={{ padding: '0.45rem', background: '#fffbeb', borderRadius: '8px' }}>
              <strong>Unauthorized Held Back ({unauthorizedContacts.length}):</strong>
              <div>
                {unauthorizedContacts.map(c => `${c.contact.name} (${c.categoryReason})`).join('; ') || 'None'}
              </div>
            </div>
            <div style={{ padding: '0.45rem', background: '#eff6ff', borderRadius: '8px' }}>
              <strong>Unsupported / Quota Queued ({unsupportedContacts.length}):</strong>
              <div>
                {unsupportedContacts.map(c => `${c.contact.name} [${c.contact.preferredLanguage}]`).join(', ') || 'None'}
              </div>
            </div>
            <div style={{ padding: '0.45rem', background: '#ffffff', borderRadius: '8px' }}>
              <strong>Duplicates Skipped ({p.importSummary.duplicates.length}):</strong>
              <div>
                {p.importSummary.duplicates.map(d => `Row ${d.rowNumber}: ${d.reason}`).join('; ') || 'None'}
              </div>
            </div>
            <div style={{ padding: '0.45rem', background: '#fef2f2', borderRadius: '8px' }}>
              <strong>Invalid Rejected ({p.importSummary.invalidEntries.length}):</strong>
              <div>
                {p.importSummary.invalidEntries.map(i => `Row ${i.rowNumber}: ${i.reason}`).join('; ') || 'None'}
              </div>
            </div>
          </div>

          {p.channels.includes('email') && (
            <div data-testid="campaign-email-metrics" style={{ fontSize: '0.76rem', color: '#475569' }}>
              <strong>Email Sent/Failed/Unsub:</strong> {p.metrics.emailSent ?? 0} / {p.metrics.emailFailed ?? 0} /{' '}
              {p.metrics.emailUnsubscribed ?? 0} · <strong>Contacted / Not contacted:</strong> {contactedCount} /{' '}
              {notContactedCount}
            </div>
          )}

          {/* Raw Per-Contact Audit & Consent Table */}
          <div style={{ overflowX: 'auto', background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <table
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}
              aria-label="Per-contact campaign results"
            >
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
                  <th style={{ padding: '0.4rem' }}>Include</th>
                  <th style={{ padding: '0.4rem' }}>Contact &amp; Eligibility</th>
                  <th style={{ padding: '0.4rem' }}>Language</th>
                  {p.channels.includes('whatsapp') && <th>WhatsApp</th>}
                  {p.channels.includes('email') && <th>Email</th>}
                  <th style={{ padding: '0.4rem' }}>AI Calling</th>
                  <th style={{ padding: '0.4rem' }}>Outcome &amp; Audit</th>
                </tr>
              </thead>
              <tbody>
                {p.contacts.map(r => (
                  <tr key={r.contact.contactId} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '0.4rem' }}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.contact.name}`}
                        checked={r.selectedByOwner}
                        onChange={e => {
                          const nextIds = e.target.checked
                            ? [
                                ...p.contacts.filter(c => c.selectedByOwner).map(c => c.contact.contactId),
                                r.contact.contactId
                              ]
                            : p.contacts
                                .filter(c => c.selectedByOwner && c.contact.contactId !== r.contact.contactId)
                                .map(c => c.contact.contactId);
                          p.onUpdatePlan?.({ selectedContactIds: nextIds });
                        }}
                      />
                    </td>
                    <td style={{ padding: '0.4rem' }}>
                      <div>
                        <strong>{r.contact.name}</strong> ({r.contact.maskedPhone ?? r.contact.email ?? 'N/A'})
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                        [{r.category.toUpperCase()}] {r.categoryReason}
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.18rem' }}>
                        {r.category === 'unauthorized' &&
                          !r.contact.optedOut &&
                          !r.contact.dnd &&
                          p.onUpdatePlan && (
                            <button
                              type="button"
                              className="btn btn-secondary"
                              data-testid={`confirm-consent-${r.contact.contactId}`}
                              style={{ fontSize: '0.67rem', padding: '0.1rem 0.36rem' }}
                              onClick={() =>
                                p.onUpdatePlan?.({
                                  ownerVerifiedConsent: {
                                    [r.contact.contactId]: {
                                      whatsapp: Boolean(r.contact.whatsappE164),
                                      phone: Boolean(r.contact.phoneE164 || r.contact.phoneDirectoryContactId),
                                      email: Boolean(r.contact.email)
                                    }
                                  }
                                })
                              }
                            >
                              Confirm Written Consent
                            </button>
                          )}
                        {!r.contact.optedOut && p.onUnsubscribeContact && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            data-testid={`unsubscribe-contact-${r.contact.contactId}`}
                            style={{ fontSize: '0.67rem', padding: '0.1rem 0.36rem' }}
                            onClick={() => p.onUnsubscribeContact?.(r.contact.contactId)}
                          >
                            Unsubscribe / Opt Out
                          </button>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '0.4rem' }}>
                      <select
                        aria-label={`Language for ${r.contact.name}`}
                        value={r.contact.preferredLanguage}
                        onChange={e =>
                          p.onUpdatePlan?.({
                            contactEdits: {
                              [r.contact.contactId]: {
                                preferredLanguage: e.target.value as BulkCampaignLanguage
                              }
                            }
                          })
                        }
                      >
                        <option value="en-IN">en-IN</option>
                        <option value="kn-IN">kn-IN</option>
                        <option value="kn-en">kn-en</option>
                        <option value="hi-IN">hi-IN (Queued)</option>
                      </select>
                    </td>
                    {p.channels.includes('whatsapp') && (
                      <td style={{ padding: '0.4rem' }}>
                        <div>
                          {r.whatsappStatus} ({r.whatsappEligibility})
                        </div>
                        {r.whatsappCustomerReply && (
                          <div style={{ fontSize: '0.7rem', color: '#0f766e' }}>Reply: “{r.whatsappCustomerReply}”</div>
                        )}
                      </td>
                    )}
                    {p.channels.includes('email') && (
                      <td style={{ padding: '0.4rem' }} data-testid={`email-status-${r.contact.contactId}`}>
                        {r.emailStatus ?? 'not_applicable'} ({r.emailEligibility})
                      </td>
                    )}
                    <td style={{ padding: '0.4rem' }}>
                      <div>
                        {r.phoneStatus} ({r.phoneEligibility})
                      </div>
                      {typeof r.phoneDurationSeconds === 'number' && (
                        <div style={{ fontSize: '0.69rem', color: '#475569' }}>Duration: {r.phoneDurationSeconds}s</div>
                      )}
                      {r.phoneCallId && (
                        <div style={{ fontSize: '0.68rem', color: '#64748b' }}>Call ID: {r.phoneCallId}</div>
                      )}
                      {r.phoneCallId &&
                        !r.phoneCallId.startsWith('sim_') &&
                        (r.phoneStatus === 'answered' || r.phoneStatus === 'not_answered' || r.phoneRecordState === 'completed') && (
                        <div style={{ marginTop: '0.2rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <PhoneCallRecordingPlayer
                            direction="outbound"
                            callId={r.phoneCallId}
                            recordingAvailable={true}
                          />
                          <details>
                            <summary style={{ cursor: 'pointer', fontSize: '0.72rem', color: '#4f46e5', fontWeight: 600 }}>
                              Transcript
                            </summary>
                            <PhoneCallTranscriptPanel
                              metadata={{
                                direction: 'outbound',
                                callId: r.phoneCallId,
                                recordingAvailable: true,
                                customerName: r.contact.name,
                                phoneNumber: r.contact.maskedPhone ?? null,
                                business: null,
                                interestedService: null,
                                requirements: null,
                                preferredCallbackTime: r.preferredCallbackTime ?? null,
                                callDate: r.interactionTimestamp ?? null,
                                durationSeconds: r.phoneDurationSeconds ?? null,
                                outcome: r.attendanceOutcome,
                                callbackStatus: null,
                                summary: r.phoneTranscriptSummary ?? null,
                                transcript: []
                              }}
                            />
                          </details>
                        </div>
                      )}
                      {r.phoneApprovalStatus === 'awaiting_approval' && r.phoneApprovalId && p.onApprovePhoneDraft && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ marginTop: '0.18rem', fontSize: '0.68rem', padding: '0.1rem 0.4rem' }}
                          onClick={() => p.onApprovePhoneDraft?.(r.phoneApprovalId!)}
                        >
                          Approve Call
                        </button>
                      )}
                    </td>
                    <td style={{ padding: '0.4rem' }}>
                      <strong>{r.attendanceOutcome}</strong>
                      {r.phoneTranscriptSummary && (
                        <span style={{ display: 'block', fontSize: '0.7rem', color: '#334155', marginTop: '0.15rem' }}>
                          {r.phoneTranscriptSummary}
                        </span>
                      )}
                      {r.aiInterpretation && (
                        <span style={{ display: 'block', fontSize: '0.69rem', color: '#64748b' }}>
                          [AI Interpretation · Confirmed by evidence: {String(r.aiInterpretation.confirmedByEvidence)}]
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Import / Rebuild & Chat Debug Tools */}
          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: '0.76rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span>Replace Contacts File:</span>
              <input
                type="file"
                aria-label="Upload contacts file (CSV, Excel, PDF)"
                accept=".csv,.xlsx,.xls,.tsv,.pdf,.txt"
                onChange={e => handleFileUpload(e.target.files?.[0])}
              />
            </label>
            <select
              aria-label="Import source type"
              value={sourceType}
              onChange={e => setSourceType(e.target.value as BulkCampaignSourceType)}
            >
              <option value="csv">CSV</option>
              <option value="excel">Excel (XLSX/TSV/CSV)</option>
              <option value="pdf">PDF Extracted Text</option>
              <option value="paste">Pasted List in Chat</option>
            </select>
            <input
              aria-label="Chat campaign instruction"
              placeholder="Thaara instruction..."
              value={chatInstructionInput}
              onChange={e => setChatInstructionInput(e.target.value)}
              style={{ flex: 1, minWidth: '180px' }}
            />
            <input
              aria-label="Paste contacts or CSV rows"
              placeholder="Paste names, phone numbers, and emails..."
              value={rawImportText}
              onChange={e => setRawImportText(e.target.value)}
              style={{ flex: 1, minWidth: '180px' }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                const hasUploadedPayload = Boolean(rawImportText || uploadedFileBase64);
                if (p.onChatCreate) {
                  p.onChatCreate(
                    chatInstructionInput,
                    hasUploadedPayload
                      ? {
                          sourceType,
                          fileName: uploadedFileName,
                          rawText: rawImportText,
                          ...(uploadedFileBase64 ? { fileBase64: uploadedFileBase64 } : {})
                        }
                      : undefined
                  );
                } else {
                  p.onImport?.(sourceType, rawImportText, uploadedFileName, uploadedFileBase64);
                }
              }}
            >
              Rebuild Campaign
            </button>
          </div>

          <nav
            aria-label="Campaign status filters"
            data-testid="campaign-status-filters"
            style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}
          >
            {(
              [
                ['all', 'All Campaigns'],
                ['draft', 'Drafts'],
                ['scheduled', 'Scheduled'],
                ['running', 'Active'],
                ['paused', 'Paused'],
                ['completed', 'Completed'],
                ['stopped', 'Stopped']
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={statusFilter === key ? 'btn btn-primary' : 'btn btn-secondary'}
                style={{ fontSize: '0.72rem', padding: '0.16rem 0.48rem' }}
                onClick={() => {
                  setStatusFilter(key);
                  const firstMatch = (p.campaignsHistory ?? []).find(h =>
                    key === 'all'
                      ? true
                      : key === 'draft'
                        ? h.status === 'draft' || h.status === 'draft_requires_reapproval' || h.status === 'approved'
                        : h.status === key
                  );
                  if (firstMatch && firstMatch.campaignId !== p.campaignId) {
                    p.onSelectCampaign?.(firstMatch.campaignId);
                  }
                }}
              >
                {label}
              </button>
            ))}
          </nav>

          {(p.chatFollowUpResponse || p.chatSummaryText) && (
            <pre
              aria-label="Thaara Chat campaign response"
              style={{
                margin: 0,
                padding: '0.55rem',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                whiteSpace: 'pre-wrap',
                fontSize: '0.75rem'
              }}
            >
              {p.chatFollowUpResponse ?? p.chatSummaryText}
            </pre>
          )}
        </div>
      </details>
    </section>
  );
}

interface ApiCampaignEnvelope {
  campaign: {
    campaignId: string;
    title: string;
    objective: string;
    eventDetails: string;
    createdAt?: string;
    updatedAt?: string;
    webinarDetails?: BulkCampaignWebinarDetails;
    knowledgeContext?: BulkCampaignKnowledgeContext;
    pilotCall?: BulkCampaignPilotCallState;
    instruction: string;
    status: BulkCampaignViewProps['status'];
    scheduledFor?: string;
    executionMode?: 'planned' | 'simulation' | 'live';
    liveCallingEnabled?: boolean;
    liveSendingEnabled?: boolean;
    channels: BulkCampaignChannel[];
    whatsappPlan: {
      businessAccountLabel: string;
      templateName: string;
      language?: string;
      messagePreview: string;
    };
    callScript: {
      aiDisclosure: string;
      openingLine: string;
      eventPitch: string;
      questions: string[];
      boundedPurposePreview: string;
      supportedLanguages: PhoneCallingLanguage[];
    };
    emailPlan?: BulkCampaignEmailPlanView;
    limits: {
      maxCalls: number;
      dailyPhoneCallLimit: number;
      maxConcurrency: number;
      rateLimitPerMinute: number;
      scheduleAt?: string;
    };
    materialHash: string;
    approval?: {
      approvedMaterialHash?: string;
      estimatedCostInr?: number;
    };
    estimatedCostInr?: number;
    importSummary: Omit<BulkCampaignImportResult, 'validContacts'>;
    contacts: BulkCampaignContactRecord[];
    pilotWhatsApp?: BulkCampaignPilotWhatsAppState;
    n8nJobs?: BulkCampaignN8nExecutionJob[];
    mode?: BulkCampaignMode;
    sheetMonitor?: BulkCampaignSheetMonitorConfig;
    standingAuthorization?: BulkCampaignStandingAuthorization;
  };
  metrics: BulkCampaignDashboardMetrics;
  eligiblePilotContacts?: BulkCampaignEligiblePilotContact[];
  eligibleWhatsAppPilotContacts?: BulkCampaignEligiblePilotContact[];
  chatSummary: string;
  liveCallingEnabled?: boolean;
  liveSendingEnabled?: boolean;
}

const STARTER_INSTRUCTION =
  'Thaara, tomorrow we have an AI webinar at 7 PM. Send WhatsApp invitations, call the eligible contacts, answer their questions, ask if they will attend, and give me the final report.';

const STARTER_CSV_HEADER = 'Name,Phone,Email,Category,WhatsAppStatus,CallStatus,AttendanceOutcome\n';

function mapEnvelopeToViewProps(
  env: ApiCampaignEnvelope,
  csvReportText: string,
  chatFollowUpResponse: string | undefined,
  workspaceContext?: BulkCampaignWorkspaceContext
): BulkCampaignViewProps {
  const c = env.campaign;
  return {
    campaignId: c.campaignId,
    title: c.title,
    objective: c.objective,
    eventDetails: c.eventDetails,
    ...(c.webinarDetails ? { webinarDetails: c.webinarDetails } : {}),
    ...(c.knowledgeContext ? { knowledgeContext: c.knowledgeContext } : {}),
    instruction: c.instruction,
    status: c.status,
    ...(c.scheduledFor ? { scheduledFor: c.scheduledFor } : {}),
    executionMode: c.executionMode ?? 'planned',
    liveCallingEnabled: Boolean(env.liveCallingEnabled ?? c.liveCallingEnabled),
    liveSendingEnabled: Boolean(env.liveSendingEnabled ?? c.liveSendingEnabled),
    ...(workspaceContext ? { workspaceContext } : {}),
    ...(env.eligiblePilotContacts ? { eligiblePilotContacts: env.eligiblePilotContacts } : {}),
    ...(env.eligibleWhatsAppPilotContacts ? { eligibleWhatsAppPilotContacts: env.eligibleWhatsAppPilotContacts } : {}),
    ...(c.pilotCall ? { pilotCall: c.pilotCall } : {}),
    ...(c.pilotWhatsApp ? { pilotWhatsApp: c.pilotWhatsApp } : {}),
    ...(c.n8nJobs ? { n8nJobs: c.n8nJobs } : {}),
    ...(c.mode ? { mode: c.mode } : {}),
    ...(c.sheetMonitor ? { sheetMonitor: c.sheetMonitor } : {}),
    ...(c.standingAuthorization ? { standingAuthorization: c.standingAuthorization } : {}),
    channels: c.channels,
    businessAccountLabel: c.whatsappPlan.businessAccountLabel,
    whatsappTemplateName: c.whatsappPlan.templateName,
    whatsappMessagePreview: c.whatsappPlan.messagePreview,
    aiDisclosure: c.callScript.aiDisclosure,
    callOpeningLine: c.callScript.openingLine,
    callEventPitch: c.callScript.eventPitch,
    callQuestions: c.callScript.questions,
    boundedPurposePreview: c.callScript.boundedPurposePreview,
    supportedLanguages: c.callScript.supportedLanguages,
    ...(c.emailPlan ? { emailPlan: c.emailPlan } : {}),
    maxCalls: c.limits.maxCalls,
    dailyPhoneCallLimit: c.limits.dailyPhoneCallLimit,
    maxConcurrency: c.limits.maxConcurrency,
    rateLimitPerMinute: c.limits.rateLimitPerMinute,
    ...(c.limits.scheduleAt ? { scheduleAt: c.limits.scheduleAt } : {}),
    materialHash: c.materialHash,
    ...(c.approval?.approvedMaterialHash ? { approvedMaterialHash: c.approval.approvedMaterialHash } : {}),
    estimatedCostInr: c.approval?.estimatedCostInr ?? c.estimatedCostInr ?? 0,
    importSummary: c.importSummary,
    contacts: c.contacts,
    metrics: env.metrics,
    csvReportText,
    chatSummaryText: env.chatSummary,
    ...(chatFollowUpResponse ? { chatFollowUpResponse } : {})
  };
}

export function BulkCampaignPanel(props: {
  initialViewMode?: 'create' | 'history';
  onNavigatePage?: (page: WorkspacePageId) => void;
} = {}) {
  const initialUrlCampaignId = extractBulkCampaignIdFromLocation();
  const [viewMode, setViewMode] = useState<'create' | 'dashboard' | 'history' | 'details'>(
    props.initialViewMode === 'history' ? (initialUrlCampaignId ? 'details' : 'history') : 'create'
  );
  const [envelope, setEnvelope] = useState<ApiCampaignEnvelope | null>(null);
  const creatingNew = viewMode === 'create';
  const setCreatingNew = (val: boolean) => setViewMode(val ? 'create' : 'dashboard');
  const [campaignsList, setCampaignsList] = useState<ApiCampaignEnvelope[]>([]);
  const [workspaceContext, setWorkspaceContext] = useState<BulkCampaignWorkspaceContext | undefined>(undefined);
  const [csvText, setCsvText] = useState<string>(STARTER_CSV_HEADER);
  const [chatFollowUp, setChatFollowUp] = useState<string | undefined>(undefined);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [approveAndStartError, setApproveAndStartError] = useState<string | null>(null);
  const [autoFollowupError, setAutoFollowupError] = useState<string | null>(null);
  const [autoBaselineCsvText, setAutoBaselineCsvText] = useState<string | undefined>(undefined);
  const [autoPolicyDraft, setAutoPolicyDraft] = useState<{
    callingHoursIst?: { startHour: number; endHour: number };
    maxAttemptsPerLead?: number;
    retryOnNoAnswer?: boolean;
    retryDelayMinutes?: number;
    maxLeadsPerDay?: number;
  } | null>(null);
  const [existingBacklogPreview, setExistingBacklogPreview] = useState<{
    totalExistingRows: number;
    previouslyProcessedCount: number;
    eligibleCount: number;
    consentBlockedCount: number;
    duplicatesCount: number;
    estimatedCallsWithinLimits: number;
    maxLeadsPerDay: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  async function openCampaignById(selectedId: string, targetMode: 'dashboard' | 'details' = 'details', pushHistory = true) {
    setErrorMsg(null);
    setBusy(true);
    try {
      const selected = await request<ApiCampaignEnvelope>(
        `/api/v1/campaigns/bulk/${encodeURIComponent(selectedId)}`
      );
      setEnvelope(selected);
      setViewMode(targetMode);
      setChatFollowUp(undefined);
      if (pushHistory && targetMode === 'details' && typeof window !== 'undefined') {
        try {
          window.history.pushState(
            { thaaraPage: 'bulk-campaign-history', campaignId: selectedId },
            '',
            `/integrations/bulk-campaign/history/${encodeURIComponent(selectedId)}`
          );
        } catch {
          // ignore
        }
      }
      await refreshCsv(selected.campaign.campaignId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshHistoryAndCsv(activeCampaignId?: string) {
    try {
      const listRes = await request<{
        campaigns?: ApiCampaignEnvelope[];
        latest: ApiCampaignEnvelope | null;
        context?: BulkCampaignWorkspaceContext;
      }>('/api/v1/campaigns/bulk');
      if (Array.isArray(listRes.campaigns)) {
        setCampaignsList(listRes.campaigns);
      }
      if (listRes.context) {
        setWorkspaceContext(listRes.context);
      }
      const targetId = activeCampaignId ?? listRes.latest?.campaign.campaignId;
      if (targetId) {
        await refreshCsv(targetId);
      }
    } catch {
      // ignore in offline/SSR environments
    }
  }

  async function refreshCsv(campaignId: string) {
    try {
      const res = await fetch(`/api/v1/campaigns/bulk/${encodeURIComponent(campaignId)}/export.csv`, {
        credentials: 'include'
      });
      if (res.ok) {
        setCsvText(await res.text());
      }
    } catch {
      // ignore in offline/SSR environments
    }
  }

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const listRes = await request<{
          campaigns?: ApiCampaignEnvelope[];
          latest: ApiCampaignEnvelope | null;
          context?: BulkCampaignWorkspaceContext;
        }>('/api/v1/campaigns/bulk');
        if (!active) return;
        if (Array.isArray(listRes.campaigns)) {
          setCampaignsList(listRes.campaigns);
        }
        if (listRes.context) {
          setWorkspaceContext(listRes.context);
        }
        if (initialUrlCampaignId && props.initialViewMode === 'history') {
          const detail = await request<ApiCampaignEnvelope>(
            `/api/v1/campaigns/bulk/${encodeURIComponent(initialUrlCampaignId)}`
          );
          if (!active) return;
          setEnvelope(detail);
          setViewMode('details');
        } else if (listRes.latest && props.initialViewMode !== 'history') {
          setEnvelope(listRes.latest);
        }
      } catch {
        // Keep clean Create view when unauthenticated or in static tests
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Live progressive polling while a campaign, batch job, or call reconciliation is in flight
  useEffect(() => {
    const activeId = envelope?.campaign.campaignId;
    const hasActiveBatch = (envelope?.campaign.n8nJobs ?? []).some(
      j => j.mode === 'multi_contact_batch' && (j.status === 'queued' || j.status === 'running')
    );
    const hasInFlightCalls = (envelope?.campaign.contacts ?? []).some(
      c => c.phoneStatus === 'attempted' || c.whatsappStatus === 'queued' || c.whatsappStatus === 'sent'
    );
    const hasPendingPostCallSync = (envelope?.campaign.contacts ?? []).some(
      c =>
        Boolean(c.phoneCallId) &&
        !c.phoneCallId!.startsWith('sim_') &&
        (c.phoneStatus === 'answered' || c.phoneRecordState === 'completed') &&
        typeof c.phoneDurationSeconds !== 'number'
    );
    const isRunning = envelope?.campaign.status === 'running' || hasActiveBatch || hasInFlightCalls || hasPendingPostCallSync;
    if (!activeId || !isRunning || (viewMode !== 'dashboard' && viewMode !== 'details')) {
      return;
    }
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > 120) {
        clearInterval(timer);
        return;
      }
      void (async () => {
        try {
          const refreshed = hasInFlightCalls || hasPendingPostCallSync
            ? await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(activeId)}/reconcile`,
                { method: 'POST', body: JSON.stringify({ refreshProviderResults: true }) }
              )
            : await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(activeId)}`
              );
          setEnvelope(refreshed);
        } catch {
          // ignore transient poll errors
        }
      })();
    }, 5000);
    return () => clearInterval(timer);
  }, [envelope?.campaign.campaignId, envelope?.campaign.status, envelope?.campaign.n8nJobs, envelope?.campaign.contacts, viewMode]);

  const historyItems = campaignsList.map(env => ({
    campaignId: env.campaign.campaignId,
    title: env.campaign.title,
    status: env.campaign.status,
    executionMode: env.campaign.executionMode ?? 'planned'
  }));

  const fullHistoryItems: BulkCampaignHistorySummaryItem[] = campaignsList.map(env => ({
    campaignId: env.campaign.campaignId,
    title: env.campaign.title,
    objective: env.campaign.objective,
    instruction: env.campaign.instruction,
    status: env.campaign.status,
    executionMode: env.campaign.executionMode ?? 'planned',
    channels: env.campaign.channels,
    createdAt: env.campaign.createdAt ?? env.campaign.updatedAt ?? new Date().toISOString(),
    updatedAt: env.campaign.updatedAt ?? env.campaign.createdAt ?? new Date().toISOString(),
    totalSelectedContacts: env.campaign.contacts.filter(c => c.selectedByOwner).length || env.metrics.totalContacts,
    metrics: env.metrics
  }));

  async function createSampleSimulationCampaign(opts?: {
    instruction?: string;
    channels?: BulkCampaignChannel[];
    knowledgeFiles?: BulkCampaignKnowledgeUploadInput[];
  }) {
    setErrorMsg(null);
    setBusy(true);
    try {
      const created = await request<ApiCampaignEnvelope>('/api/v1/campaigns/bulk/plan', {
        method: 'POST',
        body: JSON.stringify({
          instruction: opts?.instruction || STARTER_INSTRUCTION,
          ...(opts?.channels && opts.channels.length > 0 ? { channels: opts.channels } : {}),
          ...(opts?.knowledgeFiles && opts.knowledgeFiles.length > 0 ? { knowledgeFiles: opts.knowledgeFiles } : {}),
          useSyntheticDemo: true
        })
      });
      setEnvelope(created);
      setCreatingNew(false);
      setChatFollowUp(undefined);
      await refreshHistoryAndCsv(created.campaign.campaignId);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="bulk-campaign-page" aria-label="Bulk Campaigns">
      {errorMsg && (
        <div
          role="alert"
          className="wa-error"
          style={{
            maxWidth: '720px',
            margin: '0.85rem auto 0',
            padding: '0.65rem 0.9rem',
            borderRadius: '10px',
            background: '#fef2f2',
            border: '1px solid #fecaca'
          }}
        >
          {errorMsg}
        </div>
      )}
      {busy && (
        <div
          style={{
            maxWidth: '720px',
            margin: '0.5rem auto 0',
            fontSize: '0.82rem',
            color: 'var(--text-secondary, #475569)'
          }}
        >
          Thaara is preparing your governed campaign...
        </div>
      )}

      {viewMode === 'history' ? (
        <BulkCampaignHistoryView
          campaigns={fullHistoryItems}
          loading={busy}
          onOpenDetails={campaignId => void openCampaignById(campaignId, 'details', true)}
          onCreateNew={() => {
            if (props.onNavigatePage) {
              props.onNavigatePage('bulk-campaign-create');
            } else {
              setEnvelope(null);
              setViewMode('create');
            }
          }}
        />
      ) : viewMode === 'details' && envelope ? (
        <BulkCampaignDetailsView
          campaignId={envelope.campaign.campaignId}
          title={envelope.campaign.title}
          objective={envelope.campaign.objective}
          instruction={envelope.campaign.instruction}
          status={envelope.campaign.status}
          executionMode={envelope.campaign.executionMode ?? 'planned'}
          channels={envelope.campaign.channels}
          createdAt={envelope.campaign.createdAt}
          updatedAt={envelope.campaign.updatedAt}
          contacts={envelope.campaign.contacts}
          metrics={envelope.metrics}
          hasBatchOrRealResults={Boolean(
            (envelope.campaign.n8nJobs &&
              envelope.campaign.n8nJobs.some(j => j.mode === 'multi_contact_batch')) ||
              envelope.campaign.contacts.some(r =>
                Boolean(
                  (r.phoneCallId && !r.phoneCallId.startsWith('sim_')) ||
                    r.whatsappProviderMessageId ||
                    r.emailMessageId
                )
              )
          )}
          onBackToHistory={() => {
            setViewMode('history');
            if (typeof window !== 'undefined') {
              try {
                window.history.pushState(
                  { thaaraPage: 'bulk-campaign-history' },
                  '',
                  '/integrations/bulk-campaign/history'
                );
              } catch {
                // ignore
              }
            }
          }}
          onRefresh={() => void openCampaignById(envelope.campaign.campaignId, 'details', false)}
          onDownloadCsv={() => {
            const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${envelope.campaign.campaignId}-report.csv`;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          }}
        />
      ) : creatingNew || !envelope ? (
        <BulkCampaignCreateView
          busy={busy}
          campaignsHistory={historyItems}
          workspaceContext={workspaceContext}
          onBackToHistory={
            props.onNavigatePage
              ? () => props.onNavigatePage?.('bulk-campaign-history')
              : () => setViewMode('history')
          }
          resumeCampaign={
            envelope
              ? {
                  campaignId: envelope.campaign.campaignId,
                  title: envelope.campaign.title,
                  instruction: envelope.campaign.instruction,
                  channels: envelope.campaign.channels,
                  contactsCount: envelope.campaign.contacts.length,
                  knowledgeFilesCount: envelope.campaign.knowledgeContext?.files.length ?? 0,
                  onResumeReview: () => setViewMode('dashboard')
                }
              : undefined
          }
          onSelectCampaign={async selectedId => {
            await openCampaignById(selectedId, 'dashboard', false);
          }}
          onLoadSavedContacts={async () => {
            const res = await request<{ contacts: SavedDirectoryContactOption[] }>('/api/v1/campaigns/bulk/saved-contacts');
            return res.contacts;
          }}
          onImportSavedContacts={async payload => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const created = await request<ApiCampaignEnvelope>('/api/v1/campaigns/bulk/import-saved-contacts', {
                method: 'POST',
                body: JSON.stringify({
                  instruction: payload.instruction,
                  channels: payload.channels,
                  ...(payload.selectedContactIds && payload.selectedContactIds.length > 0
                    ? { selectedContactIds: payload.selectedContactIds }
                    : {}),
                  ...(payload.knowledgeFiles.length > 0 ? { knowledgeFiles: payload.knowledgeFiles } : {})
                })
              });
              setEnvelope(created);
              setCreatingNew(false);
              setChatFollowUp(undefined);
              await refreshHistoryAndCsv(created.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onLoadSampleSimulation={payload => void createSampleSimulationCampaign(payload)}
          onPrepareCampaign={async payload => {
            setErrorMsg(null);
            setAutoFollowupError(null);
            setBusy(true);
            try {
              let created = await request<ApiCampaignEnvelope>('/api/v1/campaigns/bulk/plan', {
                method: 'POST',
                body: JSON.stringify({
                  instruction: payload.instruction,
                  channels: payload.channels,
                  ...(payload.knowledgeFiles.length > 0 ? { knowledgeFiles: payload.knowledgeFiles } : {}),
                  sourceType: payload.contactSourceType,
                  ...(payload.contactFileName ? { fileName: payload.contactFileName } : {}),
                  ...(payload.contactRawText ? { rawText: payload.contactRawText } : {}),
                  ...(payload.contactFileBase64 ? { fileBase64: payload.contactFileBase64 } : {}),
                  ...(payload.sourceConsentAttestation ? { sourceConsentAttestation: payload.sourceConsentAttestation } : {}),
                  useSyntheticDemo: Boolean(payload.useSyntheticDemo)
                })
              });
              if (payload.campaignMode === 'automatic_lead_followup' && payload.autoFollowupConfig) {
                setAutoBaselineCsvText(payload.contactRawText);
                setAutoPolicyDraft({
                  callingHoursIst: payload.autoFollowupConfig.callingHoursIst,
                  maxAttemptsPerLead: payload.autoFollowupConfig.maxAttemptsPerLead,
                  retryOnNoAnswer: payload.autoFollowupConfig.retryOnNoAnswer,
                  retryDelayMinutes: payload.autoFollowupConfig.retryDelayMinutes,
                  maxLeadsPerDay: payload.autoFollowupConfig.maxLeadsPerDay
                });
                created = await request<ApiCampaignEnvelope>(
                  `/api/v1/campaigns/bulk/${encodeURIComponent(created.campaign.campaignId)}/auto-followup/configure`,
                  {
                    method: 'POST',
                    body: JSON.stringify(payload.autoFollowupConfig)
                  }
                );
              } else {
                setAutoBaselineCsvText(undefined);
                setAutoPolicyDraft(null);
              }
              setEnvelope(created);
              setCreatingNew(false);
              setChatFollowUp(undefined);
              await refreshHistoryAndCsv(created.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : (
        <BulkCampaignDashboardView
          {...mapEnvelopeToViewProps(envelope, csvText, chatFollowUp, workspaceContext)}
          campaignsHistory={historyItems}
          approveAndStartError={approveAndStartError}
          autoFollowupError={autoFollowupError}
          onActivateAutoFollowup={async expectedMaterialHash => {
            if (busy) return;
            setAutoFollowupError(null);
            setBusy(true);
            try {
              const auth = envelope.campaign.standingAuthorization ?? autoPolicyDraft;
              const updated = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/auto-followup/activate`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    expectedMaterialHash,
                    ...(autoBaselineCsvText ? { baselineCsvText: autoBaselineCsvText } : {}),
                    ...(auth ? {
                      callingHoursIst: auth.callingHoursIst,
                      maxAttemptsPerLead: auth.maxAttemptsPerLead,
                      retryOnNoAnswer: auth.retryOnNoAnswer,
                      retryDelayMinutes: auth.retryDelayMinutes,
                      maxLeadsPerDay: auth.maxLeadsPerDay
                    } : {})
                  })
                }
              );
              setEnvelope(updated);
              await refreshHistoryAndCsv(updated.campaign.campaignId);
            } catch (err) {
              setAutoFollowupError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onPauseAutoFollowup={async () => {
            if (busy) return;
            setBusy(true);
            try {
              const updated = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/auto-followup/pause`,
                { method: 'POST', body: '{}' }
              );
              setEnvelope(updated);
              await refreshHistoryAndCsv(updated.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onResumeAutoFollowup={async () => {
            if (busy) return;
            setBusy(true);
            try {
              const updated = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/auto-followup/resume`,
                { method: 'POST', body: '{}' }
              );
              setEnvelope(updated);
              await refreshHistoryAndCsv(updated.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onStopAutoFollowup={async () => {
            if (busy) return;
            setBusy(true);
            try {
              const updated = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/auto-followup/stop`,
                { method: 'POST', body: '{}' }
              );
              setEnvelope(updated);
              await refreshHistoryAndCsv(updated.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onSyncAutoFollowupNow={async () => {
            if (busy) return;
            setBusy(true);
            try {
              const updated = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/auto-followup/sync`,
                { method: 'POST', body: '{}' }
              );
              setEnvelope(updated);
              await refreshHistoryAndCsv(updated.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          existingBacklogPreview={existingBacklogPreview}
          onPreviewExistingBacklog={async () => {
            setErrorMsg(null);
            try {
              const res = await request<{
                preview: {
                  totalExistingRows: number;
                  previouslyProcessedCount: number;
                  eligibleCount: number;
                  consentBlockedCount: number;
                  duplicatesCount: number;
                  estimatedCallsWithinLimits: number;
                  maxLeadsPerDay: number;
                };
              }>(`/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/auto-followup/existing-leads/preview`, {
                method: 'POST',
                body: '{}'
              });
              setExistingBacklogPreview(res.preview);
            } catch (err) {
              setErrorMsg((err as Error).message);
            }
          }}
          onProcessExistingBacklog={async expectedMaterialHash => {
            if (busy) return;
            setErrorMsg(null);
            setBusy(true);
            try {
              const updated = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/auto-followup/existing-leads/process`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    explicitOwnerApproval: true,
                    expectedMaterialHash
                  })
                }
              );
              setEnvelope(updated);
              setExistingBacklogPreview(null);
              await refreshHistoryAndCsv(updated.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onVerifyUnsavedLeadConsent={async input => {
            if (busy) return;
            setErrorMsg(null);
            setBusy(true);
            try {
              const updated = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/auto-followup/contacts/${encodeURIComponent(input.contactId)}/verify-consent`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    consentGranted: true,
                    consentSource: input.consentSource,
                    evidenceReference: input.evidenceReference,
                    ...(input.recordedAt ? { recordedAt: input.recordedAt } : {}),
                    channel: 'phone',
                    explicitOwnerApproval: input.explicitOwnerApproval
                  })
                }
              );
              setEnvelope(updated);
              await refreshHistoryAndCsv(updated.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onEnableSheetConsent={async input => {
            if (busy) return;
            setErrorMsg(null);
            setBusy(true);
            try {
              const updated = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/auto-followup/sheet-consent`,
                {
                  method: 'POST',
                  body: JSON.stringify(input)
                }
              );
              setEnvelope(updated);
              await refreshHistoryAndCsv(updated.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onApproveAndStart={async (expectedMaterialHash, mode) => {
            if (busy) return;
            setErrorMsg(null);
            setApproveAndStartError(null);
            setBusy(true);
            try {
              const res = await request<{
                ok: boolean;
                approved: boolean;
                executionStarted: boolean;
                error?: string;
                campaign: ApiCampaignEnvelope;
              }>(`/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/approve-and-start`, {
                method: 'POST',
                body: JSON.stringify({ expectedMaterialHash, mode })
              });
              if (res.campaign) {
                setEnvelope(res.campaign);
              }
              if (!res.ok && res.error) {
                setApproveAndStartError(res.error);
              } else {
                await refreshHistoryAndCsv(envelope.campaign.campaignId);
              }
            } catch (err) {
              setApproveAndStartError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onBackToCreate={() => setViewMode('create')}
          onBackToHistory={
            props.onNavigatePage
              ? () => props.onNavigatePage?.('bulk-campaign-history')
              : () => setViewMode('history')
          }
          onSelectCampaign={async selectedId => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const selected = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(selectedId)}`
              );
              setEnvelope(selected);
              setCreatingNew(false);
              setChatFollowUp(undefined);
              await refreshCsv(selected.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onLoadSampleSimulation={() => void createSampleSimulationCampaign()}
          onImportSavedContacts={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const created = await request<ApiCampaignEnvelope>('/api/v1/campaigns/bulk/import-saved-contacts', {
                method: 'POST',
                body: JSON.stringify({ instruction: envelope.campaign.instruction })
              });
              setEnvelope(created);
              setChatFollowUp(undefined);
              await refreshHistoryAndCsv(created.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onNewCampaign={() => {
            setErrorMsg(null);
            setCreatingNew(true);
            setChatFollowUp(undefined);
          }}
          onImport={async (sourceType, rawText, fileName, fileBase64) => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const hasPayload = Boolean(rawText || fileBase64);
              const res = await request<ApiCampaignEnvelope>('/api/v1/campaigns/bulk/plan', {
                method: 'POST',
                body: JSON.stringify({
                  instruction: envelope.campaign.instruction,
                  sourceType,
                  fileName,
                  rawText: rawText || undefined,
                  ...(fileBase64 ? { fileBase64 } : {}),
                  useSyntheticDemo: !hasPayload
                })
              });
              setEnvelope(res);
              setChatFollowUp(undefined);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onChatCreate={async (chatMessage, uploadedFile) => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>('/api/v1/campaigns/bulk/chat-create', {
                method: 'POST',
                body: JSON.stringify({
                  chatMessage,
                  ...(uploadedFile ? { uploadedFile } : {})
                })
              });
              setEnvelope(res);
              setChatFollowUp(undefined);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onUpdatePlan={async patch => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}`,
                {
                  method: 'PATCH',
                  body: JSON.stringify(patch)
                }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onAskQuestion={async question => {
            try {
              const res = await request<{ campaignId: string; qa: BulkCampaignGroundedQaItem }>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/ask-question`,
                {
                  method: 'POST',
                  body: JSON.stringify({ question })
                }
              );
              return res.qa;
            } catch (err) {
              setErrorMsg((err as Error).message);
              return null;
            }
          }}
          onPreparePhoneDrafts={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/phone-drafts/prepare`,
                { method: 'POST', body: JSON.stringify({}) }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onApproveAllPhoneDrafts={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/phone-drafts/approve-all`,
                { method: 'POST', body: JSON.stringify({}) }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onApprovePhoneDraft={async approvalId => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/phone-drafts/${encodeURIComponent(approvalId)}/approve`,
                { method: 'POST', body: JSON.stringify({}) }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onApprove={async expectedMaterialHash => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/approve`,
                {
                  method: 'POST',
                  body: JSON.stringify({ expectedMaterialHash })
                }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onApproveForSimulation={async initialMaterialHash => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const campId = envelope.campaign.campaignId;
              let currentEnv = envelope;
              if (
                currentEnv.campaign.channels.includes('phone') &&
                currentEnv.metrics.eligiblePhoneContacts > 0 &&
                currentEnv.metrics.phoneDraftsPrepared < currentEnv.metrics.eligiblePhoneContacts
              ) {
                currentEnv = await request<ApiCampaignEnvelope>(
                  `/api/v1/campaigns/bulk/${encodeURIComponent(campId)}/phone-drafts/prepare`,
                  { method: 'POST', body: JSON.stringify({}) }
                );
              }
              if (currentEnv.metrics.phoneAwaitingApproval > 0) {
                currentEnv = await request<ApiCampaignEnvelope>(
                  `/api/v1/campaigns/bulk/${encodeURIComponent(campId)}/phone-drafts/approve-all`,
                  { method: 'POST', body: JSON.stringify({}) }
                );
              }
              const approvedEnv = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(campId)}/approve`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    expectedMaterialHash: currentEnv.campaign.materialHash || initialMaterialHash
                  })
                }
              );
              setEnvelope(approvedEnv);
              await refreshHistoryAndCsv(approvedEnv.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onPrepareSyntheticSimulation={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const simEnv = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/prepare-synthetic-simulation`,
                { method: 'POST', body: JSON.stringify({}) }
              );
              setEnvelope(simEnv);
              setChatFollowUp(undefined);
              await refreshHistoryAndCsv(simEnv.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onSchedule={async scheduleAt => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/schedule`,
                { method: 'POST', body: JSON.stringify({ scheduleAt }) }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onExecute={async (mode = 'simulation', batchSize) => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/execute`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    mode,
                    ...(batchSize && batchSize > 0 ? { batchSize } : {})
                  })
                }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onPreparePilotCall={async (contactId, language) => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/pilot/prepare`,
                {
                  method: 'POST',
                  body: JSON.stringify({ contactId, ...(language ? { language } : {}) })
                }
              );
              setEnvelope(res);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onExecutePilotCall={async approvalId => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/pilot/execute`,
                {
                  method: 'POST',
                  body: JSON.stringify({ approvalId })
                }
              );
              setEnvelope(res);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onRefreshPilotResult={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/pilot/refresh`,
                { method: 'POST', body: JSON.stringify({}) }
              );
              setEnvelope(res);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onSubmitN8nJob={async (channel, contactId, language) => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<{ ok: boolean; campaign: ApiCampaignEnvelope }>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/n8n/jobs`,
                {
                  method: 'POST',
                  body: JSON.stringify({ channel, contactId, ...(language ? { language } : {}) })
                }
              );
              setEnvelope(res.campaign);
              await refreshHistoryAndCsv(res.campaign.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onSubmitN8nBatchJob={async (channel, batchConfig) => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<{ ok: boolean; campaign: ApiCampaignEnvelope }>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/n8n/batch-jobs`,
                {
                  method: 'POST',
                  body: JSON.stringify({ channel, batchConfig })
                }
              );
              setEnvelope(res.campaign);
              await refreshHistoryAndCsv(res.campaign.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onPauseN8nJob={async jobId => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<{ ok: boolean; campaign: ApiCampaignEnvelope }>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/n8n/jobs/${encodeURIComponent(jobId)}/pause`,
                { method: 'POST', body: JSON.stringify({ reason: 'Paused by owner from dashboard.' }) }
              );
              setEnvelope(res.campaign);
              await refreshHistoryAndCsv(res.campaign.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onResumeN8nJob={async jobId => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<{ ok: boolean; campaign: ApiCampaignEnvelope }>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/n8n/jobs/${encodeURIComponent(jobId)}/resume`,
                { method: 'POST', body: JSON.stringify({}) }
              );
              setEnvelope(res.campaign);
              await refreshHistoryAndCsv(res.campaign.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onCancelN8nJob={async jobId => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<{ ok: boolean; campaign: ApiCampaignEnvelope }>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/n8n/jobs/${encodeURIComponent(jobId)}/cancel`,
                { method: 'POST', body: JSON.stringify({ reason: 'Cancelled by owner from dashboard.' }) }
              );
              setEnvelope(res.campaign);
              await refreshHistoryAndCsv(res.campaign.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onEmergencyStopN8nJobs={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<{ ok: boolean; campaign: ApiCampaignEnvelope }>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/n8n/emergency-stop`,
                { method: 'POST', body: JSON.stringify({ reason: 'Emergency stop triggered by owner.' }) }
              );
              setEnvelope(res.campaign);
              await refreshHistoryAndCsv(res.campaign.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onRefreshCampaign={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const latest = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}`
              );
              setEnvelope(latest);
              await refreshHistoryAndCsv(latest.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onUnsubscribeContact={async contactId => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/contacts/${encodeURIComponent(contactId)}/unsubscribe`,
                { method: 'POST', body: JSON.stringify({}) }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onRetryFailed={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/retry-failed`,
                { method: 'POST', body: JSON.stringify({}) }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onPause={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/pause`,
                { method: 'POST', body: JSON.stringify({}) }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onResume={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/resume`,
                { method: 'POST', body: JSON.stringify({}) }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onReconcile={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/reconcile`,
                { method: 'POST', body: JSON.stringify({ refreshProviderResults: true }) }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onStop={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/stop`,
                { method: 'POST', body: JSON.stringify({}) }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onCancel={async () => {
            setErrorMsg(null);
            setBusy(true);
            try {
              const res = await request<ApiCampaignEnvelope>(
                `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}/cancel`,
                { method: 'POST', body: JSON.stringify({}) }
              );
              setEnvelope(res);
              await refreshHistoryAndCsv(res.campaign.campaignId);
            } catch (err) {
              setErrorMsg((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onChatCommand={async command => {
            setErrorMsg(null);
            try {
              const res = await request<{
                handled: boolean;
                assistantResponseText?: string;
                campaign?: ApiCampaignEnvelope;
              }>('/api/v1/campaigns/bulk/chat-command', {
                method: 'POST',
                body: JSON.stringify({
                  message: command,
                  campaignId: envelope.campaign.campaignId
                })
              });
              if (res.assistantResponseText) {
                setChatFollowUp(res.assistantResponseText);
              }
              if (res.campaign) {
                setEnvelope(res.campaign);
                await refreshHistoryAndCsv(res.campaign.campaign.campaignId);
              } else {
                const latest = await request<ApiCampaignEnvelope>(
                  `/api/v1/campaigns/bulk/${encodeURIComponent(envelope.campaign.campaignId)}`
                );
                setEnvelope(latest);
                await refreshHistoryAndCsv(latest.campaign.campaignId);
              }
            } catch (err) {
              setErrorMsg((err as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}

export interface BulkCampaignChatCardProps {
  approval?: ApprovalRequestItem;
  plan?: PlanWithStepsItem;
  canDecide: boolean;
  decideReason?: string;
  deciding: boolean;
  refreshing: boolean;
  onConfirm(): void;
  onCancel(): void;
  onRefresh(): void;
  onOpenDashboard?(): void;
}

export function BulkCampaignChatCard(props: BulkCampaignChatCardProps) {
  const stepParams = (props.plan?.steps[0]?.parameters ?? props.approval?.actionParams ?? {}) as Record<
    string,
    unknown
  >;
  const title = typeof stepParams.title === 'string' ? stepParams.title : props.plan?.title ?? 'Bulk Campaign';
  const campaignId = typeof stepParams.campaignId === 'string' ? stepParams.campaignId : 'N/A';
  const eventDetails = typeof stepParams.eventDetails === 'string' ? stepParams.eventDetails : '';
  const channels = Array.isArray(stepParams.channels) ? (stepParams.channels as string[]) : ['whatsapp', 'phone'];
  const eligibleCount = typeof stepParams.eligibleContactsCount === 'number' ? stepParams.eligibleContactsCount : 0;
  const unauthorizedCount =
    typeof stepParams.unauthorizedContactsCount === 'number' ? stepParams.unauthorizedContactsCount : 0;
  const unsupportedCount =
    typeof stepParams.unsupportedContactsCount === 'number' ? stepParams.unsupportedContactsCount : 0;
  const duplicateCount =
    typeof stepParams.duplicateEntriesCount === 'number' ? stepParams.duplicateEntriesCount : 0;
  const invalidCount = typeof stepParams.invalidEntriesCount === 'number' ? stepParams.invalidEntriesCount : 0;
  const waPlan = (stepParams.whatsappPlan ?? {}) as { templateName?: string; messagePreview?: string };
  const callScript = (stepParams.callScript ?? {}) as {
    aiDisclosure?: string;
    boundedPurposePreview?: string;
  };
  const emailPlan = (stepParams.emailPlan ?? undefined) as { subject?: string; bodyPreview?: string } | undefined;
  const approvalStatus = props.approval?.status ?? props.plan?.status ?? 'awaiting_approval';

  return (
    <div
      className="chat-plan-card"
      data-testid="bulk-campaign-chat-card"
      style={{ marginTop: '0.65rem', padding: '0.85rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
          marginBottom: '0.45rem'
        }}
      >
        <div>
          <strong>Governed Bulk Campaign Plan: {title}</strong>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Campaign ID: <code>{campaignId}</code> · Channels: {channels.join(', ')}
          </div>
        </div>
        <span className="badge badge-warning">{approvalStatus.toUpperCase()}</span>
      </div>

      {eventDetails && (
        <div style={{ fontSize: '0.8rem', marginBottom: '0.35rem' }}>
          <strong>Event:</strong> {eventDetails}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '0.4rem',
          fontSize: '0.76rem',
          marginBottom: '0.5rem'
        }}
      >
        <div style={{ padding: '0.35rem', background: '#f0fdf4', borderRadius: '4px' }}>
          <strong>Eligible:</strong> {eligibleCount}
        </div>
        <div style={{ padding: '0.35rem', background: '#fffbeb', borderRadius: '4px' }}>
          <strong>Unauthorized Held:</strong> {unauthorizedCount}
        </div>
        <div style={{ padding: '0.35rem', background: '#eff6ff', borderRadius: '4px' }}>
          <strong>Unsupported Queued:</strong> {unsupportedCount}
        </div>
        <div style={{ padding: '0.35rem', background: '#f8fafc', borderRadius: '4px' }}>
          <strong>Duplicates / Invalid:</strong> {duplicateCount} / {invalidCount}
        </div>
      </div>

      {waPlan.messagePreview && (
        <div style={{ fontSize: '0.76rem', marginBottom: '0.25rem' }}>
          <strong>WhatsApp ({waPlan.templateName ?? 'template'}):</strong> “{waPlan.messagePreview}”
        </div>
      )}
      {callScript.aiDisclosure && (
        <div style={{ fontSize: '0.76rem', marginBottom: '0.25rem' }}>
          <strong>Sarvam AI Call Disclosure:</strong> “{callScript.aiDisclosure}”
        </div>
      )}
      {emailPlan?.subject && (
        <div style={{ fontSize: '0.76rem', marginBottom: '0.25rem' }}>
          <strong>Email Draft (Live Mass Sending Disabled):</strong> {emailPlan.subject} — “{emailPlan.bodyPreview}”
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
        {props.approval?.status === 'pending' && props.canDecide && (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={props.deciding}
              onClick={props.onConfirm}
              style={{ fontSize: '0.76rem', padding: '0.3rem 0.7rem' }}
            >
              {props.deciding ? 'Approving...' : 'Approve Campaign Plan'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={props.deciding}
              onClick={props.onCancel}
              style={{ fontSize: '0.76rem', padding: '0.3rem 0.7rem' }}
            >
              Reject &amp; Cancel Campaign
            </button>
          </>
        )}
        {props.onOpenDashboard && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={props.onOpenDashboard}
            style={{ fontSize: '0.76rem', padding: '0.3rem 0.7rem' }}
          >
            Open Bulk Campaign Dashboard
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          disabled={props.refreshing}
          onClick={props.onRefresh}
          style={{ fontSize: '0.76rem', padding: '0.3rem 0.7rem' }}
        >
          {props.refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      {props.approval?.status === 'pending' && !props.canDecide && props.decideReason && (
        <div style={{ fontSize: '0.74rem', color: 'var(--warning)', marginTop: '0.35rem' }}>
          {props.decideReason}
        </div>
      )}
    </div>
  );
}
