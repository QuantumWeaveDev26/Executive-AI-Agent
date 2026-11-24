import { ApiRequestError, request } from './api';

export const WHATSAPP_PAGE_SIZE = 20;

export interface WhatsAppStatus {
  connectorName: 'whatsapp_business';
  status: 'not_configured' | 'disconnected' | 'connected' | 'reconnect_required';
  configured: boolean;
  connected: boolean;
  mode: 'disabled' | 'mock';
  capabilities: string[];
  maskedBusinessPhone: string | null;
  lastVerifiedAt: string | null;
}

export interface WhatsAppContactSummary {
  contactHash: string;
  maskedPhone: string;
  displayName: string;
}

export interface WhatsAppMessage {
  id: string;
  threadId: string;
  direction: 'inbound' | 'outbound_draft';
  sender: WhatsAppContactSummary;
  textPreview: string;
  timestamp: string;
  deliveryStatus: 'received' | 'read' | 'draft_awaiting_approval';
  untrusted: true;
  mode: 'mock';
}

export interface WhatsAppThreadSummary {
  threadId: string;
  participant: WhatsAppContactSummary;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  untrusted: true;
  mode: 'mock';
}

export interface WhatsAppListMessagesResponse {
  messages: WhatsAppMessage[];
  threads: WhatsAppThreadSummary[];
  nextPageToken?: string;
  untrusted: true;
  mode: 'mock';
}

const base = '/api/v1/connectors/whatsapp';
const invalid = () => new ApiRequestError(502, 'WhatsApp Business data is unavailable.');
const idValid = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(id);
const threadIdValid = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const maskedPhoneValid = (phone: unknown): phone is string =>
  typeof phone === 'string' &&
  phone.length >= 4 &&
  phone.length <= 32 &&
  phone.includes('*') &&
  !/\d{7,}/.test(phone);

function validateContact(value: unknown): WhatsAppContactSummary {
  if (!value || typeof value !== 'object') throw invalid();
  const c = value as WhatsAppContactSummary;
  if (
    typeof c.contactHash !== 'string' ||
    c.contactHash.length < 8 ||
    c.contactHash.length > 128 ||
    !maskedPhoneValid(c.maskedPhone) ||
    typeof c.displayName !== 'string' ||
    c.displayName.length < 1 ||
    c.displayName.length > 128
  ) {
    throw invalid();
  }
  return {
    contactHash: c.contactHash,
    maskedPhone: c.maskedPhone,
    displayName: c.displayName
  };
}

function validateMessage(value: unknown): WhatsAppMessage {
  if (!value || typeof value !== 'object') throw invalid();
  const m = value as WhatsAppMessage;
  if (
    !idValid(m.id) ||
    !threadIdValid(m.threadId) ||
    !['inbound', 'outbound_draft'].includes(m.direction) ||
    typeof m.textPreview !== 'string' ||
    m.textPreview.length > 2048 ||
    typeof m.timestamp !== 'string' ||
    Number.isNaN(Date.parse(m.timestamp)) ||
    !['received', 'read', 'draft_awaiting_approval'].includes(m.deliveryStatus) ||
    m.untrusted !== true ||
    m.mode !== 'mock'
  ) {
    throw invalid();
  }
  return {
    id: m.id,
    threadId: m.threadId,
    direction: m.direction,
    sender: validateContact(m.sender),
    textPreview: m.textPreview,
    timestamp: m.timestamp,
    deliveryStatus: m.deliveryStatus,
    untrusted: true,
    mode: 'mock'
  };
}

function validateThread(value: unknown): WhatsAppThreadSummary {
  if (!value || typeof value !== 'object') throw invalid();
  const t = value as WhatsAppThreadSummary;
  if (
    !threadIdValid(t.threadId) ||
    typeof t.lastMessageAt !== 'string' ||
    Number.isNaN(Date.parse(t.lastMessageAt)) ||
    typeof t.lastMessagePreview !== 'string' ||
    t.lastMessagePreview.length > 512 ||
    typeof t.unreadCount !== 'number' ||
    t.unreadCount < 0 ||
    t.untrusted !== true ||
    t.mode !== 'mock'
  ) {
    throw invalid();
  }
  return {
    threadId: t.threadId,
    participant: validateContact(t.participant),
    lastMessageAt: t.lastMessageAt,
    lastMessagePreview: t.lastMessagePreview,
    unreadCount: t.unreadCount,
    untrusted: true,
    mode: 'mock'
  };
}

function validateStatus(value: WhatsAppStatus): WhatsAppStatus {
  if (
    !value ||
    value.connectorName !== 'whatsapp_business' ||
    !['not_configured', 'disconnected', 'connected', 'reconnect_required'].includes(value.status) ||
    !['disabled', 'mock'].includes(value.mode) ||
    typeof value.connected !== 'boolean' ||
    typeof value.configured !== 'boolean'
  ) {
    throw invalid();
  }
  if (value.maskedBusinessPhone !== null && !maskedPhoneValid(value.maskedBusinessPhone)) {
    throw invalid();
  }
  return {
    connectorName: 'whatsapp_business',
    status: value.status,
    configured: value.configured,
    connected: value.connected,
    mode: value.mode,
    capabilities: Array.isArray(value.capabilities)
      ? value.capabilities.filter(
          (c) => c === 'whatsapp.messages.read' || c === 'whatsapp.threads.read'
        )
      : [],
    maskedBusinessPhone: value.maskedBusinessPhone,
    lastVerifiedAt:
      typeof value.lastVerifiedAt === 'string' && !Number.isNaN(Date.parse(value.lastVerifiedAt))
        ? value.lastVerifiedAt
        : null
  };
}

export async function getWhatsAppStatus(signal?: AbortSignal): Promise<WhatsAppStatus> {
  return validateStatus(await request<WhatsAppStatus>(base + '/status', { signal }));
}

export async function listWhatsAppMessages(
  input: { threadId?: string; query?: string; pageToken?: string } = {},
  signal?: AbortSignal
): Promise<WhatsAppListMessagesResponse> {
  const query = input.query?.trim();
  if (query !== undefined && query.length > 256) {
    throw new ApiRequestError(400, 'Invalid WhatsApp search query.');
  }
  if (input.threadId !== undefined && !threadIdValid(input.threadId)) {
    throw new ApiRequestError(400, 'Invalid WhatsApp conversation filter.');
  }
  if (input.pageToken !== undefined && (!input.pageToken || input.pageToken.length > 512)) {
    throw new ApiRequestError(400, 'Invalid WhatsApp page token.');
  }

  const value = await request<WhatsAppListMessagesResponse>(base + '/messages/list', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      limit: WHATSAPP_PAGE_SIZE,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(query ? { query } : {}),
      ...(input.pageToken ? { pageToken: input.pageToken } : {})
    })
  });

  if (
    !value ||
    value.mode !== 'mock' ||
    value.untrusted !== true ||
    !Array.isArray(value.messages) ||
    value.messages.length > WHATSAPP_PAGE_SIZE ||
    !Array.isArray(value.threads) ||
    value.threads.length > 50 ||
    (value.nextPageToken !== undefined &&
      (typeof value.nextPageToken !== 'string' ||
        !value.nextPageToken ||
        value.nextPageToken.length > 512))
  ) {
    throw invalid();
  }

  return {
    messages: value.messages.map(validateMessage),
    threads: value.threads.map(validateThread),
    ...(value.nextPageToken ? { nextPageToken: value.nextPageToken } : {}),
    untrusted: true,
    mode: 'mock'
  };
}

export async function readWhatsAppMessage(
  id: string,
  signal?: AbortSignal
): Promise<WhatsAppMessage> {
  if (!idValid(id)) {
    throw new ApiRequestError(400, 'Invalid WhatsApp message selection.');
  }
  const value = await request<WhatsAppMessage>(base + '/messages/' + encodeURIComponent(id), {
    signal
  });
  const validated = validateMessage(value);
  if (validated.id !== id) {
    throw invalid();
  }
  return validated;
}

export async function disconnectWhatsApp(signal?: AbortSignal): Promise<WhatsAppStatus> {
  const value = validateStatus(
    await request<WhatsAppStatus>(base + '/connection', {
      method: 'DELETE',
      body: '{}',
      signal
    })
  );
  if (value.connected || !['disconnected', 'not_configured'].includes(value.status)) {
    throw invalid();
  }
  return value;
}

export function whatsappError(
  error: unknown
): 'unauthorized' | 'reconnect' | 'invalid_search' | 'unavailable' {
  if (error instanceof ApiRequestError) {
    if ([401, 403].includes(error.status)) return 'unauthorized';
    if ([409, 503].includes(error.status)) return 'reconnect';
    if (error.status === 400) return 'invalid_search';
  }
  return 'unavailable';
}
