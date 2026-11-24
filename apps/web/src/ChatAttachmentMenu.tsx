import React, { useRef, useEffect } from 'react';

export interface ChatAttachmentMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  currentCount?: number;
  maxCount?: number;
}

export function ChatAttachmentMenu({
  isOpen,
  onClose,
  onFilesSelected,
  disabled = false,
  currentCount = 0,
  maxCount = 5
}: ChatAttachmentMenuProps): React.JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      const files = Array.from(fileList);
      onFilesSelected(files);
      onClose();
    }
    // Reset value so same file can be selected again if needed
    e.target.value = '';
  };

  const isAtLimit = currentCount >= maxCount;

  if (!isOpen) {
    return (
      <div style={{ display: 'none' }} aria-hidden="true">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          multiple
          onChange={handleInputChange}
          tabIndex={-1}
        />
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={handleInputChange}
          tabIndex={-1}
        />
        <input
          ref={docInputRef}
          type="file"
          accept=".txt,.docx,.csv,.xlsx,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          onChange={handleInputChange}
          tabIndex={-1}
        />
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="chat-attachment-popover"
      role="menu"
      aria-label="Attachment options"
      data-testid="chat-attachment-popover"
    >
      <div style={{ display: 'none' }} aria-hidden="true">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          multiple
          onChange={handleInputChange}
          tabIndex={-1}
        />
        <input
          ref={pdfInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          onChange={handleInputChange}
          tabIndex={-1}
        />
        <input
          ref={docInputRef}
          type="file"
          accept=".txt,.docx,.csv,.xlsx,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          multiple
          onChange={handleInputChange}
          tabIndex={-1}
        />
      </div>

      <div className="chat-attachment-menu-header">
        <span>Attach files ({currentCount}/{maxCount})</span>
      </div>

      <button
        type="button"
        className="chat-attachment-menu-item"
        role="menuitem"
        disabled={disabled || isAtLimit}
        onClick={() => photoInputRef.current?.click()}
        data-testid="attach-photo-btn"
      >
        <span className="attachment-icon" aria-hidden="true">📷</span>
        <div className="attachment-meta">
          <span className="attachment-title">Photo</span>
          <span className="attachment-desc">JPG, PNG, WebP (up to 10MB)</span>
        </div>
      </button>

      <button
        type="button"
        className="chat-attachment-menu-item"
        role="menuitem"
        disabled={disabled || isAtLimit}
        onClick={() => pdfInputRef.current?.click()}
        data-testid="attach-pdf-btn"
      >
        <span className="attachment-icon" aria-hidden="true">📄</span>
        <div className="attachment-meta">
          <span className="attachment-title">PDF Document</span>
          <span className="attachment-desc">Standard PDF reports & invoices</span>
        </div>
      </button>

      <button
        type="button"
        className="chat-attachment-menu-item"
        role="menuitem"
        disabled={disabled || isAtLimit}
        onClick={() => docInputRef.current?.click()}
        data-testid="attach-doc-btn"
      >
        <span className="attachment-icon" aria-hidden="true">📁</span>
        <div className="attachment-meta">
          <span className="attachment-title">Document / File</span>
          <span className="attachment-desc">TXT, DOCX, CSV, XLSX</span>
        </div>
      </button>

      {isAtLimit && (
        <div className="chat-attachment-menu-footer">
          Maximum {maxCount} attachments per turn reached.
        </div>
      )}
    </div>
  );
}
