# Step 108.24 — Normal (live) WhatsApp sending: go-live request

**Status: PREPARED LOCALLY, NOT EXECUTED.** Needs explicit owner approval. Each message still needs its own approval.

## What changed in code (tested locally)

- Send profile accepts `recipientId: "*"` = any **opted-in** contact of the connection (non-opted-in always refused, also at hand-off). Ceiling raised from 10 to **250/day** (anti-abuse; Meta limits still apply); validity up to 90 days (was 7).
- `liveSendingEnabled` is now real in inbox/contacts responses (true only while an unexpired profile names the connection). UI and Chat switch wording: "Live sending on · every message needs your approval", "Approving sends this exact message on WhatsApp", "Queued, not yet sent"; ticks still only from Meta status events. Post-approval status refresh at 4/12/30 s.
- New host scripts keep the **current** image and compose (web routing intact): `pilot-send-live-on.sh` (secret generation on server, profile `*`/100 per day/30 days, relay events+claim+receipts, API-only recreate, private link restore, verification, auto-rollback via live-off) and `pilot-send-live-off.sh` (events-only relay, restore pre-live compose, link restore, shred secrets, verify send=false). The old 108.16 scripts are obsolete: pinned to image `46605527…` and a compose without web routing labels.
- Evidence: API 656 passed (+2 normal-mode tests; 4 DB runtime suites gated), web 186/186, pilot config/compose 41/41; script syntax checked; compose transform on reviewed compose → live-on adds only flag + 2 secrets, live-off restores it byte-equal; offline chain rehearsal (108.18→21→23→23b→24) passed import/ceiling/send-off-default/no-Phone checks and the new index is in the image.
- Package: archive `9aac7ec054e7dc14f503ed76a29fe1c59add69f0e50ad41cccea2dd59758109e` (11 files), publisher `deploy/hostinger-pilot/publish-live-ready.py`, recipe `Dockerfile.live-ready`, base `02977c43…`.

## Go-live sequence

1. **Deploy 108.24** (API-only overlay; sending stays off; installs live-on/off scripts, not run). Automatic rollback on any failed check.
2. **Run live-on** on the server: `--approved 100` → live sending on for opted-in contacts, 100/day, 30 days.
3. **Owner:** copy the new key into the n8n `X-Thaara-Dispatch` header credential (guided; never shared in chat).
4. **n8n (Thaara outbound `RrqXTplIBXginMSD` only):** remove the hard never-send condition, keep the `authorized && dispatchEnabled` gate, publish. Outbound execution saving stays OFF. Inbound `ezIrlr7y9dEowujw` untouched.
5. **Owner test:** prepare and approve one message in the new screen; verify Sent → Delivered → Read appear from Meta events.

Switch-off any time: `bash /opt/thaara-v2-pilot/pilot-send-live-off.sh --approved` plus unpublishing the outbound workflow.

## Limits

Only opted-in contacts saved on the connection (currently the owner test phone); adding new contacts is separate work. Free-form messages only inside Meta's 24 h window; templates, media sending and media preview still need the Meta token step.
