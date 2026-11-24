import { lstat, readFile } from 'node:fs/promises';
import { isConfiguredApiKey } from '@thaara/config';
import { createLiveGoogleIntegrationFromEnv } from './google-live.js';
import { OpenAIModelGatewayAdapter } from './model-gateway.js';

/**
 * Private pilot wiring for the EXISTING integrations (31 Oct 2026): the original Chat model (OpenAI gpt-4.1-mini, the same
 * OpenAIModelGatewayAdapter used locally) and the existing live Gmail/Calendar integration. Secrets are read only from
 * protected files mounted into the API container, never from environment values. Each part is off unless its exact switch
 * is set; a refusal leaves that feature not_configured and the API up.
 */

export const PILOT_ORIGIN = 'https://thaara-v2.quantumweaveai.io';
export const PILOT_OPENAI_KEY_FILE = '/run/secrets/openai_api_key';
export const PILOT_GOOGLE_FILES = {
  clientId: '/run/secrets/google_client_id',
  clientSecret: '/run/secrets/google_client_secret',
  vaultKey: '/run/secrets/google_vault_key'
} as const;
/** The originally integrated and tested Chat model; any other value is refused. */
export const PILOT_CHAT_MODELS = ['gpt-4.1-mini'] as const;

export interface PilotSecretFiles {
  /** Regular-file check and POSIX mode bits (null when unverifiable). Symlinks are refused. */
  inspect(path: string): Promise<{ regular: boolean; mode: number | null }>;
  read(path: string): Promise<string>;
}

const nodeFiles: PilotSecretFiles = {
  async inspect(path) {
    const info = await lstat(path);
    return { regular: info.isFile() && !info.isSymbolicLink(), mode: Number.isSafeInteger(info.mode) ? info.mode : null };
  },
  read: (path) => readFile(path, 'utf8')
};

type SecretReason = 'file_missing' | 'file_permissions';

async function readSecret(files: PilotSecretFiles, path: string): Promise<{ value: string } | { reason: SecretReason }> {
  let info: { regular: boolean; mode: number | null };
  try {
    info = await files.inspect(path);
  } catch {
    return { reason: 'file_missing' };
  }
  if (!info.regular || info.mode === null || ![0o400, 0o600].includes(info.mode & 0o7777)) return { reason: 'file_permissions' };
  try {
    return { value: (await files.read(path)).trim() };
  } catch {
    return { reason: 'file_missing' };
  }
}

export type PilotChatModel =
  | { status: 'off' }
  | { status: 'refused'; reason: 'key_file_path' | 'model_invalid' | 'key_invalid' | SecretReason }
  | { status: 'ready'; gateway: OpenAIModelGatewayAdapter; model: string };

/** Off unless THAARA_OPENAI_API_KEY_FILE names the fixed mount. Same adapter, model and timeout behaviour as local development. */
export async function createPilotChatModel(env: Record<string, string | undefined>, files: PilotSecretFiles = nodeFiles): Promise<PilotChatModel> {
  const path = env.THAARA_OPENAI_API_KEY_FILE;
  if (path === undefined) return { status: 'off' };
  if (path !== PILOT_OPENAI_KEY_FILE) return { status: 'refused', reason: 'key_file_path' };
  const model = env.THAARA_OPENAI_MODEL ?? 'gpt-4.1-mini';
  if (!(PILOT_CHAT_MODELS as readonly string[]).includes(model)) return { status: 'refused', reason: 'model_invalid' };
  const key = await readSecret(files, path);
  if ('reason' in key) return { status: 'refused', reason: key.reason };
  if (!isConfiguredApiKey(key.value) || !/^[\x21-\x7e]{20,4096}$/.test(key.value)) return { status: 'refused', reason: 'key_invalid' };
  return { status: 'ready', gateway: new OpenAIModelGatewayAdapter({ apiKey: key.value, model, timeoutMs: 30000 }), model };
}

export type PilotGoogle =
  | { status: 'off' }
  | { status: 'refused'; reason: 'switch_invalid' | 'client_id_invalid' | 'client_secret_invalid' | 'vault_key_invalid' | SecretReason }
  | { status: 'ready'; integration: ReturnType<typeof createLiveGoogleIntegrationFromEnv> };

/**
 * Off unless THAARA_GOOGLE_OAUTH=approved. Reuses createLiveGoogleIntegrationFromEnv with fixed HTTPS pilot callbacks
 * (localhost callbacks disabled). Note: that integration keeps OAuth tokens in memory, so an API restart requires reconnecting.
 */
export async function createPilotGoogle(env: Record<string, string | undefined>, sessionSecret: string, files: PilotSecretFiles = nodeFiles): Promise<PilotGoogle> {
  if (env.THAARA_GOOGLE_OAUTH === undefined) return { status: 'off' };
  if (env.THAARA_GOOGLE_OAUTH !== 'approved') return { status: 'refused', reason: 'switch_invalid' };
  const values: Record<keyof typeof PILOT_GOOGLE_FILES, string> = { clientId: '', clientSecret: '', vaultKey: '' };
  for (const name of Object.keys(PILOT_GOOGLE_FILES) as Array<keyof typeof PILOT_GOOGLE_FILES>) {
    const secret = await readSecret(files, PILOT_GOOGLE_FILES[name]);
    if ('reason' in secret) return { status: 'refused', reason: secret.reason };
    values[name] = secret.value;
  }
  if (!/^[0-9]{6,30}-[a-z0-9]{10,64}\.apps\.googleusercontent\.com$/.test(values.clientId)) return { status: 'refused', reason: 'client_id_invalid' };
  if (!/^[\x21-\x7e]{10,200}$/.test(values.clientSecret)) return { status: 'refused', reason: 'client_secret_invalid' };
  if (!/^[0-9a-f]{64}$/i.test(values.vaultKey) || values.vaultKey.toLowerCase() === sessionSecret.toLowerCase()) return { status: 'refused', reason: 'vault_key_invalid' };
  try {
    const integration = createLiveGoogleIntegrationFromEnv({
      GOOGLE_CLIENT_ID: values.clientId,
      GOOGLE_CLIENT_SECRET: values.clientSecret,
      GOOGLE_VAULT_KEY: values.vaultKey,
      SESSION_SECRET: sessionSecret,
      NODE_ENV: 'production',
      GOOGLE_GMAIL_REDIRECT_URI: `${PILOT_ORIGIN}/api/v1/connectors/gmail/oauth/callback`,
      GOOGLE_CALENDAR_REDIRECT_URI: `${PILOT_ORIGIN}/api/v1/connectors/google-calendar/oauth/callback`
    });
    return { status: 'ready', integration };
  } catch {
    return { status: 'refused', reason: 'vault_key_invalid' };
  }
}
