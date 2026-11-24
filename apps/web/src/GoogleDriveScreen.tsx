import React, { useEffect, useState } from 'react';
import { ApiRequestError } from './api';
import {
  GoogleDriveFileItem,
  GoogleDriveStatusResponse,
  createGoogleDriveDoc,
  createGoogleDriveFolder,
  deleteGoogleDriveFile,
  getGoogleDriveStatus,
  readGoogleDriveFile,
  renameOrMoveGoogleDriveFile,
  searchGoogleDriveFiles,
  shareGoogleDriveFile,
  summarizeGoogleDriveFile,
  uploadGoogleDriveFile,
} from './drive-api';
import { formatFriendlyDateTime } from './integration-ui';
import { EmptyState, PageHeader, StatusIndicator } from './ui-primitives';

export interface GoogleDriveScreenProps {
  workspaceId: string;
  userId: string;
  role: string;
  initialStatus?: GoogleDriveStatusResponse | null;
  initialFiles?: GoogleDriveFileItem[];
}

function safeExternalDriveHref(file: GoogleDriveFileItem): string | null {
  const candidate =
    file.webViewLink ||
    (file.mimeType === 'application/vnd.google-apps.folder'
      ? `https://drive.google.com/drive/folders/${encodeURIComponent(file.id)}`
      : `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`);
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function formatMimeBadge(mimeType: string): string {
  if (mimeType === 'application/vnd.google-apps.folder') return 'Folder';
  if (mimeType === 'application/vnd.google-apps.document') return 'Google Doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'Google Sheet';
  if (mimeType === 'application/vnd.google-apps.presentation') return 'Slides';
  if (mimeType === 'application/pdf') return 'PDF';
  return mimeType.split('/').pop() || 'File';
}

export function GoogleDriveScreen({
  role,
  initialStatus = null,
  initialFiles = [],
}: GoogleDriveScreenProps): React.ReactElement {
  const isAuthorized = role === 'owner' || role === 'admin';

  const [status, setStatus] = useState<GoogleDriveStatusResponse | null>(initialStatus);
  const [files, setFiles] = useState<GoogleDriveFileItem[]>(initialFiles);
  const [selectedFile, setSelectedFile] = useState<GoogleDriveFileItem | null>(initialFiles[0] ?? null);
  const [inspectedText, setInspectedText] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ tone: 'info' | 'success' | 'danger'; text: string } | null>(null);

  // Create Folder / Doc / Upload state
  const [activeCreator, setActiveCreator] = useState<'none' | 'folder' | 'doc' | 'upload'>('none');
  const [folderName, setFolderName] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [uploadContent, setUploadContent] = useState('');

  // Governed Share, Move & Delete confirmation state
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<'reader' | 'commenter' | 'writer'>('reader');
  const [pendingShareToken, setPendingShareToken] = useState<{ fileId: string; token: string; email: string; role: 'reader' | 'commenter' | 'writer' } | null>(null);
  const [moveFolderId, setMoveFolderId] = useState('');
  const [pendingMoveToken, setPendingMoveToken] = useState<{ fileId: string; fileName: string; targetFolderId: string; token: string } | null>(null);
  const [pendingDeleteToken, setPendingDeleteToken] = useState<{ fileId: string; fileName: string; token: string } | null>(null);

  useEffect(() => {
    if (!isAuthorized || initialStatus) return;
    let active = true;
    void (async () => {
      try {
        const st = await getGoogleDriveStatus(false);
        if (active) setStatus(st);
      } catch (err) {
        if (active) {
          const msg = err instanceof ApiRequestError ? err.message : 'Unable to load Google Drive status.';
          setNotice({ tone: 'danger', text: msg });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [isAuthorized, initialStatus]);

  async function handleVerifyAndLoadRecent() {
    if (!isAuthorized) return;
    setVerifying(true);
    setNotice(null);
    try {
      const verified = await getGoogleDriveStatus(true);
      setStatus(verified);
      if (verified.connected) {
        const recent = await searchGoogleDriveFiles({ query: searchQuery.trim(), limit: 15 });
        if (recent.success && Array.isArray(recent.files)) {
          setFiles(recent.files);
          if (recent.files[0] && !selectedFile) setSelectedFile(recent.files[0]);
        }
        setNotice({ tone: 'success', text: verified.message || 'Google Drive connection verified.' });
      } else {
        setNotice({ tone: 'danger', text: verified.message || 'Google Drive could not be verified.' });
      }
    } catch (err) {
      setNotice({
        tone: 'danger',
        text: err instanceof ApiRequestError ? err.message : 'Verification failed.',
      });
    } finally {
      setVerifying(false);
    }
  }

  async function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!isAuthorized) return;
    setLoading(true);
    setNotice(null);
    try {
      const res = await searchGoogleDriveFiles({ query: searchQuery.trim(), limit: 20 });
      if (res.success) {
        const nextFiles = res.files ?? [];
        setFiles(nextFiles);
        setSelectedFile(nextFiles[0] ?? null);
        setInspectedText('');
        const st = await getGoogleDriveStatus(false);
        setStatus(st);
      } else {
        setNotice({ tone: 'danger', text: res.message });
      }
    } catch (err) {
      setNotice({
        tone: 'danger',
        text: err instanceof ApiRequestError ? err.message : 'Drive search failed.',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleReadOrSummarize(file: GoogleDriveFileItem, mode: 'read' | 'summarize') {
    setSelectedFile(file);
    setLoading(true);
    setNotice(null);
    try {
      const res =
        mode === 'summarize'
          ? await summarizeGoogleDriveFile({ fileId: file.id, fileName: file.name })
          : await readGoogleDriveFile({ fileId: file.id, fileName: file.name });
      if (res.success) {
        const body = res.file?.summary || res.file?.content || res.message || '';
        setInspectedText(body);
      } else {
        setNotice({ tone: 'danger', text: res.message });
      }
    } catch (err) {
      setNotice({
        tone: 'danger',
        text: err instanceof ApiRequestError ? err.message : 'Failed to inspect document.',
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!folderName.trim()) return;
    setLoading(true);
    setNotice(null);
    try {
      const res = await createGoogleDriveFolder({ name: folderName.trim() });
      if (res.success) {
        setFolderName('');
        setActiveCreator('none');
        setNotice({ tone: 'success', text: res.message || 'Folder created in Google Drive.' });
        await handleSearch();
      } else {
        setNotice({ tone: 'danger', text: res.message });
      }
    } catch (err) {
      setNotice({ tone: 'danger', text: err instanceof ApiRequestError ? err.message : 'Folder creation failed.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateDoc(e: React.FormEvent) {
    e.preventDefault();
    if (!docTitle.trim()) return;
    setLoading(true);
    setNotice(null);
    try {
      const res = await createGoogleDriveDoc({ title: docTitle.trim(), content: docContent });
      if (res.success) {
        setDocTitle('');
        setDocContent('');
        setActiveCreator('none');
        setNotice({ tone: 'success', text: res.message || 'Google Doc created.' });
        await handleSearch();
      } else {
        setNotice({ tone: 'danger', text: res.message });
      }
    } catch (err) {
      setNotice({ tone: 'danger', text: err instanceof ApiRequestError ? err.message : 'Google Doc creation failed.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleUploadFile(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadName.trim()) return;
    setLoading(true);
    setNotice(null);
    try {
      const res = await uploadGoogleDriveFile({
        name: uploadName.trim(),
        content: uploadContent,
        mimeType: 'text/plain',
      });
      if (res.success) {
        setUploadName('');
        setUploadContent('');
        setActiveCreator('none');
        setNotice({ tone: 'success', text: res.message || 'File uploaded to Google Drive.' });
        await handleSearch();
      } else {
        setNotice({ tone: 'danger', text: res.message });
      }
    } catch (err) {
      setNotice({ tone: 'danger', text: err instanceof ApiRequestError ? err.message : 'File upload failed.' });
    } finally {
      setLoading(false);
    }
  }

  async function handlePrepareShare(file: GoogleDriveFileItem) {
    if (!shareEmail.trim()) {
      setNotice({ tone: 'danger', text: 'Enter a recipient email address before requesting a share token.' });
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const res = await shareGoogleDriveFile({
        fileId: file.id,
        fileName: file.name,
        email: shareEmail.trim(),
        role: shareRole,
      });
      if (res.requiresConfirmation && res.approvalId) {
        setPendingShareToken({
          fileId: file.id,
          token: res.approvalId,
          email: shareEmail.trim(),
          role: shareRole,
        });
        setNotice({ tone: 'info', text: 'Single-use confirmation token issued. Click Confirm Share to grant access.' });
      } else {
        setNotice({ tone: res.success ? 'success' : 'danger', text: res.message });
      }
    } catch (err) {
      setNotice({ tone: 'danger', text: err instanceof ApiRequestError ? err.message : 'Share request failed.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmShare() {
    if (!pendingShareToken || !selectedFile) return;
    setLoading(true);
    setNotice(null);
    try {
      const res = await shareGoogleDriveFile({
        fileId: pendingShareToken.fileId,
        fileName: selectedFile.name,
        email: pendingShareToken.email,
        role: pendingShareToken.role,
        confirmationToken: pendingShareToken.token,
      });
      setPendingShareToken(null);
      if (res.success) {
        setShareEmail('');
        setNotice({ tone: 'success', text: res.message || 'File shared successfully.' });
      } else {
        setNotice({ tone: 'danger', text: res.message });
      }
    } catch (err) {
      setNotice({ tone: 'danger', text: err instanceof ApiRequestError ? err.message : 'Share confirmation failed.' });
    } finally {
      setLoading(false);
    }
  }

  async function handlePrepareMove(file: GoogleDriveFileItem) {
    if (!moveFolderId.trim()) {
      setNotice({ tone: 'danger', text: 'Enter a destination folder ID before requesting a move confirmation token.' });
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const res = await renameOrMoveGoogleDriveFile({
        fileId: file.id,
        fileName: file.name,
        targetFolderId: moveFolderId.trim(),
      });
      if (res.requiresConfirmation && res.approvalId) {
        setPendingMoveToken({
          fileId: file.id,
          fileName: file.name,
          targetFolderId: moveFolderId.trim(),
          token: res.approvalId,
        });
        setNotice({ tone: 'info', text: 'Single-use move confirmation token issued. Click Confirm Move to relocate file.' });
      } else {
        setNotice({ tone: res.success ? 'success' : 'danger', text: res.message });
      }
    } catch (err) {
      setNotice({ tone: 'danger', text: err instanceof ApiRequestError ? err.message : 'Move request failed.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmMove() {
    if (!pendingMoveToken || !selectedFile) return;
    setLoading(true);
    setNotice(null);
    try {
      const res = await renameOrMoveGoogleDriveFile({
        fileId: pendingMoveToken.fileId,
        fileName: pendingMoveToken.fileName,
        targetFolderId: pendingMoveToken.targetFolderId,
        removeParents: selectedFile.parents?.join(','),
        confirmationToken: pendingMoveToken.token,
      });
      setPendingMoveToken(null);
      if (res.success) {
        setMoveFolderId('');
        setNotice({ tone: 'success', text: res.message || 'File moved successfully.' });
      } else {
        setNotice({ tone: 'danger', text: res.message });
      }
    } catch (err) {
      setNotice({ tone: 'danger', text: err instanceof ApiRequestError ? err.message : 'Move confirmation failed.' });
    } finally {
      setLoading(false);
    }
  }

  async function handlePrepareDelete(file: GoogleDriveFileItem) {
    setLoading(true);
    setNotice(null);
    try {
      const res = await deleteGoogleDriveFile({ fileId: file.id, fileName: file.name });
      if (res.requiresApproval && res.approvalId) {
        setPendingDeleteToken({ fileId: file.id, fileName: file.name, token: res.approvalId });
        setNotice({ tone: 'info', text: 'Single-use deletion approval token issued. Confirm below to move to Trash.' });
      } else {
        setNotice({ tone: res.success ? 'success' : 'danger', text: res.message });
      }
    } catch (err) {
      setNotice({ tone: 'danger', text: err instanceof ApiRequestError ? err.message : 'Delete request failed.' });
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteToken) return;
    setLoading(true);
    setNotice(null);
    try {
      const res = await deleteGoogleDriveFile({
        fileId: pendingDeleteToken.fileId,
        fileName: pendingDeleteToken.fileName,
        approvalToken: pendingDeleteToken.token,
      });
      const deletedId = pendingDeleteToken.fileId;
      setPendingDeleteToken(null);
      if (res.success) {
        setFiles((prev) => prev.filter((f) => f.id !== deletedId));
        if (selectedFile?.id === deletedId) {
          setSelectedFile(null);
          setInspectedText('');
        }
        setNotice({ tone: 'success', text: res.message || 'File moved to Google Drive Trash.' });
      } else {
        setNotice({ tone: 'danger', text: res.message });
      }
    } catch (err) {
      setNotice({ tone: 'danger', text: err instanceof ApiRequestError ? err.message : 'Delete confirmation failed.' });
    } finally {
      setLoading(false);
    }
  }

  const statusTone =
    status?.status === 'connected'
      ? 'success'
      : status?.status === 'reconnect_required'
        ? 'warning'
        : 'neutral';

  const statusLabel =
    status?.status === 'connected'
      ? 'Connected & Verified'
      : status?.status === 'reconnect_required'
        ? 'Reconnect Required'
        : status?.configured
          ? 'Configured (Unverified)'
          : 'Not Configured';

  return (
    <div>
      <PageHeader
        title="Google Drive"
        subtitle="Governed executive document search, plain-text summarization, folder/doc creation, and token-bound sharing."
        actions={
          isAuthorized ? (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void handleVerifyAndLoadRecent()}
                disabled={verifying || loading}
                data-testid="drive-verify-btn"
              >
                {verifying ? 'Verifying...' : 'Verify Connection & Load Files'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActiveCreator(activeCreator === 'folder' ? 'none' : 'folder')}
                disabled={loading}
              >
                + New Folder
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActiveCreator(activeCreator === 'doc' ? 'none' : 'doc')}
                disabled={loading}
              >
                + New Google Doc
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActiveCreator(activeCreator === 'upload' ? 'none' : 'upload')}
                disabled={loading}
              >
                + Upload Text File
              </button>
            </div>
          ) : undefined
        }
      />

      {!isAuthorized ? (
        <section className="card" data-testid="drive-restricted-banner">
          <EmptyState
            title="Executive Owner or Admin Access Required"
            description="Google Drive operations are restricted to workspace owners and admins. Viewer and member roles cannot search, read, share, or modify Drive files."
          />
        </section>
      ) : (
        <>
          <section className="card" style={{ marginBottom: '1rem' }} data-testid="drive-status-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' }}>
                  <strong>Google Drive Governance Bridge</strong>
                  <StatusIndicator label={statusLabel} tone={statusTone} testId="drive-connection-badge" />
                </div>
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                  {status?.message ||
                    'All Drive actions pass through PolicyGateway, audit logging, and untrusted-document sanitization.'}
                  {status?.lastVerifiedAt ? ` · Last verified ${formatFriendlyDateTime(status.lastVerifiedAt)}` : ''}
                </p>
              </div>
            </div>
          </section>

          {notice && (
            <div
              role="status"
              className="card"
              style={{
                marginBottom: '1rem',
                borderLeft: `4px solid ${
                  notice.tone === 'danger' ? '#dc2626' : notice.tone === 'success' ? '#16a34a' : '#2563eb'
                }`,
              }}
            >
              {notice.text}
            </div>
          )}

          {activeCreator === 'folder' && (
            <form className="card" onSubmit={(e) => void handleCreateFolder(e)} style={{ marginBottom: '1rem' }}>
              <h3 style={{ marginTop: 0 }}>Create Google Drive Folder</h3>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="Folder name (e.g., Q4 Executive Briefings)"
                  style={{ flex: 1, minWidth: '240px' }}
                  required
                />
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  Create Folder
                </button>
              </div>
            </form>
          )}

          {activeCreator === 'doc' && (
            <form className="card" onSubmit={(e) => void handleCreateDoc(e)} style={{ marginBottom: '1rem' }}>
              <h3 style={{ marginTop: 0 }}>Create Google Doc</h3>
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder="Document title"
                  required
                />
                <textarea
                  rows={4}
                  value={docContent}
                  onChange={(e) => setDocContent(e.target.value)}
                  placeholder="Initial plain-text content..."
                />
                <div>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    Create Google Doc
                  </button>
                </div>
              </div>
            </form>
          )}

          {activeCreator === 'upload' && (
            <form className="card" onSubmit={(e) => void handleUploadFile(e)} style={{ marginBottom: '1rem' }}>
              <h3 style={{ marginTop: 0 }}>Upload Plain-Text File</h3>
              <div style={{ display: 'grid', gap: '0.6rem' }}>
                <input
                  type="text"
                  value={uploadName}
                  onChange={(e) => setUploadName(e.target.value)}
                  placeholder="File name (e.g., meeting-notes.txt)"
                  required
                />
                <textarea
                  rows={4}
                  value={uploadContent}
                  onChange={(e) => setUploadContent(e.target.value)}
                  placeholder="File content..."
                />
                <div>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    Upload to Drive
                  </button>
                </div>
              </div>
            </form>
          )}

          <form
            className="card"
            onSubmit={(e) => void handleSearch(e)}
            style={{ marginBottom: '1rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}
          >
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files or folders in Google Drive (leave blank for latest files)..."
              aria-label="Search Google Drive"
              style={{ flex: 1, minWidth: '240px' }}
              data-testid="drive-search-input"
            />
            <button type="submit" className="btn btn-primary" disabled={loading} data-testid="drive-search-btn">
              {loading ? 'Searching...' : 'Search Drive'}
            </button>
          </form>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
            <section className="card" aria-label="Google Drive Files">
              <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>Drive Files ({files.length})</h2>
              {files.length === 0 ? (
                <EmptyState
                  title="No Drive files loaded yet"
                  description="Click 'Verify Connection & Load Files' or run a search above — or ask Thaara in Chat (e.g., 'Show me my latest 5 files in Google Drive')."
                />
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.6rem' }}>
                  {files.map((file) => {
                    const href = safeExternalDriveHref(file);
                    const isSelected = selectedFile?.id === file.id;
                    return (
                      <li
                        key={file.id}
                        style={{
                          padding: '0.75rem',
                          borderRadius: '8px',
                          border: isSelected ? '1.5px solid var(--brand-blue, #2563eb)' : '1px solid var(--border-subtle, #e2e8f0)',
                          background: isSelected ? 'rgba(37, 99, 235, 0.04)' : 'transparent',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'flex-start' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedFile(file);
                              setInspectedText(file.summary || file.content || '');
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              padding: 0,
                              textAlign: 'left',
                              cursor: 'pointer',
                              fontWeight: 600,
                              color: 'var(--text-primary)',
                            }}
                          >
                            {file.name}
                          </button>
                          <span className="badge badge-info">{formatMimeBadge(file.mimeType)}</span>
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
                          {file.modifiedTime ? `Modified ${formatFriendlyDateTime(file.modifiedTime)}` : `ID: ${file.id}`}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.55rem', fontSize: '0.78rem' }}
                            onClick={() => void handleReadOrSummarize(file, 'read')}
                            disabled={loading}
                          >
                            Read
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.55rem', fontSize: '0.78rem' }}
                            onClick={() => void handleReadOrSummarize(file, 'summarize')}
                            disabled={loading}
                          >
                            Summarize
                          </button>
                          {href && (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-secondary"
                              style={{ padding: '0.25rem 0.55rem', fontSize: '0.78rem', textDecoration: 'none' }}
                            >
                              Open in Drive ↗
                            </a>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="card" aria-label="Document Inspector & Governed Actions">
              <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>Document Inspector & Approval Controls</h2>
              {!selectedFile ? (
                <EmptyState
                  title="Select a file to inspect"
                  description="Choose any file on the left to read sanitized text, generate an AI executive summary, or request a single-use Share / Delete confirmation token."
                />
              ) : (
                <div style={{ display: 'grid', gap: '0.9rem' }}>
                  <div>
                    <strong style={{ fontSize: '1rem' }}>{selectedFile.name}</strong>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      Immutable File ID: <code>{selectedFile.id}</code>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: '0.75rem',
                      borderRadius: '8px',
                      background: 'rgba(15, 23, 42, 0.03)',
                      border: '1px solid var(--border-subtle, #e2e8f0)',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                      UNTRUSTED EXTERNAL DOCUMENT PREVIEW (PLAIN TEXT ONLY)
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.88rem' }}>
                      {inspectedText || 'Click Read or Summarize on this file to inspect its verified content.'}
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-subtle, #e2e8f0)', paddingTop: '0.75rem' }}>
                    <h3 style={{ fontSize: '0.92rem', margin: '0 0 0.5rem 0' }}>Governed File Sharing (Single-Use Token)</h3>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <input
                        type="email"
                        value={shareEmail}
                        onChange={(e) => setShareEmail(e.target.value)}
                        placeholder="Recipient email"
                        style={{ flex: 1, minWidth: '180px' }}
                      />
                      <select
                        value={shareRole}
                        onChange={(e) => setShareRole(e.target.value as 'reader' | 'commenter' | 'writer')}
                      >
                        <option value="reader">Reader</option>
                        <option value="commenter">Commenter</option>
                        <option value="writer">Writer</option>
                      </select>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handlePrepareShare(selectedFile)}
                        disabled={loading}
                      >
                        Prepare Share
                      </button>
                    </div>
                    {pendingShareToken && pendingShareToken.fileId === selectedFile.id && (
                      <div style={{ marginTop: '0.6rem', padding: '0.65rem', borderRadius: '6px', background: 'rgba(37, 99, 235, 0.08)' }}>
                        <div style={{ fontSize: '0.82rem', marginBottom: '0.4rem' }}>
                          Confirm sharing <strong>{selectedFile.name}</strong> with <strong>{pendingShareToken.email}</strong> ({pendingShareToken.role}) · Token <code>{pendingShareToken.token}</code>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button type="button" className="btn btn-primary" onClick={() => void handleConfirmShare()} disabled={loading}>
                            Confirm Share
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={() => setPendingShareToken(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-subtle, #e2e8f0)', paddingTop: '0.75rem' }}>
                    <h3 style={{ fontSize: '0.92rem', margin: '0 0 0.5rem 0' }}>Governed File Move (Single-Use Token)</h3>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        value={moveFolderId}
                        onChange={(e) => setMoveFolderId(e.target.value)}
                        placeholder="Destination folder ID"
                        style={{ flex: 1, minWidth: '180px' }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handlePrepareMove(selectedFile)}
                        disabled={loading}
                      >
                        Prepare Move
                      </button>
                    </div>
                    {pendingMoveToken && pendingMoveToken.fileId === selectedFile.id && (
                      <div style={{ marginTop: '0.6rem', padding: '0.65rem', borderRadius: '6px', background: 'rgba(37, 99, 235, 0.08)' }}>
                        <div style={{ fontSize: '0.82rem', marginBottom: '0.4rem' }}>
                          Confirm moving <strong>{pendingMoveToken.fileName}</strong> to folder <code>{pendingMoveToken.targetFolderId}</code> · Token <code>{pendingMoveToken.token}</code>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button type="button" className="btn btn-primary" onClick={() => void handleConfirmMove()} disabled={loading}>
                            Confirm Move
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={() => setPendingMoveToken(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ borderTop: '1px solid var(--border-subtle, #e2e8f0)', paddingTop: '0.75rem' }}>
                    <h3 style={{ fontSize: '0.92rem', margin: '0 0 0.5rem 0' }}>Governed Deletion (Single-Use Token)</h3>
                    {pendingDeleteToken && pendingDeleteToken.fileId === selectedFile.id ? (
                      <div style={{ padding: '0.65rem', borderRadius: '6px', background: 'rgba(220, 38, 38, 0.08)' }}>
                        <div style={{ fontSize: '0.82rem', marginBottom: '0.4rem' }}>
                          Confirm moving <strong>{pendingDeleteToken.fileName}</strong> to Trash · Token <code>{pendingDeleteToken.token}</code>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button type="button" className="btn btn-primary" onClick={() => void handleConfirmDelete()} disabled={loading}>
                            Confirm Move to Trash
                          </button>
                          <button type="button" className="btn btn-secondary" onClick={() => setPendingDeleteToken(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handlePrepareDelete(selectedFile)}
                        disabled={loading}
                      >
                        Request Delete Approval Token
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
