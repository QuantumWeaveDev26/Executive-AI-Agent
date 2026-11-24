import { type PhoneAppointmentSlot } from '@thaara/contracts';
import { type AuthenticatedScope, type TransactionalDbClient } from '@thaara/db';
import { type GoogleCalendarFoundation } from './google-calendar.js';
import type { StoredInboundReport } from './phone-inbound-reports.js';
import type { InboundCalendarReceipt } from './phone-sarvam-inbound-normalize.js';
export type PhoneAppointmentCalendar = Pick<GoogleCalendarFoundation, 'writeReadiness' | 'findConflicts' | 'listEvents' | 'readEvent'>;
/** Shared Calendar proposal/readback only. This never grants authority, approves or creates an event. */
export declare function createPhoneAppointmentCalendar(options: {
    db: TransactionalDbClient;
    calendar: PhoneAppointmentCalendar;
    direction: 'inbound' | 'outbound';
    savedBeforeProposal: boolean;
    includeOwnerReview?: boolean;
    existingOwnerCalendarReview?: boolean;
}): ((scope: AuthenticatedScope, report: Pick<StoredInboundReport, "id" | "customerName" | "business" | "serviceNeeded">, slot: PhoneAppointmentSlot, interactionId: string, existingOnly?: boolean) => Promise<{
    saved: boolean;
    requestId: string;
    status: "needs_review" | "appointment_confirmed" | "request_saved" | "approval_pending" | "slot_unavailable";
    appointmentConfirmed: boolean;
} | {
    timeZone: string;
    startAt: string;
    endAt: string;
    eventId: string;
    saved: boolean;
    requestId: string;
    status: "needs_review" | "appointment_confirmed" | "request_saved" | "approval_pending" | "slot_unavailable";
    appointmentConfirmed: boolean;
}>) & {
    readExisting: (scope: AuthenticatedScope, report: Pick<StoredInboundReport, "id" | "customerName" | "business" | "serviceNeeded">, slot: PhoneAppointmentSlot, interactionId: string) => Promise<{
        saved: boolean;
        requestId: string;
        status: "needs_review" | "appointment_confirmed" | "request_saved" | "approval_pending" | "slot_unavailable";
        appointmentConfirmed: boolean;
    } | {
        timeZone: string;
        startAt: string;
        endAt: string;
        eventId: string;
        saved: boolean;
        requestId: string;
        status: "needs_review" | "appointment_confirmed" | "request_saved" | "approval_pending" | "slot_unavailable";
        appointmentConfirmed: boolean;
    }>;
};
/** Joins an already saved Phone request to the existing Calendar verification path. No proposal/event creation. */
export declare function createPhoneAppointmentCalendarReceiptReader(options: {
    db: TransactionalDbClient;
    calendar: PhoneAppointmentCalendar;
    now?: () => number;
}): (input: AuthenticatedScope, report: Readonly<StoredInboundReport>) => Promise<InboundCalendarReceipt | null>;
//# sourceMappingURL=phone-appointment-calendar.d.ts.map