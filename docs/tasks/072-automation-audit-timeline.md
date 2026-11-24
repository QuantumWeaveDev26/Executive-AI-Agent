# Step 72 — Automation Audit Timeline

Date: 16 October 2026 (Asia/Calcutta)
Workspace: `C:\ThaaraProjects\thaara-ai-agent-v2`
Branch: `dev-thaara-continuation`; HEAD `62b0ab4`, unchanged.
Status: Complete; locally implemented and independently verified by Codex.

## Implemented

The selected automation now has a read-only **View Activity** option. It displays retained activity oldest first, with timestamps, event types, statuses, evidence sources, step/approval/receipt IDs and fixed safe explanatory details. It supports opening/closing, 20-row pages, refresh from page one, and loading, empty and error states. Requests are cancellable and stale responses are ignored. Existing dashboard, chat, workflow inspection and export behavior is preserved.

The existing workspace audit endpoint includes arbitrary payloads and is not plan-filtered. A minimal dedicated read route was therefore added under the existing automation route registration:

`GET /api/v1/automations/:id/activity?limit=20&offset=0`

The limit is bounded to 100, offsets are validated, and results are ordered by timestamp and a deterministic ID tie-breaker. It never invokes plan reconciliation, policy execution, models, connector adapters or a queue.

## Evidence and history semantics

The query reuses existing tables: plans, plan_steps, plan_step_approval_bindings, approval_requests, step_executions, receipts and audit_events. No schema changes are required.

- Plan creation and terminal state events use retained audits, with explicitly labelled persisted-record fallbacks where necessary.
- Queue/start entries use retained step audits, latest execution-start records, or a labelled current queued-state observation.
- Approval requests and decisions use bound approval records and retained approval audit entries.
- Step outcomes use immutable receipts or recorded outcome audits. An audited `step.failed` carrying an unverified receipt status remains **unverified**.
- Fallback records do not pretend to reconstruct deleted or unrecorded transitions. Their details explain timestamp provenance and retention limits.
- Duplicate record fallbacks are suppressed when the corresponding audit evidence is present.

Older queue transitions and overwritten execution attempts cannot be fully reconstructed from the current schema. Reads do not invent missing history or add retrospective audit events. Offline verification does not confirm external deployment or email delivery.

## Security

Authentication and active membership follow the existing Step 71 read permission model, including viewers. Every query executes inside the authenticated workspace scope and retains PostgreSQL RLS.

Audit ownership is determined only through workspace-scoped relational target IDs: the plan, its actual steps and bound approval records. Payload `planId` or `stepId` strings cannot establish ownership. UUIDs are compared as text to the audit table's text target IDs, so malformed targets cannot trigger UUID conversion failures.

The API selects only supported event types, whitelisted status values, safe identifiers, timestamps, attempt numbers and fixed server-owned details. It excludes arbitrary payloads, plan metadata, sensitive parameters, proof/artifacts, verification-method text, raw errors, actor identities, worker IDs, idempotency keys and lease tokens. Responses are uncached. React escapes displayed text.

## Independent verification by Codex

- Focused command:
  `pnpm.cmd exec vitest run apps/api/test/automation-activity.test.ts apps/api/test/automations-api.test.ts apps/web/test/automation-activity.test.tsx apps/web/test/automation-dashboard.test.tsx --silent`
  — **44/44 passed**: 11 new timeline API tests, 9 new timeline frontend tests, 9 existing dashboard API tests and 15 existing dashboard/frontend export tests. No skips.
- `pnpm.cmd --filter @thaara/web typecheck` — passed.
- `node --env-file=.env node_modules/vitest/vitest.mjs run packages/db/test/automation-management.runtime.test.ts --silent`
  — **7/7 passed**: four existing checks plus three new timeline checks on real PostgreSQL under non-superuser `thaara_app`. Fixtures remain in one transaction and are rolled back. No migrations or commits.
- Final `pnpm.cmd verify` — **passed once**: build, lint and typecheck passed; **280/280 tests across 26 files**, no skips.
- Browser QA — activity opening, second-page navigation, refresh to the first page, timestamp/source display and desktop/mobile rendering checked with isolated offline fixtures. A 390×844 viewport had no horizontal page overflow. No console errors. Temporary preview page/server removed.
- Preservation check — **177 existing handover files outside the exact Step 72 edit list are byte-for-byte unchanged**, including chat, workers, policy implementations and dependency manifests/lockfiles.
- Final `git diff --check` — passed.

The full historical PostgreSQL RLS and Redis runtime suites were not rerun. Step 72 does not change worker execution. Earlier Antigravity/Step 71 results are not counted as fresh Step 72 evidence.

## Exact files changed in Step 72

Relative to `C:\ThaaraProjects\thaara-ai-agent-v2`:

- `apps/api/src/routes/automations.ts`
- `apps/api/test/automation-activity.test.ts` (new)
- `apps/web/src/AutomationActivity.tsx` (new)
- `apps/web/src/AutomationDashboard.tsx`
- `apps/web/src/automation-api.ts`
- `apps/web/src/styles.css`
- `apps/web/test/automation-activity.test.tsx` (new)
- `packages/contracts/src/automation-activity.ts` (new)
- `packages/contracts/src/index.ts`
- `packages/db/src/repositories/automation-activity.ts` (new)
- `packages/db/src/index.ts`
- `packages/db/test/automation-management.runtime.test.ts`
- `docs/tasks/072-automation-audit-timeline.md` (new)
- `docs/THAARA_CONTINUATION_CHECKPOINT.md`

No commits, pushes, merges, migrations, dependency installations, paid model calls, real emails, external activations or live-service restarts were performed.

Recommended Step 73: improve future audit-event capture for queued/started transitions and retries, preserving approval/policy boundaries, so future timelines retain more complete history. Historical gaps should continue to be labelled rather than fabricated.

Browser-test screenshots (offline fixtures) are retained in the ignored cache at `node_modules/.cache/step72-preview/desktop.png` and `mobile.png`. The final verify log is `node_modules/.cache/step72-verify.log`.
