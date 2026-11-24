# Step 84 — Read-only connector diagnostics

Date: 17 October 2026 (Asia/Calcutta)
Status: COMPLETE — local metadata only; live provider/KMS health is not probed
Workspace: C:\ThaaraProjects\thaara-ai-agent-v2
Branch: dev-thaara-continuation
Unchanged HEAD: d3b2921d42e5581c1e1991a7cab5a63261a80b8e

## Implemented

- GET /api/v1/admin/connectors/diagnostics returns only enumerated local Gmail/n8n connection state, connection scope, storage kind/readability, KMS configuration and the latest safe local diagnostic code/time. No endpoint or workspace selectors, profiles, token/key identifiers, secrets or raw errors are returned.
- Reuses the actual GmailFoundation and n8n connection manager instances registered with the existing routes. Gmail remains scoped to the signed-in user; n8n is workspace-scoped. Existing connection/configuration/execution endpoints are preserved.
- Owner/admin checks, a dedicated typed read-only PolicyGateway action, and fresh session/workspace/role resolution inside scoped transactions run before collection and before releasing results. Authorization errors fail closed. Non-authorization reader failures become a safe per-connector unavailable result; the other connector remains visible. Responses use Cache-Control: no-store and Referrer-Policy: no-referrer.
- Durable n8n diagnostics call status only, which reads through the existing restricted workspace/RLS storage path without decrypting, wrapping, rotating or constructing a transport. Default runtime still has no durable dependency and remains not_configured.
- Existing local AES mock vaults report managed KMS not_configured. The durable test prototype reports mock_only, never production KMS readiness. Storage readable means a local metadata read completed, not that provider access or key unwrap was verified. Partial Gmail configuration reports storage not_checked.
- The existing dashboard now includes an admin-only card with per-connector connection/storage/KMS/last-result details, refresh, loading, safe error and empty states. Workspace/role keyed mounting and request generations prevent stale results from a previous context. Unknown diagnostic strings are never displayed verbatim.
- The latest result is generated on refresh; no diagnostic history is persisted and no connector state/audit mutations are introduced. Existing authentication may update session activity, as before. No real provider/KMS health probes are performed.

## Security and regression checks

- API tests exercise owner/admin access, member/viewer denial, anonymous rejection, policy denial, workspace header spoofing, query-target rejection, user-specific Gmail visibility, shared workspace n8n visibility, no provider calls or connector/audit writes, safe partial failure, invalid local metadata redaction and session revocation during collection.
- A negative legacy-transport case exposed a new diagnostic-labeling defect during implementation: a map key could point to a transport for another workspace. The reader now compares the transport workspace, matching the existing status endpoint. The regression failed before the fix and passes afterward. No existing workflow or execution behavior was changed.
- Durable reader unit tests use the existing scoped mock store to check metadata/KMS labels, no credential unwrap/wrap/provision/transport calls, unchanged ciphertext/audit, redacted storage failure, and workspace/role/session denial.
- UI tests cover admin visibility, meaningful storage/KMS/result labels, read-only controls, user-specific Gmail labeling, loading/error/empty states, unknown-string redaction, malformed timestamps and the authenticated GET helper.

## Files changed

- apps/api/src/app.ts
- apps/api/src/routes/connector-diagnostics.ts (new)
- apps/api/src/routes/gmail.ts
- apps/api/src/routes/n8n-connections.ts
- apps/api/src/routes/n8n.ts
- apps/api/test/connector-diagnostics.test.ts (new)
- apps/api/test/connector-diagnostics-durable.test.ts (new)
- apps/web/src/App.tsx
- apps/web/src/ConnectorDiagnostics.tsx (new)
- apps/web/src/connector-diagnostics-api.ts (new)
- apps/web/test/connector-diagnostics.test.tsx (new)
- packages/contracts/src/index.ts
- packages/contracts/src/connector-diagnostics.ts (new)
- packages/policy/src/registry.ts
- docs/requirements-traceability.md
- docs/tasks/084-connector-diagnostics.md (new)

## Actual verification

- Initial expanded focused run: 78/78 passed in 6 files (diagnostic API, durable reader and UI plus existing Gmail API, n8n connection API and policy registry regressions).
- Final new diagnostic suites: 25/25 passed in 3 files (14 API, 3 durable metadata reader, 8 UI/helper); 0 failed, 0 skipped. These overlap the earlier run and are not additive totals.
- Focused API typecheck passed. A web typecheck found an unused React import, which was removed; final verification passed type checks for every package.
- Independent static security review: no actionable findings beyond the separately recorded legacy-transport regression fix.
- pnpm.cmd verify: PASSED in one invocation. Build, lint and typecheck passed; 590/590 tests in 46 files, 0 failed, 0 skipped (560.82 seconds for the test stage). PostgreSQL runtime suites were not invoked.
- git diff --check, generated test-credential scan and new-file whitespace checks passed. All 245 starting files outside the eight intended existing-file edits remain byte-for-byte unchanged, including existing connector security services, Steps 81–83 task reports and migration/dependency files. Development .env matches its approved snapshot.

## Preservation and limitations

Preserve all uncommitted Steps 81–83 work. Starting hashes cover 253 existing files. No Git writes, migrations, packages, credentials, .env changes, external calls or n8n workflow changes were made. No PostgreSQL runtime suite or temporary grants were needed or requested: existing RLS/SQL is unchanged; new API checks use isolated in-memory PGlite, and durable-reader checks use mock storage. Previous PostgreSQL grant approvals were not reused.

Diagnostics describe current local metadata, not end-to-end provider health or cloud KMS availability. Mock connections remain clearly labeled; live integrations are not configured. Last-result history is not persisted. Step 74 advanced crash testing and legacy Task 004 remain postponed.

Recommended Step 85: add the Gmail account connection/read-search screen using the existing mocked OAuth foundation and tested diagnostics; keep real Google access and sending disabled pending separate approval.
