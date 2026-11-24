import pg from 'pg';
import { RequestScope } from '@thaara/contracts';
export { DbClient } from './migrator.js';
import { DbClient } from './migrator.js';

const { Pool } = pg;

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface AuthenticatedScope extends RequestScope {
  /**
   * Cryptographic SHA-256 hash of the authenticated session token.
   * Derived exclusively on the server from the authenticated session cookie.
   * MANDATORY: never optional, never null, never empty.
   * NEVER accepted from client input; NEVER exposed in contracts, logs, or errors.
   */
  readonly sessionTokenHash: string;
}

export interface TransactionalDbClient extends DbClient {
  withWhatsAppRelayTransaction?<T>(tokenHash: string, connectionId: string, operation: WhatsAppRelayOperation, work: (client: DbClient, scope: WhatsAppRelayScope) => Promise<T>): Promise<T>;
  withScopedTransaction<T>(
    scope: AuthenticatedScope,
    operation: (client: DbClient) => Promise<T>
  ): Promise<T>;
  withAuthenticatedScope<T>(
    sessionTokenHash: string,
    operation: (client: DbClient) => Promise<T>
  ): Promise<T>;
}

export type WhatsAppRelayOperation = 'events' | 'claim' | 'receipts';
/** Server-only callback identity. This is never a browser session or a public API payload. */
export interface WhatsAppRelayScope extends RequestScope {
  readonly authKind: 'whatsapp_relay';
  readonly principalId: string;
  readonly connectionId: string;
  readonly revision: number;
  readonly operation: WhatsAppRelayOperation;
  readonly relayTokenHash: string;
}
export type WhatsAppExecutionScope = AuthenticatedScope | WhatsAppRelayScope;
export const isWhatsAppRelayScope = (scope: WhatsAppExecutionScope): scope is WhatsAppRelayScope => (scope as WhatsAppRelayScope).authKind === 'whatsapp_relay';

export class PostgresDatabase implements TransactionalDbClient {
  private pool: pg.Pool;

  constructor(connectionStringOrPool: string | pg.Pool) {
    if (typeof connectionStringOrPool === 'string') {
      this.pool = new Pool({
        connectionString: connectionStringOrPool,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      });
    } else {
      this.pool = connectionStringOrPool;
    }
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async withWhatsAppRelayTransaction<T>(tokenHash: string, connectionId: string, operation: WhatsAppRelayOperation, work: (client: DbClient, scope: WhatsAppRelayScope) => Promise<T>): Promise<T> {
    const fail = () => new ScopeError('WhatsApp callback scope unavailable or unauthorized.');
    if (!/^[a-f0-9]{64}$/.test(tokenHash) || !/^[a-zA-Z0-9_-]{1,128}$/.test(connectionId) || !['events', 'claim', 'receipts'].includes(operation)) throw fail();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN;');
      const flags = (await client.query(`SELECT r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,
        pg_catalog.pg_has_role(current_user,'thaara_app','USAGE') AS app_member,
        EXISTS (SELECT 1 FROM pg_catalog.pg_roles t WHERE t.rolname IN ('thaara_admin','thaara_worker','thaara_seeder','thaara_whatsapp_audit_guard')
          AND pg_catalog.pg_has_role(current_user,t.oid,'MEMBER')) AS elevated
        FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`)).rows[0];
      if (!flags || flags.app_member !== true || ['rolsuper','rolbypassrls','rolcreaterole','rolcreatedb','rolreplication','elevated'].some(k => flags[k] !== false)) throw fail();
      await client.query("SELECT pg_catalog.set_config('app.session_token_hash', $1, true)", ['']);
      await client.query("SELECT pg_catalog.set_config('app.whatsapp_relay_token_hash', $1, true)", [tokenHash]);
      await client.query("SELECT pg_catalog.set_config('app.whatsapp_relay_connection', $1, true)", [connectionId]);
      await client.query("SELECT pg_catalog.set_config('app.whatsapp_relay_operation', $1, true)", [operation]);
      const readActor = async () => {
        const rows = (await client.query('SELECT * FROM public.current_whatsapp_runtime_scope()')).rows;
        const a = rows[0], uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
        if (rows.length !== 1 || !a || !uuid.test(a.workspace_id) || !uuid.test(a.user_id) || !uuid.test(a.principal_id)
          || !['owner','admin','member'].includes(a.role) || a.connection_id !== connectionId || a.relay_operation !== operation || !Number.isSafeInteger(Number(a.revision)) || Number(a.revision) < 1) throw fail();
        return Object.freeze({ authKind: 'whatsapp_relay' as const, workspaceId: a.workspace_id, userId: a.user_id, role: a.role,
          principalId: a.principal_id, connectionId, revision: Number(a.revision), operation, relayTokenHash: tokenHash }) as WhatsAppRelayScope;
      };
      const scope = await readActor();
      const wrapped: DbClient = { query: async <R = any>(sql: string, params?: any[]) => ({ rows: (await client.query(sql, params)).rows as R[] }), exec: async sql => { await client.query(sql); } };
      const result = await work(wrapped, scope);
      const current = await readActor();
      if (JSON.stringify(scope) !== JSON.stringify(current)) throw fail();
      await client.query('COMMIT;'); return result;
    } catch (error) { await client.query('ROLLBACK;'); throw error; }
    finally { client.release(); }
  }

  async query<R = any>(sql: string, params?: any[]): Promise<{ rows: R[] }> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows };
  }

  async withAuthenticatedScope<T>(
    sessionTokenHash: string,
    operation: (client: DbClient) => Promise<T>
  ): Promise<T> {
    if (!sessionTokenHash || typeof sessionTokenHash !== 'string' || !sessionTokenHash.trim()) {
      throw new ScopeError('Missing mandatory sessionTokenHash in withAuthenticatedScope: database transactions strictly require a server-derived session token hash.');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN;');
      await client.query("SELECT pg_catalog.set_config('app.session_token_hash', $1, true);", [sessionTokenHash]);

      const wrappedClient: DbClient = {
        query: async <R = any>(sql: string, params?: any[]) => {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[] };
        },
        exec: async (sql: string) => {
          await client.query(sql);
        }
      };

      const result = await operation(wrappedClient);
      await client.query('COMMIT;');
      return result;
    } catch (err) {
      await client.query('ROLLBACK;');
      throw err;
    } finally {
      client.release();
    }
  }

  async withScopedTransaction<T>(
    scope: AuthenticatedScope,
    operation: (client: DbClient) => Promise<T>
  ): Promise<T> {
    if (!scope?.sessionTokenHash || typeof scope.sessionTokenHash !== 'string' || !scope.sessionTokenHash.trim()) {
      throw new ScopeError('Missing mandatory sessionTokenHash in AuthenticatedScope: database transactions strictly require a server-derived session token hash.');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN;');
      // Set transaction-local session variables for RLS and procedure authorization
      await client.query("SELECT pg_catalog.set_config('app.session_token_hash', $1, true);", [scope.sessionTokenHash]);
      await client.query("SELECT pg_catalog.set_config('app.workspace_id', $1, true);", [scope.workspaceId ?? '']);
      await client.query("SELECT pg_catalog.set_config('app.user_id', $1, true);", [scope.userId ?? '']);
      await client.query("SELECT pg_catalog.set_config('app.role', $1, true);", [scope.role ?? '']);

      const wrappedClient: DbClient = {
        query: async <R = any>(sql: string, params?: any[]) => {
          const res = await client.query(sql, params);
          return { rows: res.rows as R[] };
        },
        exec: async (sql: string) => {
          await client.query(sql);
        }
      };

      const result = await operation(wrappedClient);
      await client.query('COMMIT;');
      return result;
    } catch (err) {
      await client.query('ROLLBACK;');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export type AllowedTargetPrivilegeRole = 'thaara_admin' | 'thaara_worker' | 'thaara_seeder';

const ALLOWED_TARGET_ROLES = new Set<AllowedTargetPrivilegeRole>([
  'thaara_admin',
  'thaara_worker',
  'thaara_seeder'
]);

export interface RoleAwareCheckoutClient extends DbClient {
  release: () => Promise<void>;
  targetRole: AllowedTargetPrivilegeRole;
}

export interface RoleAwarePoolOptions {
  connectionString: string;
  targetRole: AllowedTargetPrivilegeRole;
  expectedLoginUser?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export class RoleAwarePool {
  private pool: pg.Pool;
  public readonly targetRole: AllowedTargetPrivilegeRole;
  public readonly expectedLoginUser?: string;

  constructor(options: RoleAwarePoolOptions) {
    if (!ALLOWED_TARGET_ROLES.has(options.targetRole)) {
      throw new Error(`Invalid target privilege role: ${options.targetRole}`);
    }
    this.targetRole = options.targetRole;
    this.expectedLoginUser = options.expectedLoginUser;
    this.pool = new Pool({
      connectionString: options.connectionString,
      max: options.max ?? 10,
      idleTimeoutMillis: options.idleTimeoutMillis ?? 30000,
      connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5000
    });
  }

  async checkout(): Promise<RoleAwareCheckoutClient> {
    const client = await this.pool.connect();
    try {
      // 1. SET ROLE to allow-listed target privilege role
      await client.query(`SET ROLE "${this.targetRole}";`);

      // 2. Query session_user, current_user, pg_has_role
      const verifyRes = await client.query<{
        session_user: string;
        current_user: string;
        has_role: boolean;
      }>(`
        SELECT session_user, current_user, pg_catalog.pg_has_role(session_user, current_user, 'member') AS has_role;
      `);

      const row = verifyRes.rows[0];
      if (!row) {
        throw new Error('Role checkout verification failed: no verification row returned');
      }

      if (row.current_user !== this.targetRole) {
        throw new Error(
          `Role checkout verification failed: expected current_user "${this.targetRole}", got "${row.current_user}"`
        );
      }

      if (!row.has_role) {
        throw new Error(
          `Role checkout verification failed: session_user "${row.session_user}" does not possess membership in role "${this.targetRole}"`
        );
      }

      if (this.expectedLoginUser && row.session_user !== this.expectedLoginUser) {
        throw new Error(
          `Role checkout verification failed: expected session_user "${this.expectedLoginUser}", got "${row.session_user}"`
        );
      }

      let released = false;
      const checkoutClient: RoleAwareCheckoutClient = {
        targetRole: this.targetRole,
        query: async <R = any>(sql: string, params?: any[]) => {
          if (released) throw new Error('Client already released to pool');
          const res = await client.query(sql, params);
          return { rows: res.rows as R[] };
        },
        exec: async (sql: string) => {
          if (released) throw new Error('Client already released to pool');
          await client.query(sql);
        },
        release: async () => {
          if (released) return;
          released = true;
          try {
            await client.query('RESET ROLE;');
            // Verify current_user equals session_user post-reset before returning connection to pool
            const resetRes = await client.query<{
              session_user: string;
              current_user: string;
            }>('SELECT session_user, current_user;');
            const postReset = resetRes.rows[0];
            if (!postReset || postReset.current_user !== postReset.session_user) {
              throw new Error(
                `Role reset verification failed: current_user "${postReset?.current_user}" does not match session_user "${postReset?.session_user}"`
              );
            }
            client.release();
          } catch (resetErr) {
            // If RESET ROLE or verification fails, destroy the client connection to prevent pool contamination
            (client as any).release(resetErr);
            throw resetErr;
          }
        }
      };

      return checkoutClient;
    } catch (err) {
      // If setup or verification fails, destroy client connection
      (client as any).release(err);
      throw err;
    }
  }

  async withRoleClient<T>(operation: (client: DbClient) => Promise<T>): Promise<T> {
    const client = await this.checkout();
    try {
      return await operation(client);
    } finally {
      await client.release();
    }
  }

  async withClient<T>(operation: (client: DbClient) => Promise<T>): Promise<T> {
    return this.withRoleClient(operation);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
