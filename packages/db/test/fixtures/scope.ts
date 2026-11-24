import crypto from 'node:crypto';
import { AuthenticatedScope } from '../../src/client.js';
import { hashSessionToken } from '../../src/repositories/sessions.js';

export function createTestAuthenticatedScope(
  overrides: Partial<AuthenticatedScope> = {}
): AuthenticatedScope {
  const rawToken = overrides.sessionTokenHash ? undefined : crypto.randomBytes(32).toString('hex');
  return {
    sessionTokenHash: overrides.sessionTokenHash ?? hashSessionToken(rawToken!),
    workspaceId: overrides.workspaceId ?? crypto.randomUUID(),
    userId: overrides.userId ?? crypto.randomUUID(),
    role: overrides.role ?? 'owner',
    correlationId: overrides.correlationId ?? crypto.randomUUID()
  };
}
