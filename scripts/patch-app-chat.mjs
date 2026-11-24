import fs from 'node:fs';

const filePath = 'apps/web/src/App.tsx';
let content = fs.readFileSync(filePath, 'utf8');
const isCrlf = content.includes('\r\n');
let normalized = content.replace(/\r\n/g, '\n');

// 1. Update imports
const importTarget = `  streamConversationMessage,
} from './api';`;

const importReplacement = `  streamConversationMessage,
  uploadConversationAttachment,
} from './api';
import { ChatAttachmentMenu } from './ChatAttachmentMenu';
import { ChatAttachmentPreview, ChatAttachmentItem } from './ChatAttachmentPreview';`;

if (!normalized.includes(importTarget)) {
  console.error('Import target not found!');
  process.exit(1);
}
normalized = normalized.replace(importTarget, importReplacement);

// 2. Add state & auto-scroll handlers
const stateTarget = `  const [streamingContent, setStreamingContent] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);`;

const stateReplacement = `  const [streamingContent, setStreamingContent] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  // Chat Attachments & Auto-Scroll UI State
  const [chatAttachments, setChatAttachments] = useState<ChatAttachmentItem[]>([]);
  const [isAttachmentMenuOpen, setIsAttachmentMenuOpen] = useState(false);
  const chatStreamRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUp = useRef<boolean>(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [hasNewTokensWhileScrolled, setHasNewTokensWhileScrolled] = useState(false);

  const scrollToBottom = (smooth = true) => {
    const el = chatStreamRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
    setShowJumpToLatest(false);
    setHasNewTokensWhileScrolled(false);
    isUserScrolledUp.current = false;
  };

  const handleStreamScroll = () => {
    const el = chatStreamRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
    if (isNearBottom) {
      isUserScrolledUp.current = false;
      setShowJumpToLatest(false);
      setHasNewTokensWhileScrolled(false);
    } else {
      isUserScrolledUp.current = true;
      setShowJumpToLatest(true);
    }
  };

  const handleFilesSelected = (files: File[]) => {
    if (!selectedConversationId) return;

    setChatAttachments((prev) => {
      const remainingSlots = Math.max(0, 5 - prev.length);
      const toAdd = files.slice(0, remainingSlots);
      if (files.length > remainingSlots) {
        setChatError(\`Maximum 5 attachments allowed. Only first \${remainingSlots} were added.\`);
      }

      const newItems: ChatAttachmentItem[] = toAdd.map((file) => {
        const localId = \`local-\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}\`;
        const isTooLarge = file.size > 10 * 1024 * 1024;
        const isImage = file.type.startsWith('image/');
        const previewUrl = isImage ? URL.createObjectURL(file) : undefined;

        return {
          localId,
          file,
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          previewUrl,
          status: isTooLarge ? 'error' : 'uploading',
          error: isTooLarge ? 'File exceeds 10MB limit' : undefined,
        };
      });

      for (const item of newItems) {
        if (item.status === 'uploading') {
          uploadConversationAttachment(selectedConversationId, item.file)
            .then((res) => {
              setChatAttachments((current) =>
                current.map((curr) =>
                  curr.localId === item.localId
                    ? { ...curr, status: 'ready', serverId: res.id }
                    : curr,
                ),
              );
            })
            .catch((err) => {
              setChatAttachments((current) =>
                current.map((curr) =>
                  curr.localId === item.localId
                    ? { ...curr, status: 'error', error: (err as Error).message || 'Upload failed' }
                    : curr,
                ),
              );
            });
        }
      }

      return [...prev, ...newItems];
    });
  };

  const handleRemoveAttachment = (localId: string) => {
    setChatAttachments((prev) => {
      const target = prev.find((a) => a.localId === localId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((a) => a.localId !== localId);
    });
  };`;

if (!normalized.includes(stateTarget)) {
  console.error('State target not found!');
  process.exit(1);
}
normalized = normalized.replace(stateTarget, stateReplacement);

// 3. Update handleSendMessage
const sendTarget = `  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedConversationId) return;
    const content = messageInput.trim();
    if (!content) return;

    const generation = authGenerationRef.current;
    const identityKey = authIdentityKeyRef.current;
    if (!isCurrentAuthSession(generation, identityKey)) {
      return;
    }

    setChatError(null);
    setMessageInput('');
    setStreamingContent('');
    setActiveStreamId(null);
    setStreamState('connecting');
    setStreamStatusMessage('Initiating governed executive stream...');

    const idempotencyKey =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : \`msg-\${Date.now()}-\${Math.random().toString(36).slice(2, 10)}\`;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await streamConversationMessage(
        selectedConversationId,
        content,
        idempotencyKey,
        {
          onContextReady: (data) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setActiveStreamId(data.stream_id);
            setStreamState('queued');
            setStreamStatusMessage(
              \`Context ready (Stream ID: \${data.stream_id.slice(0, 8)}...) — status: \${data.status}\`,
            );
            void loadMessages(selectedConversationId);
          },
          onStatus: (data) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamState(data.status);
            if (data.status === 'not_configured') {
              const code = data.error_code || data.error || 'MODEL_GATEWAY_NOT_CONFIGURED';
              const detail = data.message || 'Executive model provider is not configured.';
              setStreamStatusMessage(\`\${detail} (\${code})\`);
            } else if (data.status === 'streaming') {
              setStreamStatusMessage('Streaming response from model gateway...');
            } else if (data.status === 'failed') {
              const code = data.error_code || data.error || 'STREAM_FAILED';
              setStreamStatusMessage(data.message || \`Stream failed (\${code})\`);
            }
          },
          onToken: (delta) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamingContent((prev) => prev + delta);
          },
          onDone: () => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamState('completed');
            setStreamStatusMessage('Assistant stream completed.');
            setStreamingContent('');
          },`;

const sendReplacement = `  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedConversationId) return;
    const content = messageInput.trim();
    if (!content && chatAttachments.length === 0) return;

    if (chatAttachments.some((a) => a.status === 'uploading')) {
      setChatError('Please wait for all attachments to finish uploading.');
      return;
    }

    const generation = authGenerationRef.current;
    const identityKey = authIdentityKeyRef.current;
    if (!isCurrentAuthSession(generation, identityKey)) {
      return;
    }

    const readyAttachmentIds = chatAttachments
      .filter((a) => a.status === 'ready' && a.serverId)
      .map((a) => a.serverId!);

    setChatError(null);
    setMessageInput('');
    setStreamingContent('');
    setActiveStreamId(null);
    setStreamState('connecting');
    setStreamStatusMessage('Initiating governed executive stream...');
    setChatAttachments([]);

    setTimeout(() => scrollToBottom(true), 50);

    const idempotencyKey =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : \`msg-\${Date.now()}-\${Math.random().toString(36).slice(2, 10)}\`;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await streamConversationMessage(
        selectedConversationId,
        content || '(Attached documents provided for review)',
        idempotencyKey,
        {
          onContextReady: (data) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setActiveStreamId(data.stream_id);
            setStreamState('queued');
            setStreamStatusMessage(
              \`Context ready (Stream ID: \${data.stream_id.slice(0, 8)}...) — status: \${data.status}\`,
            );
            void loadMessages(selectedConversationId);
            scrollToBottom(false);
          },
          onStatus: (data) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamState(data.status);
            if (data.status === 'not_configured') {
              const code = data.error_code || data.error || 'MODEL_GATEWAY_NOT_CONFIGURED';
              const detail = data.message || 'Executive model provider is not configured.';
              setStreamStatusMessage(\`\${detail} (\${code})\`);
            } else if (data.status === 'streaming') {
              setStreamStatusMessage('Streaming response from model gateway...');
            } else if (data.status === 'failed') {
              const code = data.error_code || data.error || 'STREAM_FAILED';
              setStreamStatusMessage(data.message || \`Stream failed (\${code})\`);
            }
          },
          onToken: (delta) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamingContent((prev) => prev + delta);
            if (!isUserScrolledUp.current) {
              scrollToBottom(false);
            } else {
              setHasNewTokensWhileScrolled(true);
            }
          },
          onDone: () => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamState('completed');
            setStreamStatusMessage('Assistant stream completed.');
            setStreamingContent('');
            if (!isUserScrolledUp.current) {
              scrollToBottom(true);
            }
          },`;

if (!normalized.includes(sendTarget)) {
  console.error('Send target not found!');
  process.exit(1);
}
normalized = normalized.replace(sendTarget, sendReplacement);

// 4. Update streamConversationMessage call signature in handleSendMessage
const callTarget = `      await streamConversationMessage(
        selectedConversationId,
        content || '(Attached documents provided for review)',
        idempotencyKey,
        {
          onContextReady: (data) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setActiveStreamId(data.stream_id);
            setStreamState('queued');
            setStreamStatusMessage(
              \`Context ready (Stream ID: \${data.stream_id.slice(0, 8)}...) — status: \${data.status}\`,
            );
            void loadMessages(selectedConversationId);
            scrollToBottom(false);
          },
          onStatus: (data) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamState(data.status);
            if (data.status === 'not_configured') {
              const code = data.error_code || data.error || 'MODEL_GATEWAY_NOT_CONFIGURED';
              const detail = data.message || 'Executive model provider is not configured.';
              setStreamStatusMessage(\`\${detail} (\${code})\`);
            } else if (data.status === 'streaming') {
              setStreamStatusMessage('Streaming response from model gateway...');
            } else if (data.status === 'failed') {
              const code = data.error_code || data.error || 'STREAM_FAILED';
              setStreamStatusMessage(data.message || \`Stream failed (\${code})\`);
            }
          },
          onToken: (delta) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamingContent((prev) => prev + delta);
            if (!isUserScrolledUp.current) {
              scrollToBottom(false);
            } else {
              setHasNewTokensWhileScrolled(true);
            }
          },
          onDone: () => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamState('completed');
            setStreamStatusMessage('Assistant stream completed.');
            setStreamingContent('');
            if (!isUserScrolledUp.current) {
              scrollToBottom(true);
            }
          },
          onError: (errCode) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamState('failed');
            setStreamStatusMessage(\`Stream error: \${errCode}\`);
          },
        },
        controller.signal,
      );`;

const callReplacement = `      await streamConversationMessage(
        selectedConversationId,
        content || '(Attached documents provided for review)',
        idempotencyKey,
        {
          onContextReady: (data) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setActiveStreamId(data.stream_id);
            setStreamState('queued');
            setStreamStatusMessage(
              \`Context ready (Stream ID: \${data.stream_id.slice(0, 8)}...) — status: \${data.status}\`,
            );
            void loadMessages(selectedConversationId);
            scrollToBottom(false);
          },
          onStatus: (data) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamState(data.status);
            if (data.status === 'not_configured') {
              const code = data.error_code || data.error || 'MODEL_GATEWAY_NOT_CONFIGURED';
              const detail = data.message || 'Executive model provider is not configured.';
              setStreamStatusMessage(\`\${detail} (\${code})\`);
            } else if (data.status === 'streaming') {
              setStreamStatusMessage('Streaming response from model gateway...');
            } else if (data.status === 'failed') {
              const code = data.error_code || data.error || 'STREAM_FAILED';
              setStreamStatusMessage(data.message || \`Stream failed (\${code})\`);
            }
          },
          onToken: (delta) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamingContent((prev) => prev + delta);
            if (!isUserScrolledUp.current) {
              scrollToBottom(false);
            } else {
              setHasNewTokensWhileScrolled(true);
            }
          },
          onDone: () => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamState('completed');
            setStreamStatusMessage('Assistant stream completed.');
            setStreamingContent('');
            if (!isUserScrolledUp.current) {
              scrollToBottom(true);
            }
          },
          onError: (errCode) => {
            if (!isCurrentAuthSession(generation, identityKey, controller.signal)) return;
            setStreamState('failed');
            setStreamStatusMessage(\`Stream error: \${errCode}\`);
          },
        },
        controller.signal,
        readyAttachmentIds.length > 0 ? readyAttachmentIds : undefined,
      );`;

if (!normalized.includes(callTarget)) {
  console.error('Call target not found!');
  process.exit(1);
}
normalized = normalized.replace(callTarget, callReplacement);

// 5. Update JSX for chat stream and composer
const streamStartTarget = `<div className="chat-message-stream" data-testid="chat-message-stream">`;
const streamStartReplacement = `<div className="chat-stream-wrapper">
                      <div
                        className="chat-message-stream"
                        data-testid="chat-message-stream"
                        ref={chatStreamRef}
                        onScroll={handleStreamScroll}
                      >`;

if (!normalized.includes(streamStartTarget)) {
  console.error('Stream start target not found!');
  process.exit(1);
}
normalized = normalized.replace(streamStartTarget, streamStartReplacement);

const composerTarget = `                    </div>

                    <form
                      onSubmit={handleSendMessage}
                      style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}
                      data-testid="chat-composer-form"
                    >
                      <input
                        type="text"
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        placeholder="Ask Thaara for an executive briefing or offline workflow..."
                        aria-label="Message for Thaara"
                        disabled={
                          streamState === 'connecting' ||
                          streamState === 'queued' ||
                          streamState === 'streaming'
                        }
                        required
                        style={{
                          flex: 1,
                          background: 'var(--card-bg)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.75rem 0.95rem',
                          color: 'var(--text-primary)',
                          fontSize: '0.92rem',
                        }}
                      />
                      <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ padding: '0.75rem 1.25rem' }}
                        disabled={
                          !messageInput.trim() ||
                          streamState === 'connecting' ||
                          streamState === 'queued' ||
                          streamState === 'streaming'
                        }
                      >
                        Send
                      </button>
                    </form>`;

const composerReplacement = `                    </div>
                      {showJumpToLatest && (
                        <button
                          type="button"
                          className="chat-jump-to-latest-btn"
                          onClick={() => scrollToBottom(true)}
                          data-testid="chat-jump-to-latest-btn"
                          aria-label="Jump to latest messages"
                        >
                          <span>↓ Jump to latest</span>
                          {hasNewTokensWhileScrolled && (
                            <span className="chat-jump-badge">New</span>
                          )}
                        </button>
                      )}
                    </div>

                    <ChatAttachmentPreview
                      attachments={chatAttachments}
                      onRemove={handleRemoveAttachment}
                      disabled={
                        streamState === 'connecting' ||
                        streamState === 'queued' ||
                        streamState === 'streaming'
                      }
                    />

                    <form
                      onSubmit={handleSendMessage}
                      style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', position: 'relative' }}
                      data-testid="chat-composer-form"
                    >
                      <div style={{ position: 'relative' }}>
                        <button
                          type="button"
                          className="chat-attachment-toggle-btn"
                          onClick={() => setIsAttachmentMenuOpen((prev) => !prev)}
                          disabled={
                            streamState === 'connecting' ||
                            streamState === 'queued' ||
                            streamState === 'streaming'
                          }
                          aria-label="Add attachment"
                          title="Add photos or documents"
                          aria-haspopup="menu"
                          aria-expanded={isAttachmentMenuOpen}
                          data-testid="chat-attachment-toggle-btn"
                        >
                          +
                        </button>

                        <ChatAttachmentMenu
                          isOpen={isAttachmentMenuOpen}
                          onClose={() => setIsAttachmentMenuOpen(false)}
                          onFilesSelected={handleFilesSelected}
                          disabled={
                            streamState === 'connecting' ||
                            streamState === 'queued' ||
                            streamState === 'streaming'
                          }
                          currentCount={chatAttachments.length}
                          maxCount={5}
                        />
                      </div>

                      <input
                        type="text"
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        placeholder={
                          chatAttachments.length > 0
                            ? "Add optional instructions for attached file(s)..."
                            : "Ask Thaara for an executive briefing or offline workflow..."
                        }
                        aria-label="Message for Thaara"
                        disabled={
                          streamState === 'connecting' ||
                          streamState === 'queued' ||
                          streamState === 'streaming'
                        }
                        required={chatAttachments.length === 0}
                        style={{
                          flex: 1,
                          background: 'var(--card-bg)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '0.75rem 0.95rem',
                          color: 'var(--text-primary)',
                          fontSize: '0.92rem',
                        }}
                      />
                      <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ padding: '0.75rem 1.25rem' }}
                        disabled={
                          (!messageInput.trim() && chatAttachments.length === 0) ||
                          chatAttachments.some((a) => a.status === 'uploading') ||
                          streamState === 'connecting' ||
                          streamState === 'queued' ||
                          streamState === 'streaming'
                        }
                      >
                        {chatAttachments.some((a) => a.status === 'uploading') ? 'Uploading...' : 'Send'}
                      </button>
                    </form>`;

if (!normalized.includes(composerTarget)) {
  console.error('Composer target not found!');
  process.exit(1);
}
normalized = normalized.replace(composerTarget, composerReplacement);

fs.writeFileSync(filePath, isCrlf ? normalized.replace(/\n/g, '\r\n') : normalized, 'utf8');
console.log('Successfully patched apps/web/src/App.tsx');
