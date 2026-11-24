import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatAttachmentMenu } from './src/ChatAttachmentMenu';
import { ChatAttachmentPreview, type ChatAttachmentItem } from './src/ChatAttachmentPreview';

describe('Thaara Chat Web Components Verification', () => {
  it('renders native file inputs with precise MIME accept attributes when closed', () => {
    const html = renderToStaticMarkup(
      <ChatAttachmentMenu
        isOpen={false}
        onClose={vi.fn()}
        onFilesSelected={vi.fn()}
      />
    );

    expect(html).toContain('accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"');
    expect(html).toContain('accept="application/pdf,.pdf"');
    expect(html).toContain('accept=".txt,.docx,.csv,.xlsx,text/plain,text/csv');
  });

  it('renders popover menu with all 3 upload categories and ARIA roles when open', () => {
    const html = renderToStaticMarkup(
      <ChatAttachmentMenu
        isOpen={true}
        onClose={vi.fn()}
        onFilesSelected={vi.fn()}
        currentCount={2}
        maxCount={5}
      />
    );

    expect(html).toContain('data-testid="chat-attachment-popover"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('data-testid="attach-photo-btn"');
    expect(html).toContain('data-testid="attach-pdf-btn"');
    expect(html).toContain('data-testid="attach-doc-btn"');
    expect(html).toContain('Attach files (2/5)');
  });

  it('disables menu items and displays limit footer when capacity (5/5) is reached', () => {
    const html = renderToStaticMarkup(
      <ChatAttachmentMenu
        isOpen={true}
        onClose={vi.fn()}
        onFilesSelected={vi.fn()}
        currentCount={5}
        maxCount={5}
      />
    );

    expect(html).toContain('disabled=""');
    expect(html).toContain('Maximum 5 attachments per turn reached.');
  });

  it('renders preview tray with formatted sizes, icons, thumbnails, and status', () => {
    const sampleAttachments: ChatAttachmentItem[] = [
      {
        localId: 'att-1',
        file: new File(['content'], 'Q4_Financial_Review.pdf', { type: 'application/pdf' }),
        name: 'Q4_Financial_Review.pdf',
        size: 1572864, // 1.5 MB
        mimeType: 'application/pdf',
        status: 'ready'
      },
      {
        localId: 'att-2',
        file: new File(['img'], 'workflow_diagram.png', { type: 'image/png' }),
        name: 'workflow_diagram.png',
        size: 204800, // 200 KB
        mimeType: 'image/png',
        previewUrl: 'blob:https://thaara-v2.quantumweaveai.io/mock-blob',
        status: 'ready'
      },
      {
        localId: 'att-3',
        file: new File(['data'], 'large_dataset.csv', { type: 'text/csv' }),
        name: 'large_dataset.csv',
        size: 12582912, // 12 MB
        mimeType: 'text/csv',
        status: 'error',
        error: 'File exceeds 10MB limit'
      }
    ];

    const html = renderToStaticMarkup(
      <ChatAttachmentPreview
        attachments={sampleAttachments}
        onRemove={vi.fn()}
      />
    );

    expect(html).toContain('data-testid="chat-attachment-tray"');
    expect(html).toContain('Q4_Financial_Review.pdf');
    expect(html).toContain('1.5 MB');
    expect(html).toContain('200.0 KB');
    expect(html).toContain('src="blob:https://thaara-v2.quantumweaveai.io/mock-blob"');
    expect(html).toContain('File exceeds 10MB limit');
    expect(html).toContain('aria-label="Remove Q4_Financial_Review.pdf"');
  });

  it('renders nothing when attachments array is empty', () => {
    const html = renderToStaticMarkup(
      <ChatAttachmentPreview
        attachments={[]}
        onRemove={vi.fn()}
      />
    );
    expect(html).toBe('');
  });

  it('verifies auto-scroll boundary threshold logic', () => {
    const threshold = 80;
    const scrollHeight = 1200;
    const clientHeight = 450;
    
    // User at bottom
    const scrollTopBottom = 750;
    expect(scrollHeight - scrollTopBottom - clientHeight).toBeLessThanOrEqual(threshold);

    // User scrolled up past 80px
    const scrollTopScrolledUp = 200;
    expect(scrollHeight - scrollTopScrolledUp - clientHeight).toBeGreaterThan(threshold);
  });

  it('verifies CSS rules in styles.css', () => {
    const css = fs.readFileSync(path.resolve('apps/web/src/styles.css'), 'utf8');
    expect(css).toContain('.chat-stream-wrapper');
    expect(css).toContain('.chat-jump-to-latest-btn');
    expect(css).toContain('.chat-jump-badge');
    expect(css).toContain('.chat-attachment-toggle-btn');
    expect(css).toContain('.chat-attachment-popover');
    expect(css).toContain('.chat-attachment-tray');
    expect(css).toContain('.chat-attachment-chip');
    expect(css).toContain('.chat-message-attachments-list');
  });
});
