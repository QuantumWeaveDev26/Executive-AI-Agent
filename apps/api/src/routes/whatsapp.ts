import { FastifyInstance, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  WhatsAppBriefingQuery,
  WhatsAppBriefingQuerySchema,
  WhatsAppBriefingResponseSchema,
  WhatsAppConnectInput,
  WhatsAppConnectInputSchema,
  WhatsAppListMessages,
  WhatsAppListMessagesResponseSchema,
  WhatsAppListMessagesSchema,
  WhatsAppMessageIdSchema,
  WhatsAppMessageSchema,
  WhatsAppStatusSchema
} from '@thaara/contracts';
import { AuditEventRepository, AuthenticatedScope, TransactionalDbClient } from '@thaara/db';
import { ForbiddenError } from '@thaara/observability';
import { PolicyGateway } from '@thaara/policy';
import { WhatsAppFoundation, WhatsAppOptions } from '../services/whatsapp.js';

export async function whatsappRoutes(
  app: FastifyInstance,
  options: {
    db: TransactionalDbClient;
    policyGateway: PolicyGateway;
    whatsapp?: WhatsAppOptions;
  }
): Promise<WhatsAppFoundation> {
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
          'whatsapp_business_connection',
          payload,
          scope.userId
        );
      }
    });
  }

  const service = new WhatsAppFoundation({
    ...options.whatsapp,
    policyGateway: options.policyGateway,
    audit: (scope, action, payload) => scoped(scope, action, payload)
  });

  const preHandler = [
    async (_request: unknown, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    },
    app.requireAuth
  ];
  const tags = ['WhatsAppBusiness'];

  app.get(
    '/connectors/whatsapp/status',
    { preHandler, schema: { tags, response: { 200: WhatsAppStatusSchema } } },
    async (request) => {
      await scoped(request.scope!);
      return service.status(request.scope!);
    }
  );

  app.post<{ Body: WhatsAppConnectInput }>(
    '/connectors/whatsapp/connect',
    {
      preHandler,
      schema: {
        tags,
        body: WhatsAppConnectInputSchema,
        response: { 200: WhatsAppStatusSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.connect(request.scope!, request.body);
    }
  );

  app.delete(
    '/connectors/whatsapp/connection',
    { preHandler, schema: { tags, response: { 200: WhatsAppStatusSchema } } },
    async (request) => {
      await scoped(request.scope!);
      return service.disconnect(request.scope!);
    }
  );

  app.post<{ Body: WhatsAppListMessages }>(
    '/connectors/whatsapp/messages/list',
    {
      preHandler,
      schema: {
        tags,
        body: WhatsAppListMessagesSchema,
        response: { 200: WhatsAppListMessagesResponseSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.listMessages(request.scope!, request.body);
    }
  );

  app.get<{ Params: { messageId: string } }>(
    '/connectors/whatsapp/messages/:messageId',
    {
      preHandler,
      schema: {
        tags,
        params: Type.Object({ messageId: WhatsAppMessageIdSchema }, { additionalProperties: false }),
        response: { 200: WhatsAppMessageSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.readMessage(request.scope!, request.params.messageId);
    }
  );

  app.post<{ Body: WhatsAppBriefingQuery }>(
    '/connectors/whatsapp/briefing',
    {
      preHandler,
      schema: {
        tags,
        body: WhatsAppBriefingQuerySchema,
        response: { 200: WhatsAppBriefingResponseSchema }
      }
    },
    async (request) => {
      await scoped(request.scope!);
      return service.prepareBriefing(request.scope!, request.body);
    }
  );

  return service;
}
