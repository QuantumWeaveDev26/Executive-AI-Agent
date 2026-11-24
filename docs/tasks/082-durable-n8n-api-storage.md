# Step 82 — Durable n8n storage connected to API

Date: 17 October 2026 (Asia/Calcutta)
Status: COMPLETE — isolated test configuration only; live services remain not_configured
Workspace: C:\ThaaraProjects\thaara-ai-agent-v2
Branch: dev-thaara-continuation
Unchanged base HEAD: d3b2921d42e5581c1e1991a7cab5a63261a80b8e

## Implemented

- Explicit server-side buildApp n8nDurable dependency injection uses the existing PostgresConnectorStateStore and DurableN8nSecurityPrototype. No default runtime activation or environment auto-enable path.
- Factory admission reuses Step 74 URL guards, requires NODE_ENV=test and mock cipher, owns the exact database pool, and probes actual database/user, non-elevated thaara_app, two forced-RLS tables, restricted function permissions and absence of direct table privileges. A private object-identity capability binds the dependency to the verified database/configuration; fabricated or conflicting dependencies fail closed.
- Existing connection GET/PUT/DELETE routes expose safe profile/status/revision metadata. Persistent PUT and DELETE require If-Match with the quoted current integer revision (for example, "0"). Missing precondition returns 428, malformed returns 400 and stale updates return 409. Existing ephemeral behavior is preserved.
- Durable compare-and-swap updates, atomic secret-free audits, disconnect tombstones and session/workspace RLS stay in existing PostgreSQL entry points. Status reads do not decrypt credentials or construct provider transports.
- The existing approved-artifact executor receives the durable mock transport. Explicit approvals, PolicyGateway, leases, receipt replay, inactive-only synthetic artifacts and readback remain in effect. A concurrent disconnect fences delayed responses: an acknowledged mock workflow ID can remain in an unverified receipt, but active/verified success is withheld.
- The existing admin screen sends observed revisions and distinguishes encrypted PostgreSQL test storage from temporary mock storage.

## Files changed in Step 82

- apps/api/src/app.ts
- apps/api/src/routes/n8n-connections.ts
- apps/api/src/routes/n8n.ts
- apps/api/src/services/n8n-durable-test.ts (new)
- apps/api/src/types/isolated-runtime.d.ts (new)
- apps/api/test/n8n-durable-configuration.test.ts (new)
- apps/api/test/n8n-durable-api.runtime.test.ts (new)
- apps/web/src/N8nConnection.tsx
- apps/web/src/n8n-api.ts
- apps/web/test/n8n-connection.test.tsx
- apps/web/test/n8n-api.test.ts (new)
- packages/contracts/src/n8n.ts
- scripts/step82-runtime.mjs (new)
- docs/requirements-traceability.md
- docs/tasks/082-durable-n8n-api-storage.md (new)

All six pre-existing Step 81 modified/untracked files are preserved. The Step 81 source store and prototype are reused without editing their contents in this step.

## Verification

- Initial focused API/manager/admission run: 50/50 passed (3 files).
- Final admission/browser revision/screen run: 29/29 passed (3 files); 20 admission checks, 3 browser request checks and 6 screen checks. This overlaps the earlier admission run and is not an additive total.
- Isolated PostgreSQL suite: 12/12 passed (1 file), 0 failed, 0 skipped. Tests cover authentication, roles, CSRF, input/revision rejection, fresh app/pool restart persistence, concurrent CAS with one audit, tombstones, workspace isolation, revoked membership, status without decrypt, approval gating, governed mock readback/receipt replay and disconnect during delayed readback.
- The first runtime run failed two test expectations: the SQL entry point correctly derived its workspace from the authenticated session rather than spoofed scope variables; an uncertain receipt truthfully retained its acknowledged synthetic ID. Assertions now check those actual security contracts, including application rejection of the spoofed scope and absence of verified success after disconnect.
- Final pnpm.cmd verify: PASSED in one invocation; build, lint and typecheck passed; 559/559 tests in 42 files, 0 failed, 0 skipped (357.62 seconds for the test stage). Runtime suites are excluded from this command and recorded separately above.
- git diff --check: passed. All six pre-existing Step 81 files match their starting SHA-256 hashes. Development .env matches its approved snapshot. Generated test credential scan passed across all 15 Step 82 files.
- Focused independent static security review: no actionable findings.

## Safe runtime reproduction and permission restoration

The existing disposable test Docker pair is checked read-only by scripts/step74-initialize.mjs check: owned project/bridge, healthy containers, tmpfs storage, PostgreSQL 127.0.0.1:15432/thaara_step74_test, Redis 127.0.0.1:16379/0, and unchanged development snapshot/.env. No Redis workload is required by this API-only step.

Use node scripts/step82-runtime.mjs when the pre-existing schema and restricted functions are ready. It refuses missing function privileges by default. It loads only the existing ignored Step 74 settings and uses the shared guards for all child-process aliases.

For this session, the user explicitly approved temporary EXECUTE on exactly public.read_workspace_connector_connection(text) and public.commit_workspace_connector_connection(text,bigint,text,text,text,jsonb) for the existing thaara_app role inside the disposable test database, followed by restoration. The approved command was node scripts/step82-runtime.mjs --temporary-function-grants-approved. The flag requires explicit approval before future use.

Both functions had EXECUTE=false before tests; both were revoked and verified false afterward. The launcher records only missing original grants and restores them in finally. No roles or schema objects were created, and no PostgreSQL migrations were applied. Credentials and development services were unchanged. Tests retain uniquely scoped synthetic fixtures in disposable storage; they do not drop/truncate schemas or touch unrelated rows. If the launcher is forcibly terminated, inspect and restore the recorded original permissions before resuming.

## Remaining limits and Step 83

Default development/production and live integrations remain not_configured. Mock keys survive only within the test process; restart coverage rebuilds app/manager/database pools using the same synthetic key service, not a deployed KMS restart. Existing review-only SQL is not promoted or applied by Step 82. No n8n connector tools, network transports, existing workflow changes or real Google access were used. Step 74 advanced crash testing and legacy Task 004 remain postponed.

Recommended Step 83: extend isolated tests for KMS failure, key retirement/rotation and permission revocation while durable API requests are in flight. Keep production provider selection, real key custody and migration promotion behind separate approval.
