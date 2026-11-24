# Approval request — ONE isolation-only disposable PostgreSQL diagnostic

Status: CONSUMED. Owner replied “okay procced”; exact command ran ONCE4November2026,11:35:55IST.
Stopped at actual_ports/validation_failed; no Thaara SQL/tests. Owned cleanup verified, exit1. No retry.
See `PHONE113_ISOLATION_DIAGNOSTIC_RESULT_2026-11-04.md`. Original reviewed scope retained below.

## What is confirmed

The previous run stopped at its first isolation gate and removed its owned resources. No Thaara migration
or acceptance case ran. Its facts/check category were not retained; the original cause remains UNCONFIRMED.
Local red/green tests confirmed the diagnostic gap and a throwing-getter reporting path. Both are corrected.
The guard's original accept/reject predicates are preserved; no mount, privilege, port or ownership rule relaxed.
An independent read-only comparison with the original checksum-matching guard found no concrete blocker.

Failures now retain finite check/kind codes for collection, invalid JSON, command timeout/failure, identity,
ownership, resource limits, port publication, security options and actual mount verification. No raw Docker
output, command arguments, arbitrary error text, host paths or credentials are retained in diagnostic fields.
The unchanged legacy collector's swallowed actual-port read failure is attributed without accepting null ports.

## Exact proposed command

```powershell
node scripts/phone-inbound-isolation-diagnostic.review.mjs --approved-isolation-diagnostic --manifest-sha256 3fac7f4ee7c078ac3bf11172f48384987c13ea3d40f478e84873684dba690479
```

NEW manifest `PHONE113_ISOLATION_DIAGNOSTIC_V1.review.json`,292pins; SHA256:
`3fac7f4ee7c078ac3bf11172f48384987c13ea3d40f478e84873684dba690479`.
Before infrastructure, verify exact SHA/scope/source set. Any mismatch or stale new artifact stops execution.
This snapshot pins the previous consumed manifest and retained used/result receipts too; never reset them.

## Strict execution scope

1. ONE new disposable local Docker container and ONE new internal network, fresh ownership nonce and credentials.
2. Same proposed test names only if absent: `thaara-phone113-postgres-review` and
   `thaara-phone113-network-review`; database `thaara_phone113_review`; only `127.0.0.1:15436` published.
   Do not adopt, delete or modify a pre-existing resource with those names.
3. Local Docker Desktop Linux named-pipe endpoint; exact already-installed image
   `postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.
   No image pull, remote context, SSH/VPS connection or fallback relay.
4. Read-only root, tmpfs-only data512MiB/runtime16MiB/tmp32MiB; no volumes, host directory mounts or existing
   network attachments.768MiB RAM,1CPU,128PIDs,64MiB shared memory, no extra capabilities/privileged mode,
   no-new-privileges, Docker logs disabled. Verify actual filesystem, ownership and network/port metadata.
5. Fresh test password via environment, never command arguments/output. Docker retains the new container's
   administrator password in its configuration until removal; that configuration field is not inspected.
   PostgreSQL initializes its disposable database normally. Use TCP pg_isready and metadata inspection only.
6. **NO Thaara SQL, migrations, SQL client/pool connection, role/grant/user provisioning or acceptance tests.**
   No provider call, real call/message/appointment, paid test, live routing/configuration or deployment.
7. The entry point restricts the available methods: it does not even read applySchemas/runAcceptance members.
   The lifecycle additionally hardcodes isolationOnly:true. Passing isolation never proceeds to another stage.
8. Stop at first failure. Retain only finite sanitized categories and owned resource identities, then clean up.
   Do not change the inspector, repair configuration, retry, apply SQL or run acceptance in the same approval.
9. Verify exact returned IDs/image/name/nonce ownership before removal. Remove only these new resources.
   Independently check container/network absence, matching destroy event and free15436. Report ambiguity rather
   than selecting resources by name or guessing cleanup success. Existing containers/volumes/services untouched.

Docker commands retain30s bounds; startup readiness is bounded. No test child is started. Cleanup still runs
after failures. The run ends after cleanup regardless of whether isolation passed.

## Retained artifacts and stop rule

NEW exclusive cache `node_modules/.cache/phone113-isolation-diagnostic-v1/`:

- `used.json`: one-use nonce, manifest pin and start time; never reset.
- `result.json`: scope:isolation_only, finite failure check/kind, owned identities and cleanup proof.

Both paths absent at preparation. Prior `phone113-runtime/used.json` and `result.json` stay untouched.
Existing SQL112/113 and112r/113r, legacy inspector, integrations, user data and uncommitted work preserved.

After execution report observed category, confirmed facts versus hypotheses, and cleanup, then STOP.
A passed diagnostic means only that this new fixture passed isolation; it cannot prove what failed previously,
SQL acceptance, production readiness or live calling. Any further fixture, SQL or acceptance run needs a new
scoped approval. Do not regenerate or reuse the consumed acceptance package.

## Preparation evidence

-95/95local checks passed in9files; receipt `node_modules/.cache/phone113-isolation-diagnostic-final-local-20261104.json`.
-292pins verified by --preflight-only with infrastructureTouched:false/sqlExecuted:false.
-Independent review found no concrete blocker; original validation predicates preserved.
-No Docker/SQL/provider access during this local investigation. Runtime cause remains unconfirmed.
-Original/candidate SQL and legacy collector hashes unchanged. No commit/push/deployment or credential setup.

Owner approval requested ONLY for the single diagnostic command above.
