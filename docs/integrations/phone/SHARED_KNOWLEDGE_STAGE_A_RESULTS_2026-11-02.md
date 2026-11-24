# Shared company knowledge Stage A — provider versions prepared

2November2026. Owner approved exact StageA scope, then ONE save-aware retry after the initial incoming edit did not persist.
StageAcompleted. Exactly TWO new committed versions in SAME existing Thaara AI Voice Assistant; neither deployed or conversation-tested.

| Role | Actual provider version | Approved canonical prompt SHA256 |
|---|---|---|
| Incoming only | v3 Committed | e74cd1559cae67a8e2e4068aa3b643852b21c897387bda53bb553d7059e10c33 |
| Outgoing only | v4 Committed | 50715d830475a1f8ea12f3c339ef1e0e8e55360faa4d5e9549a2a0c54b1bce8b |
| Existing live inbound | v2 Committed / ACTIVE route | Original unchanged; no new KB |

Same appID Thaara-AI-V-db336de4-5453. Sarvam automatically opened v5 Draft after the second commit; no third commit or v5 edit was performed.
No new agent/KB/number/telephony connection. v3/v4 share existing qw-company-kb-v1, ID01a19bee-d7ed-778c-b0db-e320e8209de9.
KB stayed Synced/Ready with one quantum-weave-public.md file; its content was not edited or reuploaded.

## Fresh configuration verification

- Both final prompts persisted across reload and committed-version readback matched the approved canonical text. Provider read-only rendering
  joins paragraph text without whitespace; comparison reconstructed actual DOM paragraph boundaries and normalized whitespace/native tokens.
  These SHA256s identify local canonical artifacts, not an independently fetched byte-for-byte provider export.
- Outgoing v4 has native user_name and call_purpose tokens. user_name remains recipient; original variable definitions/defaults unchanged.
  The existing sample default is not consent or an approved call recipient. Incoming does not require purpose and has no substitution tokens.
- Both versions retained existing greeting/AI disclosure, Chaitra, shared KB and captured control values including five-minute maximum,
  interruption/language-switch settings, nudge/voicemail/end-call behavior and transferoff. English/Hindi/Kannada were directly observed as
  selected at preflight; language settings were never edited. No actual audio/language/cap enforcement test is claimed.
- Both versions retained call_summary string extraction: A short 1-2 line description of what happened on the call. No custom action tools.
  Existing End Interaction, Query Knowledge Base, Handle Voicemail and Change Output Language remained available; Call Transfer off.
- AFTER both commits, original v2 prompt/greeting matched baseline; original captured settings unchanged and its KB selector stayed empty/
  readonly. LIVE inbound Thaara V2 - Inbound Voice still ACTIVE on v2/English, same number9780 and everyday Asia/Kolkata schedule.
- Local/VPS runtime profile was not changed. Existing local profile still selects appVersion2; new KB/policy/provider acceptance not installed.

## Retry, snapshots and evidence limits

Initial attempt: fill immediately matched, reload before save completion retained original mixed v3. Stopped without commit or auto-retry.
After separate approval: normal editor blur/save interaction and settled traffic preceded reload, incoming persisted. Actual vendor save
implementation is not independently proven; observed successful sequence avoids premature reload. Transient reads during save/selected-version
loading were not mistaken for final state. One read wait/browser session reset required read-only recovery, with no additional provider writes.

Private ignored canonical/observed baseline: node_modules/.cache/sarvam-stage-a-20261102-preflight.json.
Initial failed-attempt receipt: node_modules/.cache/sarvam-stage-a-20261102-result.json.
Final owned receipt: node_modules/.cache/sarvam-stage-a-retry-20261102-result.json, status stage_a_complete_not_deployed.
Voicemail text remained UI-redacted; never unmasked or changed. Configuration readback does not establish provider identity, runtime
authorization, retrieval accuracy, natural conversation quality, actual timed hang-up or task success.

Fresh this stage: all3local export integrity checks and Git whitespace checks PASS; browser configuration readbacks as above.
No executable code changed, so historical70artifact-focused and925API/133focused checkpoint results reused, not reported as fresh tests.

## Preserved boundaries and next milestone

ZERO paid/model/browser voice/retrieval tests, telephone calls, messages, credential changes, recharges, deployments, live-route changes,
VPS/SSH/Docker/SQL/migration/service-restart operations or Git commits/pushes. Gmail/Calendar/Chat/WhatsApp/n8n unchanged. Existing uncommitted
work and Viteconfig preserved. StageApermission is consumed; do not create more versions or mutate prompts/KB without new scope.

Next is StageB: prepare exact synthetic interface/test-count/cost approval using v3incoming/v4outgoing only, AFTER owner confirms planned
credit resolution and separately approves provider testing. Do not turn providerAcceptanceVerified=true based on StageAconfiguration checks.
StageC actual runtime knowledge/version binding, routing/deployment and ONE controlled own-number call remain separate scoped approvals.
Generated final manifests still have null unadmitted runtime bindings and authorization=false; actual provider version identities are recorded
here rather than silently converting those manifests into a live profile. Keep v2 and original mixed-draft snapshot as recovery baselines.
