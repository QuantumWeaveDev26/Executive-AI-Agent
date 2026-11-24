import { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  MemoryItemRecord,
  MemoryItemRecordSchema,
  CreateMemoryInput,
  CreateMemoryInputSchema,
  SupersedeMemoryInput,
  SupersedeMemoryInputSchema,
  MemoryCategorySchema,
  MemoryScopeSchema,
  ConsentStatusSchema,
  ErrorResponseSchema
} from '@thaara/contracts';
import { MemoryItemRepository, TransactionalDbClient } from '@thaara/db';
import { NotFoundError } from '@thaara/observability';

export async function memoryRoutes(
  fastify: FastifyInstance,
  options: { db: TransactionalDbClient }
): Promise<void> {
  const { db } = options;
  const memoryRepo = new MemoryItemRepository(db);

  // 1. POST /memories - Create memory item
  fastify.post<{ Body: CreateMemoryInput; Reply: MemoryItemRecord }>(
    '/memories',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Create a new memory item',
        tags: ['Memories'],
        body: CreateMemoryInputSchema,
        response: {
          201: MemoryItemRecordSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const item = await memoryRepo.create(scope, request.body);
      return reply.status(201).send(item);
    }
  );

  // 2. GET /memories - List memories
  fastify.get<{
    Querystring: {
      scope?: 'user' | 'workspace';
      category?: 'preference' | 'fact' | 'guideline' | 'decision';
      consentStatus?: 'pending_consent' | 'consented' | 'revoked';
      limit?: number;
      offset?: number;
    };
    Reply: MemoryItemRecord[];
  }>(
    '/memories',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'List accessible memories',
        tags: ['Memories'],
        querystring: Type.Object({
          scope: Type.Optional(MemoryScopeSchema),
          category: Type.Optional(MemoryCategorySchema),
          consentStatus: Type.Optional(ConsentStatusSchema),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Integer({ minimum: 0 }))
        }),
        response: {
          200: Type.Array(MemoryItemRecordSchema),
          401: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const list = await memoryRepo.list(scope, request.query);
      return reply.send(list);
    }
  );

  // 3. GET /memories/:id - Get memory item
  fastify.get<{
    Params: { id: string };
    Reply: MemoryItemRecord;
  }>(
    '/memories/:id',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Get memory item by ID',
        tags: ['Memories'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' })
        }),
        response: {
          200: MemoryItemRecordSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const item = await memoryRepo.findById(scope, request.params.id);
      if (!item) {
        throw new NotFoundError(`Memory item '${request.params.id}' not found`);
      }
      return reply.send(item);
    }
  );

  // 4. POST /memories/:id/consent - Grant consent
  fastify.post<{
    Params: { id: string };
    Reply: { success: boolean; memory: MemoryItemRecord };
  }>(
    '/memories/:id/consent',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Grant consent for a memory item',
        tags: ['Memories'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' })
        }),
        response: {
          200: Type.Object({
            success: Type.Boolean(),
            memory: MemoryItemRecordSchema
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const item = await memoryRepo.grantConsent(scope, request.params.id);
      return reply.send({ success: true, memory: item });
    }
  );

  // 5. DELETE /memories/:id/consent - Revoke consent
  fastify.delete<{
    Params: { id: string };
    Reply: { success: boolean; memory: MemoryItemRecord };
  }>(
    '/memories/:id/consent',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Revoke consent for a memory item',
        tags: ['Memories'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' })
        }),
        response: {
          200: Type.Object({
            success: Type.Boolean(),
            memory: MemoryItemRecordSchema
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const item = await memoryRepo.revokeConsent(scope, request.params.id);
      return reply.send({ success: true, memory: item });
    }
  );

  // 6. POST /memories/:id/supersede - Supersede memory item
  fastify.post<{
    Params: { id: string };
    Body: SupersedeMemoryInput;
    Reply: { success: boolean; memory: MemoryItemRecord };
  }>(
    '/memories/:id/supersede',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Supersede a memory item with updated value',
        tags: ['Memories'],
        params: Type.Object({
          id: Type.String({ format: 'uuid' })
        }),
        body: SupersedeMemoryInputSchema,
        response: {
          200: Type.Object({
            success: Type.Boolean(),
            memory: MemoryItemRecordSchema
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const scope = request.scope!;
      const item = await memoryRepo.supersede(scope, request.params.id, request.body);
      return reply.send({ success: true, memory: item });
    }
  );
}
