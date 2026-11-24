import { Type, Static } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';

const UNSAFE_PLACEHOLDERS = [
  'replace_with_at_least_32_char_random_secret_in_env',
  'change-me',
  'development-secret',
  '12345678901234567890123456789012',
  'placeholder'
];

export const AppEnvironmentSchema = Type.Union([
  Type.Literal('development'),
  Type.Literal('test'),
  Type.Literal('production')
]);
export type AppEnvironment = Static<typeof AppEnvironmentSchema>;

export const ConfigSchema = Type.Object({
  NODE_ENV: AppEnvironmentSchema,
  PORT: Type.Integer({ minimum: 1024, maximum: 65535 }),
  HOST: Type.String({ minLength: 1 }),
  CORS_ORIGIN: Type.String({ minLength: 1 }),
  DATABASE_URL: Type.String({ minLength: 1 }),
  REDIS_URL: Type.String({ minLength: 1 }),
  SESSION_SECRET: Type.String({ minLength: 32 }),
  CSRF_SECRET: Type.String({ minLength: 32 }),
  COOKIE_SECURE: Type.Boolean(),
  COOKIE_DOMAIN: Type.Optional(Type.String()),
  LOG_LEVEL: Type.Union([
    Type.Literal('debug'),
    Type.Literal('info'),
    Type.Literal('warn'),
    Type.Literal('error')
  ]),
  RATE_LIMIT_MAX: Type.Integer({ minimum: 1 }),
  RATE_LIMIT_TIME_WINDOW_MS: Type.Integer({ minimum: 1000 }),
  OPENAI_API_KEY: Type.Optional(Type.String({ minLength: 1 })),
  OPENAI_MODEL: Type.String({ minLength: 1 }),
  OPENAI_BASE_URL: Type.String({ minLength: 1 }),
  OPENAI_TIMEOUT_MS: Type.Integer({ minimum: 1000, maximum: 300000 })
});
export type Config = Static<typeof ConfigSchema>;

export const ConfigValidator = TypeCompiler.Compile(ConfigSchema);

export function isUnsafePlaceholder(secret: string): boolean {
  if (!secret || secret.length < 32) return true;
  const lower = secret.toLowerCase();
  return UNSAFE_PLACEHOLDERS.some((p) => lower.includes(p));
}

export function isConfiguredApiKey(apiKey: string | undefined): boolean {
  if (!apiKey) return false;
  const trimmed = apiKey.trim();
  if (trimmed.length === 0) return false;
  const lower = trimmed.toLowerCase();
  const placeholders = ['placeholder', 'your_', 'replace_with', 'change-me', 'todo'];
  return !placeholders.some((p) => lower.includes(p));
}

function parseInteger(val: string | undefined, name: string, defaultValue?: number): number {
  if (val === undefined || val === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`[Config Error]: ${name} is required.`);
  }
  const trimmed = val.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`[Config Error]: ${name} must be a valid integer, received "${val}".`);
  }
  const parsed = parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`[Config Error]: ${name} must be a valid integer.`);
  }
  return parsed;
}

function parseBoolean(val: string | undefined, name: string, defaultValue?: boolean): boolean {
  if (val === undefined || val === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`[Config Error]: ${name} is required.`);
  }
  const lower = val.trim().toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  throw new Error(`[Config Error]: ${name} must be a boolean ('true' or 'false'), received "${val}".`);
}

export function loadConfig(rawEnv: Record<string, string | undefined> = process.env): Config {
  const nodeEnv = (rawEnv.NODE_ENV || 'development') as AppEnvironment;

  const isTest = nodeEnv === 'test';
  const isProd = nodeEnv === 'production';

  const defaultPort = isTest ? 3001 : 3000;
  const port = parseInteger(rawEnv.PORT, 'PORT', defaultPort);

  const defaultCookieSecure = isProd ? true : false;
  const cookieSecure = rawEnv.COOKIE_SECURE !== undefined
    ? parseBoolean(rawEnv.COOKIE_SECURE, 'COOKIE_SECURE')
    : defaultCookieSecure;

  const defaultRateLimitMax = isTest ? 1000 : 100;
  const rateLimitMax = parseInteger(rawEnv.RATE_LIMIT_MAX, 'RATE_LIMIT_MAX', defaultRateLimitMax);

  const rateLimitTimeWindowMs = parseInteger(
    rawEnv.RATE_LIMIT_TIME_WINDOW_MS,
    'RATE_LIMIT_TIME_WINDOW_MS',
    60000
  );

  const openAiTimeoutMs = parseInteger(
    rawEnv.OPENAI_TIMEOUT_MS,
    'OPENAI_TIMEOUT_MS',
    30000
  );

  const openAiApiKey = isConfiguredApiKey(rawEnv.OPENAI_API_KEY)
    ? rawEnv.OPENAI_API_KEY!.trim()
    : undefined;
  const openAiModel = rawEnv.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const openAiBaseUrl = (rawEnv.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');

  const sessionSecret = rawEnv.SESSION_SECRET || (isTest ? 'test_only_session_secret_at_least_32_chars_long_12345678' : '');
  const csrfSecret = rawEnv.CSRF_SECRET || (isTest ? 'test_only_csrf_secret_at_least_32_chars_long_1234567890' : '');

  const databaseUrl = rawEnv.DATABASE_URL || (isTest
    ? 'postgresql://127.0.0.1:5432/thaara_test'
    : 'postgresql://127.0.0.1:5432/thaara_dev');

  const redisUrl = rawEnv.REDIS_URL || 'redis://localhost:6379';

  const candidate: Config = {
    NODE_ENV: nodeEnv,
    PORT: port,
    HOST: rawEnv.HOST || '127.0.0.1',
    CORS_ORIGIN: rawEnv.CORS_ORIGIN || 'http://localhost:5173',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    SESSION_SECRET: sessionSecret,
    CSRF_SECRET: csrfSecret,
    COOKIE_SECURE: cookieSecure,
    COOKIE_DOMAIN: rawEnv.COOKIE_DOMAIN || undefined,
    LOG_LEVEL: (rawEnv.LOG_LEVEL as Config['LOG_LEVEL']) || (isTest ? 'error' : 'info'),
    RATE_LIMIT_MAX: rateLimitMax,
    RATE_LIMIT_TIME_WINDOW_MS: rateLimitTimeWindowMs,
    OPENAI_API_KEY: openAiApiKey,
    OPENAI_MODEL: openAiModel,
    OPENAI_BASE_URL: openAiBaseUrl,
    OPENAI_TIMEOUT_MS: openAiTimeoutMs
  };

  // 1. Strict TypeBox schema validation
  if (!ConfigValidator.Check(candidate)) {
    const errors = [...ConfigValidator.Errors(candidate)];
    const errorDetails = errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`[Config Error]: Configuration schema validation failed: ${errorDetails}`);
  }

  // 2. Secret safety validation (dev and prod)
  if (!isTest) {
    if (isUnsafePlaceholder(candidate.SESSION_SECRET)) {
      throw new Error(
        `[Config Error]: SESSION_SECRET is missing, too short (<32 chars), or using an unsafe placeholder. Refusing to boot in ${nodeEnv} mode.`
      );
    }
    if (isUnsafePlaceholder(candidate.CSRF_SECRET)) {
      throw new Error(
        `[Config Error]: CSRF_SECRET is missing, too short (<32 chars), or using an unsafe placeholder. Refusing to boot in ${nodeEnv} mode.`
      );
    }
  }

  // 3. Strict production environment checks
  if (isProd) {
    if (!candidate.COOKIE_SECURE) {
      throw new Error('[Config Error]: COOKIE_SECURE must be true in production environments.');
    }
    if (!candidate.DATABASE_URL || candidate.DATABASE_URL.includes('localhost') || candidate.DATABASE_URL.includes('127.0.0.1')) {
      throw new Error('[Config Error]: Production requires a production managed DATABASE_URL (cannot be empty or localhost).');
    }
    if (!candidate.REDIS_URL || candidate.REDIS_URL.includes('localhost') || candidate.REDIS_URL.includes('127.0.0.1')) {
      throw new Error('[Config Error]: Production requires a production managed REDIS_URL (cannot be empty or localhost).');
    }
  }

  return candidate;
}

