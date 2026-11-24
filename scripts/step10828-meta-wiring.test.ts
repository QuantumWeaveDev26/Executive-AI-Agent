import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pilotMetaAccessToken, validatePilotCompose } from '../deploy/hostinger-pilot/pilot-config.mjs';
import { patchPilotCsp } from '../deploy/hostinger-pilot/patch-whatsapp-meta.mjs';
import { patchPilotWhatsAppApp } from '../deploy/hostinger-pilot/patch-whatsapp-compose.mjs';

// Offline only: synthetic key strings, the reviewed compose fixture and the checksum-pinned read-only base capture.
const read = (p: string) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
describe('108.28 Meta key wiring (offline)', () => {
  it('reads an optional owner key once, refuses malformed keys and reports absence as null', () => {
    const key = 'EAA' + 'k'.repeat(60);
    expect(pilotMetaAccessToken(() => key, () => true)).toBe(key);
    expect(pilotMetaAccessToken(() => { throw Error('must not read'); }, () => false)).toBeNull();
    for (const bad of ['short', key + ' ', key + '\n', 'x'.repeat(5000)]) expect(() => pilotMetaAccessToken(() => bad, () => true)).toThrow('Pilot Meta key format denied');
  });
  it('allows the key secret only as a plain API mount declared at top level, never on data services', () => {
    const rendered = JSON.parse(read('scripts/fixtures/hostinger-pilot-rendered-compose.json'));
    expect(() => validatePilotCompose(rendered)).not.toThrow();
    const withKey = structuredClone(rendered);
    withKey.secrets.meta_access_token = { file: '/opt/thaara-v2-pilot-private/secrets/meta_access_token' };
    withKey.services.api.secrets = [...withKey.services.api.secrets, 'meta_access_token'];
    expect(() => validatePilotCompose(withKey)).not.toThrow();
    const declaredOnly = structuredClone(withKey); declaredOnly.services.api.secrets = rendered.services.api.secrets;
    const mountedOnly = structuredClone(rendered); mountedOnly.services.api.secrets = [...rendered.services.api.secrets, 'meta_access_token'];
    const onPostgres = structuredClone(withKey); onPostgres.services.postgres.secrets = [...onPostgres.services.postgres.secrets, 'meta_access_token'];
    const otherPath = structuredClone(withKey); otherPath.secrets.meta_access_token = { file: '/tmp/meta_access_token' };
    for (const bad of [declaredOnly, mountedOnly, onPostgres, otherPath]) expect(() => validatePilotCompose(bad)).toThrow();
  });
  it('patches only the pilot CSP to allow verified blob: images and audio, producing valid JavaScript', () => {
    const cache = new URL('../node_modules/.cache/step10827/base-app.js', import.meta.url);
    if (!fs.existsSync(cache)) return; // fresh clones have no read-only pilot capture
    const current = patchPilotWhatsAppApp(fs.readFileSync(cache, 'utf8'));
    expect(createHash('sha256').update(current).digest('hex')).toBe('5718005694b27b43434ac9e55656361ed50c2f16ed85018cf10c9ebd977fe4ac');
    const patched = patchPilotCsp(current);
    expect(patched).toContain(`imgSrc: ["'self'", 'data:', 'blob:']`); expect(patched).toContain(`mediaSrc: ["'self'", 'blob:']`);
    expect(patched).not.toMatch(/scriptSrc: \[[^\]]*blob:/);
    expect(() => patchPilotCsp(patched)).toThrow('precondition');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thaara-10828-'));
    try { const f = path.join(dir, 'app.mjs'); fs.writeFileSync(f, patched); expect(() => execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })).not.toThrow(); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
