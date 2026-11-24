import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import {
  SessionRepository,
  TransactionalDbClient,
  AuthenticatedScope,
  hashSessionToken
} from '@thaara/db';
import { CsrfError, UnauthorizedError } from '@thaara/observability';
import { verifyCsrfToken } from '../crypto/csrf.js';

export const SESSION_COOKIE_NAME = 'thaara_session';
export const CSRF_COOKIE_NAME = 'thaara_csrf';


export interface AuthPluginOptions {
  db: TransactionalDbClient;
}

const authPluginCallback: FastifyPluginAsync<AuthPluginOptions> = async (
  fastify: FastifyInstance,
  options: AuthPluginOptions
) => {
  const sessionRepo = new SessionRepository(options.db);

  fastify.decorateRequest('scope', undefined);
  fastify.decorateRequest('correlationId', '');

  fastify.addHook('onRequest', async (request, reply) => {
    const rawCorrelation = request.headers['x-correlation-id'] || request.headers['x-request-id'];
    const correlationId = Array.isArray(rawCorrelation)
      ? rawCorrelation[0]!
      : rawCorrelation || crypto.randomUUID();

    request.correlationId = correlationId;
    reply.header('x-correlation-id', correlationId);

    // Resolve session scope via SECURITY DEFINER function
    const rawSessionToken = request.cookies[SESSION_COOKIE_NAME];
    if (rawSessionToken) {
      const tokenHash = hashSessionToken(rawSessionToken);
      const resolvedScope = await sessionRepo.resolveSessionScope(rawSessionToken);
      if (resolvedScope) {
        const authScope: AuthenticatedScope = {
          sessionTokenHash: tokenHash,
          workspaceId: resolvedScope.workspace_id,
          userId: resolvedScope.user_id,
          role: resolvedScope.role,
          correlationId
        };
        request.scope = authScope;
        try {
          await options.db.withScopedTransaction(authScope, async (txClient) => {
            const sRepo = new SessionRepository(txClient);
            await sRepo.touchLastActive(resolvedScope.session_id);
          });
        } catch {
          // Non-critical touch update
        }
      }
    }
  });

  // Helper decorator to require authentication
  fastify.decorate('requireAuth', async (request: FastifyRequest) => {
    if (!request.scope) {
      throw new UnauthorizedError('Valid session required to access this resource.');
    }

    // Mutating methods require CSRF validation
    const mutatingMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (mutatingMethods.includes(request.method)) {
      const csrfHeader = request.headers['x-csrf-token'] as string | undefined;
      const csrfCookie = request.cookies[CSRF_COOKIE_NAME];

      if (!verifyCsrfToken(csrfHeader, csrfCookie)) {
        throw new CsrfError('Invalid or missing CSRF token.');
      }
    }
  });
};

export const authPlugin = fp(authPluginCallback);
