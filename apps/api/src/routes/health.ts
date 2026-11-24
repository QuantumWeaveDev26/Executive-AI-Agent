import { FastifyInstance } from 'fastify';
import { HealthResponseSchema } from '@thaara/contracts';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/health',
    {
      schema: {
        description: 'Service healthcheck',
        tags: ['System'],
        response: {
          200: HealthResponseSchema
        }
      }
    },
    async () => {
      return {
        status: 'ok' as const,
        version: '0.1.0',
        timestamp: new Date().toISOString()
      };
    }
  );
}
