# Step 78 — durable connector security preparation

Date: 17 October 2026. Workspace: C:\ThaaraProjects\thaara-ai-agent-v2. Branch: dev-thaara-continuation. Preserved HEAD: 4d3fc87bbe5564364bdcbc92e9172ce768c4ab30. All uncommitted Steps 74–77 are retained.

## Completed authorized scope

Read AGENTS.md, Step 77 report, encrypted mock vault/manager, current transaction wrapper, audit repository and relevant existing SQL authorization patterns. Designed and implemented reusable server-only credential-envelope and connection-state contracts with isolated mock-backed tests.

Added ConnectorKeyService, ConnectorStateStore, credential envelopes, workspace/connector/profile/revision binding and a versioned AES-256-GCM envelope cipher. A fresh 256-bit data key encrypts each credential; only wrapped data keys and ciphertext enter storage. The key service must authenticate the same context. Data keys and mutable plaintext buffers are cleared on completion where possible; immutable JavaScript strings and runtime copies cannot support a complete memory-erasure guarantee.

Added DurableN8nSecurityPrototype: explicitly mock-only, not imported by buildApp, routes or workers. It reuses existing n8n PolicyGateway actions and authenticated scope. Status is labelled mock_restart_simulation/configured_unverified, never production persistence or verified provider connectivity. Default remains not_configured. Managed store/key adapters are rejected by the prototype.

State transitions compare an expected monotonically increasing revision. Record and safe audit must commit atomically. Disconnect persists an envelope-free tombstone instead of deleting/resetting the revision. Two reconstructed instances consult the same store and reject stale bindings. Authorization is refreshed by every repository operation, including after key unwrapping. Public methods pin authenticated subject and access bindings before awaited work; envelope fields are also snapshotted before unwrap.

Credential resolution is server-internal and performs no provider operation. Any future live adapter must continue through the existing approved artifact, PolicyGateway, explicit approval, lease/idempotency and receipt kernel, checking the durable fence again after provider work. This module introduces no alternate execution route.

The connector namespace supports n8n, Gmail, Calendar, WhatsApp and phone envelope isolation; only n8n has this prototype coordinator. These are workspace-admin shared connection contracts, not an implementation of those provider integrations. They must not replace Step 75's per-user Gmail OAuth vault without a separate principal/account binding design.

## Tests and review

- Initial test-first collection failed because the new implementation modules did not exist.
- Initial new suite: 26/26 passed. Combined with Step 77: 64/64 across four files; API typecheck passed.
- Independent security review found a mutable access-binding race. A delayed unwrap regression reproduced release of an old synthetic credential after a caller changed the final revision check.
- A related red regression reproduced an asynchronous provisioning callback mutating the caller-owned authenticated scope and retargeting a secret to another workspace.
- Fixed both by taking frozen value snapshots at public method entry; cipher.open also snapshots its envelope before awaited unwrap.
- Final focused suite: 66/66 passed across four files, 0 failed/skipped (28 new Step 78 + 38 existing Step 77). API typecheck passed.
- Security re-review confirmed both fixes and no remaining blocker in the authorized mock-only scope.
- Coverage includes reconstructed-instance/snapshot restart simulations, persistent disconnect tombstones, no-ABA revisions, competing configuration commits, cross-instance stale access, delayed decryption, revoked sessions/roles, cross-workspace profiles/records, key outages/tampering/version selection, rollback on failed atomic commits and bounded revisions.
- Mock snapshots contain ciphertext/envelope metadata and safe audit, not raw credentials/master keys. Synthetic-only test values and generated test keys never leave tests.

These tests do not establish actual OS-process restart recovery, PostgreSQL RLS, multi-process transaction isolation, durable managed KMS storage or operational backup recovery. No runtime database/Redis suite is run in this step.

## Exact proposed persistent storage — approval required, not implemented/applied

Use the existing PostgreSQL architecture; no additional Redis queue, lock server, local credential file or SQLite store is required.

One additive table is proposed: public.workspace_connector_connections.

| Field | Proposed requirement |
| --- | --- |
| workspace_id | UUID, required, references existing workspaces |
| connector_key | Text allowlist: n8n/gmail/calendar/whatsapp/phone |
| revision | BIGINT, required, range 1..9007199254740991, monotonically increased only |
| status | configured_unverified or disconnected; no fabricated connected/verified state |
| profile_id | Safe server-defined profile identifier, nullable only for a tombstone |
| credential_envelope | JSONB containing exactly version/keyId/wrappedKey/iv/tag/ciphertext; nullable only for tombstones |
| updated_by_user_id | Existing user FK, derived from authenticated scope; nullable after user deletion |
| created_at / updated_at | Required server timestamps |

Composite primary key: workspace_id + connector_key. Check constraints enforce valid revision, connector/status, bounded envelope fields and paired profile/envelope presence. No plaintext token column. Disconnect clears the current envelope but retains the row/revision. Physical connection-row deletion/revision reset is forbidden to application/worker roles. Workspace deletion and backup restoration require a separate lifecycle/recovery policy.

Two restricted routines are proposed:
1. read_workspace_connector_connection(connector_key): derive workspace/user/role from current_authenticated_scope; require fresh matching owner/admin membership and session, return only that workspace's record to server code.
2. commit_workspace_connector_connection(connector_key, expected_revision, next_status, profile_id, envelope): derive workspace and actor; validate current authorization and the approved server profile; lock authenticated membership/session and the scoped connection key; compare missing=0/current revision; increase by exactly one; commit state and a derived safe event in the existing audit_events ledger together. Conflict writes neither. Disconnect never needs KMS/decryption.

The future adapter must use withScopedTransaction and bound SQL parameters. Use a consistent transaction lock for the workspace+connector key, including the initially missing row, plus row locks for existing state; an additive transaction advisory lock can serialize first creation. Keep locks through authorization, compare/update and audit insertion. No process-local epoch or Redis cache may authorize a credential independently of this record. Failed transactions must roll back both mutations; a failed disconnect is not a successful revocation and must be reported/recovered truthfully.

Enable AND FORCE RLS on the new table, based on current_authenticated_scope (token-bound), explicit workspace equality and current admin/owner authority. Do not rely solely on caller-set workspace GUCs. Revoke inherited/default broad table grants (including existing thaara_app default privileges) from PUBLIC/app/worker/admin roles for this table.

A dedicated NOLOGIN guard/owner role with least-privilege table/audit access is proposed for restricted SECURITY DEFINER routines, with a fixed safe search_path and EXECUTE revoked from PUBLIC. Grant only the necessary routine entry points to existing app role; do not grant worker credential reads until a separately approved governed-execution authorization design exists. No new login password is required for this guard role. Exact SQL, ownership and grant changes require approval and security review before creating a migration.

No existing tables, migration files, grants, roles or database data were changed here. The blueprint is documentation only.

## Exact key-management and operational requirements — approval required

- Select an existing approved managed KMS/key-wrapping resource, or approve provisioning one in a chosen account/project, region and environment. A persistent managed wrapping key must survive application restarts and backups; raw master keys must never live in source, browser, logs, database or development .env.
- Use managed workload identity where available. Grant only the required wrap/unwrap operations on that key, authenticated to workspace/connector/profile/revision context; separate key administration/rotation from application decryption permissions.
- Store only the opaque key version/reference and wrapped data key with ciphertext. Support decrypting retained key versions during rotation. Define retention/revocation, key deletion protection, monitoring and outage behavior. Never fall back to plaintext, a locally generated restart key, or another workspace's key.
- Define TLS, backups, retention, restore drills and KMS/key-version access together. A database backup can retain old encrypted credentials: deleting the current row/envelope is not cryptographic erasure. Restoring older revisions must not resurrect revoked access; an approved restore protocol must advance/invalidate all connector revisions before serving requests and reconcile key/provider revocation.
- Configure trusted workspace-specific n8n origins, project ownership and profile mapping server-side. The personal Step 76 development bootstrap is not automatically production tenant ownership. Do not copy Codex credentials into Thaara.
- No real n8n/API/provider credential is needed for this prototype. Any later production credential provisioning, provider authorization, project mapping or infrastructure change requires separate explicit approval. Never request raw credentials in chat or UI forms.
- Before live use: implement and test the approved PostgreSQL adapter/routines and managed key adapter; isolated real PostgreSQL RLS/CAS/rollback/session-revocation tests, true process restart/crash testing, provider uncertainty handling and governed transport integration are required. Current JavaScript mock atomicity is not evidence for those guarantees.
- Already-started provider operations cannot be recalled by checking a revision afterward. Non-idempotent uncertain outcomes must remain unverified; no blind retry or historical success fabrication.

## Files changed

- apps/api/src/services/connector-security.ts (new)
- apps/api/src/services/durable-n8n-security.ts (new)
- apps/api/test/helpers/durable-connector.ts (new, mock adapters only)
- apps/api/test/durable-connector-security.test.ts (new)
- docs/tasks/078-durable-connector-security.md (new)
- docs/THAARA_CONTINUATION_CHECKPOINT.md
- docs/requirements-traceability.md

## Approval boundary and continuation

Step 78 delivers the reusable design/mock contracts only. Persistent production connections are not configured. No new infrastructure, migration, database role/grant, key resource, credential, dependency or external workflow operation was created or applied.

Approval requested before Step 79: the documented additive PostgreSQL table, restricted routines/RLS/NOLOGIN guard-role design and an identified managed key-service target/identity setup. Review actual migration SQL and infrastructure changes after that scope is approved, before applying them to explicitly authorized isolated targets. Real n8n/provider credentials and live wiring remain a separate approval.

Step 74 advanced crash/concurrency testing and legacy Task 004 stay postponed. Steps 74–77, .env, existing workflows, credentials and executions remain untouched by this step. No n8n or provider tool calls were made. Stop after final verification; do not start Step 79 or approved-infrastructure work automatically.

## Final verification and status

- Step 78 preparation is complete within its authorized interface/design/mock scope. Production persistence, managed keys, RLS and runtime wiring remain not_configured and blocked pending approval.
- pnpm.cmd verify ran exactly once, exit 0. Build, lint and typecheck passed; 515/515 tests across 39 files passed, 0 failed/skipped. Test-phase duration: 359.85 seconds. Ignored log: node_modules/.cache/step78/verify.log.
- Final focused verification: 66/66 across four files (28 new Step 78 +38 Step 77), no failure/skips. API typecheck passed. Both reproduced asynchronous mutation regressions were fixed and security re-reviewed; no unresolved test failure.
- Final git diff --check, new-file whitespace and generated-secret scans passed. Exactly seven Step 78 files reviewed (five new, two existing documentation files extended). All 227 unrelated baseline files, including every Step 74–77 source file, migration, package manifest/lock, workflow artifact and ownership journal, remain byte-for-byte unchanged. Development .env hash unchanged.
- Branch: dev-thaara-continuation. HEAD: 4d3fc87bbe5564364bdcbc92e9172ce768c4ab30. All work remains uncommitted and unstaged. No external calls, infrastructure, credentials, dependency installations, new migration files, runtime migrations or database role/grant changes.
- Stop here. Approval requested for the documented PostgreSQL schema/RLS/routines/NOLOGIN guard role and an identified managed key-service/identity target before Step 79. Real provider credentials, live activation and advanced Step 74 crash testing are not authorized by this preparation.
