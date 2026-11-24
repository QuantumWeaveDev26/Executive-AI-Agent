# Controlled WhatsApp send — retry approval request (Step 108.16b)

> **LATEST, urgent owner instruction 28 Oct:** previous single-test preparation is superseded for execution by the revised configuration and account requirement. **A NEW explicit recipient/message test approval is required; no message is currently authorized.** Ten attempts per rolling 24h is authorized as a temporary local test configuration change, not ten sends or permission to enable. No workflow changes until team.quantumweaveai@gmail.com is verified. Existing 2/day block is historical; new 10/day image is built locally but **not deployed**, so do not claim the VPS limit is raised. See Step 108.17 and `N8N_ACCOUNT_RULE.md`. Do not use the historical file/image pins below for the updated package.

Status: **CLOSED — previous approval consumed; sending switched OFF per the handoff.** The owner approved the earlier retry on 28 Oct 2026 ("Yes, approve retry"). Attempts and shutdown are recorded below. This document is historical authorization, not permission for another retry.

## Codex continuation, 28 Oct 2026 — token confirmed; new retry authorized but blocked by the cap

- Owner confirmation received: "yhh done i have checked and added the new access token continue". This confirms owner setup, not a successful Meta send or authorization for a new controlled test. No token was requested or retrieved. The intended account remains app **1691352712358994**, WABA **1150709394191450**.
- Local enable/disable failure-path findings are corrected and covered by synthetic execution tests in [the continuation review](STEP10816_CODEX_REVIEW_2026-10-28.md). The next consolidated approval must include transferring and checksum-verifying those corrected scripts and the corrected CLI before enable; they have not been uploaded.
- The future request must cover only the existing pilot and outbound workflow `RrqXTplIBXginMSD`: fresh temporary dispatch secret (owner updates the existing credential), bounded profile, one owner-approved text attempt to `owner_test_phone` within a fresh inbound window, fake-ID authentication probe, temporary workflow publication, receipt verification and immediate shutdown with the v2 link only. Preserve execution saving OFF throughout.
- Count already claimed attempts in the preceding 24 hours before selecting a cap; do not reset history or blindly raise the cap. The existing enable script hardcodes 2/day; this is **not** a new authorization for two messages. Do not automatically retry an uncertain outcome.
- Report sanitized provider acceptance separately from delivery. A claim or webhook HTTP 200 is not a verified send.
- No commit, push, real message, activation or VPS change is authorized by this continuation review.

## Consolidated request for the next single attempt — APPROVED; PREFLIGHT BLOCKED

Owner replied **"continue"** directly to the explicit consolidated one-test approval question. This authorizes that bounded scope; it does not authorize bypassing the daily cap. No real attempt has used this approval.

### Read-only preflight result, 28 Oct 2026 07:06:43 UTC

- SSH public host fingerprint matched the previously verified handoff fingerprint; strict host verification stayed enabled. The existing protected identity was used; its temporary decrypted file was removed after each command.
- API, PostgreSQL and Redis are healthy, restarts 0; n8n is running, restarts 0, on `n8n_default` only. API send flag is false. Relay is enabled, unrevoked, unexpired and **events-only**. All three temporary send files are absent.
- Connection revision 1, connected; sender and WABA match the intended IDs; exactly one matching opted-in `owner_test_phone` recipient. No recipient phone or secret values retrieved.
- **Three previous claims remain in the rolling 24-hour count.** Their expiration times are 29 Oct 2026 **05:20:58.366**, **05:46:48.956** and **05:56:17.309 UTC**. With a cap of 2, the first expiration leaves 2 counted claims and is still blocked. After the second expiration, 1 remains and one slot is available. Earliest retry: **29 Oct 2026 after 11:16:48.956 IST**; use **11:17 AM IST**, subject to a fresh count check.
- Outbound fresh readback: inactive, version `b83f6a8b-f98d-4f21-ae85-b62edeec5195`, webhook/send nodes disabled, execution saving OFF. No workflow edits or publication performed.
- Correction to the older handoff: the API currently runs the receive-only image `sha256:ebac2a935fc573fb51f4fa12f78a454fe8fc86da364bd893b35c91d38c5520d1`. The pinned send image `sha256:475db13d15194c7b91506c6fe80acd5c52e37364eea9429e879591a2f5fa999f` is present locally on the VPS, not the active image. The reviewed enable script selects that already-loaded image for the temporary send configuration; no image build/upload is required.
- **Stopped before all mutations as approved.** No upload, relay write, API recreation, secret creation, workflow activation or message attempt. Do not raise the cap, erase claims, alter clocks, or create another connection to bypass it. Resume the same approved single-test scope after the gate opens, with fresh readiness checks and owner setup/message approval. No scheduled/background run is created.

**Message:** `Thaara WhatsApp integration test. Please confirm receipt.`

**Sender:** Thaara +91 91879 51539, Phone Number ID 1402873856243129. **Recipient:** only the existing opted-in `owner_test_phone`; no new recipient or asset provisioning.

Requested scope:

1. Read-only readiness checks on VPS 1871828: pilot health, exact connection/recipient/profile/relay state, claims in the preceding 24 hours and pinned image. Respect the existing daily cap of 2; if previous claims block the attempt, stop and report when a slot becomes available. No cap increase, history reset or bypass is included.
2. Transfer only the three corrected local files below to their existing paths under `/opt/thaara-v2-pilot/`, verify exact SHA256 values, and retain the current versions for rollback. Do not rebuild or replace the existing API image or modify unrelated files.
3. Run the reviewed enable script for its existing 24-hour-expiry profile and two-per-day safety cap, generate a fresh temporary dispatch secret, widen only this connection's relay to events/claim/receipts, and recreate only the pilot API. No schema migration, new database, volume or data-service restart. Use only `n8n-link-v2.sh`; never move/restart n8n or its proxy.
4. The owner privately updates only **Thaara Dispatch Webhook** with the fresh secret on the VPS; never copy it into chat, local logs or documentation. This is an owner credential step, not a request to generate the Meta token again.
5. Modify/publish only outbound `RrqXTplIBXginMSD` in the approved n8n Owner workspace. Keep all execution saving OFF. Authenticate the fake-ID probe with the send gate closed; prove the nonexistent dispatch is refused. Confirm credential assignments without exposing their values. Only then enable the send node and remove the never-send condition while retaining the strict server `authorized && dispatchEnabled` gate. Keep inbound `ezIrlr7y9dEowujw` unchanged.
6. Ask the owner for a fresh `hi` to the Thaara number to open the reply window. Prepare exactly the text above and have the owner approve that draft using the existing CLI. One actual attempt only; failure, timeout or uncertain outcome does not authorize a second attempt.
7. Record only sanitized claim/receipt/provider-message-ID and delivery-status evidence. HTTP 200 and a claim alone are not success. Switch off immediately after the attempt: unpublish outbound, restore the never-send gate, disable webhook/send nodes, run the corrected disable script, restore events-only permission, remove temporary secrets and use the v2 link. Verify shutdown even after failure; report any incomplete containment. Delivery status may arrive later through the unchanged inbound workflow.

Upload pins (exact current local bytes):

| File | SHA256 |
|---|---|
| `pilot-send-enable-10816.sh` | `e03ef59ac7bf035b7d4186a239e68a73c11a9961bd60ef1d765b3d9aab9b552e` |
| `pilot-send-disable-10816.sh` | `88ee44f9081eb0a2634103d49a8bfe9e9fb6bbfd625d3a81e8d3db23cef1b740` |
| `pilot-send-cli.mjs` | `372545de12026eb9ec43f072b26c41d67112e974c5fc6d896ab3869b0cee9e56` |

Fresh read-only n8n evidence before this request: inbound active version `68b66159-eb3b-46f3-8597-b1bda6000871`; outbound inactive, activeVersionId null, draft `b83f6a8b-f98d-4f21-ae85-b62edeec5195`, webhook/send disabled, hard-false AND server-authorization gate, saveDataErrorExecution/saveDataSuccessExecution none and manual/progress saving false. Sanitized workflow details omit credential bindings; do not infer them missing or verified from this response. VPS state has not been re-probed during this continuation.

Local safety-test evidence remains **73/73**, five files, for unchanged source; no redundant suite rerun. Nothing in this pending request authorizes WhatsLearn/unrelated workflow changes, new infrastructure, schema migrations, templates/media, automatic replies, public UI/DNS/firewall work, commits, pushes or deployment beyond the listed three-script transfer and pilot API configuration/recreation.

## Why a retry

Attempt 2 passed every Thaara check (claim 200), but nothing was delivered. Meta refused the message inside the n8n WhatsApp step. The error details weren't kept, because failed-run saving was off to protect the secret. The owner has since confirmed in Meta API Setup:

- sender **+91 91879 51539**, Phone Number ID **1402873856243129** (matches the pilot connection);
- account **1150709394191450** (matches);
- the owner's phone **the owner's registered phone** is verified (green check) in this number's **To** list.

Not verifiable by Claude, because credential values are hidden by design: the Business Account ID and token inside the n8n credential "Thaara WhatsApp Test". The owner confirms these.

## What changes from the first approval (everything else identical)

1. **Readable error, no secret exposure.**
   - n8n Thaara outgoing workflow: the WhatsApp send step gets "continue on error", and a new step **"Return sanitized provider error"** returns only `status`, `verified:false`, the Meta error code and a short message.
   - The owner's `approve` command prints that answer with phone numbers masked; headers and tokens are dropped (tested).
   - n8n execution saving stays **off**.
2. **Cap 2 per day** for this retry window. The earlier claimed-but-undelivered attempt counts toward the limit; the recipient is still only the owner's phone, and the window still expires after 24 hours.
3. **New webhook secret.** The previous one was destroyed at switch-off. The owner updates the value in the n8n credential "Thaara Dispatch Webhook", using `cat …; echo` so the terminal prompt doesn't get glued to it.

## Steps

1. VPS: run [pilot-send-enable-10816.sh](../../../deploy/hostinger-pilot/pilot-send-enable-10816.sh) (send-capable image already on the VPS; new 24-hour profile; 2/day; relay key widened) plus the safe re-link. Upload the updated `pilot-send-cli.mjs`.
2. Owner: update the "Thaara Dispatch Webhook" value. Claude then checks it with the safe fake-ID probe, which can't send anything. During that probe execution saving stays off, so nothing is captured.
3. n8n, Thaara outgoing workflow only: re-enable the webhook and send step, keep the server-authorized gate only, add the sanitized error step, then publish.
4. Owner: send "hi" to +91 91879 51539, then run `prepare`, then **`approve`** (your decision), then check the phone.
5. Claude verifies: claim, provider message ID, sent and delivered status in Thaara. If it fails, I report the sanitized Meta error.
6. **Switch off immediately afterwards:** unpublish the workflow, restore the never-send gate, run the disable script (send-off, relay events-only, secrets shredded), re-link.

## Not included

Anyone other than your phone, templates, media, other workflows (WhatsLearn untouched), firewall or DNS.

## Evidence (local)

- CLI sanitizer test: keeps only the outcome fields and masks phone numbers; secret headers and tokens are dropped.
- Pilot guard tests: 14/14, with the enable script pinned at 2/day and a 24-hour expiry.
- Previous evidence unchanged (real PostgreSQL harness 9/9; regression 392/392).

## Results so far (28 Oct 2026)

- Retry window enabled (send image `475db13d…`, profile expires 2026-10-29T05:37:42Z, 2/day), relinked (12/12, n8n not restarted). Updated CLI uploaded (checksum verified). New webhook secret confirmed with the safe fake-ID probe; **no n8n execution retained**.
- Attempt 3 (approval d6aa0c9d…, dispatch 206605fe…): hand-over 200, claim OK; the n8n WhatsApp send step failed again → sanitized output `failed_before_provider_acceptance`, but code and message read as `unknown`, because the extraction expression used the wrong field. **Nothing sent.** The error step was fixed (handles string and nested errors; published 5cda1713…).
- The 2/day cap is now reached (attempts 2 and 3 were claimed), so further sends are blocked by design until the owner decides.
- Owner approved one more diagnostic attempt ("One more attempt"): cap raised to 3 for the same window (same expiry), pilot API recreated only, relinked.
- Attempt 4 (approval 1f6a52ed…, dispatch 0e3f28dc…): claim OK; Meta/n8n error "Authorization failed - please check your credentials" → the token in n8n credential "Thaara WhatsApp Test" is not accepted. Nothing sent. **Switched OFF** (workflow unpublished, gate restored, nodes disabled; VPS send-off, relay events-only, secrets shredded; relink 12/12). Handoff: docs/THAARA_HANDOFF_TO_CODEX_2026-10-28.md.

## FINAL RESULT (28 Oct 2026)

After the Messaging-account access fix, the approved test (approval f085514a…, dispatch e0c59999…) **succeeded**: claim 200, receipt 200, 3 status events, final status **read**; the owner confirmed receipt. Sending switched off and verified immediately afterwards.
