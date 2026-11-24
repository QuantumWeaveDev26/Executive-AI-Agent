# Approval request: ONE disposable inbound PostgreSQL acceptance run

Status: CONSUMED. Owner replied “proceed”; exact command executed ONCE4November2026 and stopped at
verify_isolation BEFORE Thaara migrations/tests. Cleanup independently verified, exit1; no retry.
See `PHONE113_POSTGRES_ACCEPTANCE_RESULT_2026-11-04.md`. The original reviewed scope below is retained.

This superseded the earlier preparation-only baseline for this
specific local acceptance scope. It does not supersede or reuse any consumed approval.

## Owner decision

Approve ONE execution of the command below to create a new local disposable PostgreSQL fixture, apply the
reviewed test schemas and run nine synthetic acceptance cases. Nothing contacts Sarvam or another provider.
No production/pilot database, existing container/volume/service, credential, deployment or real call is included.

```powershell
node scripts/phone-inbound-postgres-runtime.mjs --approved-isolated-inbound113 --manifest-sha256 413f06a50d93e0c58e14e4b0dea78553c82b922467edc39edf6108e169559fa9
```

Manifest: `PHONE113_POSTGRES_ACCEPTANCE.review.json`,287source/dependency pins, SHA256:
`413f06a50d93e0c58e14e4b0dea78553c82b922467edc39edf6108e169559fa9`.
Runner verifies the exact manifest SHA and all sources before infrastructure. Missing/changed files stop the run.
No source updates, manifest regeneration, automatic repair or retry are authorized by this request.

## Exact fixture scope

- Local Docker Desktop Linux named-pipe endpoint only; no remote Docker context, SSH/VPS or image pull.
- Existing local image only: `postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.
- New container `thaara-phone113-postgres-review`, network `thaara-phone113-network-review`, database
  `thaara_phone113_review`; publish exclusively `127.0.0.1:15436` to5432.
- Refuse pre-existing names or occupied port. One new internal network, no connection to existing networks.
- Fresh ownership nonce on both new resources; capture exact returned IDs and image identity.
- Read-only root; no bind mounts or persistent volumes. Only verified tmpfs: data512MiB, runtime16MiB,
  tmp32MiB, rw/nosuid/noexec. Check actual mountinfo source/type/destination/properties and resolved paths.
- Limits:768MiB RAM,1CPU,128PIDs,64MiB shared memory; no privileged mode/extra capabilities,
  no-new-privileges, Docker log driver none. No existing services are stopped, restarted or reconfigured.
- Fresh administrator/app/ingest test passwords; no existing credentials or environment database target.
  Passwords pass through private process environment/in-memory clients, never command arguments or reports.
  Docker stores the new container's POSTGRES_PASSWORD in its configuration until that container is removed;
  the inspector does not read or report that configuration field. No secret file is created in the repository.
- TCP readiness and complete isolation must pass BEFORE SQL. No relay/fallback if port publication is unavailable.

## SQL scope and confirmed guard correction

Existing112/113 explicitly require an in-memory marker. Do NOT set that marker on real PostgreSQL.
Original files remain byte-identical. NEW runtime-review candidates change only the initial approval gate:
new runtime-only setting, exact database name and PostgreSQL16. All schema/object bodies are identical to
the checksum-pinned originals, verified by local derivation tests.

1. Exact12base migrations,0001–0012, pinned in the manifest; no directory-discovered extra SQL.
2. `112r-phone-inbound-events.runtime-review.sql`, SHA256
   `cccaa141cedd64108a6273895c294130abb5f49c61a16a64926d7edc7fb0742f`.
3. `113r-phone-inbound-principals.runtime-review.sql`, SHA256
   `d33a7c20e686a7b39112e918fff07492d763a8a4184b86c12dfdc68369b7f103`.
4. Fixture-only LOGIN/password provisioning for thaara_app and thaara_phone_ingest, preserving privilege flags.
   Test-only synthetic users/workspaces/sessions/grants, revocation/demotion checks and one audit-failure trigger
   are defined in the pinned runtime test. No existing data is imported. No SQL111/phone110 schema is applied.

Each migration result is recorded by finite identifier; failure reports sanitized SQLSTATE/phase only.
Schema clients close BEFORE metadata inspection; no idle transaction spans Docker inspection.

## Nine acceptance cases

1. Raw authenticated callback/completion, saved receipt and ordinary owner read.
2. Separate real service connections: concurrent duplicate saves, exactly-one audit and conflicting replay denial.
3. Concurrent callback/completion plus first-turn withdrawal and old-callback replay suppression.
4. Owner/workspace RLS, including another valid owner in the SAME workspace; service direct access/escalation denied.
5. Real lock-observed concurrent revocation, expired grant and owner demotion denial.
6. Audit trigger failure rolls back report and cannot return saved:true.
7. Missing caller/interrupted calls, wrong version and absent consent remain truthful; Calendar/media stay disabled.
8. Real pool close/reconnect persistence and duplicate replay. This is NOT PostgreSQL-process/container-restart proof.
9. Pre-body route rate refusal without another saved event.

Run only this one file with bail=1. Require9passed/0failed/0skipped; stop on the first unexpected failure.
No provider adapter or external API is invoked. The test imports no live application startup configuration.

## Timeouts, cleanup and retained evidence

Docker commands30s; readiness polling bounded; SQL statement30s/query45s in setup and3s/5s in test clients;
test child180s plus5s termination grace. Excess output aborts the child. Confirm child close before deleting
fixture resources; unknown termination prevents deletion and is reported for separate owned-resource cleanup.

Close clients, verify exact container ID/image/name/labels before rm, verify exact empty owned network before rm.
No deletion by discovered name, wildcard, volume or inferred ownership. Independently verify resource absence,
matching destroy-event evidence and free15436. Ambiguous creation/cleanup cannot be called successful.
No container recreation or automatic retry. Retain all old artifacts and the new non-secret:

- `node_modules/.cache/phone113-runtime/used.json` — exclusive one-use marker, never reset.
- `.../fixture.json` — owned IDs/image/nonce proof, if the test phase is reached.
- `.../result.json` — finite schema/test/failure/cleanup results; no raw errors, transcripts or credentials.

All three paths were absent during preparation. Stale artifacts cause refusal before infrastructure.
Removing the owned tmpfs fixture destroys the synthetic data. No existing backup or volume is selected.

## Actual preparation results

-85/85database-free checks passed in8files, including33unchanged legacy inspector regressions.
-Nine real-PG cases discovered and SKIPPED; no SQL/database/Docker setup executed.
-Fresh APItypecheck passed; unchanged APIbuild and prior runtime feature results reused as historical evidence.
-Independent review blockers fixed: TCP readiness, transitive inspector pinning. Same-workspace peer-owner
  isolation added. Final review found no remaining concrete blocker; this is not actual runtime proof.
-287pins verified by database-free --preflight-only and manifest --check. Originals112/113, legacy guard and
  vite.config.ts unchanged. No provider/VPS/live integration changes, commits or pushes.

After execution: report each migration, all nine cases, sanitized failures and independent cleanup; STOP.
A pass does not authorize production installation, shared ingress/admission, secret setup, Sarvam tool changes,
deployment, recordings, Calendar appointments or real calls. Process-restart durability remains a separate gap.
