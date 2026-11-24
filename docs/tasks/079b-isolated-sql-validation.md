# Step 79B — Isolated SQL Validation

Date: 17 October 2026 (Asia/Calcutta)
Status: COMPLETE (isolated disposable PostgreSQL validation only; production/development `thaara_v2` untouched)
Workspace: `C:\ThaaraProjects\thaara-ai-agent-v2`
Branch: `dev-thaara-continuation`
Preserved HEAD: `4d3fc87bbe5564364bdcbc92e9172ce768c4ab30`

## Scope and Isolation Verification

1. Verified Step 74–79A handover state on `dev-thaara-continuation` at `4d3fc87bbe5564364bdcbc92e9172ce768c4ab30`; preserved all uncommitted changes.
2. Verified isolated test container ownership, `tmpfs` storage, loopback port `127.0.0.1:15432`, target database `thaara_step74_test`, and unchanged development `.env` / `thaara-v2-postgres` / `thaara-v2-redis` snapshots via `node scripts/step74-initialize.mjs check` before and after execution.
3. Registered `packages/db/test/step79b-connector-security.runtime.test.ts` in `scripts/step74-runtime-entrypoints.test.ts` so importing the runtime suite without `THAARA_TEST_MODE=step74` fails closed before constructing any `pg.Client` or `pg.Pool`.
4. Confirmed `Migrator.loadMigrationFiles()` loads only the 12 baseline migrations (`0001..0012`) and excludes the review-only Step 79A SQL files.

## Real-PostgreSQL Defect Found & Fixed

- **Defect**: In `docs/migrations/079a-connector-security.review.sql`, `public.connector_credential_envelope_valid(jsonb)` validated `keyId` using `(p_value->>'keyId') !~ '^[!-~]{1,512}$'`. PostgreSQL 16's POSIX regular expression engine (`RE_compile_and_cache`) enforces `DUPMAX = 255` on `{m,n}` repetition bounds and raises `ERRCODE 2201B` (`invalid regular expression: invalid repetition count(s)`) when `n > 255`. Because the function had `EXCEPTION WHEN OTHERS THEN RETURN false;`, every valid envelope was rejected at runtime in real PostgreSQL.
- **Fix**: Replaced the `{1,512}` regex quantifier in `docs/migrations/079a-connector-security.review.sql` with `pg_catalog.length(p_value->>'keyId') NOT BETWEEN 1 AND 512 OR (p_value->>'keyId') !~ '^[!-~]+$'`.
- **Regression Coverage**: Added explicit real-PostgreSQL assertions in `packages/db/test/step79b-connector-security.runtime.test.ts` verifying that a 300-character printable `keyId` passes validation while a 513-character `keyId` is rejected.

## Isolated PostgreSQL Validation Results (`9/9` passed)

- Guard enforcement on `079a-connector-security.review.sql` (rejects missing approval GUC, `thaara_v2`, `thaara_production`, and duplicate runs).
- `ENABLE` + `FORCE ROW LEVEL SECURITY` on `workspace_connector_profiles` and `workspace_connector_connections`; `thaara_connector_guard` (`NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`, no `CREATE` on `public`, no role members).
- Direct table/helper access denied to `thaara_app`, `thaara_worker_user`, `thaara_admin_user`, and `unprivileged_tester`; `thaara_app` restricted to `read_workspace_connector_connection` and `commit_workspace_connector_connection`.
- Token-bound admin/owner session & membership checks (denying `member`, `viewer`, forged `owner` GUC headers, revoked sessions, and expired sessions).
- Trusted enabled profile + SHA-256 fingerprint enforcement, cross-workspace isolation, durable revision increments, and mocked KMS key rotation (`ConnectorKeyRotationPreparation` `kms-mock-v1` -> `kms-mock-v2`).
- Disconnect tombstones (`status = 'disconnected'`, `profile_id = NULL`, `credential_envelope = NULL`, monotonic revisions without reset to `1`).
- Concurrent update and concurrent initial-creation serialization via `pg_advisory_xact_lock` + `FOR UPDATE` CAS.
- Atomic transaction rollback of both connector state and secret-free `audit_events` on downstream failure.
- Fail-closed access rollback (`079a-connector-security.rollback.review.sql`) revoking `thaara_app` entry-point execution while preserving encrypted records, revisions, profiles, and audit history.
