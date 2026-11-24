import { type AuthenticatedScope, type TransactionalDbClient } from '@thaara/db';
import type { PhoneInboundEventRepository } from './phone-inbound-event-store.js';
import { type PhoneAppointmentCalendar } from './phone-appointment-calendar.js';
/** Signed-in owner reviews an already committed consent-backed request. Sarvam gets no owner session.
 * This does not install request capture, bypass 112h/113h admission or grant in-call Calendar access. */
export declare function createInboundAppointmentOwnerReview(options: {
    db: TransactionalDbClient;
    repository: Pick<PhoneInboundEventRepository, 'read'>;
    calendar: PhoneAppointmentCalendar;
    now?: () => number;
}): {
    status(input: AuthenticatedScope, reportId: string): Promise<{
        saved: boolean;
        requestId: string;
        status: "needs_review" | "appointment_confirmed" | "request_saved" | "approval_pending" | "slot_unavailable";
        appointmentConfirmed: boolean;
    }>;
    review(input: AuthenticatedScope, reportId: string): Promise<{
        status: "not_prepared";
        slot: null;
        calendarApproval: null;
    } | {
        status: "ready";
        slot: {
            timeZone: string;
            startAt: string;
            endAt: string;
        };
        calendarApproval: {
            planId: string;
            approvalId: string;
        };
    }>;
    request(input: AuthenticatedScope, reportId: string, body: unknown): Promise<{
        saved: boolean;
        requestId: string;
        status: "needs_review" | "appointment_confirmed" | "request_saved" | "approval_pending" | "slot_unavailable";
        appointmentConfirmed: boolean;
    }>;
};
//# sourceMappingURL=phone-inbound-appointment-owner.d.ts.map