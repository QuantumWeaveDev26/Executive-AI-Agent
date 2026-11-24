import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { phoneCallbackAuthorizationRoutes } from '../src/routes/phone-callback-authorization.js';

it('provides only authenticated owner preparation, approved activation and revocation', async () => {
  const app = Fastify();
  const approvalId = '10000000-0000-4000-8000-000000000001';
  const scope = { workspaceId: 'tenant', userId: 'owner', role: 'owner' };
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const prepareNotificationGrant = vi.fn(async () => ({ approvalId, status: 'awaiting_approval' as const,
    parameters: { enabled: true, sender: 'notifications@brandmintai.io', recipient: 'connect@brandmintai.io', expiresAt } }));
  const activateNotificationGrant = vi.fn(async () => ({ enabled: true as const, approvalId }));
  const revokeNotificationGrant = vi.fn(async () => {});
  app.decorate('requireAuth', async (request: any, reply: any) => {
    if (!request.headers['x-test-role']) return reply.code(401).send();
    request.scope = { ...scope, role: request.headers['x-test-role'] };
  });
  await app.register(async child => phoneCallbackAuthorizationRoutes(child, {
    prepareNotificationGrant, activateNotificationGrant, revokeNotificationGrant,
  }), { prefix: '/api/v1' });
  const base = '/api/v1/connectors/phone/callbacks/authorization';
  try {
    for (const suffix of ['/prepare', '/activate', '/revoke']) {
      const payload = suffix === '/prepare' ? { expiresAt } : suffix === '/activate' ? { approvalId } : {};
      expect((await app.inject({ method: 'POST', url: base + suffix, payload })).statusCode).toBe(401);
      expect((await app.inject({ method: 'POST', url: base + suffix, payload, headers: { 'x-test-role': 'admin' } })).statusCode).toBe(403);
    }
    expect(prepareNotificationGrant).not.toHaveBeenCalled();
    expect(activateNotificationGrant).not.toHaveBeenCalled();
    expect(revokeNotificationGrant).not.toHaveBeenCalled();
    const headers = { 'x-test-role': 'owner' };
    const prepared = await app.inject({ method: 'POST', url: base + '/prepare', headers, payload: { expiresAt } });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.headers['cache-control']).toBe('no-store');
    expect(prepared.json().parameters.recipient).toBe('connect@brandmintai.io');
    expect(activateNotificationGrant).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url: base + '/activate', headers, payload: { approvalId } })).json()).toEqual({ enabled: true, approvalId });
    expect((await app.inject({ method: 'POST', url: base + '/revoke', headers })).json()).toEqual({ enabled: false });
    expect(activateNotificationGrant).toHaveBeenCalledWith(scope, approvalId);
    expect(revokeNotificationGrant).toHaveBeenCalledWith(scope);
  } finally { await app.close(); }
});
