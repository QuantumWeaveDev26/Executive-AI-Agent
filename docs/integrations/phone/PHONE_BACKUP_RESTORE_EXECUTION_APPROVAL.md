# Phone110 — ONE pilot backup and isolated-restore rehearsal

## Third execution record — VERIFIED; authorization consumed

31 October2026: owner approved one new run at corrected hashes. Exit0, status=verified, 35 tables; counts/schema/owners/ACLs/roles verified; source unchanged; restore container removed
with destruction observed; providerCalls=0. Backup: /opt/thaara-v2-pilot-private/phone-backups/phone110-20261031T073154Z-3e4a7737e3396ce522f60579297965e3 (archive SHA256 9a0a56df…bf993c).
Retain >=7 days and until separate disposal approval. Does not authorize persistent 110a/b/c; take a fresh verified backup immediately before any such migration.

## Second execution record — authorization consumed

31 October2026: owner replied "Yes, run it once" after the host diagnostic passed. Exact command ran ONCE at pinned hashes. Exit1, status=failed,
phase=preflight, preflightStep=database_metadata, category=unclassified_failure. sourceMutated=false, providerCalls=0, no backup folder, archive hash
or restore container returned; cleanup verified. Backup/restore NOT verified. No retry. Reproduced locally on the same image ID with no server running:
`PGSERVICE=` makes psql fail (definition of service "" not found) and `PGPASSFILE=/dev/null` writes a warning that the stderr-strict readers refuse.
Python was corrected and re-pinned; both gates false. A further run needs NEW explicit approval.

## Owner-approved local rehearsal and comparison corrections

`scripts/phone_backup_local_rehearsal.py` runs the real run() and real Docker/psql/pg_dump/pg_restore on Docker Desktop against a throwaway pinned-image source (no network,
tmpfs, random passwords, pilot bundle + 10821 + 10825 + 2000 synthetic rows; no phone 110a-c). Result: status=verified, 36 tables, counts/roles/DB state/schema match, restore
fixture and source removed, no volumes left, source fingerprint unchanged. Corrected false failures found there: built-in pg_* to pg_* memberships are skipped (user-role
memberships stay compared); `--` comment lines are ignored (SQL stays compared, bootstrap name must not appear in restored SQL); one exact reviewed CHECK line that Postgres
re-parses with flattened ANDs is treated as equal. NOT covered: real pilot data, Linux root/ownership/private-file paths and SIGALRM deadlines (shimmed on Windows),
host-specific docker stderr warnings. Any other schema difference on the VPS fails closed.

Current sources were revised under LOCAL diagnostic-investigation authorization after the failed run below. Their refreshed locked manifest
is preparation only, NOT a renewal of the consumed backup approval. Do not retry this command. See PHONE_BACKUP_DIAGNOSTIC_APPROVAL.md
for a separately scoped database-free proposal; no remote diagnostic has run. Below, "GNU coreutils timeout" is historical: the pinned image
has BusyBox timeout, the probable cause of the failed run. The current probe is `timeout -k 1s 5s true`.

## Execution record — authorization consumed

31 October2026: owner approved this package once; exact command invoked ONCE after source hashes matched. Exit1, remote status=failed,
phase=preflight. Trusted-host handshake verified; sourceMutated=false/providerCalls=0; remote cleanup reported true. No verified backup path,
archive hash or restore fixture ID returned; backup/restore/schema consistency NOT verified. Transport omits the remote sanitized error category,
so exact cause remains unknown. No retry/repair/fallback. Both pinned executables unchanged; local gate restored false. Independent local check:
agentPID2664 absent; owned temp thaara-phone-agent-6d8cc9c54dda47f29779b375d02d4ee5 absent. Receipts in node_modules/.cache/
phone-backup-restore-attempt.json and phone-backup-restore-cleanup.json. Any diagnostic execution or further attempt needs separate approval.
The reviewed scope below is retained as historical; it does not authorize another run.

## Original preparation record and reviewed scope

31 October2026, before the approval above: local preparation complete; execution not yet authorized. No database command/backup/container/restore
had run during preparation. The subsequent one-time attempt and its failure are recorded above.

## Exact requested command and gate

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-backup-restore.review.ps1 -ApprovedBackupRestore
```

Verify both SHA256 entries in `PHONE_BACKUP_RESTORE.review.json` before authentication; mismatch stops. Only after explicit approval, set its
LOCAL one-run remoteExecutionAllowed gate to Boolean true, execute exactly once, and reset it false in the operator's finally block on all outcomes.
The previous host-preflight helper/manifest are unchanged and their authorization is consumed. This is a distinct backup approval, not a retry.
The fixed SSH payload interpreter is `python3 -I -S -B - --approved-phone-backup-restore`: standard-library-only isolated execution, no user/site
customizations or bytecode writes, code via stdin rather than installing a server script. Missing Linux/Python>=3.8 stops; nothing is installed.

## Source and permitted reads

- Existing VPS76.13.217.50, strict trusted ED25519 host fingerprint `SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4`.
  Reuse existing encrypted dedicated key through reviewed memory-to-temporary-agent stdin; no private-key file, key/config/enrollment change or fallback.
- Exact observed source container `340a0ab86ef4156d87651433676978473f58c82b32e1fa4c279664261ace7893`, expected name/project/service and healthy state.
  Exact local cached image ID `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`; no image pull or mutable tag.
- Confirm database `thaara_vps_pilot`, PostgreSQL16, size<=128MiB, roles and restricted capabilities using read-only metadata queries inside the
  approved attempt. These DB facts have not yet been queried. Refuse other target/version, unreviewed extensions/settings/tablespaces/FDWs/
  subscriptions/event triggers/large objects/materialized views, bootstrap-role collision or unsafe identifiers. Stop before creating backup files.
- Read-only consistent exported snapshot; count all eligible user tables and dump that SAME snapshot. Source clients are forced to the existing
  Unix socket, no password prompt/passfile/service lookup, readonly/time/lock limits. No source DDL/DML, credentials, migrations or service changes.

## Exact new resources and retained data

- Recheck root-owned no-symlink protected path, free disk>=2GiB and MemAvailable>=1536MiB. Prior host preflight showed53.24GiB/4.07GiB;
  this is not a reservation. Missing `phone-backups` parent may be created0700; never chmod/overwrite an existing path.
- Create ONE new root-owned0700 directory `/opt/thaara-v2-pilot-private/phone-backups/phone110-<UTC>-<32hex-run-id>`; all files verified0600.
  Write custom `database.dump`, full `schema.sql`, `globals.sql` with `--globals-only --no-role-passwords`, private counts/roles/DB-state manifest,
  run/fixture identities, before/after SHA256 manifest and verification result. Files/fs metadata are flushed before success.
  Dumps contain private pilot data/authentication records and remain ON the VPS; no contents/rows/secrets copied to chat or local machine.
  Database-role login passwords are excluded. Retain files at least7days AND until separate owner disposal approval; no auto-delete.
- Create at most ONE new container `thaara-phone-restore-<same-run-id>`, unique `thaara.phone-restore=<run-id>` label, fresh temporary bootstrap
  credentials (not source passwords), same cached image by immutable local ID, pull=never. Built-in network=none, no published ports or new Docker
  network, no existing volume/bind/Docker socket. Read-only root; tmpfs data512MiB/socket16MiB/tmp32MiB, shm64MiB; memory768MiB/CPU1/PIDs128,
  no-new-privileges. Inspect declared AND actual mountinfo/canonical paths and all limits before any dump/restore SQL is fed to the fixture.
- Wait only for the fixture's FINAL server via its own loopback TCP readiness; expected startup-not-ready statuses are bounded polling, not SQL/rehearsal
  retries. Any other warning/error stops immediately. No external network is available to this fixture.

## Reviewed database commands (all source reads; all restore writes only new fixture)

Source command families, exact argument builders and SQL are in `deploy/hostinger-pilot/phone-backup-restore.review.py`:

1. Source `psql -X -qAt -w -U postgres -d thaara_vps_pilot` within REPEATABLE READ READ ONLY; export snapshot and capture metadata/counts.
   Require the existing GNU coreutils `timeout` tool first; no tool installation. Source psql is wrapped in115s with3s kill grace; dump clients
   use only the remaining source-phase budget with5s grace. This bounds the in-container clients even if their Docker frontend disconnects.
2. Source `pg_dump -w -U postgres -d thaara_vps_pilot --lock-wait-timeout=3s --snapshot=<export> --format=custom`.
3. Source `pg_dump ... --snapshot=<same-export> --schema-only`.
4. Source `pg_dumpall -w -U postgres -l thaara_vps_pilot --globals-only --no-role-passwords`.
5. Close the source read-only transaction before restoring. No restore or SQL file is ever targeted at the source ID.
6. Only the new fixture: restore globals with `psql -X -q -w -v ON_ERROR_STOP=1 -U <new-bootstrap> -d postgres`;
   then `pg_restore -w -U <new-bootstrap> -d postgres --create --exit-on-error` from the custom archive. No --clean, ignored errors or dump editing.
   Using a unique bootstrap avoids the existing-postgres-role conflict without skipping any role statement.
7. Read only the restored database to compare snapshot table inventory/counts, role attributes/memberships, database owner/ACL/comment/encoding/
   collation and schema/owners/grants. Hash comparison removes only matching outer randomized pg_dump restrict/unrestrict wrapper keys, never SQL.
   Recheck original source identity/healthy state and backup-file hashes. Archive-list validity alone is NOT accepted as a restore rehearsal.

Restore necessarily executes saved source database SQL, solely inside the isolated fixture. This verifies database recovery, not application/
external-secret recovery, live provider behavior or phone deployment readiness. It does not install110a/b/c into the pilot.

## Budgets, stopping and cleanup

- Source snapshot/backup phase<=120s, metadata/count statements15s and idle120s; pg_dump lock-wait3s and independent in-container client deadlines.
  Native dump tools can change their own session timeouts; the independent deadlines remain enforced. Whole rehearsal<=600s plus bounded cleanup;
  SSH transport<=720s. No source PostgreSQL server process is terminated; timeout owns only its newly created backup client.
  Metadata stdout<=2MiB, archive<=256MiB, schema/globals<=8MiB each; bounded pipe readers prevent unbounded output/disk growth.
  Operator transport caps stdout/stderr while reading and reports only typed flags, paths/IDs, counts/hashes and static failure phases.
- On unexpected failure: STOP. No SQL repair, image pull, increased limit, source restore, automatic rerun or migrations. Keep private backup/evidence.
- Remove only the new fixture after exact ID/image/name/run-label proof; no `-v`, pruning, wildcard/name-only deletion or backup removal.
  If a create response is lost, only cleanup-only discovery by the exact new run label/name is allowed. If no ID can be proved, report cleanup
  UNVERIFIED (do not infer that no fixture exists or retry creation). Retain run identity for owner-approved follow-up.
- Verify exact container absence/destruction event; no host port/network was created. Do not delete/modify any existing container/volume/network.
  Local finally stops only its new agent and deletes only its protected temp public host record/socket/dir. Independently verify those exact PID/path
  are absent and local gate false. If interruption prevents proof, report unverified; do not broaden cleanup scope.

## Verification actually completed — no runtime rehearsal claim

**35 local checks passed:**22 Python pure/mock cases,8 locked transport tests,5 synthetic bounded-child-process tests. Python compilation and
default review-only run passed. Security review findings fixed: use local immutable image ID, bound output DURING reads, asynchronous stdin,
private-file/fsync checks and final-server readiness. Final read-only review found no consequential remaining issue. No real key, agent, SSH,
Docker or SQL was used by these preparation tests. Existing application/PostgreSQL test results are unchanged historical evidence, not rerun.

Explicit approval needed for THIS single backup/isolated restore, its source readonly DB commands, protected backup directories/files and ONE new
restore container/fresh temporary credentials. EXCLUDED: source mutations/restore, persistent phone migrations, existing credentials or services,
VPS/application/n8n/WhatsApp/Sarvam inbound changes, provider requests, campaigns, deployment, phone activation/call, commits/pushes. No automatic retry.
