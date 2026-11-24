import crypto from 'node:crypto';
import { Role } from '@thaara/contracts';
import { DbClient } from '../migrator.js';

export interface SessionRecord {
  id: string;
  user_id: string;
  workspace_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
  last_active_at: string;
}

export interface SessionScopeRecord {
  session_id: string;
  workspace_id: string;
  user_id: string;
  role: Role;
  expires_at: string;
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export class SessionRepository {
  constructor(private client: DbClient) {}

  async create(
    userId: string,
    workspaceId: string,
    rawToken: string,
    ttlSeconds = 86400 * 7 // 7 days
  ): Promise<SessionRecord> {
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const { rows } = await this.client.query<SessionRecord>(
      `INSERT INTO sessions (user_id, workspace_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, workspace_id, token_hash, expires_at, created_at, revoked_at, last_active_at;`,
      [userId, workspaceId, tokenHash, expiresAt]
    );
    return rows[0]!;
  }

  async resolveSessionScope(rawToken: string): Promise<SessionScopeRecord | null> {
    const tokenHash = hashSessionToken(rawToken);
    const { rows } = await this.client.query<SessionScopeRecord>(
      `SELECT session_id, workspace_id, user_id, role, expires_at
       FROM resolve_session_scope($1);`,
      [tokenHash]
    );
    return rows[0] ?? null;
  }

  async findActiveByRawToken(rawToken: string): Promise<SessionRecord | null> {
    const tokenHash = hashSessionToken(rawToken);
    const { rows } = await this.client.query<SessionRecord>(
      `SELECT id, user_id, workspace_id, token_hash, expires_at, created_at, revoked_at, last_active_at
       FROM sessions
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > NOW();`,
      [tokenHash]
    );
    return rows[0] ?? null;
  }

  async revoke(id: string): Promise<void> {
    await this.client.query(
      `UPDATE sessions SET revoked_at = NOW() WHERE id = $1;`,
      [id]
    );
  }

  async revokeByRawToken(rawToken: string): Promise<void> {
    const tokenHash = hashSessionToken(rawToken);
    await this.client.query(
      `UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1;`,
      [tokenHash]
    );
  }

  async touchLastActive(id: string): Promise<void> {
    await this.client.query(
      `UPDATE sessions SET last_active_at = NOW() WHERE id = $1;`,
      [id]
    );
  }
}
