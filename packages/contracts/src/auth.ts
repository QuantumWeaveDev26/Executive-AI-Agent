import { Type, Static } from '@sinclair/typebox';
import { RoleSchema } from './scope.js';

export const BootstrapRequestSchema = Type.Object({
  email: Type.String({ format: 'email' }),
  password: Type.String({ minLength: 12 }),
  displayName: Type.String({ minLength: 2 }),
  workspaceName: Type.String({ minLength: 2 })
});
export type BootstrapRequest = Static<typeof BootstrapRequestSchema>;

export const BootstrapResponseSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  email: Type.String({ format: 'email' }),
  displayName: Type.String(),
  workspaceName: Type.String(),
  role: RoleSchema,
  csrfToken: Type.String()
});
export type BootstrapResponse = Static<typeof BootstrapResponseSchema>;

export const LoginRequestSchema = Type.Object({
  email: Type.String({ format: 'email' }),
  password: Type.String({ minLength: 1 })
});
export type LoginRequest = Static<typeof LoginRequestSchema>;

export const LoginResponseSchema = Type.Object({
  userId: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  email: Type.String({ format: 'email' }),
  displayName: Type.String(),
  role: RoleSchema,
  csrfToken: Type.String()
});
export type LoginResponse = Static<typeof LoginResponseSchema>;

export const CurrentUserResponseSchema = Type.Object({
  user: Type.Object({
    id: Type.String({ format: 'uuid' }),
    email: Type.String({ format: 'email' }),
    displayName: Type.String(),
    createdAt: Type.String()
  }),
  workspace: Type.Object({
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    createdAt: Type.String()
  }),
  membership: Type.Object({
    role: RoleSchema,
    joinedAt: Type.String()
  }),
  csrfToken: Type.String()
});
export type CurrentUserResponse = Static<typeof CurrentUserResponseSchema>;
