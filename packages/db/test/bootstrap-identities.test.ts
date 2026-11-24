import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { bootstrapRuntimeIdentities } from '../scripts/bootstrap-runtime-identities.js';

function genTestSecret(): string {
  return crypto.randomBytes(16).toString('hex');
}

describe('Bootstrap Runtime Identities Security Unit Tests', () => {
  it('rejects databaseName containing SQL injection or invalid characters', async () => {
    const fakeClient = { query: vi.fn() };
    await expect(
      bootstrapRuntimeIdentities(fakeClient, {
        databaseName: 'thaara_v2; DROP TABLE users;--',
        adminPassword: genTestSecret(),
        workerPassword: genTestSecret(),
        seederPassword: genTestSecret()
      })
    ).rejects.toThrow('Invalid database name');
  });

  it('rejects missing or short passwords', async () => {
    const fakeClient = { query: vi.fn() };
    await expect(
      bootstrapRuntimeIdentities(fakeClient, {
        databaseName: 'thaara_v2',
        adminPassword: genTestSecret().slice(0, 5),
        workerPassword: genTestSecret(),
        seederPassword: genTestSecret()
      })
    ).rejects.toThrow('Password for thaara_admin_user is too short');
  });

  it('rejects execution if a privilege group role is missing', async () => {
    const fakeClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN;' || sql === 'ROLLBACK;') return { rows: [] };
        if (sql.includes('SELECT rolname, rolcanlogin')) {
          // Only return thaara_admin, missing worker and seeder
          return {
            rows: [
              {
                rolname: 'thaara_admin',
                rolcanlogin: false,
                rolsuper: false,
                rolcreaterole: false,
                rolcreatedb: false,
                rolreplication: false,
                rolbypassrls: false
              }
            ]
          };
        }
        return { rows: [] };
      })
    };

    await expect(
      bootstrapRuntimeIdentities(fakeClient, {
        databaseName: 'thaara_v2',
        adminPassword: genTestSecret(),
        workerPassword: genTestSecret(),
        seederPassword: genTestSecret()
      })
    ).rejects.toThrow('Privilege role "thaara_worker" does not exist');
  });

  it('rejects execution if a privilege group role has LOGIN or SUPERUSER attribute', async () => {
    const fakeClient = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN;' || sql === 'ROLLBACK;') return { rows: [] };
        if (sql.includes('SELECT rolname, rolcanlogin')) {
          return {
            rows: [
              {
                rolname: 'thaara_admin',
                rolcanlogin: true, // Invalid: must be NOLOGIN
                rolsuper: false,
                rolcreaterole: false,
                rolcreatedb: false,
                rolreplication: false,
                rolbypassrls: false
              },
              {
                rolname: 'thaara_worker',
                rolcanlogin: false,
                rolsuper: false,
                rolcreaterole: false,
                rolcreatedb: false,
                rolreplication: false,
                rolbypassrls: false
              },
              {
                rolname: 'thaara_seeder',
                rolcanlogin: false,
                rolsuper: false,
                rolcreaterole: false,
                rolcreatedb: false,
                rolreplication: false,
                rolbypassrls: false
              }
            ]
          };
        }
        return { rows: [] };
      })
    };

    await expect(
      bootstrapRuntimeIdentities(fakeClient, {
        databaseName: 'thaara_v2',
        adminPassword: genTestSecret(),
        workerPassword: genTestSecret(),
        seederPassword: genTestSecret()
      })
    ).rejects.toThrow('Privilege group role "thaara_admin" must have NOLOGIN attribute');
  });

  it('rejects reuse if existing identity possesses dangerous attributes (e.g. SUPERUSER)', async () => {
    const fakeClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        if (sql === 'BEGIN;' || sql === 'ROLLBACK;') return { rows: [] };
        if (sql.includes('SELECT rolname, rolcanlogin')) {
          return {
            rows: [
              { rolname: 'thaara_admin', rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false },
              { rolname: 'thaara_worker', rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false },
              { rolname: 'thaara_seeder', rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false }
            ]
          };
        }
        if (sql.includes('FROM pg_catalog.pg_roles WHERE rolname = $1;')) {
          return {
            rows: [
              {
                rolname: 'thaara_admin_user',
                rolsuper: true, // Dangerous!
                rolinherit: false,
                rolcreaterole: false,
                rolcreatedb: false,
                rolcanlogin: true,
                rolreplication: false,
                rolbypassrls: false
              }
            ]
          };
        }
        return { rows: [] };
      })
    };

    await expect(
      bootstrapRuntimeIdentities(fakeClient, {
        databaseName: 'thaara_v2',
        adminPassword: genTestSecret(),
        workerPassword: genTestSecret(),
        seederPassword: genTestSecret()
      })
    ).rejects.toThrow('Dangerous role attributes detected on existing identity "thaara_admin_user"');
  });

  it('rejects reuse if existing identity has unexpected role memberships', async () => {
    const fakeClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
        if (sql === 'BEGIN;' || sql === 'ROLLBACK;') return { rows: [] };
        if (sql.includes('SELECT rolname, rolcanlogin')) {
          return {
            rows: [
              { rolname: 'thaara_admin', rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false },
              { rolname: 'thaara_worker', rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false },
              { rolname: 'thaara_seeder', rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolbypassrls: false }
            ]
          };
        }
        if (sql.includes('FROM pg_catalog.pg_roles WHERE rolname = $1;')) {
          return {
            rows: [
              {
                rolname: 'thaara_admin_user',
                rolsuper: false,
                rolinherit: false,
                rolcreaterole: false,
                rolcreatedb: false,
                rolcanlogin: true,
                rolreplication: false,
                rolbypassrls: false
              }
            ]
          };
        }
        if (sql.includes('FROM pg_catalog.pg_roles r') && sql.includes('pg_auth_members')) {
          // Unexpected membership in pg_read_all_data!
          return {
            rows: [
              { rolname: 'thaara_admin' },
              { rolname: 'pg_read_all_data' }
            ]
          };
        }
        return { rows: [] };
      })
    };

    await expect(
      bootstrapRuntimeIdentities(fakeClient, {
        databaseName: 'thaara_v2',
        adminPassword: genTestSecret(),
        workerPassword: genTestSecret(),
        seederPassword: genTestSecret()
      })
    ).rejects.toThrow('Unexpected role membership detected on identity "thaara_admin_user": member of "pg_read_all_data"');
  });
});
