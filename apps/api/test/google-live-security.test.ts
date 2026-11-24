import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createLiveGoogleIntegrationFromEnv } from '../src/services/google-live.js';

const dedicatedKey = createHash('sha256').update('synthetic-step9.2-vault-key').digest('hex');
const credentials = { GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-client-secret' };

describe('Step 9.2 dedicated live Google vault key', () => {
  it.each(['development', 'test', 'production'])('rejects a missing dedicated key in %s even with SESSION_SECRET', NODE_ENV => {
    expect(() => createLiveGoogleIntegrationFromEnv({ ...credentials, NODE_ENV, SESSION_SECRET: dedicatedKey }))
      .toThrow(/GOOGLE_VAULT_KEY/);
  });

  it.each(['', ' ', 'short', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), '00'.repeat(32), 'aa'.repeat(32), dedicatedKey + '\n'])
    ('rejects an invalid dedicated key without disclosing its value (case %#)', key => {
      let error: unknown;
      try { createLiveGoogleIntegrationFromEnv({ ...credentials, GOOGLE_VAULT_KEY: key, SESSION_SECRET: dedicatedKey }); }
      catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/GOOGLE_VAULT_KEY/);
      if (key.trim()) expect((error as Error).message).not.toContain(key);
      expect((error as Error).message).not.toContain(credentials.GOOGLE_CLIENT_SECRET);
      expect((error as Error).message).not.toContain(dedicatedKey);
    });

  it('rejects explicitly reusing the session secret as the Google vault key', () => {
    expect(() => createLiveGoogleIntegrationFromEnv({ ...credentials, GOOGLE_VAULT_KEY: dedicatedKey, SESSION_SECRET: dedicatedKey }))
      .toThrow(/GOOGLE_VAULT_KEY/);
  });

  it.each(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])('fails closed for partial live credentials missing %s', missing => {
    const env: Record<string, string> = { ...credentials, GOOGLE_VAULT_KEY: dedicatedKey };
    delete env[missing];
    expect(() => createLiveGoogleIntegrationFromEnv(env)).toThrow(/Google OAuth configuration/);
  });

  it('keeps credential-free and session-only startup not_configured', () => {
    expect(createLiveGoogleIntegrationFromEnv({})).toEqual({});
    expect(createLiveGoogleIntegrationFromEnv({ NODE_ENV: 'test', SESSION_SECRET: dedicatedKey })).toEqual({});
  });

  it('initializes live providers only with valid dedicated configuration, without network calls', () => {
    const fetchFn = vi.fn();
    const configured = createLiveGoogleIntegrationFromEnv({ ...credentials, NODE_ENV: 'development', GOOGLE_VAULT_KEY: dedicatedKey }, undefined, fetchFn);
    expect(configured.gmail?.provider?.mode).toBe('live');
    expect(configured.googleCalendar?.provider?.mode).toBe('live');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(JSON.stringify(configured)).not.toContain(dedicatedKey);
  });
});
