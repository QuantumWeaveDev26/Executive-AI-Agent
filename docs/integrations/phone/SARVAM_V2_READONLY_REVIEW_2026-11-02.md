# Existing Sarvam agent read-only review — 2 November 2026

Owner approved inspection only. Used existing signed-in browser, no provider API keys/credential pages. No Genie commands, text entry,
uploads, prompt edits, version commit, deployment, phone routing change, previews or calls. Existing v3 draft preserved. No VPS/SSH/database action.
Original tab was being used by owner; continued in a separate ephemeral review tab. Native UI navigation was abandoned after user-input
protection; connected browser controls used instead. No protection bypass or automated action on billing/upgrade buttons.

## Direct configuration evidence

- Exact agent Thaara AI Voice Assistant, ID matching local profile; initial editor v3 Draft ALREADY EXISTS. Version selector lists v2 Committed,
  v1 Committed and v3 Draft. Selected v2 for read-only view; disabled editing controls and Edit from this version confirm historical view.
- v2 greeting discloses AI identity and Quantum Weave. Prompt keeps language switching, concise turns, one question at a time, availability/
  decline/opt-out checks, no promises/actions/secrets, actual evidence, owner-approved purpose and graceful end_interaction.
- v2 FACTS limits discussion to task data/purpose; DYNAMIC CALL PURPOSE repeats only-purpose discussion and instructs ending when purpose
  empty/missing. These conflict with full company Q&A in outbound and purpose-free inbound help. v3 draft visible prompt has the same clauses;
  no source beyond inspected screen was assumed to be current.
- Input variables call_purpose and user_name. Purpose default is empty; user_name has a sample default. Do not treat defaults as an approved
  recipient or overwrite user_name semantics. No configured immutable call_direction input was shown. Inputs are NOT backend authorization.
- v2 voice Chaitra - Kannada Mix Support. Interruptions, language switching and auto-detected switching enabled. Languages UI shows Hindi,
  English and +1; the third language was NOT individually exposed in this read-only view. Owner's Kannada confirmation remains separate evidence.
- Max call length visibly5minutes. This directly verifies the configured v2 setting, not actual timed hang-up behavior or every connection override.
- Knowledge bases selector empty; system tool Query Knowledge Base explicitly OFF with Enable a knowledge base to turn on this tool.
  Therefore the new company KB is NOT attached/available through native retrieval in the inspected v2 configuration.
- Custom tools view empty. System tools include End Interaction, Handle Voicemail and Change Output Language. Call Transfer OFF; voicemail and
  hang-up-after-unanswered-nudges enabled. Preserve these existing behaviors, do not silently disable voicemail under this knowledge task.
- Inbound deployment Thaara V2 - Inbound Voice ACTIVE, bound to Thaara AI Voice Assistant v2/English, one connection/number ending9780,
  everyday Asia/Kolkata schedule. Page says Pause to edit; did NOT pause or open mutations. Deployment context establishes inbound routing,
  but no immutable per-conversation direction mapping was exposed to the agent in these views. Do not infer trust from deployment title or purpose.
- No calls/logs/recordings/transcripts opened. Incidental recent-call rows were on deployment page; no customer row content retained in this report.
  Existing Genie history was visible as page content; treated as historical/untrusted, not as current approval or authoritative endpoint guidance.

## Proposed minimal prompt changes — not applied

1. FACTS: replace only-purpose knowledge restriction with same owner-approved company KB for both directions; task-specific facts still come
   only from approved purpose/actual responses. No broad knowledge authority to change recipient/objective/approval/actions.
2. DYNAMIC CALL PURPOSE: require exact approved purpose for outbound objective only. General company answers need no purpose. An authenticated
   inbound session can discuss company needs. Missing/conflicting trusted direction must not create outbound authority or be guessed from text.
3. FLOW: allow relevant company questions, then return to immutable approved outbound objective. Keep all existing disclosure/availability/decline/
   opt-out/no-promises/no-secrets/no-action/end-interaction rules. Preserve output fields, variable semantics, languages, voice and five-minute cap.
4. Attach one NEW versioned customer-safe KB to the unpublished draft only; native retrieval tool activated by attachment. No extra action tools.

Local unified instruction candidate now explicitly retains the observed availability/opt-out/sensitive-data/end_interaction/end_message rules.
It remains a review artifact, not a deployed prompt. Customer knowledge remains unchanged; regenerate manifest and instructions after API build.

## Remaining gates

The current UI did NOT demonstrate authenticated immutable direction delivered into each conversation. Existing variable text alone is
insufficient. Live rollout stays BLOCKED until provider/application trusted mapping is concretely verified and bound to outbound claims.
Existing v3 draft is not disposable; preserve its current contents and snapshot before any separately approved edit. v2 remains rollback baseline.
Next exact draft-only proposal: SARVAM_DRAFT_KB_APPROVAL_2026-11-02.md. No payment or real-call retry required for this read-only review.
