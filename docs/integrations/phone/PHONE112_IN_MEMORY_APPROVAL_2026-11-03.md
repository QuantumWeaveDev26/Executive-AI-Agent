# Step112 — separate in-memory journal acceptance approval

Status: CONSUMED. Owner approved with “procced”; exact command executed once3November2026,8/8PASS,exit0.
See `PHONE112_IN_MEMORY_RESULT_2026-11-03.md`. Do not reset the marker or retry. Prior111approval stays consumed.

## Exact proposed execution

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-inbound-event-memory.review.ps1 -ApprovedInMemoryPhone112
```

One execution only. Verify all99 source/runtime checksums in `PHONE112_IN_MEMORY_APPROVAL.review.json` before setting the gate.
Stop on any mismatch; no repair or retry. The runner consumes a new CreateNew marker before starting the test;
it must never delete/reset an existing marker, including on failure.

- Manifest SHA256: `3c342eea604a471864451176bd8ef8a637654c19fd833b1ee137a7a23cbc6677`
- SQL112 SHA256: `d5c6a338b2bddba4e70bd527e8b0601b8bfe47602f3e46fc6306cc937adbbd8a`
- Wrapper SHA256: `8ae3e584ab42014fac93d0d2ad699cd45d1d282252c4150b25569c8d24b8517c`

## Permitted resources and SQL

One NEW `PGliteDatabase()` with no path, URL, pool or environment-derived database target: memory only.
No Docker, network, port, persistent volume, existing database or server connection. Fresh synthetic
workspaces/users/sessions exist only in that engine. Apply exactly twelve pinned base migrations and
`docs/migrations/112-phone-inbound-events.review.sql`. SQL111 is unchanged and is NOT applied or retried.

SQL112 adds one standalone immutable journal table, three uniqueness constraints, a history index and owner-session
RLS. Runtime role receives SELECT/INSERT only; PUBLIC and worker receive no table privileges. No existing
table/data/permission is altered. The test-only audit-failure trigger and session revocation affect only synthetic
fixtures in the new engine. No provider requests or real Calendar actions.

## Eight acceptance checks

1. Callback plus completion stored as two phases and one merged call; fresh repository reads.
2. Owner/workspace/member separation with restricted-role RLS and rejected member INSERT.
3. Identical queued requests deduplicate; conflicting source fingerprint rejected.
4. Completion-first order preserves metadata; withdrawal cannot be revived by replay.
5. Audit failure rolls back the event INSERT; no saved receipt is returned.
6. Expired transcript excluded on read; detail audit excludes customer data.
7. Changed caller binding rejected without saving another phase.
8. Runtime UPDATE/DELETE denied; revoked owner session denied.

PGlite has one connection: queued tests do NOT establish multi-connection PostgreSQL concurrency or process-restart
persistence. Real PostgreSQL and production rollout remain separate gates.

## Cleanup and evidence

`afterAll` closes the new in-memory engine; process exit destroys its memory. Wrapper always clears its own
`THAARA_PHONE112_SQL_TEST_APPROVED` variable. Keep result JSON
`node_modules/.cache/phone112-in-memory-acceptance.json` and one-use marker
`node_modules/.cache/phone112-in-memory-v1-used.json`; never delete/reset them. Independently verify process exit,
summary, gate absence and retained marker after execution. No existing resource is eligible for deletion.

## Approval request

Approve ONE execution of the exact command above, applying only the pinned base fixtures and NEW SQL112 to a
new memory-only database, running eight synthetic checks and closing that database afterward. No automatic retry.
No persistent migrations, VPS/provider/credential changes, deployment, activation, calls, messages, appointments,
commits or pushes. Stop and report failures. A successful result is not production approval.
