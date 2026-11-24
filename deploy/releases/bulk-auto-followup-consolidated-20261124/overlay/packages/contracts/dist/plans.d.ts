import { Static } from '@sinclair/typebox';
export declare const PlanSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    workspace_id: import("@sinclair/typebox").TString;
    created_by_user_id: import("@sinclair/typebox").TString;
    title: import("@sinclair/typebox").TString;
    description: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
    version: import("@sinclair/typebox").TInteger;
    metadata: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>;
    created_at: import("@sinclair/typebox").TString;
    updated_at: import("@sinclair/typebox").TString;
}>;
export type Plan = Static<typeof PlanSchema>;
export declare const PlanStepSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    plan_id: import("@sinclair/typebox").TString;
    workspace_id: import("@sinclair/typebox").TString;
    step_index: import("@sinclair/typebox").TInteger;
    action_name: import("@sinclair/typebox").TString;
    action_class: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"read">, import("@sinclair/typebox").TLiteral<"write">]>;
    risk_level: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"low">, import("@sinclair/typebox").TLiteral<"medium">, import("@sinclair/typebox").TLiteral<"high">, import("@sinclair/typebox").TLiteral<"critical">]>;
    approval_mode: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"none">, import("@sinclair/typebox").TLiteral<"explicit">, import("@sinclair/typebox").TLiteral<"two_person">]>;
    parameters: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>;
    parameter_hash: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"blocked">, import("@sinclair/typebox").TLiteral<"ready">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"verified">, import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"not_configured">, import("@sinclair/typebox").TLiteral<"skipped">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
    version: import("@sinclair/typebox").TInteger;
    depends_on_step_ids: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    approval_request_id: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    error: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>, import("@sinclair/typebox").TNull]>;
    created_at: import("@sinclair/typebox").TString;
    updated_at: import("@sinclair/typebox").TString;
}>;
export type PlanStep = Static<typeof PlanStepSchema>;
export declare const ReceiptSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    workspace_id: import("@sinclair/typebox").TString;
    plan_id: import("@sinclair/typebox").TString;
    plan_step_id: import("@sinclair/typebox").TString;
    action_name: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"verified">, import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"not_configured">]>;
    proof: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>;
    verification_method: import("@sinclair/typebox").TString;
    issued_at: import("@sinclair/typebox").TString;
    verified_at: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
}>;
export type Receipt = Static<typeof ReceiptSchema>;
export declare const PlanStepApprovalBindingSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    workspace_id: import("@sinclair/typebox").TString;
    plan_id: import("@sinclair/typebox").TString;
    step_id: import("@sinclair/typebox").TString;
    approval_request_id: import("@sinclair/typebox").TString;
    parameter_hash: import("@sinclair/typebox").TString;
    bound_at: import("@sinclair/typebox").TString;
}>;
export type PlanStepApprovalBinding = Static<typeof PlanStepApprovalBindingSchema>;
export declare const StepExecutionSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    workspace_id: import("@sinclair/typebox").TString;
    plan_id: import("@sinclair/typebox").TString;
    step_id: import("@sinclair/typebox").TString;
    idempotency_key: import("@sinclair/typebox").TString;
    worker_id: import("@sinclair/typebox").TString;
    lease_token: import("@sinclair/typebox").TString;
    attempt_number: import("@sinclair/typebox").TInteger;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"started">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">]>;
    started_at: import("@sinclair/typebox").TString;
    lease_expires_at: import("@sinclair/typebox").TString;
    completed_at: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
}>;
export type StepExecution = Static<typeof StepExecutionSchema>;
export declare const CreatePlanBodySchema: import("@sinclair/typebox").TObject<{
    title: import("@sinclair/typebox").TString;
    description: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    metadata: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>>;
}>;
export type CreatePlanBody = Static<typeof CreatePlanBodySchema>;
export declare const CreatePlanStepBodySchema: import("@sinclair/typebox").TObject<{
    action_name: import("@sinclair/typebox").TString;
    parameters: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>;
    depends_on_step_ids: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>>;
    action_class: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"read">, import("@sinclair/typebox").TLiteral<"write">]>>;
    risk_level: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"low">, import("@sinclair/typebox").TLiteral<"medium">, import("@sinclair/typebox").TLiteral<"high">, import("@sinclair/typebox").TLiteral<"critical">]>>;
    approval_mode: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"none">, import("@sinclair/typebox").TLiteral<"explicit">, import("@sinclair/typebox").TLiteral<"two_person">]>>;
}>;
export type CreatePlanStepBody = Static<typeof CreatePlanStepBodySchema>;
export declare const PlanWithStepsResponseSchema: import("@sinclair/typebox").TObject<{
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
    id: import("@sinclair/typebox").TString;
    version: import("@sinclair/typebox").TInteger;
    title: import("@sinclair/typebox").TString;
    metadata: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>;
    workspace_id: import("@sinclair/typebox").TString;
    created_at: import("@sinclair/typebox").TString;
    updated_at: import("@sinclair/typebox").TString;
    created_by_user_id: import("@sinclair/typebox").TString;
    description: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    steps: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TString;
        plan_id: import("@sinclair/typebox").TString;
        workspace_id: import("@sinclair/typebox").TString;
        step_index: import("@sinclair/typebox").TInteger;
        action_name: import("@sinclair/typebox").TString;
        action_class: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"read">, import("@sinclair/typebox").TLiteral<"write">]>;
        risk_level: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"low">, import("@sinclair/typebox").TLiteral<"medium">, import("@sinclair/typebox").TLiteral<"high">, import("@sinclair/typebox").TLiteral<"critical">]>;
        approval_mode: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"none">, import("@sinclair/typebox").TLiteral<"explicit">, import("@sinclair/typebox").TLiteral<"two_person">]>;
        parameters: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>;
        parameter_hash: import("@sinclair/typebox").TString;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"blocked">, import("@sinclair/typebox").TLiteral<"ready">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"verified">, import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"not_configured">, import("@sinclair/typebox").TLiteral<"skipped">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
        version: import("@sinclair/typebox").TInteger;
        depends_on_step_ids: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
        approval_request_id: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        error: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>, import("@sinclair/typebox").TNull]>;
        created_at: import("@sinclair/typebox").TString;
        updated_at: import("@sinclair/typebox").TString;
    }>>;
    receipts: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TString;
        workspace_id: import("@sinclair/typebox").TString;
        plan_id: import("@sinclair/typebox").TString;
        plan_step_id: import("@sinclair/typebox").TString;
        action_name: import("@sinclair/typebox").TString;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"verified">, import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"not_configured">]>;
        proof: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>;
        verification_method: import("@sinclair/typebox").TString;
        issued_at: import("@sinclair/typebox").TString;
        verified_at: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    }>>;
}>;
export type PlanWithStepsResponse = Static<typeof PlanWithStepsResponseSchema>;
export declare const SubmitPlanResponseSchema: import("@sinclair/typebox").TObject<{
    plan: import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TString;
        workspace_id: import("@sinclair/typebox").TString;
        created_by_user_id: import("@sinclair/typebox").TString;
        title: import("@sinclair/typebox").TString;
        description: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
        version: import("@sinclair/typebox").TInteger;
        metadata: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>;
        created_at: import("@sinclair/typebox").TString;
        updated_at: import("@sinclair/typebox").TString;
    }>;
    approval_requests_created: import("@sinclair/typebox").TInteger;
    steps_queued: import("@sinclair/typebox").TInteger;
    steps_blocked: import("@sinclair/typebox").TInteger;
}>;
export type SubmitPlanResponse = Static<typeof SubmitPlanResponseSchema>;
export declare const CancelPlanResponseSchema: import("@sinclair/typebox").TObject<{
    plan: import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TString;
        workspace_id: import("@sinclair/typebox").TString;
        created_by_user_id: import("@sinclair/typebox").TString;
        title: import("@sinclair/typebox").TString;
        description: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
        version: import("@sinclair/typebox").TInteger;
        metadata: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TUnknown>;
        created_at: import("@sinclair/typebox").TString;
        updated_at: import("@sinclair/typebox").TString;
    }>;
    steps_cancelled: import("@sinclair/typebox").TInteger;
}>;
export type CancelPlanResponse = Static<typeof CancelPlanResponseSchema>;
/**
 * Deterministically canonicalizes any JSON-compatible value by recursively sorting object keys.
 */
export declare function canonicalizeJson(value: unknown): string;
/**
 * Computes a deterministic SHA-256 hash of canonicalized JSON parameters.
 */
export declare function computeCanonicalParameterHash(parameters: unknown): string;
//# sourceMappingURL=plans.d.ts.map