import React from 'react';

export interface ChatAttachmentItem {
  localId: string;
  file: File;
  name: string;
  size: number;
  mimeType: string;
  previewUrl?: string;
  status: 'pending' | 'uploading' | 'ready' | 'error';
  serverId?: string;
  error?: string;
}

export interface ChatAttachmentPreviewProps {
  attachments: ChatAttachmentItem[];
  onRemove: (localId: string) => void;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string, filename: string): string {
  if (mimeType.startsWith('image/')) return '📷';
  if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) return '📄';
  if (filename.endsWith('.csv') || filename.endsWith('.xlsx')) return '📊';
  if (filename.endsWith('.docx') || filename.endsWith('.doc')) return '📝';
  return '📁';
}

export function ChatAttachmentPreview({
  attachments,
  onRemove,
  disabled = false
}: ChatAttachmentPreviewProps): React.JSX.Element | null {
  if (attachments.length === 0) return null;

  return (
    <div
      className="chat-attachment-tray"
      data-testid="chat-attachment-tray"
      aria-label="Attached files preview"
    >
      <div className="chat-attachment-chips">
        {attachments.map((item) => {
          const isImage = item.mimeType.startsWith('image/') && item.previewUrl;
          return (
            <div
              key={item.localId}
              className={`chat-attachment-chip chat-attachment-chip-${item.status}`}
              data-testid={`attachment-chip-${item.localId}`}
            >
              {isImage ? (
                <img
                  src={item.previewUrl}
                  alt={item.name}
                  className="chat-attachment-thumb"
                />
              ) : (
                <span className="chat-attachment-icon-badge" aria-hidden="true">
                  {getFileIcon(item.mimeType, item.name)}
                </span>
              )}

              <div className="chat-attachment-chip-info">
                <span className="chat-attachment-chip-name" title={item.name}>
                  {item.name}
                </span>
                <span className="chat-attachment-chip-size">
                  {formatBytes(item.size)}
                  {item.status === 'uploading' && ' • Uploading...'}
                  {item.status === 'ready' && ' • Ready'}
                  {item.status === 'error' && (
                    <span className="chat-attachment-chip-err">
                      {' '}• {item.error || 'Failed'}
                    </span>
                  )}
                </span>
              </div>

              <button
                type="button"
                className="chat-attachment-remove-btn"
                onClick={() => onRemove(item.localId)}
                disabled={disabled}
                aria-label={`Remove ${item.name}`}
                title="Remove attachment"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
