import { Type, Static } from '@sinclair/typebox';
import { RoleSchema } from './scope.js';

export const ActionClassSchema = Type.Union([
  Type.Literal('read'),
  Type.Literal('write')
]);
export type ActionClass = Static<typeof ActionClassSchema>;

export const RiskLevelSchema = Type.Union([
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('critical')
]);
export type RiskLevel = Static<typeof RiskLevelSchema>;

export const ApprovalModeSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('explicit'),
  Type.Literal('two_person')
]);
export type ApprovalMode = Static<typeof ApprovalModeSchema>;

export const RetryPolicySchema = Type.Object({
  maxRetries: Type.Integer({ minimum: 0, maximum: 10 }),
  backoffMs: Type.Integer({ minimum: 100 }),
  exponential: Type.Boolean()
});
export type RetryPolicy = Static<typeof RetryPolicySchema>;

export const CapabilityScopeSchema = Type.Union([
  Type.Literal('core_system'),
  Type.Literal('external_connector')
]);
export type CapabilityScope = Static<typeof CapabilityScopeSchema>;

export const ActionMetadataSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  actionClass: ActionClassSchema,
  risk: RiskLevelSchema,
  approvalMode: ApprovalModeSchema,
  idempotencyRequired: Type.Boolean(),
  timeoutMs: Type.Integer({ minimum: 1000, maximum: 300000 }),
  retryPolicy: RetryPolicySchema,
  requiredRole: RoleSchema,
  auditRequired: Type.Boolean(),
  capabilityScope: CapabilityScopeSchema,
  schemaIdentifier: Type.String({ minLength: 1 })
});
export type ActionMetadata = Static<typeof ActionMetadataSchema>;

export const ActionDefinitionSchema = ActionMetadataSchema;
export type ActionDefinition = ActionMetadata;

export const PolicyEvaluationRequestSchema = Type.Object({
  actionName: Type.String({ minLength: 1 }),
  parameters: Type.Record(Type.String(), Type.Unknown()),
  approvalId: Type.Optional(Type.String({ format: 'uuid' })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 8 }))
});
export type PolicyEvaluationRequest = Static<typeof PolicyEvaluationRequestSchema>;

export const PolicyEvaluationStatusSchema = Type.Union([
  Type.Literal('ALLOWED'),
  Type.Literal('REJECTED_UNAUTHORIZED'),
  Type.Literal('REJECTED_APPROVAL_REQUIRED'),
  Type.Literal('REJECTED_IDEMPOTENCY_REQUIRED'),
  Type.Literal('REJECTED_CONNECTOR_NOT_READY'),
  Type.Literal('REJECTED_INVALID_ACTION'),
  Type.Literal('REJECTED_INVALID_PARAMETERS')
]);
export type PolicyEvaluationStatus = Static<typeof PolicyEvaluationStatusSchema>;

export const PolicyEvaluationResultSchema = Type.Object({
  status: PolicyEvaluationStatusSchema,
  allowed: Type.Boolean(),
  reason: Type.String(),
  requiredApprovalMode: ApprovalModeSchema,
  risk: RiskLevelSchema,
  auditRequired: Type.Boolean()
});
export type PolicyEvaluationResult = Static<typeof PolicyEvaluationResultSchema>;
