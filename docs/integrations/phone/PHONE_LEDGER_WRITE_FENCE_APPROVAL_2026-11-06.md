# One isolated permission-correction validation — approval required

V3 passed3/3 and was cleaned up. No V3 retry is proposed. Its authorization excludes this newly
identified permission correction; no new SQL or Docker has been executed during this preparation.

## Exact proposed command (NOT run)

```powershell
node scripts/phone-ledger-write-fence.review.mjs --approved-isolated-ledger-write-fence --manifest-sha256 2bbca001507e47d9dc8b2f0ac7be8625255d1a1e4d7a10d8eb0fb18e5fb1ad3b
```

Manifest: `PHONE_LEDGER_WRITE_FENCE_V1.review.json`
SHA256: `2bbca001507e47d9dc8b2f0ac7be8625255d1a1e4d7a10d8eb0fb18e5fb1ad3b` —310pins.

## Scope

- ONE new disposable local PostgreSQL container and internal network using the existing reviewed
  ownership/isolation/session/relay/cleanup framework; Docker-capable tool context only.
- Pinned existing image `postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`,
  fresh temporary credentials, tmpfs-only data, read-only root, no existing volume, no image pull/build.
- Owned127.0.0.1:15436 relay, no Docker port publication. Refuse any existing fixture/container/network.
- Apply twelve unchanged base migrations only. No112h/113h/110/114SQL or repeated appointment cases.
- New permission-only candidate: `docs/migrations/phone-schema-migrations-write-fence.review.sql`.
  It preservesSELECT and removes6mutation rights on the migration ledger from app/worker/PUBLIC.
  It checks direct/inherited/column/SETROLE authority and aborts if unexpected authority remains.
- Four cases: inspect original grant baseline; missing approval/wrong effective operator refusal;
  actual correction/appdenials/operatorrollbackprobe; SET-only residual authority with atomic rollback.
- Case4 creates exactly one synthetic NOLOGIN role `phone_ledger_fixture_writer`, grants it UPDATE
  on the isolated ledger and SET-only membership to the fixture app role, and restores direct appUPDATE
  solely to prove failed correction rolls its revocation back. All these roles/data are inside the new
  disposable cluster. No existing role or customer database is accessed.
- Actual restricted operations use SET LOCAL ROLE; this is not a new application-login/authentication test.
- Stop on first failure; retain case number/SQLSTATE only. No repair/retry. Settle SQL/child/relay,
  verify exact owned IDs/labels, remove only those resources, independently verify destruction,
  absence, port free and relay shutdown. If ownership/termination cannot be verified, stop/report.
- Retain new cache `node_modules/.cache/phone-ledger-write-fence-v1` receipts. Keep all prior markers,
  captures, source archives and reference evidence. Never reset an old execution gate.

## Verification and limits

51database-free tests PASS;4runtime checks OFF; API typecheck PASS. Local source review found no
concrete blocker in the narrow SQL/runner. This does NOT prove PostgreSQL privilege semantics,
RESTRICT rollback, new SQL syntax or production safety; the proposed run tests those fixture behaviors.
SQL and source inputs are immutable verified snapshots; child must match the parent manifest hash.

No VPS/production access, production migration, service restart/deployment, provider operation,
credential change, real appointment/call/message, WhatsApp modification, commit or push.
Success does not close F03 or activate appointments; final target/reference/driver gates remain.

## Consolidated approval text

“Approve ONE isolated ledger write-fence validation using the exact command/checksum above:
new disposable Docker setup, twelve reviewed base migrations, the permission correction, four
synthetic cases including the temporary fixture role/membership, and verified owned cleanup.
Preserve all prior evidence. No automatic retry or production/provider operations.”
