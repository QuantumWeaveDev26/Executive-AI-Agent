import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  AutomationActivityQuery, AutomationActivityQuerySchema, AutomationActivityResponseSchema,
  AutomationDetailSchema, AutomationListQuery, AutomationListQuerySchema,
  AutomationListResponseSchema, ErrorResponseSchema
} from '@thaara/contracts';
import { AutomationActivityRepository, AutomationManagementRepository, MembershipRepository, TransactionalDbClient } from '@thaara/db';
import { ForbiddenError, NotFoundError } from '@thaara/observability';

export async function automationRoutes(app: FastifyInstance, options: { db: TransactionalDbClient }) {
  const { db } = options;
  // Workspace reads follow the existing plan permission model, including viewers.
  // These routes never reconcile plans, enqueue jobs, or invoke any action adapters.
  app.get<{ Querystring: AutomationListQuery }>('/automations', {
    preHandler: [app.requireAuth],
    schema: {
      tags: ['Automations'],
      description: 'Read paginated workspace automations without executing or reconciling work',
      querystring: AutomationListQuerySchema,
      response: { 200: AutomationListResponseSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema }
    }
  }, async (request, reply) => {
    const scope = request.scope!;
    const result = await db.withScopedTransaction(scope, async (tx) => {
      if (!await new MembershipRepository(tx).findByUserAndWorkspace(scope.workspaceId, scope.userId)) {
        throw new ForbiddenError('Active workspace membership is required.');
      }
      return new AutomationManagementRepository(tx).list(scope.workspaceId, request.query);
    });
    return reply.header('Cache-Control', 'no-store').send(result);
  });

  app.get<{ Params: { id: string } }>('/automations/:id', {
    preHandler: [app.requireAuth],
    schema: {
      tags: ['Automations'],
      description: 'Read automation steps, available approval records and receipt evidence without raw artifacts',
      params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      response: { 200: AutomationDetailSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema }
    }
  }, async (request, reply) => {
    const scope = request.scope!;
    const result = await db.withScopedTransaction(scope, async (tx) => {
      if (!await new MembershipRepository(tx).findByUserAndWorkspace(scope.workspaceId, scope.userId)) {
        throw new ForbiddenError('Active workspace membership is required.');
      }
      const detail = await new AutomationManagementRepository(tx).detail(scope.workspaceId, request.params.id);
      if (!detail) throw new NotFoundError('Automation not found.');
      return detail;
    });
    return reply.header('Cache-Control', 'no-store').send(result);
  });

  app.get<{ Params: { id: string }; Querystring: AutomationActivityQuery }>('/automations/:id/activity', {
    preHandler: [app.requireAuth],
    schema: {
      tags: ['Automations'],
      description: 'Read chronological retained automation activity without reconciliation or execution',
      params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      querystring: AutomationActivityQuerySchema,
      response: { 200: AutomationActivityResponseSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema }
    }
  }, async (request, reply) => {
    const scope = request.scope!;
    const result = await db.withScopedTransaction(scope, async (tx) => {
      if (!await new MembershipRepository(tx).findByUserAndWorkspace(scope.workspaceId, scope.userId)) {
        throw new ForbiddenError('Active workspace membership is required.');
      }
      const activity = await new AutomationActivityRepository(tx).list(scope.workspaceId, request.params.id, request.query);
      if (!activity) throw new NotFoundError('Automation not found.');
      return activity;
    });
    return reply.header('Cache-Control', 'no-store').send(result);
  });
}
