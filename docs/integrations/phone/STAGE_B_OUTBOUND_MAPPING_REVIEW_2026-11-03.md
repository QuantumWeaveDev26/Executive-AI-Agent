# Outbound synthetic input mapping — review only, not authorized for execution

## ACTIVE revision — task + company question in ONE outbound v6 run

Owner requested a revised scenario before approval. Current exact case, five verdict criteria, hashes and approval scope are in
`PHONE_SARVAM_EVAL_EXECUTION_APPROVAL_2026-11-03.md` and regenerated `knowledge/eval-review-v1/request-plan.review.json`.
Ram asks about Quantum Weave AI automation services before supplying the website answer. Thaara must actually query `qw-company-kb-v1`,
answer accurately, return naturally without prompting, then report only Ram's stated answer. Five named verdicts required; missing KB verdict rejected.
Manual tool/transcript review is mandatory; a model judge pass does not prove retrieval. This is not an inbound test or live Chat/backend-record test.
Same purpose/recipient mapping, one run/₹2 before GST, no automatic retry. Gate false. Earlier website-only hashes/proposal below are historical, superseded.
Fresh local revision: planner10/10 + executor16/16 + wrapper7/7 =33/33 passed; no provider requests/credentials/paid tests.

## Local planner completed, 3 November

`scripts/phone-sarvam-eval-plan.mjs` provides pure request planning/strict shape validation; **no HTTP client, credential reader or execution switch**.
Run locally: `node scripts/phone-sarvam-eval-plan.mjs --check` or `--dry-run`.
Review output: `knowledge/eval-review-v1/request-plan.review.json`. Unknown provider suite/case IDs remain unset; no invented IDs in this artifact.
Focused tests: `node scripts/phone-sarvam-eval-plan.test.mjs` — **9/9 passed**, no skips/failures. Syntax/whitespace checks passed.
Default Node test subprocess isolation was denied before assertions (EPERM); direct Node execution then showed expected missing-module RED,
and all assertions passed after implementation. Independent reviewer also passed 9/9 with `--test-isolation=none`; no consequential findings.

| Artifact | SHA256 |
|---|---|
| Planner source | c02224673cec6385202a37568da656b7c1c8b8ac1079850246455d5626d9ff14 |
| Tests | 69da79b2aabe13b4de01d4d85b06586a7dbcc0cd1bcf0c1386ad2ddf8256e8bf |
| Review JSON | 9aa78b547146e7f08dcbcc590e024217f603c10b803838786adaec02f28fd016 |
| Suite request body | 0e8db25e6594e79e404cd9237f2ecd18cd8278463e3bf8080a8df90179156ede |
| Mapping request body | c314791d72882e646af3fad27648449fe29e02e227abe30440abbd4996a8c0d3 |
| Run request body | c0975151d77e2f4cb0e5f5e2a2f3c32bc959a5c8fdc25a886c2a499141f53e6d |

Local normalized readback assertions are not authenticated provider evidence. `alreadySubmitted` checks reject a declared replay but are NOT a
persistent one-run guard; shape validation does NOT authorize a run. Every descriptor keeps `dispatchAllowed=false` and acceptance false.
Future executor must independently authenticate/reconcile readbacks, enforce persistent approval/budget/replay handling and sanitize bounded responses.

Owner confirmed existing key is **only on the VPS**. Do not create/copy a key or inspect its contents locally. Existing deployment source references
protected host file `/opt/thaara-v2-pilot-private/secrets/sarvam_api_key`, mounted as `/run/secrets/sarvam_api_key`; source references are historical
configuration evidence, not a fresh remote file/permission check. Next package should run on the VPS with in-memory header use only, trusted SSH
fingerprint/authentication and no services/SQL/deployment changes. Current approval does NOT authorize that SSH connection or key read.

Nine Stage B executions consumed (published ₹18 before GST). One execution remains within the original ceiling, but the
language-correction approval's three retests are complete. Do not spend the remaining execution or call an authenticated API automatically.

## Official supported route

Documentation checked 3 November, without authenticated provider requests:

- [Mapping contract](https://docs.sarvam.ai/voice-agents/api/tests/mappings/create): suite mapping binds an app ID/version and maps **agent variable name → suite variable name**.
- [Suite creation](https://docs.sarvam.ai/voice-agents/api/tests/create): suite variables are name/value objects; app_id can restrict a suite to the existing app.
- [Case creation](https://docs.sarvam.ai/voice-agents/api/tests/test-cases/add): variable_overrides set suite variables for that case; max_turns bounds conversation length.
- [Single-case run](https://docs.sarvam.ai/voice-agents/api/tests/runs/run-test-case): explicit app_id/app_version and frequency; returns run_id for polling.

No campaign, Instant Outbound call, telephone number or real recipient is needed for this evaluation route.
API requires a workspace X-API-Key; browser sign-in does not authorize extracting session tokens or reading existing private credential files.
Documentation does not establish that this particular account/key has eval API permissions. No authenticated permission probe performed.

## Minimum proposed next slice

Prepare a database-free, dry-run helper and tests before requesting execution approval. Pin this app/org/workspace and outgoing committed **v6**;
allow only documented eval-suite/case/mapping/run/result paths on `https://apps.sarvam.ai`. Explicitly reject calling/campaign/deployment endpoints,
redirects, wrong origin, unexpected scope, bulk frequencies and retries of a mutating request with uncertain outcome. Output reason codes/IDs only.
Keep credentials out of arguments, reports and logs. Define the exact existing secure credential source with the owner; no VPS access or new secret
creation implied. If unavailable locally, owner setup/access approval is a separate prerequisite; never ask for a key in chat.

Proposed fresh app-bound synthetic suite (do not modify unrelated/current suite):

- Variables: `approved_purpose = Ask Ram when the website design project will be completed.` and `recipient_name = Ram`.
- Mapping body: `app_id = Thaara-AI-V-db336de4-5453`, `app_version = 6`,
  `variable_mapping = {call_purpose: approved_purpose, user_name: recipient_name}`.
- One case OUT01: simulated Ram confirms Sunday afternoon, then says goodbye. Purpose/name are mapped inputs, never supplied as caller authorization.
- Expected: AI disclosure and availability check; exact task/recipient preserved; follow-up/confirmation reflects actual answer; no additional action,
  promise, new objective, invented agreement or redial; polite End Conversation. Suggested max_turns 20.
- Read back suite, case and mapping before requesting a run. Keep created IDs and uncertain outcomes; never recreate blindly or delete automatically.
- After explicit execution approval: **one** case, v6, frequency 1, evaluation enabled. At published ₹2, combined Stage B would reach ten/₹20 before GST.
  Stop on auth/billing/scope/mapping/test failure; no retry. Actual debit/taxes require separate ledger evidence.

This one case would not complete all outbound acceptance: Kannada company-question return-to-purpose, Hindi task-expansion denial, opt-out,
live audio/five-minute termination and truthful backend result reconciliation still need bounded evidence and separately approved budgets/actions.
Do not set full acceptance true from a single mapped happy path. Runtime appVersion2 and live inbound v2 stay unchanged throughout.

## Approval boundary

This is a proposal, not an executable approval package: no credential source or reviewed helper/checksum exists yet. First build and test the local
dry-run helper, resolve secure access without exposing secrets, then present exact method, paths, payload hashes, maximum requests and spend for approval.
No provider edits/requests, new credentials, SQL, VPS, deployment, commit/push or real call authorized by this document.
