# Fix for receiving real WhatsApp messages — consolidated approval request (Step 108.13b)

Status: **APPROVED and EXECUTED 27 Oct 2026** — image ID matched on VPS; API healthy on fixed image, data services untouched; connection 10813b created and key moved; link v2 re-run (public n8n 12/12, n8n not restarted, other containers unchanged); inbound relay URL published (version 68b66159…). **REAL MESSAGE PASS (27 Oct 2026 ~17:3x UTC):** owner sent "hi" from the registered phone to +91 91879 51539 → Meta → n8n (inbound workflow 68b66159…) → private link → pilot relay returned **200**; pilot DB: **1 message** on wa_pilot_meta_test_10813b, sender = owner_test_phone (masked), binding phone ID = 1402873856243129, **0 dispatches, 0 status events, no reply**. Public n8n 200.

## What the real test showed

The owner's real "hi" travelled **Meta → n8n → private link → Thaara pilot**, and Thaara correctly refused it. Nothing was stored or sent. A diagnostic run (n8n execution 38360, the owner's own message; failed-run saving is off again) showed two causes:

1. **Wrong Phone Number ID in the pilot connection.** The owner confirmed (Meta API Setup screenshot) that the real Thaara number is **+91 91879 51539**, Phone Number ID **1402873856243129**, Business Account ID **1150709394191450**. The pilot connection had been created with `276710465536610`, which is a different number (+91 96069 89873).
2. **Thaara code bug.** Real Meta events contain `contacts[].user_id`, and Thaara's anti-tampering rule refused any field named `user_id`. The fix allows that field only inside a contact entry and only as text. `user_id` or `workspace_id` anywhere else is still refused (7 variants tested).

## What will be done

1. **Transfer the fixed pilot image** `sha256:ebac2a935fc573fb51f4fa12f78a454fe8fc86da364bd893b35c91d38c5520d1` (linux/amd64, 1000:1000, contains the fix) over the verified SSH connection, and check its ID on arrival.
2. Write the non-secret parameters (Phone Number ID 1402873856243129, Business Account ID 1150709394191450, your phone) to the root-only file `/opt/thaara-v2-pilot-private/params/meta-test-params-10813b.json`.
3. Run [pilot-api-update-10813b.sh](../../../deploy/hostinger-pilot/pilot-api-update-10813b.sh). It:
   - recreates **only** the pilot API with the fixed image. PostgreSQL and Redis are untouched, and the script checks this. If the API isn't healthy, it automatically switches back to the previous image;
   - adds the corrected receive-only connection `wa_pilot_meta_test_10813b`, with your phone as the only allowed sender, and moves the existing events-only key onto it. No new key, nothing to copy.
4. Run [n8n-link-v2.sh](../../../deploy/hostinger-pilot/n8n-link-v2.sh) again, because recreating the API drops its live link. Public-n8n health proofs and automatic rollback are built in, and **n8n itself is not touched**.
5. In the Thaara incoming workflow `ezIrlr7y9dEowujw` only, change the relay URL to `wa_pilot_meta_test_10813b`. It stays active, and no other workflow is touched.
6. **You send "hi" to +91 91879 51539.** Pass means 1 message stored from your phone on 1402873856243129, with 0 send records and no reply.
7. Before and after container snapshots, plus a public n8n check from your PC.

## Not included

Sending or replies, the outgoing workflow, Meta settings, any non-Thaara workflow, Traefik or firewall changes.

## Impact, cost, rollback

- **Cost:** none.
- **Pilot API:** a few seconds of downtime. n8n is not restarted, and other projects are untouched.
- **Rollback:** restore `.env.before-10813b` and recreate the API; move the key back or revoke it; restore the previous relay URL.

## Evidence (local)

- Durable domain tests: 30/30, including the real trigger shape and 7 still-refused variants.
- WhatsApp, pilot and web suites: 196/196. API typecheck clean.
- Throwaway PostgreSQL harness: 6/6. Seed, first Meta connection, and the correction: refuses a different sender, applies once, moves the key, accepts the real event shape once then deduplicates, 0 sends.
- Guard tests: 15/15. No real IDs in the scripts, pilot API only, pinned image, automatic image rollback.
