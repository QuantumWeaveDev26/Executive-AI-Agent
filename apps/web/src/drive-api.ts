import { request } from './api';

export interface GoogleDriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  iconLink?: string;
  size?: number;
  modifiedTime?: string;
  createdTime?: string;
  parents?: string[];
  shared?: boolean;
  summary?: string;
  content?: string;
}

export interface GoogleDriveStatusResponse {
  connectorName: 'google_drive';
  status: 'not_configured' | 'disconnected' | 'connected' | 'reconnect_required';
  configured: boolean;
  connected: boolean;
  mode: 'disabled' | 'mock' | 'live';
  scopes: string[];
  lastVerifiedAt: string | null;
  connectedEmail?: string;
  message?: string;
}

export interface GoogleDriveOperationResponse {
  success: boolean;
  operation: string;
  message: string;
  files?: GoogleDriveFileItem[];
  file?: GoogleDriveFileItem;
  folder?: GoogleDriveFileItem;
  webViewLink?: string;
  requiresApproval?: boolean;
  requiresConfirmation?: boolean;
  approvalId?: string;
}

const BASE = '/api/v1/connectors/google-drive';

export function getGoogleDriveStatus(verify = false, signal?: AbortSignal): Promise<GoogleDriveStatusResponse> {
  const qs = verify ? '?verify=true' : '';
  return request<GoogleDriveStatusResponse>(`${BASE}/status${qs}`, { signal });
}

export function searchGoogleDriveFiles(
  input: { query?: string; nameFilter?: string; folderId?: string; limit?: number },
  signal?: AbortSignal
): Promise<GoogleDriveOperationResponse> {
  return request<GoogleDriveOperationResponse>(`${BASE}/search`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}

export function listGoogleDriveFolder(
  input: { folderId?: string; folderName?: string },
  signal?: AbortSignal
): Promise<GoogleDriveOperationResponse> {
  return request<GoogleDriveOperationResponse>(`${BASE}/folders/list`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}

export function readGoogleDriveFile(
  input: { fileId: string; fileName?: string },
  signal?: AbortSignal
): Promise<GoogleDriveOperationResponse> {
  return request<GoogleDriveOperationResponse>(`${BASE}/files/read`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}

export function summarizeGoogleDriveFile(
  input: { fileId: string; fileName?: string },
  signal?: AbortSignal
): Promise<GoogleDriveOperationResponse> {
  return request<GoogleDriveOperationResponse>(`${BASE}/files/summarize`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}

export function createGoogleDriveFolder(
  input: { name: string; parentFolderId?: string },
  signal?: AbortSignal
): Promise<GoogleDriveOperationResponse> {
  return request<GoogleDriveOperationResponse>(`${BASE}/folders`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}

export function createGoogleDriveDoc(
  input: { title: string; content?: string; parentFolderId?: string },
  signal?: AbortSignal
): Promise<GoogleDriveOperationResponse> {
  return request<GoogleDriveOperationResponse>(`${BASE}/docs`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}

export function uploadGoogleDriveFile(
  input: { name: string; content: string; mimeType?: string; folderId?: string },
  signal?: AbortSignal
): Promise<GoogleDriveOperationResponse> {
  return request<GoogleDriveOperationResponse>(`${BASE}/files/upload`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}

export function renameOrMoveGoogleDriveFile(
  input: {
    fileId: string;
    fileName?: string;
    newName?: string;
    targetFolderId?: string;
    removeParents?: string;
    confirmationToken?: string;
  },
  signal?: AbortSignal
): Promise<GoogleDriveOperationResponse> {
  return request<GoogleDriveOperationResponse>(`${BASE}/files/rename-move`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}

export function shareGoogleDriveFile(
  input: {
    fileId: string;
    fileName?: string;
    email: string;
    role: 'reader' | 'commenter' | 'writer';
    confirmationToken?: string;
  },
  signal?: AbortSignal
): Promise<GoogleDriveOperationResponse> {
  return request<GoogleDriveOperationResponse>(`${BASE}/files/share`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}

export function deleteGoogleDriveFile(
  input: { fileId: string; fileName?: string; approvalToken?: string },
  signal?: AbortSignal
): Promise<GoogleDriveOperationResponse> {
  return request<GoogleDriveOperationResponse>(`${BASE}/files/delete`, {
    method: 'POST',
    body: JSON.stringify(input),
    signal,
  });
}
