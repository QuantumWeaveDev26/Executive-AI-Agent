import { GoogleSheetsConnectionView } from '@thaara/contracts';
import type { AuthenticatedScope, TransactionalDbClient } from '@thaara/db';
export declare const GOOGLE_SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
export declare const GOOGLE_DRIVE_READONLY_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export declare const GOOGLE_USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
export declare const REQUIRED_GOOGLE_SHEETS_SCOPES: readonly ["https://www.googleapis.com/auth/spreadsheets.readonly", "https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/userinfo.email"];
export declare class GoogleSheetsAccessError extends Error {
    readonly code: 'GOOGLE_ACCOUNT_NOT_CONNECTED' | 'SHEET_NOT_SHARED' | 'GOOGLE_AUTH_EXPIRED' | 'MISSING_SHEETS_SCOPE' | 'SHEET_OR_TAB_NOT_FOUND' | 'GOOGLE_API_UNAVAILABLE' | 'OAUTH_NOT_CONFIGURED' | 'INVALID_OAUTH_STATE';
    constructor(code: GoogleSheetsAccessError['code'], message: string);
}
export interface GoogleSheetsConnectionsServiceOptions {
    clientId?: string;
    clientSecret?: string;
    vaultKeyHex?: string;
    fetchFn?: typeof fetch;
    db?: TransactionalDbClient;
}
export declare class GoogleSheetsConnectionsService {
    private clientId;
    private clientSecret;
    private aesKey;
    private readonly fetchFn;
    private readonly db?;
    private readonly inMemory;
    private readonly pendingOAuthStates;
    private secretsLoaded;
    constructor(options?: GoogleSheetsConnectionsServiceOptions);
    private ensurePilotSecretsLoaded;
    isOAuthConfigured(): Promise<boolean>;
    private readonly recordKind;
    private listRecords;
    private getRecord;
    private saveRecord;
    listConnections(scope: AuthenticatedScope, dbOverride?: TransactionalDbClient): Promise<GoogleSheetsConnectionView[]>;
    getConnectionView(scope: AuthenticatedScope, connectionId: string, dbOverride?: TransactionalDbClient): Promise<GoogleSheetsConnectionView | null>;
    disconnectConnection(scope: AuthenticatedScope, connectionId: string, dbOverride?: TransactionalDbClient): Promise<boolean>;
    /**
     * Registers an already-authorized Google account connection (used by OAuth callback and controlled tests).
     * Never overwrites other Google accounts in the workspace.
     */
    upsertAuthorizedAccount(scope: AuthenticatedScope, input: {
        connectionId?: string;
        accountEmail: string;
        label?: string;
        accessToken: string;
        refreshToken?: string;
        expiresInSeconds: number;
        scopes: string[];
    }, dbOverride?: TransactionalDbClient): Promise<GoogleSheetsConnectionView>;
    createAuthorizationUrl(scope: AuthenticatedScope, input: {
        redirectUri: string;
        label?: string;
        returnTo?: string;
    }): Promise<{
        authUrl: string;
        state: string;
    }>;
    handleOAuthCallback(scope: AuthenticatedScope, input: {
        code: string;
        state: string;
    }, dbOverride?: TransactionalDbClient): Promise<{
        connection: GoogleSheetsConnectionView;
        returnTo?: string;
    }>;
    private resolveValidAccessToken;
    listSpreadsheets(scope: AuthenticatedScope, connectionId: string, dbOverride?: TransactionalDbClient): Promise<Array<{
        id: string;
        name: string;
        modifiedTime: string | null;
    }>>;
    readSpreadsheetTabCsv(scope: AuthenticatedScope, input: {
        connectionId: string;
        spreadsheetId: string;
        gid?: string;
        tabName?: string;
    }, dbOverride?: TransactionalDbClient): Promise<{
        spreadsheetId: string;
        spreadsheetName: string;
        tabName: string;
        tabId: string;
        accountEmail: string;
        csvText: string;
    }>;
}
//# sourceMappingURL=google-sheets-connections.d.ts.map