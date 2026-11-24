import { Type, Static } from '@sinclair/typebox';

export const AuditEventSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  actorUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  action: Type.String(),
  targetType: Type.String(),
  targetId: Type.Union([Type.String(), Type.Null()]),
  payload: Type.Record(Type.String(), Type.Unknown()),
  createdAt: Type.String()
});
export type AuditEvent = Static<typeof AuditEventSchema>;

export const CreateAuditEventSchema = Type.Object({
  actorUserId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  action: Type.String({ minLength: 1 }),
  targetType: Type.String({ minLength: 1 }),
  targetId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  payload: Type.Record(Type.String(), Type.Unknown())
});
export type CreateAuditEvent = Static<typeof CreateAuditEventSchema>;

export const AuditListResponseSchema = Type.Object({
  events: Type.Array(AuditEventSchema),
  total: Type.Integer()
});
export type AuditListResponse = Static<typeof AuditListResponseSchema>;
