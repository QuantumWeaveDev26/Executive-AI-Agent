import { PGlite } from '@electric-sql/pglite';
import { AuthenticatedScope, ScopeError, TransactionalDbClient, DbClient } from './client.js';

export class PGliteDatabase implements TransactionalDbClient {
  private db: PGlite;

  constructor(db?: PGlite) {
    this.db = db || new PGlite();
  }

  async exec(sql: string): Promise<any> {
    return this.db.exec(sql);
  }

  async query<R = any>(sql: string, params?: any[]): Promise<{ rows: R[] }> {
    const res = await this.db.query<R>(sql, params);
    return { rows: res.rows };
  }

  async withAuthenticatedScope<T>(
    sessionTokenHash: string,
    operation: (client: DbClient) => Promise<T>
  ): Promise<T> {
    if (!sessionTokenHash || typeof sessionTokenHash !== 'string' || !sessionTokenHash.trim()) {
      throw new ScopeError('Missing mandatory sessionTokenHash in withAuthenticatedScope: database transactions strictly require a server-derived session token hash.');
    }

    await this.db.query('BEGIN;');
    try {
      await this.db.query("SELECT pg_catalog.set_config('app.session_token_hash', $1, true);", [sessionTokenHash]);

      const wrappedClient: DbClient = {
        query: (sql: string, params?: any[]) => this.db.query(sql, params),
        exec: (sql: string) => this.db.exec(sql)
      };

      const result = await operation(wrappedClient);
      await this.db.query('COMMIT;');
      return result;
    } catch (err) {
      await this.db.query('ROLLBACK;');
      throw err;
    }
  }

  async withScopedTransaction<T>(
    scope: AuthenticatedScope,
    operation: (client: DbClient) => Promise<T>
  ): Promise<T> {
    if (!scope?.sessionTokenHash || typeof scope.sessionTokenHash !== 'string' || !scope.sessionTokenHash.trim()) {
      throw new ScopeError('Missing mandatory sessionTokenHash in AuthenticatedScope: database transactions strictly require a server-derived session token hash.');
    }

    await this.db.query('BEGIN;');
    try {
      await this.db.query("SELECT set_config('app.session_token_hash', $1, true);", [scope.sessionTokenHash]);
      await this.db.query("SELECT set_config('app.workspace_id', $1, true);", [scope.workspaceId ?? '']);
      await this.db.query("SELECT set_config('app.user_id', $1, true);", [scope.userId ?? '']);
      await this.db.query("SELECT set_config('app.role', $1, true);", [scope.role ?? '']);

      const wrappedClient: DbClient = {
        query: (sql: string, params?: any[]) => this.db.query(sql, params),
        exec: (sql: string) => this.db.exec(sql)
      };

      const result = await operation(wrappedClient);
      await this.db.query('COMMIT;');
      return result;
    } catch (err) {
      await this.db.query('ROLLBACK;');
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}
