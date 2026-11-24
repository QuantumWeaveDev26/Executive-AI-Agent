# Isolation-only diagnostic result — 4 November 2026

Status: ONE APPROVED EXECUTION COMPLETE; stopped at isolation, cleanup VERIFIED. Approval CONSUMED.

Owner replied “okay procced” to the exact isolation-only request.292pins matched before and after execution,
manifestSHA `3fac7f4ee7c078ac3bf11172f48384987c13ea3d40f478e84873684dba690479`.
New used/result artifacts were absent before the command. Start11:35:55IST, process exit1. No retry.

## Confirmed findings

- Scope:isolation_only. Failure phase:verify_isolation.
- Exact finite check:actual_ports; kind:validation_failed. SQLSTATE/migrationId:null.
- The pinned guard requires actual port metadata to contain only5432/tcp with exactly one mapping to
 127.0.0.1:15436. That condition failed for the new fixture.
- The requested HostConfig port-binding check precedes this condition and passed. It is insufficient proof
  of actual publication; the runner correctly refused to proceed on the requested binding alone.
- This was not reported as a collector timeout/invalid-JSON failure. The raw actual-port value/shape was not
  retained, so this receipt cannot distinguish null/empty projection, extra mapping, wrong interface or port.
- Actual filesystem mount validation follows this check and was not reached. Do not claim full isolation passed.

## Not established

The underlying Docker publication/projection cause is UNCONFIRMED. Do not claim the port was public, closed,
correctly published, or merely hidden by an API representation. The earlier acceptance attempt lacked its
specific failure facts; this new diagnostic cannot retroactively prove the same cause for that attempt.
Do not relax/remove the actual-publication check or add a relay/fallback based on this result.

## No schema or acceptance execution

schemaResults:null; tests:null. The restricted entry point has no schema/test capabilities and never reached
any such operation. No Thaara migrations, test-role/user/grant setup, SQL client/pool queries, acceptance child,
provider request or real call ran. PostgreSQL's own disposable initialization/readiness was part of the approved
infrastructure scope, distinct from Thaara SQL execution.

## Cleanup verified

New containerRemoved:true; networkRemoved:true; creationUncertain:false; cleanup.verified:true, failure:null.
The runner checked exact owned IDs/image/name/nonce before deletion and independently confirmed container and
network absence, matching container destroy event and free15436. No existing container/network/volume/service
was selected or modified. No post-run Docker diagnostic command was executed.

Retained non-secret receipts:

- `node_modules/.cache/phone113-isolation-diagnostic-v1/used.json`: one-use marker, NEVER reset/delete.
- `node_modules/.cache/phone113-isolation-diagnostic-v1/result.json`: exact owned identities and sanitized result.

Previous phone113-runtime used/result and all consumed manifests remain unchanged. Source-only postflight still
verifies292pins; its infrastructureTouched:false describes that checker invocation, not the earlier fixture run.

## Next action and preserved workstreams

STOP after reporting. Recommended next scope: LOCAL/database-free analysis of actual-port reader/validation
semantics and existing retained historical evidence; determine the minimum additional finite shape/publication
proof needed. Do not assume a diagnosis or change accepted publication criteria without evidence/review.
Any new fixture/inspection beyond this command needs a NEW scoped approval and review revision. Do not rerun
this consumed diagnostic or substitute the full acceptance command. No deployment, migration, provider change,
real call, credential change, Git commit/push or merge is authorized by this result.

Phone owner-report milestone137/137 remains historical verified evidence for unchanged code. Mainbranch
dev-thaara-continuation HEAD413f5a5, dirty work preserved. Antigravity's WhatsApp worktree untouched. Live inboundv5,
outbound settings, Chat, Gmail, Calendar, WhatsApp, n8n and VPS configuration unchanged.
