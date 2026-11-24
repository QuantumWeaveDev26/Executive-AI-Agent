# ONE isolated inbound PostgreSQL attempt — stopped before migrations

Owner replied “proceed” to the exact one-run request. Approval is CONSUMED; no retry or reset authorized.

## Verified execution

- Branchdev-thaara-continuation, HEAD413f5a5; dirty work preserved.
- Before execution:287source pins matched manifestSHA
  `413f06a50d93e0c58e14e4b0dea78553c82b922467edc39edf6108e169559fa9`.
  New used/proof/result paths were absent. Source-only preflight passed without touching infrastructure.
- Exact approved command executed ONCE; marker start4Nov2026,10:58:33IST. Process exit1.
- New owned container/network were created; runner reached `verify_isolation` and stopped there.
- Failure category: `verify_isolation`; SQLSTATE:null, migrationId:null. The specific failed field/check
  and inspected facts were not retained. No confirmed root cause; do not assume Docker configuration or
  the guard is wrong, relax a check, repair anything or retry from this receipt.

## Schema and acceptance outcomes

| Item | Actual outcome |
| --- | --- |
| Twelve Thaara base migrations | NOT RUN |
|112r inbound journal | NOT RUN |
|113r inbound principals | NOT RUN |
| Fixture LOGIN/grant/user/audit-trigger provisioning | NOT RUN |
| All nine acceptance cases | NOT RUN:0passed,0failed,9unexecuted |

`schemaResults:null` and failure at the first isolation phase establish that schema execution was never
entered. PostgreSQL container initialization/readiness is distinct from applying Thaara migration SQL.
No runtime-test proof file was created; no test child or provider connection was started.

## Cleanup evidence

The retained result independently checked the exact created IDs and run ownership labels before deletion:
containerRemoved:true,networkRemoved:true,cleanup.verified:true,creationUncertain:false.
Verified cleanup includes container absence, network absence, the matching owned-container destroy event
and a successful free-port15436 check. No fallback deletion or existing resource selection occurred.
All checks belong to the approved runner; no further Docker diagnostic was run after it stopped.

Retained non-secret evidence:

- `node_modules/.cache/phone113-runtime/used.json` — original one-use marker; NEVER reset/delete.
- `node_modules/.cache/phone113-runtime/result.json` — exact owned IDs/image/nonce and sanitized result.
- `node_modules/.cache/phone113-runtime/fixture.json` — absent, as the test phase was not reached.

Post-run287pins still match. The later manifest checker performed source verification only;
its databaseStarted:false describes that checker invocation, not the earlier creation/removal history.

## Preserved boundaries and next action

No Thaara SQL, provider calls, paid simulations, messages, appointments, live Sarvam route changes, credentials
for existing services, VPS/n8n/WhatsApp/Gmail/Calendar changes, deployment, commits or pushes.
Original SQL/runner/guard sources and all consumed manifests/markers retained unchanged.

STOP after reporting. Recommended next scope: database-free investigation of isolation-diagnostic coverage,
adding finite allowlisted failure categories and synthetic fixture tests as a separate local change. This can
identify what evidence a future run should retain, but cannot recover the destroyed fixture's missing facts.
Any new infrastructure/SQL attempt requires a NEW pinned review revision and explicit one-time approval;
never regenerate or reuse this consumed snapshot. Production and real-call gates remain unmet.
