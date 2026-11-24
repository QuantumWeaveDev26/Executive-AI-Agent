# Inbound reports — release-readiness checkpoint

## Verified local handoff

Fresh42/42 tests PASS across six focused API files, including six NEW combined HTTP tests. API typecheck
and whitespace check PASS. Receipt: `node_modules/.cache/phone-inbound-report-handoff-20261104.json`.
New file only: `apps/api/test/phone-inbound-report-handoff.test.ts`; no application startup/contract/UI edits.

The combined tests mount existing TEST-ONLY intake and owner report routes in Fastify injection (no
listening socket), using the existing normalization, principal gate, journal reducer and owner feed.
They verify the application handoff with a fake transactional ledger, NOT database durability or real RLS.
Actual database evidence is separately the consumed9/9 PostgreSQL acceptance result.

| Boundary | Verified behavior |
|---|---|
| Callback to owner Details | Committed consenting callback appears as callback_requested with customer/business/service; no appointment invented |
| Privacy | List hides full phone; callback acknowledgement hides customer details; owner Details excludes internal scope/session data |
| Pending commit | No success acknowledgement or list record until commit completes |
| Commit failure |503/saved:false and empty owner list; no raw error leaked |
| Completion/withdrawal/replay | One report; withdrawal survives old callback replay |
| Missing data/media/appointment | Missing fields remain null, no raw recording/transcript retained, forged booking ignored |
| Identity separation | Provider token cannot read owner API; owner session cannot authenticate provider writes; member/foreign-owner boundaries enforced |

Synthetic sessions/ledger are explicitly test-only. No production authorization is derived from test headers.
No Sarvam callbacks, UI browser, outbound calls, recording retrieval or Calendar write tested in this milestone.

## Remaining inbound release gates

1. Production install SQL: existing112r/113r candidates admit only the disposable fixture database.
   They are NOT production installation commands. Prepare distinct additive install/disable/recovery review
   with existing-schema/role collision checks and ownership/RLS/grant verification; no destructive downgrade.
2. Runtime admission: keep every NODE_ENV=test constructor guard. Prepare separately reviewed production
   composition/profile admission; exact workspace/owner/principal/deployment/committedv5/number binding,
   expiring revocable dedicated identity and restricted ingest versus owner-read pools. Do not flip flags.
3. Hosting/security: confirm approved managed/TLS database and secret storage or obtain a clearly scoped
   pilot exception to AGENTS.md. Backup/isolated restore must precede persistent changes. No secret in chat.
4. Ingress: current local limiter is process-local. Reviewed replica-aware/shared ingress limits,
   bounded body/connection/time handling and sensitive log suppression remain deployment gates.
5. Provider: independently confirm supported incoming event/tool authentication and trusted direction,
   identity metadata, consent recap, five-minute enforcement and save-acknowledgement behavior.
   Existing livev5 remains unchanged until explicitly approved; never claim callback saved before commit.
6. Owner dashboard: wire the existing owner-session repository/feed after admission review and deployment
   approval. Current feed is gated, list capped100 with no full pagination/analytics proof. Preserve UI.
7. Appointments: only verified backend Calendar receipt may produce booked_appointment. No appointment
   creation path is activated; team callback remains callback_requested. Separate approved booking work.
8. Recordings/transcripts: retain off until supported authenticated references, notice/consent, access,
   retention/expiry, deletion policy and secure retrieval are reviewed and tested.
9. Controlled acceptance: after separately scoped install/secret/deploy/provider approvals, one owner-made
   inbound test; verify same interaction in authenticated backend receipt, owner list and Details; review
   saved callback consent and fail-safe response. Recovery disables reporting without disrupting livev5.

## Remaining outbound gates

Preserve current approved outbound flow. v6 synthetic evidence does not admit the runtime candidate.
Exact v6/KB/duration/result binding, separately approved runtime promotion, durable report/recording
reconciliation and controlled own-number call remain separate gates. No automatic redial/limit reset.

## Coordination and next authorized action

No shared auth/startup/navigation/contracts/schema or WhatsApp files changed. Antigravity worktree untouched;
no merge/cherry-pick/commit/push. Vite config unchanged. Branch dev-thaara-continuation HEAD413f5a5, dirty work kept.

Next authorized LOCAL slice: prepare production-install and disabled runtime-admission drafts with focused
failure tests, using existing verified behavior. Do not repeat unchanged PostgreSQL acceptance.
No owner account/credential setup is needed for that local work. Before external work, present ONE concrete
reviewed command/path/pin/backup/cleanup package for the actual step; this readiness document is NOT approval
to connect remotely, migrate, provision credentials, configure Sarvam, deploy or make a call.
Planning estimate: three substantive remaining stages—local admission/install preparation, approved hosted
integration, and controlled end-to-end acceptance. Provider/hosting prerequisites determine elapsed time.
