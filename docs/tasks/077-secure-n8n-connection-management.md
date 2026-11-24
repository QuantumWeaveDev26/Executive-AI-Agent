# Step 77 — secure n8n connection management

Date: 17 October 2026. Workspace: C:\ThaaraProjects\thaara-ai-agent-v2. Branch: dev-thaara-continuation. Preserved HEAD: 4d3fc87bbe5564364bdcbc92e9172ce768c4ab30. All existing uncommitted Steps 74–76 are retained.

## Scope and ownership

Read AGENTS.md, Step 76 report, relevant connector/policy/session/audit code and existing web components. The user requested implementation directly with an internal plan: add a simple admin screen, safe local configuration interfaces and mocked server secrets; preserve every external n8n resource.

Three read-only n8n calls verified ownership: search_projects returned authorized personal project fn6pQNcDpG7hLM3t (Quantumweave academy); search_workflows filtered by that project returned workflow bXk1oGwEpqig0677; get_workflow_details confirmed the same Step 76 name, inactive/unpublished state and unchanged createdAt/updatedAt of 2026-10-17T06:29:53.588Z. Its version remains 7c9a05be-b5ad-4695-93fb-600ea64a3eff. This ownership is suitable for the existing development bootstrap only; it does not establish production multi-tenant project ownership. No workflow, credential, execution, project or setting was written, created, activated or executed in Step 77.

## Implemented

- Admin/owner-only GET, PUT and DELETE /api/v1/connectors/n8n/connection with shared typed contracts, authenticated session scope, CSRF for writes, fresh membership checks, PolicyGateway and scoped RLS audit events.
- Browser configuration accepts only an approved server profile ID, never an endpoint, credential, token or secret reference. Raw extra fields are rejected before Fastify can silently strip them.
- Server-only workspace-partitioned AES-256-GCM vault with dedicated ephemeral encryption key and authenticated partition binding. Only ciphertext is retained in its injected mock map; there is no plaintext credential or key in UI, logs, API responses, audit or source.
- The server defines each profile's workspace and safe display name. Workspaces cannot enumerate or select another workspace's profile. Another authorized admin in the same workspace sees its shared local connection.
- Test-only profile configuration remains configured_unverified/mode=mock. Default runtime reports not_configured, storage=unavailable, managementEnabled=false and no profiles. Mutations fail closed without provisioned safe storage; no mock is silently enabled in development or production.
- Reused existing governed Step 76 export path by resolving its transport through the manager. Legacy explicit server transports remain supported; conflicting old/new sources are rejected. Export approval, idempotency, dependency proof, lease and truthful receipt checks are unchanged.
- Configuration fences old transports immediately and publishes a replacement only after the success audit commits and its revision is rechecked. Failed audit/configuration cannot leave a usable new connection.
- Local disconnect removes the workspace's injected mock profile secrets and connection selection before audit; increments its revision; rejects stale secret resolvers and delayed transport results. It never revokes or modifies n8n credentials remotely. Reconnection after local forgetting requires server-side mock reprovisioning.
- Added a simple connection card using existing button/card/badge styling. Admins see status, approved profile selection, local disconnect, loading/error/empty states and refresh. Other roles see an access boundary. No password/token input, external account URL or live setup is provided. Workspace/role changes reset the keyed screen and ignore stale request results.

## Focused evidence and review

- Initial test-first API checks failed with missing routes; foundation/view test modules initially failed to resolve the not-yet-created implementations. A fixture-only table name was corrected to existing memberships.
- First focused suite: 30/30 passed (15 service/vault, 10 API, 5 rendered UI).
- Expanded API coverage reproduced an unsafe 200 response for extra credential fields; explicit preValidation now returns 400 without echoing input.
- Affected Step 76 plus Step 77 checks: 102/102 passed across 7 files (65 existing Step 76 + 37 new).
- Security review found an audit publication race; a paused/rejected success-audit regression failed before the fix. Final new focused suite: 38/38 passed (16 service/vault, 17 API, 5 rendered UI), no unresolved failure.
- API typecheck passed. Web typecheck found an unused React import; the existing React reference was made explicit. Final verification follows below.
- Independent read-only security re-review confirmed strict raw input rejection, publish-after-audit ordering and no remaining blocker within mock-only scope.
- Tests use existing isolated PGlite fixtures and mocked transports; no runtime PostgreSQL/Redis suite, real provider call, runtime migration, dependency installation, external setup or Git mutation occurred.

## Files changed in Step 77

- apps/api/src/services/n8n-connections.ts (new)
- apps/api/src/routes/n8n-connections.ts (new)
- apps/api/src/routes/n8n.ts
- apps/api/src/app.ts
- apps/api/test/n8n-connections.test.ts (new)
- apps/api/test/n8n-connection-api.test.ts (new)
- apps/web/src/n8n-api.ts (new)
- apps/web/src/N8nConnection.tsx (new)
- apps/web/src/App.tsx
- apps/web/test/n8n-connection.test.tsx (new)
- packages/contracts/src/n8n.ts
- packages/policy/src/registry.ts
- docs/tasks/077-secure-n8n-connection-management.md (new)
- docs/THAARA_CONTINUATION_CHECKPOINT.md
- docs/requirements-traceability.md

## Limits and next step

The secure mocked foundation is implemented; a live connection is not configured. Durable managed secret storage, key management, workspace-specific production profiles/credentials and any needed infrastructure require separate approval. No credentials were collected or provisioned. The connected Codex account is not imported into Thaara.

Epochs and selections are process-local test infrastructure; they do not provide distributed fencing or durable disconnect across restarts. Disconnect blocks new calls and withholds delayed results but cannot cancel an external operation that already started. Live wiring must remain disabled until durable revisions, distributed fencing, an approved cancellation/uncertainty model and operational secret provisioning are implemented and tested.

Step 74 advanced concurrency/crash recovery and legacy Task 004 remain postponed. Existing Gmail/n8n/offline foundation work and development .env are preserved.

Recommended Step 78: approve and implement managed workspace connector secret storage and durable connection revisions before any real credential setup or live n8n use. Keep all providers and workflows inactive until separately authorized.

## Final verification and completion

- Step 77 secure mocked foundation is complete. pnpm.cmd verify ran exactly once, exit 0: build, lint and typecheck passed; 487/487 tests across 38 files passed, 0 failed/skipped. Test-phase duration: 394.22 seconds. Ignored log: node_modules/.cache/step77/verify.log.
- New focused coverage: 38/38 passed (16 service/vault, 17 API, 5 rendered UI). All 65 affected Step 76 checks also pass in final verification. Earlier test-first failures, strict-input regression, audit-race regression and the unused-import typecheck failure are resolved; no unresolved failure.
- Final git diff --check, new-file whitespace and generated-secret scans passed. Exactly 15 Step 77 files reviewed: 7 existing files extended, 8 new. All 214 unrelated baseline files remain byte-for-byte unchanged, including Step 74 source/settings, Gmail and Step 76 workflow artifacts/journal; development .env hash unchanged.
- Branch remains dev-thaara-continuation, HEAD 4d3fc87bbe5564364bdcbc92e9172ce768c4ab30. Existing and new work remains uncommitted and unstaged. No runtime database/Redis operations, migrations, installations, real account access, messages, paid calls or external n8n writes were performed.
- Live n8n storage/credentials/providers remain not_configured. Stop after Step 77. Step 78 requires approval for managed durable secrets and revisions before any live wiring.
