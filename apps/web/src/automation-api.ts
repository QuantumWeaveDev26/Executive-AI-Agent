import { ApiRequestError, PlanStatus, StagedEmailWorkflowArtifactItem, getPlanWorkflowArtifact, request } from './api';

export type AutomationStatus = PlanStatus | 'unverified';
export interface AutomationSummary {
  id: string;
  title: string;
  status: PlanStatus;
  display_status: AutomationStatus;
  created_at: string;
  updated_at: string;
}
export interface AutomationListResponse {
  items: AutomationSummary[];
  nextOffset: number | null;
}
export interface AutomationDetail extends AutomationSummary {
  steps: Array<{
    id: string; step_index: number; action_name: string; status: string;
    approval_mode: string; depends_on_step_ids: string[];
  }>;
  approvals: Array<{
    id: string; step_id: string; status: string; risk_level: string;
    requester_user_id: string; approver_user_id: string | null;
    created_at: string; updated_at: string; expires_at: string; bound_at: string;
  }>;
  receipts: Array<{
    id: string; plan_step_id: string; action_name: string; status: string;
    verification_method: string; issued_at: string; verified_at: string | null;
  }>;
}
export const AUTOMATION_PAGE_SIZE = 20;
export function listAutomations(status: AutomationStatus | '', offset: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: String(AUTOMATION_PAGE_SIZE), offset: String(offset) });
  if (status) query.set('status', status);
  return request<AutomationListResponse>(`/api/v1/automations?${query}`, { method: 'GET', cache: 'no-store', signal });
}
export function loadAutomationDetail(planId: string, signal?: AbortSignal) {
  return request<AutomationDetail>(`/api/v1/automations/${encodeURIComponent(planId)}`, { method: 'GET', cache: 'no-store', signal });
}
export function canInspectWorkflow(detail: AutomationDetail): boolean {
  return detail.status === 'completed' && detail.display_status === 'completed' && detail.steps.some(
    (s) => s.action_name === 'automation.email.stage_workflow_artifact' && s.status === 'verified' &&
      detail.receipts.some((r) => r.plan_step_id === s.id && r.status === 'verified')
  );
}
export function loadDashboardArtifact(planId: string, signal?: AbortSignal): Promise<StagedEmailWorkflowArtifactItem> {
  return getPlanWorkflowArtifact(planId, signal);
}
export function dashboardError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Your session has expired. Sign in again.';
    if (error.status === 403) return 'Access denied. Active workspace membership is required.';
    if (error.status === 404) return 'This automation or verified workflow is unavailable in your workspace.';
  }
  return 'Could not load automation data. Try refreshing.';
}

export interface AutomationActivityEvent {
  id:string; timestamp:string; event_type:string; status:string;
  source:'audit'|'plan_record'|'step_record'|'approval_record'|'execution_record'|'receipt';
  step_id:string|null; approval_id:string|null; receipt_id:string|null;
  step_index:number|null; attempt_number:number|null; details:string;
}
export interface AutomationActivityResponse {
  items:AutomationActivityEvent[];
  nextOffset:number|null;
  historyNotice:string;
}
export function loadAutomationActivity(planId:string,offset=0,signal?:AbortSignal) {
  const query=new URLSearchParams({limit:'20',offset:String(offset)});
  return request<AutomationActivityResponse>(`/api/v1/automations/${encodeURIComponent(planId)}/activity?${query}`,
    {method:'GET',cache:'no-store',signal});
}
