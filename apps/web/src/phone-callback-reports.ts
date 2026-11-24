import type { PhoneCallbackReport } from '../../../packages/contracts/src/phone-callback-notification';

export type { PhoneCallbackReport };
export type CallbackReportFeed = { status: 'ready' | 'not_configured'; reports: PhoneCallbackReport[] };
const labels = {
  pending: 'Queued for notification',
  sending: 'Submission in progress',
  submitted: 'Accepted by email provider; inbox delivery unconfirmed',
  failed: 'Notification failed; callback request retained',
  unverified: 'Submission outcome uncertain; human review required',
  needs_review: 'Caller confirmation incomplete; human review required',
};
export const callbackNotificationLabel = (status: PhoneCallbackReport['notificationStatus']) => labels[status];
const fields = ['name', 'business', 'service', 'phoneNumber'] as const;
const keys = ['requestId', 'callId', 'direction', ...fields, 'callbackRequested', 'callbackConfirmed',
  'notificationStatus', 'notificationMeaning', 'missingFields', 'occurredAt'].sort().join(',');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function validReport(value: unknown): value is PhoneCallbackReport {
  if (!record(value) || Object.keys(value).sort().join(',') !== keys) return false;
  if (typeof value.requestId !== 'string' || !/^[a-f0-9]{64}$/.test(value.requestId)
    || typeof value.callId !== 'string' || !value.callId || value.callId.length > 256
    || !['inbound', 'outbound'].includes(String(value.direction)) || value.callbackRequested !== true
    || typeof value.notificationStatus !== 'string' || !Object.hasOwn(labels, value.notificationStatus)
    || value.callbackConfirmed !== (value.notificationStatus !== 'needs_review')
    || typeof value.notificationMeaning !== 'string' || value.notificationMeaning.length > 240
    || typeof value.occurredAt !== 'string' || value.occurredAt.length > 40 || !Number.isFinite(Date.parse(value.occurredAt))) return false;
  if (fields.some(field => value[field] !== null && (typeof value[field] !== 'string' || value[field].length > 240))) return false;
  if (value.phoneNumber !== null && !/^\+[1-9][0-9]{7,14}$/.test(String(value.phoneNumber))) return false;
  const missing = fields.filter(field => !value[field]);
  const reportedMissing = value.missingFields;
  return Array.isArray(reportedMissing) && reportedMissing.length === missing.length
    && new Set(reportedMissing).size === missing.length && missing.every(field => reportedMissing.includes(field));
}

/** Read-only, authenticated feed. Provider text never determines links, status labels or routing. */
export async function loadPhoneCallbackReports(signal?: AbortSignal): Promise<CallbackReportFeed> {
  const response = await fetch('/api/v1/connectors/phone/callbacks/reports', {
    method: 'GET', credentials: 'include', cache: 'no-store', signal,
  });
  if (!response.ok) throw Error(response.status === 403
    ? 'Only the workspace owner can view callback reports.' : 'Callback reports could not be loaded.');
  const value: unknown = await response.json();
  if (!record(value) || Object.keys(value).sort().join(',') !== 'reports,status'
    || !['ready', 'not_configured'].includes(String(value.status)) || !Array.isArray(value.reports)
    || value.reports.length > 100 || !value.reports.every(validReport)
    || new Set(value.reports.map(report => report.requestId)).size !== value.reports.length
    || (value.status === 'not_configured' && value.reports.length > 0)) {
    throw Error('Callback reports could not be verified.');
  }
  return value as CallbackReportFeed;
}
