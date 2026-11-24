# Sarvam trusted direction investigation — 2 November 2026

Documentation and local source review only. No authenticated provider request, account mutation, deployment, SQL, call or payment.
Existing unpublished v3 shared-knowledge draft and committed/live v2 remain as verified in the latest handover.

## Confirmed evidence

1. [Variables](https://docs.sarvam.ai/voice-agents/build/variables-personalization): documented read-only system values are date/time,
   start_datetime and language_name. No documented read-only direction field was found. Ordinary input/output variables share storage and
   tools can change them. A field named call_direction, purpose presence, caller assertion or final variable is not authorization.
2. [On-start hooks](https://docs.sarvam.ai/voice-agents/build/on-start-on-end-hooks): start hooks can load context and map responses to variables.
   The reviewed page does NOT specify signed request identity, stable attempt/interaction binding, a trusted direction field, replay controls,
   or guaranteed fail-closed behavior on authentication/timeouts. This is missing evidence, not proof that Sarvam lacks those capabilities.
   Adding an unverified public hook or a flag returned by one would not solve the boundary.
3. [Instant Outbound](https://docs.sarvam.ai/voice-agents/api/instant-outbound/create): application supplies numeric app_version.
   Existing adapter phone-sarvam-calls.ts pins it from server configuration, not from Chat/browser/caller input. It sends only approved purpose
   and recipient name as variables. Callback metadata is completion correlation, not authenticated pre-conversation model context.
4. [Inbound deployment](https://docs.sarvam.ai/voice-agents/deploy/inbounds): routing selects an agent and committed version. Existing v2 routing
   is separately verified historical account evidence. Documentation does not prove that route identity becomes an immutable model variable.
5. [Versioning](https://docs.sarvam.ai/voice-agents/build/agent/versioning): draft, committed and deployed configurations are separate. Treat saved
   version configuration as a reviewed routing input; do not claim cryptographic immutability or actual route enforcement from documentation alone.

## Local security chain retained

PhoneCallingService.confirmLive revalidates owner/approval/consent and binds the approved draft, claims once durably, then claims its dispatch
before calling the provider. Provider configuration fingerprint includes version, connection, caller, duration and variable mapping. Changing
version changes the fingerprint and must invalidate an old approval. No model or returned variable authorizes a second dispatch.

The pure phone-company-knowledge review resolver is UNWIRED and is not provider authentication. No authenticated inbound start-context route
was implemented by this work. Results/analytics channel_direction obtained AFTER a call cannot authenticate its direction before speech.

## Approaches and recommendation — proposal, NOT an implemented live solution

**A: One mixed-direction version plus authenticated start context.** Best fit if Sarvam supplies a verifiable server-side start identity and
non-model-controlled route binding. Requires documented payload/authentication/replay/failure semantics and synthetic acceptance. Current
evidence is insufficient. Do not add a secret or change hooks merely to experiment; provider/account setup remains approval-gated.

**B: Same existing agent, separate pinned inbound and outbound committed versions, ONE shared KB. Recommended fallback for local design.**
Use a static direction-specific policy in each reviewed version. Controlled inbound deployment pins the inbound version; Thaara's existing
approved outbound adapter pins a different outbound version. Direction is selected by the server/deployment binding, never by editable variable
or purpose existence. Shared facts and common safety policy remain single-source; only the direction overlay differs. No new agent, number,
campaign, database, mutable authorization field or replacement calling stack is needed.

This is an architectural inference from documented version selection, NOT proof that the current mixed v3 has trusted direction. Version
numbers are not reserved: discover the actual numeric versions after a separately approved commit. Current v3 remains mixed and unpublished;
do not quietly convert it, commit it, or change v2. Provider sandbox tests must prove version selection, caller override resistance, identical
KB access and no extra tools; the configured KB itself must remain frozen because KB edits can affect all attached versions.

## Next bounded work and acceptance gates

Prepare LOCAL direction-specific candidates from the reviewed shared policy, a proposed routing manifest (reviewOnly=true; no actual new version
IDs), and synthetic tests. Preserve the existing v3 candidate as the baseline. No live profile or current adapter behavior changes in that slice.
Tests must cover exact workspace/owner/app/version/direction binding, rejected mixed/unknown/mismatched routes, no purpose requirement for inbound,
exact approved outbound purpose and recipient, identical KB hash, 300-second cap, missing/changed KB/policy binding, rejection of caller-variable
overrides and stale approvals after any configuration change. Fixtures must remain explicitly non-authorizing and never dispatch.

Before live admission, implement/review version + direction + KB/policy binding in the server-owned runtime fingerprint and audit, with focused
failure tests. Current fingerprint binds the app version but does NOT include the new shared KB/policy hashes: do not claim that gate exists yet.
No existing approval can cover a changed version/configuration. Keep one-use claims, default daily5, consent, no automatic redial and truthful reports.

Provider sandbox/model tests need explicit scoped authorization (may consume credits). Actual committed versions, inbound routing changes,
runtime profile changes/deployment and one own-number call need separate scoped approval. No approval is requested for live changes by this review.
Owner postponed payment; no real-call retry until owner confirms credit resolution and separately approves the controlled call.

## Verification limits

Source and public documentation inspected; executable files unchanged. No tests rerun for this documentation-only investigation. Prior31/31
shared-knowledge and111/111 focused results remain historical. Neither those fixtures nor saved draft readback proves Sarvam conversation safety.
Shell access to public Markdown failed DNS; web reader successfully read official HTML pages. No escalation/provider API request was attempted.
