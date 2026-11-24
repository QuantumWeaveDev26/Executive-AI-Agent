import { ApprovalRequest, GoogleCalendarAgendaQuery, GoogleCalendarAgendaResponse, GoogleCalendarBriefingQuery, GoogleCalendarBriefingResponse, GoogleCalendarCallback, GoogleCalendarCancelEventInput, GoogleCalendarConflictSummary, GoogleCalendarCreateEventInput, GoogleCalendarEvent, GoogleCalendarEventOrigin, GoogleCalendarListEvents, GoogleCalendarListEventsResponse, GoogleCalendarMutationReceipt, GoogleCalendarN8nContext, GoogleCalendarReminders, GoogleCalendarRescheduleEventInput, GoogleCalendarStatus, N8nWorkflowBlueprint, RequestScope } from '@thaara/contracts';
import { AuthenticatedScope } from '@thaara/db';
import { ActionAdapter, PolicyGateway } from '@thaara/policy';
export declare const GOOGLE_CALENDAR_READONLY = "https://www.googleapis.com/auth/calendar.readonly";
export declare const GOOGLE_CALENDAR_EVENTS_OWNED = "https://www.googleapis.com/auth/calendar.events.owned";
export declare const GOOGLE_CALENDAR_LIVE_SCOPES = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events.owned";
export declare const GOOGLE_CALENDAR_CREATE_EVENT_ACTION = "calendar.events.create";
export declare const GOOGLE_CALENDAR_RESCHEDULE_EVENT_ACTION = "calendar.events.reschedule";
export declare const GOOGLE_CALENDAR_CANCEL_EVENT_ACTION = "calendar.events.cancel";
export declare const GOOGLE_CALENDAR_MUTATION_ACTIONS: readonly ["calendar.events.create", "calendar.events.reschedule", "calendar.events.cancel"];
export declare const DEFAULT_CALENDAR_REMINDERS: GoogleCalendarReminders;
export declare function formatCalendarRemindersSummary(reminders?: GoogleCalendarReminders): string;
export declare function isCalendarMutationAction(name: unknown): name is (typeof GOOGLE_CALENDAR_MUTATION_ACTIONS)[number];
export type GoogleCalendarWriteReadinessReason = 'ready' | 'not_configured' | 'disconnected' | 'reconnect_required' | 'write_permission_missing' | 'account_unverified';
export interface GoogleCalendarWriteReadiness {
    ready: boolean;
    reason: GoogleCalendarWriteReadinessReason;
    connectedCalendar: string | null;
    status: GoogleCalendarStatus;
}
export interface GoogleCalendarCiphertextStore {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    take(key: string): string | undefined;
    delete(key: string): void;
}
export declare class GoogleCalendarVault {
    #private;
    private store;
    constructor(key: Buffer, store: GoogleCalendarCiphertextStore);
    private partition;
    set(scope: RequestScope, purpose: string, value: unknown): void;
    private open;
    get<T>(scope: RequestScope, purpose: string): T | undefined;
    take<T>(scope: RequestScope, purpose: string): T | undefined;
    delete(scope: RequestScope, purpose: string): void;
}
export interface GoogleCalendarTokens {
    accessToken: string;
    refreshToken?: string;
    scope: string;
    expiresIn: number;
}
export interface GoogleCalendarPrimaryMetadata {
    id?: string;
    summary?: string;
    timeZone?: string;
}
export interface GoogleCalendarProvider {
    readonly mode: 'mock' | 'live';
    exchange(input: {
        code: string;
        codeVerifier: string;
        clientId: string;
        redirectUri: string;
    }): Promise<GoogleCalendarTokens>;
    refresh?(input: {
        refreshToken: string;
        clientId: string;
    }): Promise<GoogleCalendarTokens>;
    revoke?(input: {
        token: string;
    }): Promise<void>;
    getPrimaryCalendar?(input: {
        accessToken: string;
    }): Promise<GoogleCalendarPrimaryMetadata>;
    listEvents(input: {
        accessToken: string;
        windowStart: string;
        windowEnd: string;
        timeZone: string;
        query?: string;
        includeCancelled: boolean;
        limit: number;
        pageToken?: string;
    }): Promise<unknown>;
    readEvent(input: {
        accessToken: string;
        eventId: string;
    }): Promise<unknown>;
    createEvent?(input: {
        accessToken: string;
        summary: string;
        description?: string;
        location?: string;
        startAt: string;
        endAt: string;
        timeZone: string;
        attendees?: string[];
        sendUpdates: 'all' | 'none';
        reminders?: GoogleCalendarReminders;
        origin?: GoogleCalendarEventOrigin;
    }): Promise<{
        id?: string;
        status?: string;
        reminders?: GoogleCalendarReminders;
    }>;
    updateEvent?(input: {
        accessToken: string;
        eventId: string;
        summary: string;
        newStartAt: string;
        newEndAt: string;
        timeZone: string;
        sendUpdates: 'all' | 'none';
        reminders?: GoogleCalendarReminders;
    }): Promise<{
        id?: string;
        status?: string;
        reminders?: GoogleCalendarReminders;
    }>;
    cancelEvent?(input: {
        accessToken: string;
        eventId: string;
        sendUpdates: 'all' | 'none';
    }): Promise<{
        id?: string;
        status?: string;
    }>;
}
export interface GoogleCalendarOptions {
    provider?: GoogleCalendarProvider;
    vault?: GoogleCalendarVault;
    clientId?: string;
    redirectUri?: string;
    allowLocalhostRedirect?: boolean;
    allowWriteScope?: boolean;
    now?: () => number;
}
type Audit = (scope: AuthenticatedScope, action: string, payload: Record<string, unknown>) => Promise<void>;
export declare function parseStrictRfc3339(value: string, fieldName: string): number;
export declare function validateIanaTimeZone(timeZone: string): string;
export declare function formatLocalDateInTimeZone(isoTimestamp: string, timeZone: string): string;
/**
 * Computes the exact UTC epoch milliseconds for local midnight (00:00:00.000) on (year, month, day)
 * in the specified IANA `timeZone` (e.g., Asia/Kolkata -> UTC-5h30m from UTC midnight).
 */
export declare function getZonedMidnightMs(year: number, month: number, day: number, timeZone: string): number;
export declare function getZonedHourMs(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number;
/**
 * Converts a YYYY-MM-DD date string into an ISO 8601 timestamp representing 00:00:00 in `timeZone`.
 */
export declare function parseIsoDateToZonedMidnightIso(dateStr: string, timeZone: string): string;
export declare function computeCalendarRangeWindowInTimeZone(preset: 'today' | 'tomorrow' | 'next_7_days' | 'prev_7_days', timeZone: string, nowMs?: number): {
    windowStart: string;
    windowEnd: string;
    localStartDate: string;
    localEndDate: string;
};
export declare class GoogleCalendarFoundation {
    private options;
    private readonly now;
    private readonly ready;
    constructor(options: GoogleCalendarOptions & {
        policyGateway: PolicyGateway;
        audit: Audit;
    });
    private get activeMode();
    private get supportsWriteScope();
    private authorize;
    private configured;
    private epoch;
    private unchanged;
    private validateWindow;
    private resolveCalendarIdentity;
    private tryRefresh;
    status(scope: AuthenticatedScope): Promise<GoogleCalendarStatus>;
    start(scope: AuthenticatedScope): Promise<{
        authorizationUrl: string;
        expiresAt: string;
        mode: "live" | "mock";
    }>;
    complete(scope: AuthenticatedScope, input: GoogleCalendarCallback): Promise<GoogleCalendarStatus>;
    disconnect(scope: AuthenticatedScope): Promise<GoogleCalendarStatus>;
    private connection;
    private providerCall;
    private recordOwnerSavedEvent;
    private enrichEventOwnership;
    listEvents(scope: AuthenticatedScope, input: GoogleCalendarListEvents): Promise<GoogleCalendarListEventsResponse>;
    readEvent(scope: AuthenticatedScope, eventId: string): Promise<GoogleCalendarEvent>;
    readAgenda(scope: AuthenticatedScope, input: GoogleCalendarAgendaQuery): Promise<GoogleCalendarAgendaResponse>;
    prepareBriefing(scope: AuthenticatedScope, input: GoogleCalendarBriefingQuery): Promise<GoogleCalendarBriefingResponse>;
    private resolveConnectedCalendarIdentityFromStatus;
    private ensureConnectionCalendarIdentity;
    writeReadiness(scope: AuthenticatedScope, kind?: 'create' | 'reschedule' | 'cancel'): Promise<GoogleCalendarWriteReadiness>;
    findConflicts(scope: AuthenticatedScope, input: {
        startAt: string;
        endAt: string;
        timeZone: string;
        excludeEventId?: string;
    }): Promise<GoogleCalendarConflictSummary[]>;
    createEvent(scope: AuthenticatedScope, input: GoogleCalendarCreateEventInput, approvedRequest: ApprovalRequest, idempotencyKey: string): Promise<GoogleCalendarMutationReceipt>;
    rescheduleEvent(scope: AuthenticatedScope, input: GoogleCalendarRescheduleEventInput, approvedRequest: ApprovalRequest, idempotencyKey: string): Promise<GoogleCalendarMutationReceipt>;
    cancelEvent(scope: AuthenticatedScope, input: GoogleCalendarCancelEventInput, approvedRequest: ApprovalRequest, idempotencyKey: string): Promise<GoogleCalendarMutationReceipt>;
    private buildMutationAdapter;
    createMutationAdapters(): Array<[string, ActionAdapter]>;
}
export declare function formatLocalTimeRangeInTimeZone(event: GoogleCalendarEvent, timeZone: string): string;
export declare function sanitizeUntrustedDescriptionSnippet(description?: string): string | undefined;
export declare function buildCalendarBriefingN8nBlueprint(input: {
    workflowName: string;
    n8nContext: GoogleCalendarN8nContext;
    conflictEventIds: string[];
}): {
    blueprint: N8nWorkflowBlueprint;
    workflowHash: string;
};
export interface SyntheticCalendarEventRecord extends Omit<GoogleCalendarEvent, 'untrusted' | 'mode'> {
    rawHtmlDescription?: string;
    conferenceJoinSecret?: string;
}
export declare class SyntheticGoogleCalendarProvider implements GoogleCalendarProvider {
    private readonly eventsByToken;
    private readonly tokenByCode;
    readonly mode: "mock";
    constructor(eventsByToken: ReadonlyMap<string, readonly SyntheticCalendarEventRecord[]>, tokenByCode?: ReadonlyMap<string, GoogleCalendarTokens>);
    exchange(input: {
        code: string;
        codeVerifier: string;
        clientId: string;
        redirectUri: string;
    }): Promise<GoogleCalendarTokens>;
    listEvents(input: {
        accessToken: string;
        windowStart: string;
        windowEnd: string;
        timeZone: string;
        query?: string;
        includeCancelled: boolean;
        limit: number;
        pageToken?: string;
    }): Promise<unknown>;
    readEvent(input: {
        accessToken: string;
        eventId: string;
    }): Promise<unknown>;
}
export {};
//# sourceMappingURL=google-calendar.d.ts.map