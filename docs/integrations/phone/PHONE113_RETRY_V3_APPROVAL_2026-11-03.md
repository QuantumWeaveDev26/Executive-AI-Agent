# Step113 — fixture identity verification and ONE new acceptance run

Status: CONSUMED. Owner answered “continue”; exact command ran ONCE3November2026,10/10PASS,exit0.
Engineclosed,37/37fixtureidentitychecks verified, gatecleared, evidence/marker retained. No retry.
See `PHONE113_RETRY_V3_RESULT_2026-11-03.md`. All earlier approvals remain consumed.

## Confirmed gap and local change

Retry-v2passed the callback/completion case but stopped at its fixture audit-count read. The preceding reset
helper did not check effective identity or permissions. Actual identity at that failure was not retained;
the reset mechanism's exact failure remains unconfirmed. No runtime grant or SQL repair is proposed.

NEW fixture-only helper captures the initial test administrator AFTER reviewed schema setup and BEFORE any
runtime switch. Capture requires identical current/session identities, superuser status and audit SELECT
permission. Restoration uses the captured identifier, SQL-quotes it safely and runs separately:

```sql
SET SESSION AUTHORIZATION "<captured fresh-fixture administrator>";
RESET ROLE;
```

It then verifies both identities match the original administrator and checks administrator/audit permissions.
Failure stops before privileged fixture work. No caller-provided name, hardcoded production identity, password,
token or grant is used. Only boolean verification outcomes and allowlisted SQLSTATE are retained; actual names
and raw messages are excluded. Runtime remains denied audit SELECT and direct table access.

Fresh local checks:29/29PASS in3files (6fixture identity,18adapter,5diagnostics). Final fixture6/6PASS and gated
retry-v3 discovery10/10SKIPPED. Static review found no preparation blocker. API runtime and SQL unchanged since
the previously passing typecheck/build; those results are historical and were not rerun for test-only changes.

## Exact new command and pins

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-inbound-principal-retry-v3.review.ps1 -ApprovedInMemoryPhone113RetryV3
```

- Manifest `PHONE113_RETRY_V3_APPROVAL.review.json`,117pinned files, SHA256:
  `02d11d0bd283a642034364833bd185fcefc267d93366b51cb432303252c71d2e`.
- Wrapper SHA256:`2bbab54877083fc4a01b8bf45250ec7959726fb58b075142a13eb3a77f9ffffd`.
- Unchanged SQL113:`318eee1bad52b2674b1af21a186723e6c76d0433e247cacc0c4d983f61711680`.
- Unchanged SQL112:`d5c6a338b2bddba4e70bd527e8b0601b8bfe47602f3e46fc6306cc937adbbd8a`.

## Exact execution scope

ONE NEW pathless PGlite engine in memory only. No existing database, Docker, port, volume, VPS, provider, private
key, credential file or remote service. Apply only twelve exact/hash-pinned0001–0012base fixtures and unchanged
112/113SQL, captured before engine construction. New NOLOGIN roles, synthetic users/sessions/credentials and
test-only trigger/membership/grant mutations exist only in this disposable engine. Never print credentials.

Run the same TEN cases, unchanged assertions: callback/completion save; duplicate/audit count/conflicting digest;
direct access/escalation/forged identity denial; wrong token/route/operation; completion order/withdrawal;
audit rollback; malformed data/booking/media denial; revocation/expiry/owner demotion; preserved owner/app reads
and foreign isolation; queued deduplication. Only the fixture's admin restoration/evidence changes. No SQL/RLS,
runtime privilege, timeout or authorization relaxation. Stop at first failure; no repair or automatic retry.

## Evidence and cleanup

- New CreateNew marker:`node_modules/.cache/phone113-retry-v3-used.json`; never reset/delete.
- New runner JSON:`phone113-retry-v3-execution.json`.
- New exclusive evidence:`phone113-retry-v3-evidence.json`: close status, finite adapter diagnostics and boolean
  fixture identity checks with numeric test-case indexes. No actual identities or customer/secret values.
- Refuse old/new active gates, existing marker and output artifacts. Preserve every prior manifest/marker/result;
  their hashes are pinned. Do not regenerate consumed manifests.
- afterAll awaits engine close before writing closed:true. Verify evidence, process exit and absence of this
  wrapper's temporary `THAARA_PHONE113_RETRY_V3_APPROVED` flag. Dispose only the new memory engine; delete no files
  or existing resources. Keep evidence even on failure.

Embedded single-connection/queued tests do not prove real PostgreSQL multi-connection locking, concurrent
revocation or process-restart persistence. Passing does not authorize production installation, provider tools,
deployment or real calls. No credits are spent.

## Approval request

Approve ONE execution of the exact retry-v3 command with its new fixture-only identity restoration, applying
only pinned base/unchanged112113SQL to a new memory engine, running these ten tests and verifying cleanup.
No existing-system credential/permission change, persistent migration, infrastructure, provider operation,
deployment, real message/call/appointment, commit or push. Any additional database run requires new approval.
