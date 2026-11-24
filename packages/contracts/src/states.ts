import { Type, Static } from '@sinclair/typebox';

export const PlanStateSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('awaiting_approval'),
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('paused'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled')
]);
export type PlanState = Static<typeof PlanStateSchema>;

export const PlanStepStateSchema = Type.Union([
  Type.Literal('blocked'),
  Type.Literal('ready'),
  Type.Literal('awaiting_approval'),
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('verified'),
  Type.Literal('unverified'),
  Type.Literal('failed'),
  Type.Literal('not_configured'),
  Type.Literal('skipped'),
  Type.Literal('cancelled')
]);
export type PlanStepState = Static<typeof PlanStepStateSchema>;

export const ApprovalStateSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('claimed'),
  Type.Literal('approved'),
  Type.Literal('rejected'),
  Type.Literal('expired'),
  Type.Literal('executed'),
  Type.Literal('execution_failed')
]);
export type ApprovalState = Static<typeof ApprovalStateSchema>;

export const ConnectorStateSchema = Type.Union([
  Type.Literal('not_configured'),
  Type.Literal('connected'),
  Type.Literal('degraded'),
  Type.Literal('revoked'),
  Type.Literal('error')
]);
export type ConnectorState = Static<typeof ConnectorStateSchema>;

export const ReceiptStateSchema = Type.Union([
  Type.Literal('verified'),
  Type.Literal('unverified'),
  Type.Literal('failed'),
  Type.Literal('not_configured')
]);
export type ReceiptState = Static<typeof ReceiptStateSchema>;

export const JobStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('processing'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('retrying')
]);
export type JobStatus = Static<typeof JobStatusSchema>;
