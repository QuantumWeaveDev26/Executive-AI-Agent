import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ErrorResponseSchema } from '@thaara/contracts';
import { TransactionalDbClient } from '@thaara/db';
import { ForbiddenError, ValidationError } from '@thaara/observability';

export const AdminInspectInputSchema = Type.Object({
  conversation_id: Type.String({ format: 'uuid' }),
  justification: Type.String({ minLength: 10, maxLength: 500 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 }))
});
export type AdminInspectInput = import('@sinclair/typebox').Static<typeof AdminInspectInputSchema>;

export async function adminInspectionRoutes(
  fastify: FastifyInstance,
  options: { db: TransactionalDbClient }
): Promise<void> {
  const { db } = options;

  // POST /admin/inspect - Administrative private conversation inspection
  fastify.post<{ Body: AdminInspectInput; Reply: Record<string, unknown> }>(
    '/admin/inspect',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Administrative inspection of a private conversation with mandatory justification',
        tags: ['Admin'],
        body: AdminInspectInputSchema,
        response: {
          200: Type.Record(Type.String(), Type.Unknown()),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;

      // Enforce admin/owner role authorization
      if (scope.role !== 'admin' && scope.role !== 'owner') {
        throw new ForbiddenError('Administrative inspection requires an admin or owner role');
      }

      const { conversation_id, justification, limit, offset } = request.body;
      if (!justification || justification.trim().length < 10) {
        throw new ValidationError('A meaningful justification of at least 10 characters is required for administrative inspection');
      }

      const messages = await db.withScopedTransaction(scope, async (client) => {
        const { rows } = await client.query<{
          id: string;
          sequence_number: number;
          sender_type: string;
          sender_id: string;
          content: string;
          advisory_token_count: number;
          created_at: string;
        }>(
          `SELECT id, sequence_number, sender_type, sender_id, content, advisory_token_count, created_at
           FROM public.inspect_private_conversation($1, $2, $3, $4, $5);`,
          [
            scope.sessionTokenHash,
            conversation_id,
            justification.trim(),
            limit ?? 50,
            offset ?? 0
          ]
        );

        return rows;
      });

      return reply.send({
        conversation_id,
        justification: justification.trim(),
        inspected_at: new Date().toISOString(),
        messages
      });
    }
  );
}
