import { describe, it, expect } from 'vitest';
import { redactSensitiveData, formatErrorResponse, AppError } from '../src/index.js';

describe('Observability Module', () => {
  it('recursively redacts secret-shaped fields in objects and arrays', () => {
    const sensitivePayload = {
      user: {
        email: 'user@example.com',
        password: 'super-secret-password-123',
        nested: {
          api_token: 'secret_token_abc',
          regularField: 'safeValue'
        }
      },
      items: [
        { name: 'item1', client_secret: 'topsecret' },
        { name: 'item2', authorization: 'Bearer 12345' }
      ]
    };

    const redacted = redactSensitiveData(sensitivePayload);

    expect(redacted.user.password).toBe('[REDACTED]');
    expect(redacted.user.nested.api_token).toBe('[REDACTED]');
    expect(redacted.user.nested.regularField).toBe('safeValue');
    expect(redacted.user.email).toBe('user@example.com');
    expect(redacted.items[0]!.client_secret).toBe('[REDACTED]');
    expect(redacted.items[1]!.authorization).toBe('[REDACTED]');
  });

  it('formats errors without exposing internal stack traces', () => {
    const internalErr = new Error('Database connection crashed on internal pointer 0x999');
    const formatted = formatErrorResponse(internalErr);

    expect(formatted.statusCode).toBe(500);
    expect(formatted.body.error.code).toBe('INTERNAL_ERROR');
    expect(formatted.body.error.message).not.toContain('0x999');
    expect(formatted.body.error.message).toContain('An internal error occurred');
    expect((formatted.body.error as any).stack).toBeUndefined();

    const domainErr = new AppError('Tenant validation failed', 'TENANT_INVALID', 400, { field: 'name' });
    const formattedDomain = formatErrorResponse(domainErr);
    expect(formattedDomain.statusCode).toBe(400);
    expect(formattedDomain.body.error.code).toBe('TENANT_INVALID');
    expect(formattedDomain.body.error.message).toBe('Tenant validation failed');
  });
});
