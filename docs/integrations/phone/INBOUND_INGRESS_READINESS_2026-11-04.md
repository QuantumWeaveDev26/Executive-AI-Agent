# Local inbound ingress readiness — 4 November 2026

Status: LOCAL TEST-ONLY. Existing routes remain unregistered; no production admission.

## Implemented

`phone-inbound-ingress.ts` supplies constant-size fixed-window and active-work counters shared by callback
and completion in one route-factory instance. Defaults:60requests/60seconds,4active workflows. Server options
are bounded at1–120requests,1000–60000ms,1–8active workflows. Explicit null/invalid settings are rejected.
No caller/token/IP maps, queues, timers, automatic retries or external dependencies.

The existing route factory checks the rate budget in `onRequest`, before body parsing. Every attempted request
counts regardless of route ID or credentials. Excess returns429 with saved:false, a finite reason and
Retry-After; cache/referrer privacy headers apply before parsing. Body size remains65536bytes.
Concurrency acquisition occurs immediately before workflow execution; rejection cannot invoke the workflow.
Release is idempotent and occurs in finally after the awaited workflow settles, including failures.
An HTTP disconnect/timeout does not release active work prematurely. Existing transaction timeouts remain.

Use a monotonic clock; invalid, throwing or backwards clocks deny admission without renewing the budget.
A fixed window permits a boundary burst. This is process-local protection, not a rolling-window promise
or shared production protection across replicas. Caller-selected route IDs cannot create counter buckets.

## Verification

Red/green: route tests first returned400/200 where limits required429; after implementation both passed.
Invalid null settings were separately reproduced as accepted, then corrected to fail closed.
Final83/83PASS in9focused API files, zero failed/skipped:
`node_modules/.cache/phone-inbound-ingress-final-20261104.json`.
Checks cover shared-phase rate exhaustion before malformed JSON parsing, pending-work saturation, release
after success/failure, no retry, clocks/window/config bounds, existing authenticated saves and transaction guards.
APItypecheck/build and whitespace checks PASS. Independent review found no concrete correctness/security
blockers. Optional future tests: direct route-factory production rejection and pending rejection under contention.

Earlier ordinary API evidence1068PASS/47gatedSKIP across104files applies to the previous snapshot; retained
for unchanged components, not claimed as fresh full regression after this small route change. Web unchanged;
historical272/272 retained. vite.config.ts hash unchanged. No provider or SQL runner used in this slice.

## Remaining gates

- Shared production rate/connection/time limits across replicas.
- Production profile/secret/principal admission and owner-only feed wiring (currently not_configured).
- Separately approved combined real-PostgreSQL concurrency/restart acceptance; embedded acceptance is historical.
- Scoped approval for persistent migration, secret provisioning, deployment and provider/tool setup/test.
- Actual Sarvam context/consent/save-acknowledgement validation; recording and Calendar remain disabled here.

No live Sarvam, outbound, Chat, Gmail, Calendar, WhatsApp, n8n, database, credential or deployment changes.
No calls, messages, appointments, commits or pushes. No owner setup required for this local slice.
