# Task 003 — Executive Chat, Context Assembly, Memory Governance & Privacy Controls

**Status:** IMPLEMENTED (Phases 1, 2, 3, and 4 Verified in Live CI; Pending User Acceptance Review)  
**Owner:** Antigravity implementation executor  
**Architecture owner:** Codex  
**Depends on:** `docs/architecture.md`, `AGENTS.md`, `docs/tasks/001-platform-foundation.md`, and `docs/tasks/002-governed-plan-execution.md`

## Outcome

Implement the multi-tenant executive chat runtime, deterministic token-budgeted context assembly, consented memory lifecycle, self-service privacy purge engine, governed assistant streaming lifecycle with truthful model gateway boundaries, worker stale stream recovery, bounded durable privacy purge worker, authoritative pre-dispatch outbox sweeper, and sole-owner account closure protection.

## In Scope (Phases 1, 2, 3, and 4)

1. **Database Schema & Hardened Procedures (Migrations 0004–0009):**
   - Tables: `conversations`, `conversation_messages`, `memory_items`, `user_purge_cutoffs`, `user_purge_operations`, `worker_dispatch_outbox`, `assistant_stream_executions`, `assistant_stream_events`.
   - Token-bound authenticated scope via `resolve_session_scope(p_session_token_hash)` and `app.session_token_hash` GUC.
   - Fail-closed RLS with `FORCE ROW LEVEL SECURITY` across all tables; direct DML denied for `thaara_app` and `thaara_worker`.
   - Additive evolution of `conversation_messages` with reciprocal bidirectional deferred constraint triggers binding assistant messages to their parent stream execution.
   - Additive migration `0009_task003_privacy_purge_and_outbox_hardening.sql`: adds continuation fields (`continuation_sequence`, `continuation_token`, `continuation_pending`), hardened worker-only procedures with strict lease expiration fencing, and sole-owner protection.
   - User-facing SECURITY DEFINER functions granted strictly to `thaara_app`:
     - `create_conversation`, `update_conversation_status`, `append_conversation_message`
     - `create_memory_item`, `grant_memory_consent`, `revoke_memory_consent`, `supersede_memory_item`
     - `initiate_self_privacy_purge`, `export_user_conversation_history`, `inspect_private_conversation`
     - `initiate_assistant_stream`, `append_assistant_stream_event`, `finalize_assistant_stream`, `cancel_assistant_stream`, `get_assistant_stream_events_after`
   - Worker-only SECURITY DEFINER functions granted strictly to `thaara_worker`:
     - `recover_stale_assistant_stream`, `reconcile_stale_assistant_streams`
     - `acquire_purge_lease`, `renew_purge_lease`, `process_purge_batch_messages`, `process_purge_batch_conversations`, `process_purge_batch_memories`, `complete_purge_operation`, `fail_purge_operation`
     - `schedule_purge_continuation`, `claim_purge_continuation`, `claim_unrecovered_purge_continuations`, `get_purge_operation`
     - `claim_outbox_dispatches`, `mark_outbox_dispatched`, `mark_outbox_failed`
   - Strict privilege boundaries: all functions specify pinned `search_path = pg_catalog, public, pg_temp`, trusted owner `postgres`, and catalog assertion verification in migration 0009.

2. **Session Scope Wrapper (`withAuthenticatedScope`):**
   - Secure parameter-bound GUC setter: `SELECT pg_catalog.set_config('app.session_token_hash', $1, true)`.
   - Executes strictly inside transaction boundary with fail-safe reset before connection release to pool.
   - Verified zero cross-transaction GUC leakage.

3. **Governed REST & SSE Streaming Routes (`/api/v1`):**
   - `POST /api/v1/conversations`: create private conversation sessions.
   - `GET /api/v1/conversations`: list tenant conversations.
   - `GET /api/v1/conversations/:id`: retrieve conversation details.
   - `PATCH /api/v1/conversations/:id`: update conversation status (`active`, `archived`).
   - `GET /api/v1/conversations/:id/messages`: list messages with pagination.
   - `GET /api/v1/conversations/:id/context`: minimized preview returning only aggregate counts and token budgets (zero message text or IDs).
   - `POST /api/v1/conversations/:id/stream`: initiate governed assistant streaming via Server-Sent Events (SSE).
   - `GET /api/v1/conversations/:id/stream/:streamId`: reconnect SSE stream with `Last-Event-ID` monotonic replay.
   - `POST /api/v1/conversations/:id/stream/:streamId/cancel`: cancel active stream with optimistic locking and idempotency.
   - `POST /api/v1/memories`: create active memory items.
   - `GET /api/v1/memories`: list tenant memories.
   - `GET /api/v1/memories/:id`: retrieve memory item details.
   - `POST /api/v1/memories/:id/consent`: grant consent to memory item.
   - `DELETE /api/v1/memories/:id/consent`: revoke consent from memory item.
   - `POST /api/v1/memories/:id/supersede`: atomic supersession of older memory items.
   - `POST /api/v1/privacy/purge`: initiate self-service privacy purge.
   - `GET /api/v1/privacy/purge/:id`: query purge operation status.
   - `GET /api/v1/privacy/export`: export user conversations and consented memories.
   - `POST /api/v1/admin/inspect`: administrative private conversation inspection requiring RBAC (`owner`/`admin`) and mandatory justification (> 10 characters).

4. **Truthful Model Gateway Boundaries:**
   - Production default: `UnconfiguredModelGatewayAdapter` yields truthful `not_configured` status, emits no fake tokens, and persists no fabricated assistant messages.
   - Test-only: `DeterministicExecutiveStreamAdapter` emits deterministic tokens and is strictly isolated from production environments.
   - Model output remains untrusted text only and cannot alter policies, authorizations, or instructions.

5. **Server-Owned Worker Sweepers & Processors (`apps/worker`):**
   - `AssistantStreamSweeper`: Claims stale streams (> 60 seconds) and transitions them to `failed` (`STREAM_TIMEOUT`).
   - `OutboxDispatchSweeper`: Claims pending outbox dispatches, rehydrates authoritative database operation under `thaara_worker`, validates schema against `PrivacyPurgeOutboxPayloadSchema`, rejects mismatches terminally (`OUTBOX_PAYLOAD_MISMATCH`), resets transient queue failures (`OUTBOX_QUEUE_UNAVAILABLE`), and marks internal BullMQ acceptance (`mark_outbox_dispatched`).
   - `PrivacyPurgeProcessor`: Executes bounded purge batch runs per delivery; atomically calls `schedule_purge_continuation` to persist deterministic token/sequence and extend lease; enqueues deterministic continuation job ID (`purge:{id}:cont:{seq}`) with dedup key; duplicate continuation deliveries handled idempotently; blocks account closure for sole owners with `PURGE_LAST_OWNER_BLOCKED`.
   - `PrivacyPurgeContinuationSweeper`: Claims unrecovered continuations past lease expiry and re-enqueues deterministic continuation jobs; enforces `max_attempts` accounting with terminal failure and single `privacy.purge_failed` audit event.
   - All sweepers and processors wired into worker lifecycle (`apps/worker/src/worker.ts`), fail-closed in all non-test environments with startup checkout credential and identity verification.

6. **Automated Verification:**
   - Monorepo unit and integration tests (PGlite WASM) for all conversation, memory, privacy, admin, streaming routes, and worker sweepers/processors.
   - SSE streaming verified with monotonic sequence numbering, exact `done` event sequence ID matching persisted `assistant_stream_events.sequence_number`, and event type `token`.
   - Active idempotency verified: replaying durable events only on duplicate initiate for any state without duplicate model execution.
   - Scope wrapper unit tests and real PostgreSQL runtime tests using a `max: 1` pooled connection proving transaction-scoped GUC isolation and zero leakage on commit or rollback.
   - Real PostgreSQL 16 & Redis runtime tests (`packages/db/test/task003-purge.runtime.test.ts`, `packages/db/test/task003-streaming.runtime.test.ts`, `apps/worker/test/redis-worker.runtime.test.ts`) validating migrations 0001–0009, RLS, direct-DML denial, strict expiry fencing, durable continuations, recovery sweepers, attempt exhaustion, sole-owner protection, and BullMQ Redis queues under `thaara_worker`.
   - Authoritative live container verification recorded in GitHub Actions CI run `34827351104` against commit `0fd3558bfb58ebb3ee8f50a5d5aa9c7a1e7d9904` (255 passed tests across 25 test files: 19 non-runtime files with 123 tests, and 6 container runtime files with 132 tests, zero failures, zero skips).

## Out of Scope (Deferred to Subsequent Tasks)

- Task 004: Tool policy gateway, connector execution, and approval gates.
- External LLM provider API keys (OpenAI, Anthropic, Bedrock).
- External tools, MCP, or n8n workflow integrations.
- Frontend web UI expansion.

## Required Validation

```bash
pnpm run build
pnpm run lint
pnpm run typecheck
pnpm run test:all
pnpm audit --prod
pnpm run test:runtime
```


