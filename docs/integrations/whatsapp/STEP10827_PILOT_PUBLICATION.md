# Steps 108.25–108.27 pilot publication — approval request

**Status: PUBLISHED AND VERIFIED — 29 Oct 2026 ~01:40 UTC.** Owner approved ("Approve update").

- New image `sha256:7f577bb120325f295949d93054c37e9c82d24f46689a7e008e3fa423d0f7e09c`; archive `47a0b3ca…` (26 files) verified; offline overlay build passed.
- Private backup created and listing validated; 10825 SQL (`03f152fd…`) applied; rows not reduced; RLS/grants/policies/trigger definitions unchanged.
- Link restored (n8n→pilot 200, forged callback 403, public watch 12/12, n8n single network, not restarted); web files 3/3; `/health` 200; `/auth/me`, `/connections`, `/contacts`, `/templates` 401. Send still disabled; other services unchanged.
- Host scripts installed, none run. Rollback directory `/opt/thaara-v2-pilot-private/handoff/whatsapp-compose-10827-20261029T013921Z` (previous image `85fea59e…`; additive 10825 schema retained).
- Not yet verified: owner signed-in check of the new screens.

## What it does on the pilot

1. Preflight (read-only): API image is exactly `85fea59e…`, healthy, send=false; n8n single network and healthy; link script pinned; database has 1083/1089/10821 and no 10825; identities of PostgreSQL/Redis/n8n/Traefik recorded.
2. Verify archive `47a0b3ca6c4dc0a93ddc962a82d0e8e408c8ec2c3946b8993edc5006a9c684d0` (26 files, manifest) and SQL `03f152fd0755cdfa5a00be8cba59cf33f4ad792c9d5ec0684189f651572672ee`.
3. Build the overlay offline (`--no-cache`, `--network=none`); exact-match patches of the pilot's own `app.js`, policy registry and contracts index (fingerprint-checked; paused Phone code excluded); assert base layers/config unchanged.
4. **Private database backup** (`pg_dump -Fc`, listing validated), then apply **10825** in one transaction (rolls back on any error; old API keeps running). Verify: both 10825 constraints installed, audit issuer still owned by the guard role, rows not reduced, RLS/grants/policies/trigger definitions identical.
5. Recreate **only the API** with the new image; restore the private n8n link; verify send still off, other services unchanged, public web files checksum-identical, `/health` 200, `/auth/me`, `/connections`, `/contacts`, `/templates` 401.
6. Install host scripts (not run): `pilot-meta-key-entry.sh`, updated `pilot-send-live-on.sh` (unlimited default), `pilot-send-live-off.sh`.
7. Any failure after the API swap → automatic API rollback to `85fea59e…` with link restoration. The additive 10825 schema stays (it accepts everything the previous API writes).

Not touched: n8n workflows, credentials, Meta, sending (stays off), other projects.

## What the owner gets

Contacts manager, template picker (shows "not set up" until the Meta key), file attach with two separate approvals (upload, then send), document/audio buttons (show "not set up" until the Meta key). Sending remains disabled.

## Evidence (local, 29 Oct)

- Isolated PostgreSQL 10825 acceptance 7/7 (28 Oct, unchanged SQL).
- Full regression after 108.27 + fixes: web 214/214, API 695 passed (only the 5 gated DB-runtime suites and the root-only n8n export test excluded; the latter passes in root 41/41), policy 73/73, all five builds.
- Offline chain rehearsal 108.18→21→23→23b→24→27: local base `app.js`/registry/index fingerprints **identical to the pilot's** read-only capture; overlay build passed patch + import verification.
- Rehearsal found and fixed two real defects that would have stopped the pilot build (before any database change): workspace contracts index absent in the image; `String.replace` interpreting `$'` in the injected registry code (corrupted JavaScript). Added a parse test for all patched modules (4/4).
- Fixed: rejecting/cancelling a personal WhatsApp approval no longer requires the full send authority (route test 4/4); `richMessages` profile flag preserved by `pilot-config.mjs` (default false); two-stage upload UI stages and uncertain-failure disclosure tested (19/19).

## Still not done after publication

Meta access key on the server (owner), real provider validation, outbound workflow template/media branches (+ `richMessages`), final go-live.
