import { type AuthenticatedScope, type TransactionalDbClient } from '@thaara/db';
import type { PhoneCallLedger } from './phone-calling.js';
import { type PhoneAppointmentCalendar } from './phone-appointment-calendar.js';
export declare const isExistingOwnerCalendarReview: (service: object) => boolean;
/** Owner-authenticated follow-up proposal, NOT a Sarvam tool grant. Unregistered/test-only until admission.
 * Durable storage is the existing governed Calendar plan for this actual proposal, not a substitute
 * journal for raw call data. Unavailable Calendar/storage returns saved:false. No event creation here. */
export declare function createOutboundAppointments(options: {
    db: TransactionalDbClient;
    calls: Pick<PhoneCallLedger, 'load' | 'durable'>;
    calendar: PhoneAppointmentCalendar;
    now?: () => number;
    existingOwnerCalendarReview?: boolean;
}): {
    status(input: AuthenticatedScope, callId: string): Promise<{
        saved: boolean;
        requestId: string;
        status: "needs_review" | "appointment_confirmed" | "request_saved" | "approval_pending" | "slot_unavailable";
        appointmentConfirmed: boolean;
    } | {
        saved: false;
        appointmentConfirmed: false;
        status: "request_not_saved";
    }>;
    review(input: AuthenticatedScope, callId: string): Promise<{
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
    request(input: AuthenticatedScope, callId: string, raw: unknown): Promise<{
        saved: boolean;
        requestId: string;
        status: "needs_review" | "appointment_confirmed" | "request_saved" | "approval_pending" | "slot_unavailable";
        appointmentConfirmed: boolean;
    } | {
        saved: false;
        appointmentConfirmed: false;
        status: "needs_review" | "slot_unavailable" | "request_not_saved";
    }>;
};
//# sourceMappingURL=phone-outbound-appointments.d.ts.map