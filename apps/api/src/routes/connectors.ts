/// <reference path="../types/fastify.d.ts" />
import { FastifyInstance } from 'fastify';
import { ConnectorStatusResponse, ConnectorStatusResponseSchema } from '@thaara/contracts';
import { ConnectorAdapter, defaultTestAdapter } from '@thaara/policy';

export async function connectorRoutes(
  fastify: FastifyInstance,
  options: { adapter?: ConnectorAdapter } = {}
): Promise<void> {
  const adapter = options.adapter || defaultTestAdapter;

  fastify.get<{ Reply: ConnectorStatusResponse }>(
    '/connectors/status',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Get truthful status of the test connector adapter',
        tags: ['Connectors'],
        response: {
          200: ConnectorStatusResponseSchema
        }
      }
    },
    async () => {
      // Truthful adapter state: returns not_configured and connected: false
      return await adapter.getStatus();
    }
  );
}
