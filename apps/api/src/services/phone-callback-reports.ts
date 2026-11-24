import type { PhoneCallbackReport } from '@thaara/contracts';
import { ForbiddenError } from '@thaara/observability';
import { callbackMissingFields, type CallbackRequest, type CallbackScope } from './phone-callback-notification.js';

export function callbackReport(request: CallbackRequest): PhoneCallbackReport {
  const meanings = {
    pending: 'Queued for notification', sending: 'Submission in progress', submitted: 'Accepted by email provider; inbox delivery unconfirmed',
    failed: 'Notification failed; callback request retained', unverified: 'Submission outcome uncertain; human review required',
    needs_review: 'Caller confirmation incomplete; human review required',
  };
  return { requestId: request.id, callId: request.callId, direction: request.direction,
    name: request.name, business: request.business, service: request.service, phoneNumber: request.phoneNumber,
    callbackRequested: true, callbackConfirmed: request.notificationStatus !== 'needs_review',
    notificationStatus: request.notificationStatus, notificationMeaning: meanings[request.notificationStatus],
    missingFields: callbackMissingFields(request), occurredAt: request.occurredAt };
}

export type PhoneCallbackReportReader = (scope: CallbackScope) => Promise<CallbackRequest[]>;
export async function readCallbackReports(scope: CallbackScope & { role: string }, reader?: PhoneCallbackReportReader) {
  if (scope.role !== 'owner') throw new ForbiddenError('Phone callback reports require the owner.');
  if (!reader) return { status: 'not_configured' as const, reports: [] };
  const rows = await reader(scope);
  if (rows.length > 100 || rows.some(row => row.workspaceId !== scope.workspaceId || row.userId !== scope.userId)) {
    throw new ForbiddenError('Phone callback report scope denied.');
  }
  return { status: 'ready' as const, reports: rows.map(callbackReport) };
}
