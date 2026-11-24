# WhatsApp integration — paused checkpoint (29 Oct 2026)

**Owner decision:** pause WhatsApp work and keep everything exactly as it is. Resume only when the owner says **"continue WhatsApp integration"**.

## Live state on the pilot (do not change while paused)

- Site: https://thaara-v2.quantumweaveai.io (owner `pilot-owner-10812@thaara-pilot.invalid`).
- API image `sha256:e6d9d0bc6f63fd126d453159a124fe09eaffdf11300344857a032a65cea007fb` (108.30). Rollback dirs in `/opt/thaara-v2-pilot-private/handoff/` (latest `failure-reasons-10830-20261029T053247Z`).
- **Live sending ON**: profile `*` (opted-in contacts), no Thaara daily cap, `richMessages: true`, expires **2026-11-28T02:30:54Z**; every message needs owner approval; 24 h window for text/files.
- n8n (owner quantumweave26): inbound `ezIrlr7y9dEowujw` active; outbound `RrqXTplIBXginMSD` **active**, version `60f611fd-1f27-4489-9bab-a6b53fe64ae1` (text node + rich Graph HTTP node, credential "Thaara WhatsApp Test"; rollback text-only version `87470677…`); execution saving none. Dispatch key in credential "Thaara Dispatch Webhook".
- Meta key mounted to API only (`/opt/thaara-v2-pilot-private/secrets/meta_access_token`, 200 chars, verified: token owner THAARA AI V2).
- Database: 1083 + 1089 + 10821 + **10825** applied (backup before 10825 in `whatsapp-compose-10827-…`).

## Verified working

Receive text/images/documents/audio; image preview, document download, audio playback (Meta key); WhatsApp-style UI (chat list, bubbles, ticks, mobile, scrolling); contacts manager; template list; AI Chat read commands; **send text** (29 Oct 08:12 IST sent→delivered→read); **send image** (08:24 IST sent→delivered→read); delivery-failure reasons logged (`docker logs thaara-v2-pilot-api-1 | grep whatsapp_delivery_failed`).

## Open items (resume here)

1. **Templates blocked by Meta 131042** — "WhatsApp Business account has incomplete tax information". Owner must complete tax info on the billing account of WhatsApp Business account `1150709394191450` (billing hub `…/billing_hub/accounts/details/?asset_id=1150709394191450`, or WhatsApp Manager banner), wait, then retest `hello_world`. Health check: number/WABA/business AVAILABLE, quality GREEN, template APPROVED/UTILITY.
2. Show failure reasons on screen (needs an additive migration for status-event fields; currently log-only).
3. Live profile renewal before 2026-11-28 (`pilot-send-live-off.sh` / `pilot-send-live-on.sh --approved unlimited rich` → owner re-pastes key) or extend.
4. Commit/push of the large uncommitted work (needs owner approval).
5. Optional: more templates, more than 5 contacts (separate table), Chat "send this PDF to Ram".

## Switch-off (any time)

`bash /opt/thaara-v2-pilot/pilot-send-live-off.sh --approved` + unpublish `RrqXTplIBXginMSD`. Rich only off: `bash /opt/thaara-v2-pilot/pilot-send-rich-mode.sh --approved off`.
