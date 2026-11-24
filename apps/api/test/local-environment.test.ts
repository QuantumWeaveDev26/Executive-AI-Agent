import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loadLocalApiEnvironment } from '../src/local-environment.js';

describe('Step 9.2 server-only local environment loading', () => {
  it.each([undefined, 'development'])('loads the exact root .env before configuration (NODE_ENV=%s)', NODE_ENV => {
    const load = vi.fn();
    loadLocalApiEnvironment({ NODE_ENV }, load);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(fileURLToPath(new URL('../../../.env', import.meta.url)));
  });

  it.each(['test', 'production', 'unexpected'])('does not load local credentials in %s', NODE_ENV => {
    const load = vi.fn();
    loadLocalApiEnvironment({ NODE_ENV }, load);
    expect(load).not.toHaveBeenCalled();
  });

  it('tolerates an absent optional local file', () => {
    expect(() => loadLocalApiEnvironment({}, () => { throw Object.assign(new Error('private path'), { code: 'ENOENT' }); })).not.toThrow();
  });

  it('fails closed with a safe message for other loading errors', () => {
    expect(() => loadLocalApiEnvironment({}, () => { throw Object.assign(new Error('synthetic-secret-must-not-leak'), { code: 'EACCES' }); }))
      .toThrow('Local API environment could not be loaded.');
  });

  it('uses the native loader without overwriting inherited variables or loading frontend variables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thaara-env-test-'));
    const key = 'THAARA_STEP92_SYNTHETIC_ENV';
    const inheritedKey = 'THAARA_STEP92_INHERITED_ENV';
    const original = process.env[key];
    const inheritedOriginal = process.env[inheritedKey];
    const fixture = join(dir, '.env');
    try {
      delete process.env[key];
      process.env[inheritedKey] = 'inherited';
      writeFileSync(fixture, key + '=synthetic-only\n' + inheritedKey + '=must-not-override\n');
      loadLocalApiEnvironment({ NODE_ENV: 'development' }, expectedPath => {
        expect(resolve(expectedPath)).toBe(fileURLToPath(new URL('../../../.env', import.meta.url)));
        loadEnvFile(fixture);
      });
      expect(process.env[key]).toBe('synthetic-only');
      expect(process.env[inheritedKey]).toBe('inherited');
    } finally {
      if (original === undefined) delete process.env[key]; else process.env[key] = original;
      if (inheritedOriginal === undefined) delete process.env[inheritedKey]; else process.env[inheritedKey] = inheritedOriginal;
      unlinkSync(fixture);
      rmdirSync(dir);
    }
  });

  it('runs environment loading before runtime configuration and Google initialization', () => {
    const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
    expect(server.indexOf('loadLocalApiEnvironment();')).toBeGreaterThan(-1);
    expect(server.indexOf('loadLocalApiEnvironment();')).toBeLessThan(server.indexOf('const config = loadConfig();'));
    expect(server.indexOf('loadLocalApiEnvironment();')).toBeLessThan(server.indexOf('const liveGoogle = createLiveGoogleIntegrationFromEnv(process.env);'));
    const vite = readFileSync(new URL('../../web/vite.config.ts', import.meta.url), 'utf8');
    expect(vite).not.toMatch(/envPrefix|loadEnv|GOOGLE_|process\.env|define:/);
  });
});
