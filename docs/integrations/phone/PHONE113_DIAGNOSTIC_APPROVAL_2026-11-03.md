# Step113 — separate one-attempt diagnostic approval

Status: CONSUMED. Owner answered “continue” to the exact diagnostic approval request. One execution completed
3November2026; service save FAILED at timeouts with SQLSTATE42601. Engine closed; no repair or retry.
See `PHONE113_DIAGNOSTIC_RESULT_2026-11-03.md`. Original113acceptance approval remains consumed.

## Exact proposed execution

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-inbound-principal-diagnostic.review.ps1 -ApprovedInMemoryPhone113Diagnostic
```

ONE attempt only, to identify the failed first-save phase. No completion, full acceptance suite, automatic retry
or repair. If the save unexpectedly succeeds, stop there; that is not acceptance or activation evidence.

- Manifest `PHONE113_DIAGNOSTIC_APPROVAL.review.json`:108pinned files, SHA256
  `65e1a5bfa8723b4942e8b76caba405ecae04f7d3d60828c93557bcef675346ae`.
- Wrapper SHA256: `51abf62eb71d610805a3ddac0b2073f65c96ac0d74af8d996bfe9cf6ffb42eb7`.
- UNCHANGED113SQL: `318eee1bad52b2674b1af21a186723e6c76d0433e247cacc0c4d983f61711680`.
- UNCHANGED112SQL: `d5c6a338b2bddba4e70bd527e8b0601b8bfe47602f3e46fc6306cc937adbbd8a`.

## Scope and evidence handling

Before execution verify all pins and the exact base migration set. The fixture rejects extra/missing/renamed
migrations before constructing an engine, captures hash-verified SQL in memory and executes ONLY that captured
list. Base files are exactly0001–0012, plus unchanged112and113. No directory-discovered extra SQL may execute.

Create one NEW pathless PGlite memory database, apply only those reviewed schemas, provision synthetic users
and a fresh memory-only credential, assume the non-owner fixture identity and attempt only the first callback
append. This includes the existing permission/grant/policy/save checks with all guards, limits, timeouts and
transaction cleanup preserved. No changes to the SQL or permission policy are authorized. No existing database,
Docker infrastructure, port, persistent storage, VPS, provider, real caller or other integration is accessed.

Optional test-only instrumentation retains ONLY finite phase/category/SQLSTATE/local-check codes. It never
retains raw error messages, SQL, identifiers, credentials, request bodies or provider/customer data. Observer
failure cannot prevent rollback; commit uncertainty still discards the connection and returns no saved receipt.
Capture root and any secondary cleanup phase separately. A missing diagnostic signal is a failure, not success.

## Stop, cleanup and retained artifacts

- New CreateNew marker:`node_modules/.cache/phone113-diagnostic-v1-used.json`; never delete/reset it.
- One sanitized observation:`node_modules/.cache/phone113-diagnostic-observation-v1.json`, written with exclusive
  create. outcome is saved/failed/setup_failed; a successful diagnostic test may record a FAILED service save.
  Do not report diagnostic completion as a passing feature acceptance.
- Close hook writes `phone113-diagnostic-cleanup-v1.json` only after awaiting the memory engine close (or closed:
  false on close failure). Independently inspect it plus process exit and approval-flag absence.
- Runner result:`node_modules/.cache/phone113-diagnostic-execution.json`.
- Refuse existing observation/cleanup/result files, old/new active gates or an existing marker; never overwrite.
- Clear only this wrapper's temporary `THAARA_PHONE113_DIAGNOSTIC_APPROVED` flag in finally. Preserve all old
  markers, manifests and failed113receipts; their hashes are included in the new manifest. Original consumed113
  source pins are historical and may now be stale because instrumentation changed; never regenerate them.
- No persistent resource exists to delete. Preserve diagnostic evidence. Stop after this single probe even on
  success. Any SQL repair, new engine or acceptance retry requires separately scoped approval.

## Local verification already performed

45database-free tests PASS, one diagnostic engine test SKIPPED (no approval). API typecheck/build PASS; wrapper
PowerShell parse and108-file checksum preparation/check PASS. Static review found and fixed the unlisted-file
scope risk in the new diagnostic harness; SQL files remain unchanged. Root cause remains UNKNOWN until a fresh
authorized diagnostic obtains evidence. No database or SQL was executed during this preparation.

## Approval request

Approve ONE execution of the exact command, using only the new memory-only database,12pinned base fixtures and
unchanged112/113SQL, fresh synthetic credential, one callback-save attempt and sanitized diagnostics, then close
the engine and verify cleanup. No SQL repair, full acceptance retry, provider request, persistent migration,
deployment, credentials on existing systems, real calls/messages/appointments, Gitcommit or push.
