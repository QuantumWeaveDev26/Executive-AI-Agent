# Step108.21 pilot publication — verified 28 October 2026

## Publication result

**Live image acceptance passed:** Owner reported sending an image. Read-only database verification found one image metadata record in corrected inbox `wa_pilot_meta_test_10813b`, incoming count increased8→9, latest timestamp `2026-10-28T14:29:19.000Z` (**28 Oct, 7:59:19 PM IST**). Refreshing the existing owner session shows **16 saved records**, new `image/jpeg` card, `Not downloaded` and explicit metadata-only disclosure. Prior15 records remain visible. Sending remains disabled; developer made no Meta call, download, send, workflow change or deployment during this check. Screenshot: `node_modules/.cache/step10821/live-image-received.png`. This verifies actual image metadata propagation through the existing inbound path, persistence, API projection and browser card; it does not verify image bytes/authenticity, PDF/audio live cases, downloads/playback or outbound media. The earlier no-attachment continuation below is historical.

Owner explicitly approved the scoped pilot database/API/UI publication with "okay do it". Preflight passed on the expected image, healthy services, sending=false, forced message RLS and absent media column. Publication completed successfully:

- Final image: `sha256:75682e644d96b15745091bbb4c1ce2914d72e826b1de0162e6adbdcc679010f8`.
- All 11 staged artifact checksums verified. Offline overlay build passed its actual installed contract/DB module assertions; base layers and runtime configuration preserved.
- Private pre-change PostgreSQL custom-format backup created and archive listing validated. This is not a restore rehearsal.
- Exact tested additive SQL applied once to the named pilot database. Message rows remained **9**; connection/dispatch/status row counts remained **3 / 7 / 3**. Forced RLS, ACL, policy and trigger fingerprints unchanged. Nullable JSONB column and validated check confirmed.
- Only pilot API recreated. Private-link health **200**, forged callback **403**, n8n availability **12/12**, n8n single network and no restart. PostgreSQL, Redis, n8n and Traefik identities/start times/restart counts unchanged.
- Trusted HTTPS web assets **3/3** match tested build. Public health **200**; anonymous auth/me and inbox catalog **401**. Send gate still false.
- Existing owner browser session survived; Saved inbox 2 loads the same **15 saved records** and one saved delivery-events control. Sending-disabled disclosure remains visible. No reply, approval, send or synthetic insert performed in browser acceptance.
- Private rollback directory: `/opt/thaara-v2-pilot-private/handoff/incoming-media-10821-20261028T141404Z`. Includes previous image/compose, private backup, build log, before/after database facts and `result.json`. Prior image retained; application rollback must retain the additive metadata column.
- Publisher: `deploy/hostinger-pilot/publish-incoming-media.py`, SHA-256 `d7c90ecb5d3fd3cfe81536ac999a4fc3c00037b89e2fafe8400b036e546f3906`. Screenshot: ignored `node_modules/.cache/step10821/pilot-inbox.png`.

No workflow configuration/activation, credential changes, Meta calls, real sends, commits or pushes. Existing dirty work and Vite config preserved. This completes metadata publication; actual incoming media through live n8n still needs an owner-originated attachment and read-back. File bytes, downloads/playback, transcription and outbound media/templates remain unfinished.

Read-only continuation: pilot still runs the verified image with send=false. Corrected inbox contains **8 incoming text records, 0 media records**, latest saved incoming timestamp `2026-10-28T10:40:25.000Z`. Direct connector read-back restricted to the two allowed Thaara workflows confirms inbound `ezIrlr7y9dEowujw` active, active version `68b66159-eb3b-46f3-8597-b1bda6000871`, two enabled nodes, complete-event `{ event: $json }` relay and redirects disabled. Outbound `RrqXTplIBXginMSD` inactive, success/error/manual/progress execution saving off. Sanitized workflow responses omit credential assignments; omission is not evidence of missing credentials and no setup recreation is requested. No workflow execution or mutation occurred. Owner-originated attachment remains the exact live-validation dependency; do not substitute a fabricated record or send a real message from development tools. No tests repeated because application artifacts are unchanged.

## Reviewable artifacts

- Current expected pilot base: `sha256:9ceaf0086b356062c2269da52516f2beeb010b8787ecd399272503fa9b070ac3`.
- Recipe: `deploy/hostinger-pilot/Dockerfile.incoming-media`.
- Ignored staged archive: `node_modules/.cache/step10821/publication.tar.gz`.
- Archive SHA-256: `5ca590f5035441f67b7e3b294d19d1c381939b3e5351a28edfeb9482b655c5a1`.
- SQL SHA-256: `9334165b784997400318c884acb78bd53ad2f3d499e832b602896097ecb11404`.
- `manifest.json` in the archive lists each staged file hash. Archive includes only two compiled contract modules, one compiled DB repository, three compiled WhatsApp services, tested web assets, recipe and review SQL. No credentials, environment files, full API build or Phone artifacts.

## Verification already completed

Owner replied "okay continue" to isolated fixture/SQL/testing/cleanup approval. New internal network and tmpfs PostgreSQL container were created with fresh in-memory credentials and strict identity checks, then removed. Pinned base + durable + media SQL applied only inside the new fixture. First run: 6/7, revealing JSONB key-order sensitivity in duplicate comparison. Added failing regression, changed to deep equality, reran: **7/7 runtime tests**. Final focused milestone including authenticated synthetic relay and isolation guards: **225/225, 15 files**. API build passed after the fix; unchanged contracts/DB/web builds passed earlier in this slice.

This verifies local metadata behavior and actual PostgreSQL constraints/RLS/concurrency. It does not verify live n8n media payloads, provider eligibility, file bytes or authenticity. Local runtime reconnect tests use independent pools/services; they do not restart the database server.

## Proposed consolidated publication approval

The approval must explicitly cover the following pilot-only operations:

1. Read-only preflight on the existing private pilot: exact base image, PostgreSQL container/database identity, current table shape/RLS/grants/triggers, row counts, send=false, current image/compose rollback references and existing service identities. Stop on drift, unavailable backups or failed health; never substitute another database/service. Stage artifacts in a new private pilot handoff directory and verify all checksums. Preserve private schema/backup evidence on the VPS without printing data or credentials.
2. Build the overlay on that exact base. The recipe updates actual installed pnpm runtime copies for both contracts and DB; build assertions check schema exports, repository SQL and service imports. **The overlay has not yet been built on the VPS.** Stop before SQL if the build fails. Preserve the old image and compose for rollback.
3. Apply only the additive Step108.21 SQL to `thaara_vps_pilot` in `thaara-v2-pilot-postgres-1`. Its transaction adds nullable `media_metadata` and a strict check with 3-second lock/30-second statement limits. No data backfill, drops, deletes, privilege or RLS changes. Recheck schema and unchanged preexisting row counts. New metadata is unavailable until this succeeds; do not start the new API first.
4. Recreate **only the pilot API** with the checksum-verified overlay. Restore its private n8n link using only the existing checksum-pinned `n8n-link-v2.sh`. Do not attach n8n to another network or restart n8n, PostgreSQL, Redis or Traefik. Keep workflow configuration, tokens, send gates and daily limits unchanged.
5. Verify HTTPS, tested public asset hashes, anonymous authorization denial, private health/forged-callback denial, send=false, existing owner inbox/history and existing service identities. Run the existing bounded n8n availability watch. No real sends, workflow activations, provider API calls or synthetic inserts into existing owner history in this publication scope.
6. On application failure restore the prior API image/compose and private link. Retain the additive nullable column; do not destroy metadata through a rollback migration. If SQL fails, the transaction rolls back and the old API remains running.

After verified publication, the owner can separately choose to send an incoming attachment from their own WhatsApp account. Do not initiate a real message or claim live media acceptance before an actual authorized attachment is received and read back. Download, playback, transcription and outbound media/templates remain outside this slice.

The proposed scope above was separately approved and completed as recorded at the top. Any further real sends, workflow activation, credential changes, broader SQL or deployment require their own authorization.
