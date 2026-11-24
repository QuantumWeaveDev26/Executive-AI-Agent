# Phone AI calling — phase plan, provider readiness and owner setup (29 Oct 2026)

Status: **local development only. No provider account, number, credential, real call, migration or deployment exists.** The private VPS pilot deliberately excludes all Phone code.

## 1. What exists (verified 29 Oct, tests rerun)

| Area | State | Evidence |
|---|---|---|
| Step 95–97 mock telephony (status, synthetic history, briefing) | Mock only | `phone-foundation`, `phone-briefing`, `phone-screen` tests |
| Contracts + policy action `phone.ai.calls.request` (high risk, explicit approval, idempotency, audit) | Implemented | `packages/contracts/src/phone-calling.ts`, `packages/policy/src/registry.ts` |
| Contact resolution (exact match, ambiguity refused, consent + expiry, contact fingerprint binding) | Implemented against an injected directory; **no production directory** | `phone-calling.test.ts` 17/17 |
| Draft → existing plan/approval/audit tables (RLS) | Implemented | `phone-calling-service.test.ts` 7/7, `phone-calling-api.test.ts` 5/5 |
| Simulation lifecycle + evidence-only report | Test environment only | same |
| Plivo request codec / disabled adapter | Offline, no network | `phone-plivo.ts` |
| Chat intent (English / Kanglish / Kannada) → draft | Implemented | `chat-phone-calling.ts` |
| **Phone screen AI-calling panel + spoken report (this slice)** | Implemented, local | `apps/web/test/phone-calling-panel.test.tsx` 9/9 |

## 2. What is missing for a working approval-gated AI call

1. **Durable contacts with calling consent** — tenant-scoped table + RLS (needs an approved migration). Today no directory is configured outside tests, so production shows "Setup required".
2. **Durable call execution** — one-use claim of an approved draft, outbox, call-state table, idempotent provider dispatch (needs approved migration; reuse the WhatsApp durable-claim pattern).
3. **Provider adapter (live)** — managed-secret credential resolver, fixed endpoint, verified callbacks (provider SDK signature validation, pinned URL, replay control, call binding). No hand-rolled public webhook.
4. **Voice runtime** — bidirectional audio stream → speech-to-text → bounded dialogue (model proposes text only; cannot authorise actions) → text-to-speech, with interruption handling, Kannada/English quality checks, duration and cost budgets.
5. **Truthful reporting** — final recipient utterances only, unanswered/busy/failed states, Chat + voice report, no inferred agreement.
6. **Compliance** — AI disclosure at call start (implemented in drafts), consent before transcription/recording (recording stays off), India calling rules (TRAI UCC/DND, calling hours, registered caller ID).
7. **Controlled acceptance** — one owner-approved test call to the owner's own phone, then shutdown, mirroring the WhatsApp first-send procedure.

## 3. Proposed order of next slices

| Slice | Needs owner approval? |
|---|---|
| A. Contacts + consent migration and repository (local PGlite tests first) | **Done locally 29 Oct** (review SQL not installed anywhere) |
| A2. Contact management API + Phone screen form | **Done locally 29 Oct** |
| B. Durable call claim/state/event log (local) | **Done locally 29 Oct** (review SQL not installed; provider outbox/worker moves to C) |
| C. Provider adapter behind managed secret, callback admission with official SDK validation (local, mocked network) | **Done locally 29 Oct** (SDK verifier not installed; status mapping to confirm on sandbox) |
| D. Voice loop (STT/dialogue/TTS) against recorded synthetic audio | **Done locally 29 Oct** with fake engines (real engines + Kannada quality still to choose/evaluate) |
| Live mode locally (SDK verifier, 110c outbox/callbacks) | **Done locally 29 Oct** (test-env only) |
| E. Pilot deployment with calling OFF, then one controlled owner call | Yes — deployment, then real call |

## 4. Provider options (recommendation, not a purchase)

- **Plivo (first choice to prepare)** — India voice coverage, bidirectional audio streaming suited to an AI voice loop. Sources: [pricing](https://www.plivo.com/voice/pricing/in/), [audio streaming](https://www.plivo.com/docs/voice-agents/audio-streaming/concepts/audio-streaming-guide).
- **Exotel (India-focused alternative)** — strong domestic onboarding; confirm streaming support for AI voice before choosing. Source: [getting started](https://developer.exotel.com/docs/call-support/basics/getting-started).
- **Twilio** — check India restrictions before considering. Source: [India guidelines](https://www.twilio.com/en-us/guidelines/in/voice).
- Regulatory reference: [TRAI unsolicited commercial communication](https://www.trai.gov.in/what-spam-or-ucc).

Prices, KYC rules and number availability change; verify on the provider site at sign-up. The code keeps a provider-neutral interface.

## 5. USER SETUP REQUIRED (only when the owner decides to go live; nothing is needed for local slices A–D)

1. Choose the provider (recommended: Plivo). Tell Thaara the choice in chat — not any keys.
2. Create the account yourself on the provider website using the business email you want for billing.
3. Complete the provider's business verification / KYC for India (company documents as the provider asks).
4. Request one Indian voice number (caller ID) for outbound calls and note the monthly and per-minute charges shown. Do not buy more than one.
5. In the provider console, find the API credentials page. **Do not paste the values into chat.** When the deployment step is approved, Thaara will give you the exact private file/secret-manager location on the VPS where you enter them yourself.
6. Tell Thaara "phone provider account ready" with only: provider name, the masked caller number (last 4 digits), and whether KYC is approved.

Thaara will never request the secret values, place a call, or enable calling without a separate explicit approval naming the exact test recipient.
