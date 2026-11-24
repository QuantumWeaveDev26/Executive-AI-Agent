# Step 76 — n8n integration foundation

Date: 17 October 2026. Workspace: C:\ThaaraProjects\thaara-ai-agent-v2. Branch: dev-thaara-continuation. HEAD preserved: 4d3fc87bbe5564364bdcbc92e9172ce768c4ab30. Existing uncommitted Steps 74–75 are retained.

## Completed scope

- Read AGENTS.md, Step 75 Gmail foundation and existing offline compose/dry-run/staging, approvals, execution leases, worker and receipt code.
- Confirmed the connected n8n plugin exposes read/create permissions. Read-only inventory returned 63 existing workflow names/IDs; no THAARA_V2_DEV_ prefix conflict.
- Created exactly one new, unpublished/inactive development bootstrap workflow, without credentials, expressions, provider nodes, schedules or webhooks. It has only Manual Test -> Synthetic Email Preview (Set). Synthetic recipient uses reserved example.invalid; no email delivery node exists.
- Workflow name: THAARA_V2_DEV_EMAIL_OFFLINE_3b163d305482ff8032657ced
- Workflow ID: bXk1oGwEpqig0677
- URL: https://n8n.srv1871828.hstgr.cloud/workflow/bXk1oGwEpqig0677
- Owner: Thaara AI V2 development, personal n8n project fn6pQNcDpG7hLM3t (Quantumweave academy). This bootstrap asset is not bound to a live application workspace and is never adopted by the application adapter.
- One-attempt journal was persisted before creation. Node validation and SDK validation passed before the single create_workflow_from_code call. ID was read back with get_workflow_details; active=false, activeVersionId=null, both nodes/parameters/connections match the synthetic artifact, zero credentials assigned. No workflow execution or publication occurred.
- n8n's creation tool adds availableInMCP=true discovery metadata. This does not activate or execute the workflow. The observed flag is explicitly recorded in the local bootstrap expectation; no external settings were changed. Application exports continue to reject unexpected discovery flags. Unknown execution settings, node settings, pinned/static data and credential fields fail closed.
- Existing names and active states remain unchanged. Two existing updatedAt values changed during read-only observation at 06:18:27Z and 06:25:24Z, both before the new workflow's creation at 06:29:53Z. Their cause was not determined; existing content was not inspected or restored. This task issued no existing-workflow mutation calls. Exact metadata observations are in the ownership journal.

## Backend connection and security

- New typed action automation.n8n.create_inactive_workflow: admin-or-owner, write/medium risk, explicit approval, mandatory idempotency, scoped audit and no automatic retries.
- New GET /api/v1/connectors/n8n/status returns not_configured by default. A server-supplied, workspace-specific transport is configured_unverified until a real action is independently read back. Codex's n8n plugin connection is separate from Thaara server credentials; no server credentials were configured.
- POST /api/v1/connectors/n8n/plans/:planId/steps/:stepId/create-inactive requires session authentication and CSRF. It verifies current workspace/user/role, bound approval/parameter hashes, ready step and verified same-plan staging dependency before invoking the existing executeGovernedPlanStep kernel.
- Existing plan creation/submission/approval routes remain the source of truth. Add the new action to a draft plan with parameters artifactId/workflowHash and a dependency on its staging step; submit and explicitly approve it, then use the dedicated manual route. Artifact IDs/hashes are deterministic from the existing staging proof. Client requests cannot provide n8n URLs, credentials, workflow IDs, settings, node graphs or activation flags.
- The kernel retains lease exclusion, live policy checks, approval binding, dependency proofs, cancellation, non-idempotent recovery, RLS and immutable persisted receipts. No separate ad-hoc receipt/approval store was introduced.
- n8n is manual-only in this foundation. Approval skips its background dispatch; the API background driver ignores it; API/worker kernels defer authoritative stored n8n actions before lease acquisition. Only the dedicated authenticated route opts into execution. This prevents configured API connections from racing unconfigured workers.
- The create-only adapter consumes an authoritative verified staging receipt; validates workspace/plan/parent IDs, artifact/input hashes and offline safety; then emits a fresh manual synthetic preview, exporting only hash binding/ownership markers. Original email contents, recipients, webhook/schedule blueprints and private parameters are not deployed.
- Workflow names are deterministic per workspace/plan/step/idempotency binding and always begin THAARA_V2_DEV_. Any existing name match stops creation without adoption, overwrite, rename, activation or deletion.
- HTTP transport accepts only a fixed trusted HTTPS server origin and a server-only secret resolver. Auth is in X-N8N-API-KEY headers only, redirects are refused, responses are bounded, inventory is paginated with a hard fail-closed limit, and requests have bounded timeouts. It exposes only create-new/list/read; no update/delete/activate/execute/credential-management methods.
- No API-key/credential is written to development .env, code, logs, artifacts or responses. No new credentials, packages, schema migrations or infrastructure setup.
- A create acknowledgement is insufficient. Verified receipts require exact ID/name, inactive/unpublished state, credential-free graph, expected settings and ownership-bound synthetic fields from readback. Mock receipts are labelled mocked_n8n_inactive_readback/mode=mock.
- Before POST, workflowCreated=false is truthful; after any ambiguous POST, malformed acknowledgement or failed readback it is null with terminal unverified status. No blind retry/reconciliation POST is allowed; an interrupted expired lease becomes unverified without calling n8n again.
- Gmail, Calendar, WhatsApp and phone execution remain not_configured. No real emails/messages/calendar events/calls, paid execution, activation or existing integration changes occurred.

## Focused verification

- Core focused run: 62/62 passed across four files (28 policy/adapter, 19 mocked HTTP, 14 authenticated API, 1 worker deferral).
- Added lease regressions: 2/2 passed; 14 unrelated API cases excluded by filter. These simulate contention/expired uncertainty only in isolated in-memory fixtures, not runtime PostgreSQL/Redis crash tests.
- Final policy suite after observed SDK discovery metadata: 29/29 passed, including the new explicit-expectation regression.
- Distinct new Step 76 checks covered so far: 65 passing, no unresolved failure (29 policy + 19 HTTP + 16 API + 1 worker).
- Contracts/policy targeted builds and API/worker typechecks passed. Test-first failures exposed missing implementation, fixture transition mistakes and review defects; all were corrected without weakening approvals or existing security assertions.
- n8n SDK workflow validation and both per-node validations passed; actual created workflow readback is verified independently, without execution.
- Security review found and verified fixes for unknown outcome truthfulness, strict readback, and manual dispatch. Final full verification passed; exact evidence is recorded below.

## Files changed in Step 76

- packages/contracts/src/n8n.ts
- packages/contracts/src/index.ts
- packages/policy/src/n8n.ts
- packages/policy/src/registry.ts
- packages/policy/src/adapter.ts
- packages/policy/src/index.ts
- packages/policy/test/n8n-foundation.test.ts
- apps/api/src/services/n8n-http.ts
- apps/api/src/routes/n8n.ts
- apps/api/src/routes/approvals.ts (new-action-only queue exception)
- apps/api/src/services/chat-automation-orchestrator.ts (manual-only fence/driver exclusion)
- apps/api/src/app.ts
- apps/api/test/n8n-http.test.ts
- apps/api/test/n8n-api.test.ts
- apps/worker/src/processor.ts (authoritative manual-only deferral)
- apps/worker/test/n8n-manual-only.test.ts
- docs/artifacts/step76-n8n-offline.workflow.json
- docs/artifacts/step76-n8n-offline.workflow-sdk.ts
- docs/integrations/n8n-step76-development-workflow.json
- docs/tasks/076-n8n-integration-foundation.md
- docs/THAARA_CONTINUATION_CHECKPOINT.md
- docs/requirements-traceability.md

## Limits and continuation

This is a create-only, manual, synthetic n8n foundation. It does not deploy the full original email automation graph or enable production/background provider execution. The bootstrap workflow is a development asset created under the user's explicit instruction, not an application workspace deployment or a fabricated application receipt. Do not recreate it; consult its journal before any future action.

Thaara still needs approved per-workspace server credential provisioning/managed secret storage, connection UI, and real provider setup plus separately approved sandbox verification. No live Gmail, Calendar, WhatsApp or phone node exists here. Do not enable general n8n edits, automatic execution or publishing in this foundation.

Step 74 advanced concurrency/crash-recovery testing and legacy Task 004 remain postponed, with their safety boundaries and all source work preserved.

Recommended Step 77: managed workspace connector secrets and a connection-management UI, followed by mocked provider integration. Ask before new credentials/schema/dependencies/external setup or any real provider authorization/execution.

Safety reference: [n8n creation/publishing documentation](https://docs.n8n.io/workflows/create/) states new workflows are unpublished by default. Creation and execution are separate operations. The connected plugin's SDK/node definitions supplied the exact node parameter schemas.

## Final verification and completion

- Step 76 foundation complete. pnpm.cmd verify ran once and exited 0: build, lint and typecheck passed; 449/449 tests passed across 35 files, 0 failed/skipped. Test-phase duration: 542.64 seconds. Log: ignored node_modules/.cache/step76/verify.log.
- Distinct focused Step 76 cases: 65/65 passed (29 policy, 19 HTTP, 16 API, 1 worker); no unresolved failure. Full verification includes them and existing Step 74–75 regression coverage.
- No isolated runtime PostgreSQL/Redis suite or crash/recovery test was run. The regular suite uses its existing isolated in-memory fixtures; no runtime migration, service change or live provider execution occurred.
- Final git diff --check and file-preservation checks passed. Exactly 22 Step 76 files were reviewed (10 modified existing, 12 new); all 199 unrelated baseline files and the development .env are unchanged. Generated-credential scan passed. Branch remains dev-thaara-continuation at 4d3fc87bbe5564364bdcbc92e9172ce768c4ab30; all changes remain uncommitted and unstaged.
- Thaara server credentials and live providers remain not_configured. Existing workflow timestamp observations and bootstrap ownership/readback evidence are recorded above and in the journal. Stop after Step 76; Step 77 recommendation and Step 74 postponement remain as documented.
