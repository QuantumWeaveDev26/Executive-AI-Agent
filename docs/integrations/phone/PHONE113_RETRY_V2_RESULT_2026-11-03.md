# Step113 retry-v2 — stopped after1pass/1failure

3 November2026. Owner answered “okay” to the new exact approval. One execution only:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-inbound-principal-retry-v2.review.ps1 -ApprovedInMemoryPhone113RetryV2
```

## Verified result

Preflight112pins matched manifestf75f52…38b0, wrapper750901…a895 and unchanged113SQL318eee…1680. New
marker/result/evidence and all active execution flags absent before execution. Marker23:20:15IST;
teststart23:20:17IST; duration9.96s; wrapperexit1.

**1passed,1failed,8notrun.**

- PASS: service callback and completion save under the exact non-owner identity. The separated timeout settings
  passed on the real embedded engine; the previous42601failure did not recur. This case verifies two committed
  phases and their merged callback result through the dedicated grant/resolver/append path in this fixture.
- FAILED: duplicate/audit-count case. Initial save, duplicate receipt assertion and expected changed-digest
  rejection completed. The subsequent fixture verification query (`SELECT count... FROM public.audit_events`)
  failed with `permission denied for table audit_events` after the fixture's admin() helper was called.
  No audit-count result was obtained, so do not claim exactly-one-audit acceptance passed.
- Remaining8cases have pending assertion status and null durations; they were NOT RUN because bail1stopped.

The retained adapter diagnostic for case2is phasepolicy_and_work, categoryconstraint, SQLSTATE23505. That
corresponds to the INTENTIONALLY rejected changed digest; it is not the cause of the failing audit-count check.
The audit-count query is outside the adapter diagnostic boundary; no SQLSTATE for that specific query was
retained. Do not confuse an expected negative-case diagnostic with the unexpected test failure.

## Root-cause boundary and proposed next investigation

Confirmed failing operation is the test fixture's audit verification read, not the first callback/completion
save. The helper is `RESET ROLE; RESET SESSION AUTHORIZATION`, followed by the privileged audit-count query.
Existing evidence does not record effective current_user/session_user at that point. A failure to restore the
fixture's intended administrative identity is SUSPECTED, not confirmed. No new permission grant is justified.

Next safe LOCAL step: inspect/reproduce the fixture identity-restoration sequence with synthetic state/mocks,
and design an explicit verified restoration to the fixture's original administrative identity before audit
verification. Keep the dedicated inbound identity denied audit SELECT and direct table access. Do not broaden
runtime privileges to make the test pass. Any correction must preserve the approved schemas, gates and cleanup.
Another database execution requires a NEW separately approved package; do not automatically rerun this command.

## Cleanup and preservation

`node_modules/.cache/phone113-retry-v2-evidence.json` independently read back:
engineCreated:true,closed:true, expected case2constraint diagnostic only. The close evidence is written after
awaited memory-engine close. Test child and wrapper ended; approval flag absent afterward. Database had no path,
connection URL, Docker resource, port, volume or persistent storage. No existing resource was deleted.

Keep `phone113-retry-v2-execution.json`, evidenceJSON and `phone113-retry-v2-used.json` undernode_modules/.cache.
Marker has the approved manifest SHA and in-memory-only scope; never reset/delete it. ApprovalCONSUMED.
Postrun112pin checkPASS; all old evidence/markers unchanged. Exact12base+unchanged112/113schemas applied only
inside this NEW disposable memory engine. No postfailure database query, repair or retry was attempted.

No existing database, VPS, provider, credential, Sarvam v5/v6, Gmail, Calendar, WhatsApp or n8n changed. No
deployment, messages, calls, appointments, commit or push. Existing dirty work on dev-thaara-continuation,
HEAD413f5a5preserved. This partial pass is not full security acceptance, real PostgreSQL concurrency proof or
authorization for production/live inbound reporting.
