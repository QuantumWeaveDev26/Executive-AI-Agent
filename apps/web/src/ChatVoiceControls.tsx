import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, ApprovalRequestItem, request } from './api';
import {
  ChatVoiceController,
  type VoiceLanguage,
  type VoiceState,
} from './chat-voice-controller';
import {
  VoiceSession,
  type DetectedVoiceLanguage,
  type SessionState,
} from './chat-voice-session';
import { startVoiceCapture, type VoiceCaptureHandle } from './chat-voice-capture';
import { toVoiceWave } from './chat-voice-wave';
import { ThaaraBrandMark } from './ui-primitives';

export function VoiceWaveformIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="10" x2="4" y2="14" />
      <line x1="8" y1="7" x2="8" y2="17" />
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="16" y1="7" x2="16" y2="17" />
      <line x1="20" y1="10" x2="20" y2="14" />
    </svg>
  );
}

export interface ThaaraVoiceModeButtonProps {
  disabled?: boolean;
  configured: boolean;
  onOpen: () => void;
}

export function ThaaraVoiceModeButton({
  disabled = false,
  configured,
  onOpen,
}: ThaaraVoiceModeButtonProps) {
  return (
    <button
      type="button"
      className="chat-voice-mode-btn"
      onClick={onOpen}
      disabled={disabled || !configured}
      aria-label="Start voice mode"
      title={configured ? 'Start voice mode' : 'Voice mode unavailable'}
      data-testid="chat-voice-mode-btn"
    >
      <VoiceWaveformIcon size={19} />
    </button>
  );
}

export interface ThaaraVoiceScreenProps {
  conversationId: string;
  streamingText?: string;
  latestAssistantText?: string;
  pendingApproval?: {
    approval: ApprovalRequestItem;
    planId: string | null;
    canDecide: boolean;
    deciding: boolean;
  } | null;
  onDecideApproval?: (
    planId: string | null,
    approvalId: string,
    decision: 'approved' | 'rejected',
  ) => void;
  onVoiceCommand: (text: string, signal: AbortSignal) => Promise<string | undefined>;
  onClose: () => void;
  context: { signal: AbortSignal; isCurrent: () => boolean };
}

function isRetryableVoiceError(err: unknown): boolean {
  if (err instanceof ApiRequestError) {
    return err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504;
  }
  return err instanceof TypeError;
}

async function withVoiceRetry<T>(
  signal: AbortSignal,
  isCurrent: () => boolean,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (signal.aborted || !isCurrent() || !isRetryableVoiceError(err)) {
      throw err;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 350);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
    if (signal.aborted || !isCurrent()) {
      throw Error('Cancelled');
    }
    return operation();
  }
}

export function ThaaraVoiceScreen({
  conversationId,
  streamingText,
  latestAssistantText,
  pendingApproval,
  onDecideApproval,
  onVoiceCommand,
  onClose,
  context,
}: ThaaraVoiceScreenProps) {
  const [state, setState] = useState<VoiceState | SessionState>('requesting');
  const [errorHint, setErrorHint] = useState<string>('');
  const [muted, setMuted] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [lastSpokenUserText, setLastSpokenUserText] = useState('');
  const [hasSessionReply, setHasSessionReply] = useState(false);

  const commandRef = useRef(onVoiceCommand);
  commandRef.current = onVoiceCommand;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const contextRef = useRef(context);
  contextRef.current = context;
  const latestAssistantRef = useRef<string | undefined>(latestAssistantText);
  latestAssistantRef.current = latestAssistantText || streamingText;

  const stableContext = useMemo(
    () => ({
      signal: context.signal,
      isCurrent: () => contextRef.current.isCurrent(),
    }),
    [conversationId, context.signal],
  );

  const captureHandleRef = useRef<VoiceCaptureHandle | undefined>();
  const captureAbortRef = useRef<AbortController | undefined>();
  const sessionRef = useRef<VoiceSession | undefined>();
  const activityRef = useRef<VoiceState | SessionState>('requesting');
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>();
  const lastSpeakEndedAtRef = useRef(0);

  const transcribe = useMemo(
    () =>
      async (
        blob: Blob,
        language: VoiceLanguage,
        signal: AbortSignal,
      ): Promise<{ transcript: string; detectedLanguage?: DetectedVoiceLanguage }> => {
        const wave = blob.type === 'audio/wav' ? blob : await toVoiceWave(blob);
        if (signal.aborted || !stableContext.isCurrent()) throw Error('Cancelled');
        const bytes = new Uint8Array(await wave.arrayBuffer());
        let audio = '';
        for (let i = 0; i < bytes.length; i += 32768) {
          audio += String.fromCharCode(...bytes.subarray(i, i + 32768));
        }
        const encoded = btoa(audio);
        return withVoiceRetry(signal, () => stableContext.isCurrent(), () =>
          request<{ transcript: string; detectedLanguage?: DetectedVoiceLanguage }>(
            '/api/v1/chat/voice/transcribe',
            {
              method: 'POST',
              signal,
              body: JSON.stringify({
                conversationId,
                language,
                mimeType: 'audio/wav',
                audio: encoded,
              }),
            },
          ),
        );
      },
    [conversationId, stableContext],
  );

  const controller = useMemo(
    () =>
      new ChatVoiceController({
        context: stableContext,
        onState: () => {},
        onTranscript: () => {},
        onOutputLevel: (rms) => {
          if (activityRef.current === 'speaking') {
            setAudioLevel(Math.min(1, rms * 4.5));
          }
        },
        onPlaybackTelemetry: (telemetry) => {
          if (typeof window !== 'undefined') {
            const win = window as unknown as { __thaaraVoicePlaybacks?: unknown[] };
            if (!Array.isArray(win.__thaaraVoicePlaybacks)) win.__thaaraVoicePlaybacks = [];
            win.__thaaraVoicePlaybacks.push(telemetry);
            if (win.__thaaraVoicePlaybacks.length > 25) win.__thaaraVoicePlaybacks.shift();
          }
        },
        transcribe: async (blob, language, signal) =>
          (await transcribe(blob, language, signal)).transcript,
        speak: (messageId, language, chunk, signal) =>
          withVoiceRetry(signal, () => stableContext.isCurrent(), () =>
            request('/api/v1/chat/voice/speak', {
              method: 'POST',
              signal,
              body: JSON.stringify({ conversationId, messageId, language, chunk }),
            }),
          ),
      }),
    [conversationId, stableContext, transcribe],
  );

  useEffect(() => {
    controller.unlockAudio();
    const abort = new AbortController();
    captureAbortRef.current = abort;
    let queue: Promise<unknown> = Promise.resolve();
    let fatalMicError = false;

    const session = new VoiceSession({
      interrupt: () => {
        controller.cancel('user_voice_barge_in');
        setAudioLevel(0);
      },
      transcribe: (wave, signal) => transcribe(wave, 'auto', signal),
      getAssistantText: () => latestAssistantRef.current,
      onTurnTranscript: (userText) => {
        setLastSpokenUserText(userText);
        setHasSessionReply(false);
        setErrorHint('');
      },
      submit: (text, signal) => {
        const job = queue
          .catch(() => undefined)
          .then(async () => {
            if (signal.aborted || !stableContext.isCurrent()) return undefined;
            const replyId = await commandRef.current(text, signal);
            if (replyId && !signal.aborted && stableContext.isCurrent()) {
              setHasSessionReply(true);
            }
            return replyId;
          });
        queue = job;
        return job;
      },
      speak: async (id) => {
        try {
          const ok = await controller.play(id, 'auto');
          if (!ok && !abort.signal.aborted && activityRef.current === 'speaking') {
            throw Error('Playback unavailable');
          }
        } finally {
          lastSpeakEndedAtRef.current = Date.now();
          setAudioLevel(0);
        }
      },
      state: (nextState, msg) => {
        if (abort.signal.aborted || !stableContext.isCurrent()) return;
        clearTimeout(recoveryTimerRef.current);
        activityRef.current = nextState;
        setState(nextState);
        if (nextState === 'error') {
          setErrorHint(msg || 'Could not process that turn. Listening again...');
          if (!fatalMicError) {
            recoveryTimerRef.current = setTimeout(() => {
              if (!abort.signal.aborted && stableContext.isCurrent() && activityRef.current === 'error') {
                activityRef.current = 'listening';
                setState('listening');
                setErrorHint('');
              }
            }, 2400);
          }
        } else if (nextState === 'listening') {
          setErrorHint('');
        }
      },
    });
    sessionRef.current = session;

    const scopeStop = () => {
      abort.abort();
      session.close();
    };
    stableContext.signal.addEventListener('abort', scopeStop, { once: true });

    void (async () => {
      const handle = await startVoiceCapture(
        abort.signal,
        () => session.beginSpeech(),
        (wave) => void session.finishSpeech(wave),
        (errMessage) => {
          if (abort.signal.aborted) return;
          if (errMessage.includes('shorter instruction')) {
            setErrorHint(errMessage);
            activityRef.current = 'listening';
            setState('listening');
            return;
          }
          fatalMicError = true;
          activityRef.current = 'error';
          setState('error');
          setErrorHint(errMessage);
        },
        () => controller.isAudioPlaying || Date.now() - lastSpeakEndedAtRef.current < 260,
        {
          onDiscard: () => session.discardSpeech(),
          isProcessing: () =>
            !controller.isAudioPlaying &&
            (activityRef.current === 'transcribing' ||
              activityRef.current === 'thinking' ||
              activityRef.current === 'speaking'),
          getOutputRms: () => controller.currentOutputRms,
          onVerifyInterruptClip: (wave) =>
            void session.interruptIfSpoken(
              wave,
              controller.isAudioPlaying || Date.now() - lastSpeakEndedAtRef.current < 500
                ? latestAssistantRef.current
                : undefined,
            ),
          onLevel: (rms) => {
            if (activityRef.current !== 'speaking') {
              setAudioLevel(Math.min(1, rms * 9));
            }
          },
        },
      );
      captureHandleRef.current = handle;
      if (!abort.signal.aborted && stableContext.isCurrent() && !fatalMicError) {
        activityRef.current = 'listening';
        setState('listening');
      }
    })();

    return () => {
      clearTimeout(recoveryTimerRef.current);
      stableContext.signal.removeEventListener('abort', scopeStop);
      abort.abort();
      captureHandleRef.current?.();
      session.close();
      controller.dispose();
    };
  }, [controller, stableContext, transcribe]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleMute = () => {
    controller.unlockAudio();
    const next = !muted;
    setMuted(next);
    captureHandleRef.current?.setMuted(next);
    if (next) {
      setAudioLevel(0);
    }
  };

  const handleEndVoice = () => {
    captureAbortRef.current?.abort();
    captureHandleRef.current?.();
    sessionRef.current?.close();
    controller.cancel();
    onClose();
  };

  const visualMode = muted
    ? 'muted'
    : state === 'speaking'
      ? 'speaking'
      : state === 'thinking' || state === 'transcribing'
        ? 'thinking'
        : state === 'error'
          ? 'error'
          : state === 'requesting'
            ? 'requesting'
            : 'listening';

  const statusLabel =
    visualMode === 'requesting'
      ? 'Allow microphone access'
      : visualMode === 'muted'
        ? 'Microphone muted'
        : visualMode === 'thinking'
          ? 'Thinking...'
          : visualMode === 'speaking'
            ? 'Thaara is speaking'
            : visualMode === 'error'
              ? errorHint || 'Microphone unavailable'
              : 'Listening...';

  const subHint =
    visualMode === 'speaking'
      ? 'Speak anytime to interrupt'
      : visualMode === 'muted'
        ? 'Tap microphone to unmute'
        : visualMode === 'listening'
          ? 'Speak naturally in English, Kannada, or Hindi'
          : '';

  const orbScale =
    visualMode === 'listening' || visualMode === 'speaking'
      ? 1 + Math.min(0.28, audioLevel * 0.28)
      : 1;

  const liveCaption =
    (streamingText && streamingText.trim()) ||
    ((visualMode === 'speaking' || (hasSessionReply && (visualMode === 'listening' || visualMode === 'error'))) &&
    latestAssistantText
      ? latestAssistantText.trim()
      : '') ||
    lastSpokenUserText;

  return (
    <div
      className="thaara-voice-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Thaara voice conversation"
      data-testid="thaara-voice-screen"
    >
      <header className="thaara-voice-header">
        <div className="thaara-voice-brand">
          <span className="thaara-voice-brand-icon">
            <ThaaraBrandMark size={20} />
          </span>
          <span className="thaara-voice-brand-name">Thaara</span>
        </div>
      </header>

      <main className="thaara-voice-stage">
        <div
          className={`thaara-voice-orb-wrap thaara-voice-orb-${visualMode}`}
          style={{ '--voice-orb-scale': orbScale.toFixed(3) } as React.CSSProperties}
        >
          <div className="thaara-voice-ring thaara-voice-ring-outer" aria-hidden="true" />
          <div className="thaara-voice-ring thaara-voice-ring-inner" aria-hidden="true" />
          <div className="thaara-voice-orb" data-testid="thaara-voice-orb">
            <div className="thaara-voice-orb-bars" aria-hidden="true">
              {[0.55, 0.85, 1, 0.85, 0.55].map((weight, idx) => {
                const barHeight =
                  visualMode === 'speaking' || visualMode === 'listening'
                    ? Math.round(14 + audioLevel * 38 * weight)
                    : visualMode === 'thinking'
                      ? 18
                      : 10;
                return (
                  <span
                    key={idx}
                    className="thaara-voice-orb-bar"
                    style={{ height: `${barHeight}px` }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <div className="thaara-voice-status-stack" aria-live="polite">
          <p className="thaara-voice-status-title" data-testid="thaara-voice-status">
            {statusLabel}
          </p>
          {subHint && <p className="thaara-voice-status-sub">{subHint}</p>}
        </div>

        {liveCaption && (
          <p className="thaara-voice-caption" data-testid="thaara-voice-caption">
            {liveCaption.length > 180 ? `${liveCaption.slice(0, 180).trim()}…` : liveCaption}
          </p>
        )}

        {pendingApproval && pendingApproval.approval.status === 'pending' && (
          <div className="thaara-voice-approval-pill" data-testid="thaara-voice-approval">
            <span className="thaara-voice-approval-label">
              Confirmation required: {pendingApproval.approval.actionName}
            </span>
            {pendingApproval.canDecide && onDecideApproval && (
              <div className="thaara-voice-approval-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pendingApproval.deciding}
                  onClick={() =>
                    onDecideApproval(
                      pendingApproval.planId,
                      pendingApproval.approval.id,
                      'approved',
                    )
                  }
                >
                  {pendingApproval.deciding ? 'Working…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={pendingApproval.deciding}
                  onClick={() =>
                    onDecideApproval(
                      pendingApproval.planId,
                      pendingApproval.approval.id,
                      'rejected',
                    )
                  }
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="thaara-voice-controls">
        <button
          type="button"
          className={`thaara-voice-ctrl-btn ${muted ? 'thaara-voice-ctrl-muted' : ''}`}
          onClick={toggleMute}
          aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
          aria-pressed={muted}
          title={muted ? 'Unmute microphone' : 'Mute microphone'}
          data-testid="thaara-voice-mute-btn"
        >
          {muted ? (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="2" y1="2" x2="22" y2="22" />
              <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
              <path d="M5 10v2a7 7 0 0 0 12 5" />
              <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          ) : (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="thaara-voice-ctrl-btn thaara-voice-ctrl-end"
          onClick={handleEndVoice}
          aria-label="End voice mode"
          title="End voice mode"
          data-testid="thaara-voice-end-btn"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </footer>
    </div>
  );
}

export async function fetchChatVoiceConfigured(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await request<{ configured: boolean }>('/api/v1/chat/voice/status', { signal });
    return Boolean(res.configured);
  } catch (err) {
    if (err instanceof ApiRequestError && (err.status === 401 || err.status === 403)) {
      return false;
    }
    return false;
  }
}
