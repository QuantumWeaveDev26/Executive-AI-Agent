# Step113 — one approved diagnostic completed; service save still FAILED

3 November2026. Owner answered “continue” to the exact one-attempt diagnostic request. Ran once:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-inbound-principal-diagnostic.review.ps1 -ApprovedInMemoryPhone113Diagnostic
```

## Confirmed evidence

- All108pins matched; manifest65e1a5…46ae, wrapper51abf6…2eb7 and unchanged113SQL318eee…1680 matched.
  No previous diagnostic marker, observation, cleanup/result artifact or old/new active gate existed.
- Marker23:10:37IST, teststart23:10:40IST, duration9.13s, exit0. Exactly one diagnostic case completed.
- Twelve pinned base migrations and unchanged112/113 applied only inside one NEW memory-only engine; exact
  approved base set checked before construction and captured SQL only executed. No additional file discovery.
- Exactly one first callback append attempted; completionAttempts:0,providerRequests:0.
- Sanitized observation:outcome failed; phase timeouts; category schema; SQLSTATE **42601**; local check null.
  This identifies a syntax rejection in the timeout-setting operation before role metadata/validation, grant
  resolution, policy work or report insertion. No service-save receipt was returned.
- Diagnostic test1/1PASS means evidence capture completed, NOT that callback save or acceptance passed.
  Original acceptance remains0passed,1failed,9notrun. No completion, paid action or full acceptance retry occurred.

## Cause: confirmed boundary and suspected mechanism

Confirmed: the adapter's single query at the timeouts phase contains three statements:

```sql
SET LOCAL statement_timeout='3s'; SET LOCAL lock_timeout='1s'; SET LOCAL idle_in_transaction_session_timeout='5s'
```

`packages/db/src/pglite.ts` forwards query calls directly to the embedded engine's query API. The diagnostic
records42601for that operation. The role checks and the new grant/append SQL have NOT yet been exercised.

Suspected: the query API's single-statement/prepared execution path rejects the combined three-statement string.
The finite diagnostics intentionally omit raw messages, so that exact engine message is not retained. Do not
claim an RLS or grant-schema defect from this observation. No SQL schema correction is justified by this evidence.

Minimum proposed correction: issue the three existing SET LOCAL statements as three separate awaited queries,
in the same transaction and with identical values. Add a database-free mock that rejects multi-statement query
strings to demonstrate the mechanism and verify order. Preserve BEGIN/rollback, role/RLS, grant checks, timeout
values, commit uncertainty, cleanup and all one-use guards. This correction has NOT been implemented.

## Cleanup and retained evidence

- Observation:`node_modules/.cache/phone113-diagnostic-observation-v1.json`, independently read back.
- Cleanup:`node_modules/.cache/phone113-diagnostic-cleanup-v1.json` reports engineCreated:true,closed:true, written
  only after awaiting engine close. Test child and wrapper exited0. Engine had no path, pool URL or disk database.
- Execution:`node_modules/.cache/phone113-diagnostic-execution.json`.
- Marker:`node_modules/.cache/phone113-diagnostic-v1-used.json`, scopein-memory-only, matching approved SHA.
  Preserve it. Approval is CONSUMED; never reset or reuse it.
- Old and new execution flags independently confirmed absent. Postrun108-file checksum checkPASS; the checker
  itself executes no SQL. Original113failed receipts/manifest/marker and earlier111/112markers retained.
- No Docker, port, volume, existing database, VPS, provider, credentials or live integration was accessed or changed.
  No calls, messages, appointments, deployment, commit or push. Same branchdev-thaara-continuation HEAD413f5a5;
  existing dirty work preserved. SQL111/112/113 and vite.config.ts unchanged.

## Next boundary

Stopped after the single diagnostic, as approved. Recommend the minimum LOCAL runner-only correction and mock
verification above. Any further database execution needs a NEW exact checksum-pinned approval package; do not
retry the diagnostic or acceptance command under the consumed approvals. Do not weaken timeout or RLS checks.
