# Phone113 isolated PostgreSQL acceptance v2 — PASS

## Execution and source integrity

Owner explicitly approved one temporary Docker setup, reviewed SQL, nine tests and cleanup using
reviewed access.309 source pins verified before the exact approved command. Started
2026-11-04T07:08:05.714Z (12:38:05 IST); exit0, status `passed`, scope `acceptance`.
Manifest SHA256: `c32f0cafa76baf984af3f2c0dae776e21fd817e859d85ee14363b697e17b9266`.

## Schema results

Alltwelve reviewed base migrations0001–0012,112r journal runtime candidate and113r service-principal
runtime candidate applied successfully inside the NEW disposable database. Fixture-only LOGIN setup
completed (tests authenticated with those roles). No production/development SQL or original112/113 edits.

## Nine synthetic acceptance results

| Case | Result |
|---|---|
| Authenticated raw callback/completion and saved receipt after commit | PASS |
| Independent concurrent connections, duplicate/digest rejection and audit uniqueness | PASS |
| Concurrent phases, consent withdrawal and replay fencing | PASS |
| Workspace/owner/peer RLS, restricted service reads and escalation denial | PASS |
| Concurrent revocation, expiry and owner demotion | PASS |
| Audit failure rollback and no false saved receipt | PASS |
| Missing/interrupted data, truthful states and malformed provider bindings | PASS |
| Persistence across pool reconnect and duplicate replay | PASS |
| Ingress rate limit before parsing and storage | PASS |

Totals9 passed,0 failed,0 skipped. Reconnection test is NOT a PostgreSQL process-restart test.

## Isolation and cleanup

Full preflight/isolation passed. Explicit owned-exec-loopback admission proved actual loopback listener,
owned-container target and no Docker publication. No fallback. No provider traffic.

Cleanup receipt: verified true; containerRemoved true; networkRemoved true; failure null;
creationUncertain false. Runner independently verified container/network absence, owned destroy event
and free127.0.0.1:15436. Shutdown proof: listenerClosed, childrenClosed and socketsClosed all true.
Supervisor faultReason null, activeChildren0, activeSockets0, startPending false.
No additional Docker commands or rerun after completion.

Retained evidence: `node_modules/.cache/phone113-owned-relay-v2/{used,fixture,result}.json`.
One-use approval CONSUMED. Preserve these and all previous markers; never reset/reuse them.

## What this establishes and what remains

Real PostgreSQL now verifies the scoped authenticated service-to-durable-report path, concurrency,
tenant/owner isolation, audit rollback, revocation, idempotency and ingress rate limiting with synthetic data.
Earlier145/145 local checks remain separate evidence; no full application suite was rerun in this step.

This is not a live Sarvam callback, owner browser feed, recording retrieval, real calendar booking or
end-to-end deployment test. Existing reporting routes/feed remain gated/not live. No live inboundv5,
outboundv6, Chat, Gmail, Calendar, WhatsApp, n8n, VPS, credentials or persistent database changed.
No real calls, appointments, messages, deployment, commit or push.

Next safe work: local production-admission/release-readiness review binding the verified intake principal,
durable owner feed and disabled reporting routes to the approved profile, with targeted failure tests.
Before any live integration: separately scoped approval for recovery/backup verification, persistent
migration and service-identity provisioning, secret setup, deployment/routing and controlled inbound test.
Outboundv6 activation/controlled call remains a separate explicit approval. Do not treat this test
success as authorization for any of those actions.
