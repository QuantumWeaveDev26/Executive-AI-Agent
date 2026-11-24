import { describe, expect, it } from 'vitest';
import { OpenAIModelGatewayAdapter } from '../src/services/model-gateway.js';
import { createPilotChatModel, createPilotGoogle, PILOT_GOOGLE_FILES, PILOT_OPENAI_KEY_FILE, type PilotSecretFiles } from '../src/services/pilot-providers.js';

const OPENAI_KEY = 'sk-synthetic-openai-test-key-0123456789abcdef';
const SESSION = 'b'.repeat(64);
const GOOGLE = {
  [PILOT_GOOGLE_FILES.clientId]: '123456789012-abcdefghij0123456789klmnopqrstuv.apps.googleusercontent.com',
  [PILOT_GOOGLE_FILES.clientSecret]: 'GOCSPX-synthetic-secret-123',
  [PILOT_GOOGLE_FILES.vaultKey]: '0123456789abcdef'.repeat(4)
};

function files(content: Record<string, string>, over: { mode?: number | null; regular?: boolean; missing?: string } = {}): PilotSecretFiles {
  return {
    inspect: async (path) => {
      if (over.missing === path || !(path in content)) throw new Error('ENOENT');
      return { regular: over.regular ?? true, mode: over.mode === undefined ? 0o100400 : over.mode };
    },
    read: async (path) => `${content[path]}\n`
  };
}

describe('pilot Chat model reuses the original OpenAI gpt-4.1-mini adapter', () => {
  const env = { THAARA_OPENAI_API_KEY_FILE: PILOT_OPENAI_KEY_FILE };
  const keyFile = { [PILOT_OPENAI_KEY_FILE]: OPENAI_KEY };

  it('is off without its switch and ready with a protected key file', async () => {
    expect(await createPilotChatModel({}, files(keyFile))).toEqual({ status: 'off' });
    const ready = await createPilotChatModel(env, files(keyFile));
    expect(ready).toMatchObject({ status: 'ready', model: 'gpt-4.1-mini' });
    expect(ready.status === 'ready' && ready.gateway).toBeInstanceOf(OpenAIModelGatewayAdapter);
  });

  it.each([
    { e: { THAARA_OPENAI_API_KEY_FILE: '/tmp/key' }, f: files(keyFile), reason: 'key_file_path' },
    { e: { ...env, THAARA_OPENAI_MODEL: 'gpt-4o' }, f: files(keyFile), reason: 'model_invalid' },
    { e: env, f: files({}), reason: 'file_missing' },
    { e: env, f: files(keyFile, { mode: 0o100644 }), reason: 'file_permissions' },
    { e: env, f: files(keyFile, { regular: false }), reason: 'file_permissions' },
    { e: env, f: files({ [PILOT_OPENAI_KEY_FILE]: 'short' }), reason: 'key_invalid' }
  ])('refuses $reason without exposing the key', async ({ e, f, reason }) => {
    const result = await createPilotChatModel(e, f);
    expect(result).toEqual({ status: 'refused', reason });
    expect(JSON.stringify(result)).not.toContain(OPENAI_KEY);
  });
});

describe('pilot Gmail and Calendar reuse the existing live Google integration', () => {
  const env = { THAARA_GOOGLE_OAUTH: 'approved' };

  it('is off without its switch and ready with HTTPS pilot callbacks only', async () => {
    expect(await createPilotGoogle({}, SESSION, files(GOOGLE))).toEqual({ status: 'off' });
    const ready = await createPilotGoogle(env, SESSION, files(GOOGLE));
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    expect(ready.integration.gmail?.redirectUri).toBe('https://thaara-v2.quantumweaveai.io/api/v1/connectors/gmail/oauth/callback');
    expect(ready.integration.googleCalendar?.redirectUri).toBe('https://thaara-v2.quantumweaveai.io/api/v1/connectors/google-calendar/oauth/callback');
    expect(ready.integration.gmail?.allowLocalhostRedirect).toBe(false);
    expect(ready.integration.googleCalendar?.allowLocalhostRedirect).toBe(false);
  });

  it.each([
    { e: { THAARA_GOOGLE_OAUTH: 'true' }, f: files(GOOGLE), reason: 'switch_invalid' },
    { e: env, f: files(GOOGLE, { missing: PILOT_GOOGLE_FILES.clientSecret }), reason: 'file_missing' },
    { e: env, f: files(GOOGLE, { mode: 0o100644 }), reason: 'file_permissions' },
    { e: env, f: files({ ...GOOGLE, [PILOT_GOOGLE_FILES.clientId]: 'not-a-client-id' }), reason: 'client_id_invalid' },
    { e: env, f: files({ ...GOOGLE, [PILOT_GOOGLE_FILES.clientSecret]: 'short' }), reason: 'client_secret_invalid' },
    { e: env, f: files({ ...GOOGLE, [PILOT_GOOGLE_FILES.vaultKey]: 'xyz' }), reason: 'vault_key_invalid' },
    { e: env, f: files({ ...GOOGLE, [PILOT_GOOGLE_FILES.vaultKey]: SESSION }), reason: 'vault_key_invalid' },
    { e: env, f: files({ ...GOOGLE, [PILOT_GOOGLE_FILES.vaultKey]: 'ab'.repeat(32) }), reason: 'vault_key_invalid' }
  ])('refuses $reason without exposing secrets', async ({ e, f, reason }) => {
    const result = await createPilotGoogle(e, SESSION, f);
    expect(result).toEqual({ status: 'refused', reason });
    expect(JSON.stringify(result)).not.toContain('GOCSPX');
  });
});
