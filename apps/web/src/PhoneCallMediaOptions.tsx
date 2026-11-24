import React, { useEffect, useRef, useState } from 'react';

export interface TranscriptDialogueTurn {
  speaker: 'thaara' | 'customer';
  text: string;
}

export interface CallMediaMetadata {
  direction: 'inbound' | 'outbound';
  callId: string;
  recordingAvailable: boolean;
  customerName?: string | null;
  phoneNumber?: string | null;
  business?: string | null;
  interestedService?: string | null;
  requirements?: string | null;
  preferredCallbackTime?: string | null;
  callDate?: string | null;
  durationSeconds?: number | null;
  outcome?: string | null;
  callbackStatus?: string | null;
  summary?: string | null;
  transcript: TranscriptDialogueTurn[];
}

export function formatCallDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const mins = Math.floor(rounded / 60);
  const rem = rounded % 60;
  return rem === 0 ? `${mins}m` : `${mins}m ${rem}s`;
}

export function formatShortDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d
    .toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
    .replace(/\b(am|pm)\b/i, m => m.toUpperCase());
}

export function formatMaskedPhone(phone: string | null | undefined): string {
  if (!phone) return 'Number unavailable';
  const clean = phone.trim();
  const last4 = /\d{4}$/.exec(clean);
  if (last4) {
    return `•••• ${last4[0]}`;
  }
  return clean;
}

export function formatCallSecondaryLine(options: {
  business?: string | null;
  interestedService?: string | null;
  durationSeconds?: number | null;
}): string | null {
  const parts: string[] = [];
  if (options.business && options.business.trim()) parts.push(options.business.trim());
  if (options.interestedService && options.interestedService.trim()) parts.push(options.interestedService.trim());
  const dur = formatCallDuration(options.durationSeconds);
  if (dur) parts.push(dur);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function PhoneIncomingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 2 16 8 22 8" />
      <line x1="22" y1="2" x2="16" y2="8" />
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export function PhoneOutgoingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="14 2 20 2 20 8" />
      <line x1="14" y1="8" x2="20" y2="2" />
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export function PhoneStatusBadge({ status }: { status: string }) {
  const norm = status.toLowerCase();
  let bg = '#f8fafc';
  let color = '#475569';
  let border = '#e2e8f0';

  if (norm.includes('callback') || norm.includes('requested')) {
    bg = '#fef3c7';
    color = '#92400e';
    border = '#fde68a';
  } else if (norm.includes('enquir')) {
    bg = '#eff6ff';
    color = '#1d4ed8';
    border = '#bfdbfe';
  } else if (norm.includes('completed') || norm.includes('appoint') || norm.includes('booked')) {
    bg = '#ecfdf5';
    color = '#065f46';
    border = '#a7f3d0';
  } else if (norm.includes('review') || norm.includes('need')) {
    bg = '#fff7ed';
    color = '#c2410c';
    border = '#fed7aa';
  } else if (norm.includes('fail') || norm.includes('interrupt')) {
    bg = '#fef2f2';
    color = '#b91c1c';
    border = '#fecaca';
  }

  return (
    <span
      className="phone-status-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: '9999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        backgroundColor: bg,
        color: color,
        border: `1px solid ${border}`,
        textTransform: 'capitalize'
      }}
    >
      {status}
    </span>
  );
}

function formatSeekClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatPlainTextCallExport(meta: CallMediaMetadata): string {
  const headerLines: string[] = [];
  if (meta.customerName) headerLines.push(`Customer: ${meta.customerName}`);
  if (meta.phoneNumber) headerLines.push(`Phone: ${meta.phoneNumber}`);
  headerLines.push(`Direction: ${meta.direction === 'inbound' ? 'Inbound' : 'Outbound'}`);
  if (meta.business) headerLines.push(`Business: ${meta.business}`);
  if (meta.interestedService) headerLines.push(`Interested Service: ${meta.interestedService}`);
  if (meta.requirements) headerLines.push(`Requirements: ${meta.requirements}`);
  if (meta.preferredCallbackTime) headerLines.push(`Preferred Callback: ${meta.preferredCallbackTime}`);
  if (meta.callDate) headerLines.push(`Call Date: ${meta.callDate}`);
  const dur = formatCallDuration(meta.durationSeconds);
  if (dur) headerLines.push(`Duration: ${dur}`);
  if (meta.outcome) headerLines.push(`Outcome: ${meta.outcome}`);
  if (meta.callbackStatus) headerLines.push(`Callback Status: ${meta.callbackStatus}`);
  if (meta.summary && meta.summary !== meta.requirements) headerLines.push(`Summary: ${meta.summary}`);

  const transcriptLines =
    meta.transcript.length > 0
      ? meta.transcript.map(t => `${t.speaker === 'thaara' ? 'Thaara' : 'Customer'}: ${t.text}`)
      : ['No conversation transcript recorded for this call.'];

  return `${headerLines.join('\n')}\n\nConversation Transcript\n${transcriptLines.join('\n')}`;
}

export function PhoneCallRecordingPlayer({
  direction,
  callId,
  recordingAvailable,
  fetchImpl = fetch,
  onClose
}: {
  direction: 'inbound' | 'outbound';
  callId: string;
  recordingAvailable: boolean;
  fetchImpl?: typeof fetch;
  onClose?: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'unavailable' | 'error'>(
    recordingAvailable ? 'idle' : 'unavailable'
  );
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!recordingAvailable) {
      setStatus('unavailable');
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setStatus('loading');
    void (async () => {
      try {
        const res = await fetchImpl(
          `/api/v1/connectors/phone/recordings/${direction}/${encodeURIComponent(callId)}`,
          {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal
          }
        );
        if (cancelled) return;
        if (res.status === 404) {
          setStatus('unavailable');
          return;
        }
        if (!res.ok) {
          setStatus('error');
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        if (!blob || blob.size === 0) {
          setStatus('unavailable');
          return;
        }
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setBlobUrl(url);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [direction, callId, recordingAvailable, fetchImpl]);

  const togglePlayPause = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(e.target.value);
    setCurrentTime(next);
    if (audioRef.current && Number.isFinite(next)) {
      audioRef.current.currentTime = next;
    }
  };

  if (status === 'unavailable') {
    return (
      <div className="phone-media-panel" data-testid="phone-recording-unavailable">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="integration-muted" style={{ margin: 0 }}>Recording was not captured for this call.</p>
          {onClose && (
            <button type="button" className="btn btn-secondary" onClick={onClose} data-testid="phone-recording-close" style={{ padding: '3px 10px', fontSize: '0.8rem' }}>
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="phone-media-panel" data-testid="phone-recording-loading">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="integration-muted" style={{ margin: 0 }}>Loading call recording…</p>
          {onClose && (
            <button type="button" className="btn btn-secondary" onClick={onClose} data-testid="phone-recording-close" style={{ padding: '3px 10px', fontSize: '0.8rem' }}>
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status === 'error' || !blobUrl) {
    return (
      <div className="phone-media-panel" data-testid="phone-recording-error">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p className="integration-muted" style={{ margin: 0 }}>Recording was not captured for this call.</p>
          {onClose && (
            <button type="button" className="btn btn-secondary" onClick={onClose} data-testid="phone-recording-close" style={{ padding: '3px 10px', fontSize: '0.8rem' }}>
              Close
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="phone-media-panel" data-testid="phone-recording-player" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
        <strong style={{ fontSize: '0.9rem', color: '#334155' }}>Call recording</strong>
        {onClose && (
          <button type="button" className="btn btn-secondary" onClick={onClose} data-testid="phone-recording-close" style={{ padding: '3px 10px', fontSize: '0.8rem' }}>
            Close
          </button>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={togglePlayPause}
          data-testid="phone-recording-play-pause"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 100}
          step={0.1}
          value={Math.min(currentTime, duration > 0 ? duration : 100)}
          onChange={handleSeek}
          aria-label="Seek call recording"
          data-testid="phone-recording-seek"
          style={{ flex: '1 1 160px' }}
        />
        <span className="integration-muted" style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.85rem' }}>
          {formatSeekClock(currentTime)} / {formatSeekClock(duration)}
        </span>
      </div>
      <audio
        ref={audioRef}
        src={blobUrl}
        controls
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime || 0)}
        style={{ width: '100%' }}
      />
    </div>
  );
}

export function PhoneCallTranscriptPanel({
  metadata,
  onEnsureLoaded,
  loading,
  fetchImpl = fetch,
  onClose
}: {
  metadata: CallMediaMetadata;
  onEnsureLoaded?: () => void;
  loading?: boolean;
  fetchImpl?: typeof fetch;
  onClose?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [fetchedTurns, setFetchedTurns] = useState<CallMediaMetadata['transcript'] | null>(null);
  const [fetchingTranscript, setFetchingTranscript] = useState(false);

  useEffect(() => {
    if (onEnsureLoaded) onEnsureLoaded();
  }, [onEnsureLoaded]);

  useEffect(() => {
    const hasAgentTurn = metadata.transcript.some(t => t.speaker === 'thaara');
    if (hasAgentTurn || !metadata.callId) return;
    let cancelled = false;
    const controller = new AbortController();
    setFetchingTranscript(true);
    void (async () => {
      try {
        const res = await fetchImpl(
          `/api/v1/connectors/phone/transcripts/${encodeURIComponent(metadata.direction)}/${encodeURIComponent(metadata.callId)}`,
          { method: 'GET', credentials: 'include', signal: controller.signal }
        );
        if (!res.ok) return;
        const data = (await res.json()) as { transcript?: CallMediaMetadata['transcript'] };
        if (!cancelled && Array.isArray(data.transcript) && data.transcript.length > 0) {
          setFetchedTurns(data.transcript);
        }
      } catch {
        // Keep existing stored customer utterances cleanly without fabricating dialogue
      } finally {
        if (!cancelled) setFetchingTranscript(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [metadata.callId, metadata.direction, metadata.transcript, fetchImpl]);

  const effectiveTranscript = fetchedTurns && fetchedTurns.length > 0 ? fetchedTurns : metadata.transcript;
  const effectiveMetadata: CallMediaMetadata = { ...metadata, transcript: effectiveTranscript };

  const copyAll = async () => {
    const plain = formatPlainTextCallExport(effectiveMetadata);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(plain);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const formattedDuration = formatCallDuration(metadata.durationSeconds);

  return (
    <div
      className="phone-history-details"
      data-testid="phone-transcript-view"
      style={{ marginTop: '8px', userSelect: 'text' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <div data-testid="phone-transcript-header" style={{ flex: '1 1 260px' }}>
          {metadata.customerName && <p style={{ margin: '2px 0' }}><strong>Customer:</strong> {metadata.customerName}</p>}
          {metadata.phoneNumber && <p style={{ margin: '2px 0' }}><strong>Phone:</strong> {metadata.phoneNumber}</p>}
          {metadata.business && <p style={{ margin: '2px 0' }}><strong>Business:</strong> {metadata.business}</p>}
          {metadata.interestedService && <p style={{ margin: '2px 0' }}><strong>Interested service:</strong> {metadata.interestedService}</p>}
          {metadata.requirements && <p style={{ margin: '2px 0' }}><strong>Requirements:</strong> {metadata.requirements}</p>}
          {metadata.preferredCallbackTime && <p style={{ margin: '2px 0' }}><strong>Preferred callback:</strong> {metadata.preferredCallbackTime}</p>}
          {metadata.callDate && <p style={{ margin: '2px 0' }}><strong>Call date:</strong> {metadata.callDate}</p>}
          {formattedDuration && <p style={{ margin: '2px 0' }}><strong>Duration:</strong> {formattedDuration}</p>}
          {metadata.outcome && <p style={{ margin: '2px 0' }}><strong>Outcome:</strong> {metadata.outcome}</p>}
          {metadata.callbackStatus && <p style={{ margin: '2px 0' }}><strong>Callback status:</strong> {metadata.callbackStatus}</p>}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void copyAll()}
            data-testid="phone-transcript-copy-all"
          >
            {copied ? 'Copied' : 'Copy All'}
          </button>
          {onClose && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              data-testid="phone-transcript-close"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {loading || (fetchingTranscript && effectiveTranscript.length === 0) ? (
        <p className="integration-muted">Loading complete transcript…</p>
      ) : effectiveTranscript.length > 0 ? (
        <div
          data-testid="phone-transcript-lines"
          style={{
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid rgba(148, 163, 184, 0.28)',
            background: 'rgba(248, 250, 252, 0.7)',
            whiteSpace: 'pre-wrap',
            userSelect: 'text',
            lineHeight: 1.55
          }}
        >
          {!effectiveTranscript.some(t => t.speaker === 'thaara') && (
            <p className="integration-muted" style={{ margin: '0 0 6px', fontSize: '0.82rem' }}>
              Full transcript unavailable (showing available customer utterances).
            </p>
          )}
          {effectiveTranscript.map((turn, idx) => (
            <p key={idx} style={{ margin: '4px 0' }}>
              <strong>{turn.speaker === 'thaara' ? 'Thaara' : 'Customer'}:</strong> {turn.text}
            </p>
          ))}
        </div>
      ) : (
        <p className="integration-muted" data-testid="phone-transcript-empty">
          Full transcript unavailable.
        </p>
      )}
    </div>
  );
}
