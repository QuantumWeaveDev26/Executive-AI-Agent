import { FastifyInstance } from 'fastify';
import { AuditListResponse, AuditListResponseSchema, ErrorResponseSchema } from '@thaara/contracts';
import { AuditEventRepository, TransactionalDbClient } from '@thaara/db';

export async function auditRoutes(
  fastify: FastifyInstance,
  options: { db: TransactionalDbClient }
): Promise<void> {
  const { db } = options;

  fastify.get<{ Reply: AuditListResponse }>(
    '/audit',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'List audit events for active workspace',
        tags: ['Audit'],
        response: {
          200: AuditListResponseSchema,
          401: ErrorResponseSchema
        }
      }
    },
    async (request) => {
      const scope = request.scope!;

      return await db.withScopedTransaction(scope, async (txClient) => {
        const auditRepo = new AuditEventRepository(txClient);
        const result = await auditRepo.listByWorkspace(scope.workspaceId);
        return {
          events: result.events.map((e) => ({
            id: e.id,
            workspaceId: e.workspace_id,
            actorUserId: e.actor_user_id,
            action: e.action,
            targetType: e.target_type,
            targetId: e.target_id,
            payload: e.payload,
            createdAt: e.created_at
          })),
          total: result.total
        };
      });
    }
  );
}
