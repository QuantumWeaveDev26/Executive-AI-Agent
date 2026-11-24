# Step 74 — Database & Worker Reliability Testing

Date: 17 October 2026 (Asia/Calcutta)
Status: BLOCKED at test-isolation preflight; implementation and runtime testing have not started.
Workspace: C:\ThaaraProjects\thaara-ai-agent-v2
Branch: dev-thaara-continuation
Verified HEAD: 4d3fc87bbe5564364bdcbc92e9172ce768c4ab30
Working tree before preflight: clean.

## Goal and scope

Verify real PostgreSQL/Redis reliability under competing workers/API execution, interruption, lease expiry, retry/recovery and temporary database failures, while preserving policy, approvals, truthful receipts, audit history and tenant isolation. Use controlled, test-owned fault injection only. No unrelated process may be killed or disrupted.

AGENTS.md and docs/THAARA_DAILY_HANDOVER_2026-10-16.md were read. The required branch and exact saved checkpoint match. No prior development was changed.

## Preflight findings

Read-only inspection covered the existing PostgreSQL and Redis/BullMQ runtime setup, scoped rollback-only audit tests and the queue implementation:

- apps/worker/test/redis-worker.runtime.test.ts takes REDIS_URL (default localhost:6379), DATABASE_URL and MIGRATION_DATABASE_URL, calls Migrator.migrate in beforeAll, creates persistent fixtures and starts DistributedJobQueue.
- packages/db/test/postgres-rls.runtime.test.ts also calls Migrator.migrate in beforeAll and creates/alters an unprivileged tester role.
- apps/worker/src/queue.ts uses the fixed application queue name thaara-jobs. A reachable development Redis URL alone is insufficient isolation for this suite.
- packages/db/test/automation-management.runtime.test.ts uses rollback-only fixtures but explicitly targets the existing localhost thaara_v2 database. That narrow read/write evidence from Step 73 does not authorize concurrency/crash tests against ordinary development services.
- Docker container and cached-image inventory commands could not connect to npipe:////./pipe/dockerDesktopLinuxEngine; the engine pipe does not exist. No container identities, ports, mounts or test-only ownership could therefore be verified.

The runtime suites were NOT invoked. No database/Redis connection, fixture write, migration, Docker start/create/remove, process interruption or external call was performed by this preflight. Docker failure is an environment/isolation blocker, not a demonstrated application defect.

## Required before resuming

1. Make the local Docker Linux engine available, or supply already running dedicated local PostgreSQL and Redis test instances.
2. Verify the exact instance identities, localhost ports/endpoints and test-only ownership; confirm their data volumes/databases/Redis storage are separate from production, shared and ordinary development services.
3. If fresh PostgreSQL fixtures require initial schema/role setup through existing migrations, obtain explicit approval for that isolated initialization first. Today's instruction does not authorize database migrations. No dependency installation is authorized.
4. Configure runtime-only endpoints without changing the ordinary development .env or printing credentials. Use a dedicated Redis instance and test-owned job IDs/queue namespace, or prove the fixed existing queue name cannot share application work.
5. Inspect all applicable suite setup/cleanup before execution. Reuse infrastructure while adding fail-closed target checks so an accidental development URL cannot run fault tests.
6. Preserve the saved checkpoint and these documentation changes; no commit/push/merge is authorized.

## Coverage to implement after isolation is verified

| Priority | New real-runtime evidence sought | Existing coverage to reuse without duplicating |
| --- | --- | --- |
| 1 | Two workers and API-versus-worker compete for one step; only the winning valid lease dispatches the adapter. | Plan-worker and chat integration lease exclusion tests; StepExecutionRepository atomic claim. |
| 2 | Interruption/expired lease takeover and native reconciliation; unsafe/non-idempotent uncertain outcomes stay unverified without blind retries. | Existing conservative recovery and idempotent reconciliation integration cases. |
| 3 | Dedicated Redis/BullMQ retry and recovery retain committed queued/released-lease state across deliveries. | redis-worker.runtime.test.ts and existing transient retry regression tests. |
| 4 | Controlled PostgreSQL failures roll back domain state, receipts and audits atomically; retry/recovery preserves truthful history. | Scope-wrapper rollback tests and Step 73 audit capture tests. |
| 5 | Approval rejection, cancellation and permission revocation races remain policy-enforced during execution/recovery. | Existing chat/worker authorization and cancellation integration cases. |
| 6 | Competing/recovery paths retain workspace isolation, immutable receipts and once-only winning audit events. | Existing RLS runtime suite and rollback-only audit runtime checks. |

Use barriers and bounded waits to coordinate concurrent test-owned clients/workers. Fault injection must affect only dedicated test clients/connections/processes. Do not flush shared Redis, truncate existing tables, stop unrelated processes, call paid models, send email or activate external automation. Fix only defects reproduced by a focused failing regression; avoid unrelated refactoring.

## Verification results for this attempt

- Git/workspace checks: required branch and exact HEAD confirmed; original working tree clean.
- Docker isolation preflight: FAILED — Linux engine unreachable.
- Automated tests invoked: 0. Passed: 0; failed test cases: 0; skipped: 0. No suite was started, so these counts are not test-pass evidence.
- pnpm.cmd verify: NOT RUN; the request to run it once after completed implementation remains outstanding.
- Isolated PostgreSQL/Redis runtime suites: NOT RUN.
- Application defects confirmed or fixed: none.
- Historical Step 73 evidence remains 293/293 tests and 10/10 PostgreSQL checks; it was not rerun and is not fresh Step 74 evidence.

## Files changed

- docs/tasks/074-database-worker-reliability-testing.md — this blocked-preflight report and resumption requirements.
- docs/THAARA_CONTINUATION_CHECKPOINT.md — appended Step 74 blocker, without changing prior completion records.

Step 74 is NOT complete. Next action is to establish and verify isolated test services and authorize schema initialization if needed, then resume the focused tests above. After implementation, run focused checks, applicable isolated runtime suites and pnpm.cmd verify once, recording exact results and remaining risks.

Provisional Step 75 recommendation, only after Step 74 passes: operational visibility for retries, stalled/uncertain tasks and recovery failures, with safe alerts and no automatic external activation.

## Isolated environment preparation — 17 October 2026

Docker is now available; only development containers using persistent volumes and ports 5432/6379 were found. Prepared a separate Compose project, without creating containers or running migrations.

- docker-compose.step74-test.yml: PostgreSQL 16 at 127.0.0.1:15432, database thaara_step74_test; Redis 7 at 127.0.0.1:16379.
- Separate tmpfs storage, no existing volumes, separate internal network, no restart policy and cached-only images.
- scripts/step74-test-env.mjs: preparation/check only; no start/migrate/test capability. Generates four separate random admin/app/worker/Redis credentials in ignored node_modules/.cache/step74/.env.step74. Never loads or changes development .env.
- Settings checks reject development/default ports, wrong hosts/databases, credential mismatches and conflicting inherited environment values. Five negative port checks run without network connections. Errors omit secret values.

Preparation and static validation commands (safe; executed during preparation):

~~~powershell
node scripts/step74-test-env.mjs prepare
node scripts/step74-test-env.mjs check
docker compose --env-file node_modules/.cache/step74/.env.step74 -p thaara-step74-test -f docker-compose.step74-test.yml config --quiet
~~~

Exact creation command, ONLY AFTER EXPLICIT APPROVAL (not executed):

~~~powershell
node scripts/step74-test-env.mjs check
docker compose --env-file node_modules/.cache/step74/.env.step74 -p thaara-step74-test -f docker-compose.step74-test.yml up -d --pull never --wait
~~~

Startup creates only an empty test database. Applying existing migrations and provisioning app/worker login roles require separate explicit approval; no migration command has been executed.

Remaining blockers/risks:
- postgres-rls.runtime.test.ts hardcodes GRANT CONNECT ON DATABASE thaara_v2; automation-management.runtime.test.ts allows only localhost/thaara_v2. Both require isolated-target adaptation before using the distinct test database.
- Existing PostgreSQL/Redis suites automatically migrate, create/alter roles and have localhost/default-port fallbacks. Do not run them unmodified through a generic env-file command.
- QUEUE_NAME is fixed to thaara-jobs. Dedicated Redis instance isolation must be verified after creation; do not reuse the development instance or share its queue.
- Settings guards do not constitute an OS firewall: manually bypassing the helper and running legacy scripts can still select development URLs. A fail-closed runtime launcher/harness must validate and explicitly pass isolated settings before tests are enabled. No claim that all legacy tests are now safe is made.
- tmpfs is disposable and PostgreSQL data is lost on stop; Redis persistence is disabled. Containers/images/ports/volumes/roles and real isolation must be rechecked after approved creation.
- No container start/recreation, migration, runtime test or full verify was performed for preparation. Existing .env and development services are unchanged. Step 74 remains incomplete, awaiting approval.

### Approved test-network correction — 17 October 2026

The internal-only test network produced no published host ports. With explicit approval, only the two labelled disposable Step 74 containers were recreated on dedicated bridge thaara-step74-test-bridge. Both are healthy and TCP-reachable at 127.0.0.1:15432 and 127.0.0.1:16379; actual published bindings are loopback-only. Separate tmpfs storage and generated credentials remain in use. Development container IDs/start times/restart counts/mounts/port bindings and development .env hash are unchanged. No migrations, application-role changes or reliability tests ran. Schema initialization and harness adaptation still await approval. This supersedes earlier internal-network setup descriptions.

### Migration approval recorded; fail-closed target audit stopped initialization

Existing migrations/test-role setup were explicitly approved only inside the disposable PostgreSQL. Preflight verified healthy test container IDs 9d2c1b3ce028 (PostgreSQL, 127.0.0.1:15432/thaara_step74_test) and 72cdb06a4704 (Redis, 127.0.0.1:16379), temporary storage and dedicated bridge. Development .env hash remains unchanged.

The requested all-test-script audit found unsafe runtime targets still present: task003-security.runtime.test.ts has explicit worker/seeder connections to localhost:5432/thaara_v2 and hardcoded GRANT/database values; postgres-rls.runtime.test.ts hardcodes the development database GRANT; redis-worker.runtime.test.ts falls back to localhost:6379/default PostgreSQL settings; several other runtime suites retain default-port/database fallbacks, and automation-management.runtime.test.ts requires the development database name. Mocked unit-test URLs and preset identifiers are not treated as live connection blockers.

Following the user\x27s explicit fail-closed rule, initialization stopped before any migration, role change or reliability test. Migration approval remains recorded but has not been exercised. Required next step: adapt the runtime target handling and wire fail-closed isolated guards before executing these suites or proceeding under this migration task. No production/development data or credentials changed.

### Isolated runtime guards and approved schema initialization — 17 October 2026

This section supersedes the preceding unsafe-connection blocker. Branch dev-thaara-continuation and saved checkpoint 4d3fc87bbe5564364bdcbc92e9172ce768c4ab30 are preserved. No commit was created.

Implemented:
- All eight PostgreSQL/Redis runtime entry points require THAARA_TEST_MODE=step74 and five explicit THAARA_TEST_* connection settings. There are no development host/port/database fallbacks. Derived worker, seeder and negative-test role URLs retain the validated target.
- Shared fail-closed validation accepts only PostgreSQL 127.0.0.1:15432/thaara_step74_test and authenticated Redis 127.0.0.1:16379/0. Missing settings, development ports/database, alternate hosts/databases/users, URL overrides, conflicting generic/PG settings and offline skipping are rejected before service construction.
- Initialization children receive the same validated settings and a preload guard; inherited Node preloads are removed. Windows Node --import requires a file URL; a failing positive-control regression reproduced this and now passes.
- Docker preflight checks labelled project/service ownership, health, loopback bindings, tmpfs storage, credentials and exact dedicated-bridge membership. Docker failures discard captured inspect output; probe messages never display credential-bearing URLs.
- Existing migration SQL is unchanged; all 12 built copies match source. Existing migration/provisioning commands run only as guarded children of the explicit initializer.
- The legacy Task 004 helper now accepts a target validator invoked before any client or destructive query. Its derived thaara_task004_fresh database is rejected under this single-database approval; no security assertions were removed.

Exact changed-file inventory for this connection-safety work:
- scripts/step74-runtime-guard.mjs
- scripts/step74-child-guard.mjs
- scripts/step74-initialize.mjs
- scripts/step74-runtime-guard.test.ts
- scripts/step74-runtime-entrypoints.test.ts
- scripts/step74-test-env.mjs (extends earlier preparation helper)
- packages/db/scripts/provision-task004-fresh.ts
- packages/db/test/automation-management.runtime.test.ts
- packages/db/test/postgres-rls.runtime.test.ts
- packages/db/test/task003-security.runtime.test.ts
- packages/db/test/task003-repositories.runtime.test.ts
- packages/db/test/task003-streaming.runtime.test.ts
- packages/db/test/task003-purge.runtime.test.ts
- packages/db/test/task004-governance.runtime.test.ts
- apps/worker/test/redis-worker.runtime.test.ts
- docs/tasks/074-database-worker-reliability-testing.md
- docs/THAARA_CONTINUATION_CHECKPOINT.md

Earlier docker-compose.step74-test.yml and existing uncommitted documentation/preparation changes were retained. Generated six independent role/service passwords remain only in ignored node_modules/.cache/step74/.env.step74; root .env is never loaded for test settings.

Fresh evidence:
- Focused command: pnpm.cmd exec vitest run scripts/step74-runtime-guard.test.ts scripts/step74-runtime-entrypoints.test.ts packages/db/test/bootstrap-identities.test.ts --silent
- Final result: 57/57 passed across 3 files; 0 failed, 0 skipped (guard 42, entry-point/refusal 9, existing bootstrap 6). These are non-network configuration/role-bootstrap unit checks. Expected test-first failures were fixed before this final passing run.
- Approved initializer: node scripts/step74-initialize.mjs initialize-approved — exit 0. All 12 existing migrations are in the isolated ledger. Four login roles configured: thaara_app, thaara_admin_user, thaara_worker_user, thaara_seeder_user; no superuser/BYPASSRLS/create-role/create-database privileges. Application and worker logins verified against the exact test database.
- Redis 127.0.0.1:16379/0 authenticated PING returned PONG; no queue or key mutation.
- Before/after development container IDs/start times/restarts/mounts/bindings and development .env hash match.
- Initialization initially stopped before migrations because Windows rejected a native --import path; switching to a file URL was verified with both accepting and rejecting child controls before the successful retry.
- Evidence: ignored node_modules/.cache/step74/connection-guard-focused.log and initialization-result.json.
- No concurrency/crash-recovery suite, production/development DB connection, full pnpm verify, installation, new migration, container mutation or external integration ran in this connection-fix task.

Remaining: Step 74 reliability scenarios are NOT complete. Stop here as requested. Resume only on instruction with focused isolated concurrency/recovery tests; recheck disposable container identity first (tmpfs data is lost on stop). QUEUE_NAME remains thaara-jobs, safe only on the verified dedicated Redis instance. Task 004 fresh-database lifecycle requires separate scoped adaptation/approval and cannot currently run under the one-database restriction. General development migration CLIs remain general-purpose; Step 74 must use the guarded initializer, never invoke them directly with development settings.

### Main-feature prioritization — Step 75

At the user's instruction on 17 October 2026, advanced concurrency/crash-recovery testing and the legacy Task 004 fresh-database lifecycle are postponed. Existing isolated initialization evidence and all Step 74 changes are retained. Step 74 is not complete; no postponed runtime checks are reported as passing. Resume only on instruction with verified disposable targets and applicable approval. Step 75 Gmail foundation is tracked separately in 075-gmail-integration-foundation.md.
