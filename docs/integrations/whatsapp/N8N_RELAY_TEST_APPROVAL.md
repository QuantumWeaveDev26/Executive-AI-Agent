# Pilot relay token and sample-data test — consolidated approval request (Step 108.12)

Status: **APPROVED and EXECUTED 27 Oct 2026 — PASS.**

## Results
- Part A (VPS): seed ran once; connection wa_pilot_synthetic_10812, principal 01dc8fd8…, events-only, expires 2026-11-25T13:06:49Z; bootstrap session revoked; all containers unchanged.
- Part B (owner): after an n8n account clarification (Thaara workspace = n8n Owner user quantumweave26, see ../N8N_ACCOUNT_RULE.md), the owner created Bearer Auth credential **Thaara Pilot Relay 10812** (id 9HD0gaPEC54utMLN) in project fn6pQNcDpG7hLM3t; verified by name/type only.
- Part C (n8n): inbound ezIrlr7y9dEowujw → version 460e8442…, outgoing RrqXTplIBXginMSD → version a0344658…; URLs point to thaara-pilot-api:3002, credential attached; read-back: both inactive, no active version, all trigger/HTTP/WhatsApp nodes still disabled, send gate unchanged.
- Test workflow VBtUt2QJIJ91ghuC (manual only, never activated): execution 38241 → HTTP 200 {acceptedMessages:1,duplicates:0}; execution 38242 → HTTP 200 {acceptedMessages:0,duplicates:1}. Archived afterwards.
- Pilot DB after test: messages=1, dispatches=0, status_events=0, active principals=1, active sessions=0, audit_events=3.
- Handoff token file shredded and folder removed only after the test proved the stored credential works. Token now exists only in n8n (encrypted) and as a SHA-256 hash in the pilot DB.
- n8n not restarted (same container, started 2026-10-16, restarts 0); pilot containers healthy, 0 restarts.
- Still NOT done: Meta trigger/credentials, real numbers, sending, activation, HTTPS, claim/receipt permission. WhatsApp is NOT LIVE.

## Goal

Prove that an n8n workflow can deliver a WhatsApp-shaped event to the Thaara pilot over the private link, authenticated with a per-connection token, and that Thaara stores it once. The test uses **synthetic sample data only: no Meta, no real phone numbers, no messages sent.**

## Part A — VPS: synthetic owner, test connection, relay token

Run [n8n-relay-seed.sh](../../../deploy/hostinger-pilot/n8n-relay-seed.sh), which runs [pilot-seed.mjs](../../../deploy/hostinger-pilot/pilot-seed.mjs) (sha256 `4685330f…56be6`) once in a short-lived container. It uses the approved pilot image, sits on the internal pilot network, runs non-root, read-only and with no capabilities, and is deleted when done.

It creates, in the pilot database only:

| Record | Value |
|---|---|
| Workspace | "Thaara Pilot Synthetic 10812" |
| Owner | `pilot-owner-10812@thaara-pilot.invalid`, no usable password (cannot log in) |
| Bootstrap session | 10-minute session, **revoked immediately** after use |
| WhatsApp connection | `wa_pilot_synthetic_10812`, mode `offline_test`, synthetic Meta IDs (not your real Phone ID or account), 1 synthetic opted-in recipient `+15550000001` |
| Relay permission | **events only** (n8n can deliver incoming events; it cannot claim sends or report receipts). Expires in **29 days** |

The token is generated inside the container. Only its SHA-256 hash goes into the database. The token itself is written once to `/opt/thaara-v2-pilot-private/handoff/n8n_relay_token` (root-only, 0400) so you can copy it.

## Part B — you: create the n8n credential

USER SETUP REQUIRED (the full step-by-step guide comes after Part A runs):

1. In the Hostinger browser terminal, run `cat /opt/thaara-v2-pilot-private/handoff/n8n_relay_token` and copy the line.
2. In n8n, go to Credentials, create a new **Bearer Auth** credential named `Thaara Pilot Relay 10812`, paste the token and save.
3. Tell me it's done. **Don't paste the token into chat.**

I then confirm only that the credential's name and type exist; I never read its value. After that I securely delete the handoff file, so the token exists only in n8n and as a hash in Thaara.

## Part C — n8n: re-point nodes and run the sample test

1. **Inbound workflow `ezIrlr7y9dEowujw`:** set the "Relay untrusted event to Thaara" URL to `http://thaara-pilot-api:3002/api/v1/connectors/whatsapp/n8n/relay/wa_pilot_synthetic_10812/events` and attach the new credential. **The node stays disabled and the workflow stays inactive.** The Meta trigger is not touched.
2. **Outgoing workflow `RrqXTplIBXginMSD`:** set the claim and receipts URLs the same way and attach the credential. **The nodes stay disabled, the workflow stays inactive, and the send gate stays closed.** These calls would be refused anyway, because the token is events-only.
3. **New test workflow `THAARA_V2_PILOT_RELAY_TEST_10812`:** Manual Trigger, then a Set node with a synthetic event (`wamid.pilot-10812-n8n-…`, phone ID `100020003000`), then an HTTP POST to the pilot with the credential. It is **manual only and never activated**.
4. Run it twice. Pass means: first run `{acceptedMessages:1, duplicates:0}`; second run `{acceptedMessages:0, duplicates:1}`. A database check then confirms 1 stored message and 0 send records.
5. Archive the test workflow afterwards.

## Not included

Activating any workflow, enabling the Meta trigger or send nodes, Meta or WhatsApp credentials, real numbers, sending messages, public HTTPS or a domain, firewall changes, and widening the token to claim/receipts. Each of these needs its own later approval.

## Impact and cost

- **Cost:** none.
- **n8n:** two existing inactive workflows get URL and credential edits only (n8n keeps their version history). One manual test workflow is added and then archived. **No restarts and no activation.**
- **Other services:** untouched.

## Evidence (local, 27 Oct 2026)

- Throwaway PostgreSQL, installed from the approved bundle, plus the seed: **3/3 passed**. It seeds once, revokes the session, refuses a second run, and the app role cannot read token hashes. The synthetic event is accepted once and then deduplicated, with 0 send records. Claim, receipts, wrong tokens and other connections are refused.
- The seed loads inside the approved image with no network access, finds all 8 database functions it needs, and refuses to run without the approval flag.
- Focused tests: 78/78. A guard test ensures the seed contains none of your real Meta IDs and keeps events-only permission, a validity under 30 days, a pinned image and no published ports.
- The route check uses the same `resolveRelay` + `ingest` path as the HTTP route. The real HTTP hop through n8n is what Part C proves.

## Rollback

- **Token:** `UPDATE whatsapp_n8n_relay_principals SET revoked_at=now()` in the pilot DB (instant). You can also delete the n8n credential.
- **Workflows:** restore the previous versions (`2624cdbf…` inbound, `0ecb733c…` outgoing) and archive the test workflow.
- **Full reset:** reinstall the pilot database. This removes only pilot data.
