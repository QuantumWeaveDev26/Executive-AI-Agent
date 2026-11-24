import { AuthenticatedScope } from '@thaara/db';
import { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    scope?: AuthenticatedScope;
    correlationId: string;
  }
}
