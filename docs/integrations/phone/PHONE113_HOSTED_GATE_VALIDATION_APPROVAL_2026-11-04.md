# Phone inbound — one disposable validation of hosted installation gates

Status: CONSUMED — one explicitly approved execution completed9/9 PASS, cleanup VERIFIED.

320 source pins verified; exact reviewed-access command ran ONCE and exited0. Base0001–0012 applied
only in the new disposable database. All nine cases passed, including case05/08 applying112h/113h.
Owned container/network removal, destroy evidence, free port and relay closure verified. Used/fixture/result
retained. No VPS/provider/live changes. Do not reset/reuse this approval. See
`PHONE113_HOSTED_GATE_VALIDATION_RESULT_2026-11-04.md`. Original reviewed scope follows.

## Exact new approval requested

Approve ONE execution using the development tool's separately reviewed Docker access:

```powershell
node scripts/phone-inbound-hosted-gates.review.mjs --approved-hosted-gates --manifest-sha256 76b126c1cb3fa0e3a20fec8b8b3af292769fad6c9c5839d9847c2582e117649a
```

Manifest `PHONE113_HOSTED_GATE_VALIDATION_V1.review.json` pins320 source/evidence files. Verify every
checksum before infrastructure. One-use NEW cache `node_modules/.cache/phone113-hosted-gates-v1`;
exclusive used/fixture/result files, no reset/reuse of previous approvals. Stop on any mismatch or
unexpected failure. No automatic retry, SQL repair, source revision, fallback or gate bypass.

## Isolated environment and exact resource scope

One NEW disposable local PostgreSQL16 container `thaara-phone113-postgres-review`, one NEW internal
network `thaara-phone113-network-review`; refuse occupied names. Fresh temporary passwords, existing
reviewed immutable image only, no pull. No existing container/database/network/volume modified.

The NEW disposable database is deliberately named `thaara_vps_pilot` to exercise the exact target gate.
It is NOT the VPS database. No SSH, remote context or inherited database connection is permitted.
Admin connections are only through the verified owned listener127.0.0.1:15436 into the immutable
new local container. The wrong-database test connects only to that same new container's built-in
`postgres` database. Never target an existing application database because it has the same name.

Reuse complete ownership/image/labels/internal-network/read-only-root/actual-kernel-tmpfs checks.
No host directories, persistent volumes or Docker published ports. Preflight port bind-and-close
probe is disclosed; start the actual data relay only after full isolation validation. Require actual
loopback address, fixed verified local Docker npipe and immutable owned container target/internal5432.
Maximum16 owned tunnels; no silent direct-publication fallback or metadata rewriting. Resource bounds
remain768MiB,1CPU,128PIDs with reviewed tmpfs limits. Passwords never printed or placed in argv;
temporary bootstrap password exists in the new container configuration until verified removal.

## Exact SQL and nine tests

Parent applies ONLY the twelve reviewed base migrations0001–0012. It does not install112r/113r or
provision role passwords/LOGIN. The separate plan/proof selects only the new nine-case test file.
Each case revalidates isolation before opening a fresh bounded SQL session; closes that session/pool
before subsequent Docker inspection. All SQL below is confined to the NEW disposable container.

1. Missing112h approval: refusal, catalog unchanged.
2. Wrong database: with approval, refuse112h in the new container's `postgres` database; unchanged catalog.
3. Substituted installer: SET ROLE thaara_app, refuse112h; RESET ROLE; unchanged catalog.
4. Unsafe base security: temporarily set fixture thaara_worker BYPASSRLS then restore NOBYPASSRLS;
   temporarily remove FORCE RLS on fixture memberships then restore FORCE.112h must refuse each state;
   final catalog must match baseline. These deliberate negative fixtures are NOT production repairs.
5. Approved112h: apply unchanged hosted-review candidate; verify protected journal and expected columns.
6. Duplicate112h: refuse adoption; catalog unchanged.
7. Missing113h approval and policy collision: refuse; create only synthetic
   `phone_principal_fixture_collision` policy on fixture memberships, verify refusal, then drop only
   that fixture policy; final catalog unchanged. No DROP CASCADE or deletion of data.
8. Approved113h after112h: apply reviewed candidate; verify NOLOGIN/restricted roles, forced RLS,
   guard function ownership, app execution denial, ingest capability and revoked schema CREATE.
9. Duplicate113h: refuse adoption; catalog unchanged.

Expected gate refusals must have SQLSTATE P0001, rollback and matching catalog fingerprints. Any
unexpected success/error/state change fails the case and stops the suite (`--bail=1`). Parent records
finite failed-case numbers, never raw SQL/credential errors. No provider adapter, user/customer data,
phone call, message, appointment or recording operation. Wrong PostgreSQL major-version rejection
remains statically checked, not runtime-proven against a second unapproved image.

## Cleanup and retained evidence

Await owned SQL child termination and close all owned relay sockets/tunnels/listener before deletion.
Unverified termination blocks resource removal. Verify immutable IDs/labels before removing only this
run's container/network. Independently verify absence, owned destroy event and free15436. On uncertainty,
stop and report retained owned resources; no broad cleanup or repair.
Preserve NEW used/fixture/result receipts and all previous consumed evidence.

Report base migration results separately from case05/08 hosted SQL installation results, nine case
counts/failures, transport proof and cleanup. One execution consumes this approval regardless of outcome.
Successful local validation does NOT authorize persistent migration, credentials, hosting exceptions,
backup/restore, runtime activation, provider configuration, deployment, service restart or live calls.

## Local preparation evidence

Fresh171/171 local tests PASS,18 runtime cases skipped (nine previously verified journal tests intentionally
not rerun, nine NEW hosted-gate cases awaiting this approval). API typecheck, syntax, candidate text and
whitespace checks PASS. Receipt `node_modules/.cache/phone113-hosted-gates-preparation-20261104.json`.
Independent security review found no concrete blocker. Source-only manifest verification PASS;
new used marker absent. No shared application/WhatsApp/worktree source changed; no commits/pushes.

Explicit approval wording: “I approve one disposable local hosted-gate validation run, including new
Docker infrastructure, the reviewed base and112h/113h test SQL, nine cases, reviewed access and cleanup.”
