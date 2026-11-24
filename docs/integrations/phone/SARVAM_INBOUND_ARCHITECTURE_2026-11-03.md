# Step111 inbound integration review — 3 November 2026

Local preparation only; no account/provider API request or live mutation. Existing inbound v5 and outbound workflow remain unchanged.

## Official contract review

- Inbound deployments support completion POSTs via deployment `webhook_config` with URL and metadata. Payload: app/version/deployment/interaction IDs, caller/agent E.164 numbers, duration, start/end UTC times, final/output variables, and agent/user transcript turns. It does not document a recording URL or definitive completion status. Do not invent either from agent variables.
  https://docs.sarvam.ai/voice-agents/api/deployments/webhooks/webhook-payload
  https://docs.sarvam.ai/voice-agents/api/deployments/update
- The inspected webhook contract does not document signing or a custom Authorization-header setting. This is absence of documented authentication, not proof that the provider can never offer it. Do not expose an unauthenticated ingestion endpoint or claim independent provider authenticity.
- API tools support bearer/API-key/basic authentication via secure secret references, call-context interaction ID, caller identifier, transcript and call length, and run/on_start/on_end lifecycles. An authenticated on_end tool is the preferred candidate for report delivery; a separate authenticated mid-call tool is needed to save a callback before speaking confirmation. Neither is enabled on current v5 by this work; committed-version changes need scoped approval and may require a new version.
  https://docs.sarvam.ai/voice-agents/build/tools/https-tool
- Agent-scoped Analytics GET APIs can reconcile interactions/transcripts/recordings with X-API-Key. Recording GET returns WAV or404, not a JSON download link. Recording existence, call consent, retention and endpoint access remain separate checks. Do not forward arbitrary payload URLs or expose provider API keys/audio URLs to browsers.
  https://docs.sarvam.ai/voice-agents/api/analytics/overview
  https://docs.sarvam.ai/voice-agents/api/analytics/transcripts
  https://docs.sarvam.ai/voice-agents/api/analytics/recordings

## Local design

1. A server-owned route profile binds tenant/owner, exact agent/version/deployment/number and a protected bearer verifier. Body fields cannot choose tenant or permissions. Secret values must never appear in URLs/logs. Production intake remains unwired until runtime-principal, TLS/private-link, secret storage, rate limits and audit admission are reviewed.
2. Parse a bounded completion payload into a report. Missing fields remain null. Captured business fields are provider-reported untrusted text; they never authorize Calendar, messages or calls. Use stable per-route interaction hashes for idempotency and reject conflicting replay.
3. Prefer explicit consent recorded during the live tool workflow. For local completion-data testing, a narrowly recognized callback recap/affirmative transcript pair may establish callback interest, but cannot establish actual speaker identity or provider authenticity. Never count a model boolean or claimed booking ID as a saved request.
4. Persist report and saved-request evidence atomically with audit. A typed PolicyGateway must approve the write under an explicitly reviewed intake profile; it cannot grant general tool execution to callers. Only return confirmation after commit; failure/timeout stays unconfirmed and idempotent retry/reconciliation is required. Current owner-session repository is not a production runtime principal.
5. Booked appointment requires a backend-owned receipt from the existing approved Calendar flow with verified event readback and matching call/customer/slot. The intake path must not create Calendar events from arbitrary provider variables. A missing/failed Calendar receipt never yields Booked appointment.
6. Recording/transcript retention is opt-in and bounded, with caller notice/consent evidence. Default: no retained raw transcript/audio, no media fetch. Store opaque internal references only after a trusted backend adapter verifies availability and authorization. Owner-only reads are audited; raw external URLs are forbidden. Retention enforcement must be verified before production admission.
7. Keep existing UI/routes and outbound flow; add optional detail fields/statuses. Outbound receipt projection may reuse reporting types, without changing dispatch or automatic reconciliation.

An on_end report cannot confirm a save during a live conversation. The authenticated mid-call request tool and
its later completion merge need a separate event/receipt design; the current final-report repository is immutable
and cannot be reused blindly for two different payloads with the same interaction ID. Do not activate a prompt
that says a request was saved until that tool and reconciliation have passed acceptance.

## Release gates

New SQL remains a review artifact and is NOT executed under the previous fixture-only approvals. Eight drafted in-memory storage tests remain unexecuted until a checksum-pinned package and separate owner approval. The earlier draft must be reconciled with expanded fields/statuses before pinning.
No live webhook/tool/agent-version changes, audio recording activation, credentials, deployment or appointments are authorized. Live v5 settings/permissions and the current route cannot be freshly established from documentation; require later read-only account verification.
