import { FastifyInstance, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  PhoneBriefingQuery,
  PhoneBriefingQuerySchema,
  PhoneBriefingResponseSchema,
  PhoneCallIdSchema,
  PhoneCallRecordSchema,
  PhoneConnectInput,
  PhoneConnectInputSchema,
  PhoneListCalls,
  PhoneListCallsResponseSchema,
  PhoneListCallsSchema,
  PhoneStatusSchema
} from '@thaara/contracts';
import { AuditEventRepository, AuthenticatedScope, TransactionalDbClient } from '@thaara/db';
import { ForbiddenError } from '@thaara/observability';
import { PolicyGateway } from '@thaara/policy';
import { PhoneFoundation, PhoneOptions } from '../services/phone.js';

export async function phoneRoutes(
  app: FastifyInstance,
  options: {
    db: TransactionalDbClient;
    policyGateway: PolicyGateway;
    phone?: PhoneOptions;
  }
): Promise<PhoneFoundation> {
  async function scoped(
    scope: AuthenticatedScope,
    action?: string,
    payload: Record<string, unknown> = {}
  ) {
    await options.db.withScopedTransaction(scope, async (tx) => {
      const { rows } = await tx.query<{ workspace_id: string; user_id: string; role: string }>(
        'SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)',
        [scope.sessionTokenHash]
      );
      const current = rows[0];
      if (
        !current ||
        current.workspace_id !== scope.workspaceId ||
        current.user_id !== scope.userId ||
        current.role !== scope.role
      ) {
        throw new ForbiddenError('Active matching workspace membership is required.');
      }
      if (action) {
        await new AuditEventRepository(tx).create(
          scope.workspaceId,
          action,
          'phone_telephony_connection',
          payload,
          scope.userId
        );
      }
    });
  }

  const service = new PhoneFoundation({
    ...options.phone,
    policyGateway: options.policyGateway,
    audit: (scope, action, payload) => scoped(scope, action, payload)
  });

  const preHandler = [
    async (_request: unknown, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    },
    app.requireAuth
  ];
  const tags = ['PhoneTelephony'];

  app.get(
    '/connectors/phone/status',
    { preHandler, schema: { tags, response: { 200: PhoneStatusSchema } } },
    async (request) => {
      await scoped(request.scope!);
      return service.status(request.scope!);
    }
  );

  app.post<{ Body: PhoneConnectInput }>(
    '/connectors/phone/connect',
    {
      preHandler,
      schema: {
        tags,
        body: PhoneConnectInputSchema,
        response: { 200: PhoneStatusSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.connect(request.scope!, request.body);
    }
  );

  app.delete(
    '/connectors/phone/connection',
    { preHandler, schema: { tags, response: { 200: PhoneStatusSchema } } },
    async (request) => {
      await scoped(request.scope!);
      return service.disconnect(request.scope!);
    }
  );

  app.post<{ Body: PhoneListCalls }>(
    '/connectors/phone/calls/list',
    {
      preHandler,
      schema: {
        tags,
        body: PhoneListCallsSchema,
        response: { 200: PhoneListCallsResponseSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.listCalls(request.scope!, request.body);
    }
  );

  app.get<{ Params: { callId: string } }>(
    '/connectors/phone/calls/:callId',
    {
      preHandler,
      schema: {
        tags,
        params: Type.Object({ callId: PhoneCallIdSchema }, { additionalProperties: false }),
        response: { 200: PhoneCallRecordSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.readCall(request.scope!, request.params.callId);
    }
  );

  app.post<{ Body: PhoneBriefingQuery }>(
    '/connectors/phone/briefing',
    {
      preHandler,
      schema: {
        tags,
        body: PhoneBriefingQuerySchema,
        response: { 200: PhoneBriefingResponseSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.prepareBriefing(request.scope!, request.body);
    }
  );

  return service;
}
