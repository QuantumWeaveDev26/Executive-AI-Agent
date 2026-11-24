# Step 79A — provider-neutral KMS preparation

Date: 17 October 2026. Workspace: C:\ThaaraProjects\thaara-ai-agent-v2. Branch: dev-thaara-continuation. HEAD preserved: 4d3fc87bbe5564364bdcbc92e9172ce768c4ab30. All previous uncommitted work is preserved.

## Implemented scope

- Read AGENTS.md, Step 78 report, current envelope cipher/state contracts and relevant existing authentication/RLS/transaction/migration-loader code.
- Added provider-neutral VersionedConnectorKeyService with active-version lookup, version description and explicit-version wrapping, extending existing wrap/unwrap interfaces. Metadata distinguishes encrypt_decrypt, decrypt_only and disabled versions with monotonic generations.
- No cloud provider, deployment region/account, real KMS implementation, identity or key resource is selected. Interfaces use opaque version IDs rather than vendor-specific identifiers. No key provisioning, administrative lifecycle change or key deletion method is exposed.
- Added unwired, mock-only ConnectorKeyRotationPreparation. It authorizes through existing n8n PolicyGateway controls, reads fresh scoped state, pins value snapshots, checks approved profiles, decrypts using the retained source version and creates a new revision with a fresh per-secret 256-bit DEK and 12-byte nonce through Step 78 AES-256-GCM.
- AAD remains bound to workspace, connector, profile, revision and key ID; wrapping authenticates the same logical context. Version pinning rejects unexpected wrapping acknowledgements, disabled/read-only targets, downgrade/same-version targets and key lifecycle changes observed after wrapping.
- Preparation performs no store commit or provider work and returns prepared_not_committed/mode=mock. The caller must later perform an authorized atomic compare-and-swap/audit commit and fresh lifecycle/fence checks; preparation is not persistence, deployment or verified connectivity.
- All prior source code remains unchanged. No new routes, adapters, worker registration or UI connection path are enabled. Existing production keys, credentials and live n8n remain not_configured.

## Review-only PostgreSQL SQL

Forward draft: docs/migrations/079a-connector-security.review.sql.
Access-rollback draft: docs/migrations/079a-connector-security.rollback.review.sql.

Both are outside packages/db/src/migrations and are excluded by the real default migration loader. Each script has a transaction guard requiring explicit review approval plus an exact target-database setting; the scripts do not set those flags themselves. No SQL from either draft has been executed, including against in-memory databases. They have not been added to schema_migrations or assigned an automatic migration version.

The forward draft proposes:
- An empty workspace_connector_profiles allowlist: workspace/connector/profile identity, safe display label, canonical configuration fingerprint and disabled-by-default enable flag. No URL, API token or provider secret is stored here. This makes Step 78's trusted profile authorization concrete; caller-provided profile IDs alone are insufficient.
- An empty workspace_connector_connections table containing ciphertext envelope, safe bounded monotonically increasing revision, profile/fingerprint, truthful configured_unverified/disconnected status, actor and timestamps.
- A composite workspace/connector identity and profile FK; disconnect retains its revision tombstone while clearing profile/fingerprint/envelope. Workspace/profile deletion is restricted until a separately reviewed tenant-resource lifecycle exists.
- ENABLE and FORCE RLS on both new tables, token-bound to current_authenticated_scope and fresh owner/admin authority. Inherited/default direct table grants are revoked. No physical delete or revision-reset entry point is exposed.
- A dedicated NOLOGIN/NOBYPASSRLS guard role; no runtime role membership or login credential. New SECURITY DEFINER routines use fully qualified objects and pg_catalog,pg_temp search_path. Only restricted read/commit entry points are granted to thaara_app; no worker credential-read grant.
- A private authenticated-scope helper derives GUCs from the actual session, locks the active session and owner/admin membership, and checks wall-clock expiry. Read/commit cannot trust a caller-supplied workspace, actor or role.
- An envelope validator rejects unexpected keys, malformed/non-canonical base64url, wrong IV/tag sizes and oversized payloads. Database checks validate storage shape; they cannot prove KMS context, cryptographic integrity or provider outcome.
- A scoped transaction advisory lock covers initial missing rows; existing records are row-locked. Commit compares expected revision, increments exactly once and inserts a derived secret-free event into the existing audit ledger in the same transaction. A failed/conflicting transaction cannot produce a success audit. Rotation requires an existing configured record and a distinct key version; disconnect needs no KMS.
- A trusted enabled profile and matching configuration fingerprint are required for configuration/rotation; profile changes invalidate reads of old mappings. Define the fingerprint from canonical workspace/connector/profile/trusted origin/project configuration, never secrets.
- Fresh authorization/expiry checks after lock waits, no plaintext credential fields, no seed data or external workflow operation.

The guard role receives SELECT and narrow UPDATE-column privileges on existing session/membership tables solely because PostgreSQL row-share locks require UPDATE privilege on at least one column. The routines do not update those rows. It receives INSERT-only access to existing audit_events, not audit mutation rights. The draft grants schema CREATE only temporarily for ownership transfer, then revokes it and fails if inherited schema CREATE or guard-role membership remains. Existing broad PUBLIC schema CREATE must be handled through a separate reviewed change; this script does not silently alter unrelated schema ACLs.

The profile registry is an additive design refinement, not an implementation of provider setup. It remains empty and disabled. An approved provisioning process, server mapping and SQL adapter are still required. Gmail's existing per-user OAuth vault must not be moved into this shared workspace-admin storage without a separate account/principal-binding design.

## Rollback and recovery instructions — review only

1. Before forward COMMIT, a failed approval/prerequisite/security check aborts the transaction; operator ROLLBACK leaves no connector objects applied.
2. After a future approved COMMIT, stop connector configuration/execution in the application and inspect approved database/object identities. The rollback draft verifies object markers, revokes the new read/commit entry points and direct table privileges, then commits a fail-closed access rollback.
3. Keep encrypted rows, profile catalog, durable revisions, disconnect tombstones, key references and audit history. The rollback intentionally does not DROP tables/roles, DELETE/TRUNCATE data, disable RLS, decrement revisions, delete KMS keys or restore old state.
4. Roll back the application to the prior disabled connection implementation. Do not route credentials through local process epochs or a plaintext fallback.
5. A reviewed forward fix is preferred to destructive cleanup. Schema removal, profile/tenant purge, privilege restoration and key lifecycle changes each need separate explicit approval.
6. A restored database backup can contain revoked encrypted credentials and old revisions. Do not serve connections until an approved recovery procedure invalidates/advances revisions and reconciles key/provider revocation. Tombstone deletion or restoring old keys is not a rollback strategy.
7. No claim of cryptographic erasure is made: old ciphertext may remain in backups, and immutable JavaScript strings cannot be reliably wiped.

## Verification and limits

- Test-first run failed because the new rotation module did not exist.
- Focused tests: 45/45 across two files, 0 failed/skipped (17 new Step 79A +28 Step 78). Repeated only after draft creation to exercise actual default-loader exclusion. API typecheck passed.
- New cases cover version states/downgrades, unexpected wrapping versions, fresh data keys/nonces, ciphertext-only pending output, mock snapshot restart, CAS conflict, tenant/role boundaries, disabled source keys, post-wrap revocation, disconnect tombstones, membership revocation, redacted outages and no migration auto-discovery.
- No SQL draft was executed. Real PostgreSQL syntax/catalog/RLS/locking/rollback tests, managed KMS conformance and true process-restart tests remain pending approved isolated validation.
- Key-service metadata and database revisions cannot form one cross-system atomic transaction. The preparation result is pending only; the eventual persistence adapter must revalidate authority/version/fences and preserve uncertainty rather than claim success.
- Existing source and production not_configured defaults are retained. No installs, infrastructure, new credentials, real provider/n8n calls or Git mutations. Step 74 advanced crash/concurrency and legacy Task 004 stay postponed.
- Final verification and source-review evidence follow below.

## Files changed

- apps/api/src/services/connector-key-rotation.ts (new)
- apps/api/test/connector-key-rotation.test.ts (new)
- docs/migrations/079a-connector-security.review.sql (new, unapplied)
- docs/migrations/079a-connector-security.rollback.review.sql (new, unapplied)
- docs/tasks/079a-provider-neutral-kms-preparation.md (new)
- docs/THAARA_CONTINUATION_CHECKPOINT.md
- docs/requirements-traceability.md

## Required approvals and next step

Step 79A prepares contracts and review artifacts only. No hosting/cloud selection is needed now.

Before Step 79B, approve execution and validation of the reviewed SQL/guard-role/RLS changes ONLY on an explicitly verified disposable PostgreSQL test target. Review/approve any required schema-ACL adjustment separately. Validate actual SQL syntax, forced RLS, least privilege, rollback, failed audits, concurrency and disconnect recovery with mock key services before any runtime connection wiring.

Production database migration, workload identity, real key/credential provisioning and live provider/n8n connection setup remain separate future approvals after hosting is decided. No provider choice or provisioning is requested in this step. Stop after Step 79A.

## SQL design references

Primary PostgreSQL documentation was checked for these draft design choices: [row-security ownership and FORCE RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [SECURITY DEFINER search paths and execution privileges](https://www.postgresql.org/docs/current/sql-createfunction.html), and [row-locking column privileges](https://www.postgresql.org/docs/17/sql-select.html). These references do not substitute for executing approved isolated SQL validation.

## Static security review

Independent read-only review found no important actionable security finding in the authorized mock-only/review-draft scope. Scope/envelope snapshots, version pinning, fresh DEK/nonce/AAD, authorization, SQL privileges/RLS design, CAS/audit and non-destructive rollback were reviewed. A prepared artifact is not a durable authorization artifact: lifecycle can change during the final storage read or after return, and a future committing adapter must revalidate it. No SQL/provider execution was used for this review.

## Final verification and completion

- Step 79A preparation complete. pnpm.cmd verify ran exactly once, exit 0: build, lint and typecheck passed; 532/532 tests across 40 files passed, 0 failed/skipped. Test-phase duration: 594.65 seconds. Ignored log: node_modules/.cache/step79a/verify.log.
- Focused checks: 45/45 across two files (17 new Step 79A +28 Step 78); API typecheck passed. No unresolved failure. Full verification includes prior steps and the loader-exclusion test; neither review SQL file was executed. Existing verification fixtures use their established isolated schema only.
- Final diff/whitespace/generated-secret checks passed. Seven reviewed Step 79A files: five new, two existing documentation files extended. All 232 unrelated baseline files, including every prior source/migration/artifact/manifest/lock file and development .env, remain unchanged.
- Branch remains dev-thaara-continuation at HEAD 4d3fc87bbe5564364bdcbc92e9172ce768c4ab30; all existing/new work is uncommitted and unstaged. No Git writes, runtime migration, installation, infrastructure/role change, real key/credential, provider/n8n API call or workflow modification.
- Logical key generations are provider-neutral lifecycle metadata; a later adapter must map them to explicit retained key resources/versions and enforce active-version-only encryption. No provider-specific rotation implementation, key creation or destructive lifecycle action is configured.
- SQL syntax, catalog permissions, forced RLS, real transactions and rollback remain UNVALIDATED by execution. Approve verified isolated PostgreSQL validation before Step 79B. No production cloud choice is needed now; production keys/credentials/live connections remain not_configured. Stop here.
