# Step 108.28 — connect the owner-entered Meta key (approval request)

**Status: PUBLISHED AND VERIFIED — 29 Oct 2026 ~02:00 UTC** (owner approved "Approve connection"). Image `sha256:522a3dd8346e760abd5bd5f4e623b2035c1fa80e41122905f3cc2a589c9f10d6`; key file present (metadata only, not read); link restored (200/403/12-12/single network/not restarted); API accepted the key (no refusal logged; no provider call made); `/health` 200, `/auth/me` and `/templates` 401; send=false; other services unchanged. Rollback `/opt/thaara-v2-pilot-private/handoff/meta-wiring-10828-20261029T020028Z` (previous image `7f577bb1…`, compose/env backups). Real Meta reads not yet verified (owner test pending).

Previously: The owner saved the dedicated key on 29 Oct with `pilot-meta-key-entry.sh` (file `/opt/thaara-v2-pilot-private/secrets/meta_access_token`, 0400, uid 1000; a second run correctly refused to overwrite).

## Change

- `pilot-config.mjs`: `pilotMetaAccessToken()` reads the optional key once (20–4096 chars, no whitespace/control); compose validator allows `meta_access_token` only as a plain API mount declared at top level with the exact private path.
- `pilot-start.mjs`: passes the key only to `createMetaWhatsAppMediaProvider`, `createMetaWhatsAppTemplateProvider`, `createMetaWhatsAppMediaUploader`. A malformed key logs a warning and leaves those features not configured (API stays up). Sending still depends only on the separate send profile (off).
- Pilot `app.js` CSP (exact-match patch, fingerprint `5718005694b27b43434ac9e55656361ed50c2f16ed85018cf10c9ebd977fe4ac`): `img-src` adds `blob:`, new `media-src 'self' blob:` — needed to show verified images and play verified audio. Scripts unchanged.

## Publisher (`deploy/hostinger-pilot/publish-meta-wiring.py`, archive `387b283dfa26af76b5ed5c86b7761342490f351e479dada8855003ad43e6bd07`)

Preflight (image `7f577bb1…`, send off, n8n single network, key file metadata only — never read) → offline `--no-cache` overlay build → back up `compose.json`/`.env` → add only the key mount → validate with the project's compose validator inside the new image and diff (only image + one secret) → recreate API only → restore private link → verify send off, other services unchanged, no "key refused" log, public paths → automatic rollback (restore compose/env; restart only if already restarted). No SQL, no Meta call, no workflow change.

## Evidence (local)

Offline chain 108.18→21→23→23b→24→27→28 on fingerprint-identical base: CSP patch + wiring verification passed; in-image compose validation passed. Tests: wiring 3/3 (key parser, compose rules, CSP parse), pilot/patch 29/29, API auth/CSRF/media 31/31, typecheck.

## After deployment (owner, real Meta reads)

Sign in → WhatsApp → open the image chat → "Load image preview"; open the template button. These are the first real Meta calls (read-only). Uploads still need the two separate approvals; sending stays off.
