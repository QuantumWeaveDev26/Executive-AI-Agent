import { describe, it, expect } from 'vitest';
import { PGliteDatabase } from '../src/pglite.js';
import { PostgresDatabase } from '../src/client.js';
import { ScopeError } from '../src/errors.js';

describe('TransactionalDbClient Scope-Wrapper Boundary', () => {
  describe('PGliteDatabase.withAuthenticatedScope', () => {
    it('rejects empty, missing, or whitespace-only sessionTokenHash with ScopeError', async () => {
      const db = new PGliteDatabase();

      await expect(
        db.withAuthenticatedScope('', async () => {})
      ).rejects.toThrow(ScopeError);

      await expect(
        db.withAuthenticatedScope('   ', async () => {})
      ).rejects.toThrow(ScopeError);

      await expect(
        db.withAuthenticatedScope(null as any, async () => {})
      ).rejects.toThrow(ScopeError);
    });

    it('sets transaction-local app.session_token_hash and clears it after commit', async () => {
      const db = new PGliteDatabase();
      const testHash = 'test-token-hash-abc-123';

      let observedHash: string | undefined;

      const result = await db.withAuthenticatedScope(testHash, async (client) => {
        const { rows } = await client.query<{ current_setting: string }>(
          "SELECT pg_catalog.current_setting('app.session_token_hash', true) AS current_setting;"
        );
        observedHash = rows[0]?.current_setting;
        return 'success';
      });

      expect(result).toBe('success');
      expect(observedHash).toBe(testHash);

      // Outside transaction, session_token_hash is unset / empty
      const afterRes = await db.query<{ current_setting: string }>(
        "SELECT pg_catalog.current_setting('app.session_token_hash', true) AS current_setting;"
      );
      expect(afterRes.rows[0]?.current_setting ?? '').toBe('');
    });

    it('rolls back cleanly and clears app.session_token_hash on error', async () => {
      const db = new PGliteDatabase();
      const testHash = 'error-token-hash-xyz-789';

      await expect(
        db.withAuthenticatedScope(testHash, async (client) => {
          const { rows } = await client.query<{ current_setting: string }>(
            "SELECT pg_catalog.current_setting('app.session_token_hash', true) AS current_setting;"
          );
          expect(rows[0]?.current_setting).toBe(testHash);
          throw new Error('Intentional transaction error');
        })
      ).rejects.toThrow('Intentional transaction error');

      // Subsequent query proves isolation
      const afterRes = await db.query<{ current_setting: string }>(
        "SELECT pg_catalog.current_setting('app.session_token_hash', true) AS current_setting;"
      );
      expect(afterRes.rows[0]?.current_setting ?? '').toBe('');
    });
  });

  describe('PostgresDatabase.withAuthenticatedScope', () => {
    it('rejects invalid token hashes fail-closed before checking out connection', async () => {
      const mockPool: any = {
        connect: () => {
          throw new Error('Should not connect on invalid token');
        }
      };
      const pgDb = new PostgresDatabase(mockPool);

      await expect(
        pgDb.withAuthenticatedScope('', async () => {})
      ).rejects.toThrow(ScopeError);

      await expect(
        pgDb.withAuthenticatedScope('  \t\n  ', async () => {})
      ).rejects.toThrow(ScopeError);
    });

    it('executes transaction with set_config and releases connection on success', async () => {
      const executedQueries: string[] = [];
      let released = false;

      const mockClient: any = {
        query: async (sql: string, params?: any[]) => {
          executedQueries.push(sql);
          if (sql.includes('SELECT pg_catalog.set_config')) {
            expect(params).toEqual(['valid-session-hash-123']);
          }
          return { rows: [] };
        },
        release: () => {
          released = true;
        }
      };

      const mockPool: any = {
        connect: async () => mockClient
      };

      const pgDb = new PostgresDatabase(mockPool);
      const output = await pgDb.withAuthenticatedScope('valid-session-hash-123', async (client) => {
        await client.query('SELECT 1;');
        return 42;
      });

      expect(output).toBe(42);
      expect(executedQueries).toEqual([
        'BEGIN;',
        "SELECT pg_catalog.set_config('app.session_token_hash', $1, true);",
        'SELECT 1;',
        'COMMIT;'
      ]);
      expect(released).toBe(true);
    });

    it('executes ROLLBACK and releases connection on error', async () => {
      const executedQueries: string[] = [];
      let released = false;

      const mockClient: any = {
        query: async (sql: string) => {
          executedQueries.push(sql);
          return { rows: [] };
        },
        release: () => {
          released = true;
        }
      };

      const mockPool: any = {
        connect: async () => mockClient
      };

      const pgDb = new PostgresDatabase(mockPool);

      await expect(
        pgDb.withAuthenticatedScope('valid-session-hash-456', async () => {
          throw new Error('Failing transaction operation');
        })
      ).rejects.toThrow('Failing transaction operation');

      expect(executedQueries).toEqual([
        'BEGIN;',
        "SELECT pg_catalog.set_config('app.session_token_hash', $1, true);",
        'ROLLBACK;'
      ]);
      expect(released).toBe(true);
    });
  });
});
