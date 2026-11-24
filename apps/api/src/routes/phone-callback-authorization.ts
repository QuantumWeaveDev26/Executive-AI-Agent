import type { FastifyInstance } from 'fastify';
import { ForbiddenError } from '@thaara/observability';
import type { PhoneCallbackNotificationRepository } from '../services/phone-callback-notification-store.js';
import {
  PhoneCallbackGrantPrepareSchema, PhoneCallbackGrantActivateSchema, PhoneCallbackGrantPreparedSchema,
  PhoneCallbackGrantActivatedSchema, PhoneCallbackGrantRevokedSchema,
} from '@thaara/contracts';

export type PhoneCallbackAuthorization = Pick<PhoneCallbackNotificationRepository,
  'prepareNotificationGrant' | 'activateNotificationGrant' | 'revokeNotificationGrant'>;

/** Local owner authorization flow. Live storage admission is required before production registration. */
export async function phoneCallbackAuthorizationRoutes(app: FastifyInstance, service: PhoneCallbackAuthorization) {
  if (process.env.NODE_ENV !== 'test') throw new Error('Callback authorization storage requires production admission.');
  const preHandler = [app.requireAuth, async (request: import('fastify').FastifyRequest) => {
    if (request.scope?.role !== 'owner') throw new ForbiddenError('Callback authorization requires the owner.');
  }];
  const onSend = async (_request: unknown, reply: { header(name: string, value: string): unknown }) => { reply.header('Cache-Control', 'no-store'); };
  const base = '/connectors/phone/callbacks/authorization';
  app.post<{ Body: { expiresAt: string } }>(base + '/prepare', { preHandler, onSend, bodyLimit: 1024,
    schema: { body: PhoneCallbackGrantPrepareSchema, response: { 200: PhoneCallbackGrantPreparedSchema } } },
  request => service.prepareNotificationGrant(request.scope!, request.body.expiresAt));
  app.post<{ Body: { approvalId: string } }>(base + '/activate', { preHandler, onSend, bodyLimit: 1024,
    schema: { body: PhoneCallbackGrantActivateSchema, response: { 200: PhoneCallbackGrantActivatedSchema } } },
  request => service.activateNotificationGrant(request.scope!, request.body.approvalId));
  app.post(base + '/revoke', { preHandler, onSend, bodyLimit: 1024, schema: { response: { 200: PhoneCallbackGrantRevokedSchema } } },
    async request => { await service.revokeNotificationGrant(request.scope!); return { enabled: false as const }; });
}
