import { type AdmittedCallbackCall, type CallbackMailTransport, type CallbackNotificationGrant, type CallbackRepository, type CallbackScope } from './phone-callback-notification.js';
/** Server-only composition. Admission and repository ports must be bound to the reviewed provider identity. */
export declare function createPhoneCallbackRuntime<Input>(options: {
    admit(input: Input): Promise<AdmittedCallbackCall | null>;
    repository: CallbackRepository & {
        recoverInterrupted(scope: CallbackScope): Promise<void>;
        pending(scope: CallbackScope): Promise<string[]>;
        list(scope: CallbackScope): Promise<import('./phone-callback-notification.js').CallbackRequest[]>;
    };
    transport: CallbackMailTransport;
    currentOwnerGrant(scope: CallbackScope): Promise<CallbackNotificationGrant | null>;
}): {
    receive(input: Input, details: unknown): Promise<{
        saved: false;
        requestId?: undefined;
        notificationStatus?: undefined;
        missingFields?: undefined;
    } | {
        saved: true;
        requestId: string;
        notificationStatus: "pending" | "unverified" | "failed" | "needs_review" | "submitted" | "sending";
        missingFields: ("name" | "service" | "business" | "phoneNumber")[];
    }>;
    drain: (scope: CallbackScope) => Promise<{
        id: string;
        result: string;
    }[]>;
    reports: (scope: CallbackScope & {
        role: string;
    }) => Promise<{
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
};
//# sourceMappingURL=phone-callback-runtime.d.ts.map