# Inbound booking and WhatsApp speech — 4 November 2026

LOCAL PROPOSAL. No provider setting, live version, tool, route or credential changed. No calls or paid tests.

## Subsequent fresh signed-in Chrome inspection

Owner requested using their existing signed-in Chrome instead of signing in to the separate browser.
Read-only UI inspection completed on4November, no provider API scripts, Genie messages, save, Test agent,
Start Call, edit-from-version, publishing, uploads or activation used. The editor's selected-version view
was changed for reading only; live route was not changed.

- Existing Thaara V2 - Inbound Voice deployment is Active, selected committed v5, same number ending9780.
- Explicitly selected committed v5 in the agent's version viewer, waited for inbound instructions to load.
  Initial selection briefly displayed stale outbound content; that was NOT treated as v5 evidence.
- v5 Custom tools is empty. System tools: End Interaction, Query Knowledge Base, Handle Voicemail,
  Change Output Language; Call Transfer is Off. No Calendar availability/create or request-saving action.
- v5 prompt says no bookings and no new action tools. Its KB is qw-company-kb-v1, not the local no-pricing
  replacement candidate. Existing draft v7 is OUTBOUND, so do not overwrite it to prepare inbound changes.
- Speaking: Chaitra - Kannada Mix Support; speed1.00, pitch0.00, volume1.0; per-language voice override Off.
  Pronunciation area shows Upload dictionary and no attached dictionary entry/filename. Dictionary content
  or internal provider state was not fetched. Brand-specific acoustic mechanism remains unverified.
- Language switching and automatic switching are On. Allowed languages visibly show Hindi, English and
  one collapsed entry; the hidden entry was not independently expanded. Prompt explicitly supports Kannada.
- Max call length5. Knowledge panel lists qw-company-kb-v1. No voice/model/KB changes made.

Confirmed booking root cause: live v5 lacks the necessary tools and explicitly denies bookings. Owner's
working Chat Calendar connection is not an inbound tool or delegated execution authorization. A prompt
change alone cannot create or save appointments. Request-save storage/auth/deployment remains blocked.

Next corrective package must preserve the existing outbound v7 draft and v6, capture exact source baseline,
merge only the proposed pronunciation entry, and separately admit booking/request tools before granting
their prompt authority. Do not ask to approve a fake fully working booking flow. No production correction,
paid audio test or live verification call has yet been authorized. Prior local38/38 results remain valid
for unchanged code; no tests rerun solely for this UI read.

## Evidence and limits

Owner's real test confirms incoming calls connect and company answers work. Appointment booking and spoken
WhatsApp failed the owner's test. Fresh dashboard inspection is blocked: the accessible browser has no
authenticated Sarvam session and displays Google sign-in. A tab is left for the owner; never request secrets.
Do not label local artifacts as the current live v5 configuration without a dashboard readback.

Confirmed local causes of missing booking capability:
- `phone-sarvam-inbound-service.ts` binds `calendarBooking:'disabled'` and its constructor is test-only.
- `phone-inbound-workflow.ts` performs no Calendar creation; completion can only look up an existing verified receipt.
- `google-calendar.ts` routes require an authenticated owner scope. The create route prepares a governed
  mutation with `status:awaiting_approval`; it does not return a completed booking at preparation time.
- The saved no-pricing instruction candidate explicitly forbids bookings. Its live deployment status is unverified.
- Latest hosted inventory found inbound journal/principal storage absent. Saving a human appointment request
  in Thaara is therefore still a blocked live integration, not a prompt-only correction.

The existing Calendar integration is reusable for availability and governed event creation/verification, but a
dedicated inbound authority and request-save path are missing. Do not share owner cookies, manufacture an owner
scope or bypass PolicyGateway. A caller requesting an appointment does not approve use of the owner's account.

## Minimum correction

1. Inspect only the existing inbound deployment's selected version and its attached tools, response mapping,
   failure behavior, language/voice settings and pronunciation dictionary. Do not press Test, save or publish.
2. Reuse current Calendar logic after scoped authorization exists: confirm caller details and slot/timezone,
   check actual availability, prepare the existing governed mutation, require owner approval, create once,
   verify the returned event and bind its receipt to this call/customer/slot. An event ID alone is insufficient.
3. While that path is unavailable, save a consenting team appointment request through the existing durable
   request path only after it is admitted and deployed. Label Callback requested / Needs review, never Booked
   appointment without the verified Calendar event. Preferred time is a request, not confirmed availability.
4. If saving is unavailable or uncertain, explicitly say neither booking nor follow-up saving was confirmed.
   Offer only an existing verified company contact. No promised team callback, automatic event retry or SMS.

`knowledge/booking-pronunciation-review/booking-response-overlay.proposed.txt` contains the exact proposed
conversation rules. It is not a full replacement prompt. Reconcile the current no-bookings rule only after
actual tool capabilities and approved action scope are known; preserve all other instructions.

## Pronunciation correction candidate

Actual acoustic cause is UNVERIFIED: no call audio or live dictionary/model settings were inspected.
An absent or unsuitable brand mapping is a hypothesis, not a confirmed provider defect.

Sarvam Voice Agents documents language-name dictionary keys under `pronunciations`, with plain text
replacements rather than phoneme markup. The proposed file uses English, Kannada and Hindi (not the separate
Model API's language-code format). Merge its single-brand entries into the current dictionary after inspecting
it; never replace unrelated terms. If current entries conflict, stop for review. Keep written WhatsApp unchanged.

Proposed speech forms: English `Whats App`; Kannada `ವಾಟ್ಸ್ ಆ್ಯಪ್`; Hindi `व्हॉट्स ऐप`.
These are UNTESTED ACOUSTIC CANDIDATES, not verified pronunciations. Keep existing Chaitra/model/language-switch
settings and KB. Do not change models to obtain dictionary support without separate review and approval.

Official sources inspected:
- https://docs.sarvam.ai/voice-agents/build/voice-language
- https://docs.sarvam.ai/voice-agents/build/tools/https-tool

## Local verification

38/38 PASS, four existing API suites; no failures or skips. Receipt:
`node_modules/.cache/phone-booking-safety-20261104.json`. Includes failed Calendar lookup, backend receipt
binding, failed/pending commits, callback reconciliation and privacy tests. Mock provider/transaction tests,
NOT live booking, real Calendar availability, durability, speech synthesis or acoustic verification.

Command: `pnpm exec vitest run apps/api/test/phone-sarvam-inbound-intake.test.ts apps/api/test/phone-sarvam-inbound-service.test.ts apps/api/test/phone-inbound-report-handoff.test.ts apps/api/test/phone-inbound-workflow.test.ts --exclude '**/.agents/worktrees/**' --pool=threads --poolOptions.threads.singleThread --reporter=json --outputFile=node_modules/.cache/phone-booking-safety-20261104.json`

Dictionary JSON parses with exactly three documented language blocks, one WhatsApp mapping each, nonempty
plain-text values and no SSML tags. This validates format only; no provider request or audio generated.

Candidate SHA256:
- whatsapp-pronunciation.proposed.json: `4cde56ed1780cfc00af68b1151337d2e6c270fb258f0c55aaf94a6c731f29f5d`
- booking-response-overlay.proposed.txt: `f0de85ca2feb0a8d828dfc87ae719481ab841a4408a529464802774289820726`

## Safe test and approvals

Next owner action: sign in to Sarvam in the available browser for the requested read-only inspection.
No new credential/account setup is needed. No production-change approval is requested before that inspection.

After readback, present one exact scoped version/tool/dictionary change with preserved baseline and rollback.
Any synthesis/browser test that may spend credits needs its own explicit run count and budget approval first.
Listening checklist with unchanged voice: English, Kannada and Hindi sentences containing written WhatsApp;
check consonants, no letter-by-letter spelling, natural switching and unchanged company details.
Booking tests: available approved slot + verified event; unavailable slot; pending approval; failed/uncertain
create; successful saved request; failed request save; interruption; duplicate delivery. Never claim mocks
exercise the deployed agent. A later owner-made verification call needs separate approved duration/cost and
must not be represented as authorised by this review document.

F-03 remains paused/open. WhatsApp worktree, live inbound/outbound, shared app/auth/Calendar code, SQL,
approval gates and all existing dirty work are preserved. No production readiness or successful fix claimed.
