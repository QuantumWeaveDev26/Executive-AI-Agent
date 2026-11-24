import { Static, Type } from '@sinclair/typebox';
import { PlanStateSchema, PlanStepStateSchema, ApprovalStateSchema } from './states.js';

export const AutomationActivityQuerySchema = Type.Object({
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000, default: 0 }))
}, { additionalProperties: false });
export type AutomationActivityQuery = Static<typeof AutomationActivityQuerySchema>;
export const AutomationActivityTypeSchema = Type.Union([
  ...['plan.created','plan.submitted','plan.completed','plan.cancelled','plan.failed',
    'step.created','step.queued','step.started','step.retry_scheduled','step.completed','step.failed','step.unverified',
    'step.not_configured','step.status_observed','approval.requested','approval.approved',
    'approval.rejected','approval.expired','approval.status_observed'].map(value => Type.Literal(value))
]);
export const AutomationActivityEventSchema = Type.Object({
  id: Type.String(),
  timestamp: Type.String({ format: 'date-time' }),
  event_type: AutomationActivityTypeSchema,
  status: Type.Union([PlanStateSchema, PlanStepStateSchema, ApprovalStateSchema,
    Type.Literal('created'), Type.Literal('submitted'), Type.Literal('started')]),
  source: Type.Union(['audit','plan_record','step_record','approval_record','execution_record','receipt'].map(value => Type.Literal(value))),
  step_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  approval_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  receipt_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  step_index: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  attempt_number: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  details: Type.String()
}, { additionalProperties: false });
export type AutomationActivityEvent = Static<typeof AutomationActivityEventSchema>;
export const AutomationActivityResponseSchema = Type.Object({
  items: Type.Array(AutomationActivityEventSchema),
  nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  historyNotice: Type.String()
}, { additionalProperties: false });
export type AutomationActivityResponse = Static<typeof AutomationActivityResponseSchema>;
