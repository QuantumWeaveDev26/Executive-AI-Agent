# Shared Quantum Weave voice knowledge — local package and staged rollout

Backend admission continuation (LOCAL): optional STRICT companyKnowledge server-profile attestation now flows through loader to provider
configuration fingerprint; invalid present binding refuses, absent retains byte-compatible legacy fingerprint. Updated configuration rejects
stale approvals before provider fetch. Dispatch/result configuration is detached/frozen across async secret reads. Fresh final74/74 focused,
API build/typecheck/export checks pass. No actual attestation installed; parser validates operator-provided claims, not provider truth.
Exact stages/remaining approvals: SHARED_KNOWLEDGE_CONTROLLED_TEST_PACKAGE.md. Mixed provider v3/livev2 and runtime profile unchanged.

LOCAL direction slice complete: knowledge/direction-review-v1 contains two static review-only overlays and internal manifest with null future
bindings. UNWIRED phone-company-routing-review.ts compares server-resolved review evidence with scope/route/version/KB-policy/cap configuration;
stale synthetic approval fingerprints rejected. Outputs never authorize dispatch. Fresh94/94 focused, API build/typecheck and both exporter
checks passed; no provider/live integration proof. After API build, node scripts/export-phone-company-routes.mjs then --check reproduces files.
Existing provider v3/mixed candidate, live v2 and runtime profile unchanged. See task110/current handover for exact evidence and limitations.

LATEST2Nov: approved customer KB created/Synced/Ready and attached ONLY to v3 Draft; exact separately approved full prompt replacement saved
and reload-verified with two native purpose tokens. Committed v2 prompt/empty KB unchanged. No publish/deploy/test/call. Entries below describing
uninspected/unchanged provider state are historical. Current evidence: SARVAM_DRAFT_KB_APPROVAL_2026-11-02.md and latest daily handover.
Trusted direction investigation: SARVAM_TRUSTED_DIRECTION_REVIEW_2026-11-02.md. Mixed v3 is NOT yet eligible for live release. Proposed local
fallback uses same agent/separate future pinned direction versions/shared KB; no routing/profile change or numeric version creation authorized.

2November2026. Local preparation completed; active Sarvam agent NOT inspected or changed in this task. No upload, provider test, version commit,
deployment, call, message, credential change, SQL, VPS/service action or Git commit/push. Owner postponed payment; displayed balance -2.88 and
stored HTTP402 rejection remain the live calling blocker. Do not reset daily limits, enable auto-recharge or redial.

UPDATE: owner subsequently approved READ-ONLY configuration review, now complete. See SARVAM_V2_READONLY_REVIEW_2026-11-02.md:
committedv2/presentv3draft purpose-only/missing-purpose-end clauses confirmed, nativeKBqueryOFF, UImax5minutes, activeinboundv2.
No immutable per-call direction exposed in reviewed UI. No provider config changed. Next scoped draft-only approval is
SARVAM_DRAFT_KB_APPROVAL_2026-11-02.md; original preparation descriptions below retain their historical context.

## Local implementation and sources

Canonical customer facts and language examples: apps/api/src/knowledge/quantum-weave.v1.ts, version qw-company-kb-v1.
All company facts derive from owner-approved DocumentA. Section references stay attached; published999/9999/14999figures are explicitly
NOT confirmed current quotes. Unknown availability/prices/events/timelines/guarantees require human confirmation. Confidential employee/client/
infrastructure material and deployment/provider identifiers are excluded from the customer KB. Underlying source-register documents were named
by DocumentA, not independently inspected here. Authority is the owner's supplied compilation, not an independent verification claim.

DocumentA SHA256 ba0d47ff57731e31ec61f71498f133bf9fd50d6344577407b74ebbb33af51eb9.
DocumentB SHA256 8c1b79452d6b2242fb8bd6ce887b8ea57fda457be3811407c4cbecd92d072232.
DocumentC DOCX at supplied path is ZERO BYTES; its supplied four-page screenshot was used for integration guidance. Do not claim DOCX ingestion
or a verified binary hash for its content. Supplied screenshot SHA256 d4fb5201369691d5c19d3facc87899aac61317d1f75b2ad8a2099d713dee13e4.
Original documents remain untouched. Older outbound-not-live assertions in them are superseded by
the31Oct completed call records and2Nov402failure evidence; operational status is not customer knowledge.

DocumentB guides unified instructions; DocumentC screenshot guides separation of knowledge/conversation/direction/action/evidence.
Output files in knowledge/review-v1:
- quantum-weave-public.md: customer-safe KB, candidate for native Sarvam ingestion AFTER approval.
- unified-voice-instructions.txt: instructions for review, NOT a KB document and NOT a live prompt. No JSON response protocol from old Plivo engine.
- review-manifest.json: LOCAL INTERNAL content hashes/version metadata. Do NOT upload it as company knowledge.

Reproduce locally: pnpm --filter @thaara/api run build; node scripts/export-phone-company-knowledge.mjs; then same exporter --check.
Generated exports are derived files. Edit the canonical source, rebuild and regenerate; never maintain two independent KBs or edit generated
exports by hand. No new model, provider, package dependency, database or retrieval infrastructure was introduced.

## Direction and security — what is and is not implemented

phone-company-knowledge.ts is an UNWIRED pure preparation module. Both review directions reference the exact same customerKnowledge/version.
An injected SERVER-ONLY resolver must later supply authenticated inbound mapping or an authorized outbound claim, with exact workspace/owner/
session/cap binding. Caller variables, text and purpose presence do not choose direction. Outbound requires approval/claim/purpose/recipient/
expiry; inbound does not require purpose. Review contexts frozen and recognized by a local WeakSet. Every result remains reviewOnly and
dispatchAllowed=false; there is NO execution authority or new route. Model proposals and KB snippets never grant additional calls/actions.

The resolver contract is NOT itself provider authentication, PolicyGateway evaluation, claim consumption or audit. These remain future integration
dependencies backed by existing real gateway/store machinery. No synthetic flag may be wired as proof. Existing phone request/approval/claim/
consent/audit/limits/replay/callback/result code and runtime profile were not changed. No source edits to actual inbound mapping or Instant Outbound.

previewCompanyVoiceTurn is a deterministic text fixture, not an NLP classifier/LLM/voice service or transcript generator. It previews canonical
answers, safe language examples, unknown handling, denied actions and return-to-purpose text. It does not validate accent, naturalness, language
detection, interruption handling, retrieval quality, factual grounding by Sarvam's actual model or real conversation outcomes.

Current inbound: owner-reported connectivity/transcripts work on existing agent. New KB availability and unified instructions NOT live.
Current outbound:31Octcompleted records;2NovHTTP402with no attempt ID. Owner must resolve balance separately. New KB NOT live.
Current five-minute setting owner-confirmed; live provider enforcement and any new version need their own acceptance evidence.

## Official provider capability review

- Native KB supports Markdown and other document types, asynchronous ingestion, attachment from agent Settings and a query tool. Retrieval returns
  source-tagged chunks. It does not require another database/provider: https://docs.sarvam.ai/voice-agents/build/knowledge-base.
- KB edits apply wherever that KB is used. Create a DISTINCT versioned KB for candidate changes; do not modify/delete an existing live attachment.
- Ordinary agent input/output variables share mutable storage; tools may change them. Therefore call_direction in an ordinary variable is NOT a
  backend authorization boundary. Read-only documented system variables do not include an immutable authenticated direction field:
  https://docs.sarvam.ai/voice-agents/build/variables-personalization.
- Versions separate draft, committed and deployed states: https://docs.sarvam.ai/voice-agents/build/agent/versioning.
  Exact current prompt/KB attachments/available immutable call context have NOT been read from the account; do not invent variable syntax or IDs.

## Rollout stages and approval boundaries

1. **Next requested sensitive action: read-only existing-agent snapshot.** Separately approve inspection of ONLY Thaara AI Voice Assistant,
   committed v2/draft, its instructions, variable definitions, allowed language/voice/five-minute settings, KB attachment names and the existing
   inbound deployment's direction mapping. Read non-secret configuration only; no keys, recordings/transcripts, other agents, previews/Genie
   actions, edits, uploads, version commit, deployment or call. Record rollback baseline privately and compare native immutable direction support.
   If no trusted inbound context can be established, keep action authority denied and mark direction integration blocked; do not infer from purpose.
2. **Separate draft-only upload/edit approval.** Present exact finalized file hashes and a diff against the snapshot. Create one NEW versioned
   KB named qw-company-kb-v1 from quantum-weave-public.md only, wait for ingestion completion and attach only to an unpublished draft of the SAME
   existing agent. Stage unified instructions there. Preserve existing v2, Chaitra, languages, purpose/recipient variable semantics, end-call tool,
   duration and connected number. No new agent/number, existing KB mutation, live deployment, new outbound tool or arbitrary variable authority.
   Verify KB routing description explicitly covers company questions in both directions and ignores purpose presence. If draft isolation cannot
   be proved, STOP before any change. Draft/upload approval does not cover paid browser/model tests or committing versions.
3. **Separately approved provider tests/version commit.** Test actual retrieval/source citations, unknowns/pricing, bilingual turns, interruptions,
   return-to-objective and prompt injection in provider sandbox. Verify trusted direction routing and fail closed. Local deterministic fixtures
   are not a substitute. No real phone call. Stop on unexpected response; retain evidence and old baseline.
4. **Separate deployment/runtime admission approval.** Pin reviewed new numeric version, KB/policy hashes and trusted direction binding in the
   future runtime profile/approval fingerprint, only after actual version content/cap verified. Current runtime rejects unreviewed binding changes;
   never change the active v2 profile under this task. Plan inbound/outbound rollout and rollback together; no automatic version selection.
5. **Separate ONE own-number call approval, after payment.** Existing contact consent, approval, one claim, daily5 and five-minute limits apply.
   Verify callback/attempt correlation, authentic result retrieval and truthful actual recipient report. No redial or invented success.

Rollback: preserve v2 and existing KB/deployment, with original routing/profile fingerprints. Unpublished candidate can remain inert. Actual live
rollback requires separately approved scope to restore matching provider version AND Thaara binding; never simply swap a live profile or delete
KBs used elsewhere. If evidence disagrees, mark unverified and stop. No backup/data/service deletion.

## Local acceptance evidence

New31unit scenarios plus related existing call/provider/startup/Google tests:111/111across7files recorded in node_modules/.cache/phone-company-knowledge-regression.json.
Final31new tests rechecked after denial wording update; existing80unchanged reused. API build/typecheck/export --check and whitespace/Vite checks
passed, recorded in latest handover. Scoped read-only code review found no consequential findings and noted
unimplemented authentication/speech dependencies. No natural conversation/real provider acceptance claim. Existing completed features preserved.
