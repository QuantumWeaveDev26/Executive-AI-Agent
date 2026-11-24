import { FastifyInstance } from 'fastify';
import {
  BootstrapRequest,
  BootstrapRequestSchema,
  BootstrapResponse,
  BootstrapResponseSchema,
  ErrorResponseSchema
} from '@thaara/contracts';
import {
  AuditEventRepository,
  MembershipRepository,
  SessionRepository,
  TransactionalDbClient,
  UserRepository,
  WorkspaceRepository,
  generateSessionToken,
  AuthenticatedScope,
  hashSessionToken
} from '@thaara/db';
import { ForbiddenError } from '@thaara/observability';
import { hashPassword } from '../crypto/password.js';
import { generateCsrfToken } from '../crypto/csrf.js';
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '../plugins/auth.js';
import { Config } from '@thaara/config';

export async function bootstrapRoutes(
  fastify: FastifyInstance,
  options: { db: TransactionalDbClient; config: Config }
): Promise<void> {
  const { db, config } = options;
  const userRepo = new UserRepository(db);
  const workspaceRepo = new WorkspaceRepository(db);

  fastify.post<{ Body: BootstrapRequest; Reply: BootstrapResponse }>(
    '/bootstrap',
    {
      schema: {
        description: 'Single-use initial local owner bootstrap',
        tags: ['Auth'],
        body: BootstrapRequestSchema,
        response: {
          201: BootstrapResponseSchema,
          400: ErrorResponseSchema,
          403: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      // 1. Refuse in production
      if (config.NODE_ENV === 'production') {
        throw new ForbiddenError('Bootstrap endpoint is strictly disabled in production.');
      }

      // 2. Check if already bootstrapped
      const userCount = await userRepo.count();
      if (userCount > 0) {
        throw new ForbiddenError('System is already initialized. Bootstrap is single-use only.');
      }

      const { email, password, displayName, workspaceName } = request.body;

      // 3. Create workspace & user
      const workspace = await workspaceRepo.create(workspaceName);
      const passwordHash = await hashPassword(password);
      const user = await userRepo.create(email, passwordHash, displayName);
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const scope: AuthenticatedScope = {
        workspaceId: workspace.id,
        userId: user.id,
        role: 'owner' as const,
        sessionTokenHash: tokenHash
      };

      const { membership, rawSessionToken, csrfToken } = await db.withScopedTransaction<{
        membership: any;
        rawSessionToken: string;
        csrfToken: string;
      }>(
        scope,
        async (txClient) => {
          const mRepo = new MembershipRepository(txClient);
          const sRepo = new SessionRepository(txClient);
          const aRepo = new AuditEventRepository(txClient);

          const m = await mRepo.create(workspace.id, user.id, 'owner');
          await sRepo.create(user.id, workspace.id, token);
          const csrf = generateCsrfToken();

          await aRepo.create(
            workspace.id,
            'system.bootstrap',
            'workspace',
            { workspaceName, ownerEmail: email },
            user.id,
            workspace.id
          );

          return { membership: m, rawSessionToken: token, csrfToken: csrf };
        }
      );

      // 6. Set secure cookies
      reply.setCookie(SESSION_COOKIE_NAME, rawSessionToken, {
        path: '/',
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: 'lax',
        domain: config.COOKIE_DOMAIN
      });

      reply.setCookie(CSRF_COOKIE_NAME, csrfToken, {
        path: '/',
        httpOnly: false, // Accessible to client to read & send in x-csrf-token header
        secure: config.COOKIE_SECURE,
        sameSite: 'lax',
        domain: config.COOKIE_DOMAIN
      });

      reply.status(201);
      return {
        userId: user.id,
        workspaceId: workspace.id,
        email: user.email,
        displayName: user.display_name,
        workspaceName: workspace.name,
        role: membership.role,
        csrfToken
      };
    }
  );
}
