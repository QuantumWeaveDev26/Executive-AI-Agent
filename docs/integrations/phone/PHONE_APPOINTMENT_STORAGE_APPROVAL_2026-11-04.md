# One isolated appointment-storage PostgreSQL acceptance run

PREPARED ONLY, NOT EXECUTED. This package authorizes nothing by itself. Owner execution approval required.

## Exact commands (workspace C:\ThaaraProjects\thaara-ai-agent-v2)

Database-free source preflight (already completed):

```powershell
node scripts/phone-appointment-storage.review.mjs --preflight-only --manifest-sha256 c681a4a8af96fea19b9005aa0cdf32f67e6f46414df63884d7d5ebacab3e55d7
```

ONE execution to approve; do not run yet:

```powershell
node scripts/phone-appointment-storage.review.mjs --approved-appointment-storage --manifest-sha256 c681a4a8af96fea19b9005aa0cdf32f67e6f46414df63884d7d5ebacab3e55d7
```

Exact307-file SHA256 inventory: `PHONE_APPOINTMENT_STORAGE_V1.review.json`.
Manifest SHA256: `c681a4a8af96fea19b9005aa0cdf32f67e6f46414df63884d7d5ebacab3e55d7`.
Each source is verified before infrastructure, before schema/test admission and after the test child exits.
Any mismatch stops. Do not regenerate pins to make an approved execution pass. No previous approval is reused.

## Files changed/prepared and principal hashes

| File | SHA256 |
|---|---|
| scripts/phone-appointment-storage.review.mjs | c8805289f54f738e66e032ca4067f82d5c152c54dfec7a4893955f954d7d2f65 |
| scripts/phone-appointment-storage.review.test.ts | b2310d6719f95db9518ebe54a81069ca71b92174bf247e1fc7d32c1d10a01cf7 |
| apps/api/test/phone-inbound-appointment-storage.runtime.test.ts | b58706442118ca1ebfe5f4aebf2bca742f6d2ebf9824b236ad400f7d2d6026bc |
| scripts/phone-inbound-postgres-runtime.mjs | c86cd2df71dc1d5d3ac3965d599857b59b7a2efbfd6a7f477b8bae71c010b3ed |
| scripts/phone-inbound-runtime-config.mjs | cc61ebf16695b939adaeb21c702ab907bca20c0ae4aed1f4544079ad0663e604 |
| scripts/phone-inbound-runtime-lifecycle.mjs | 6e781060aa790f75c01817be4ff6b53e4e991a4090e7d19527fc39be6532cdc9 |
| apps/api/src/services/phone-inbound-appointments.ts (unchanged) | 08c37f85f0b43291d784adf08bbf4b30522df6f7999f4ab9dc3f1beda2138c9a |
| apps/api/src/routes/phone-inbound-appointments.ts (unchanged) | 0f970e7766d9a57f8b89e1f0debae7d3c213a53af599d3b52962e6e09b63cf8c |
| docs/migrations/112h-phone-inbound-events.hosted-review.sql (unchanged) | 064ac927a1e059e25f2026a0251fa06e15e5849b4d35641d106273a641049a9f |
| docs/migrations/113h-phone-inbound-principals.hosted-review.sql (unchanged) | 688922f79a552699028ce7e1cd450128a5156d585b13803e478f6412a3aee275 |

The config test has one additional plan-binding regression; its exact hash and all reused isolation,
session, relay, lifecycle, source/base SQL, transitive app imports, built workspace packages and lockfile
hashes are in the307-file manifest. Shared runtime changes add only a distinct opt-in appointment-storage
plan/test selector and fresh cache; existing default modes and safeguards remain. Original SQL, consumed
manifests, receipts, recovery scripts and independent-review gates remain unchanged. Changed shared runner
bytes intentionally invalidate old source pins; old approvals are consumed and must not be refreshed/reused.

## Exact isolated environment

- Existing reviewed LOCAL Docker engine only, fixed verified npipe endpoint. No remote Docker context/SSH.
- ONE NEW container `thaara-phone113-postgres-review` and ONE NEW INTERNAL network
  `thaara-phone113-network-review`. Refuse existing names; never adopt or delete them.
- Image `postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`,
  already locally present, `--pull=never`. Image ID must match before SQL and deletion.
- NEW disposable database name `thaara_vps_pilot`, solely to satisfy unchanged112h/113h gates.
  This is NOT the hosted database: every connection must go to127.0.0.1:15436 through the owned
  relay to the new verified container. No Docker published port and no remote host fallback.
- Fresh random temporary admin/app/ingest passwords held in memory/child environment, not argv/reports.
  No existing credentials, real owner account, production session or provider configuration is read.
- Read-only root; tmpfs-only data512MiB, PostgreSQL runtime16MiB and /tmp32MiB; actual kernel mountinfo,
  type/source/destination/permissions verified. Reject bind mounts, persistent volumes and unknown mounts.
-768MiB memory,1CPU,128PIDs, no-new-privileges, no added capabilities, logging driver none.
- Same reviewed relay/session/timeout and owned-resource recovery lifecycle. No protected production
  backup/restore is needed or performed because this fixture starts empty and contains synthetic data only.

## SQL and identity scope

Parent installs only the twelve pinned base migrations0001–0012. First acceptance case rechecks owned
fixture identity, target name, PostgreSQL16 and absent Phone tables, then applies original112h and113h
with their explicit session gates unchanged. It verifies forced RLS and restricted NOLOGIN ingest role.
Only afterward it provisions LOGIN/passwords on the new fixture's app/ingest roles, without broadening
their permissions. These are disposable test-role changes, not a production credential operation.

Synthetic workspaces, users, sessions and call-bound principal grants are created only in this fixture.
Actual endpoint -> principal transaction adapter -> restricted ingest role -> original SQL append
function -> journal/audit commit is used; no fake DB transaction or in-memory journal substitutes.
Owner readback uses actual app-role/RLS transactions. Calendar owner-session resolver returns null;
Calendar/provider ports throw if invoked. This storage suite cannot create an appointment or call anyone.

## Nine cases and expected success

1. Original112h/113h installation; exact SQL hashes, target/version, forced RLS, restricted role checks.
2. Request and preferred slot persisted through actual HTTP injection/SQL path; one row + one audit,
   owner-only readback; response saved:true/request_saved/appointmentConfirmed:false.
3. Two PostgreSQL backends deliver concurrently: one row/audit; conflicting repeat refused, counts unchanged.
4. Fixture-only targeted audit-failure trigger forces rollback: zero row/audit and no saved acknowledgement.
   Drop only that test-created trigger/function, then ONE planned resubmission succeeds exactly once.
5. Wrong bearer, wrong call, revoked and expired grant all refuse without writes.
6. Foreign tenant/member cannot read; ingest cannot read journal/principals/sessions or SET ROLE guard.
7. Close/recreate endpoint and ingest pool; saved record survives and replay adds no row/audit.
   This is connection/endpoint restart evidence, NOT PostgreSQL process restart or disk persistence.
8. Inject a failure after actual append but before COMMIT: rollback/no saved receipt; ONE explicit normal
   submission using the other pool succeeds once. No uncertainty/connection loss is falsely called success.
9. Missing caller consent and demoted owner refuse without a stored request.

Expected exit0 and sanitized JSON: status:passed, validationPlan:appointment-storage,
schemaResults:base:0001 through base:0012, tests:{passed:9,failed:0,skipped:0,failedCaseNumbers:[]},
cleanup.verified:true, containerRemoved:true, networkRemoved:true; transport admission loopbackVerified:true,
shutdown listenerClosed/childrenClosed/socketsClosed:true and supervisor faultReason:null.
Case1 pass is the evidence for112h/113h installation; they are deliberately not parent schemaResults entries.
Stop on first unexpected failure (`--bail=1`), no automatic repair, test rerun or SQL changes.

## Preflight review performed (local, database-free)

- Source-only preflight matched307 pins; infrastructureTouched:false/sqlExecuted:false.
-90/90 local runner/config/isolation/lifecycle/relay/session/child/manifest tests PASS,0fail.
- All nine runtime cases SKIPPED (not executed), receipt
  `node_modules/.cache/phone-appointment-acceptance-preparation-20261104.json`.
- New cache directory/used marker absent. Node syntax check PASS. Original112h/113h hashes matched.
- Reviewed strict mode/plan/hash separation, new exclusive marker, source checks before infrastructure,
  fresh-session lifecycle, no SQL before kernel isolation, restricted role path, first-failure stop,
  sanitized results and ownership-verified deletion. No new independent review is claimed.

## Risks and cleanup

Docker execution needs separately reviewed tool access; host disk/RAM/image/port/runtime availability
are not verified until the approved execution's bounded preflight. Runtime SQL/permissions/concurrency
may fail; local mocks are not a guarantee. tmpfs data is intentionally destroyed during cleanup.
F-03/production recovery and admission remain OPEN; a pass grants no production installation permission.

After success OR failure, close SQL pools and the owned test child, then settle all relay sockets/tunnels.
If closure cannot be verified, refuse deletion and report retained resources. Otherwise recheck exact
container ID/image/run labels before removing that one container; then verify exact owned internal
network ID/name/run labels and empty membership before deleting that network. Never delete volumes.
Independently require container/network absence, matching container destroy-event evidence and free15436.
Uncertain resource creation/cleanup remains a failure, never broad name-based cleanup or automatic repair.

Retain only new sanitized evidence under `node_modules/.cache/phone-appointment-storage-v1/`:
`used.json`, `fixture.json`, `result.json`. Never reset/delete the one-use marker or previous receipts.
The schema-session cleanup precedes subsequent Docker inspection, preserving the verified connection-
lifecycle fix. No SSH agents, VPS files, existing containers, credentials or production backups involved.

## Specific approval requested

Approve ONE execution of the exact pinned --approved-appointment-storage command above, including:
new disposable Docker container/internal network, reviewed loopback relay, fresh temporary credentials,
the twelve base migrations, unchanged112h/113h, synthetic fixture identities and role LOGIN setup,
the nine cases including targeted audit trigger create/drop and planned failure-recovery submissions,
and verified owned-resource cleanup using reviewed local Docker access.

No production database/backup/migration, deployment, provider configuration, live v5/v7/routing/WhatsApp
change, real Calendar event, paid test, phone call, commit, push or reuse of old approvals is included.
One attempt consumes approval regardless of outcome. Any changed pin/scope or retry needs new approval.
