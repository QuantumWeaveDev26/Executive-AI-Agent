# Step113 — one disposable memory-only principal acceptance run

Status: CONSUMED. Owner approved with “procced”; exact command ran ONCE3November2026 and stopped on the first
service-save failure (0passed,1failed,9notrun). No retry or repair. See `PHONE113_IN_MEMORY_RESULT_2026-11-03.md`.
Earlier111/112 approvals remain consumed. Never reset the113marker or reuse this approval.

## Exact proposed command

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-inbound-principal-memory.review.ps1 -ApprovedInMemoryPhone113
```

One execution, no retries/repairs. Verify all103source/runtime checksums before execution; stop if anything differs.

- Manifest `PHONE113_IN_MEMORY_APPROVAL.review.json` SHA256:
  `bff5216f14c99f352581383281bc7ba5c2deb94e4121e4802ac33a14e83704e3`
- New SQL113 SHA256: `318eee1bad52b2674b1af21a186723e6c76d0433e247cacc0c4d983f61711680`
- Wrapper SHA256: `1e55af2cbf20316c6b05b7d43763918f0101d39e8b3efbebf238cfdc28c2de27`
- Unchanged dependency SQL112 SHA256: `d5c6a338b2bddba4e70bd527e8b0601b8bfe47602f3e46fc6306cc937adbbd8a`

## Exact resource and SQL scope

One NEW pathless `PGliteDatabase()`, only in process memory. No Docker, disk database, connection string,
external database, port, volume, VPS, provider API, deployment or paid operation. Fresh synthetic users, sessions,
contacts and credential material exist only inside this test; never print them. No installed app data is read.

Apply exactly the twelve pinned base migrations, unchanged112journal SQL as a dependency in this NEW engine,
and NEW113principal SQL. This is not a retry of the old112runner/approval. Never reset its marker or regenerate
its consumed manifest. Do not apply111 or any other SQL file.

SQL113 creates two NEW NOLOGIN, non-elevated roles, a forced-RLS grant table and three narrowly scoped functions.
The definer can lock/read grant and owner membership rows and atomically insert a report event plus audit.
The ingest role has function execution only, with no direct application-table access, owner session, login or
credential installed. No general history export, Calendar booking, raw transcript/audio retention or dialing.

One deliberate change to the NEW dependency journal's existing policy: restrict its owner policy to thaara_app,
keeping its predicate unchanged. This prevents the service definer from evaluating the browser-session subquery;
it receives no sessions-table privilege. New membership/event/audit policies apply ONLY to the new definer role.
No existing data is deleted or rewritten; NO existing deployed policy or database is touched. Test-only trigger,
grant revocation/expiry, membership demotion/restoration and role/session switches affect synthetic fixtures only.

## Ten reviewed acceptance cases

1. Service callback+completion save under the exact non-owner identity.
2. Duplicate phase idempotency/no extra audit; conflicting fingerprint denial.
3. Direct table access and guard escalation denied; forged browser/tenant claims denied.
4. Wrong token, route or phase denied.
5. Completion-first order and withdrawal preserved over an old callback replay.
6. Audit failure rolls back the event; no saved confirmation.
7. Direct function rejects malformed customer fields, forged bookings, media and unexpected properties.
8. Revoked/expired grants, restricted operation and owner demotion denied.
9. Existing owner/app reads preserved; foreign-workspace records remain invisible.
10. Queued same-event requests deduplicate on the single embedded connection.

Discovery without approval has already skipped10/10; no SQL was run. This run can verify SQL installation and
embedded-engine RLS/function behavior. It does NOT prove multi-connection PostgreSQL locking, concurrent
revocation/demotion, process-restart persistence, network delivery or production readiness. These remain later gates.

## Cleanup, evidence and stop rules

CreateNew marker `node_modules/.cache/phone113-in-memory-v1-used.json` consumes one attempt before test execution.
Never delete/reset it, including on failure. Stop on unexpected schema/security/test failure; no automatic retry.
afterAll closes only the new memory engine; process exit destroys it. Wrapper finally removes its own temporary
`THAARA_PHONE113_SQL_TEST_APPROVED` flag. Independently verify exit/summary, flag absence and retained marker.
Keep `node_modules/.cache/phone113-in-memory-acceptance.json` and the marker. No existing resource may be deleted.

## Scoped approval request

Approve ONE execution of the exact command above, applying only the pinned base fixtures+112dependency+NEW113
to one newly created memory-only database, running ten synthetic acceptance cases and closing it afterward.
No infrastructure, persistent migration, live role/credential creation, provider configuration, deployment,
calls/messages/appointments, commits or pushes. A pass does not authorize production installation or activation.
