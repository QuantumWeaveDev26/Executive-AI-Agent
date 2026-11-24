# Step 110 — isolated PostgreSQL validation approval request

**Current outcome:** one explicitly approved full run completed successfully: unchanged110a/110b/110c applied; **8/8 acceptance tests passed**,
no failed/skipped tests; exact disposable resources cleaned and independently verified. Latest outcome section below and dated handover hold
evidence. Historical requests/inspector attempts are retained. No further run or live action is authorized by this document.

**Latest third inspector revision:** separately owner-approved actual mount verification passed **33/33 independent tests** and real
preflight. Manifest `PHONE_POSTGRES_RUNTIME_APPROVAL.inspector-v3.json` preserves unchanged SQL, resources and eight runtime tests.
Pinned base migrations completed; execution then stopped at 110a (specific error unavailable in sanitized output). 110a success unconfirmed,
110b/110c not attempted, **0/8 acceptance tests executed**. Exact-ID cleanup verified: new container/network absent and localhost15435 free.
Further diagnostic/SQL/runner changes are outside this inspector-only approval; no retry or production action authorized. See latest checkpoint.

**Latest authorized correction:** owner separately approved minimum inspector correction and one retry. Individual mandatory-field reads and
optional runtime-port handling passed **16/16 independent tests**; revised hashes are in `PHONE_POSTGRES_RUNTIME_APPROVAL.inspector-v2.json`.
The retry stopped at preflight again. The final isolation snapshot shows `Mounts:[]` with the three configured mounts reported in `HostConfig.Tmpfs`;
the unchanged strict guard requires three `Mounts` entries and rejected it. **No SQL applied; 0/8 acceptance tests ran.** Exact-ID/label cleanup
removed the created fixture; absence/destruction verified. The owner explicitly required stopping on another isolation failure. No further
diagnostic command changes or retries are authorized by this package. Runtime/schema acceptance remains unproven.

**Owner approved this exact scope; execution stopped at preflight.** Two unchanged runner attempts created and cleaned up only the fresh fixture.
Composite Docker metadata inspection returned incomplete JSON at `ActualPorts`; **no SQL applied, 0/8 acceptance tests executed**.
Fixture container/network absence verified read-only after cleanup. The owner requires renewed approval if commands differ; do not run a modified
inspector/runner under this original manifest. See the [latest checkpoint](../../THAARA_DAILY_HANDOVER_2026-10-30.md).
This remains a prerequisite for real Chat calling, not a deployment or call approval.

## Exact scope requested

Create one **new local** Docker container `thaara-phone110-postgres` and one **new internal** network `thaara-phone110-isolated`.
Database `thaara_phone110_test`, published only as `127.0.0.1:15435`. Fresh random admin/app credentials remain in process memory and
the disposable container; never print or save them. Read-only root filesystem, tmpfs-only database/runtime storage, memory 768 MiB,
one CPU. No existing volumes, networks, databases, running services, VPS, n8n or Sarvam account are changed. No image pull: use only
cached pinned image `postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.

Apply only the checksum-pinned 12 existing base migrations and reviewed **110a → 110b → 110c** inside this fresh database. Provision
test-only roles/passwords there, and run eight synthetic acceptance tests. They include deliberate audit failure and synthetic clock-fixture
mutation inside this database only; neither is a runtime limit reset. All provider calls use injected fake functions. Real external services
and private account credentials are unavailable to this test environment.

Remove only the exact container/network IDs created by this run, after verifying ownership labels. Never clean up by wildcard, prune,
reused name or volume deletion. Interruption/hung verifier kills only the owned child and reaches exact-ID cleanup; SQL operations are bounded.
If the process is forcibly killed in a way that bypasses all signal handling, inspect ownership manually; never attempt fallback deletion.

## Artifacts and commands

[Pinned artifact manifest](PHONE_POSTGRES_RUNTIME_APPROVAL.json) records the runner, guards, acceptance suite, optional loopback relay,
reviewed SQL and base-schema manifest digest. Recheck every pin before executing after owner approval; source changes invalidate this request.

Read-only preparation already executed:

```powershell
node scripts/phone-postgres-runtime.mjs --print-plan
node --check scripts/phone-postgres-runtime.mjs
pnpm exec vitest run scripts/phone-runtime-guard.test.ts
```

**Only after explicit approval:**

```powershell
node scripts/phone-postgres-runtime.mjs --approved-isolated-phone110
```

The runner refuses occupied names/port, non-local Docker context, changed SQL, existing database contents, unexpected image/server major,
non-tmpfs mounts, shared network or public port exposure. No existing infrastructure is adopted. Default test commands exclude runtime files.

## Acceptance and actual evidence

Eight runtime tests prepared, **not executed**:
1. Restricted application role and forced RLS on all phone tables.
2. Owner call exists and is visible to its owner but inaccessible to peer/foreign scopes through SQL, history and result readback.
3. Two independent app instances/pools compete for the final daily slot; only one dispatch and no redial on replay.
4. Fresh-pool persistence and rolling-window budget behavior using synthetic fixture timestamps.
5. Archived contact blocks approval/dispatch.
6. Failed audit insert rolls back the claim before any fake provider request.
7. Correlated date/slash callback IDs, replay handling and truthful unverified recipient evidence.
8. Reviewed SQL refuses execution without its acknowledgement.

**14/14 database-free guard/child-lifecycle tests passed**. Runner syntax, runtime-suite parse/test inventory and manifest checks passed.
Read-only Docker preflight confirmed a local Desktop Linux endpoint and the pinned cached image. No container/network was started; no SQL ran.
Focused independent review found two issues (vacuous call isolation and interruption cleanup); both fixed and re-reviewed without remaining
consequential findings. Report files: `node_modules/.cache/phone-runtime-guard-final.json`; runtime results, when authorized, go to
`node_modules/.cache/phone110-runtime/results.json` with counts/pins only, never raw database credentials/failure payloads.

## Latest full acceptance outcome — executed once under explicit owner approval

Exact command `node scripts/phone-postgres-runtime.mjs --approved-isolated-phone110` executed ONCE. All13 acceptance-v1 artifacts and base12
manifest matched before setup; source pins still matched after cleanup. Actual isolation/per-phase rechecks passed. Base12/test-role provisioning
and unchanged110a/110b/110c succeeded; all **8/8 synthetic acceptance tests passed,0 failed,0 skipped**, exit0. No error/SQLSTATE reported.
Confirmed restricted-role/RLS, owner/workspace boundaries, concurrent daily-slot claim/no redial, persistence/window, archived-contact fencing,
transactional audit rollback, callback correlation/truthful evidence and missing-ack refusal. Fake providers only; no unexpected failure or retry.
Exact new container/network removal independently confirmed, destruction event observed, loopback15435 free. See latest handover for IDs and
`node_modules/.cache/phone110-runtime/acceptance-v1-evidence.json` for evidence. No source/SQL/existing resources/integrations changed.
Owner one-run grant is consumed. No further infrastructure/SQL run, persistent migration, deployment, secret change or real call is authorized.

## Previous remaining acceptance request — subsequently explicitly approved and executed

110a diagnostic succeeded and its resources were removed. The owner's subsequent `continue` permits preparation, not extension of the explicit
one-run/110a-only database approval. No new infrastructure or SQL has been started.

Prepared exact command: `node scripts/phone-postgres-runtime.mjs --approved-isolated-phone110`.
Source pins: `PHONE_POSTGRES_RUNTIME_APPROVAL.acceptance-v1.json` (request only, runtimeExecutionAuthorized=false).
All13 unchanged source-artifact pins and the twelve-base-migration manifest rechecked successfully. Existing73/73 database-free results are
historical, unchanged-source evidence; not rerun merely to prepare this request.

Requested scope: ONE fresh local owned PostgreSQL container and internal network; fresh temporary credentials, tmpfs-only approved storage,
loopback127.0.0.1:15435 only; unchanged pinned image, identity/ownership/mount/network/permissions checks, dedicated phase sessions and timeouts.
Apply twelve pinned base migrations, test-role provisioning and unchanged pinned110a/110b/110c solely inside this disposable database; then run
the existing eight synthetic-only acceptance cases. Stop on any unexpected error and do not repair SQL or automatically retry under this scope.
Expected negative test refusals are assertions, not permission to bypass safeguards.

Acceptance cases: restricted-role/forced RLS; workspace/owner isolation; concurrent final-budget claims and replay/no duplicate calls; fresh-pool
persistence/rolling window; archived contact fencing; transactional audit failure with zero provider requests; correlated callbacks/truthful evidence;
review-acknowledgement refusal. No Sarvam/Meta/provider requests or real calls. Acceptance runner uses only fake provider adapters.

Cleanup only exact new IDs with ownership labels; independently verify container/network absence, container destruction event and port15435 free.
No existing DB/container/volume/service/credential changes, production access, WhatsApp/n8n/Sarvam inbound changes, deployment, commit or push.
If any checksum/isolation check fails, stop before SQL. Success would not authorize live configuration/deployment/calling. Await explicit approval.

## Latest lifecycle-v1 diagnostic-only result — 30 October 2026

Owner explicitly approved the exact diagnostic command once, through110a only. All13 lifecycle-v1 artifact pins matched before/after execution.
Fresh actual isolation preflight/recheck PASSED. Twelve base migrations/test role completed; **110a APPLIED successfully**, exit0, SQLSTATE=null,
category=none, elapsed79ms, pool total1/idle0/waiting0. Review/target/base-dependency context checks confirmed. No110b/110c or acceptance tests.
Exact owned container/network cleanup independently verified, container destruction observed,127.0.0.1:15435 free. No source or SQL changed.
See latest dated checkpoint and cache `diagnostic-lifecycle-v1-evidence.json` for IDs/evidence. This permission is consumed; no automatic retry.
Remaining gate: separately approved full disposable phone-schema validation (110b/110c and eight tests). No production/live authorization.

## Previous diagnostic-only request after fixture correction — 30 October 2026

Owner approved local fixture lifecycle correction and database-free verification, now completed: **73/73 tests passed**, syntax checks passed.
No infrastructure or SQL retry has been performed under that approval. New source pins: `PHONE_POSTGRES_RUNTIME_APPROVAL.lifecycle-v1.json`.
Exact reviewed next command: `node scripts/phone-postgres-runtime.mjs --approved-diagnostic-phone110` — **NOT currently authorized to execute**.
Proposed scope: one newly owned disposable container/internal network, fresh secret credentials in memory, tmpfs only,127.0.0.1:15435;
unchanged isolation/ownership checks; twelve pinned base migrations/test role and unchanged pinned110a only. Capture allowlisted diagnostics;
stop on failure, and stop after110a even if successful. Exact-ID/label cleanup only, followed by absence/destruction/port verification.
No110b/110c, eight acceptance tests, persistent resources, existing database/container/volume changes, providers, deployment or commit/push.
Requires fresh explicit owner approval. This source manifest does not confer infrastructure/SQL authority.

## Previous diagnostic-only authorization and result — 30 October 2026

Owner authorized exactly one disposable diagnostic retry, unchanged SQL/guard scope, stopping at 110a with no 110b/110c or acceptance tests.
Command executed once: `node scripts/phone-postgres-runtime.mjs --approved-diagnostic-phone110`.
Diagnostic source pins: `PHONE_POSTGRES_RUNTIME_APPROVAL.diagnostic.json`; seven prior non-runner pins unchanged.
33/33 existing isolation tests and 4/4 diagnostic tests passed; syntax checks passed. Actual isolation preflight/recheck passed.
Base schema (12 pinned migrations) and test-role provisioning completed. Failure occurred in 110a acknowledgement before 110a SQL execution:
SQLSTATE absent, category `client_transport_or_runner_error`. No PostgreSQL schema error established. No later SQL/tests attempted.
Timeout/connection interaction with blocking metadata checks is suspected, not confirmed. No SQL change proposed on current evidence.
Minimum next investigation: database-free reproduction and allowlisted client-error classification, then separately approve any fixture change/retry.
Exact owned container/network removed; destruction event and absence verified;127.0.0.1:15435 free. See latest dated handover and cache
`phone110-runtime/diagnostic.json`, `isolation.json`, `diagnostic-cleanup.json`. This permission is exhausted; no automatic repeat.

## Not authorized by this request

No persistent phone migration, deployment, service restart, credential/account change, purchase, real phone call, WhatsApp send, workflow edit,
commit or push. Preserve active Sarvam inbound v2 and all working Thaara integrations. Existing WhatsApp fixture approval does not cover this
new phone fixture. Production managed PostgreSQL/Redis, TLS/backups and secret management requirements remain in force; the existing private
pilot is not automatically an approved production phone environment.

After a verified pass, continue the same task: finish reviewed runtime/secret setup and recovery readiness, then present the exact scoped
deployment and one-owner-number call approval. No extra development prompt is needed; sensitive boundaries still need explicit approval.
