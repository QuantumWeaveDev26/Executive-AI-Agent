import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatRichText } from '../src/ChatRichText';
import { GoogleDriveScreen } from '../src/GoogleDriveScreen';
import {
  getPathForPage,
  isIntegrationPage,
  resolvePageFromLocation,
  shouldExpandIntegrations,
} from '../src/navigation';

describe('Google Drive Executive UI & Safe Chat Link Rendering', () => {
  it('routes /integrations/drive, /drive, and /google-drive as an Integration page', () => {
    expect(resolvePageFromLocation('/integrations/drive')).toBe('drive');
    expect(resolvePageFromLocation('/drive')).toBe('drive');
    expect(resolvePageFromLocation('/google-drive')).toBe('drive');
    expect(getPathForPage('drive')).toBe('/integrations/drive');
    expect(isIntegrationPage('drive')).toBe(true);
    expect(shouldExpandIntegrations('drive', false)).toBe(true);
  });

  it('renders GoogleDriveScreen for executive owner with truthful status, files, and governed controls', () => {
    const html = renderToStaticMarkup(
      <GoogleDriveScreen
        workspaceId="ws-exec-1"
        userId="user-owner-1"
        role="owner"
        initialStatus={{
          connectorName: 'google_drive',
          status: 'connected',
          configured: true,
          connected: true,
          mode: 'live',
          scopes: ['https://www.googleapis.com/auth/drive'],
          lastVerifiedAt: '2026-11-14T09:00:00.000Z',
          message: 'Google Drive connection verified via governed n8n workflow.',
        }}
        initialFiles={[
          {
            id: '1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU',
            name: 'Custom Teamwear Reports',
            mimeType: 'application/vnd.google-apps.document',
            webViewLink: 'https://drive.google.com/file/d/1iaTRO5jujSMaOOO61uV59E0XymEwFSCMi2HQWDIaaHU/view',
            modifiedTime: '2026-11-13T10:00:00.000Z',
          },
        ]}
      />
    );

    expect(html).toContain('Connected &amp; Verified');
    expect(html).toContain('Custom Teamwear Reports');
    expect(html).toContain('Open in Drive');
    expect(html).toContain('UNTRUSTED EXTERNAL DOCUMENT PREVIEW');
    expect(html).toContain('Governed File Sharing');
    expect(html).toContain('Governed Deletion');
  });

  it('blocks viewer role from Google Drive controls with explicit executive access message', () => {
    const html = renderToStaticMarkup(
      <GoogleDriveScreen
        workspaceId="ws-exec-1"
        userId="user-viewer-1"
        role="viewer"
      />
    );

    expect(html).toContain('Executive Owner or Admin Access Required');
    expect(html).not.toContain('drive-search-input');
    expect(html).not.toContain('Verify Connection');
  });

  it('renders clickable HTTPS Drive links in ChatRichText while neutralizing XSS and non-HTTPS schemes', () => {
    const html = renderToStaticMarkup(
      <ChatRichText
        text={
          'Found **Custom Teamwear Reports** (`1iaTRO5`) — [Open in Drive](https://drive.google.com/file/d/1iaTRO5/view) ' +
          'and [Bad Link](javascript:alert(1)) <script>alert("xss")</script>'
        }
      />
    );

    expect(html).toContain(
      'href="https://drive.google.com/file/d/1iaTRO5/view" target="_blank" rel="noopener noreferrer"'
    );
    expect(html).toContain('<strong>Custom Teamwear Reports</strong>');
    expect(html).toContain('<code');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
