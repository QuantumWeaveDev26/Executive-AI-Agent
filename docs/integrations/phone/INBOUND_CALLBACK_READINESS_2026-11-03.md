# Inbound enquiries and team callback requests — local readiness

## Latest local continuation — authenticated completion prototype and storage review prepared

The earlier foundation below is preserved. New unwired/test-only receiver and route factory validate a dedicated
bearer capability, server-owned route/tenant/owner and exact agent/version/deployment/number. Private typed
PolicyGateway catalog permits only the reviewed report save; it is not exposed to the model/global catalog.
Actor source remains a synthetic owner session for local tests; a safe production runtime principal is NOT ready.
No public production intake route was registered. The saved app feed still reports not_configured.

New repository code scopes every transaction to the active owner session, checks membership, serializes saves,
rejects conflicting replay and audits inserts and reads without customer payloads. New review SQL is additive and
has NOT been executed. Mock transactions are evidence about code paths, not actual SQL/RLS/persistence acceptance.

Reports now support the four outcomes, provider interaction/time/duration/status, customer fields, callback preference
and preferred time, verified Calendar details, and optional expiring transcript/recording references. Provider fields
cannot prove a booking. A backend-owned verified Calendar receipt is required; intake creates no Calendar event.
Missing data stays null; a missing provider time is explicitly labelled receipt time. Callback consent uses a narrow
recap/affirmative pattern with later withdrawal respected; unsupported/ambiguous speech remains review-needed.
This heuristic is not speaker identity verification or broad multilingual consent acceptance proof.

Retention is disabled by default. Explicit backend notice/availability verification permits only bounded references/
transcript snapshots in tests. Expired material is filtered at both repository and API reads; physical purge and
secure audio streaming are NOT implemented/admitted. No audio was fetched or activated. The optional backend
verification interfaces are contracts, not proof of a connected Calendar/media adapter.

Equivalent outbound projection is prepared as a pure unwired function. Existing Outbound Calls UI/dispatch stay
unchanged. The inbound list is still bounded to100 loaded records; full pagination/analytics remain a release gap.

Architecture: `SARVAM_INBOUND_ARCHITECTURE_2026-11-03.md`. Review-only closing/capture instructions:
`INBOUND_CONVERSATION_CHANGE_REVIEW_2026-11-03.md`. Do not apply them to live v5: a real mid-call callback-save tool
and later completion merge are still unfinished. An on_end hook cannot confirm a save before the call ends.

Next requested approval is only the new in-memory SQL package at `PHONE111_IN_MEMORY_APPROVAL_2026-11-03.md`.
This does not authorize provider configuration, live appointments, calls, schema install or deployment.

Owner choice: team callback request, not a Calendar appointment. The displayed success label is **Callback requested**; a requested callback is not a booked time slot or permission to auto-dial.

## Local implementation

- Phone & Calls now contains Inbound calls and Outbound calls. Existing Contacts and Call history remain compatible.
- Outbound calls reuses the existing owner-approved call ledger and reports, without changing dialing.
- Inbound list includes masked number, IST time, outcome, Details, and counts of the loaded records. These are not an all-time analytics count; the response is bounded to 100 records.
- Owner-only detail includes customer name, contact number, business, service needed and actual enquiry summary. Missing information is Not recorded. Text is escaped; no arbitrary HTML, recording link or provider URL is rendered.
- Versioned `/api/v1/connectors/phone/inbound/reports` and `/reports/:id` GET contracts. No public import or booking POST. Not configured returns an explicit state rather than fake records.
- Local normalization distinguishes Enquired, Callback requested and Needs review. Provider-extracted interest by itself cannot produce a saved callback. A matching durable policy-approved receipt is required from a FUTURE trusted persistence adapter. The receipt interface is an INTERNAL contract, not proof verified cryptographically or by a database in this implementation. Never accept its fields directly from provider/model JSON.
- Injected report feeds are test-only; production startup rejects them. Live ingestion, persistence and callback saving are **not implemented or admitted yet**. Do not remove this guard to make the UI appear populated.

## Conversation behavior for the next provider revision (not applied)

1. Disclose AI identity, answer the customer's actual service question in their chosen supported language, and never quote company prices.
2. Ask once, without pressure: “Would you like to request a callback from our team to discuss a solution for your business?” If declined, retain only the enquiry report and do not repeatedly offer or dial.
3. If accepted, collect customer name, type of business, solution/service needed and preferred contact number. Repeat the number and details for confirmation. Do not imply caller ID alone verifies a callback number or caller identity. No OTPs, payment or banking details.
4. Submit only through a separately reviewed authenticated, policy-gated request-saving tool bound to this inbound interaction/workspace. Require a durable transaction/audit receipt before saying the request was saved. On failure: “I couldn't save that request. You can contact our team directly.” Never claim success from model text or a provider HTTP acknowledgement alone.
5. A saved callback request means a human team member can follow up; no date/time guarantee, Calendar event, message or automatic outgoing call. Any later AI call retains its own contact/consent/owner-approval checks.
6. Respect refusal/stop; preserve Chaitra, English/Kannada/Hindi, five-minute limit and existing no-price revision. Do not enable tools or publish versions yet.

## Remaining implementation and sensitive boundaries

1. Prepare a durable, tenant/owner-scoped report and callback-request ledger with explicit retention, RLS, transactionally coupled audit, idempotent event receipt and replay/conflict handling. Missing/malformed evidence must remain review-needed. Validate restart persistence and tenant/replay/concurrency behavior in a newly approved isolated database before proposing persistent install.
2. Review official Sarvam inbound completion delivery and authenticated custom-tool support. Establish a fixed deployment/number-to-workspace mapping, per-interaction binding, replay protection, input bounds and secret-file/transport handling. Caller, transcript, agent variables and KB text cannot choose tenant or grant authority. Existing outbound capability callback cannot be reused as a generic inbound import.
3. Implement the request-saving PolicyGateway action and durable adapter behind an independently reviewed production admission path. Audit owner reads of full callback numbers. No raw customer/provider payloads in logs. Post-call report failure must not erase a previously saved callback receipt; uncertain results must be reconciled without duplicates.
4. Prepare one exact approval package for isolated SQL validation, then separate scoped packages for persistent migration/backend deployment and the existing-agent KB/prompt/tool revision. No migrations, credentials, live provider changes or deployment are implied by local development authorization.
5. After approved installation, perform one separately approved owner inbound test, review the exact call/report/request receipt and verify the app entry. Roll back only within the approved package. No real call or paid simulation in this slice.

Current browser control remains blocked by Work settings in recent attempts; the actual inbound route has not been independently verified, despite owner-reported working inbound calls. No new browser attempt was needed for local implementation.

## Latest local journal milestone — 3 November 2026

UPDATE: separate owner-approved SQL112memory-only run now completed8/8PASS,0failed/skipped; engineclosed,
gatecleared, markerretained. Approvalconsumed. See `PHONE112_IN_MEMORY_RESULT_2026-11-03.md`.
Supersedes pending-SQL112 notes below; no persistent install or production/provider activation authorized.

Mid-call callback save and completion reconciliation now share a test-only immutable event journal. Failed saves
never confirm; duplicates reuse receipts; withdrawals dominate replay/order; owner reads remain scoped and audited.
49/49 focused tests PASS; contracts/API builds and API typecheck PASS. No active backend route/provider tool enabled.
NEW additive SQL112 and eight acceptance tests await the separate approval in
`PHONE112_IN_MEMORY_APPROVAL_2026-11-03.md`; discovery correctly skipped all eight. Historical1118/8 is not
evidence for SQL112. No real multi-connection PostgreSQL, restart persistence, live callback delivery, recording
access or Calendar integration verified. Prior111execution marker remains intact.

## Earlier verification

- API final: 31/31 in five files (13 inbound normalization/routes/startup checks and 18 existing runtime/pinning regressions).
- Web milestone: 270/270 tests in 23 files, including existing phone, Gmail, Calendar, WhatsApp and navigation coverage. Includes non-owner PII guard regression; role-inclusive remount and abort/clear fix followed focused independent review.
- Contracts build, API typecheck, web typecheck/build passed. Web build emitted its chunk-size advisory; no build error. No runtime provider/database acceptance is implied.
- Receipt: `node_modules/.cache/phone-inbound-web-20261103.json`.

No live version, KB, route, VPS, SQL, credentials, n8n workflow, Gmail, Calendar, WhatsApp, commit or push changed. Text reports are implemented; audio retention/recording import is outside this local slice.
