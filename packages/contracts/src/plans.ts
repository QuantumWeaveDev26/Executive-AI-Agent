import { Type, Static } from '@sinclair/typebox';
import crypto from 'node:crypto';
import { PlanStateSchema, PlanStepStateSchema, ReceiptStateSchema } from './states.js';
import { RiskLevelSchema, ActionClassSchema, ApprovalModeSchema } from './policy.js';

export const PlanSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  created_by_user_id: Type.String({ format: 'uuid' }),
  title: Type.String({ minLength: 1, maxLength: 256 }),
  description: Type.Union([Type.String(), Type.Null()]),
  status: PlanStateSchema,
  version: Type.Integer({ minimum: 1 }),
  metadata: Type.Record(Type.String(), Type.Unknown()),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' })
});
export type Plan = Static<typeof PlanSchema>;

export const PlanStepSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  plan_id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  step_index: Type.Integer({ minimum: 0 }),
  action_name: Type.String({ minLength: 1 }),
  action_class: ActionClassSchema,
  risk_level: RiskLevelSchema,
  approval_mode: ApprovalModeSchema,
  parameters: Type.Record(Type.String(), Type.Unknown()),
  parameter_hash: Type.String({ minLength: 64, maxLength: 64 }),
  status: PlanStepStateSchema,
  version: Type.Integer({ minimum: 1 }),
  depends_on_step_ids: Type.Array(Type.String({ format: 'uuid' })),
  approval_request_id: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  error: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' })
});
export type PlanStep = Static<typeof PlanStepSchema>;

export const ReceiptSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  plan_id: Type.String({ format: 'uuid' }),
  plan_step_id: Type.String({ format: 'uuid' }),
  action_name: Type.String({ minLength: 1 }),
  status: ReceiptStateSchema,
  proof: Type.Record(Type.String(), Type.Unknown()),
  verification_method: Type.String({ minLength: 1 }),
  issued_at: Type.String({ format: 'date-time' }),
  verified_at: Type.Union([Type.String({ format: 'date-time' }), Type.Null()])
});
export type Receipt = Static<typeof ReceiptSchema>;

export const PlanStepApprovalBindingSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  plan_id: Type.String({ format: 'uuid' }),
  step_id: Type.String({ format: 'uuid' }),
  approval_request_id: Type.String({ format: 'uuid' }),
  parameter_hash: Type.String({ minLength: 64, maxLength: 64 }),
  bound_at: Type.String({ format: 'date-time' })
});
export type PlanStepApprovalBinding = Static<typeof PlanStepApprovalBindingSchema>;

export const StepExecutionSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  workspace_id: Type.String({ format: 'uuid' }),
  plan_id: Type.String({ format: 'uuid' }),
  step_id: Type.String({ format: 'uuid' }),
  idempotency_key: Type.String({ minLength: 1 }),
  worker_id: Type.String({ minLength: 1 }),
  lease_token: Type.String({ format: 'uuid' }),
  attempt_number: Type.Integer({ minimum: 1 }),
  status: Type.Union([Type.Literal('started'), Type.Literal('completed'), Type.Literal('failed')]),
  started_at: Type.String({ format: 'date-time' }),
  lease_expires_at: Type.String({ format: 'date-time' }),
  completed_at: Type.Union([Type.String({ format: 'date-time' }), Type.Null()])
});
export type StepExecution = Static<typeof StepExecutionSchema>;

export const CreatePlanBodySchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 256 }),
  description: Type.Optional(Type.String({ maxLength: 2048 })),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown()))
});
export type CreatePlanBody = Static<typeof CreatePlanBodySchema>;

export const CreatePlanStepBodySchema = Type.Object({
  action_name: Type.String({ minLength: 1 }),
  parameters: Type.Record(Type.String(), Type.Unknown()),
  depends_on_step_ids: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
  action_class: Type.Optional(ActionClassSchema),
  risk_level: Type.Optional(RiskLevelSchema),
  approval_mode: Type.Optional(ApprovalModeSchema)
});
export type CreatePlanStepBody = Static<typeof CreatePlanStepBodySchema>;

export const PlanWithStepsResponseSchema = Type.Composite([
  PlanSchema,
  Type.Object({
    steps: Type.Array(PlanStepSchema),
    receipts: Type.Array(ReceiptSchema)
  })
]);
export type PlanWithStepsResponse = Static<typeof PlanWithStepsResponseSchema>;

export const SubmitPlanResponseSchema = Type.Object({
  plan: PlanSchema,
  approval_requests_created: Type.Integer({ minimum: 0 }),
  steps_queued: Type.Integer({ minimum: 0 }),
  steps_blocked: Type.Integer({ minimum: 0 })
});
export type SubmitPlanResponse = Static<typeof SubmitPlanResponseSchema>;

export const CancelPlanResponseSchema = Type.Object({
  plan: PlanSchema,
  steps_cancelled: Type.Integer({ minimum: 0 })
});
export type CancelPlanResponse = Static<typeof CancelPlanResponseSchema>;

/**
 * Deterministically canonicalizes any JSON-compatible value by recursively sorting object keys.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalizeJson(item)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(
    (key) => `${JSON.stringify(key)}:${canonicalizeJson(obj[key])}`
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * Computes a deterministic SHA-256 hash of canonicalized JSON parameters.
 */
export function computeCanonicalParameterHash(parameters: unknown): string {
  const canonical = canonicalizeJson(parameters);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
