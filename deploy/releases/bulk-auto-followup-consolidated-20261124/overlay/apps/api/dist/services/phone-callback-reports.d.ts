import type { PhoneCallbackReport } from '@thaara/contracts';
import { type CallbackRequest, type CallbackScope } from './phone-callback-notification.js';
export declare function callbackReport(request: CallbackRequest): PhoneCallbackReport;
export type PhoneCallbackReportReader = (scope: CallbackScope) => Promise<CallbackRequest[]>;
export declare function readCallbackReports(scope: CallbackScope & {
    role: string;
}, reader?: PhoneCallbackReportReader): Promise<{
    status: "not_configured";
    reports: never[];
} | {
    status: "ready";
    reports: {
        name: string | null;
        callbackRequested: true;
        callId: string;
        direction: "outbound" | "inbound";
        service: string | null;
        business: string | null;
        occurredAt: string;
        phoneNumber: string | null;
        requestId: string;
        notificationStatus: "pending" | "unverified" | "failed" | "needs_review" | "submitted" | "sending";
        callbackConfirmed: boolean;
        notificationMeaning: string;
        missingFields: string[];
    }[];
}>;
//# sourceMappingURL=phone-callback-reports.d.ts.map