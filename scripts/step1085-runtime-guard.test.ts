import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
const implementation = await import('./step1085-runtime-guard.mjs').catch(() => null);
const env = { THAARA_STEP1085_RUNTIME_APPROVED: 'yes', THAARA_STEP1085_ADMIN_URL: 'postgresql://postgres:synthetic_password_1085_12345678901234@127.0.0.1:15433/thaara_step1085_test', THAARA_STEP1085_APP_URL: 'postgresql://thaara_app:synthetic_password_1085_12345678901234@127.0.0.1:15433/thaara_step1085_test' };
describe('Step1085 isolated runtime target guard (no Docker/DB calls)', () => {
  it('requires explicit approval and fixed fresh-only URLs', () => {
    expect(implementation?.getCallbackRuntimeConfig, 'guard exists').toBeTypeOf('function');
    expect(implementation!.getCallbackRuntimeConfig(env).databaseName).toBe('thaara_step1085_test');
    for (const patch of [{ THAARA_STEP1085_RUNTIME_APPROVED: '' }, { DATABASE_URL: 'any-existing-config' }, { PGHOST: '127.0.0.1' }, { NODE_OPTIONS: '--inspect' }]) expect(() => implementation!.getCallbackRuntimeConfig({ ...env, ...patch })).toThrow();
  });
  it.each(['5432', '15432', '0'])('rejects any port other than15433: %s', port => {
    expect(() => implementation!.getCallbackRuntimeConfig({ ...env, THAARA_STEP1085_APP_URL: env.THAARA_STEP1085_APP_URL.replace('15433', port) })).toThrow();
  });
  it('rejects foreign hosts/databases/options before a connection can open', () => {
    for (const value of [env.THAARA_STEP1085_APP_URL.replace('127.0.0.1', 'localhost'), env.THAARA_STEP1085_APP_URL.replace('thaara_step1085_test', 'thaara_v2'), env.THAARA_STEP1085_APP_URL + '?options=anything']) expect(() => implementation!.getCallbackRuntimeConfig({ ...env, THAARA_STEP1085_APP_URL: value })).toThrow();
  });
  it('pins the reviewed SQL before any setup action', () => {
    const sql = fs.readFileSync(new URL('../docs/migrations/1085-whatsapp-callback-principal.review.sql', import.meta.url));
    const runner = fs.readFileSync(new URL('./step1085-runtime.mjs', import.meta.url), 'utf8');
    expect(runner).toContain(crypto.createHash('sha256').update(sql).digest('hex'));
  });
  it('requires exact owned identities, tmpfs, internal sole-member network and loopback15433', () => {
    const expected = { ContainerId: 'a'.repeat(64), ImageId: 'sha256:pinned', NetworkId: 'b'.repeat(64) };
    const facts = { Id: expected.ContainerId, Image: expected.ImageId, Name: '/thaara-step1085-callback-postgres', Labels: { 'thaara.step': '1085' }, State: { Running: true }, Restarts: 0, ReadOnly: true, Mounts: [], Binds: [], Tmpfs: { '/tmp': '', '/var/run/postgresql': '', '/var/lib/postgresql/data': '' }, Networks: { 'thaara-step1085-isolated': {} }, Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '15433' }] } };
    const network = { Id: expected.NetworkId, Name: 'thaara-step1085-isolated', Internal: true, Labels: { 'thaara.step': '1085' }, Containers: { [expected.ContainerId]: {} } };
    expect(() => implementation!.assertCallbackFixture(expected, facts, network)).not.toThrow();
    for (const change of [{ ReadOnly: false }, { Restarts: 1 }, { Mounts: [{ Type: 'volume' }] }, { Binds: ['some-host-path'] }, { Name: '/thaara-v2-postgres' }, { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '15433' }] } }]) expect(() => implementation!.assertCallbackFixture(expected, { ...facts, ...change }, network)).toThrow();
    expect(() => implementation!.assertCallbackFixture(expected, facts, { ...network, Internal: false })).toThrow();
    expect(() => implementation!.assertCallbackFixture(expected, facts, { ...network, Containers: { foreign: {} } })).toThrow();
  });
});
