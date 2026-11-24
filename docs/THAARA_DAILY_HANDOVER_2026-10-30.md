# Thaara checkpoint — 30 October 2026

Latest continuation: [31 October checkpoint](THAARA_DAILY_HANDOVER_2026-10-31.md). Read it first; the entries below are retained history.

## LATEST — 31 Oct: owner set first-live daily call limit to 5

Owner instruction: "make it as five". `DEFAULT_DAILY_CALL_LIMIT` in `phone-calling.ts` 3 -> 5; runtime loader default `THAARA_PHONE_DAILY_CALL_LIMIT` 1 -> 5 (still 1-20, explicit env overrides). Docs updated (runtime/recovery doc, go-live package: the test-call approval still covers one call only). Fresh: API typecheck OK; 16 API phone test files 124/124; `git diff --check` OK. No external access. Owner is checking Sarvam (outbound permission, 5-min on v2, prepaid balance).

## LATEST — Claude: secure Sarvam runtime loader, callback/result review, recovery plan (local only)

Branch dev-thaara-continuation, HEAD 413f5a5, dirty work preserved; no database, VPS, provider, credential or call touched; nothing committed or deployed.
- New `apps/api/src/services/phone-sarvam-runtime.ts` (`loadSarvamRuntime`, `parseSarvamRuntimeProfile`): explicit `THAARA_PHONE_LIVE_CALLING=approved` switch; non-secret profile file must be `reviewOnly:false`/`runtimeProfile:true` with `verifiedMaxCallLengthMinutes` equal to required (5) and exact `call_purpose`/`user_name` mapping; API key and webhook secret from absolute private files (no group/other bits), re-read on each use; https callback origin; daily limit 1-20, default 1. Reason codes only, never values. Checked-in review profile is refused (`profile_not_runtime`, `duration_not_verified`). NOT wired into startup; buildApp test-only guard unchanged.
- Tests (fresh): `phone-sarvam-runtime` 5/5; all 16 API phone test files 124/124; API typecheck OK; `git diff --check` OK; vite.config unchanged. Web not changed or rerun this step; full API suite not rerun.
- Review/plan doc: [PHONE_RUNTIME_SECURITY_AND_RECOVERY.md](integrations/phone/PHONE_RUNTIME_SECURITY_AND_RECOVERY.md) — callback/result review (no code defects found; residual risks: unsigned webhook first-writer, en_text vs original-language not comparable, recipient number not cross-checked), backup + isolated restore + 110a->110c order + phone-only rollback plan, documented-vs-verified Sarvam table, six approval boundaries.
- Team Sync (owner-approved): project "Thaara AI V2" created; stages Platform & Chat, Gmail & Calendar, WhatsApp confirmed; Phone calling in progress; two progress updates posted.
- Next: owner confirms in Sarvam (outbound permission, 5-min on v2, prepaid balance); then approvals per boundary list.

## LATEST — ONE approved full disposable PostgreSQL acceptance run PASSED8/8; cleaned

Owner explicitly approved one exact command `node scripts/phone-postgres-runtime.mjs --approved-isolated-phone110` with fake providers only,
base12/test role/unchanged110a–110c, stop on unexpected failure, exact owned cleanup. All13 acceptance-v1 artifact hashes and base12 manifest
matched before execution; all13 matched again afterwards. Actual isolation preflight and per-phase ownership/mount/network/loopback checks passed.
**Migrations110a,110b,110c APPLIED successfully** after twelve approved base migrations/test-role setup. **8/8 tests PASSED,0 failed,0 skipped,
one file, success=true, process exit0.** No error/SQLSTATE reported. No automatic retry, repair, source/SQL change or external provider contact.

All eight reviewed cases passed: restricted application role/forced RLS; same-workspace peer and foreign-workspace isolation; independent-service
competition for final daily slot with replay/no redial; fresh-pool persistence and rolling-window budget; archived-contact fence; audit failure
rolls back claim with zero provider requests; correlated date/slash callbacks with unverified recipient evidence; missing review acknowledgement
refused. No individual durations captured; statuses supported by exact pinned eight-case inventory plus aggregate8/8/no skips.

**Independent cleanup verified:** exact run container `4ca8b7bca2395e0b8c1dde7c081b51e5510755deaa26807a2d92a783dcff06e9` destruction event observed;
network `b93e7f167a9c090be947b16f48fcb714b836ac6d08497bab7f2791a3155e99b0` and named fixture container/network absent;127.0.0.1:15435 free.
Only run-created IDs/labels selected. Existing databases/volumes/credentials/services/VPS/Sarvam inbound/WhatsApp/n8n/production untouched.
No deploy/commit/push/service restart/provider activation/real call. Branch dev-thaara-continuation/HEAD413f5a5; pre-existing dirty work preserved.
Evidence: `node_modules/.cache/phone110-runtime/acceptance-v1-evidence.json`, `results.json`, `isolation.json`, `acceptance-cleanup.json`.
Prior73/73 database-free results remain unchanged historical evidence and were not rerun for this milestone.

**Remaining live gates:** secure runtime/managed-secret configuration and controlled live-switch implementation (production guard still refuses
liveCalling/reportVoice), verify exact existing Sarvam v2 outbound permissions/duration/billing privately, callback token/logging security,
persistent database backup/isolated restore/recovery review and separately approved migration, reviewed deployment, then separately approved
one-owner-number controlled call. No new agent/number/setup repetition. Keep existing inbound untouched. Production managed-service requirements
still apply; disposable local acceptance does not authorize a shared pilot migration, deployment, credentials change or real call. One-run grant consumed.

## LATEST — remaining full disposable acceptance scope prepared; awaiting explicit approval

After successful110a/cleanup, owner said `continue`. Prepared one concrete approval request without extending the previous one-run/110a-only grant.
No infrastructure/SQL/runtime execution this preparation. All13 source pins and base12 manifest rechecked unchanged; historical73/73 tests reused.
Proposal: `node scripts/phone-postgres-runtime.mjs --approved-isolated-phone110`, one fresh isolated fixture on127.0.0.1:15435 with same ownership,
internal network/tmpfs/credentials/checks/timeouts/cleanup, base12+test role+unchanged110a/b/c, eight existing synthetic-only acceptance tests.
New request-only pins: `PHONE_POSTGRES_RUNTIME_APPROVAL.acceptance-v1.json`; runtimeExecutionAuthorized=false. Stop on unexpected failure,
no SQL edits/automatic retries. Exact scope in `PHONE_POSTGRES_RUNTIME_APPROVAL.md`. Need explicit owner approval before execution.
No live/provider/production/integration changes, deploy/commit/push. Branch dev-thaara-continuation/HEAD413f5a5; dirty work preserved.

## LATEST — ONE approved lifecycle-v1 diagnostic retry: 110a APPLIED; owned cleanup verified

Owner explicitly approved exact command `node scripts/phone-postgres-runtime.mjs --approved-diagnostic-phone110`, once, through110a only.
All13 `PHONE_POSTGRES_RUNTIME_APPROVAL.lifecycle-v1.json` artifact hashes matched before execution and again after. No source/SQL change.
Actual preflight and pre-110a recheck PASSED with the unchanged ownership/network/mount/permissions/loopback guards. Fresh temporary credentials,
one new internal network/container, read-only root/tmpfs-only approved storage,127.0.0.1:15435 only. Twelve pinned base migrations and fresh
test-role provisioning completed. **Unchanged110a applied successfully**; process exit0. Diagnostic phase `migration`, SQLSTATE=null because
success, category=`none`, elapsed79ms, pool counts total1/idle0/waiting0. Context: baseMigrationCount12, review_acknowledged/target_matches/
scope_function_exists/audit_table_exists/is_superuser all true; contacts_already_exist=false before application. No invented prior-error diagnosis.

**Stopped as approved:**110b/110c NOT attempted;0/8 acceptance tests. No runtime results.json exists. This confirms110a installability in the
isolated fixture, not its RLS/concurrency acceptance, full phone schema readiness, production deployment or live calling readiness.
Evidence: `node_modules/.cache/phone110-runtime/diagnostic-lifecycle-v1-evidence.json`, `diagnostic.json`, `isolation.json`, `diagnostic-cleanup.json`.
Existing73/73 database-free tests are unchanged historical evidence, not re-run during this infrastructure diagnostic.

**Cleanup independently verified:** exact run container `9fe893d6fa8b3ed705f495b5d00f834104a39cbc0d5b660fdc3c9e88e32d3938` destruction event observed;
network `ccfce52513b2ab72e17ab8a3d8244ad5c8e4876755f40afe658aac71eab925e9` and named fixture container/network absent;127.0.0.1:15435 free.
Only run-created IDs/ownership labels selected by cleanup. No existing databases, volumes, services, Sarvam inbound, WhatsApp, n8n or production
changes; no deploy/commit/push/provider activation/credential changes/real calls. Branch dev-thaara-continuation, HEAD413f5a5; dirty work preserved.
One-run approval consumed. **Next blocker/approval:** a separately approved disposable full phone-schema validation including110b/110c and the
eight acceptance tests. Do not run it, retry, change SQL or infer permission from110a success. Live configuration/deployment/calling remain gated.

## LATEST — owner-approved fixture lifecycle correction implemented; database retry NOT authorized

Owner `PROCEED` approved only the proposed fixture-code correction and database-free verification. New `phone-fixture-session.mjs` verifies before
creating any pool, pins a dedicated client through each base/migration phase, awaits actual client shutdown, discards the session and closes the pool
before the next blocking inspection. Same max1,5000ms connect,30000ms server statement,45000ms client query and10000ms default idle deadlines;
relay30000ms unchanged. Every prior isolation check/ownership cleanup remains; no failed SQL replay. Diagnostic mode still stops after110a on either
outcome. Allowlisted Node transport codes/driver messages produce enums; valid PG SQLSTATE takes precedence over message text; no raw error fields.
Diagnostics include bounded elapsed time and sanitized pool counts. Session errors between operations and cleanup failures surface, not success.

**Fresh verification:73/73 passed,0 failed**:12 lifecycle,12 fresh-session,16 diagnostic,33 unchanged inspector tests (`phone-session-final.json`).
Synthetic tests exercise the corrected helper with the installed pool. Explicit client shutdown has a delayed-completion/failure regression test.
Three syntax checks and whitespace check passed. Focused read-only review found no consequential issue; requested context-query failure test added.
Seven unchanged prior pins match: inspector/tests, relay, acceptance suite,110a/b/c SQL. New13-artifact pins:
`docs/integrations/phone/PHONE_POSTGRES_RUNTIME_APPROVAL.lifecycle-v1.json`. Prior manifests preserved; runtimeExecutionAuthorized=false.

No Docker commands/infrastructure, sockets/listeners, SQL, runtime runner, production/provider access, deploy, commit/push or calls this session.
Branch dev-thaara-continuation, HEAD413f5a5; unrelated dirty work and vite.config.ts preserved. Previous exact historical error still unknown;
this correction is not runtime/schema acceptance. **Next approval boundary:** one new isolated diagnostic-only run on127.0.0.1:15435, pinned base12
plus unchanged110a only, stop/cleanup after either outcome.110b/110c/eight tests remain excluded. Do not start it without fresh explicit approval.

## LATEST — approved database-free lifecycle investigation completed; correction pending approval

Added only `scripts/phone-fixture-lifecycle.test.ts` and investigation/checkpoint documentation. **48/48 tests passed**:11 new lifecycle tests,
33 existing inspector tests and4 diagnostic tests (`phone-fixture-investigation.json`). No Docker operations, connections/listeners, SQL, runtime
runner, provider or production access. Runner/helper/inspector/relay/migrations remain identical to the diagnostic approval manifest.
With real installed pg-pool and synthetic clients, confirmed: blocking the event loop postpones idle eviction; nextTick checkout cancels an overdue
idle timer and reuses the client; queued transport expiry then fails the operation without SQLSTATE. Normal idle expiry reconnects; closing the pool
before inspection and creating a new one afterwards avoids this in the model with unchanged timeouts. Pinning alone does not fix relay expiry.
**Historical cause still unconfirmed:** actual pg read-timeout also has no SQLSTATE; earlier generic client category cannot identify its exact error.
Do not label this as a confirmed PostgreSQL/SQL defect or actual runtime success.
Exact proposal in `docs/integrations/phone/PHONE_FIXTURE_LIFECYCLE_INVESTIGATION.md`: close admin before blocking guards, reopen only after all pass,
pin one client across phase acknowledgement/context/migration, retain every timeout/guard, no replay, and allowlisted client-error diagnostics.
**Not implemented:** owner requires explanation before lifecycle correction. Next boundary: owner approval for this fixture-only correction and
database-free verification; no new PostgreSQL retry/SQL/infrastructure permission implied. Branch dev-thaara-continuation/HEAD413f5a5, dirty work
preserved, vite.config.ts untouched; no commit/push/deploy/call or integration changes.

## LATEST — one approved diagnostic-only 110a retry completed; STOPPED

Owner authorized one fresh local disposable diagnostic, unchanged SQL/isolation checks, stop at 110a, no later migrations/tests.
Added a diagnostic-only runner flag `--approved-diagnostic-phone110` and secret-safe helper; it cannot enter the 110b/110c/test branch.
New checksum manifest: `docs/integrations/phone/PHONE_POSTGRES_RUNTIME_APPROVAL.diagnostic.json`. Preserved inspector-v3/original manifests.
All seven non-runner inspector-v3 artifacts match their recorded hashes, including all SQL, inspector, 33 teAsts, relay and eight-test suite.
Database-free validation: **33/33 original guard tests + 4/4 diagnostic tests passed** (`phone-diagnostic-unit.json`); both runner/helper syntax checks passed.

**Actual retry:** full actual-mount/network/identity preflight PASSED, including recheck at 110a. Twelve pinned base migrations and fresh test-role
setup completed. Diagnostic FAILED at **acknowledgement**, before its context query and before executing 110a SQL. **SQLSTATE: null (not supplied)**;
sanitized category `client_transport_or_runner_error`; sourceLine/context null. This run establishes a client/connection/runner failure rather than
a PostgreSQL-reported rejection of 110a SQL. It does not prove that 110a SQL would succeed. No 110b/110c and **0/8 runtime acceptance tests**.
Evidence: `node_modules/.cache/phone110-runtime/diagnostic.json` and `isolation.json`. No SQL changed; no automatic retry.

**Root cause:** exact cause remains unconfirmed. Suspected timeout/stale-connection interaction: synchronous Docker metadata inspection runs
between use of the existing max:1 PostgreSQL pool and the next query, while the local binary relay has a 30-second idle timeout. Blocking inspection
can delay socket/timer processing. The diagnostic intentionally retained no raw exception messages and cannot distinguish individual client errors.
Do not claim a syntax, JSONPath, RLS, missing-role or PostgreSQL validation problem from this evidence.
**Minimum proposed next step (not implemented):** database-free reproduction of that timeout interaction; narrowly classify allowlisted client
errors without copying raw messages. If confirmed, adjust only fixture connection lifecycle/inspection ordering while retaining every guard and
timeout. No SQL correction currently justified. Any new infrastructure/SQL diagnostic run needs separate owner approval; 110b/110c/eight tests
remain outside this diagnostic approval even if a later 110a succeeds.

**Cleanup verified:** exact owned container `e29f9d1806707dadef139bd3d14937e8bb04f24ce45f7eaf3a4f026ca8323ddb` destruction event observed;
network `5eaba85dd0d2280a39532cf8a346f34b2365e392579cc3577775926e548a6bc5` and named container/network absent; loopback15435 free.
Evidence `diagnostic-cleanup.json`. Only run-created resources selected; no existing volumes/databases/containers/integrations touched.
Branch `dev-thaara-continuation`, HEAD `413f5a5`; pre-existing dirty work preserved, vite.config.ts untouched. No deploy/commit/push/provider call.

## LATEST — existing Sarvam agent compatibility completed locally

**LATEST ACTUAL-MOUNT INSPECTOR APPROVAL/RETRY:** owner approved inspector-only support for HostConfig.Tmpfs with independent actual-filesystem
verification, same eight tests/SQL/resources, and stop on any new isolation failure. Changed only the inspector and its independent tests relative
to inspector-v2; runtime runner, eight acceptance cases and all SQL unchanged. New manifest: `PHONE_POSTGRES_RUNTIME_APPROVAL.inspector-v3.json`.
Inspector reads `/proc/self/mountinfo` and canonical paths inside the exact new container; verifies tmpfs type/source/root/destination, distinct
devices, exact sizes, rw/nosuid/noexec, read-only overlay root, no nested/unknown persistent mounts, and existing ownership/network/loopback guards.
Docker-generated /etc files are allowed only for this exact container ID; HostConfig declarations alone cannot pass. **33/33 independent tests passed**
(`phone-mount-inspector-final.json`); focused read-only security review found no consequential false acceptance/scope issue.

**Preflight PASSED:** saved actual-filesystem evidence passes all isolation guards initially and again at `110a-phone-contacts.review.sql`.
The fresh database target/server checks passed, and the runner completed the pinned 12 base migrations plus test-role provisioning before
advancing to 110a. It then stopped at **110a**. Its generic sanitized error output does not retain the specific PostgreSQL error; no root cause
is established. Do not invent a constraint/permission diagnosis. **110a application not confirmed successful;110b/110c not attempted;0/8 acceptance
tests executed.** No runtime results.json exists. No SQL file was edited. Further non-inspector diagnostics/runner or SQL changes require separate
owner approval under the latest restrictions. No automatic retry or schema repair.

**Cleanup verified:** new container `3dc1fc71c41ee57da88aae41d909f7166347ce8da16464c3619251346252e02e` destruction event observed;
network ID `c4f98d91b780c8c3661b6bc89526d02053e072950a59dc0f1fdac1128c030462`; named fixture container/network absent and127.0.0.1:15435
free after exact-ID/label cleanup. Existing databases/volumes/containers/credentials/integrations untouched. No production/VPS/Sarvam inbound,
WhatsApp/n8n access or changes, no deployment, commit/push, calling activation or real call. The successful inspector is NOT runtime/schema
acceptance or production authorization. Next required step: separately approved secret-safe 110a diagnostics (codes/object identifiers only),
then review any confirmed necessary fix without weakening RLS, grants, consent or audit rules.

**LATEST INSPECTOR-CORRECTION RETRY — STOPPED AGAIN:** owner approved minimum metadata-inspector corrections only, independent tests,
the same eight acceptance tests and original resource/SQL limits, with an explicit stop if isolation fails again. Replaced composite container
JSON with individually parsed mandatory metadata fields; unsupported optional ActualPorts becomes null only as a connectivity hint. Mandatory
loopback binding/ownership/mount/network checks are unchanged. Added two independent inspector tests; **16/16 passed** (`phone-inspector-green.json`).
Saved revised hashes separately in `PHONE_POSTGRES_RUNTIME_APPROVAL.inspector-v2.json`; verified all non-inspector artifacts unchanged.

Retried exact CLI once. It stopped at preflight again: **0/8 runtime tests, no base or phone SQL applied**.
The final local isolation snapshot (`node_modules/.cache/phone110-runtime/isolation.json`) was available after cleanup and identifies the exact
remaining cause: `Mounts:[]`, while `HostConfig.Tmpfs` has the exact three approved paths/options. Other captured facts match owned IDs/image,
read-only root, restart0, no binds, single internal network and configured loopback15435 binding. The guard requires three entries in `Mounts`,
so it correctly refuses that representation. The inspector now reads complete metadata; actual filesystem tmpfs verification is still needed,
not an assumption that empty Mounts proves safety. Per owner condition7, no further guard/runner changes or retries under this approval.
Need separate authorization to verify actual mount types and handle this Docker representation without allowing volumes/binds or weakening isolation.

Created fixture container `e730be0a562c241680ebe42d62cb6c27075753c9930a8d18c309d11ef101d357` was removed by exact-ID/label cleanup. Docker
destruction event observed and named fixture container/network absent on readback. No existing databases, volumes, services, integrations,
credentials, production/VPS/Sarvam inbound/WhatsApp/n8n changed. No deployment, commit/push or real call. Original and revised manifests preserved.
Network ID `5308840e41684078dc78c9312af0abdab941a464bf27f65150c1fb25b5e7abaf` is recorded in the final snapshot; the named network is absent.
Final read-only localhost probe confirmed port15435 free; no runtime results file exists. Revised manifest pins all match. Whitespace checks pass.

**LATEST APPROVED RUNTIME ATTEMPTS — STOPPED AT PREFLIGHT:** owner explicitly approved the disposable local phone PostgreSQL test,
then reiterated strict resource/SQL limits and required new approval if reviewed commands differ. Verified artifact hashes before execution.
Ran the exact pinned `node scripts/phone-postgres-runtime.mjs --approved-isolated-phone110` twice (second unchanged attempt observed only
fixture isolation metadata to diagnose a new hypothesis). Both stopped at `preflight`; **0/8 acceptance tests executed, no base/phone SQL applied**.
The independent composite Docker metadata read failed JSON parsing at `ActualPorts` (incomplete output). Do not disable isolation checks or
claim a database/schema failure; the inspection compatibility issue must be resolved first. Existing guard tests are still 14/14, not runtime evidence.

New fixture container IDs: `e9c3728b2381038852f2f821a67a10d001fa5e99ed653c0c3f0ff1ab948ba3e2` and
`bd293f9fcae91b3ee0a1f5d19ff89a791406331636e55f2763f22711c37245f6`; runner exact-ID cleanup ran after each failure. Read-only checks confirmed
container `thaara-phone110-postgres` and network `thaara-phone110-isolated` absent; destruction events observed. Local port15435 was free
after first cleanup. The bounded metadata observer finished. No existing service/container/volume/database/credential was altered.
No Sarvam/provider API call, inbound edit, WhatsApp/n8n access, deployment, commit/push or real call. Pinned image is cached PostgreSQL16.

**Approval boundary:** runner/test/SQL artifacts remain unchanged from the approved manifest. Need owner approval to revise the Docker
metadata inspection and retry under the same isolation/SQL/cleanup restrictions. Proposed approach: query mandatory safety fields individually,
handle unsupported published-port projection explicitly without weakening mandatory localhost-binding, ownership, tmpfs and internal-network
checks; unit-test failure cases first. Do not rerun a modified runner under the old hash approval. No change to base/phone SQL is proposed.

**LATEST readiness preparation:** prepared dedicated Step 110 disposable PostgreSQL runner/guard, eight runtime acceptance tests and
[exact approval request](integrations/phone/PHONE_POSTGRES_RUNTIME_APPROVAL.md) with pinned artifact manifest. **14/14 database-free guard
tests passed**; runner syntax, suite parse and eight-test inventory checked. Local Docker context/cached image checked read-only. No infrastructure
created and no PostgreSQL SQL/runtime test executed. Independent review issues fixed (non-vacuous call isolation, signal/deadline cleanup),
re-reviewed with no remaining consequential finding. Next action requires explicit approval for this phone-scoped disposable DB; prior
WhatsApp infrastructure approval is not reused. Runtime loader/secret integration, recovery, deployment and real outbound acceptance remain pending.

**LATEST DURATION DECISION IMPLEMENTED LOCALLY:** owner selected a **five-minute outbound maximum**, matching committed inbound v2.
Review profile now requires five minutes; no Sarvam account setting changed. Sarvam adapter requires an explicit version-specific
`enforcedMaxDurationSeconds` (300 for this profile), includes it in the fingerprint, refuses mismatched dispatch durations, and defaults
prepared drafts to that exact cap. Explicit shorter/longer requests are refused rather than widened. Approval/dispatch rechecks the cap.
Chat card displays **Maximum length: 5 minutes**; client accepts the typed bound server default while preserving explicit duration requests.
Old pending Sarvam approvals must be prepared again because the fingerprint now includes duration. No existing approval parameters changed.
Provider duration enforcement still requires actual pinned-version validation before activation; local configuration is not proof of provider behavior.

Fresh focused regression after this change: **47/47 passed across 3 files**, `node_modules/.cache/sarvam-five-min-focused.json`.
New tests first failed as expected (`sarvam-five-min-red.json`), then passed. API and web builds passed; existing bundle-size warning remains.
Whitespace check passed; vite.config.ts clean. Previous 460-test compatibility result below predates this duration change and is historical.
No infrastructure, persistent SQL, account/credential change, deployment, restart, real call, commit or push. Calling stays off.

**Connection ID received:** `255c00af-3e-542ffe50-6043`, saved exactly in the review profile. All non-secret identifier fields are now
provided. This is an opaque owner-supplied ID, not authenticated API verification. Do not ask for these IDs again or infer outbound approval.
The owner subsequently chose five-minute drafts; the earlier two-minute mismatch is resolved in the local plan/code, not through a remote edit.

**LATEST OWNER CONFIRMATION (supersedes draft/unknown telephony below):** numeric **version 2 is committed**. Sarvam Managed (Vobiz)
number **+918064269780 is active**, inbound deployment active and real inbound telephone tests/transcripts/language switching passed
in English/Kannada/Hindi according to the owner. Dynamic `call_purpose` and recipient `user_name` passed browser testing.
**Max call length is 5 minutes, not 2.** Preserve that working inbound deployment. No outbound integration/live-test approval follows
from these inbound tests. No new agent, number purchase, deployment or outbound call authorized. Details recorded in review-only JSON;
connection ID is recorded above. Owner assertions are not an authenticated provider readback.

Next readiness step: prepare the runtime profile using the recorded IDs and five-minute limit, then complete the gated secret/access,
isolated PostgreSQL/recovery and deployment acceptance preparation. Preserve inbound v2. Do not infer deployment, credentials, infrastructure
or outbound-call approval from the owner's duration choice. Do not enable an advisory timer as a hard provider limit.

Owner corrected setup status: **Thaara AI Voice Assistant already exists**, v2 Draft, Chaitra – Kannada Mix Support, English/Kannada/Hindi
with automatic switching; AI disclosure, conversation rules and end-call action configured. Browser purpose/follow-up/summary test passed
according to the owner. Do not create another agent or replace its working prompt. `user_name` means **the recipient**.
Three non-secret IDs received and saved in [review-only profile](integrations/phone/sarvam-existing-agent.review.json); not loaded into runtime.
The subsequent owner confirmation above resolves numeric version and telephony availability and establishes the five-minute mismatch.
No secret requested or accessed.

Local code changes:
- Outbound passes approved purpose as `call_purpose` and bound contact display name as `user_name`. Owner identity stays in approved disclosure.
- Sarvam agent/version/connection/caller/variable-mapping fingerprint is bound into live drafts and rechecked before confirmation/dispatch.
  Existing pending Sarvam approvals without/mismatching the fingerprint must be prepared again; do not mutate their parameters.
- Safe date/slash interaction IDs supported across adapter, shared contract, durable record validation, browser and reviewed 110c SQL.
  110c SHA256 now `479c06d456577a120a95382b25f29d703366ac624dcae71f1d4839e346a67b5d`; prior pin invalid. No external SQL executed.
- Added fixed-origin authenticated Analytics GET reader, exact stored attempt/version binding, bounded bodies/transcripts and no retry.
- Explicit owner/CSRF/rate-limited `/api/v1/connectors/phone/ai/calls/:callId/result` uses typed PolicyGateway, scoped ledger, private stored
  request ID, audit and session rechecks. Chat **Check provider result** shows separate unverified original-language evidence. No redial,
  callback-ledger overwrite, model execution or invented summary. Exact browser-generated summary API mapping is still unestablished.
- Hindi Chat calling and matching Chaitra report-TTS identifier remain unimplemented/unverified. Do not claim that remote Hindi configuration
  or browser testing proves backend Hindi support or real telephony quality. Production live/speech guards remain intact.

Fresh verification after final source changes: **460 passed, 0 failed across 44 files**:
- `node_modules/.cache/sarvam-existing-agent-api-final.json`: **145/145**, 19 files (all non-runtime phone files plus auth, Chat Gmail and Calendar scheduling).
- `node_modules/.cache/sarvam-existing-agent-web-final.json`: **315/315**, 25 files (all web plus policy).
- Contracts/DB/policy builds, API typecheck/build and web typecheck/build passed. Existing web bundle-size warning remains.
- `git diff --check` passed; `apps/web/vite.config.ts` clean. Focused independent security review: no consequential finding in this slice.
Earlier red tests and an edit escaping error were fixed, then rerun; do not report the initial failing commands as passing. Tests used fake
providers/local loopback and previously approved disposable PGlite fixtures. Real PostgreSQL multi-process validation and provider/API/runtime
acceptance remain pending. Earlier 774 full API tests are historical, predating this compatibility slice; do not add them to the fresh total.

Git remains `dev-thaara-continuation` / `413f5a5`; all previous dirty work preserved. No real provider request, call, account/workflow edit,
credential change, persistent migration, infrastructure, deployment, restart, commit or push. WhatsApp/n8n/VPS untouched.

Next: use the confirmed profile and obtain the missing connection ID/duration decision. Continue safe readiness work using the
review profile; no live switch, credentials, number purchase, isolated PostgreSQL or deployment without applicable explicit approval.

## Earlier checkpoint below — historical; setup status superseded above

## Scope and state

Continued Step 110 after Claude's daily live-call limit change. Branch `dev-thaara-continuation`, HEAD `413f5a5`; all dirty work preserved.
No production code changed in this Codex continuation. No provider request, call, credential change, infrastructure, persistent migration,
deployment, restart, commit or push. WhatsApp/n8n/VPS untouched; sending stays disabled, existing limits preserved. `apps/web/vite.config.ts` clean.

**Owner setup status:** owner explicitly confirmed sign-in to Sarvam only. No agent, number or connection is configured. Do not ask for
nonexistent IDs or recreate prior API/speech credentials. Guide the owner through the draft editor first; never request secrets.

## Completed

- Reviewed Claude's new default 3/rolling-24h live-call claim limit (server configurable 1–20), per-owner advisory transaction lock and
  one-service parallel-confirm test. Compiled DB artifact contains the change. Real PostgreSQL multi-connection concurrency remains untested.
- Prepared [Sarvam draft-agent instructions](integrations/phone/SARVAM_AGENT_DRAFT.md): normal spoken responses, multilingual/persona guidance,
  approved-purpose variables and no extra external tools. Do not paste the local controller's JSON/endCall protocol into Sarvam.
- Corrected [go-live package](integrations/phone/SARVAM_GO_LIVE_PACKAGE.md): it is not executable yet; no 110c rollback artifact exists;
  destructive 110a/110b rollback is not a verified post-110c recovery chain. Prefer calling-off/data preservation and reviewed forward repair.
  Never restore an older shared database over newer Gmail/Calendar/WhatsApp data. Any restore rehearsal uses isolation and explicit approval.
- Added SQL checksum pins and explicit disposable-PostgreSQL concurrency/RLS/replay/audit/window acceptance requirements. No SQL executed externally.
- Rechecked official [pricing](https://docs.sarvam.ai/voice-agents/pricing), [conversation settings](https://docs.sarvam.ai/voice-agents/build/conversation-settings)
  and [quickstart](https://docs.sarvam.ai/voice-agents/quickstart). Actual account settings remain unverified. Prepaid credit is exposure control,
  not proof of per-call spending enforcement. Verify the published agent's duration and reject drafts whose requested maximum cannot be enforced.

## Verification

Fresh API regression: **755/755 passed, 0 failed/skipped, 68 files**, exit 0; report `node_modules/.cache/phone-1030-api-regression.json`.
Compared the intended database-free API file inventory to report paths: all 68 present, none missing. Combined with the separate root-path
file below: **774 passed across 69 files**. This is the complete non-runtime/non-integration API regression, not a full-repository or
external PostgreSQL acceptance run. It includes Claude's current daily-limit changes. No source edits occurred during the run.

Separate root-path API file `apps/api/test/whatsapp-n8n.test.ts`: **19/19 passed**, report `node_modules/.cache/phone-1030-api-root-path.json`.
It runs from repository root because it reads root-relative files. Main API run excludes `*.runtime.test.ts`, `*.integration.test.ts`,
`whatsapp-postgres*.test.ts` and that separately tested root-path file. External PostgreSQL/Redis/provider runtime tests are NOT authorized by
running the in-memory regression. Existing approved disposable fixture migrations only.

Claude's web 240/240 and DB 49/49 are historical evidence for unchanged source, not rerun here. Earlier Codex builds/security review are likewise
historical; do not add their counts to the new API total. Whitespace check passed; verify after documentation edits.

## Next action and approval boundary

Owner opens Build → Agents → Create from Scratch, creates a draft called Thaara and confirms the editor (screenshot with secrets hidden).
Then guide the instruction/variables/language/voice/duration settings from the draft guide. Do not request number purchase, top-up, key creation,
paid preview/test, campaign activation or deployment as an automatic next step.

Before real use: verify exact agent version/settings and non-secret IDs; prepare the missing reviewed runtime loader, safe recovery,
isolated PostgreSQL acceptance and exact deployment artifact. Consolidate sensitive work into a concrete scoped approval request only when
it is reviewable. Existing WhatsApp infrastructure approval does not authorize phone infrastructure. Keep production live/speech guards intact.
