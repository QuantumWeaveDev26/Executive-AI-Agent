import { FastifyInstance } from 'fastify';
import {
  CurrentUserResponse,
  CurrentUserResponseSchema,
  ErrorResponseSchema,
  LoginRequest,
  LoginRequestSchema,
  LoginResponse,
  LoginResponseSchema
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
import { UnauthorizedError } from '@thaara/observability';
import { verifyPassword } from '../crypto/password.js';
import { generateCsrfToken } from '../crypto/csrf.js';
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from '../plugins/auth.js';
import { Config } from '@thaara/config';

export async function authRoutes(
  fastify: FastifyInstance,
  options: { db: TransactionalDbClient; config: Config }
): Promise<void> {
  const { db, config } = options;
  const userRepo = new UserRepository(db);
  const workspaceRepo = new WorkspaceRepository(db);
  const membershipRepo = new MembershipRepository(db);

  // POST /auth/login
  fastify.post<{ Body: LoginRequest; Reply: LoginResponse }>(
    '/auth/login',
    {
      schema: {
        description: 'Authenticate user with email and password',
        tags: ['Auth'],
        body: LoginRequestSchema,
        response: {
          200: LoginResponseSchema,
          401: ErrorResponseSchema
        }
      }
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const user = await userRepo.findByEmail(email);
      if (!user) {
        throw new UnauthorizedError('Invalid email or password.');
      }

      const isValidPassword = await verifyPassword(password, user.password_hash);
      if (!isValidPassword) {
        throw new UnauthorizedError('Invalid email or password.');
      }

      // Find user's active workspace membership via auth boundary function
      const memberships = await membershipRepo.listUserMembershipsForAuth(user.id, user.email);
      if (memberships.length === 0) {
        throw new UnauthorizedError('User has no active workspace memberships.');
      }

      const membership = memberships[0]!;
      const token = generateSessionToken();
      const tokenHash = hashSessionToken(token);
      const scope: AuthenticatedScope = {
        workspaceId: membership.workspace_id,
        userId: user.id,
        role: membership.role,
        sessionTokenHash: tokenHash
      };

      const { rawSessionToken, csrfToken } = await db.withScopedTransaction<{
        rawSessionToken: string;
        csrfToken: string;
      }>(
        scope,
        async (txClient) => {
          const sRepo = new SessionRepository(txClient);
          const aRepo = new AuditEventRepository(txClient);

          await sRepo.create(user.id, membership.workspace_id, token);
          const csrf = generateCsrfToken();

          await aRepo.create(
            membership.workspace_id,
            'auth.login',
            'user',
            { email: user.email },
            user.id,
            user.id
          );

          return { rawSessionToken: token, csrfToken: csrf };
        }
      );

      reply.setCookie(SESSION_COOKIE_NAME, rawSessionToken, {
        path: '/',
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: 'lax',
        domain: config.COOKIE_DOMAIN
      });

      reply.setCookie(CSRF_COOKIE_NAME, csrfToken, {
        path: '/',
        httpOnly: false,
        secure: config.COOKIE_SECURE,
        sameSite: 'lax',
        domain: config.COOKIE_DOMAIN
      });

      return {
        userId: user.id,
        workspaceId: membership.workspace_id,
        email: user.email,
        displayName: user.display_name,
        role: membership.role,
        csrfToken
      };
    }
  );

  // POST /auth/logout
  fastify.post(
    '/auth/logout',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Revoke active session and clear cookies',
        tags: ['Auth']
      }
    },
    async (request, reply) => {
      const rawSessionToken = request.cookies[SESSION_COOKIE_NAME];
      if (rawSessionToken && request.scope) {
        await db.withScopedTransaction(request.scope, async (txClient) => {
          const sRepo = new SessionRepository(txClient);
          await sRepo.revokeByRawToken(rawSessionToken);
        });
      }

      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      reply.clearCookie(CSRF_COOKIE_NAME, { path: '/' });

      return { success: true };
    }
  );

  // GET /auth/me
  fastify.get<{ Reply: CurrentUserResponse }>(
    '/auth/me',
    {
      preHandler: [fastify.requireAuth],
      schema: {
        description: 'Get current authenticated user, workspace, and role',
        tags: ['Auth'],
        response: {
          200: CurrentUserResponseSchema,
          401: ErrorResponseSchema
        }
      }
    },
    async (request) => {
      const scope = request.scope!;
      const user = await userRepo.findById(scope.userId);
      const workspace = await workspaceRepo.findById(scope.workspaceId);
      const membership = await db.withScopedTransaction(scope, async (txClient) => {
        const mRepo = new MembershipRepository(txClient);
        return await mRepo.findByUserAndWorkspace(scope.workspaceId, scope.userId);
      });

      if (!user || !workspace || !membership) {
        throw new UnauthorizedError('Session context could not be resolved.');
      }

      const csrfToken = request.cookies[CSRF_COOKIE_NAME] || '';

      return {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          createdAt: user.created_at
        },
        workspace: {
          id: workspace.id,
          name: workspace.name,
          createdAt: workspace.created_at
        },
        membership: {
          role: membership.role,
          joinedAt: membership.created_at
        },
        csrfToken
      };
    }
  );
}
