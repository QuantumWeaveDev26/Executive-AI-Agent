# Thaara checkpoint — 29 October 2026

Latest continuation: [30 October checkpoint](THAARA_DAILY_HANDOVER_2026-10-30.md). Owner has signed in to Sarvam only; begin draft-agent setup before requesting IDs.

## Task and Git

Step 110: resumed Claude's Sarvam phone-calling Chat slice. Branch `dev-thaara-continuation`, HEAD `413f5a5`; existing dirty phone/persona/Sarvam/SQL work preserved. No commit, push, deployment, credential change, provider request, real call, restart or persistent migration. WhatsApp/n8n/VPS were not accessed or changed. `apps/web/vite.config.ts` is clean. [Previous handover](THAARA_DAILY_HANDOVER_2026-10-28.md).

## Delivered locally

- Continued existing on-behalf-of introduction, Sarvam adapter/webhook, owner confirmation, Chat card and report voice rather than rebuilding them.
- Confirmation checks owner/requester, expiry, typed approval, current contact/consent and PolicyGateway before persisting approval. Durable outbox fences concurrent/repeated confirmations to one provider attempt.
- Report speech checks owner policy, scoped terminal call, audit and session before TTS. New typed `phone.ai.calls.report_speech`: read/low, owner, audit required, no retries. Explicit Play renders an existing report; runtime/provider setup stays separately gated.
- Reports preserve simulation/unverified labels, provider-English translation qualification and quoted recipient lines without inferred agreement. Unknown/claimed dispatch no longer claims active calling or promises eventual completion.
- Chat guards concurrent clicks, stale/aborted reads and unmounted async results; stops owned audio on unmount and never auto-redials uncertain outcomes.
- Sarvam capability callback paths redacted from application request logs. Report voice rejects already-aborted requests before resolving credentials/opening sockets.
- Live calling AND provider report speech refused outside `NODE_ENV=test` pending approved deployment.

## Evidence

**461 passed / 0 failed across 45 distinct files**, merged focused coverage, not full repository regression. Ignored local reports in `node_modules/.cache/`:

- `phone-chat-web-milestone.json`: 240/240, 21 files; changed phone panel/report file replaced by final run below.
- `phone-chat-api-milestone.json`: original command 145 passed/3 failed, 20 files. Do NOT claim original run passed. Failures: newly added speech-policy test before fix, obsolete generic disclosure expectation in stream test, and its dependent lifecycle assertion. Replaced those files with final runs.
- `phone-chat-final-security.json`: 109/109, 7 files (phone service 9, Sarvam calls 9, web phone 18, policy/registry/workflow 73).
- `phone-chat-stream-final.json`: 3/3, expects actual approved on-behalf-of introduction.
- `phone-speech-verified.json`: 13/13; fake speech plus synthetic local-loopback authentication check. Restricted loopback attempts failed; permitted local-only run passed. No provider network requests.
- `phone-chat-merged-evidence.json`: latest per-file replacement from above, 461/45, no remaining failed assertions.

Contracts/policy/API/web builds passed; existing >500 kB web chunk warning remains. `git diff --check` passed. Independent focused security review found missing speech policy gate and misleading unknown-dispatch label; both fixed and re-reviewed with no remaining consequential finding in this slice. UI tests are synthetic/static/client checks; no real browser interaction acceptance this continuation. No real PostgreSQL runtime or Sarvam conversation/report TTS acceptance established. Existing approved disposable in-memory fixtures only.

## Blockers and next authorized action

1. Local Chat calling is NOT deployed. Keep calling off; never remove test-only guards simply to run a call.
2. Verify existing Sarvam agent/version/connection/Indian number and chosen voice using non-secret metadata before repeating setup. Historical approved voice test/key setup does not authorize further paid requests. Never read/copy its private key into chat/repository.
3. Conversation runs provider-side. English transcripts and capability-token webhook results remain unverified. Verify disclosure, consent/privacy, allowed purpose/languages and quality. The passed duration variable is NOT a hard provider cap: enforceable duration/cost limits remain a live blocker.
4. Prepare reviewed pilot/runtime configuration, secret storage and reverse-proxy/access/APM capability-path redaction. Application-log redaction alone is insufficient for deployment.
5. Reviewed 110a–110c SQL has only in-memory evidence here; persistent infrastructure/migrations/runtime need explicit approval. Claude's uncommitted 110c changes preserved, not applied externally.
6. Before any sensitive work, consolidate exact artifact/configuration, SQL, rollback, budget/recipient controls and one own-number test call into an owner approval. No purchase, credential change, deployment or call authorized by this checkpoint.
7. Keep WhatsApp sending disabled and existing limits intact; do not touch n8n during phone work.

Relevant files: API `phone-calling.ts`, `phone-calling-store.ts`, `phone-sarvam.ts`, `phone-sarvam-calls.ts`, `routes/phone-calling.ts`, `routes/phone-sarvam-webhook.ts`, `app.ts`; web `PhoneCallChatCard.tsx`, `phone-calling.ts`, `App.tsx`; shared phone contracts, policy registry and focused tests. See [Step 110](tasks/110-phone-ai-calling-foundation.md) and [Sarvam limits/setup](integrations/phone/SARVAM_CALLING.md).

## Claude continuation — 30 Oct 2026 (stopped at owner request; Codex to continue)

Git: `dev-thaara-continuation`, HEAD `413f5a5`, all dirty work preserved; nothing committed, deployed, called or purchased; no provider request.

- **Official Sarvam docs (read 30 Oct):** agent setting **Max call length** (minutes, ≤60) — agent "wraps up and hangs up": an enforceable provider-side cap, set by the owner on the agent. Pricing ₹3.50/min PAYG (60 s pulses) + telephony ₹0.20/30 s; **only connected calls billed** (voicemail counts); number ₹59/30 days; self-serve plans are **prepaid credits** (effective spend cap); no budget alerts, webhook signature or API-key scopes documented.
- **New Thaara-side hard limit:** daily live-call limit per owner (default **3**/rolling 24 h, configurable 1–20 via `phoneCalling.liveCalling.dailyCallLimit`), enforced in `PhoneCallRepository.claim` under a per-owner `pg_advisory_xact_lock`; returns HTTP 429 `PHONE_DAILY_CALL_LIMIT`; Chat card shows "Thaara's daily call limit has been reached. No call was made."
- **Go-live package (draft, not approved):** [SARVAM_GO_LIVE_PACKAGE.md](integrations/phone/SARVAM_GO_LIVE_PACKAGE.md) — gates: owner Sarvam setup (Max call length 2 min, voice, persona, KYC, small prepaid balance) → disposable-Postgres check then backed-up install of 110a→110b→110c → root-only secret files + live-switch loader (deliberately NOT written) → Traefik/APM capability-path log check → pilot image/redeploy with calling off → one own-number call with daily limit 1.
- **Tests (this continuation):** API phone files 15/15 incl. `phone-sarvam-calls` 11/11 (new daily-limit + parallel-confirm test) and `phone-live` 9/9 after raising that test's limit to 20 (its earlier 2 failures were the new default limit of 3, expected); web 240/240; db 49/49; `git diff --check` OK; vite.config unchanged. Full API suite NOT rerun after these changes.
- Next for Codex: full API regression; request owner's non-secret Sarvam ids + agent settings (Gate 1); then the single consolidated approval request in the go-live package.
