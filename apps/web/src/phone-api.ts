export type PhoneRole = string;

export type PhoneCallDirection = 'inbound' | 'outbound_simulated';

export type PhoneCallLifecycleState =
  | 'queued'
  | 'ringing'
  | 'answered'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface PhoneStatus {
  connectorName: 'phone_telephony';
  status: 'not_configured' | 'disconnected' | 'connected' | 'reconnect_required';
  configured: boolean;
  connected: boolean;
  mode: 'disabled' | 'mock';
  capabilities: string[];
  maskedLineNumber?: string;
  recordingEnabled: false;
  transcriptionEnabled: false;
  lastVerifiedAt?: string;
}

export interface PhoneCallRecord {
  id: string;
  providerCallId: string;
  direction: PhoneCallDirection;
  lifecycleState: PhoneCallLifecycleState;
  maskedPhoneNumber: string;
  contactDisplayName: string;
  purposeSummary: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  failureReason?: string;
  recordingAvailable: false;
  transcriptAvailable: false;
  untrusted: true;
  mode: 'mock';
}

export interface PhoneListCallsResponse {
  calls: PhoneCallRecord[];
  totalCount: number;
  nextPageToken?: string;
  recordingEnabled: false;
  transcriptionEnabled: false;
  untrusted: true;
  mode: 'mock';
}

// Same origin as the web app (the pilot serves web and API together; local dev proxies /api). A fixed host broke the pilot.
const API_BASE = '';

const VALID_LIFECYCLE_STATES = new Set<PhoneCallLifecycleState>([
  'queued',
  'ringing',
  'answered',
  'completed',
  'failed',
  'cancelled',
]);

const VALID_DIRECTIONS = new Set<PhoneCallDirection>(['inbound', 'outbound_simulated']);

export class PhoneApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PhoneApiError';
  }
}

async function parseErrorResponse(res: Response, fallbackMsg: string): Promise<PhoneApiError> {
  let code = `HTTP_${res.status}`;
  let message = fallbackMsg;

  try {
    const body = await res.json();
    if (body && typeof body === 'object') {
      if (typeof body.error === 'string') {
        code = body.error;
      }
      if (typeof body.message === 'string' && body.message.trim().length > 0) {
        message = body.message;
      }
    }
  } catch {
    // Fallback if non-JSON error
  }

  return new PhoneApiError(message, res.status, code);
}

function isMaskedPhoneNumber(value: unknown): value is string {
  return typeof value === 'string' && /^\+\d{1,3} \*{6}\d{4}$/.test(value);
}

function assertValidCallRecord(item: unknown): asserts item is PhoneCallRecord {
  if (!item || typeof item !== 'object') {
    throw new PhoneApiError('Malformed Phone call record.', 502, 'MALFORMED_RESPONSE');
  }
  const c = item as Record<string, unknown>;
  if (
    typeof c.id !== 'string' ||
    typeof c.providerCallId !== 'string' ||
    !VALID_DIRECTIONS.has(c.direction as PhoneCallDirection) ||
    !VALID_LIFECYCLE_STATES.has(c.lifecycleState as PhoneCallLifecycleState) ||
    !isMaskedPhoneNumber(c.maskedPhoneNumber) ||
    typeof c.contactDisplayName !== 'string' ||
    typeof c.purposeSummary !== 'string' ||
    typeof c.startedAt !== 'string' ||
    c.recordingAvailable !== false ||
    c.transcriptAvailable !== false ||
    c.untrusted !== true ||
    c.mode !== 'mock'
  ) {
    throw new PhoneApiError('Invalid Phone call schema.', 502, 'MALFORMED_RESPONSE');
  }

  if (c.endedAt !== undefined && typeof c.endedAt !== 'string') {
    throw new PhoneApiError('Invalid Phone call endedAt timestamp.', 502, 'MALFORMED_RESPONSE');
  }

  if (
    c.durationSeconds !== undefined &&
    (typeof c.durationSeconds !== 'number' || !Number.isInteger(c.durationSeconds) || c.durationSeconds < 0)
  ) {
    throw new PhoneApiError('Invalid Phone call durationSeconds.', 502, 'MALFORMED_RESPONSE');
  }
}

export async function fetchPhoneStatus(signal?: AbortSignal): Promise<PhoneStatus> {
  const res = await fetch(`${API_BASE}/api/v1/connectors/phone/status`, {
    method: 'GET',
    credentials: 'include',
    signal,
  });

  if (!res.ok) {
    throw await parseErrorResponse(res, `Failed to load Phone status (${res.status})`);
  }

  const data = await res.json();
  if (
    !data ||
    typeof data !== 'object' ||
    data.connectorName !== 'phone_telephony' ||
    typeof data.status !== 'string' ||
    typeof data.configured !== 'boolean' ||
    typeof data.connected !== 'boolean' ||
    (data.mode !== 'disabled' && data.mode !== 'mock') ||
    !Array.isArray(data.capabilities) ||
    data.recordingEnabled !== false ||
    data.transcriptionEnabled !== false
  ) {
    throw new PhoneApiError('Malformed Phone status response from server.', 502, 'MALFORMED_RESPONSE');
  }

  if (data.maskedLineNumber !== undefined && !isMaskedPhoneNumber(data.maskedLineNumber)) {
    throw new PhoneApiError('Unmasked or invalid line phone number received.', 502, 'MALFORMED_RESPONSE');
  }

  return data as PhoneStatus;
}

export async function listPhoneCalls(
  params?: {
    direction?: PhoneCallDirection;
    lifecycleState?: PhoneCallLifecycleState;
    query?: string;
    limit?: number;
    pageToken?: string;
  },
  signal?: AbortSignal,
): Promise<PhoneListCallsResponse> {
  const payload: Record<string, unknown> = {
    limit: params?.limit ?? 20,
  };
  if (params?.direction) {
    payload.direction = params.direction;
  }
  if (params?.lifecycleState) {
    payload.lifecycleState = params.lifecycleState;
  }
  if (params?.query && params.query.trim().length > 0) {
    payload.query = params.query.trim();
  }
  if (params?.pageToken && params.pageToken.trim().length > 0) {
    payload.pageToken = params.pageToken.trim();
  }

  const res = await fetch(`${API_BASE}/api/v1/connectors/phone/calls/list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    throw await parseErrorResponse(res, `Failed to list Phone calls (${res.status})`);
  }

  const data = await res.json();
  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray(data.calls) ||
    typeof data.totalCount !== 'number' ||
    data.recordingEnabled !== false ||
    data.transcriptionEnabled !== false ||
    data.untrusted !== true ||
    data.mode !== 'mock'
  ) {
    throw new PhoneApiError('Malformed Phone calls list response.', 502, 'MALFORMED_RESPONSE');
  }

  for (const item of data.calls) {
    assertValidCallRecord(item);
  }

  return data as PhoneListCallsResponse;
}

export async function readPhoneCall(callId: string, signal?: AbortSignal): Promise<PhoneCallRecord> {
  const res = await fetch(`${API_BASE}/api/v1/connectors/phone/calls/${encodeURIComponent(callId)}`, {
    method: 'GET',
    credentials: 'include',
    signal,
  });

  if (!res.ok) {
    throw await parseErrorResponse(res, `Failed to read Phone call (${res.status})`);
  }

  const data = await res.json();
  assertValidCallRecord(data);
  return data;
}

export async function disconnectPhone(): Promise<{
  status: string;
  disconnectedAt: string;
  revokedTokens: boolean;
}> {
  const res = await fetch(`${API_BASE}/api/v1/connectors/phone/connection`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!res.ok) {
    throw await parseErrorResponse(res, `Failed to disconnect Phone (${res.status})`);
  }

  return res.json();
}
