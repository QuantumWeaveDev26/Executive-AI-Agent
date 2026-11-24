import { useEffect, useState } from 'react';
import {
  BULK_CAMPAIGN_OUTCOME_COLORS,
  formatBulkCampaignOutcomeDisplay,
  type BulkCampaignChannel,
  type BulkCampaignContactRecord,
  type BulkCampaignDashboardMetrics,
  type BulkCampaignStatus
} from '../../../packages/contracts/src/bulk-campaign';
import { PhoneCallRecordingPlayer, PhoneCallTranscriptPanel } from './PhoneCallMediaOptions';

export interface BulkCampaignWhatsAppTranscriptMessage {
  id: string;
  speaker: 'thaara' | 'customer';
  text: string;
  timestamp: string;
  status?: string;
  providerMessageId?: string | null;
  deliveryEvents?: Array<{ status: string; timestamp: string }>;
}

export interface BulkCampaignWhatsAppTranscriptResponse {
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

export interface BulkCampaignHistorySummaryItem {
  campaignId: string;
  title: string;
  objective: string;
  instruction: string;
  status: BulkCampaignStatus | string;
  executionMode: 'planned' | 'simulation' | 'live';
  channels: BulkCampaignChannel[];
  createdAt: string;
  updatedAt: string;
  totalSelectedContacts: number;
  metrics: BulkCampaignDashboardMetrics;
}

export function formatShortCampaignTitle(title: string): string {
  const clean = (title || 'Untitled Campaign').replace(/\s+/g, ' ').trim();
  if (clean.length <= 42) return clean;
  const lower = clean.toLowerCase();
  if (lower.includes('ai webinar')) return 'AI Webinar';
  if (lower.includes('digital marketing')) return 'Digital Marketing';
  if (lower.includes('ai automation')) return 'AI Automation';
  if (lower.includes('customer feedback')) return 'Customer Feedback';
  if (lower.includes('product enquiry') || lower.includes('product inquiry')) return 'Product Enquiry';
  if (lower.includes('follow-up') || lower.includes('follow up')) return 'Follow-up Campaign';
  if (lower.includes('company')) return 'Company Introduction';
  return `${clean.slice(0, 39).trim()}…`;
}

export function formatShortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatBulkOutcomeBadge(
  outcome: string,
  isSimulation = false
): { label: string; color: string; bg: string; fg: string } {
  return formatBulkCampaignOutcomeDisplay(outcome, isSimulation);
}

export function formatChannelLabel(channels: BulkCampaignChannel[]): string {
  if (!channels || channels.length === 0) return 'Campaign';
  return channels
    .map(ch => (ch === 'phone' ? 'AI Calling' : ch === 'whatsapp' ? 'WhatsApp' : 'Email'))
    .join(' · ');
}

export function BulkCampaignWhatsAppTranscriptViewer(props: {
  campaignId: string;
  contactRecord: BulkCampaignContactRecord;
}) {
  const { campaignId, contactRecord: r } = props;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BulkCampaignWhatsAppTranscriptResponse | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/campaigns/bulk/${encodeURIComponent(campaignId)}/contacts/${encodeURIComponent(
            r.contact.contactId
          )}/whatsapp-transcript`,
          { credentials: 'include' }
        );
        if (!res.ok) {
          throw new Error(`Unable to load WhatsApp transcript (${res.status})`);
        }
        const json = (await res.json()) as BulkCampaignWhatsAppTranscriptResponse;
        if (active) setData(json);
      } catch (err) {
        if (active) {
          setError((err as Error).message);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [campaignId, r.contact.contactId, r.whatsappProviderMessageId, r.whatsappCustomerReply]);

  if (loading && !data) {
    return (
      <div style={{ fontSize: '0.8rem', color: '#64748b', padding: '0.5rem 0.7rem' }}>
        Loading WhatsApp conversation...
      </div>
    );
  }

  if (error && !data) {
    const hasLocal = Boolean(r.personalizedWhatsappPreview || r.whatsappCustomerReply);
    if (!hasLocal) {
      return (
        <div style={{ fontSize: '0.8rem', color: '#b91c1c', padding: '0.5rem 0.7rem' }}>
          {error}
        </div>
      );
    }
    return (
      <div
        data-testid={`bulk-wa-transcript-${r.contact.contactId}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
          fontSize: '0.81rem',
          background: '#f8fafc',
          borderRadius: '10px',
          padding: '0.65rem 0.8rem',
          border: '1px solid #e2e8f0'
        }}
      >
        {r.personalizedWhatsappPreview && (
          <div>
            <strong style={{ color: '#1d4ed8' }}>Thaara: </strong>
            <span>{r.personalizedWhatsappPreview}</span>
          </div>
        )}
        {r.whatsappCustomerReply && (
          <div>
            <strong style={{ color: '#0f172a' }}>Customer: </strong>
            <span>{r.whatsappCustomerReply}</span>
          </div>
        )}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div
      data-testid={`bulk-wa-transcript-${r.contact.contactId}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.42rem',
        fontSize: '0.82rem',
        background: '#f8fafc',
        borderRadius: '10px',
        padding: '0.7rem 0.85rem',
        border: '1px solid #e2e8f0'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.4rem',
          fontSize: '0.73rem',
          color: '#64748b'
        }}
      >
        <span>
          <strong>{data.isSimulated ? 'Test Conversation' : 'WhatsApp Conversation'}</strong> · Language:{' '}
          {data.language}
        </span>
      </div>

      {data.attributionNote && (
        <div
          style={{
            fontSize: '0.77rem',
            color: '#92400e',
            background: '#fffbeb',
            padding: '0.4rem 0.6rem',
            borderRadius: '6px'
          }}
        >
          {data.attributionNote}
        </div>
      )}

      {data.messages.length === 0 ? (
        <div style={{ fontSize: '0.79rem', color: '#64748b' }}>
          No campaign-attributed WhatsApp messages recorded yet.
        </div>
      ) : (
        data.messages.map(m => (
          <div key={m.id} style={{ lineHeight: 1.45, borderBottom: '1px solid #eef2f7', paddingBottom: '0.3rem' }}>
            <div>
              <strong style={{ color: m.speaker === 'thaara' ? '#1d4ed8' : '#0f172a' }}>
                {m.speaker === 'thaara' ? 'Thaara: ' : 'Customer: '}
              </strong>
              <span style={{ color: '#1e293b' }}>{m.text}</span>
            </div>
            <div style={{ fontSize: '0.71rem', color: '#64748b', marginTop: '0.12rem' }}>
              {m.timestamp ? new Date(m.timestamp).toLocaleString() : ''}
              {m.status ? ` · ${m.status}` : ''}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function BulkCampaignResultsSection(props: {
  campaignId: string;
  status: string;
  executionMode?: 'planned' | 'simulation' | 'live';
  channels: BulkCampaignChannel[];
  contacts: BulkCampaignContactRecord[];
  metrics: BulkCampaignDashboardMetrics;
  hasBatchOrRealResults: boolean;
  onRefresh?: () => void;
  onDownloadCsv?: () => void;
}) {
  const {
    campaignId,
    status,
    executionMode,
    channels,
    contacts,
    metrics,
    hasBatchOrRealResults,
    onRefresh,
    onDownloadCsv
  } = props;

  const isSimulationCampaign = executionMode !== 'live' && !hasBatchOrRealResults;

  // All recordings, transcripts, and details start COLLAPSED by default
  const [expandedPanels, setExpandedPanels] = useState<
    Record<string, { recording?: boolean; transcript?: boolean; details?: boolean }>
  >({});
  const [outcomeFilter, setOutcomeFilter] = useState<
    'all' | 'interested' | 'not_interested' | 'callback' | 'other'
  >('all');
  const [contactSearch, setContactSearch] = useState('');

  const togglePanel = (contactId: string, panel: 'recording' | 'transcript' | 'details') => {
    setExpandedPanels(prev => {
      const cur = prev[contactId] ?? {};
      return { ...prev, [contactId]: { ...cur, [panel]: !cur[panel] } };
    });
  };

  const eligibleContacts = contacts.filter(c => c.category === 'eligible');
  const hasPhone = channels.includes('phone');
  const hasWhatsapp = channels.includes('whatsapp');

  const waAttempted = contacts.filter(
    r => r.whatsappStatus !== 'not_applicable' && r.whatsappStatus !== 'skipped'
  ).length;
  const waSent = contacts.filter(r => ['sent', 'delivered', 'read'].includes(r.whatsappStatus)).length;
  const waDelivered = contacts.filter(r => ['delivered', 'read'].includes(r.whatsappStatus)).length;
  const waRead = contacts.filter(r => r.whatsappStatus === 'read').length;
  const waReplied = contacts.filter(r => Boolean(r.whatsappCustomerReply)).length;
  const waAwaiting = Math.max(0, waSent - waReplied);

  const unclassifiedCount = contacts.filter(
    r =>
      r.selectedByOwner &&
      (r.phoneStatus === 'answered' ||
        r.phoneRecordState === 'completed' ||
        ['sent', 'delivered', 'read'].includes(r.whatsappStatus)) &&
      r.attendanceOutcome === 'pending'
  ).length;

  const visibleContacts = contacts
    .filter(
      r =>
        r.selectedByOwner ||
        r.category === 'eligible' ||
        r.phoneRawResponses.length > 0 ||
        Boolean(r.simulatedDialogueTurns) ||
        Boolean(r.phoneCallId) ||
        Boolean(r.whatsappDispatchId) ||
        Boolean(r.whatsappProviderMessageId)
    )
    .filter(r => {
      if (contactSearch.trim()) {
        const q = contactSearch.trim().toLowerCase();
        const nameMatch = r.contact.name.toLowerCase().includes(q);
        const phoneMatch = (r.contact.maskedPhone ?? '').toLowerCase().includes(q);
        if (!nameMatch && !phoneMatch) return false;
      }
      if (outcomeFilter === 'interested') {
        return r.attendanceOutcome === 'confirmed' || r.attendanceOutcome === 'interested';
      }
      if (outcomeFilter === 'not_interested') {
        return r.attendanceOutcome === 'declined' || r.attendanceOutcome === 'not_interested';
      }
      if (outcomeFilter === 'callback') {
        return r.attendanceOutcome === 'callback_requested';
      }
      if (outcomeFilter === 'other') {
        return (
          r.attendanceOutcome !== 'confirmed' &&
          r.attendanceOutcome !== 'interested' &&
          r.attendanceOutcome !== 'declined' &&
          r.attendanceOutcome !== 'not_interested' &&
          r.attendanceOutcome !== 'callback_requested'
        );
      }
      return true;
    });

  const secondaryOutcomes: Array<[string, number]> = (
    [
      ['No answer', metrics.callsNotAnswered],
      ['Failed', metrics.failed],
      ['Opted out', metrics.optedOut],
      ['Pending', metrics.pending],
      ['Unclassified', unclassifiedCount]
    ] as Array<[string, number]>
  ).filter(([, v]) => v > 0);

  return (
    <section
      data-testid="campaign-results-card"
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '14px',
        padding: '1.2rem 1.35rem',
        boxShadow: '0 4px 16px rgba(15, 23, 42, 0.04)'
      }}
    >
      {/* Results Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginBottom: '0.9rem'
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '1.08rem', fontWeight: 700, color: '#0f172a' }}>
            {isSimulationCampaign ? 'Test Results' : 'Campaign Results'}
          </h3>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.15rem' }}>
            {status === 'running'
              ? 'Campaign is running — results update automatically.'
              : isSimulationCampaign
                ? 'Simulated outcomes only — no real calls or messages were sent.'
                : 'Actual campaign outcomes, recordings, and conversations.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {onRefresh && (
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="refresh-campaign-results-button"
              onClick={onRefresh}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
            >
              Refresh
            </button>
          )}
          {onDownloadCsv && (
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="download-campaign-report-button"
              onClick={onDownloadCsv}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
            >
              Download Report
            </button>
          )}
        </div>
      </div>

      {/* Three Prominent Business Outcome Metrics */}
      <div
        data-testid="campaign-ten-outcome-metrics"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '0.75rem',
          marginBottom: '0.85rem'
        }}
      >
        <div
          style={{
            padding: '0.9rem 0.75rem',
            background: '#f8fafc',
            borderRadius: '12px',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: BULK_CAMPAIGN_OUTCOME_COLORS.engaged }}>
            {metrics.confirmed}
          </div>
          <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.15rem' }}>Engaged</div>
        </div>
        <div
          style={{
            padding: '0.9rem 0.75rem',
            background: '#f8fafc',
            borderRadius: '12px',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: BULK_CAMPAIGN_OUTCOME_COLORS.notAligned }}>
            {metrics.declined}
          </div>
          <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.15rem' }}>Not Aligned</div>
        </div>
        <div
          style={{
            padding: '0.9rem 0.75rem',
            background: '#f8fafc',
            borderRadius: '12px',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: BULK_CAMPAIGN_OUTCOME_COLORS.furtherDiscussion }}>
            {metrics.callbackRequested}
          </div>
          <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.15rem' }}>Further Discussion</div>
        </div>
      </div>

      {/* Relevant Secondary Outcomes (only shown when non-zero) */}
      {secondaryOutcomes.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.75rem', fontSize: '0.78rem', color: '#475569' }}>
          {secondaryOutcomes.map(([label, val]) => (
            <span
              key={label}
              style={{
                padding: '0.2rem 0.6rem',
                borderRadius: '999px',
                background: '#f1f5f9',
                border: '1px solid #e2e8f0'
              }}
            >
              {label}: <strong>{val}</strong>
            </span>
          ))}
        </div>
      )}

      {/* Collapsed More Details (Technical Metrics) */}
      <details data-testid="results-more-details" style={{ marginBottom: '1rem', fontSize: '0.8rem', color: '#475569' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#64748b' }}>More Details</summary>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '0.45rem',
            marginTop: '0.55rem'
          }}
        >
          <div>Total contacts: <strong>{metrics.totalContacts}</strong></div>
          <div>Eligible: <strong>{eligibleContacts.length}</strong></div>
          {hasPhone && (
            <>
              <div>Calls attempted: <strong>{metrics.callsAttempted}</strong></div>
              <div>Calls completed: <strong>{metrics.callsCompleted ?? metrics.callsAnswered + metrics.callsNotAnswered}</strong></div>
              <div>Calls answered: <strong>{metrics.callsAnswered}</strong></div>
              <div>Busy: <strong>{metrics.busyCount ?? 0}</strong></div>
            </>
          )}
          {hasWhatsapp && (
            <>
              <div>Messages attempted: <strong>{waAttempted}</strong></div>
              <div>Messages sent: <strong>{waSent}</strong></div>
              <div>Messages delivered: <strong>{waDelivered}</strong></div>
              <div>Messages read: <strong>{waRead}</strong></div>
              <div>Customers replied: <strong>{waReplied}</strong></div>
              <div>Awaiting response: <strong>{waAwaiting}</strong></div>
            </>
          )}
        </div>
      </details>

      {/* One Compact Contact Filter Control */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.6rem',
          paddingTop: '0.75rem',
          borderTop: '1px solid #e2e8f0',
          marginBottom: '0.75rem'
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#0f172a' }}>Contact results</div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', flex: '1 1 260px', justifyContent: 'flex-end' }}>
          <select
            aria-label="Filter contact results"
            data-testid="contact-results-filter"
            value={outcomeFilter}
            onChange={e => setOutcomeFilter(e.target.value as typeof outcomeFilter)}
            style={{
              padding: '0.35rem 0.65rem',
              borderRadius: '999px',
              border: '1px solid #cbd5e1',
              fontSize: '0.82rem',
              background: '#ffffff'
            }}
          >
            <option value="all">All</option>
            <option value="interested">Engaged</option>
            <option value="not_interested">Not Aligned</option>
            <option value="callback">Further Discussion</option>
            <option value="other">Other outcomes</option>
          </select>
          <input
            type="search"
            aria-label="Search contacts"
            placeholder="Search contact..."
            value={contactSearch}
            onChange={e => setContactSearch(e.target.value)}
            style={{
              padding: '0.35rem 0.7rem',
              borderRadius: '999px',
              border: '1px solid #cbd5e1',
              fontSize: '0.82rem',
              minWidth: '150px'
            }}
          />
        </div>
      </div>

      {/* Compact Per-Contact Result Cards */}
      <div data-testid="simulated-conversations-section" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
        {visibleContacts.length === 0 ? (
          <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.84rem', color: '#64748b' }}>
            No contacts match the selected filter.
          </div>
        ) : (
          visibleContacts.map((r, idx) => {
            const hasRealCall = Boolean(r.phoneCallId && !r.phoneCallId.startsWith('sim_'));
            const hasRealWa = Boolean(r.whatsappDispatchId || r.whatsappProviderMessageId);
            const isSimContact =
              isSimulationCampaign ||
              Boolean(r.contact.isSyntheticTestFixture) ||
              Boolean(r.phoneCallId?.startsWith('sim_'));

            const isProcessingCall =
              hasRealCall &&
              (r.phoneStatus === 'attempted' ||
                ((r.phoneStatus === 'answered' || r.phoneRecordState === 'completed') &&
                  !r.phoneTranscriptSummary &&
                  r.attendanceOutcome === 'pending'));
            const isCompletedUnclassified =
              hasRealCall &&
              !isProcessingCall &&
              (r.phoneStatus === 'answered' || r.phoneRecordState === 'completed') &&
              r.attendanceOutcome === 'pending';

            const badge = isProcessingCall
              ? { label: 'Processing', color: '#92400e', bg: '#fef3c7', fg: '#92400e' }
              : isCompletedUnclassified
                ? { label: 'Completed — unclassified', color: '#0369a1', bg: '#e0f2fe', fg: '#0369a1' }
                : formatBulkOutcomeBadge(r.attendanceOutcome, isSimContact);

            const panelState = expandedPanels[r.contact.contactId] ?? {};
            const showRecording = Boolean(panelState.recording);
            const showTranscript = Boolean(panelState.transcript);
            const showDetails = Boolean(panelState.details);

            const displayName = isSimContact
              ? r.contact.name.startsWith('[SYNTHETIC TEST]')
                ? r.contact.name
                : `Test Contact: ${r.contact.name}`
              : r.contact.name;

            return (
              <div
                key={r.contact.contactId}
                data-testid={`simulated-conversation-card-${idx + 1}`}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '0.85rem 1rem',
                  background: '#fcfdff'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                    marginBottom: '0.5rem'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#0f172a' }}>{displayName}</div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.12rem' }}>
                      {r.contact.maskedPhone ?? 'No phone'}
                      {isSimContact ? ' · Simulated Outcome' : ''}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      color: badge.color,
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {badge.label}
                  </span>
                </div>

                {/* Clean Action Pills (All collapsed by default) */}
                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                  {hasPhone && hasRealCall && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      data-testid={`contact-recording-toggle-${r.contact.contactId}`}
                      onClick={() => togglePanel(r.contact.contactId, 'recording')}
                      style={{ fontSize: '0.78rem', padding: '0.28rem 0.72rem', borderRadius: '999px' }}
                    >
                      {showRecording ? 'Hide Recording' : 'Recording'}
                    </button>
                  )}
                  {((hasPhone && hasRealCall) || hasWhatsapp) && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      data-testid={`contact-transcript-toggle-${r.contact.contactId}`}
                      onClick={() => togglePanel(r.contact.contactId, 'transcript')}
                      style={{ fontSize: '0.78rem', padding: '0.28rem 0.72rem', borderRadius: '999px' }}
                    >
                      {showTranscript
                        ? 'Hide Transcript'
                        : isSimContact && !hasRealCall && !hasRealWa
                          ? 'Test Conversation'
                          : 'Transcript'}
                    </button>
                  )}
                  {!hasRealCall && !hasRealWa && !hasWhatsapp && r.simulatedDialogueTurns && r.simulatedDialogueTurns.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      data-testid={`contact-transcript-toggle-${r.contact.contactId}`}
                      onClick={() => togglePanel(r.contact.contactId, 'transcript')}
                      style={{ fontSize: '0.78rem', padding: '0.28rem 0.72rem', borderRadius: '999px' }}
                    >
                      {showTranscript ? 'Hide Test Conversation' : 'Test Conversation'}
                    </button>
                  )}
                  {(hasRealCall || hasRealWa || r.phoneTranscriptSummary || r.structuredNotes || r.preferredCallbackTime) && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      data-testid={`contact-details-toggle-${r.contact.contactId}`}
                      onClick={() => togglePanel(r.contact.contactId, 'details')}
                      style={{ fontSize: '0.78rem', padding: '0.28rem 0.72rem', borderRadius: '999px' }}
                    >
                      {showDetails ? 'Hide Details' : 'Details'}
                    </button>
                  )}
                </div>

                {/* Expanded Recording Player (only when Recording clicked on a real call) */}
                {showRecording && hasRealCall && r.phoneCallId && (
                  <div style={{ marginTop: '0.6rem' }}>
                    <PhoneCallRecordingPlayer direction="outbound" callId={r.phoneCallId} recordingAvailable={true} />
                  </div>
                )}

                {/* Expanded Two-Way AI Calling Transcript (only when Transcript clicked on a real call) */}
                {showTranscript && hasRealCall && r.phoneCallId && (
                  <div style={{ marginTop: '0.6rem' }}>
                    <PhoneCallTranscriptPanel
                      metadata={{
                        direction: 'outbound',
                        callId: r.phoneCallId,
                        recordingAvailable: true,
                        customerName: r.contact.name,
                        phoneNumber: r.contact.maskedPhone ?? null,
                        business: r.contact.company ?? null,
                        interestedService: null,
                        requirements: r.structuredNotes ?? null,
                        preferredCallbackTime: r.preferredCallbackTime ?? null,
                        callDate: r.interactionTimestamp ?? null,
                        durationSeconds: r.phoneDurationSeconds ?? null,
                        outcome: r.attendanceOutcome,
                        callbackStatus: null,
                        summary: r.phoneTranscriptSummary ?? null,
                        transcript: []
                      }}
                    />
                  </div>
                )}

                {/* Expanded WhatsApp Transcript (only when Transcript clicked) */}
                {showTranscript && !hasRealCall && hasWhatsapp && (
                  <div style={{ marginTop: '0.6rem' }}>
                    <BulkCampaignWhatsAppTranscriptViewer campaignId={campaignId} contactRecord={r} />
                  </div>
                )}

                {/* Expanded Simulated Test Conversation (clearly labelled Test Conversation) */}
                {showTranscript && !hasRealCall && !hasWhatsapp && r.simulatedDialogueTurns && r.simulatedDialogueTurns.length > 0 && (
                  <div
                    data-testid={`test-conversation-${r.contact.contactId}`}
                    style={{
                      marginTop: '0.6rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.38rem',
                      fontSize: '0.82rem',
                      background: '#f8fafc',
                      borderRadius: '10px',
                      padding: '0.65rem 0.8rem',
                      border: '1px solid #edf2f7'
                    }}
                  >
                    <div style={{ fontSize: '0.73rem', fontWeight: 700, color: '#64748b' }}>
                      Test Conversation (Simulated)
                    </div>
                    {r.simulatedDialogueTurns.map((turn, tIdx) => (
                      <div key={tIdx} style={{ lineHeight: 1.45 }}>
                        <strong style={{ color: turn.speaker === 'thaara' ? '#4338ca' : '#0f172a' }}>
                          {turn.speaker === 'thaara' ? 'Thaara: ' : 'Customer: '}
                        </strong>
                        <span style={{ color: '#334155' }}>{turn.text}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Collapsed Technical & Summary Details (only shown when Details clicked) */}
                {showDetails && (
                  <div
                    data-testid={`contact-details-panel-${r.contact.contactId}`}
                    style={{
                      marginTop: '0.6rem',
                      fontSize: '0.79rem',
                      color: '#334155',
                      padding: '0.6rem 0.75rem',
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      display: 'grid',
                      gap: '0.25rem'
                    }}
                  >
                    {hasRealCall && (
                      <>
                        <div>
                          <strong>Call Status:</strong> {r.phoneRecordState ?? r.phoneStatus}
                          {typeof r.phoneDurationSeconds === 'number' ? ` · Duration: ${r.phoneDurationSeconds}s` : ''}
                        </div>
                        {r.interactionTimestamp && (
                          <div><strong>Date/Time:</strong> {new Date(r.interactionTimestamp).toLocaleString()}</div>
                        )}
                        <div><strong>Thaara Call ID:</strong> <code>{r.phoneCallId}</code></div>
                        {r.phoneProviderCallId && (
                          <div><strong>Provider Call ID:</strong> <code>{r.phoneProviderCallId}</code></div>
                        )}
                      </>
                    )}
                    {hasWhatsapp && (
                      <div>
                        <strong>WhatsApp Status:</strong> {r.whatsappStatus}
                        {r.whatsappProviderMessageId ? ` · Msg ID: ${r.whatsappProviderMessageId}` : ''}
                      </div>
                    )}
                    {(r.contact.company || r.contact.leadSource || r.contact.serviceRequired || r.contact.customerRequirement || r.contact.enquiryDate) && (
                      <div>
                        <strong>Lead Enquiry:</strong>{' '}
                        {[
                          r.contact.company ? `Business: ${r.contact.company}` : null,
                          r.contact.leadSource ? `Source: ${r.contact.leadSource}` : null,
                          r.contact.serviceRequired ? `Service: ${r.contact.serviceRequired}` : null,
                          r.contact.customerRequirement ? `Requirement: ${r.contact.customerRequirement}` : null,
                          r.contact.enquiryDate ? `Date: ${r.contact.enquiryDate}` : null
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                    {r.phoneTranscriptSummary && (
                      <div><strong>Summary:</strong> {r.phoneTranscriptSummary}</div>
                    )}
                    {r.structuredNotes && (
                      <div><strong>Customer Requirements:</strong> {r.structuredNotes}</div>
                    )}
                    {(r.followUpReason || r.preferredCallbackTime) && (
                      <div>
                        <strong>Callback Details:</strong>{' '}
                        {[r.followUpReason, r.preferredCallbackTime].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export function BulkCampaignHistoryView(props: {
  campaigns: BulkCampaignHistorySummaryItem[];
  loading?: boolean;
  onOpenDetails: (campaignId: string) => void;
  onCreateNew: () => void;
}) {
  const { campaigns, loading, onOpenDetails, onCreateNew } = props;
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [channelFilter, setChannelFilter] = useState<'all' | 'phone' | 'whatsapp' | 'email' | 'combined'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'completed' | 'paused' | 'stopped' | 'draft'>('all');
  const [modeFilter, setModeFilter] = useState<'all' | 'live' | 'simulation'>('all');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const filtered = campaigns
    .slice()
    .sort((a, b) => (Date.parse(b.updatedAt || b.createdAt) || 0) - (Date.parse(a.updatedAt || a.createdAt) || 0))
    .filter(c => {
      if (searchQuery.trim() && !c.title.toLowerCase().includes(searchQuery.trim().toLowerCase())) {
        return false;
      }
      if (channelFilter !== 'all') {
        if (channelFilter === 'combined') {
          if (c.channels.length < 2) return false;
        } else if (!c.channels.includes(channelFilter)) {
          return false;
        }
      }
      if (statusFilter !== 'all') {
        if (statusFilter === 'draft') {
          if (
            c.status !== 'draft' &&
            c.status !== 'draft_requires_reapproval' &&
            c.status !== 'approved' &&
            c.status !== 'scheduled'
          ) {
            return false;
          }
        } else if (c.status !== statusFilter) {
          return false;
        }
      }
      if (modeFilter !== 'all') {
        const isLive = c.executionMode === 'live';
        if (modeFilter === 'live' && !isLive) return false;
        if (modeFilter === 'simulation' && isLive) return false;
      }
      return true;
    });

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <section
      data-testid="bulk-campaign-history-page"
      aria-label="Campaign History"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.9rem',
        padding: '1.5rem 1.25rem 2.5rem',
        maxWidth: '880px',
        margin: '0 auto'
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem'
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 700, color: '#0f172a' }}>Campaign History</h2>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="history-create-campaign-button"
          onClick={onCreateNew}
          style={{ fontSize: '0.84rem', padding: '0.45rem 0.95rem' }}
        >
          + Create Campaign
        </button>
      </div>

      {/* Compact Search + Collapsible Secondary Filters */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="search"
          aria-label="Search campaigns by name"
          placeholder="Search campaigns..."
          value={searchQuery}
          onChange={e => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          style={{
            flex: '1 1 240px',
            padding: '0.55rem 0.9rem',
            borderRadius: '999px',
            border: '1px solid #cbd5e1',
            fontSize: '0.86rem',
            background: '#ffffff'
          }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="history-toggle-filters-button"
          onClick={() => setShowFilters(f => !f)}
          style={{ fontSize: '0.82rem', padding: '0.45rem 0.85rem', borderRadius: '999px' }}
        >
          {showFilters ? 'Hide Filters' : 'Filters'}
        </button>
      </div>

      {showFilters && (
        <div
          data-testid="history-secondary-filters"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: '0.55rem',
            background: '#ffffff',
            padding: '0.75rem 0.9rem',
            borderRadius: '12px',
            border: '1px solid #e2e8f0'
          }}
        >
          <select
            aria-label="Filter by channel"
            value={channelFilter}
            onChange={e => {
              setChannelFilter(e.target.value as typeof channelFilter);
              setPage(1);
            }}
            style={{ padding: '0.4rem 0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
          >
            <option value="all">All channels</option>
            <option value="phone">AI Calling</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="combined">Combined</option>
          </select>
          <select
            aria-label="Filter by campaign status"
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value as typeof statusFilter);
              setPage(1);
            }}
            style={{ padding: '0.4rem 0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
          >
            <option value="all">All statuses</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="paused">Paused</option>
            <option value="stopped">Stopped</option>
            <option value="draft">Drafts</option>
          </select>
          <select
            aria-label="Filter by execution mode"
            value={modeFilter}
            onChange={e => {
              setModeFilter(e.target.value as typeof modeFilter);
              setPage(1);
            }}
            style={{ padding: '0.4rem 0.6rem', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
          >
            <option value="all">Live &amp; Test</option>
            <option value="live">Live only</option>
            <option value="simulation">Test only</option>
          </select>
        </div>
      )}

      {loading && campaigns.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Loading campaign history...</div>
      ) : pageItems.length === 0 ? (
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '14px',
            padding: '2rem',
            textAlign: 'center',
            color: '#64748b'
          }}
        >
          No campaigns found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          {pageItems.map(c => (
            <article
              key={c.campaignId}
              data-testid={`history-campaign-card-${c.campaignId}`}
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '14px',
                padding: '1.05rem 1.25rem',
                boxShadow: '0 2px 10px rgba(15, 23, 42, 0.03)'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  paddingBottom: '0.75rem',
                  borderBottom: '1px solid #f1f5f9'
                }}
              >
                <div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a' }}>
                    {formatShortCampaignTitle(c.title)}
                  </div>
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: '#64748b',
                      marginTop: '0.18rem',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.4rem',
                      alignItems: 'center'
                    }}
                  >
                    <span>{formatChannelLabel(c.channels)}</span>
                    <span>·</span>
                    <span>{formatShortDate(c.updatedAt || c.createdAt)}</span>
                    <span>·</span>
                    <span style={{ textTransform: 'capitalize' }}>{c.status.replace(/_/g, ' ')}</span>
                    {c.executionMode !== 'live' && (
                      <>
                        <span>·</span>
                        <span style={{ color: '#4338ca', fontWeight: 600 }}>Test</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  data-testid={`history-details-${c.campaignId}`}
                  onClick={() => onOpenDetails(c.campaignId)}
                  style={{
                    borderRadius: '10px',
                    padding: '0.35rem 0.85rem',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    whiteSpace: 'nowrap'
                  }}
                >
                  Details &rsaquo;
                </button>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '0.5rem',
                  paddingTop: '0.8rem',
                  textAlign: 'center'
                }}
              >
                <div>
                  <div style={{ fontSize: '1.65rem', fontWeight: 700, color: BULK_CAMPAIGN_OUTCOME_COLORS.engaged }}>
                    {c.metrics.confirmed}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Engaged</div>
                </div>
                <div>
                  <div style={{ fontSize: '1.65rem', fontWeight: 700, color: BULK_CAMPAIGN_OUTCOME_COLORS.notAligned }}>
                    {c.metrics.declined}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Not Aligned</div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: '1.65rem',
                      fontWeight: 700,
                      color: BULK_CAMPAIGN_OUTCOME_COLORS.furtherDiscussion
                    }}
                  >
                    {c.metrics.callbackRequested}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Further Discussion</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={safePage <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
          >
            Previous
          </button>
          <span style={{ fontSize: '0.82rem', color: '#475569' }}>
            Page {safePage} of {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={safePage >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}

export function BulkCampaignDetailsView(props: {
  campaignId: string;
  title: string;
  objective: string;
  instruction: string;
  status: string;
  executionMode: 'planned' | 'simulation' | 'live';
  channels: BulkCampaignChannel[];
  createdAt?: string;
  updatedAt?: string;
  contacts: BulkCampaignContactRecord[];
  metrics: BulkCampaignDashboardMetrics;
  hasBatchOrRealResults: boolean;
  onBackToHistory: () => void;
  onRefresh?: () => void;
  onDownloadCsv?: () => void;
}) {
  const isLive = props.executionMode === 'live' || props.hasBatchOrRealResults;
  return (
    <section
      data-testid="bulk-campaign-details-page"
      aria-label="Campaign Details"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.9rem',
        padding: '1.5rem 1.25rem 2.5rem',
        maxWidth: '880px',
        margin: '0 auto'
      }}
    >
      <div>
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="details-back-to-history-button"
          onClick={props.onBackToHistory}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontSize: '0.84rem',
            padding: '0.32rem 0.7rem'
          }}
        >
          &larr; Campaign History
        </button>
      </div>

      <header
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '14px',
          padding: '1.05rem 1.25rem'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: '#0f172a' }}>
            {formatShortCampaignTitle(props.title)}
          </h2>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <span
              style={{
                padding: '0.18rem 0.6rem',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 700,
                background: '#dcfce7',
                color: '#166534',
                textTransform: 'capitalize'
              }}
            >
              {props.status.replace(/_/g, ' ')}
            </span>
            {!isLive && (
              <span
                style={{
                  padding: '0.18rem 0.55rem',
                  borderRadius: '999px',
                  fontSize: '0.73rem',
                  fontWeight: 700,
                  background: '#eef2ff',
                  color: '#4338ca'
                }}
              >
                Test
              </span>
            )}
          </div>
        </div>
        <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.2rem' }}>
          {formatChannelLabel(props.channels)}
          {props.updatedAt || props.createdAt ? ` · ${formatShortDate(props.updatedAt || props.createdAt)}` : ''}
        </div>

        {/* Collapsed Campaign Information (purpose & instructions hidden by default) */}
        <details data-testid="details-campaign-info" style={{ marginTop: '0.65rem', fontSize: '0.8rem', color: '#475569' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#64748b' }}>Campaign Information</summary>
          <div style={{ marginTop: '0.45rem', display: 'grid', gap: '0.25rem' }}>
            {props.objective && (
              <div><strong>Purpose:</strong> {props.objective}</div>
            )}
            {props.instruction && (
              <div><strong>Instructions:</strong> {props.instruction}</div>
            )}
            <div><strong>Approved contacts:</strong> {props.contacts.filter(c => c.selectedByOwner).length}</div>
          </div>
        </details>
      </header>

      <BulkCampaignResultsSection
        campaignId={props.campaignId}
        status={props.status}
        executionMode={props.executionMode}
        channels={props.channels}
        contacts={props.contacts}
        metrics={props.metrics}
        hasBatchOrRealResults={props.hasBatchOrRealResults}
        onRefresh={props.onRefresh}
        onDownloadCsv={props.onDownloadCsv}
      />
    </section>
  );
}
