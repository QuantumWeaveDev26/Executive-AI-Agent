import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  GoogleSheetsConnectionStatus,
  GoogleSheetsConnectionView
} from '@thaara/contracts';
import type { AuthenticatedScope, TransactionalDbClient } from '@thaara/db';
import { PILOT_GOOGLE_FILES } from './pilot-providers.js';

export const GOOGLE_SHEETS_READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
export const GOOGLE_DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const GOOGLE_USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';

export const REQUIRED_GOOGLE_SHEETS_SCOPES = [
  GOOGLE_SHEETS_READONLY_SCOPE,
  GOOGLE_DRIVE_READONLY_SCOPE,
  GOOGLE_USERINFO_EMAIL_SCOPE
] as const;

interface StoredOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAtIso: string;
  scope: string;
}

interface StoredGoogleSheetsConnectionRecord {
  connectionId: string;
  workspaceId: string;
  ownerUserId: string;
  accountEmail: string;
  label?: string;
  status: GoogleSheetsConnectionStatus;
  scopes: string[];
  connectedAt: string;
  lastVerifiedAt?: string;
  lastError?: string | null;
  encryptedTokens: string;
}

interface PendingOAuthState {
  workspaceId: string;
  userId: string;
  codeVerifier: string;
  redirectUri: string;
  label?: string;
  returnTo?: string;
  expiresAtMs: number;
}

export class GoogleSheetsAccessError extends Error {
  public readonly code:
    | 'GOOGLE_ACCOUNT_NOT_CONNECTED'
    | 'SHEET_NOT_SHARED'
    | 'GOOGLE_AUTH_EXPIRED'
    | 'MISSING_SHEETS_SCOPE'
    | 'SHEET_OR_TAB_NOT_FOUND'
    | 'GOOGLE_API_UNAVAILABLE'
    | 'OAUTH_NOT_CONFIGURED'
    | 'INVALID_OAUTH_STATE';

  constructor(code: GoogleSheetsAccessError['code'], message: string) {
    super(message);
    this.name = 'GoogleSheetsAccessError';
    this.code = code;
  }
}

export interface GoogleSheetsConnectionsServiceOptions {
  clientId?: string;
  clientSecret?: string;
  vaultKeyHex?: string;
  fetchFn?: typeof fetch;
  db?: TransactionalDbClient;
}

function toSafeView(rec: StoredGoogleSheetsConnectionRecord): GoogleSheetsConnectionView {
  return {
    connectionId: rec.connectionId,
    workspaceId: rec.workspaceId,
    accountEmail: rec.accountEmail,
    ...(rec.label ? { label: rec.label } : {}),
    status: rec.status,
    scopes: rec.scopes,
    connectedAt: rec.connectedAt,
    ...(rec.lastVerifiedAt ? { lastVerifiedAt: rec.lastVerifiedAt } : {}),
    ...(rec.lastError !== undefined ? { lastError: rec.lastError } : {})
  };
}

function csvEscapeCell(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function deriveAesKey(vaultKeyHex?: string): Buffer {
  if (vaultKeyHex && /^[0-9a-f]{64}$/i.test(vaultKeyHex.trim())) {
    return Buffer.from(vaultKeyHex.trim(), 'hex');
  }
  const secret = process.env.GOOGLE_VAULT_KEY || process.env.SESSION_SECRET || 'thaara-v2-dev-sheets-vault-key';
  return createHash('sha256').update(secret).digest();
}

function encryptTokens(tokens: StoredOAuthTokens, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(tokens), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptTokens(encoded: string, key: Buffer): StoredOAuthTokens {
  const raw = Buffer.from(encoded, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext) as StoredOAuthTokens;
}

function hasRequiredSheetsScope(scopes: string[]): boolean {
  return scopes.some(
    s =>
      s === GOOGLE_SHEETS_READONLY_SCOPE ||
      s === 'https://www.googleapis.com/auth/spreadsheets' ||
      s === GOOGLE_DRIVE_READONLY_SCOPE ||
      s === 'https://www.googleapis.com/auth/drive'
  );
}

export const PILOT_GOOGLE_SHEETS_FILES = {
  clientId: '/run/secrets/google_sheets_client_id',
  clientSecret: '/run/secrets/google_sheets_client_secret'
} as const;

export class GoogleSheetsConnectionsService {
  private clientId: string | undefined;
  private clientSecret: string | undefined;
  private aesKey: Buffer;
  private readonly fetchFn: typeof fetch;
  private readonly db?: TransactionalDbClient;
  private readonly inMemory = new Map<string, StoredGoogleSheetsConnectionRecord>();
  private readonly pendingOAuthStates = new Map<string, PendingOAuthState>();
  private secretsLoaded = false;

  constructor(options: GoogleSheetsConnectionsServiceOptions = {}) {
    this.clientId = options.clientId ?? process.env.GOOGLE_SHEETS_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
    this.clientSecret = options.clientSecret ?? process.env.GOOGLE_SHEETS_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
    this.aesKey = deriveAesKey(options.vaultKeyHex);
    this.fetchFn = options.fetchFn ?? fetch;
    this.db = options.db;
  }

  private async ensurePilotSecretsLoaded(): Promise<void> {
    if (this.secretsLoaded) return;
    this.secretsLoaded = true;
    if (this.clientId && this.clientSecret) return;
    try {
      const [sheetsCid, sheetsCsec, sharedCid, sharedCsec, vkey] = await Promise.all([
        readFile(PILOT_GOOGLE_SHEETS_FILES.clientId, 'utf8').catch(() => ''),
        readFile(PILOT_GOOGLE_SHEETS_FILES.clientSecret, 'utf8').catch(() => ''),
        readFile(PILOT_GOOGLE_FILES.clientId, 'utf8').catch(() => ''),
        readFile(PILOT_GOOGLE_FILES.clientSecret, 'utf8').catch(() => ''),
        readFile(PILOT_GOOGLE_FILES.vaultKey, 'utf8').catch(() => '')
      ]);
      const resolvedCid = sheetsCid.trim() || sharedCid.trim();
      const resolvedCsec = sheetsCsec.trim() || sharedCsec.trim();
      if (!this.clientId && resolvedCid) this.clientId = resolvedCid;
      if (!this.clientSecret && resolvedCsec) this.clientSecret = resolvedCsec;
      if (vkey.trim() && /^[0-9a-f]{64}$/i.test(vkey.trim())) {
        this.aesKey = deriveAesKey(vkey.trim());
      }
    } catch {
      // Non-pilot environment without /run/secrets
    }
  }

  async isOAuthConfigured(): Promise<boolean> {
    await this.ensurePilotSecretsLoaded();
    return Boolean(this.clientId && this.clientSecret);
  }

  private readonly recordKind = 'google_sheets_connection';

  private async listRecords(scope: AuthenticatedScope, dbOverride?: TransactionalDbClient): Promise<StoredGoogleSheetsConnectionRecord[]> {
    const db = dbOverride ?? this.db;
    if (db) {
      const rows = await db.withScopedTransaction(scope, async tx => {
        const res = await tx.query<{ metadata: { googleSheetsConnection?: StoredGoogleSheetsConnectionRecord } }>(
          `SELECT metadata FROM plans
           WHERE workspace_id = $1 AND metadata->>'recordKind' = $2
           ORDER BY updated_at DESC`,
          [scope.workspaceId, this.recordKind]
        );
        return res.rows;
      });
      return rows
        .map(r => r.metadata?.googleSheetsConnection)
        .filter((r): r is StoredGoogleSheetsConnectionRecord => Boolean(r && r.status !== 'disconnected'));
    }
    return [...this.inMemory.values()].filter(
      r => r.workspaceId === scope.workspaceId && r.status !== 'disconnected'
    );
  }

  private async getRecord(
    scope: AuthenticatedScope,
    connectionId: string,
    dbOverride?: TransactionalDbClient
  ): Promise<StoredGoogleSheetsConnectionRecord | null> {
    const db = dbOverride ?? this.db;
    if (db) {
      const res = await db.withScopedTransaction(scope, async tx => {
        return tx.query<{ metadata: { googleSheetsConnection?: StoredGoogleSheetsConnectionRecord } }>(
          `SELECT metadata FROM plans
           WHERE workspace_id = $1
             AND metadata->>'recordKind' = $2
             AND metadata->>'connectionId' = $3
           ORDER BY updated_at DESC
           LIMIT 1`,
          [scope.workspaceId, this.recordKind, connectionId]
        );
      });
      return res.rows[0]?.metadata?.googleSheetsConnection ?? null;
    }
    const rec = this.inMemory.get(`${scope.workspaceId}:${connectionId}`) ?? null;
    return rec && rec.workspaceId === scope.workspaceId ? rec : null;
  }

  private async saveRecord(
    scope: AuthenticatedScope,
    record: StoredGoogleSheetsConnectionRecord,
    dbOverride?: TransactionalDbClient
  ): Promise<StoredGoogleSheetsConnectionRecord> {
    const db = dbOverride ?? this.db;
    if (db) {
      const metadataJson = JSON.stringify({
        recordKind: this.recordKind,
        connectionId: record.connectionId,
        googleSheetsConnection: record
      });
      await db.withScopedTransaction(scope, async tx => {
        const existing = await tx.query<{ id: string }>(
          `SELECT id FROM plans
           WHERE workspace_id = $1
             AND metadata->>'recordKind' = $2
             AND metadata->>'connectionId' = $3
           LIMIT 1`,
          [scope.workspaceId, this.recordKind, record.connectionId]
        );
        if (existing.rows[0]?.id) {
          await tx.query(
            `UPDATE plans
             SET title = $1,
                 version = version + 1,
                 metadata = $2::jsonb,
                 updated_at = now()
             WHERE workspace_id = $3 AND id = $4`,
            [`Google Sheets (${record.accountEmail})`, metadataJson, scope.workspaceId, existing.rows[0].id]
          );
        } else {
          await tx.query(
            `INSERT INTO plans (workspace_id, created_by_user_id, title, description, status, version, metadata)
             VALUES (
               $1,
               COALESCE(
                 (SELECT id FROM users WHERE id = $2 LIMIT 1),
                 (SELECT user_id FROM memberships WHERE workspace_id = $1 ORDER BY created_at ASC LIMIT 1),
                 $2::uuid
               ),
               $3,
               $4,
               'draft',
               1,
               $5::jsonb
             )`,
            [
              scope.workspaceId,
              scope.userId || record.ownerUserId,
              `Google Sheets (${record.accountEmail})`,
              'Multi-account Google Sheets OAuth connection',
              metadataJson
            ]
          );
        }
      });
      return record;
    }
    this.inMemory.set(`${scope.workspaceId}:${record.connectionId}`, record);
    return record;
  }

  async listConnections(scope: AuthenticatedScope, dbOverride?: TransactionalDbClient): Promise<GoogleSheetsConnectionView[]> {
    const recs = await this.listRecords(scope, dbOverride);
    return recs.map(toSafeView);
  }

  async getConnectionView(
    scope: AuthenticatedScope,
    connectionId: string,
    dbOverride?: TransactionalDbClient
  ): Promise<GoogleSheetsConnectionView | null> {
    const rec = await this.getRecord(scope, connectionId, dbOverride);
    return rec && rec.status !== 'disconnected' ? toSafeView(rec) : null;
  }

  async disconnectConnection(
    scope: AuthenticatedScope,
    connectionId: string,
    dbOverride?: TransactionalDbClient
  ): Promise<boolean> {
    const rec = await this.getRecord(scope, connectionId, dbOverride);
    if (!rec) return false;
    await this.saveRecord(
      scope,
      {
        ...rec,
        status: 'disconnected',
        encryptedTokens: '',
        lastError: null
      },
      dbOverride
    );
    return true;
  }

  /**
   * Registers an already-authorized Google account connection (used by OAuth callback and controlled tests).
   * Never overwrites other Google accounts in the workspace.
   */
  async upsertAuthorizedAccount(
    scope: AuthenticatedScope,
    input: {
      connectionId?: string;
      accountEmail: string;
      label?: string;
      accessToken: string;
      refreshToken?: string;
      expiresInSeconds: number;
      scopes: string[];
    },
    dbOverride?: TransactionalDbClient
  ): Promise<GoogleSheetsConnectionView> {
    const email = input.accountEmail.trim().toLowerCase();
    const existingAll = await this.listRecords(scope, dbOverride);
    const sameEmail = existingAll.find(r => r.accountEmail.toLowerCase() === email);
    const connectionId = input.connectionId ?? sameEmail?.connectionId ?? `gsheet_conn_${randomUUID().slice(0, 12)}`;
    const nowIso = new Date().toISOString();
    const expiresAtIso = new Date(Date.now() + Math.max(60, input.expiresInSeconds) * 1000).toISOString();
    const missingScope = !hasRequiredSheetsScope(input.scopes);

    const record: StoredGoogleSheetsConnectionRecord = {
      connectionId,
      workspaceId: scope.workspaceId,
      ownerUserId: scope.userId,
      accountEmail: email,
      ...(input.label?.trim() ? { label: input.label.trim().slice(0, 120) } : sameEmail?.label ? { label: sameEmail.label } : {}),
      status: missingScope ? 'missing_scopes' : 'connected',
      scopes: input.scopes,
      connectedAt: sameEmail?.connectedAt ?? nowIso,
      lastVerifiedAt: nowIso,
      lastError: missingScope
        ? `Google account ${email} is missing Google Sheets read permission. Reconnect and grant Sheets read access.`
        : null,
      encryptedTokens: encryptTokens(
        {
          accessToken: input.accessToken,
          ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
          expiresAtIso,
          scope: input.scopes.join(' ')
        },
        this.aesKey
      )
    };
    await this.saveRecord(scope, record, dbOverride);
    return toSafeView(record);
  }

  async createAuthorizationUrl(
    scope: AuthenticatedScope,
    input: { redirectUri: string; label?: string; returnTo?: string }
  ): Promise<{ authUrl: string; state: string }> {
    await this.ensurePilotSecretsLoaded();
    if (!this.clientId || !this.clientSecret) {
      throw new GoogleSheetsAccessError(
        'OAUTH_NOT_CONFIGURED',
        'Google OAuth client credentials are not configured on this server.'
      );
    }
    const state = randomBytes(24).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    this.pendingOAuthStates.set(state, {
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      codeVerifier,
      redirectUri: input.redirectUri,
      ...(input.label?.trim() ? { label: input.label.trim() } : {}),
      ...(input.returnTo?.trim() ? { returnTo: input.returnTo.trim() } : {}),
      expiresAtMs: Date.now() + 10 * 60_000
    });

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: REQUIRED_GOOGLE_SHEETS_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent select_account',
      include_granted_scopes: 'true',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state
    });
    return {
      authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state
    };
  }

  async handleOAuthCallback(
    scope: AuthenticatedScope,
    input: { code: string; state: string },
    dbOverride?: TransactionalDbClient
  ): Promise<{ connection: GoogleSheetsConnectionView; returnTo?: string }> {
    await this.ensurePilotSecretsLoaded();
    const pending = this.pendingOAuthStates.get(input.state);
    this.pendingOAuthStates.delete(input.state);
    if (!pending || pending.expiresAtMs < Date.now() || pending.workspaceId !== scope.workspaceId) {
      throw new GoogleSheetsAccessError(
        'INVALID_OAUTH_STATE',
        'Google authorization session expired or did not match your workspace. Please try connecting again.'
      );
    }
    if (!this.clientId || !this.clientSecret) {
      throw new GoogleSheetsAccessError('OAUTH_NOT_CONFIGURED', 'Google OAuth client credentials are not configured.');
    }

    const tokenResp = await this.fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: input.code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: pending.redirectUri,
        code_verifier: pending.codeVerifier,
        grant_type: 'authorization_code'
      }).toString()
    });
    const tokenJson = (await tokenResp.json()) as Record<string, unknown>;
    if (!tokenResp.ok || typeof tokenJson.access_token !== 'string') {
      throw new GoogleSheetsAccessError(
        'GOOGLE_AUTH_EXPIRED',
        'Google OAuth token exchange failed. Please reconnect your Google account.'
      );
    }

    const userResp = await this.fetchFn('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` }
    });
    const userJson = (await userResp.json()) as { email?: string };
    const accountEmail = userJson.email?.trim().toLowerCase();
    if (!userResp.ok || !accountEmail) {
      throw new GoogleSheetsAccessError(
        'GOOGLE_API_UNAVAILABLE',
        'Could not verify Google account email address from Google OAuth.'
      );
    }

    const scopes = String(tokenJson.scope ?? REQUIRED_GOOGLE_SHEETS_SCOPES.join(' '))
      .split(/\s+/)
      .filter(Boolean);
    const connection = await this.upsertAuthorizedAccount(
      scope,
      {
        accountEmail,
        ...(pending.label ? { label: pending.label } : {}),
        accessToken: tokenJson.access_token,
        ...(typeof tokenJson.refresh_token === 'string' ? { refreshToken: tokenJson.refresh_token } : {}),
        expiresInSeconds: typeof tokenJson.expires_in === 'number' ? tokenJson.expires_in : 3600,
        scopes
      },
      dbOverride
    );
    return { connection, ...(pending.returnTo ? { returnTo: pending.returnTo } : {}) };
  }

  private async resolveValidAccessToken(
    scope: AuthenticatedScope,
    connectionId: string,
    dbOverride?: TransactionalDbClient
  ): Promise<{ record: StoredGoogleSheetsConnectionRecord; accessToken: string }> {
    const rec = await this.getRecord(scope, connectionId, dbOverride);
    if (!rec || rec.status === 'disconnected' || !rec.encryptedTokens) {
      throw new GoogleSheetsAccessError(
        'GOOGLE_ACCOUNT_NOT_CONNECTED',
        'Selected Google account is not connected. Connect a Google account first.'
      );
    }
    if (rec.status === 'missing_scopes' || !hasRequiredSheetsScope(rec.scopes)) {
      throw new GoogleSheetsAccessError(
        'MISSING_SHEETS_SCOPE',
        `Google account ${rec.accountEmail} is missing Google Sheets read permission. Reconnect and grant Sheets read access.`
      );
    }
    const tokens = decryptTokens(rec.encryptedTokens, this.aesKey);
    const expiresAtMs = Date.parse(tokens.expiresAtIso);
    if (Number.isFinite(expiresAtMs) && expiresAtMs > Date.now() + 60_000) {
      return { record: rec, accessToken: tokens.accessToken };
    }

    // Refresh expired token
    if (!tokens.refreshToken) {
      await this.saveRecord(
        scope,
        { ...rec, status: 'expired', lastError: `Google authorization expired for ${rec.accountEmail}. Please reconnect.` },
        dbOverride
      );
      throw new GoogleSheetsAccessError(
        'GOOGLE_AUTH_EXPIRED',
        `Google authorization expired for ${rec.accountEmail}. Please reconnect this Google account.`
      );
    }

    await this.ensurePilotSecretsLoaded();
    if (!this.clientId || !this.clientSecret) {
      throw new GoogleSheetsAccessError('OAUTH_NOT_CONFIGURED', 'Google OAuth credentials are not configured.');
    }
    const refreshResp = await this.fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token'
      }).toString()
    });
    const refreshJson = (await refreshResp.json()) as Record<string, unknown>;
    if (!refreshResp.ok || typeof refreshJson.access_token !== 'string') {
      await this.saveRecord(
        scope,
        { ...rec, status: 'expired', lastError: `Google authorization expired for ${rec.accountEmail}. Please reconnect.` },
        dbOverride
      );
      throw new GoogleSheetsAccessError(
        'GOOGLE_AUTH_EXPIRED',
        `Google authorization expired for ${rec.accountEmail}. Please reconnect this Google account.`
      );
    }
    const nextTokens: StoredOAuthTokens = {
      accessToken: refreshJson.access_token,
      refreshToken: typeof refreshJson.refresh_token === 'string' ? refreshJson.refresh_token : tokens.refreshToken,
      expiresAtIso: new Date(Date.now() + (typeof refreshJson.expires_in === 'number' ? refreshJson.expires_in : 3600) * 1000).toISOString(),
      scope: typeof refreshJson.scope === 'string' ? refreshJson.scope : tokens.scope
    };
    const updatedRec: StoredGoogleSheetsConnectionRecord = {
      ...rec,
      status: 'connected',
      lastVerifiedAt: new Date().toISOString(),
      lastError: null,
      encryptedTokens: encryptTokens(nextTokens, this.aesKey)
    };
    await this.saveRecord(scope, updatedRec, dbOverride);
    return { record: updatedRec, accessToken: nextTokens.accessToken };
  }

  async listSpreadsheets(
    scope: AuthenticatedScope,
    connectionId: string,
    dbOverride?: TransactionalDbClient
  ): Promise<Array<{ id: string; name: string; modifiedTime: string | null }>> {
    const { accessToken, record } = await this.resolveValidAccessToken(scope, connectionId, dbOverride);
    const params = new URLSearchParams({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: 'files(id,name,modifiedTime)',
      pageSize: '25',
      orderBy: 'modifiedTime desc'
    });
    const resp = await this.fetchFn(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (resp.status === 401) {
      await this.saveRecord(scope, { ...record, status: 'expired', lastError: `Google authorization expired for ${record.accountEmail}.` }, dbOverride);
      throw new GoogleSheetsAccessError('GOOGLE_AUTH_EXPIRED', `Google authorization expired for ${record.accountEmail}. Please reconnect.`);
    }
    if (!resp.ok) {
      throw new GoogleSheetsAccessError('GOOGLE_API_UNAVAILABLE', `Google Drive API returned HTTP ${resp.status}.`);
    }
    const data = (await resp.json()) as { files?: Array<{ id: string; name: string; modifiedTime?: string }> };
    return (data.files ?? []).map(f => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime ?? null
    }));
  }

  async readSpreadsheetTabCsv(
    scope: AuthenticatedScope,
    input: { connectionId: string; spreadsheetId: string; gid?: string; tabName?: string },
    dbOverride?: TransactionalDbClient
  ): Promise<{
    spreadsheetId: string;
    spreadsheetName: string;
    tabName: string;
    tabId: string;
    accountEmail: string;
    csvText: string;
  }> {
    const { accessToken, record } = await this.resolveValidAccessToken(scope, input.connectionId, dbOverride);
    const metaResp = await this.fetchFn(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}?fields=properties.title,sheets(properties(sheetId,title,index))`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (metaResp.status === 401) {
      await this.saveRecord(scope, { ...record, status: 'expired', lastError: `Google authorization expired for ${record.accountEmail}.` }, dbOverride);
      throw new GoogleSheetsAccessError('GOOGLE_AUTH_EXPIRED', `Google authorization expired for ${record.accountEmail}. Please reconnect.`);
    }
    if (metaResp.status === 403) {
      const errBody = await metaResp.text().catch(() => '');
      if (/insufficient|scope/i.test(errBody)) {
        throw new GoogleSheetsAccessError(
          'MISSING_SHEETS_SCOPE',
          `Google account ${record.accountEmail} is missing Google Sheets read permission. Reconnect and grant Sheets read access.`
        );
      }
      throw new GoogleSheetsAccessError(
        'SHEET_NOT_SHARED',
        `This Google Sheet is not shared with ${record.accountEmail}. Share it with ${record.accountEmail} (Viewer/Read-only) or connect the owning Google account.`
      );
    }
    if (metaResp.status === 404) {
      throw new GoogleSheetsAccessError('SHEET_OR_TAB_NOT_FOUND', 'Spreadsheet was not found. Check the Google Sheet URL.');
    }
    if (!metaResp.ok) {
      throw new GoogleSheetsAccessError('GOOGLE_API_UNAVAILABLE', `Google Sheets API is temporarily unavailable (HTTP ${metaResp.status}).`);
    }

    const meta = (await metaResp.json()) as {
      properties?: { title?: string };
      sheets?: Array<{ properties?: { sheetId?: number; title?: string; index?: number } }>;
    };
    const sheets = meta.sheets ?? [];
    let targetSheet = sheets[0];
    if (input.gid) {
      const matchedByGid = sheets.find(s => String(s.properties?.sheetId ?? '') === input.gid);
      if (!matchedByGid) {
        throw new GoogleSheetsAccessError(
          'SHEET_OR_TAB_NOT_FOUND',
          `Tab gid=${input.gid} was not found in "${meta.properties?.title ?? input.spreadsheetId}".`
        );
      }
      targetSheet = matchedByGid;
    } else if (input.tabName && input.tabName !== 'Sheet1') {
      const matchedByName = sheets.find(s => s.properties?.title === input.tabName);
      if (!matchedByName) {
        throw new GoogleSheetsAccessError(
          'SHEET_OR_TAB_NOT_FOUND',
          `Tab "${input.tabName}" was not found in "${meta.properties?.title ?? input.spreadsheetId}".`
        );
      }
      targetSheet = matchedByName;
    }

    const resolvedTabTitle = targetSheet?.properties?.title ?? input.tabName ?? 'Sheet1';
    const resolvedTabId = String(targetSheet?.properties?.sheetId ?? input.gid ?? '0');
    const spreadsheetName = meta.properties?.title?.trim() || 'Google Sheet';

    const range = `${resolvedTabTitle}!A1:ZZ`;
    const valuesResp = await this.fetchFn(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}/values/${encodeURIComponent(range)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!valuesResp.ok) {
      if (valuesResp.status === 403) {
        throw new GoogleSheetsAccessError(
          'SHEET_NOT_SHARED',
          `This Google Sheet is not shared with ${record.accountEmail}.`
        );
      }
      if (valuesResp.status === 404) {
        throw new GoogleSheetsAccessError('SHEET_OR_TAB_NOT_FOUND', `Tab "${resolvedTabTitle}" was not found.`);
      }
      throw new GoogleSheetsAccessError('GOOGLE_API_UNAVAILABLE', `Google Sheets values API returned HTTP ${valuesResp.status}.`);
    }

    const valuesJson = (await valuesResp.json()) as { values?: unknown[][] };
    const rows = valuesJson.values ?? [];
    const csvText = rows.map(row => row.map(csvEscapeCell).join(',')).join('\n');

    await this.saveRecord(
      scope,
      { ...record, status: 'connected', lastVerifiedAt: new Date().toISOString(), lastError: null },
      dbOverride
    );

    return {
      spreadsheetId: input.spreadsheetId,
      spreadsheetName,
      tabName: resolvedTabTitle,
      tabId: resolvedTabId,
      accountEmail: record.accountEmail,
      csvText
    };
  }
}
