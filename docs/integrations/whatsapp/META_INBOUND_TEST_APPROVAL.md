# Receive real messages from the Meta test number — consolidated approval request (Step 108.13)

Status: **APPROVED 27 Oct 2026** (owner: "I approve Step 108.13 as described in META_INBOUND_TEST_APPROVAL.md: receive-only Meta test-number connection, move the events-only key, activate only the inbound workflow, run the checks. No sending or replies."). Part A/B/C done; Part D in progress.

## Results so far (27 Oct 2026)
- Safe link 108.11b passed (public n8n 12/12, n8n untouched). Inbound workflow active (version 088213e7…).
- Forged unsigned POST to public webhook: no execution, nothing stored — PASS.
- Isolation vs WhatsLearn: different phone number IDs (276710465536610 vs 1476781035513182), separate apps (owner), different callbacks; WhatsLearn webhook live (wrong-token verify 403). See WHATSAPP_ISOLATION_CHECK_2026-10-27.md. Owner corrected: the Thaara number displays "Vision Impact", not WhatsLearn.
- Owner sent "hi": Meta → n8n → Thaara relay call happened (pilot log: POST relay/wa_pilot_meta_test_10813/events → 403). Thaara refused it; nothing stored, nothing sent. Diagnosing exact mismatch (suspect phone_number_id of the Vision Impact number vs 276710465536610). n8n failed-run saving temporarily ON for this workflow only.

## Goal

You send a WhatsApp text from **your own phone** to your **Meta test number**. Meta delivers it to n8n, n8n hands it to the private Thaara pilot, and Thaara stores it. **Receive only: Thaara sends nothing and never replies.**

## Path

Your phone → Meta → n8n public webhook (`https://n8n.srv1871828.hstgr.cloud`, already HTTPS via the existing Traefik) → private link → Thaara pilot (`thaara-pilot-api:3002`, still not public).

There is no new domain, no public pilot port and no firewall change.

## Part A — you: confirm Meta details (non-secret)

USER SETUP REQUIRED (full step-by-step guide after approval):

1. In Meta for Developers, open the app behind the n8n credential **"Thaara WhatsApp Trigger"**. Confirm its **App ID**, and confirm **this app is used only for Thaara**. Switching on n8n's WhatsApp trigger points *this app's* WhatsApp webhook at n8n, which replaces any other webhook already set on that app.
2. Under **WhatsApp → API Setup**, note the test number's **Phone Number ID** and **WhatsApp Business Account ID**. They should match the values you gave earlier (`276710465536610` / `356865954168966`); we'll confirm which is which.
3. Under the "To" list, add **your own phone number** as a test recipient and verify it with the code Meta sends.
4. Tell me: App ID, Phone Number ID, WhatsApp Business Account ID and your phone number in `+countrycode…` form. **These are not secrets. Never send the App Secret, access tokens or OTP codes.**

## Part B — VPS (pilot database only)

Run [n8n-meta-connection.sh](../../../deploy/hostinger-pilot/n8n-meta-connection.sh), which runs [pilot-meta-connection.mjs](../../../deploy/hostinger-pilot/pilot-meta-connection.mjs) (sha256 `a3680082…03bc8`) once. It uses the approved image, sits on the internal network, runs non-root and read-only, and is deleted when done. It:

- adds connection `wa_pilot_meta_test_10813` for the existing pilot owner, with your real Phone Number ID and Business Account ID and **your phone as the only allowed sender**;
- **moves the existing events-only relay key** onto it, so you **don't need to copy a key again**. The synthetic test connection then has no key;
- uses a 10-minute owner session that is revoked immediately, and refuses to run twice.

The parameters file (IDs and your number, no secrets) is stored root-only at `/opt/thaara-v2-pilot-private/params/`.

## Part C — n8n: switch on the incoming workflow only

Inbound workflow `ezIrlr7y9dEowujw`:

1. Change the relay URL to connection `wa_pilot_meta_test_10813`.
2. Attach the **"Thaara WhatsApp Trigger"** credential to the trigger node.
3. **Enable** the trigger node and the relay node.
4. **Activate (publish)** the workflow. n8n then registers its webhook with your Meta app.

Execution saving stays **off** (`saveDataSuccessExecution/ErrorExecution = none`), so message text is **not** kept in n8n's history. The outgoing workflow `RrqXTplIBXginMSD` stays **inactive**, its send node disabled, its gate closed.

## Part D — checks (stop and switch off on any failure)

1. **Forged-request check:** I send an unsigned fake request to n8n's public webhook, using a sender that isn't on the allow-list. If n8n starts an execution for it (meaning it doesn't verify Meta's signature), **I immediately deactivate the workflow** and report back. Thaara would still refuse that fake sender either way.
2. **Real message:** you send "Hello Thaara" from your phone to the test number. Pass means: the pilot DB gains 1 message from `owner_test_phone` (stored masked and sanitised), with 0 send records and 0 replies.
3. Snapshot: all VPS containers unchanged, n8n not restarted.

## What Thaara refuses (by design)

Senders other than your phone; a different phone number ID; non-text messages (images, voice and so on come in a later step); claim and receipt calls; any reply or send.

## Known limitation (truthful labelling)

Real messages will be stored on a connection labelled `offline_test`, because Thaara's LIVE-mode admission isn't built yet. Here the label means "connection not LIVE-admitted". The messages are real, and both records and UI must say so. Proper LIVE-mode admission is planned as a separate step.

## Privacy and platform rules

- Your phone number and the text you send are stored only in the self-hosted pilot database (test data, no backups).
- Meta test numbers only accept verified test recipients.
- Incoming messages are free.
- Replying, templates and the 24-hour customer-service window are not involved, because Thaara won't reply.

## Not included (later approvals)

Sending any message, the claim/receipt permission, the outgoing workflow, media, Thaara UI/Chat display, public HTTPS for Thaara, production numbers.

## Cost and impact

- **Cost:** none (free test number; incoming messages are free).
- **n8n:** one workflow activated. No restart, and other workflows are untouched.
- **Risk:** the Meta app's webhook is pointed at n8n, which is why Part A step 1 asks you to confirm the app is Thaara-only.

## Rollback (minutes)

1. Deactivate the inbound workflow; n8n removes its Meta webhook registration.
2. Disable both nodes again and restore the previous version `460e8442…`.
3. Revoke the relay key in the pilot DB (`revoked_at=now()`).
4. Optional: reinstall the pilot DB to erase the stored test messages.

## Evidence (local, 27 Oct 2026)

- Throwaway PostgreSQL harness: 5/5 (3 seed + 2 Meta connection). It adds once, moves the key without a new token, revokes the session and refuses a second run. It accepts only the opted-in phone on the exact phone number ID, deduplicates, refuses other senders, other phone IDs and claim, and creates 0 send records.
- The script loads in the approved image with no network and refuses to run without the approval flag.
- Unit and guard tests: 13/13. Parameters are strictly validated (rejecting synthetic IDs, +1555 numbers, extra fields and bad formats), and the runner is pinned to the approved image with no ports.
- Assumption to confirm on the first real event: n8n's trigger output has the same shape as the tested synthetic event. If it doesn't, Thaara **refuses** it (safe), and I adjust the relay mapping under the same approval.
