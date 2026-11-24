# Phone110 — proposed ONE database-free host diagnostic

Local preparation only. NOT authorized/executed. Previous backup approval is consumed; do not rerun its command.

## Confirmed local finding and limitation

Python's failure receipt contained category; PowerShell constructed a new receipt with only phase. Confirmed in source and reproduced
with synthetic receipts. Minimum correction: map exceptions to fixed categories, retain category plus static failed-check name across the
transport, and redact everything else. Unknown input becomes unclassified_failure/unknown; never print arbitrary exception text, stdout,
stderr, paths, environment, database results or server metadata. Missing command, permission denial and timeout now have distinct labels.

The original preflight covered host checks AND read-only database metadata, so a successful host-only diagnostic would NOT prove database
preflight, backup or restore readiness. No environmental repair/tool installation is proposed.

## Probable root cause found locally (31 October, after the handover): BusyBox timeout

The local cached postgres:16-alpine has the SAME immutable image ID as the pinned pilot source (sha256:721873c3…). Its timeout is BusyBox:
`timeout --version` exits 1 and writes to stderr, so the old probe would always fail, on that exact image, before any database step. This is
the first step after the host checks the earlier approved preflight passed. Probable cause of the failed attempt, NOT proven on the VPS: the
consumed receipt holds only phase=preflight. Without this fix the diagnostic below would predictably fail at deadline_tool.

Correction: probe `timeout -k 1s 5s true` (exit 0, empty output), the same flag form the source clients use. Local real-image evidence: probe
exit 0/no output; `--version` exit 1; 1s deadline exit 143; SIGTERM-ignoring child killed after grace, exit 137; child failure propagates; the
reviewed runner treats any non-zero status as failure and has no exit-124 dependency. Python hash re-pinned in BOTH manifests; both gates false.
Disposable local containers only (--rm, --pull never, --network none); no database started/queried, VPS or provider contact.
Operator note: `pwsh` is not on PATH in the Claude session; the reviewed runtime is
`%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe` (arguments unchanged).

## Exact proposed command — separate explicit approval required

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-backup-restore.review.ps1 -ApprovedHostDiagnostic
```

Separate manifest PHONE_BACKUP_DIAGNOSTIC.review.json pins BOTH executable artifacts and exact command; remoteExecutionAllowed=false.
Before authentication verify pins and locked Boolean gate. Only after one-run approval set THIS diagnostic gate true, execute once,
restore false in an operator finally and independently verify local cleanup. Backup manifest stays false; flags cannot be combined.
Changed sources invalidate the previous backup package hashes/approval; any future backup needs a new reviewed approval.

## Exact allowed remote scope

Fixed stdin interpreter: python3 -I -S -B - --approved-phone-host-diagnostic. Existing encrypted dedicated key, memory-to-stdin temporary
agent only; existing strict trusted-host pin and public-key verification, no enrollment/config/key changes/plaintext private-key files.
No arbitrary command or script argument. Reuse ONLY the fixed source container/image identity pins already in the reviewed manifest.

1. Require Linux, Python>=3.8 and root identity; no installation.
2. Docker source metadata: exact fixed container ID/name/image/project/service/running/healthy/restart checks through the existing validator.
   Return only pass/fail category/check name, never raw inspect output or container settings.
3. Verify cached image by immutable local ID; no pull or mutable tag.
4. Existing source container: run only `timeout -k 1s 5s true` as postgres to check the required existing deadline tool. No database client,
   SQL, timeout installation or capability change. Output stays in memory, not in reports. The Docker subprocess timeout is preserved.
5. lstat protected parent paths (/, /opt, /opt/thaara-v2-pilot-private), require original root ownership/no unsafe permissions/no symlink.
   No mkdir, chmod, chown, backup-directory traversal or backup creation.
6. statvfs protected parent for the existing >=2GiB free budget and read ONLY MemAvailable from /proc/meminfo for >=1536MiB budget.
   Return pass/fail only, no host metrics or paths in receipt.
7. Reinspect exact source identity/status and require equality; stop at first failure, no automatic retry/fallback/repair.

Host-only control flow returns BEFORE Snapshot, any PostgreSQL invocation, dump, filesystem write or restore/container creation.
Remote overall deadline120s; SSH child180s; existing bounded stdout/stderr readers/owned-child termination unchanged. Reports contain only
typed status, fixed category/check name and booleans (databaseAccessed=false, resourcesCreated=false, sourceMutated=false, providerCalls=0).

## Cleanup and exclusions

No remote container/network/volume/directory/file/backup is created, so none may be deleted. Finally terminates only this run's exact local
temporary agent and removes its owned protected public known_hosts/socket/temp directory. Independently check its exact PID/path absent
and diagnostic gate false; if proof fails report unverified and stop. Save sanitized local receipt. No second SSH/diagnostic attempt.

Excluded: ALL database commands, backup/restore, migrations, credential/config/service changes, provider/Sarvam requests, calls, image pull,
deployment, commit/push, WhatsApp/n8n/Gmail/Calendar/Sarvam inbound changes. No successful diagnostic authorizes backup or production work.

## Local evidence

31 Python pure/mock cases, 11 transport tests, 5 synthetic bounded-process checks passed (47 total, fresh on the corrected source). Negative
tests first reproduced missing category/mode and the GNU-only probe, then passed after correction. Tests never read real credentials, authenticate, access Docker/SQL/VPS or contact a provider.
Python compilation/default review-only and final pinned-source/gate checks also pass. Actual remote cause and recovery remain unverified.
