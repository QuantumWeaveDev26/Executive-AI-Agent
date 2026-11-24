# Step110 — backup/isolated-restore preparation plan

## Current checkpoint: local failure-diagnostic investigation

The one-time backup attempt failed in preflight; approval consumed. Confirmed category loss in transport; implemented exact-enum diagnostics
and separately locked host-only diagnostic mode, without executing it. See PHONE_BACKUP_DIAGNOSTIC_APPROVAL.md for revised scope.
No environment/SQL repair authorized. Prior backup execution text below is historical. Both revised manifests remain false.
Corrected timeout probe passed on the VPS. Second backup attempt then failed at database_metadata; client-environment defect reproduced locally, corrected
and re-pinned. Owner-approved local synthetic rehearsal (`scripts/phone_backup_local_rehearsal.py`) then verified the real runner end to end after three comparison
corrections. Approved VPS run then VERIFIED backup and isolated restore (35 tables, restore container removed). Approved migration run then applied and post-verified persistent 110a/b/c
after a fresh verified backup. Calling stays disabled; credentials, startup wiring, Instant Outbound verification, deployment and the first call remain separately gated.

Goal: one reviewable, disabled-by-default rehearsal package for the verified pilot source. Local preparation/testing only; no source/restore SQL
or infrastructure execution until explicit backup approval. Continue task110, preserve all dirty work and existing integrations.

- [x] Implement a standard-library Python runner with fixed source container/image/database, root/path/resource checks, read-only snapshot,
  private custom dump and no-password globals, same-snapshot counts/schema, one network=none/tmpfs-only restore, comparison and exact-ID cleanup.
- [x] Verify independent actual mount evidence before restoring any archive or SQL. Refuse foreign servers/subscriptions/event triggers/custom
  tablespaces, unknown extensions/role settings or roles conflicting with the unique restore bootstrap. Do not copy source login passwords.
- [x] Add pure/mock tests for source/restore boundaries, mount rejection, snapshot use, safe dump normalization, private path refusal and owned cleanup.
  Tests must not execute Docker, SQL, remote access or read real credentials. Compile with the existing bundled Python runtime.
- [x] Prepare a separately pinned agent-only transport entry point with the existing reviewed auth mechanism, default locked and no plaintext key file.
  Preserve the previous preflight helper/manifest unchanged; use a distinct backup flag, payload and manifest, no arbitrary script parameter.
- [x] Perform focused code/security review and fix findings. Record checksums, exact commands/paths/budgets/cleanup/retention and approval scope.
- [x] Present ONE exact backup+isolated-restore request. No persistent migration, source restore, deployment, live-switch change, call or retry included.

Resource proposal: source DB <=128MiB; free disk >=2GiB and available RAM >=1536MiB rechecked; restore memory768MiB/CPU1/tmpfs data512MiB,
socket16MiB/tmp32MiB/shm64MiB; networknone/no ports/no existing mounts; cached pinned PG16 only. Source snapshot/dump <=120s; rehearsal deadline600s.
Backup folder: a new root-owned0700 child under `/opt/thaara-v2-pilot-private/phone-backups`; files0600. Retain backup, never auto-delete it.
Retention proposal7days minimum and until the owner separately approves disposal; no automatic removal. New fixture alone removed by ID/label.

Known source ID340a0ab86ef4156d87651433676978473f58c82b32e1fa4c279664261ace7893/image721873…0ea. DB name from local deployment evidence must be
confirmed read-only inside the approved run; an unexpected source identity/version/budget ends the run before backup/fixture creation.

Prepared artifact only. Final approval scope: docs/integrations/phone/PHONE_BACKUP_RESTORE_EXECUTION_APPROVAL.md. Both execution gates remain false; no remote or database operation performed.
