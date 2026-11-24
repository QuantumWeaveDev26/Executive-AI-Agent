import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { phoneContactsDatabase } from './helpers/phone-contacts-fixture.js';
import { captureInboundFixtureAdmin } from './helpers/phone-inbound-fixture-identity.js';
import { buildStep115HostedInstall, INSTALL_APPROVAL } from '../../../scripts/prepare-phone-step115-install-review.mjs';

describe.skipIf(process.env.THAARA_PHONE115_SQL_TEST_APPROVED !== 'in-memory-only')('target-specific Step 115 installation review', () => {
  let fixture: Awaited<ReturnType<typeof phoneContactsDatabase>>;
  let install: ReturnType<typeof buildStep115HostedInstall>;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  beforeAll(async () => {
    const receipt = JSON.parse(readFileSync(root + 'node_modules/.cache/phone-step115-schema-20261111.result.json', 'utf8'));
    install = buildStep115HostedInstall(receipt, root);
    fixture = await phoneContactsDatabase({ live: true });
    await fixture.db.exec('RESET ROLE');
    await captureInboundFixtureAdmin(fixture.db);
  }, 60_000);
  afterAll(async () => { if (fixture) await fixture.db.close(); });

  async function existingRows() {
    const tables = (await fixture.db.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    const rows: Record<string, unknown> = {};
    for (const { tablename } of tables) {
      if (install.target.newTables.includes(tablename)) continue;
      if (!/^[a-z_][a-z0-9_]*$/.test(tablename)) throw Error('Unexpected fixture table');
      rows[tablename] = (await fixture.db.query(`SELECT to_jsonb(entry)::text AS data FROM public."${tablename}" entry ORDER BY 1`)).rows;
    }
    return rows;
  }

  it('refuses execution without approval and on the different disposable target', async () => {
    await expect(fixture.db.exec(install.sql)).rejects.toThrow('exact target');
    await fixture.db.exec('ROLLBACK');
    await fixture.db.query("SELECT set_config('thaara.step115_hosted_install_approved',$1,false)", [INSTALL_APPROVAL]);
    await expect(fixture.db.exec(install.sql)).rejects.toThrow('exact target');
    await fixture.db.exec('ROLLBACK');
    expect((await fixture.db.query("SELECT to_regclass('public.phone_callback_requests') AS installed")).rows[0]?.installed).toBeNull();
  });

  it('rolls back every new table and role after an injected pre-commit failure, preserving existing rows', async () => {
    const before = await existingRows();
    await expect(fixture.db.exec('BEGIN;\n' + install.body + "\nDO $$ BEGIN RAISE EXCEPTION 'synthetic pre-commit refusal'; END $$;\nCOMMIT;")).rejects.toThrow('synthetic pre-commit refusal');
    await fixture.db.exec('ROLLBACK');
    expect(await existingRows()).toEqual(before);
    for (const name of install.target.newTables) {
      expect((await fixture.db.query('SELECT to_regclass($1) AS object', ['public.' + name])).rows[0]?.object).toBeNull();
    }
    expect((await fixture.db.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])', [install.target.newRoles])).rows).toEqual([]);
  });

  it('composes the pinned additive bodies atomically in fresh memory without creating logins', async () => {
    // Local syntax/dependency validation only. Production target/approval gates were tested above.
    await fixture.db.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO thaara_app,thaara_worker');
    const before = await existingRows();
    await fixture.db.exec('BEGIN;\n' + install.body + '\nCOMMIT;');
    expect(await existingRows()).toEqual(before);
    const expected = install.target.newTables;
    const tables = (await fixture.db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[])", [expected])).rows;
    expect(tables).toHaveLength(expected.length);
    expect(tables.every(table => table.relrowsecurity && table.relforcerowsecurity)).toBe(true);
    const roles = (await fixture.db.query<{ rolcanlogin: boolean; rolinherit: boolean; rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT rolcanlogin,rolinherit,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=ANY($1::text[])', [install.target.newRoles])).rows;
    expect(roles).toHaveLength(4);
    expect(roles.every(role => !role.rolcanlogin && !role.rolinherit && !role.rolsuper && !role.rolbypassrls)).toBe(true);
    const data = (await fixture.db.query('SELECT count(*)::integer AS count FROM public.phone_callback_worker_principals')).rows[0];
    expect(data?.count).toBe(0);
    await fixture.db.exec('SET ROLE thaara_app');
    await expect(fixture.db.query('DELETE FROM public.phone_callback_notification_grant_uses WHERE false')).rejects.toThrow('permission denied');
    await expect(fixture.db.query('UPDATE public.phone_callback_dispatch_numbers SET phone_e164=phone_e164 WHERE false')).rejects.toThrow('permission denied');
    await fixture.db.exec('RESET ROLE');
  });
});
