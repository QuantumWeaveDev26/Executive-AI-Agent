import fs from 'node:fs';

const filePath = 'apps/web/src/api.ts';
let code = fs.readFileSync(filePath, 'utf8');
const isCrlf = code.includes('\r\n');
const normalized = code.replace(/\r\n/g, '\n');

const target = `export async function streamConversationMessage(
  conversationId: string,
  content: string,
  idempotencyKey: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const headers = new Headers({
    Accept: 'text/event-stream, application/json',
    'Content-Type': 'application/json'
  });

  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }

  const res = await fetch(\`/api/v1/conversations/\${encodeURIComponent(conversationId)}/stream\`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify({ content, idempotency_key: idempotencyKey }),
    signal
  });`;

const replacement = `export interface UploadedAttachmentResponse {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  extractedTextLength: number;
  createdAt: string;
}

export async function uploadConversationAttachment(
  conversationId: string,
  file: File
): Promise<UploadedAttachmentResponse> {
  const base64Content = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });

  return request<UploadedAttachmentResponse>(
    \`/api/v1/conversations/\${encodeURIComponent(conversationId)}/attachments\`,
    {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        contentBase64: base64Content
      })
    }
  );
}

export async function streamConversationMessage(
  conversationId: string,
  content: string,
  idempotencyKey: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  attachmentIds?: string[]
): Promise<void> {
  const headers = new Headers({
    Accept: 'text/event-stream, application/json',
    'Content-Type': 'application/json'
  });

  const csrfToken = getCsrfToken();
  if (csrfToken) {
    headers.set('x-csrf-token', csrfToken);
  }

  const payload: Record<string, unknown> = {
    content,
    idempotency_key: idempotencyKey
  };
  if (attachmentIds && attachmentIds.length > 0) {
    payload.attachment_ids = attachmentIds;
  }

  const res = await fetch(\`/api/v1/conversations/\${encodeURIComponent(conversationId)}/stream\`, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(payload),
    signal
  });`;

if (!normalized.includes(target)) {
  console.error('Target not found!');
  process.exit(1);
}

const updated = normalized.replace(target, replacement);
fs.writeFileSync(filePath, isCrlf ? updated.replace(/\n/g, '\r\n') : updated, 'utf8');
console.log('Successfully patched apps/web/src/api.ts');
