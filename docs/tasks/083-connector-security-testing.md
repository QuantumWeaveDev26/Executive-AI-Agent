# Step 83 — Connector security testing

Date: 17 October 2026 (Asia/Calcutta)
Status: COMPLETE — mocked KMS and isolated PostgreSQL only; production/live providers remain not_configured
Workspace: C:\ThaaraProjects\thaara-ai-agent-v2
Branch: dev-thaara-continuation
Unchanged HEAD: d3b2921d42e5581c1e1991a7cab5a63261a80b8e

## Scope and findings

Extended existing durable connector tests without changing production behavior. No confirmed production defect was found, so no product code was modified. All existing Step 81–82 behavior and the 12 Step 82 PostgreSQL checks are retained.

Six new mock boundary tests cover disconnect despite KMS outage, disabled-source rejection without key fallback, committed rotation and old-binding fencing, failed rotation preserving state/audit, rotation-versus-disconnect and revoked membership after provider acknowledgement.

Twelve new isolated PostgreSQL/API scenarios cover:

- KMS wrap failure leaves the previous encrypted revision and audit intact; errors are redacted and status reads do not require decryption.
- KMS unwrap failure prevents provider dispatch and produces a failed receipt, never verified success.
- A retired source key is not replaced by another active key; disconnect remains possible with no decryption.
- Committed key rotation uses a fresh encrypted revision/DEK/nonce, survives new app/pool instances, fences old transports and preserves workspace isolation after retiring the old mock key.
- Concurrent rotations across separate pools commit exactly one revision and success audit.
- A disconnect during delayed wrapping prevents a stale rotation commit and retains its tombstone.
- Role revocation during API configuration prevents encrypted state and success-audit publication.
- Membership and session revocation during valid provider readback each return 403, withhold verified receipts/audits and reject subsequent reuse (403 or 401 respectively).
- Lost creation acknowledgements and KMS failure after acknowledgement each persist an unverified receipt; replay does not repeat creation.
- Disconnect/reconnect during otherwise valid readback cannot escape the revision fence (no ABA); its result remains unverified and is not executed again.

The delayed-readback tests return the actual complete synthetic provider workflow, rather than an independently invalid readback. This ensures failure is caused by the injected authorization/revision change.

## Files changed

- apps/api/test/helpers/connector-faults.ts (new): synthetic versioned KMS lifecycle and controlled async fault gates, reusing existing envelope-crypto mocks.
- apps/api/test/connector-security-failures.test.ts (new): six focused durable transport/rotation failure tests.
- apps/api/test/n8n-durable-api.runtime.test.ts: reused existing fixture; preserved twelve Step 82 checks and added twelve Step 83 scenarios.
- docs/requirements-traceability.md: evidence mapping.
- docs/tasks/083-connector-security-testing.md (new): this report.

## Actual verification

- Focused mock suites: 53/53 passed across 3 files (30 existing durable-security, 17 existing key-rotation, 6 new failure-boundary checks); 0 failed, 0 skipped.
- Isolated PostgreSQL API suite: 24/24 passed in 1 file (12 existing Step 82 checks plus 12 new Step 83 cases); 0 failed, 0 skipped.
- Final pnpm.cmd verify: PASSED in one invocation. Build, lint and typecheck passed; 565/565 tests in 43 files, 0 failed, 0 skipped (360.07 seconds for the test stage). The isolated runtime suite is excluded from this command and recorded separately above.
- Review identified a test-quality gap: a general KMS outage could stop rotation at metadata lookup before unwrap. The test now injects failure directly at unwrap and asserts exactly one unwrap call plus unchanged state/audit. A targeted rerun passed 6/6; these overlap the focused count. Independent review confirmed the correction and reported no further findings.
- git diff --check, new-file whitespace and generated test-credential scans passed. All starting production files, existing task reports, migration SQL, dependency files and development .env remained unchanged.
- No product fixes were needed; assertions were not weakened to obtain passing results.

## Fresh database approval, isolation and restoration

Read AGENTS and the Step 82 report; verified branch, HEAD and all uncommitted changes. Captured SHA-256 preservation hashes for 250 starting files in an ignored local test cache.

Before PostgreSQL access, the existing read-only Step 74 guard verified disposable Docker container ownership, dedicated bridge, healthy state, tmpfs storage, loopback PostgreSQL 15432 / Redis 16379 and unchanged development snapshots/.env. An additional read-only probe confirmed current_database=thaara_step74_test, current_user=postgres and both thaara_app connector-function EXECUTE permissions false.

Fresh Step 83 permission approval was requested and received. Step 82 approval was not reused. Only the two approved functions were temporarily granted to the existing thaara_app role:

- public.read_workspace_connector_connection(text)
- public.commit_workspace_connector_connection(text,bigint,text,text,text,jsonb)

Command: node scripts/step82-runtime.mjs --temporary-function-grants-approved (existing launcher unchanged; its suite now includes the Step 83 scenarios).

The launcher reverified isolation and recorded the original permissions before granting. Its finally cleanup revoked the two temporary grants and queried them again; both returned to their original denied state. The focused suite and restoration both exited successfully. Logs are ignored under node_modules/.cache/step83. If future cleanup fails, stop and report immediately; any future temporary grant run needs its own explicit approval.

No PostgreSQL migrations, role creation, credential changes, development database writes or live provider calls were made. Test-only membership/session changes affect uniquely created synthetic fixtures. No DROP/TRUNCATE or shared-data cleanup occurs. Existing n8n workflows, credentials, settings and executions were untouched. Default development/production integrations remain not_configured.

## Limits and next step

Mocked KMS only: app/pool reconstruction uses the same synthetic key service, not a deployed KMS restart or actual cloud IAM/key retirement. Test fixtures remain in disposable storage. A revoked request may leave a conservative started lease when terminal persistence is denied; tests require no verified receipt or audit, and revoked callers cannot reuse it. Production key custody, permission management and migration promotion still require separate approval. Step 74 advanced crash testing and legacy Task 004 remain postponed.

Recommended Step 84: add a read-only admin connector diagnostics view with safe failure/rotation/permission status, using these tested boundaries and keeping live providers disabled. Do not provision a cloud or expose credentials.
