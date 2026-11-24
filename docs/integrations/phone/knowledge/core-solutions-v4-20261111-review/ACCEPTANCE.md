# Core custom solutions and normal-volume interruption acceptance

This candidate is local and unpromoted. It preserves the original hash-pinned v3 KB and current working voice settings until readback, review and scoped promotion. The owner resumed with Codex rather than Antigravity.

## Priority: speech detection at normal volume

Sarvam distinguishes **Sound sensitivity** from **Eagerness to respond**. The former controls how readily incoming audio counts as speech; the latter controls when the agent responds after a pause. Reference: https://docs.sarvam.ai/voice-agents/build/conversation-settings (checked 11 November 2026).

The reported need to speak loudly is consistent with a detection/sensitivity issue, but the live setting and actual audio behavior have not been inspected. Historical v5 evidence had interruptions enabled and a Normal volume threshold; it is not evidence for today's active version. The local PhoneVoiceSession already interrupts on partial/final transcripts; that does not establish when the hosted Sarvam agent detects quiet speech. Do not claim a live fix based on local synthetic tests.

1. Read back the current inbound version, deployment binding, voice, allowed languages, interruption setting, sensitivity label, eagerness label, background sound and duration cap. Preserve the current version/settings for rollback.
2. In a separate candidate, enable caller interruptions, try High sound sensitivity, use Patient response timing, retain the current voice and languages, and retain the 300-second limit. Use the provider's labels; old numeric slider mappings are unverified. Do not use louder playback as an interruption fix. Background sound should be No sound for the test; avoid adding ambience to simulate a human.
3. With owner-authorized audio testing, interrupt the greeting, service list, pricing explanation and callback recap at normal speaking volume in English and Kannada/Kanglish. Verify audio stops, the complete question is heard, the new question is answered, and the old answer is not resumed unless requested. Include softer speech, thinking pauses, background noise and speaker echo. Record observed stop latency; a sub-300ms stop is an engineering target, not a verified result.
4. Repeat the same normal-volume scenario enough to detect inconsistent recognition. Reject a setting that requires shouting, repeatedly misses interruptions, cuts off the caller during pauses, or falsely stops on room noise. If High produces false interruptions, evaluate Medium with controlled audio rather than weakening the requirement or inventing a raw threshold.
5. Verify the existing AI disclosure, language switching, voicemail behavior and duration cap remain intact. Do not place real calls or run paid provider tests without explicit approval.

## Conversation and callback checks

- “What services do you provide?” includes Core custom solutions alongside existing services.
- “What core custom solutions?” lists the five exact owner-provided offerings.
- A pricing enquiry receives the exact supplied English response (or equivalent meaning in the caller's selected language), followed naturally by a callback offer. Interruptions remain enabled during the pricing response.
- A normal enquiry receives a relevant callback offer after roughly two to four useful exchanges rather than only at closing; a refusal is respected.
- Ask only for missing name, business and interested service. Use the verified incoming number without asking the customer to repeat it. No model-extracted alternate number replaces inbound metadata.
- Recap details and get explicit consent. Continue helping after confirmation; do not call end_interaction because the callback was confirmed. “No thanks” to an unrelated later question must not withdraw consent. Explicit withdrawal still cancels.
- New corrected details require fresh recap/consent. Email remains fixed to connect@brandmintai.io and only the dedicated approved backend can submit it. No save/send/delivery claims without corresponding verified receipts. Callback capture currently processes the final event; this patch does not invent an in-call email tool or activate the worker.

## Local evidence and live blocker

Two candidate checks passed. Focused voice/callback suite: 51 passed across five files, zero failures, using synthetic engines/events only (`node_modules/.cache/phone-core-solutions-voice-tests.result.json`). These reuse the existing interruption tests and cover the latest continuation/verified-number fixes. Provider audio acceptance is pending.

CUA inventory reported “Local browser use is disabled in Work settings”; there was no accessible Sarvam browser surface. No browser-control workaround was used, no provider setting was edited, and no live version was promoted. The pending owner setup is to enable local browser use and open the signed-in Sarvam agent page. No credentials should be shared in chat.
