# Step111 — approval request for ONE isolated in-memory SQL acceptance run

Status: **CONSUMED — executed once after separate owner approval;8/8 PASS.** See `PHONE111_IN_MEMORY_RESULT_2026-11-03.md`. The request below is retained as the exact historical scope; it is not authorization for another run. No authorization inferred from existing fixture or earlier PostgreSQL approvals.

## Exact command requested

From `C:\ThaaraProjects\thaara-ai-agent-v2`:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-inbound-memory-acceptance.review.ps1 -ApprovedInMemoryPhone111
```

This command is NOT approved yet. Do not run it merely to inspect it.

## Scope and pinned artifacts

- ONE new `PGliteDatabase()` with no URL, disk path, pool or environment-derived connection. It runs an embedded PostgreSQL engine entirely in memory. No PostgreSQL service, Docker object, VPS connection, persistent volume or network port is created or accessed.
- Twelve pinned existing base migrations from `packages/db/src/migrations`, synthetic workspaces/users/sessions, then ONLY `docs/migrations/111-phone-inbound-reports.review.sql`.
- Eight tests in `apps/api/test/phone-inbound-storage-acceptance.test.ts`, with `--bail=1`; stop on unexpected migration/security/test error. No automatic repair or retry.
- Runtime app role restrictions, owner/workspace RLS and a synthetic audit-failure trigger are exercised ONLY in the new memory instance. RESET ROLE and synthetic session revocation in the fixture affect only that instance.
- No existing data copied in. No real credentials used; synthetic local test identities/tokens are not printed. No `.env`, connection string, provider key or SSH helper is read by this runner.

Reviewed manifest: `PHONE111_IN_MEMORY_APPROVAL.review.json`, **97 pinned files**, covering new SQL/test/repository, normalizer, wrapper/generator, twelve base migrations, lockfile, workspace package-resolution descriptors and first-party runtime JavaScript (DB/contracts/observability/config).

SHA256 pins at preparation:

| Artifact | SHA256 |
|---|---|
| Manifest | `06c60028ce03e32565b11e575ce6049175a02f1072f8c2489dde444ea8e04381` |
| Step111 SQL | `832e877538b00b1a23da79caca7107f9f57c7aea48426f3bc100bb00758da7dd` |
| Execution wrapper | `fa5679c9074846109b2d58c175b609a0da2118c6be5118c688e2514eebec34df` |

Verify the manifest hash against this document and every source hash before execution. Stop if anything differs; do not regenerate pins after approval to hide a change. Preparation/check command `node scripts/prepare-phone-inbound-acceptance.mjs --check` performs no SQL.

## Eight planned acceptance tests

1. Durable round-trip through a fresh repository object on the same embedded engine; callback interest remains Needs review unless a saved request is admitted. This is NOT process-restart persistence proof.
2. Workspace AND same-workspace owner isolation through repository and restricted-role direct RLS reads.
3. Member denial, including direct INSERT under the restricted app role.
4. Identical replay returns one saved record; changed payload/event conflicts.
5. Two queued concurrent callers deduplicate on the embedded engine's single connection. This is NOT multi-connection PostgreSQL lock/race proof.
6. Audit INSERT failure rolls back the report INSERT.
7. Owner detail access is audited without customer number/business in audit payload.
8. Runtime UPDATE/DELETE denied and revoked owner session invalidated.

Live Calendar verification, provider authenticity, private runtime principals, physical retention purge, network PostgreSQL concurrency and provider delivery are NOT established by these eight tests. Existing mock tests cover callback/Calendar outcomes, missing phone, delivery failure, withdrawal and media expiry separately.

## Guard, output and cleanup

- Wrapper checks source hashes before setting the process-local `THAARA_PHONE111_SQL_TEST_APPROVED=in-memory-only` flag. Without it, all eight tests remain skipped. Existing gate values are refused rather than overwritten.
- Consumes one attempt by creating `node_modules/.cache/phone111-in-memory-v1-used.json` with CreateNew. It must not already exist. Never remove/reset it for an automatic retry. It contains only scope, timestamp and manifest hash.
- Expected receipt: `node_modules/.cache/phone111-in-memory-acceptance.json`. Test data is synthetic; report only sanitized results.
- The memory database is closed in the suite's afterAll hook, including failures after creation. Process exit ends the memory instance; no database directory/container/volume cleanup command exists. No recursive delete or resource enumeration is used.
- Wrapper finally removes only its process-local flag and restores the prior working directory. Retain the attempt marker/result as evidence; no existing artifacts/backups are deleted.
- Confirm the child process ended, flag absent, and owned marker/result state. No existing service or integration may be changed.

## SQL review and current verification

Additive table/index/RLS only; no DROP, UPDATE/DELETE of existing data, role/user/password change, extension, external connection or security-definer function. Existing base defaults are explicitly restricted: app gets SELECT/INSERT only, worker/PUBLIC get no new privileges. New report JSON must match workspace/owner/report ID; callback/appointment projections have shape checks. The schema does NOT independently verify Calendar readback or a provider signature; production admission must supply trusted provenance.

Database-free checks/builds and wrapper syntax/pin checks passed. Eight SQL tests were collected with the approval flag absent: **8 skipped, 0 executed**. New SQL has NOT been applied anywhere. Any runtime failure stops this approval attempt.

## Owner approval text

“Approve ONE execution of the pinned Step111 in-memory acceptance package dated 3 November 2026, using the exact command above. Verify all checksums first. Apply the twelve pinned base migrations and reviewed Step111 SQL only inside the newly created memory-only PGlite instance, run the eight tests, close it and verify cleanup. Stop on failure; no repair or retry. Preserve every existing database/service and all Sarvam, outbound, Gmail, Calendar, WhatsApp and n8n configuration. No live integration, provider request, appointment, call, deployment, credential change, commit or push is approved.”
