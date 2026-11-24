# Phone110 — ONE persistent 110a/b/c migration on the pilot database

## Execution record — VERIFIED; authorization consumed

31 October2026: owner replied "Yes, run it once". Pins checked, gate true for one attempt, ran once in background, manifest restored in finally. Exit0, status=verified, migrationStatus=verified,
applied 110a/110b/110c, post-check verified, source identity unchanged, providerCalls=0. Pre-migration backup verified with isolated restore (35 tables):
/opt/thaara-v2-pilot-private/phone-backups/phone110-20261031T074616Z-42f07591becbc014d246b60b888fd272 (archive SHA256 4c24c3c8…7752b). Retain >=7 days and until separate disposal approval.
Do not rerun; the runner refuses a migrated target. The text below is the scope as approved.

PHONE_MIGRATION_110.review.json pins the transport, runner and all three SQL files; remoteExecutionAllowed=false.
This changes the live pilot database permanently. It does not enable calling, deploy code, restart services, set credentials or contact a provider.

## Exact proposed command — separate explicit approval required

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-backup-restore.review.ps1 -ApprovedMigration
```

Operator: `pwsh` is not on the Claude session PATH; use `%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe`, same arguments, in the background
(SSH budget 900s exceeds the 600s foreground limit). The manifest now has two spaces after the gate's colon, so flip the gate by JSON-aware or whitespace-tolerant edit and restore original bytes in finally.

## What it does, in order; stops at the first failure

1. Verify all five pins before authentication; refuse altered SQL before any database work.
2. Fresh backup and isolated restore through the same verified path. No migration unless status=verified and cleanup verified. Backup retained >=7 days and until separate disposal approval.
3. Read existing state; refuse if any phone table, column or role already exists.
4. Apply 110a, 110b, 110c as postgres, each in its own transaction with its own approval settings (lock_timeout 3s, statement_timeout 30s, 60s client deadline).
5. Post-check: existing table, column and role fingerprints unchanged; forced RLS on all three tables; zero phone rows; guard role not login/superuser/bypassrls; three SECURITY DEFINER functions;
   thaara_app can INSERT but not DELETE contacts; PUBLIC cannot read contacts or execute the callback function; source container identity unchanged.

## Failure behaviour and known limits

- Each file commits alone. A failure can leave 110a, or 110a+110b, committed. The receipt reports what exists. There is no retry or rollback, and this runner refuses a target that is not clean, so continuing needs a separately reviewed forward repair.
- The most likely failure is a 3s lock timeout on a busy table. WhatsApp traffic is low, but this is not impossible. Waiting transactions are not cancelled.
- No 110c rollback exists; never run DROP CASCADE or an older-backup restore over the pilot based on this plan (see PHONE_RUNTIME_SECURITY_AND_RECOVERY.md section C).
- Running API health is not checked by this runner beyond the database container. The existing API does not use the new objects. Check WhatsApp in the pilot afterwards.
- Excluded: deployment, startup wiring, live switch, credentials, Sarvam requests, calls, messages, n8n or other integration changes, commit/push.

## Local evidence (31 October 2026, throwaway synthetic databases only)

`scripts/phone_migration_local_rehearsal.py`, real runner with real docker/psql/pg_dump/pg_restore on the pinned image ID, pilot bundle + 10821 + 10825:
- Full flow: backup verified, 110a/b/c applied, post-check verified. thaara_app with no session sees 0 rows and DELETE is denied. Existing data unchanged.
- A later backup and restore of the migrated schema verified, after adding one exact reparse-equivalent line for phone_contacts. Second migration refused at precheck with no SQL run.
- Lock held on approval_requests: 110a committed, 110b failed, receipt and an independent query agree. Temporary containers and volumes all removed.

Focused tests: Python41/41, transport14/14, bounded-process5/5 =60/60. NOT covered: real pilot data and concurrent traffic; Linux-only checks and SIGALRM deadlines (shimmed on Windows);
the historical 8/8 acceptance suite was not rerun on the full pilot schema; review was by the implementing session, not an independent reviewer.
