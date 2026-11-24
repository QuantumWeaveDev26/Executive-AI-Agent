import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  InitiatePurgeInput,
  InitiatePurgeInputSchema,
  PurgeOperationRecord,
  PurgeOperationRecordSchema,
  ExportHistoryResult,
  ExportHistoryResultSchema,
  ErrorResponseSchema
} from '@thaara/contracts';
import { PrivacyPurgeRepository, MemoryItemRepository, TransactionalDbClient } from '@thaara/db';
import { NotFoundError } from '@thaara/observability';

export async function privacyRoutes(
  fastify: FastifyInstance,
  options: { db: TransactionalDbClient }
): Promise<void> {
  const { db } = options;
  const privacyRepo = new PrivacyPurgeRepository(db);

  // 1. POST /privacy/purge - Initiate self privacy purge
  fastify.post<{ Body: InitiatePurgeInput; Reply: { operation_id: string; status: string } }>(
    '/privacy/purge',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Initiate a self-service privacy purge operation',
        tags: ['Privacy'],
        body: InitiatePurgeInputSchema,
        response: {
          202: Type.Object({
            operation_id: Type.String({ format: 'uuid' }),
            status: Type.String()
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const operationId = await privacyRepo.initiatePurge(scope, request.body);
      return reply.status(202).send({ operation_id: operationId, status: 'pending' });
    }
  );

  // 2. GET /privacy/purge/:id - Get purge operation status
  fastify.get<{
    Params: { id: string };
    Reply: PurgeOperationRecord;
  }>(
    '/privacy/purge/:id',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Get privacy purge operation status',
        tags: ['Privacy'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' })
        }),
        response: {
          200: PurgeOperationRecordSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const status = await privacyRepo.getPurgeStatus(scope, request.params.id);
      if (!status) {
        throw new NotFoundError(`Purge operation '${request.params.id}' not found`);
      }
      return reply.send(status);
    }
  );

  // 3. GET /privacy/export - Export user conversation history and memories
  fastify.get<{ Reply: ExportHistoryResult }>(
    '/privacy/export',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Export all personal conversation history and consented memory records',
        tags: ['Privacy'],
        response: {
          200: ExportHistoryResultSchema,
          401: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const exportData = await privacyRepo.exportHistory(scope);
      const memoryRepo = new MemoryItemRepository(db);
      const memories = await memoryRepo.list(scope);
      return reply.send({
        ...exportData,
        memories: exportData.memories ?? memories
      });
    }
  );
}
