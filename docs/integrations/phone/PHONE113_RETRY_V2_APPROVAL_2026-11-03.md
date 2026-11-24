# Step113 — timeout correction and ONE new acceptance run

Status: CONSUMED. Owner answered “okay”; exact command executed once3November2026.1passed,1failed,8notrun.
The first service-save case passed; second case stopped at fixture audit-count SELECT permission denial.
See `PHONE113_RETRY_V2_RESULT_2026-11-03.md`. No retry or repair; earlier approvals remain consumed.

## Correction already verified locally

The timeout phase previously issued three SET LOCAL commands through one query. The diagnostic captured42601
at that operation before role/grant/report checks. The adapter now awaits three separate queries with identical
values: statement3seconds, lock1second, idle-in-transaction5seconds. A single-statement-only mock failed before
the change and passed afterward; each failed setting still forces rollback before any authorization/work.
No schema, role/RLS, transaction budget, credential or other security check changed. This is not yet engine proof.

Fresh local verification:47/47tests PASS in5files; APItypecheck/build PASS. Retry-v2 discovery skipped10/10;
no new engine or SQL execution. Independent static review found no preparation blocker. Wrapper parse and
112-file checksum check PASS. Receipt:`node_modules/.cache/phone113-timeout-fix-local-20261103.json`.

## Exact new command and pins

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-inbound-principal-retry-v2.review.ps1 -ApprovedInMemoryPhone113RetryV2
```

- Manifest `PHONE113_RETRY_V2_APPROVAL.review.json`,112files, SHA256:
  `f75f527e3485a8f16784ae08c95dffe86aa01ed45ead3ae9cb4a46a4b98b38b0`.
- Wrapper SHA256:`750901131e54115b776d599ad039204dd6bfb1d8c6b4942cdbb6e0cc0be6a895`.
- UNCHANGED SQL113:`318eee1bad52b2674b1af21a186723e6c76d0433e247cacc0c4d983f61711680`.
- UNCHANGED SQL112:`d5c6a338b2bddba4e70bd527e8b0601b8bfe47602f3e46fc6306cc937adbbd8a`.

## Exact scope

ONE NEW pathless PGlite memory database, no Docker/port/volume/external DB/VPS/network/provider. Fresh synthetic
users, sessions and credential exist only in memory and must never be printed. Verify112pins and exact0001–0012
base file set BEFORE construction; execute only captured/hash-verified base SQL and unchanged112/113dependencies.
The new roles remain NOLOGIN and exist only inside this disposable engine. No live role/credential is installed.

Run exactly the same ten security acceptance cases from the first113package:

1. Service callback+completion saves.
2. Duplicate/replay and one audit; conflicting digest denial.
3. Direct table/privilege escalation/forged identity denial.
4. Wrong token, route and operation denial.
5. Completion order and withdrawal cannot be reversed by replay.
6. Audit failure rolls back the event.
7. Direct function rejects malformed fields, bookings, media and unknown properties.
8. Revocation/expiry/operation restriction and owner demotion denial.
9. Preserved owner/app reads and foreign-workspace isolation.
10. Queued single-connection deduplication.

The new schema narrows only the fresh dependency journal's owner policy applicability to thaara_app, keeping
its predicate unchanged; new guard-specific policies do not grant access to sessions. Exact previously reviewed
SQL113remains unchanged. Fixture-only trigger, revocation and membership changes affect only new synthetic data.
This suite does NOT establish real multi-connection PostgreSQL lock behavior or process-restart persistence.

## Failure, evidence and cleanup

- Stop on the first failure (`--bail=1`); no automatic repair, retry or second database.
- A NEW CreateNew marker `node_modules/.cache/phone113-retry-v2-used.json` consumes the attempt. Never delete/reset.
- Keep runner JSON `phone113-retry-v2-execution.json` and exclusive-create `phone113-retry-v2-evidence.json`.
  The latter includes finite diagnostic codes with numeric test-case indexes and engine-close status; no raw
  messages, SQL text, private identifiers, customer fields or credentials. Expected negative cases may emit
  diagnostic codes; interpret them alongside the actual failing/passing case result.
- afterAll closes the new engine before writing closed:true. Verify that evidence, process exit and the absence
  of `THAARA_PHONE113_RETRY_V2_APPROVED`, which the wrapper clears in finally.
- Refuse existing output files, active old/new gates or a prior new marker. Preserve all consumed manifests,
  markers and failed/diagnostic receipts, which are pinned in this new manifest. Do not regenerate old artifacts.
- Only the new in-memory engine is disposed. No existing resource or file may be deleted. On uncertainty stop
  and report; a pass is not production, deployment, provider or real-call approval.

## Approval request

Approve ONE execution of the exact retry-v2 command, applying only the pinned base fixtures and unchanged112/113
to a new memory-only engine, running these ten synthetic checks and closing the engine with retained evidence.
No SQL repair, infrastructure, persistent migration, live credential/provider change, deployment, real messages/
calls/appointments, commits or pushes. Any further retry requires separate approval.
