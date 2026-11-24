# Step 89 — Calendar Briefing & Offline n8n Automation

Date: 19 October 2026 (Asia/Calcutta)
Status: COMPLETE — mock/synthetic Calendar data and offline `active: false` n8n blueprints only; live execution remains `not_configured`
Workspace: `C:\ThaaraProjects\thaara-ai-agent-v2`
Branch: `dev-thaara-continuation`
Base Checkpoint (`HEAD`): `b9519f3` (preserving all uncommitted Step 88 files)

## Implemented

1. **Daily Calendar Briefing Contracts & PolicyGateway Action ([`packages/contracts/src/google-calendar.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/packages/contracts/src/google-calendar.ts), [`packages/policy/src/registry.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/packages/policy/src/registry.ts))**:
   - Added `GoogleCalendarBriefingQuerySchema`, `GoogleCalendarBriefingAppointmentSchema`, and `GoogleCalendarBriefingResponseSchema` with `untrusted: true` and `mode: 'mock'`.
   - Registered `calendar.briefing.prepare` (`requiredRole: 'member'`, `actionClass: 'read'`, `risk: 'low'`, `approvalMode: 'none'`, `auditRequired: true`) in `ActionRegistry`.
2. **Daily Briefing Generation & Validated Offline n8n Blueprint Builder ([`apps/api/src/services/google-calendar.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/services/google-calendar.ts), [`apps/api/src/routes/google-calendar.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/routes/google-calendar.ts))**:
   - Added `GoogleCalendarFoundation.prepareBriefing` and `POST /api/v1/connectors/google-calendar/briefing`.
   - Computes timezone-aware local meeting times (`formatLocalTimeRangeInTimeZone`), overlapping conflicts (`conflictCount`, `conflictEventIds`, `hasConflict`), chronologically sorted upcoming appointments, and executive headline.
   - Treats event descriptions as untrusted data (`sanitizeUntrustedDescriptionSnippet` strips HTML/control chars and truncates to 280 chars; `detectWorkflowSecurityViolations` blocks unsafe `workflowName` inputs).
   - `buildCalendarBriefingN8nBlueprint` generates a deterministic, schema- and graph-validated `N8nWorkflowBlueprint` (`active: false`, `externallyVerifiedWithLiveN8n: false`, `scheduleTrigger` -> `if` conflict check -> `set` draft payload).
3. **Thaara Chat Offline Calendar Briefing Workflow Support ([`apps/api/src/services/chat-automation-orchestrator.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/services/chat-automation-orchestrator.ts), [`apps/api/src/routes/conversations.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/routes/conversations.ts), [`apps/api/src/app.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/app.ts))**:
   - Added `detectCalendarBriefingChatRequest` and `executeChatCalendarBriefingPlan`, wired directly into `POST /api/v1/conversations/:id/stream`.
   - Enforces `calendar.briefing.prepare` PolicyGateway validation, enriches the dry-run payload from `GoogleCalendarFoundation.prepareBriefing` when the user's mock Calendar is connected, validates the offline `active: false` n8n blueprint, and executes the governed plan, approval-binding, idempotency, and verified offline artifact pipeline.
4. **Step 90 Read-Only GET, Idempotent Approval Retry & Orphaned Step Recovery ([`apps/api/src/routes/conversations.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/routes/conversations.ts), [`apps/api/src/routes/plans.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/routes/plans.ts), [`apps/api/src/routes/approvals.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/routes/approvals.ts), [`apps/worker/src/sweeper.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/worker/src/sweeper.ts), [`apps/worker/src/worker.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/worker/src/worker.ts))**:
   - Removed `reconcileGovernedPlanExecution` from `GET /api/v1/conversations/:id/messages`, `GET /api/v1/plans/:id`, and `GET /api/v1/plans/:id/workflow-artifact` so all `GET` endpoints are strictly application-level read-only.
   - Moved post-approval worker/queue scheduling (`queueService.enqueue` / `scheduleBackgroundPlanExecution`) to `POST /api/v1/approvals/:id/decide` after the approval transaction commits; made retrying an already-approved decision safely idempotent with fresh authorization and no duplicate execution while rejecting conflicting decisions (`403`).
   - Added `ApprovalSweeper.sweepOrphanedPlanSteps` in `apps/worker/src/sweeper.ts` (wired in `apps/worker/src/worker.ts`) to recover eligible orphaned `'queued'` steps after post-commit enqueue failures or worker restarts using deterministic job IDs (`step.id`), execution leases, and PolicyGateway checks.

## Verification

- **Focused Suites**: Passed across [`conversations-and-stream.test.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/test/conversations-and-stream.test.ts), [`auth-and-csrf.test.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/test/auth-and-csrf.test.ts), [`plan-worker.test.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/worker/test/plan-worker.test.ts), [`plans-api.test.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/test/plans-api.test.ts), and [`google-calendar-briefing.test.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/test/google-calendar-briefing.test.ts).
- **Full Verification (`pnpm.cmd verify`)**: `56/56` test files passed (`660/660` tests, `0` failed), plus full workspace build, lint, and typecheck.

## Limitations & Recommended Step 90

- Live Google Calendar access and live n8n execution remain `not_configured`; all generated n8n blueprints enforce `active: false`.
- **Recommended Step 90**: Fast Git Checkpoint Review for completed Steps 88–90.
