import { Static } from '@sinclair/typebox';
export declare const AutomationStatusSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>, import("@sinclair/typebox").TLiteral<"unverified">]>;
export type AutomationStatus = Static<typeof AutomationStatusSchema>;
export declare const AutomationListQuerySchema: import("@sinclair/typebox").TObject<{
    status: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>, import("@sinclair/typebox").TLiteral<"unverified">]>>;
    limit: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
    offset: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TInteger>;
}>;
export type AutomationListQuery = Static<typeof AutomationListQuerySchema>;
export declare const AutomationSummarySchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    title: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
    display_status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>, import("@sinclair/typebox").TLiteral<"unverified">]>;
    created_at: import("@sinclair/typebox").TString;
    updated_at: import("@sinclair/typebox").TString;
}>;
export type AutomationSummary = Static<typeof AutomationSummarySchema>;
export declare const AutomationListResponseSchema: import("@sinclair/typebox").TObject<{
    items: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TString;
        title: import("@sinclair/typebox").TString;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
        display_status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>, import("@sinclair/typebox").TLiteral<"unverified">]>;
        created_at: import("@sinclair/typebox").TString;
        updated_at: import("@sinclair/typebox").TString;
    }>>;
    nextOffset: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TInteger, import("@sinclair/typebox").TNull]>;
}>;
export type AutomationListResponse = Static<typeof AutomationListResponseSchema>;
export declare const AutomationStepSchema: import("@sinclair/typebox").TObject<{
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"blocked">, import("@sinclair/typebox").TLiteral<"ready">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"verified">, import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"not_configured">, import("@sinclair/typebox").TLiteral<"skipped">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
    id: import("@sinclair/typebox").TString;
    step_index: import("@sinclair/typebox").TInteger;
    action_name: import("@sinclair/typebox").TString;
    approval_mode: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"none">, import("@sinclair/typebox").TLiteral<"explicit">, import("@sinclair/typebox").TLiteral<"two_person">]>;
    depends_on_step_ids: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
}>;
export declare const AutomationApprovalSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    step_id: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"claimed">, import("@sinclair/typebox").TLiteral<"approved">, import("@sinclair/typebox").TLiteral<"rejected">, import("@sinclair/typebox").TLiteral<"expired">, import("@sinclair/typebox").TLiteral<"executed">, import("@sinclair/typebox").TLiteral<"execution_failed">]>;
    risk_level: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"low">, import("@sinclair/typebox").TLiteral<"medium">, import("@sinclair/typebox").TLiteral<"high">, import("@sinclair/typebox").TLiteral<"critical">]>;
    requester_user_id: import("@sinclair/typebox").TString;
    approver_user_id: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    created_at: import("@sinclair/typebox").TString;
    updated_at: import("@sinclair/typebox").TString;
    expires_at: import("@sinclair/typebox").TString;
    bound_at: import("@sinclair/typebox").TString;
}>;
export declare const AutomationReceiptSchema: import("@sinclair/typebox").TObject<{
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"verified">, import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"not_configured">]>;
    id: import("@sinclair/typebox").TString;
    action_name: import("@sinclair/typebox").TString;
    plan_step_id: import("@sinclair/typebox").TString;
    verification_method: import("@sinclair/typebox").TString;
    issued_at: import("@sinclair/typebox").TString;
    verified_at: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
}>;
export declare const AutomationDetailSchema: import("@sinclair/typebox").TObject<{
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
    id: import("@sinclair/typebox").TString;
    title: import("@sinclair/typebox").TString;
    display_status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"draft">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"paused">, import("@sinclair/typebox").TLiteral<"completed">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>, import("@sinclair/typebox").TLiteral<"unverified">]>;
    created_at: import("@sinclair/typebox").TString;
    updated_at: import("@sinclair/typebox").TString;
    steps: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"blocked">, import("@sinclair/typebox").TLiteral<"ready">, import("@sinclair/typebox").TLiteral<"awaiting_approval">, import("@sinclair/typebox").TLiteral<"queued">, import("@sinclair/typebox").TLiteral<"running">, import("@sinclair/typebox").TLiteral<"verified">, import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"not_configured">, import("@sinclair/typebox").TLiteral<"skipped">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
        id: import("@sinclair/typebox").TString;
        step_index: import("@sinclair/typebox").TInteger;
        action_name: import("@sinclair/typebox").TString;
        approval_mode: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"none">, import("@sinclair/typebox").TLiteral<"explicit">, import("@sinclair/typebox").TLiteral<"two_person">]>;
        depends_on_step_ids: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TString>;
    }>>;
    approvals: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TString;
        step_id: import("@sinclair/typebox").TString;
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"claimed">, import("@sinclair/typebox").TLiteral<"approved">, import("@sinclair/typebox").TLiteral<"rejected">, import("@sinclair/typebox").TLiteral<"expired">, import("@sinclair/typebox").TLiteral<"executed">, import("@sinclair/typebox").TLiteral<"execution_failed">]>;
        risk_level: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"low">, import("@sinclair/typebox").TLiteral<"medium">, import("@sinclair/typebox").TLiteral<"high">, import("@sinclair/typebox").TLiteral<"critical">]>;
        requester_user_id: import("@sinclair/typebox").TString;
        approver_user_id: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
        created_at: import("@sinclair/typebox").TString;
        updated_at: import("@sinclair/typebox").TString;
        expires_at: import("@sinclair/typebox").TString;
        bound_at: import("@sinclair/typebox").TString;
    }>>;
    receipts: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"verified">, import("@sinclair/typebox").TLiteral<"unverified">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"not_configured">]>;
        id: import("@sinclair/typebox").TString;
        action_name: import("@sinclair/typebox").TString;
        plan_step_id: import("@sinclair/typebox").TString;
        verification_method: import("@sinclair/typebox").TString;
        issued_at: import("@sinclair/typebox").TString;
        verified_at: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TString, import("@sinclair/typebox").TNull]>;
    }>>;
}>;
export type AutomationDetail = Static<typeof AutomationDetailSchema>;
//# sourceMappingURL=automation-management.d.ts.map