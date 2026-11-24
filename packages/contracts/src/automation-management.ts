import { Static, Type } from '@sinclair/typebox';
import { PlanStateSchema, ApprovalStateSchema } from './states.js';
import { PlanStepSchema, ReceiptSchema } from './plans.js';
import { RiskLevelSchema } from './policy.js';

export const AutomationStatusSchema = Type.Union([PlanStateSchema, Type.Literal('unverified')]);
export type AutomationStatus = Static<typeof AutomationStatusSchema>;
export const AutomationListQuerySchema = Type.Object({
  status: Type.Optional(AutomationStatusSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000, default: 0 }))
}, { additionalProperties: false });
export type AutomationListQuery = Static<typeof AutomationListQuerySchema>;

export const AutomationSummarySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  status: PlanStateSchema,
  display_status: AutomationStatusSchema,
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' })
}, { additionalProperties: false });
export type AutomationSummary = Static<typeof AutomationSummarySchema>;
export const AutomationListResponseSchema = Type.Object({
  items: Type.Array(AutomationSummarySchema),
  nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])
});
export type AutomationListResponse = Static<typeof AutomationListResponseSchema>;

export const AutomationStepSchema = Type.Pick(PlanStepSchema, [
  'id', 'step_index', 'action_name', 'status', 'approval_mode', 'depends_on_step_ids'
]);
export const AutomationApprovalSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  step_id: Type.String({ format: 'uuid' }),
  status: ApprovalStateSchema,
  risk_level: RiskLevelSchema,
  requester_user_id: Type.String({ format: 'uuid' }),
  approver_user_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
  expires_at: Type.String({ format: 'date-time' }),
  bound_at: Type.String({ format: 'date-time' })
}, { additionalProperties: false });
// Arbitrary proof, workflow JSON and action parameters are deliberately excluded.
// The existing verified-artifact endpoint remains the only dashboard JSON export path.
export const AutomationReceiptSchema = Type.Omit(ReceiptSchema, ['proof', 'workspace_id', 'plan_id']);
export const AutomationDetailSchema = Type.Composite([
  AutomationSummarySchema,
  Type.Object({
    steps: Type.Array(AutomationStepSchema),
    approvals: Type.Array(AutomationApprovalSchema),
    receipts: Type.Array(AutomationReceiptSchema)
  })
]);
export type AutomationDetail = Static<typeof AutomationDetailSchema>;
