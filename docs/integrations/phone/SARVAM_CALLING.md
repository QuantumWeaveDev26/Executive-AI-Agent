# Thaara phone calls through Sarvam Voice Agents (owner decision, 29 Oct 2026)

Status: **built and tested locally with a fake Sarvam network. No real call has been placed. Live calling stays off** (it can only be
switched on in the test environment until a separately approved deployment).

## How a call works

**Latest owner confirmation:** existing agent has committed numeric version **2**; Sarvam Managed (Vobiz) number **+918064269780** and inbound
deployment are active, with real inbound multilingual/transcript acceptance owner-reported. Owner has now selected **five minutes for outbound
approval drafts**, matching the existing cap. All non-secret IDs including the connection ID are recorded in the review profile. Preserve inbound v2;
no outbound call or deployment approved. Local default is 300 seconds for that configured Sarvam cap; a different explicit maximum is refused,
never silently widened. The Chat approval card shows the duration. Actual version-specific provider settings remain to be verified before activation.

**Existing-agent configuration (superseding earlier draft notes):** Thaara AI Voice Assistant, committed numeric version2; Chaitra – Kannada Mix Support;
English/Kannada/Hindi with switching; input variables `call_purpose` and `user_name` (recipient, not owner). AI disclosure, security rules,
end-call action and browser test/summary are owner-reported configured/successful. Preserve this agent; the older create-from-scratch instructions
below are historical. Existing IDs/telephony are recorded. On31 Oct the owner reconfirmed the five-minute cap and prepaid balance, then healthy
Vobiz managed telephony with deployment inbound_outbound bound to committed v2. No telephony changes needed. Endpoint/key permission is a separate
unverified fact; do not repeat setup or infer that permission from a deployment label alone.

Local compatibility slice: Sarvam outbound now maps only the approved purpose to `call_purpose` and resolved recipient name to `user_name`.
The owner's name stays in the approved on-behalf-of introduction. Agent/version/connection/caller/variable-mapping fingerprint is included in
live approvals; configuration changes invalidate old requests before approval/dialing. No real IDs or secrets have been configured.

Authenticated result readback: explicit owner POST `/api/v1/connectors/phone/ai/calls/:callId/result`, PolicyGateway/audit/session gated,
loads the private stored attempt ID and current bound agent profile; at most two fixed-origin GETs retrieve a completed matching attempt/version
and its original-language recipient transcript. No retry, redial, arbitrary URL, raw provider payload or callback-ledger overwrite.
Chat's **Check provider result** displays this separate evidence as unverified. It does not claim to fetch the exact browser-generated summary
or replace the existing spoken callback report. Empty, pending, mismatched and failed responses remain truthful states.

Sarvam date/slash interaction IDs are supported in adapter, contracts, scoped ledger validation, browser and reviewed 110c SQL.
The reviewed SQL changed locally, not on any database service. Prior checksum pins are invalid; approve only the updated artifact after testing.
Hindi is configured on the remote agent but is not yet an available Thaara Chat calling language; no unsupported Hindi runtime claim.
The report TTS adapter's default Kavya was not silently replaced with Chaitra: its precise TTS identifier/compatibility remains to be verified.

1. Owner in Chat: "Hey Thaara, call Ram and ask whether he can attend tomorrow at 11."
2. Thaara finds Ram in the owner's saved contacts, checks calling consent, and prepares a LIVE request showing the person, masked
   number, purpose, language and the AI introduction. Nothing is dialled.
3. Local Chat: owner presses **Call <name> now** to explicitly approve the displayed request and start one call. The Phone panel retains its separate approval/start flow. One approval = one dispatch attempt; unknown outcomes never automatically retry.
4. Thaara asks Sarvam to call (Instant Outbound API) from the owner's Sarvam number with the owner's Sarvam agent. The agent's first
   line is forced to Thaara's approved AI disclosure; the approved purpose and language are passed as agent variables.
5. Sarvam talks to Ram and, when the attempt ends, POSTs a result to a per-call secret webhook address.
6. Thaara records the outcome (completed / no answer / busy / failed) and the **recipient's lines only**, labelled
   *"as rendered in English by the call provider (untrusted; may be translated, not exact words)"*. The report never infers agreement.
   The owner can read it in Chat/Phone screen and play it aloud.

## Safety and honesty limits (important)

**29 Oct local checkpoint:** Chat confirmation/report speech is implemented/tested, not deployed or enabled. Speech takes only a call id, checks owner PolicyGateway permission and scoped terminal call, audits before TTS and rechecks session. Explicit playback and fallback preserve uncertainty labels. Provider speech is test-only pending approved deployment. [Evidence and blockers](../../THAARA_DAILY_HANDOVER_2026-10-29.md).

Application logs redact Sarvam capability paths; proxy/access/APM logging must also protect them before deployment. Enforceable duration/billing controls remain a live blocker. Check existing owner setup before following the list below; purchases/credential changes still require approval.

- **Sarvam documents no webhook signature.** Thaara accepts a result only on the per-call capability URL (HMAC of the call id with a
  server-only secret), only with the attempt id Thaara dispatched and the echoed call id, and always marks results unverified.
  The webhook URL must therefore be treated as a secret (no URL logging).
- **Transcript is Sarvam's English text (`en_text`)**, so Kannada answers are translations, not exact words.
- **The conversation runs on Sarvam's side.** Thaara's in-code conversation rules (phone-voice.ts) do not apply to Sarvam's agent; the
  agent must be configured in Sarvam with Thaara's persona (`phone-persona.ts` text), the female voice, and a short maximum duration.
  Sarvam has no documented per-call duration limit field; `thaara_max_duration_seconds` is passed as a variable only.
- Phone numbers are read from the owner's contact, never from the browser or the model; replays never dial again; failed requests are
  not retried; `unknown` outcomes are recorded and never retried.

## Code

- `apps/api/src/services/phone-sarvam-calls.ts` — gated provider + webhook admission.
- `apps/api/src/routes/phone-sarvam-webhook.ts` — `POST /api/v1/connectors/phone/sarvam/calls/:callId/:token`.
- `docs/migrations/110c-phone-live-mode.review.sql` — opaque provider ids, `transcript_source`, provider-English report wording.
- Tests: `apps/api/test/phone-sarvam-calls.test.ts` (provider, webhook admission, Chat → approval → call → report).

## Current owner confirmation — no additional telephony setup requested

Existing number9780 and connection are active/healthy, deployment inbound_outbound bound to committed v2 (owner confirmed31Oct).
Five-minute cap, prepaid balance, agent and IDs are recorded. Do not create campaigns, CSV cohorts, another agent/number, or change inbound.
The existing individual Instant Outbound adapter stays in place.

The public contract requires a workspace API key but does not establish this workspace/key's current endpoint permission. A workspace administrator
or Sarvam support can confirm that non-secret fact for the specific Instant Outbound POST without making a call. Do not inspect/share secret values,
create/rotate keys or send a permission-probing POST. This unverified permission is not a demand to redo confirmed telephony setup.

Next request: [read-only VPS backup preflight](PHONE_BACKUP_RESTORE_APPROVAL_2026-10-31.md) to pin source IDs/resources before exact combined
backup/restore approval. No VPS access, backup, credentials, persistent migration, deployment, live-switch change or call without scoped approval.

Official docs checked31 Oct: [Phone Numbers](https://docs.sarvam.ai/voice-agents/deploy/telephony/manage-numbers),
[Instant Outbound API](https://docs.sarvam.ai/voice-agents/api/instant-outbound/create). They document number management and the connection/from-number
API fields; neither establishes this account's permission or a specific dashboard "outbound enabled" toggle. No toggle is assumed here.
