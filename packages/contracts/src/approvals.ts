import { Type, Static } from '@sinclair/typebox';
import { ApprovalStateSchema } from './states.js';
import { RiskLevelSchema } from './policy.js';

export const ApprovalRequestSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspaceId: Type.String({ format: 'uuid' }),
  actionName: Type.String(),
  actionParams: Type.Record(Type.String(), Type.Unknown()),
  requesterUserId: Type.String({ format: 'uuid' }),
  approverUserId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  status: ApprovalStateSchema,
  riskLevel: RiskLevelSchema,
  expiresAt: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String()
});
export type ApprovalRequest = Static<typeof ApprovalRequestSchema>;

export const CreateApprovalRequestSchema = Type.Object({
  actionName: Type.String({ minLength: 1 }),
  actionParams: Type.Record(Type.String(), Type.Unknown()),
  riskLevel: RiskLevelSchema,
  ttlSeconds: Type.Optional(Type.Integer({ minimum: 60, maximum: 604800 }))
});
export type CreateApprovalRequest = Static<typeof CreateApprovalRequestSchema>;

export const UpdateApprovalStatusSchema = Type.Object({
  status: Type.Union([Type.Literal('approved'), Type.Literal('rejected')])
});
export type UpdateApprovalStatus = Static<typeof UpdateApprovalStatusSchema>;
