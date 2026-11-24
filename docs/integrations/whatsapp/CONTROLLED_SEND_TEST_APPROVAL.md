# Controlled WhatsApp send test — consolidated approval request (Step 108.16)

Status: **APPROVED by owner 28 Oct 2026 ("Yes, approve").** Execution in progress. Because the pilot has no hosted UI/login yet, Part D uses two owner-run terminal commands (prepare, then approve); the owner's own approve command is the approval action.

## What the test does

**One** reply from the Thaara number **+91 91879 51539** to **your own phone only**: written in Thaara, approved by you, and sent inside WhatsApp's 24-hour reply window. Then delivery status (sent and delivered/read) is shown in Thaara, and sending is switched **off** again.

## Safety limits built in (tested)

| Limit | How it's enforced |
|---|---|
| Your approval for each message | The reply can't be reserved without an approved, exactly matching approval |
| Only your phone | The send profile allows exactly one recipient (`owner_test_phone`) on one connection (`wa_pilot_meta_test_10813b`) |
| Only replies within 24 h of your last message | Reserve is refused outside the window, and the claim re-checks it |
| At most **1 message per day** | The daily cap is checked when n8n claims the message |
| Automatic switch-off | The profile **expires after 24 hours**; afterwards nothing can be sent even if everything else stays on |
| No accidental resend | One-time claim per message, a 60-second claim deadline, and idempotency keys |
| Honest status | A provider "accepted" is not treated as success. Status moves to sent, delivered and read only from Meta's own status events, and stays marked unverified |

## Part A — you: two checks and one credential (step-by-step guide after approval)

1. **WhatsApp sending credential.** In n8n, open **"Thaara WhatsApp Test"** (WhatsApp API). Confirm it holds an access token for Meta app **1691352712358994** that can send from **+91 91879 51539**. A temporary token from the API Setup page **expires after about 24 hours**; for repeated use, create a permanent **System User** token in Meta Business settings later. Don't paste tokens into chat.
2. **Open the reply window.** Shortly before the test, send any WhatsApp message from your phone to +91 91879 51539.
3. **New n8n credential.** Create a **Header Auth** credential named `Thaara Dispatch Webhook`, header name **`X-Thaara-Dispatch`**. The value comes from a root-only file on the VPS, which you copy in the Hostinger terminal exactly as before.

## Part B — VPS (pilot only)

1. Transfer the send-capable image `sha256:475db13d15194c7b91506c6fe80acd5c52e37364eea9429e879591a2f5fa999f` and check its ID.
2. Upload `compose.send.json`, which is identical to the current compose plus send-on and two secret files, and is checked by the compose validator.
3. Run [pilot-send-enable-10816.sh](../../../deploy/hostinger-pilot/pilot-send-enable-10816.sh). It:
   - generates the webhook secret on the server (never printed) and a 24-hour, 1-per-day send profile;
   - widens the relay key to `events, claim, receipts`;
   - recreates **only** the pilot API, and automatically restores the send-off state if it isn't healthy.
4. Re-run [n8n-link-v2.sh](../../../deploy/hostinger-pilot/n8n-link-v2.sh), with the public-n8n health proofs and automatic rollback (n8n untouched).

## Part C — n8n (Thaara outgoing workflow `RrqXTplIBXginMSD` only)

1. Webhook node: attach `Thaara Dispatch Webhook`. Claim and Receipts nodes: change the URLs to `wa_pilot_meta_test_10813b`, with credential `Thaara Pilot Relay 10812`. Send node: attach `Thaara WhatsApp Test`.
2. **Send gate:** remove the hard "never send" condition. Keep only "Thaara authorized AND dispatchEnabled", which comes from the server-side checks above.
3. Enable those nodes, then activate the workflow. The "future template/media" nodes stay disabled.

No other n8n workflow is touched. The incoming workflow stays as it is.

## Part D — the single test

1. In Thaara Chat (or the WhatsApp inbox), write the reply. Thaara prepares it and asks for approval.
2. You click **Approve**. Thaara reserves it and hands it to n8n, n8n claims it (checks pass), WhatsApp sends it, and the receipt is recorded.
3. You confirm it arrived on your phone. I confirm in Thaara's database: 1 claimed dispatch, the provider message ID recorded, then sent and delivered/read statuses.

## Part E — switch-off (immediately after, unless you approve keeping it)

Deactivate the outgoing workflow and restore its "never send" gate. Run [pilot-send-disable-10816.sh](../../../deploy/hostinger-pilot/pilot-send-disable-10816.sh), which restores send-off, sets the relay key back to events-only and shreds the send files. Re-run the link script. Even if this step were missed, the profile expires after 24 hours.

## Not included

Messages to anyone else, templates (needed outside the 24-hour window), media, bulk sending, production use, any non-Thaara workflow, firewall or DNS changes.

## Cost and risk

- **Cost:** a service reply inside the 24-hour window is expected to be free under Meta's current pricing; Meta's terms apply. No Hostinger cost.
- **Risk:** one real message to your own phone. Mistakes are bounded by the 1-message cap, the single recipient and the 24-hour expiry.

## Evidence (local)

- Pilot transport and send-gate unit tests: 11/11. Fixed internal address, no redirects, header secret, unsafe settings rejected. Hand-over happens once, only after commit; claim enables sending only under the profile; cap and expiry enforced; outside the 24-hour window the reservation itself is refused.
- Real PostgreSQL harness: 8/8. The 108.16 case covers hand-over once, claim enabled, the second message blocked by the cap, provider acknowledgement recorded, and real-shaped "sent" and "delivered" status events, with the inbox showing "delivered (unverified)".
- Pilot config and scripts: 18/18. Send-off by default, a bounded send profile, compose send-on allowed only with both secrets on the API alone, and the enable/disable scripts pinned and reversible.
- Full regression: 392/392 across 30 files. API typecheck clean. The send image contains the new code.

## Results (28 Oct 2026)

- VPS enabled: send image `475db13d…`, profile (10813b → owner_test_phone, 1/day, expiry 2026-10-29T04:46:45Z), relay key widened, relinked (public n8n 12/12). The outgoing workflow was configured and published (version d20b44d8…). The internal webhook path was verified (403 without the header).
- Attempt 1 (approval a2599673…, dispatch 1e9a8302…): n8n rejected the hand-over (403, credential value mismatch: the terminal prompt was glued to the secret). Never claimed; expired; **nothing sent**.
- Fixed. A safe fake-ID probe passed webhook auth, and Thaara refused the fake claim (403) as designed. **Security finding:** n8n failed-run 39172 stored the inbound headers, including the temporary dispatch secret. Failed-run saving was set to none; the secret was shredded at switch-off; the owner should delete executions 39172 onwards.
- Attempt 2 (approval bbc279d6…, dispatch 7b018076…): hand-over accepted, **claim 200** (all server checks passed). No receipt was reported back, and the **owner confirmed nothing arrived**. Thaara shows `unverified`, which is the truthful state. The failure was inside the n8n WhatsApp send step (details not retained). The likely cause: the owner's phone is not on the **"To" allowed list of the Thaara test number +91 91879 51539** (the owner's screenshot shows it verified only for +91 96069 89873). Token asset assignment and the credential's Business Account ID still need confirming.
- **Switched off:** workflow unpublished, never-send gate restored, send and webhook nodes disabled; VPS back to send-off (env false), relay key events-only, send files shredded; relinked (12/12, n8n not restarted). The brandmint containers were recreated by an unrelated process during the window (not Thaara).
- **Status: controlled send NOT yet successful.** A retry needs the owner's Meta fix and a new consolidated approval (fresh send window and new dispatch secret).
