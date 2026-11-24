import type { TransactionalDbClient, DbClient } from '@thaara/db';
import { type InboundPrincipalTransactions } from './phone-inbound-principal.js';
import { type SarvamInboundServiceProfile } from './phone-sarvam-inbound-service.js';
import { type GoogleCalendarFoundation } from './google-calendar.js';
/** A distinct expiring/revocable grant must be provisioned for this exact call; never reuse a generic report grant. */
export declare function buildAppointmentBinding(profile: SarvamInboundServiceProfile, interactionId: string): Readonly<{
    profileFingerprint: string;
    routeId: string;
    workspaceId: string;
    ownerUserId: string;
    principalId: string;
    revision: number;
}>;
type Calendar = Pick<GoogleCalendarFoundation, 'writeReadiness' | 'findConflicts' | 'listEvents' | 'readEvent'>;
export interface InboundAppointmentOptions {
    profile: SarvamInboundServiceProfile;
    interactionId: string;
    transactions: InboundPrincipalTransactions<DbClient>;
    db: TransactionalDbClient;
    calendar: Calendar;
    now?: () => number;
    /** Trusted server-only integration port. Must return an actual existing owner session hash ONLY after
     * separate owner delegation for availability/proposal preparation. Never resolves from provider input.
     * This module independently authenticates it against the DB. No production resolver is installed. */
    resolveProposalOwnerSession: () => Promise<string | null>;
}
/** LOCAL TEST-ONLY composition; no startup registration, live delegation, migrations or new Calendar executor. */
export declare function createInboundAppointments(options: InboundAppointmentOptions): {
    request(routeId: string, authorization: string | undefined, raw: unknown): Promise<{
        saved: boolean;
        requestId: string;
        status: "needs_review" | "appointment_confirmed" | "request_saved" | "approval_pending" | "slot_unavailable";
        appointmentConfirmed: boolean;
    }>;
};
export {};
//# sourceMappingURL=phone-inbound-appointments.d.ts.map