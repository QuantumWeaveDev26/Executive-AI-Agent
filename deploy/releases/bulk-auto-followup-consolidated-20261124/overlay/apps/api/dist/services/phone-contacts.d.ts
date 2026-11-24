import { type PhoneContactCreate, type PhoneContactUpdate } from '@thaara/contracts';
import type { AuthenticatedScope, PhoneContactRepository } from '@thaara/db';
/**
 * Owner contact management for AI calling. Consent is owner-attested and re-recorded (new reference, new time) on every
 * save, so editing a contact always re-affirms consent. Raw numbers are write-only: views carry the masked number.
 */
export declare class PhoneContactManagementService {
    private readonly repository?;
    private readonly now;
    constructor(repository?: PhoneContactRepository | undefined, now?: () => number);
    private repo;
    private view;
    private input;
    list(scope: AuthenticatedScope): Promise<{
        contacts: {
            contactId: string;
            maskedPhone: string;
            consent: {
                expiresAt: string;
                source: "recipient_verbal" | "recipient_written" | "recipient_message";
                callingAllowed: boolean;
                recordedAt: string;
                expired: boolean;
            };
            revision: number;
            displayName: string;
            aliases: string[];
            archived: boolean;
        }[];
    }>;
    create(scope: AuthenticatedScope, body: PhoneContactCreate): Promise<{
        contactId: string;
        maskedPhone: string;
        consent: {
            expiresAt: string;
            source: "recipient_verbal" | "recipient_written" | "recipient_message";
            callingAllowed: boolean;
            recordedAt: string;
            expired: boolean;
        };
        revision: number;
        displayName: string;
        aliases: string[];
        archived: boolean;
    }>;
    update(scope: AuthenticatedScope, contactId: string, body: PhoneContactUpdate): Promise<{
        contactId: string;
        maskedPhone: string;
        consent: {
            expiresAt: string;
            source: "recipient_verbal" | "recipient_written" | "recipient_message";
            callingAllowed: boolean;
            recordedAt: string;
            expired: boolean;
        };
        revision: number;
        displayName: string;
        aliases: string[];
        archived: boolean;
    }>;
    archive(scope: AuthenticatedScope, contactId: string, expectedRevision: number): Promise<{
        contactId: string;
        maskedPhone: string;
        consent: {
            expiresAt: string;
            source: "recipient_verbal" | "recipient_written" | "recipient_message";
            callingAllowed: boolean;
            recordedAt: string;
            expired: boolean;
        };
        revision: number;
        displayName: string;
        aliases: string[];
        archived: boolean;
    }>;
}
//# sourceMappingURL=phone-contacts.d.ts.map