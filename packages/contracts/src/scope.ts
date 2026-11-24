import { Type, Static } from '@sinclair/typebox';

export const RoleSchema = Type.Union([
  Type.Literal('owner'),
  Type.Literal('admin'),
  Type.Literal('member'),
  Type.Literal('viewer')
]);
export type Role = Static<typeof RoleSchema>;

export const RequestScopeSchema = Type.Object({
  workspaceId: Type.String({ format: 'uuid' }),
  userId: Type.String({ format: 'uuid' }),
  role: RoleSchema,
  correlationId: Type.Optional(Type.String())
});
export type RequestScope = Static<typeof RequestScopeSchema>;
