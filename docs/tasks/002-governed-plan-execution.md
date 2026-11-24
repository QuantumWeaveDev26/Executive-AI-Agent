# Task 002 — Governed plan execution, durable steps, and receipt state machine

**Status:** IN_PROGRESS  
**Owner:** Antigravity implementation executor  
**Architecture owner:** Codex  
**Depends on:** `docs/architecture.md`, `docs/adr/0001-platform-stack-and-tenant-boundary.md`, `AGENTS.md`, and `docs/tasks/001-platform-foundation.md`

## Outcome

Implement the tenant-scoped durable multi-step plan/step execution engine and receipt state machine. This establishes deterministic plan orchestration, step dependency DAG resolution, immutable approval binding, policy re-evaluation at worker execution time, and truthful receipt verification, without invoking external LLMs or third-party connectors.

## In scope

1. **PostgreSQL Schema & RLS Migrations:**
   - Implement versioned SQL migration for `plans`, `plan_steps`, and `receipts`.
   - `plans` table: `id`, `workspace_id`, `created_by_user_id`, `title`, `description`, `status` (`draft`, `awaiting_approval`, `queued`, `running`, `paused`, `completed`, `failed`, `cancelled`), `version` (optimistic locking), `metadata`, `created_at`, `updated_at`.
   - `plan_steps` table: `id`, `plan_id`, `workspace_id`, `step_index`, `action_name`, `action_class` (`read`/`write`), `risk_level` (`low`/`medium`/`high`/`critical`), `approval_mode` (`none`/`explicit_single`/`two_person`), `parameters` (JSONB), `parameter_hash` (SHA-256 of canonical JSON), `status` (`blocked`, `ready`, `awaiting_approval`, `queued`, `running`, `verified`, `unverified`, `failed`, `skipped`, `cancelled`), `depends_on_step_ids` (UUID array), `approval_request_id` (nullable FK to `approval_requests`), `error` (JSONB), `created_at`, `updated_at`.
   - `receipts` table: `id`, `plan_step_id`, `workspace_id`, `action_name`, `status` (`pending`, `accepted`, `verified`, `unverified`, `failed`), `proof` (JSONB), `verification_method`, `issued_at`, `verified_at`.
   - Row-Level Security (RLS) policies fail closed: all queries enforce `app.workspace_id = workspace_id`, zero fail-open clauses, and unprivileged `thaara_app` role restrictions.

2. **Shared Contracts (`packages/contracts`):**
   - TypeBox schemas for Plan, Plan Step, and Receipt state models matching `docs/architecture.md`.
   - Request and response schemas for `/api/v1/plans` and `/api/v1/plans/:id/steps`.
   - Canonical parameter hashing utility (deterministic sorting of keys for SHA-256).

3. **API Endpoints (`apps/api`):**
   - `POST /api/v1/plans`: create a new plan in `draft` status within authenticated workspace scope.
   - `GET /api/v1/plans`: list plans for the current workspace with pagination and status filters.
   - `GET /api/v1/plans/:id`: retrieve plan details including ordered steps and receipts.
   - `POST /api/v1/plans/:id/steps`: append a step with action name, risk level, parameters, and dependencies.
   - `POST /api/v1/plans/:id/submit`: validate plan DAG, bind required approval requests to mutating steps, and transition to `awaiting_approval` or `queued`.
   - `POST /api/v1/plans/:id/cancel`: cancel queued or running plan and abort pending steps.

4. **Approval Binding & Execution-Time Policy Re-Evaluation:**
   - Link approval requests to the exact `parameter_hash` of the target plan step. If parameters change, the approval is invalidated.
   - When a worker claims a leased step job, re-evaluate policy deterministically against current workspace context:
     - Verify tenant authorization and step approval state.
     - Confirm approval has not expired and parameter hash matches approval payload.
     - Abort execution truthfully if authorization is revoked or approvals do not match.

5. **Durable Worker DAG Orchestrator (`apps/worker`):**
   - Process `plan.execute_step` jobs leased via BullMQ.
   - Upon successful step execution, evaluate the receipt outcome (`verified`, `unverified`, or `failed`).
   - Cascade dependencies: when Step N completes as `verified`, transition dependent `blocked` steps to `ready` and enqueue them.
   - If a step fails or is `unverified`, transition dependent steps to `blocked` or `skipped` and record truthful plan failure.

6. **Automated Verification & Tests:**
   - Unit & in-memory integration tests (PGlite WASM) covering plan CRUD, DAG topological ordering, approval binding, and receipt state transitions.
   - Live PostgreSQL 16 container tests (`packages/db/test/postgres-rls.runtime.test.ts`) validating RLS boundaries across `plans`, `plan_steps`, and `receipts` with unprivileged role `thaara_app`.
   - Live Redis 7 container tests (`apps/worker/test/redis-worker.runtime.test.ts`) validating BullMQ multi-step plan orchestration, recovery across worker restarts, and leased idempotency.
   - Cross-tenant negative security tests: verify Scope A member cannot read, submit, cancel, or approve Scope B plans or steps.

## Out of scope

- LLM / model gateway calls (plans and steps are created deterministically via API or test fixtures).
- Third-party connector integrations (Google Workspace, WhatsApp, CRM, Slack).
- Executive memory, context assembly, and knowledge ingestion.
- Frontend UI expansion (web client only displays basic plan status if needed).
- Realtime voice streaming, short-lived voice sessions, and barge-in.
- Deployment infrastructure or cloud secrets.

## Required validation

Run and report exact commands/results:

```text
pnpm verify
pnpm audit --prod
pnpm run test:runtime
```

Execution of `pnpm run test:runtime` must pass against live PostgreSQL 16 and Redis 7 services with zero skipped tests and zero mock substitutions.

## Acceptance gates

1. **DAG Progression:** A plan with steps A -> B does not execute Step B until Step A has reached a terminal `verified` status.
2. **Approval Binding:** A mutating/high-risk step cannot execute without a matching approved `approval_request`. If the step's parameters or hash change after approval, execution is rejected.
3. **Execution-Time Policy Check:** Policy is evaluated both at plan submission and at worker lease time; permissions revoked between submission and execution fail closed.
4. **Tenant Isolation & RLS:** Member of Workspace A cannot view, append steps to, submit, or execute plans in Workspace B. Direct queries without `app.workspace_id` set return 0 rows; direct unscoped inserts fail with RLS 42501.
5. **Truthful Receipts:** Every executed step emits a persisted receipt. Non-verifiable outcomes are recorded as `unverified` or `failed`; fake success receipts are prohibited.
6. **Worker Durability & Idempotency:** Duplicate step execution requests are deduplicated by `stepId` / `jobRunId`. Unhandled worker crashes allow leased recovery without duplicate step execution.
7. **Quality Gates:** `pnpm verify` and `pnpm audit --prod` pass cleanly with 0 errors and 0 vulnerabilities.

## Handoff report format

Return: modified files; architecture decisions or deviations; commands and results; test count; coverage of each acceptance gate; known limitations; and the proposed next task.
