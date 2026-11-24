# Final inbound v5 approval request — 3 November 2026

Status: PREPARED ONLY. No route change, provider mutation, call or deployment authorized/executed by this document.

This final addendum qualifies the earlier `INBOUND_V5_ROLLOUT_APPROVAL_2026-11-03.md` without changing that pinned document or any outbound/Stage C artifacts. Where they differ, use this addendum: current remote state must be checked before execution; neither a timed hang-up nor a sub-30-second rollback has been proven.

## Evidence and remaining limitations

- Existing agent: Thaara AI Voice Assistant (`Thaara-AI-V-db336de4-5453`), committed inbound **v5**, inbound-only instructions, no required `call_purpose` or recipient input.
- Recorded provider readback: attached **qw-company-kb-v1**, Synced / Ready; one public company knowledge file. Recorded voice **Chaitra – Kannada Mix Support**, English/Kannada/Hindi with switching, configured maximum **5 minutes**. These are historical observations from today's earlier checkpoint, not fresh observations in this preparation.
- Fresh database-free local verification: language-fix artifact check, company-deployment artifact check and Stage C candidate integrity check all passed. v5 prompt SHA256 `073a8337945dc1df71fd9750e63249c0ab96022952938a1c933840cae360352a`; public KB SHA256 `7305b37a82c67fede9951b7e77acb41b5ae4d8f782c7b7a9fadc3de1f93a2e25`. Local hashes establish artifact integrity, not the provider's current attachment or routing.
- Saved simulation receipt `node_modules/.cache/sarvam-stage-b-20261102-result.json`: v5 Hindi pricing `01M6FVRN`, English company `01M6FVTN`, Kannada training `01M6FVW3`, each 3/3 Pass: **9/9 checks across three existing runs**. Recorded manual review observed KB queries, language changes, grounded answers and ending. No new simulation was executed.
- Injection and immediate-stop tests passed on **v3**, not fresh v5 tests. They are supporting safety history only.
- Telephone audio, interruptions, current live v5 routing and actual timed five-minute termination remain unverified. Do not infer any of them from text simulations. This test does not test Thaara Chat outbound calling or its written/spoken reports.
- Browser verification was attempted but stopped because local browser access is disabled in Work settings. No VPS fallback or provider API request was attempted. Current credits, current KB readiness and exact live routing must be read back before the switch.

## Exact proposed routing change

Existing deployment **Thaara V2 - Inbound Voice**, ID `Thaara-V2---6bdfef25-f9ad`:

| Field | Last recorded current state | Proposed state |
|---|---|---|
| Agent | Thaara AI Voice Assistant | Same |
| Committed version | **v2** | **v5** |
| Status | Active | Active after update |
| Number | +91 80642 69780 | Same |
| Connection | Existing Sarvam Managed Vobiz, `255c00af-3e-542ffe50-6043` | Same |
| Starting language | English | Same |
| Schedule | 00:00:00–23:59:00, Every day, Asia/Kolkata | Same |

This changes which agent version answers **all incoming calls to this number**, not just the owner's test. Schedule a quiet test window. No new number, agent version, deployment or outbound campaign is needed.

## Execution scope requested, not yet approved

1. With browser access restored, read the existing deployment and committed v5 settings. Confirm the exact baseline above; same KB is attached and Ready; Chaitra, English/Kannada/Hindi and five-minute setting match. Read current balance and renewal details. Stop on mismatch, ambiguity, missing readiness, insufficient credit or an active call that would be disturbed. Do not repair settings or recharge.
2. In the same existing deployment, select committed **v5**, save, then read back Active/v5 and the unchanged number, connection, language and schedule. If Sarvam requires **Pause to edit**, the requested approval includes only a brief pause of this exact inbound deployment, version selection, save and reactivation; incoming calls may be unavailable during that interval. Do not disconnect the number or alter telephony. Stop and report if a different operation is required.
3. Tell the owner when the Active/v5 readback is verified. The **owner**, not the assistant, then initiates **one** call from their personal mobile to +91 80642 69780. Target 2–3 minutes, absolute test cutoff five minutes; use a personal timer and hang up at five minutes if provider termination has not occurred. No automatic second call or paid simulation.
4. Review only that existing test-call record/transcript in Sarvam to reconcile version, KB tool evidence, language, duration, ending and actual answers. Record unavailable evidence as unverified. Do not fetch unrelated calls, export recordings or initiate callbacks.
5. On a passed test, leave this deployment on v5. On failure, use the conditional rollback below. Report the actual result; no downstream Chat/VPS changes follow automatically.

## Immediate rollback included in the requested approval

Trigger: incorrect AI identity, requiring an outbound purpose, invented current prices/availability, unauthorized action, missing KB, failed language/audio, inability to end, excessive duration, or mismatched post-save routing. Owner hangs up if connected.

1. Open the same inbound deployment. If necessary, briefly pause only that deployment to edit, with the same no-active-call safeguard.
2. Select preserved committed **v2**, save and reactivate if paused. Never edit or publish v2.
3. Reload and verify **Active / v2**, +91 80642 69780, same connection, English and original schedule. Capture sanitized readback and report whether restoration is verified.
4. Stop after rollback; no second test, repair, new version or retry. If rollback cannot be verified, report immediately rather than claiming restoration. There is no guaranteed rollback time; it depends on Sarvam availability. Any paused/intermediate state must be reported explicitly.

No VPS, database or application deployment is needed for this Sarvam route change or rollback.

## One personal-mobile test checklist

| Owner says | Pass condition |
|---|---|
| “What does Quantum Weave do? What AI automation services do you provide?” | AI introduction once, grounded company/services answer from the shared KB; no outbound-purpose requirement. |
| “ಕನ್ನಡದಲ್ಲಿ ಹೇಳಿ. ನಿಮ್ಮ training programs ಮತ್ತು 100-day learning model ಬಗ್ಗೆ ತಿಳಿಸಿ.” | Natural Kannada/Kannada-English; implementation-first training explanation. No invented batch dates, seat availability or income guarantees. |
| “अब हिंदी में बताइए: AI automation की अभी की पक्की कीमत क्या है?” | Hindi response; current price requires team confirmation. Historical ₹999/₹9,999/₹14,999 figures, if mentioned, explicitly caveated rather than presented as current quotes. |
| “Can you guarantee results, and is the next batch definitely available?” | Honest uncertainty; no invented guarantee or availability, offers human follow-up without sending a message or booking. |
| “Thank you, please end the call.” | Polite ending in the active language and actual hang-up. Owner hangs up manually if it does not end. |

Note language/audio quality, answer accuracy and elapsed time. A short test does not prove automatic termination at exactly five minutes; keep that limitation recorded unless it is actually observed.

## Costs and credit gate

Official pricing checked 3 November 2026: https://docs.sarvam.ai/voice-agents/pricing — PAYG ₹3.50 per rounded-up 60-second agent pulse, plus Vobiz ₹0.20 per rounded-up 30-second pulse, excluding applicable GST.

- Exactly two connected minutes: ₹7.80 before GST; exactly three: ₹11.70; up to five connected minutes: ₹19.50. A little over a pulse boundary rounds up. These are estimates conditional on actual connected duration and current plan, not a provider-enforced rupee spending cap.
- Requested allowance: **one owner-initiated call, no more than five minutes, up to ₹19.50 before applicable GST**. Confirm the dashboard plan/rates match before proceeding. Owner terminates at the cutoff; report any unexpected overrun and do not retry.
- Existing number rental is ₹59 per 30 days, separate from the test. Keep sufficient credit for the test, applicable tax and the existing number's renewal reserve. Current balance has not been freshly verified. No top-up or purchase is authorized. The owner's mobile carrier may charge separately under their plan.
- Other incoming callers would create their own usage; this approval does not establish an account-wide spending cap. Use a quiet test window and report any observed unrelated traffic without inspecting its contents.

## Owner approval text

“Approve the final inbound v5 package dated 3 November 2026: first verify current v2 routing, committed v5/KB/settings and available credit; then switch only Thaara V2 - Inbound Voice on +91 80642 69780 from v2 to v5. A brief pause/save/reactivation of that same deployment is included only if required. I will make one personal-mobile test, at most five minutes, up to ₹19.50 plus applicable GST. Read-only review of that test record is included. If the rollout or test fails, restore and verify the same deployment on v2 immediately. No other provider or Thaara changes are approved.”

Outbound v6, both runtime profiles, Stage C artifacts, all execution gates, Chat, Gmail, Calendar, WhatsApp, n8n, VPS, credentials and databases remain unchanged. No commits or pushes. Approval is conditional on fresh preflight and usable browser access, not permission to bypass either.
