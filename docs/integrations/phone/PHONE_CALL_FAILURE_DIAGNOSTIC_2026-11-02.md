# ONE read-only diagnostic — failed call2November2026,13:54IST

## Execution record — approved once, completed, authorization consumed

Owner replied proceed. One pinned execution exit0/statusverified/readOnlytrue;2Nov13:54:27IST failed/dispatchfailed with
PHONE_DISPATCH_HTTP_402, hasProviderRequestIdfalse and one failed state event. DatabaseWrites0/providerCalls0/callsPlaced0.
Strict host handshake verified, gate resetfalse. Independent local cleanup: agentPID16432 absent, exact owned temp
thaara-phone-agent-7a1bfba801ba40a88c0c2d56042789a8 absent, source hashes unchanged. Sanitized attempt/cleanup receipts under
node_modules/.cache/phone-call-diagnostic-nov2-{attempt,cleanup}.json. No retry or other remote action. Scope below is historical,
not authorization for another run. Next owner checks Sarvam organisation billing/credits; actual account balance unverified.

Prepared locally only. Remote execution NOT authorized. Screenshot confirms a failed2Nov13:54 call and completed31Oct18:07/18:09 entries.
This supersedes the owner's initial older-record classification for the latest history row. Current failure cause unknown; no credential reset,
new call, retry, deployment or restart justified from the screenshot. Chat/Gmail/Calendar owner-confirmed working; preserve them.

## Exact approval requested

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-backup-restore.review.ps1 -ApprovedPhoneCallDiagnostic
```

Verify both current SHA256s in PHONE_CALL_DIAGNOSTIC.review.json and its fixed13:54–13:55IST2Nov window before authentication. Require
gatefalse; only after explicit one-run approval set THIS manifest gate true, execute once, restorefalse in finally and verify exact owned agent
PID/temp directory cleanup independently. Strict existing trusted-host fingerprint, encrypted-key memory-only temporary-agent method unchanged.
No plaintext private key files; no new key or credential enrollment. Stop on unexpected error; no automatic retry/repair/fallback.

Remote payload reads ONLY the existing pilot database in BEGIN READ ONLY with default_transaction_read_only=on and10s statement timeout,
60s client timeout. No DDL/DML/migration or server setting changes. No provider request, call, file/configuration change or service restart.

Query is limited to live calls created >=2026-11-02T13:54:00+05:30 and <13:55:00. Workspace/owner explicitly joined through membership:
workspace name "Thaara Pilot Synthetic 10812", owner display name "Pilot Synthetic Owner", roleowner, unique matching membership required.
These labels come from the supplied screenshot. Ambiguous/missing scope yields no rows; that is inconclusive, NOT proof of a provider error.
Events join workspace AND owner AND call. At most21call rows selected; >20refused. Output includes only timestamps, state, dispatch status,
sanitized dispatch code, boolean provider-attempt-ID-present and event kinds/states/sequences. No numbers/names/emails/purpose/transcript,
provider IDs, secrets, environment or raw DB/stderr printed. Both Python and PowerShell enforce exact timestamp window and safe output fields.

## Local changes/evidence

Existing diagnostic was pinned to31Oct, so narrowed SQL and both output validators to the pictured2Nov minute. Added workspace/owner predicates,
unique-scope guard and row-limit refusal. Shared SSH helper changes ONLY its call-diagnostic receipt date pattern; no other mode/auth/cleanup
behavior changed. Refreshed14matching locked helper-source pins, preservingfalse gates; current call payload separately pinned. Previous
approvals remain consumed; hash updates grant no remote permission. Original standalone agent-only preflight helper untouched.

Pure/mock Python5/5 and extracted PowerShell sanitizer4/4 passed after negative tests demonstrated the old date rejected the current window.
Focused shared transport27unique checks passed:25initial +2unchanged focused rechecks after local Python/Git launch restrictions; total36
covered checks, not a single all-green transport command. Reports in node_modules/.cache/phone-call-diagnostic-nov2-transport-tests.json,
phone-call-diagnostic-nov2-transport-recheck.json and phone-call-diagnostic-nov2-summary.json. No Docker, SQL, SSH,
provider or real credential use in local tests. SQL itself has NOT run against PostgreSQL in this preparation; actual result remains unknown.

After one approved result, diagnose the specific stored failure code before proposing any provider/credential/configuration change. No new
real call until separately approved, with consent/owner approval/one dispatch/daily5/five-minute/no-redial/audit controls preserved.
