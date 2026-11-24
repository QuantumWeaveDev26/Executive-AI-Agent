# Phone inbound — one disposable owned-relay acceptance run

## Status: CONSUMED — one approved run stopped in preflight

Owner approved with “procced”. All301 source pins verified before the exact command was executed ONCE.
The run stopped at preflight; specific failure category was not retained. No container/network created,
no SQL applied and no acceptance tests executed. Cleanup verified; no creation uncertainty. Used/result
receipts retained under the documented new cache; fixture proof absent. Do not rerun/reset this package.
Result: `PHONE113_OWNED_RELAY_ACCEPTANCE_RESULT_2026-11-04.md`.

The original reviewed scope follows as historical approval evidence.

This replaces neither a consumed approval nor its retained evidence. No infrastructure, listener,
SQL or provider operation was executed while preparing this package. The previous actual-port
failure remains unresolved as a Docker publication diagnosis; this is an explicit alternative
test transport, never a fallback or a claim that publication succeeded.

## Exact approval requested

Approve ONE execution from the existing project root:

```powershell
node scripts/phone-inbound-owned-relay.review.mjs --approved-owned-relay-acceptance --manifest-sha256 aa53a950c47fe5353f5a4001ccb958db1a4c0b593311e2dcfb6e6381fff8d72d
```

Manifest: `PHONE113_OWNED_RELAY_ACCEPTANCE_V1.review.json`; 301 SHA256-pinned files.
Any mismatch, occupied resource name/port, unexpected state or failed check stops the run.
No automatic retry, source repair, approval regeneration or old-marker reset is permitted.

## Resource and transport scope

- One NEW container `thaara-phone113-postgres-review`, one NEW internal network
  `thaara-phone113-network-review`, database `thaara_phone113_review`, reviewed local PostgreSQL image.
  No image pull. Reject pre-existing names; use immutable IDs and unique ownership labels.
- Read-only container root, tmpfs-only database/runtime/temp storage, no host directories or
  persistent volumes. Existing actual-mount, ownership, network, privilege, permissions and
  resource-limit checks remain mandatory. No existing service or volume is modified.
- **No Docker published ports.** A preflight bind-and-immediately-close probe checks local
  `127.0.0.1:15436` availability before resource creation. It is not a database data listener.
- Only after complete container isolation validation, start a supervised Node listener exclusively
  on `127.0.0.1:15436`. Verify its actual address, IPv4 family and port. Each tunnel uses the
  verified local Docker named-pipe endpoint, immutable owned container ID and fixed destination
  `nc 127.0.0.1 5432` inside that container. No alternate target or direct-publication fallback.
- At most 16 owned tunnel children. Await SQL session disposal before metadata inspection.
  Bounded shutdown must prove listener, sockets and children closed before container deletion.
  Uncertain shutdown blocks deletion and is reported; never clean unrelated resources.
- Fresh three-role fixture passwords remain in memory/child environment, not reports or command
  arguments. Docker retains the temporary bootstrap password in its new container configuration
  until verified removal; no existing credentials are read or changed.

## SQL and tests authorized only by a future approval

Apply the twelve pinned base migrations, unchanged reviewed `112r` journal and `113r` principal
runtime candidates, and fixture-only LOGIN provisioning. SQL is restricted to this fresh test database.
Original in-memory-only SQL112/113 remains unchanged. No production or development database access.

Run only the nine synthetic PostgreSQL cases, bail on the first failure:

1. Authenticated raw callback/completion and post-commit receipt.
2. Concurrent duplicate handling, conflicting digest and audit uniqueness.
3. Concurrent phases, consent withdrawal and replay.
4. Workspace/owner RLS, denied service reads and privilege escalation.
5. Concurrent revocation, expiry and owner demotion.
6. Audit failure rolls back report and withholds saved receipt.
7. Missing/interrupted outcomes and malformed media bindings.
8. Persistence across pool reconnection and replay deduplication (not process restart).
9. Route rate limit before parsing/storage.

No provider adapter, API request, real call, message or real calendar appointment. Root test discovery
excludes `.agents/worktrees/**`. Preserve inbound v5, outbound v6, WhatsApp, Gmail, Calendar and n8n.

## Cleanup and evidence

Close only owned clients/listener/tunnels; verify container ID/image/name/labels before removal;
verify network ID/labels and empty membership before removal. Independently confirm absence,
owned Docker destroy event and free local port. If uncertain, stop and report retained owned resources.

New evidence only: `node_modules/.cache/phone113-owned-relay-v1/{used,fixture,result}.json`.
The exclusive used marker permits one execution. Preserve it and the result after completion.
No deletion/reset of consumed historical receipts. Report migrations, nine case counts, sanitized
failure reasons, transport proof, cleanup and remaining live-integration blockers. No retries.

## Preparation evidence

Fresh local verification: 129 passed, 0 failed, nine database cases skipped; receipt
`node_modules/.cache/phone113-owned-relay-final-20261104.json`. API typecheck passed.
Runtime SQL text check passed without executing SQL. Git whitespace check passed.
Independent security review: no blocking findings; preflight bind-and-close probe explicitly disclosed.
Vite configuration checksum unchanged. Historical Phone application tests remain separate evidence.

This approval would authorize only disposable LOCAL testing. It would NOT authorize production
migrations, deployment, credentials, service restarts, provider changes, calls, commits or pushes.
