import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { phoneCallbackReportRoutes } from '../src/routes/phone-callback-reports.js';
import { projectCallbackRequest } from '../src/services/phone-callback-notification.js';

it('exposes callback reports through the owner-only versioned route with private caching', async () => {
  const app = Fastify();
  const scope = { workspaceId: 'tenant-a', userId: 'owner-a', role: 'owner' as const };
  const request = projectCallbackRequest({ ...scope, callId: 'fixture', direction: 'inbound', occurredAt: '2026-11-11T00:00:00Z',
    verifiedNumber: '+919000000001', turns: [{ speaker: 'agent', text: 'May I record a callback request?' }, { speaker: 'caller', text: 'Yes' }],
  }, { requested: true })!;
  app.decorate('requireAuth', async (incoming: any, reply: any) => {
    if (!incoming.headers['x-fixture-role']) return reply.code(401).send();
    incoming.scope = { ...scope, role: incoming.headers['x-fixture-role'] };
  });
  await app.register(async child => phoneCallbackReportRoutes(child, async () => [request]), { prefix: '/api/v1' });
  try {
    const path = '/api/v1/connectors/phone/callbacks/reports';
    expect((await app.inject(path)).statusCode).toBe(401);
    expect((await app.inject({ url: path, headers: { 'x-fixture-role': 'member' } })).statusCode).toBe(403);
    const response = await app.inject({ url: path, headers: { 'x-fixture-role': 'owner' } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().reports[0]).toMatchObject({ callbackConfirmed: true, notificationStatus: 'pending', missingFields: ['name', 'business', 'service'] });
    expect(response.body).not.toContain('notificationAttemptId');
    expect(response.body).not.toContain('providerMessageId');
  } finally { await app.close(); }
});
