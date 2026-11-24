# Step 108.22 + 108.23 pilot publication — approval request

**Status: PUBLISHED AND VERIFIED — 28 Oct 2026 ~15:25 UTC.** Owner approved ("Approve deployment").

- New pilot image `sha256:1cbe1786f7fa350a655307f0f4447f200ae85176cee9333ef5ced591b8303296`; archive `4a7a1633…` checksums verified (10 files); offline overlay build passed.
- Private link restored: n8n→pilot health 200, forged callback 403, public watch 12/12, n8n single network, n8n not restarted.
- Public web assets 3/3 checksum-identical; `/health` 200, `/auth/me` 401, `/connections` 401, new `/contacts` 401 (route present, auth required).
- Database schema unchanged, no rows lost; no SQL applied. Send still disabled; PostgreSQL/Redis/n8n/Traefik unchanged.
- Rollback directory: `/opt/thaara-v2-pilot-private/handoff/whatsapp-experience-10823-20261028T152437Z` (previous image `75682e64…`).
- Not yet verified: signed-in owner view of the new screen with real chats (owner check).

## What gets published

API-only overlay on the current pilot image `sha256:75682e64…` (108.21). No SQL, no data change, no secrets, sending stays disabled.

| Included | Effect on pilot |
|---|---|
| `web-dist/` (index + 2 assets) | WhatsApp Web-style screen (chat list, bubbles, ticks, mobile view, emoji composer, approval card) |
| `contracts/whatsapp-n8n.js` | Contacts response schema |
| `api-services/whatsapp-durable.js` | Owner-scoped contacts with 24 h eligibility (+ media lookup, unused) |
| `api-services/chat-whatsapp-read.js`, `chat-whatsapp-assistant.js` | Read-only Chat commands |
| `api-routes/whatsapp-inbox.js` | `GET …/contacts`; `POST …/media/:id/preview` answers **503 not set up** (no media provider/token on pilot) |
| `patch-conversations.mjs` | Exact-match 2-anchor patch of the pilot's **own** compiled chat route to add read commands |

**Deliberately excluded** (they would carry paused Phone code into the pilot): `app.js`, policy `registry.js`, rebuilt `conversations.js`. Consequence: image preview stays "not set up" until a separate media setup step; CSP `blob:` is not added yet.

- Archive SHA-256: `4a7a1633f40908f281939ca6d934dd162cc3d548dea196496db7d8ecbc112121` (10 files, manifest-checked). Staged in ignored `node_modules/.cache/step10823/` with run wrapper `publish.sh`.
- Recipe: `deploy/hostinger-pilot/Dockerfile.whatsapp-experience`; publisher: `deploy/hostinger-pilot/publish-whatsapp-experience.py`.

## Local evidence

- Offline rehearsal on a local chain (108.18 image + saved 108.21 package + this package): patch applied, all modules import, Phone-code guard passed, user/command unchanged, 7 added layers.
- Archive dry run: checksum, member allowlist and manifest hashes pass. Web 185/185, API 654 passed (DB runtime suites gated), builds pass.

## What the publisher does on the VPS (only after approval)

1. Preflight: API image is exactly `75682e64…`, healthy, `THAARA_WHATSAPP_SEND_ENABLED=false`; n8n only on `n8n_default` and healthy; link script checksum-pinned; record identities of PostgreSQL, Redis, n8n, Traefik; read-only DB facts.
2. Verify archive and manifest; build overlay with `--network=none`; assert base layers and runtime config unchanged.
3. Save the previous `.env` and compose file to a private rollback directory; recreate **only the API** (`--no-deps --no-build --pull never`).
4. Restore the private n8n link with existing `n8n-link-v2.sh` (no new networks, n8n not restarted).
5. Verify: send still disabled, other services unchanged, public web assets match checksums, `/health` 200, `/auth/me` 401, `/connections` 401, new `/contacts` 401, DB schema unchanged and no rows lost.
6. Any failure → automatic API rollback to `75682e64…` and link restoration.

Not touched: n8n workflows (both stay as they are, outbound execution saving off), credentials, Meta, database schema, other projects.

## After publication (owner)

Sign in at `https://thaara-v2.quantumweaveai.io`, open WhatsApp, and check your real saved chats in the new screen. Sending remains disabled.
