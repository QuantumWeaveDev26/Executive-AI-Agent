# Phone113 — one local read-only preflight diagnostic

Status: CONSUMED. Owner approved “procced”;305 pins verified and exact command executed ONCE.
Stopped at `container_inventory / operation_failed`. Context admission and port bind/close completed.
No container/network/database created, no SQL/provider request. Used/result retained; never reset/retry.
Result: `PHONE113_PREFLIGHT_READONLY_RESULT_2026-11-04.md`. Original scope follows as historical evidence.

## Confirmed defect and correction

The consumed acceptance receipt identifies only `preflight`, not the underlying failed check.
Confirmed source mechanism: source verification, context parsing, availability probe, name inventories
and image inspection could throw unlabelled errors; lifecycle diagnostics retained SQL/isolation/relay
fields only. The original environmental failure cannot be recovered from this receipt.

Local correction labels these six boundaries with finite categories and adds the allowlisted category
to lifecycle reports. Errors retain no raw stdout/stderr, endpoint, filesystem path or secret. Checks,
timeouts, ownership, cleanup and transport restrictions remain. Invalid image IDs now fail within the
labelled image boundary before lifecycle admission. No failed command is retried.

Fresh34/34 mock tests PASS across four files; whitespace check PASS. Tests cover timeout, missing
command, permission denial, occupied port, invalid JSON/validation, hostile diagnostic getters,
command-boundary propagation and failure before resource creation. Receipt:
`node_modules/.cache/phone113-preflight-diagnostics-final-20261104.json`.

## Exact new approval request

Approve ONE execution, from the existing project root:

```powershell
node scripts/phone-inbound-preflight-readonly.review.mjs --approved-readonly-preflight --manifest-sha256 b095a68e51c22dcc11142c3a62ba98de59d75273b9e0e6515167497bdfcc54f4
```

305 source pins in `PHONE113_PREFLIGHT_READONLY_V1.review.json`. Verify all pins before operations.
Consumed manifests, used markers and previous results remain unchanged and cannot authorize this run.

## Exact access scope and operations

1. Read pinned local project files and write only NEW one-use diagnostic marker/result files below.
2. Read Docker context endpoint with `docker context inspect --format '{{json .Endpoints.docker.Host}}'`.
   Require one of the two existing allowlisted local Windows named-pipe endpoints. Never print it.
3. Bind `127.0.0.1:15436` solely as an availability probe and immediately await close. No data relay.
4. At the verified endpoint, read `docker --host <verified-local-endpoint> ps -a --format '{{.Names}}'`
   and reject an existing `thaara-phone113-postgres-review` name.
5. Read `docker --host <verified-local-endpoint> network ls --format '{{.Name}}'` and reject an existing
   `thaara-phone113-network-review` name.
6. Read `docker --host <verified-local-endpoint> image inspect --format '{{.Id}}' <pinned-image>` using
   the exact image from the pinned INBOUND_RUNTIME/PHONE_RUNTIME source. Validate SHA256 identity.

All Docker subprocesses retain30-second bounds. Stop at first failure, no retry/fallback/repair.
Expected output: booleans for integrity/local engine/available names/free port/image identity, OR
one finite check/kind pair. No inventory, image/container IDs, raw errors, credentials or payloads output.

Only NEW retained files: `node_modules/.cache/phone113-preflight-readonly-v1.used.json` and
`phone113-preflight-readonly-v1.result.json`. Exclusive creation prevents repeat execution.
No container/network/database creation or removal, image pull, mount/volume change, SQL, service restart,
VPS connection, provider request, simulation, call, deployment, commit or push. Preserve all integrations.
Constructor-generated unused fixture passwords remain in memory; none are provisioned or reported.

After execution report the exact boundary/category and safest remedy. A successful diagnostic does NOT
authorize another database run. Any retry/infrastructure/SQL requires a new scoped acceptance approval.
