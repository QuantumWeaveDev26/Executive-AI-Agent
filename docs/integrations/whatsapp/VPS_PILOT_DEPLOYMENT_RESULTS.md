# Private VPS pilot — deployment results (27 Oct 2026)

Owner approval (verbatim, in Claude): "I approve the private pilot deployment exactly as described in VPS_PILOT_DEPLOYMENT_APPROVAL.md, including the two pilot-only exceptions (self-hosted test DB/Redis, server-side secret files). No public port, DNS, n8n, firewall, provider or message changes."

## Result: DEPLOYED, private, healthy

| Check | Result |
|---|---|
| Pre-check | No `thaara-v2-pilot*` project, container, network, volume or folder existed; port 15440 was free; CPU x86_64 |
| Image | `sha256:7fbcfa2aa3c5c1f7e5a849e23092a746d0bc5bcb7bdf8b0177d7c6d2ad162018` loaded over verified SSH; ID matched on the server (amd64, 1000:1000) |
| Secrets | 5 unique 43-character values generated on the server and never printed. Owners: admin/redis 999 (0400), api 1000:999 (0440), session/csrf 1000 (0400). Folder is root 0700 |
| Uploaded files | compose.json, .env (image ID only) and the bundle; sha256 matched local copies byte for byte |
| Rendered config | The server's `docker compose config` output passed `validatePilotCompose` (after the fix below) |
| PostgreSQL 16.15 | Healthy, user 999:999, read-only root, 0 restarts |
| Redis 7.4.11 | Healthy, user 999:999, read-only root, all capabilities dropped |
| DB install | Bundle sha256 `f1250b09…` verified on the server; 12 migrations, relay principals present, `thaara_app` login without super/bypassrls; re-run refused |
| API | Healthy, HTTP 200 `/api/v1/health` from the VPS, user 1000:1000, read-only root, 0 restarts, approved image ID |
| Exposure | Only `127.0.0.1:15440` was added. Postgres and Redis have no host ports. The data network is internal. The pilot is not attached to `n8n_default` |
| Existing services | All 20 pre-existing containers have identical names, IDs and states before and after (including n8n, Traefik, legacy Thaara, brandmint) |
| Resources | API 71 MB, Postgres 31 MB, Redis 3 MB, CPU about 0%; host available memory 4.77 GB |

## Deviations and fixes (all inside pilot resources)

1. **Validator bug (mine, from today):** the new PostgreSQL secret rule rejected Docker's long-form `{source,target}` rendering. Fixed to accept only `target=/run/secrets/<source>` with no uid/gid/mode. A regression test was added using the actual server rendering (`scripts/fixtures/hostinger-pilot-rendered-compose.json`, which contains no secrets). Focused tests now pass 76/76. The deployed image still carries the earlier, stricter copy of `validatePilotCompose`, which is unused at runtime. The image was not rebuilt, so the approved image ID is kept.
2. **Volume ownership (flagged UNTESTED in the approval):** the new empty `thaara-v2-pilot-pgdata` volume was root-owned, so initdb running as 999 failed with no data written. After checking the volume carried the pilot label and had 0 entries, a one-off container (the same pinned postgres image, `--network none`, read-only) set it to `999:999 0700`. PostgreSQL then initialized normally and still runs as non-root. **Runbook update:** future reinstalls must do this before starting postgres.
3. **Tooling:** PowerShell 5.1 removes quotes from arguments passed to bash. One image-transfer attempt therefore streamed back without loading, and nothing changed on the server. All later remote steps were run from LF script files instead.
4. Install-step exit capture used `PIPESTATUS` after `|| true`, which can mask a failure. Success was instead confirmed by independent queries (migrations=12, relay table, role attributes) and by the refused re-run. Fix this in any reusable runbook script.

## Still not done (each needs its own approval)

n8n ↔ pilot connection, public HTTPS/domain, workflow activation, Meta credentials, real messages, web UI hosting. WhatsApp is **not LIVE**.

## Rollback (unchanged)

`docker compose -p thaara-v2-pilot --profile application down -v`, then `rm -rf /opt/thaara-v2-pilot /opt/thaara-v2-pilot-private`, then `docker image rm sha256:7fbcfa2a…`.
