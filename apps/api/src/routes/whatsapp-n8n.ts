import { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { AppError } from '@thaara/observability';
import { N8nWhatsAppClaimResponseSchema, N8nWhatsAppClaimSchema, N8nWhatsAppDispatchSchema, N8nWhatsAppHistorySchema, N8nWhatsAppProviderReceiptSchema, N8nWhatsAppReceiptSchema, N8nWhatsAppRelayResultSchema, N8nWhatsAppRelaySchema, N8nWhatsAppStatusSchema, MetaWhatsAppSendInput, N8nWhatsAppProviderReceipt } from '@thaara/contracts';
import { N8nWhatsAppBridge } from '../services/whatsapp-n8n.js';
import { createHash } from 'node:crypto';
import { ScopeError, type WhatsAppRelayOperation, type WhatsAppRelayScope } from '@thaara/db';
import { ForbiddenError } from '@thaara/observability';
import type { DurableWhatsAppService } from '../services/whatsapp-durable.js';
export async function whatsappN8nRoutes(app: FastifyInstance, bridge = new N8nWhatsAppBridge(), durable?: DurableWhatsAppService) {
  const prefix = '/connectors/whatsapp/n8n';
  const user = { preHandler: [app.requireAuth], schema: { tags: ['WhatsAppN8n'] } };
  app.addHook('onSend', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  app.get(prefix + '/status', { ...user, schema: { ...user.schema, response: { 200: N8nWhatsAppStatusSchema } } }, request => bridge.status(request.scope!));
  app.get(prefix + '/messages', { ...user, schema: { ...user.schema, response: { 200: N8nWhatsAppHistorySchema } } }, request => bridge.history(request.scope!));
  app.post<{ Body: { draft: MetaWhatsAppSendInput; approvalId: string } }>(prefix + '/dispatches', { ...user, bodyLimit: 16384, preValidation: async request => {
    if (!Value.Check(N8nWhatsAppDispatchSchema, request.body) || Object.keys(request.query as object).length) throw new AppError('Invalid dispatch.', 'WHATSAPP_N8N_INVALID', 400);
  }, schema: { ...user.schema, body: N8nWhatsAppDispatchSchema, response: { 200: N8nWhatsAppReceiptSchema } } }, async request => {
    if (!durable) return bridge.dispatch(request.scope!, request.body.draft, request.body.approvalId);
    try { return await durable.reserve(request.scope!, request.body.draft.connectionId, request.body.draft, request.body.approvalId); }
    catch (error) {
      if (error instanceof ForbiddenError || error instanceof ScopeError) throw new ForbiddenError('WhatsApp owner operation denied.');
      throw new AppError('WhatsApp durable storage is not configured or is unavailable.', 'WHATSAPP_DURABLE_UNAVAILABLE', 503);
    }
  });
  app.delete(prefix + '/connection', user, async request => { await bridge.disconnect(request.scope!); return bridge.status(request.scope!); });
  const relay = prefix + '/relay/:connectionId';
  const params = Type.Object({ connectionId: Type.String({ pattern: '^[a-zA-Z0-9_-]{1,128}$' }) }, { additionalProperties: false });
  const exact = (keys: string[]) => async (request: FastifyRequest) => {
    if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).some(k => !keys.includes(k))) throw new AppError('Invalid relay envelope.', 'WHATSAPP_N8N_INVALID', 400);
  };
  const auth = (value: string | string[] | undefined) => typeof value === 'string' ? value : '';
  const machine = async <T>(request: FastifyRequest, id: string, operation: WhatsAppRelayOperation, work: (scope: WhatsAppRelayScope) => Promise<T>): Promise<T> => {
    const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(auth(request.headers.authorization));
    if (!match || request.headers.cookie || request.scope) throw new ForbiddenError('WhatsApp callback authentication denied.');
    try {
      const scope = await durable!.resolveRelay(createHash('sha256').update(match[1]!).digest('hex'), id, operation);
      return await work(scope);
    } catch (error) {
      if (error instanceof ForbiddenError || error instanceof ScopeError) throw new ForbiddenError('WhatsApp callback authentication denied.');
      throw new AppError('WhatsApp callback storage is not configured or is unavailable.', 'WHATSAPP_RELAY_UNAVAILABLE', 503);
    }
  };
  // Machine callbacks have distinct per-connection bearer authentication inside the bridge;
  // browser cookies/CSRF cannot authorize them and payload tenant claims are rejected.
  const machineRateLimit = { max: 300, timeWindow: '1 minute' };
  app.post<{ Params: { connectionId: string }; Body: { event: unknown } }>(relay + '/events', { config: { rateLimit: machineRateLimit }, bodyLimit: 131072, preValidation: exact(['event']), schema: { tags: ['WhatsAppN8n'], params, body: N8nWhatsAppRelaySchema, response: { 200: N8nWhatsAppRelayResultSchema } } }, request => durable ? machine(request, request.params.connectionId, 'events', scope => durable.ingest(scope, request.params.connectionId, request.body.event)) : bridge.ingest(request.params.connectionId, auth(request.headers.authorization), request.body.event));
  app.post<{ Params: { connectionId: string }; Body: { dispatchId: string; connectionRevision: number } }>(relay + '/claim', { config: { rateLimit: machineRateLimit }, bodyLimit: 4096, preValidation: exact(['dispatchId', 'connectionRevision']), schema: { tags: ['WhatsAppN8n'], params, body: N8nWhatsAppClaimSchema, response: { 200: N8nWhatsAppClaimResponseSchema } } }, request => durable ? machine(request, request.params.connectionId, 'claim', scope => durable.claim(scope, request.params.connectionId, request.body.dispatchId, request.body.connectionRevision)) : bridge.claim(request.params.connectionId, auth(request.headers.authorization), request.body.dispatchId, request.body.connectionRevision));
  app.post<{ Params: { connectionId: string }; Body: N8nWhatsAppProviderReceipt }>(relay + '/receipts', { config: { rateLimit: machineRateLimit }, bodyLimit: 4096, preValidation: exact(['dispatchId', 'providerMessageId', 'recipientAddress']), schema: { tags: ['WhatsAppN8n'], params, body: N8nWhatsAppProviderReceiptSchema, response: { 200: N8nWhatsAppReceiptSchema } } }, request => durable ? machine(request, request.params.connectionId, 'receipts', scope => durable.receipt(scope, request.params.connectionId, request.body)) : bridge.receipt(request.params.connectionId, auth(request.headers.authorization), request.body));
}
