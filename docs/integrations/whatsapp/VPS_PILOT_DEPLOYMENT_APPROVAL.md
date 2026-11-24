# Private VPS pilot — consolidated deployment approval request (Step 108.10)

Status: **APPROVED by owner and EXECUTED 27 Oct 2026** — see [VPS_PILOT_DEPLOYMENT_RESULTS.md](VPS_PILOT_DEPLOYMENT_RESULTS.md).

## What gets created (only on VPS srv1871828)

| Item | Name | Notes |
|---|---|---|
| Docker project | `thaara-v2-pilot` | New, separate from all 9 existing projects |
| Containers | `thaara-v2-pilot-postgres-1`, `-redis-1`, `-api-1` | Read-only filesystems, all capabilities dropped, no Docker socket, non-root users |
| Networks | `thaara-v2-pilot-data` (internal, no internet), `thaara-v2-pilot-entry` | Not connected to `n8n_default` or any legacy network |
| Volumes | `thaara-v2-pilot-pgdata`, `thaara-v2-pilot-redisdata` | Test data only; no backups (synthetic data) |
| Folders | `/opt/thaara-v2-pilot` (compose file, install bundle), `/opt/thaara-v2-pilot-private/secrets` (root-only) | |
| Secrets | 5 random values (`admin_password`, `api_password`, `redis_password`, `session_secret`, `csrf_secret`) | Generated **on the server**, never printed, never sent to chat/Git. File owners set per container user, mode 0400/0440 |
| Image | `thaara-v2-pilot-api` @ `sha256:7fbcfa2aa3c5c1f7e5a849e23092a746d0bc5bcb7bdf8b0177d7c6d2ad162018` (linux/amd64, user 1000:1000, ~468 MB) | Built locally, transferred over the verified SSH connection with `docker save \| docker load`, and its ID is checked on arrival |
| Database | `thaara_vps_pilot` + restricted `thaara_app` login | Installed once from bundle sha256 `f1250b0969620d0099cab440523a8322d0e8e67a54b026e3f83480758b2cdffb` (12 base migrations + 1083 + pilot-only 1089) |

Ports and domains: **no public port, no DNS, no domain, no Traefik/proxy change, no firewall change.** The API listens only on `127.0.0.1:15440` on the VPS. PostgreSQL and Redis have no host ports.

Resource caps: 384 MB + 192 MB + 512 MB RAM (about 1.1 GB of the ~5.1 GB free), 1.25 CPU, and about 1 GB of disk for the image plus a small amount of data.

## Steps (each stops on the first failure)

1. Read-only pre-check: confirm no `thaara-v2-pilot*` resources exist, `/opt/thaara-v2-pilot*` is absent, port 15440 is free and the CPU is x86_64. Record the `docker ps` baseline for the 9 existing projects.
2. Transfer the image and verify its ID matches.
3. Create the folders and generate the 5 secrets on the server.
4. Start `postgres` and `redis` only, then wait until both report healthy.
5. Upload the install bundle, check its sha256 on the server, then run it once through the pilot container's `psql`. The bundle refuses to run on any other database and refuses to run twice.
6. Start `api`, then check `http://127.0.0.1:15440/api/v1/health` from the VPS. The startup check confirms the database is the exact pilot DB, the login is the restricted user, and the schema is present.
7. Compare `docker ps` with the baseline. All existing projects must still be running and unchanged.

## Not included (each needs its own later approval)

Public HTTPS or a domain, connecting n8n to the pilot (joining `n8n_default` or Traefik), activating workflows, Meta or provider credentials, real WhatsApp messages, web UI hosting, production use, firewall changes for legacy ports.

## Exceptions you are approving (pilot only)

1. PostgreSQL and Redis are self-hosted test containers instead of managed services.
2. Secrets are stored in protected files on the server instead of a secret manager.

Production still requires managed services, TLS, backups and a secret manager. These exceptions end at pilot rollback.

## Impact and cost

- **Cost:** none extra. It uses your existing KVM 2 VPS and needs no purchases or subscriptions.
- **n8n / legacy Thaara / other projects:** no changes and no restarts. The pilot shares no networks or volumes with them. CPU and memory are capped.
- **What you need to create:** nothing. There are no accounts or keys to set up for this step.

## Rollback (removes only the pilot)

```
docker compose -p thaara-v2-pilot --profile application down -v
rm -rf /opt/thaara-v2-pilot /opt/thaara-v2-pilot-private
docker image rm <pilot image ID>
```

Optional: remove the `THAARA AI V2` SSH key in Hostinger. Existing projects are never touched by rollback.

## Evidence (local, 27 Oct 2026)

- Throwaway-container acceptance on the pinned PostgreSQL image passed **13/13**. Checks: wrong DB refused and left unchanged; fresh install; re-run refused; no secret in output; cross-container restricted login with the exact pilot-start admission query; wrong password rejected; app role cannot run DDL; RLS fails closed; migration ledger equals migrator checksums; reference install via the original 1083/1085 path; **pg_dump schema identical** (sha256 `87649b47…`); role attributes identical.
- Focused tests: 75/75 across 5 files (the pilot DB bundle, pilot config, step74 and step1085 guards, connector key rotation).
- Untested until deployment: on-server secret file ownership and mounts, and actual health under VPS load.
