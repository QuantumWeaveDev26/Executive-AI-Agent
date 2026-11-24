import type { AuthenticatedScope, TransactionalDbClient } from '@thaara/db';
/** Exact currently authenticated owner, never an owner session selected or delegated by a provider. */
export declare function authenticatePhoneAppointmentOwner(db: TransactionalDbClient, input: AuthenticatedScope): Promise<Readonly<AuthenticatedScope>>;
/** Same strict owner-side slot body for either direction; it contains no identity, grants or approval. */
export declare function readPhoneAppointmentSlot(raw: unknown, now: number, requireFuture?: boolean): {
    timeZone: string;
    startAt: string;
    endAt: string;
};
//# sourceMappingURL=phone-appointment-owner.d.ts.map