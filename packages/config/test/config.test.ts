import { describe, it, expect } from 'vitest';
import { loadConfig, isUnsafePlaceholder, isConfiguredApiKey } from '../src/index.js';

describe('Config Module', () => {
  it('detects unsafe placeholder secrets', () => {
    expect(isUnsafePlaceholder('replace_with_at_least_32_char_random_secret_in_env')).toBe(true);
    expect(isUnsafePlaceholder('change-me-please-1234567890123456')).toBe(true);
    expect(isUnsafePlaceholder('short')).toBe(true);
    expect(isUnsafePlaceholder('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0')).toBe(false);
  });

  it('refuses to start in development when secrets are unsafe placeholders', () => {
    expect(() => {
      loadConfig({
        NODE_ENV: 'development',
        SESSION_SECRET: 'replace_with_at_least_32_char_random_secret_in_env',
        CSRF_SECRET: 'valid_csrf_secret_that_is_at_least_32_chars_long'
      });
    }).toThrow(/SESSION_SECRET is missing, too short/);

    expect(() => {
      loadConfig({
        NODE_ENV: 'development',
        SESSION_SECRET: 'valid_session_secret_that_is_at_least_32_chars_long',
        CSRF_SECRET: 'replace_with_at_least_32_char_random_secret_in_env'
      });
    }).toThrow(/CSRF_SECRET is missing, too short/);
  });

  it('enforces production security rules', () => {
    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'valid_prod_session_secret_at_least_32_chars_long',
        CSRF_SECRET: 'valid_prod_csrf_secret_at_least_32_chars_long',
        COOKIE_SECURE: 'false',
        DATABASE_URL: 'postgresql://prod-db.internal:5432/thaara',
        REDIS_URL: 'redis://prod-redis.internal:6379'
      });
    }).toThrow(/COOKIE_SECURE must be true in production/);

    expect(() => {
      loadConfig({
        NODE_ENV: 'production',
        SESSION_SECRET: 'valid_prod_session_secret_at_least_32_chars_long',
        CSRF_SECRET: 'valid_prod_csrf_secret_at_least_32_chars_long',
        COOKIE_SECURE: 'true',
        DATABASE_URL: 'postgresql://localhost:5432/thaara',
        REDIS_URL: 'redis://prod-redis.internal:6379'
      });
    }).toThrow(/Production requires a production managed DATABASE_URL/);
  });

  it('provides safe test-only defaults in test environment', () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    expect(config.NODE_ENV).toBe('test');
    expect(config.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(config.CSRF_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(config.PORT).toBeDefined();
    expect(config.OPENAI_API_KEY).toBeUndefined();
    expect(config.OPENAI_MODEL).toBe('gpt-4o-mini');
    expect(config.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    expect(config.OPENAI_TIMEOUT_MS).toBe(30000);
  });

  it('normalizes OpenAI settings and ignores placeholder API keys', () => {
    expect(isConfiguredApiKey(undefined)).toBe(false);
    expect(isConfiguredApiKey('')).toBe(false);
    expect(isConfiguredApiKey('your_openai_api_key_here')).toBe(false);
    expect(isConfiguredApiKey('sk-test-valid-key-value')).toBe(true);

    const placeholderCfg = loadConfig({
      NODE_ENV: 'test',
      OPENAI_API_KEY: 'your_openai_api_key_here'
    });
    expect(placeholderCfg.OPENAI_API_KEY).toBeUndefined();

    const customCfg = loadConfig({
      NODE_ENV: 'test',
      OPENAI_API_KEY: 'sk-test-valid-key-value',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_BASE_URL: 'https://api.openai.com/v1///',
      OPENAI_TIMEOUT_MS: '15000'
    });
    expect(customCfg.OPENAI_API_KEY).toBe('sk-test-valid-key-value');
    expect(customCfg.OPENAI_MODEL).toBe('gpt-4o');
    expect(customCfg.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    expect(customCfg.OPENAI_TIMEOUT_MS).toBe(15000);
  });

  it('rejects invalid port formats and out-of-range ports', () => {
    expect(() => {
      loadConfig({ NODE_ENV: 'test', PORT: 'not-a-number' });
    }).toThrow(/PORT must be a valid integer/);

    expect(() => {
      loadConfig({ NODE_ENV: 'test', PORT: '80' }); // Below minimum 1024
    }).toThrow(/Configuration schema validation failed/);

    expect(() => {
      loadConfig({ NODE_ENV: 'test', PORT: '70000' }); // Above maximum 65535
    }).toThrow(/Configuration schema validation failed/);
  });

  it('rejects non-boolean COOKIE_SECURE values', () => {
    expect(() => {
      loadConfig({ NODE_ENV: 'test', COOKIE_SECURE: 'maybe' });
    }).toThrow(/COOKIE_SECURE must be a boolean/);
  });

  it('rejects invalid log level via TypeBox schema validation', () => {
    expect(() => {
      loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'verbose' as any });
    }).toThrow(/Configuration schema validation failed/);
  });
});

