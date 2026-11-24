# Incident — public n8n unreachable (27 Oct 2026, about 15:40–15:52 UTC)

**Impact:** `https://n8n.srv1871828.hstgr.cloud` stopped responding: TLS completed, then requests hung. During the window, n8n webhooks, the UI and the Claude n8n connector were unavailable from outside. n8n itself kept running the whole time (local `/healthz` 200, never restarted, same container since 2026-10-16). No data change. The approximate window runs from the Step 108.13 Part B one-off container start to the restore.

**Root cause (Claude's design mistake in Step 108.11):** the private link attached `n8n-n8n-1` to a second network (`thaara-v2-pilot-n8n`). n8n carries no `traefik.docker.network` label, so whenever Traefik rebuilds its routes (on any container start or stop event), it can choose either of n8n's addresses. After a later container event, it chose the pilot-link address (172.16.7.3), which Traefik is not attached to, so the n8n route hung. Detaching a network does not trigger a Traefik rebuild; a container event does.

**Restore (within the approved Step 108.11 rollback, no restart of any existing service):**
1. `docker network disconnect thaara-v2-pilot-n8n n8n-n8n-1`. n8n is back on `n8n_default` only, as before 108.11.
2. Started one throwaway no-network container (pinned postgres image, `--rm`) to fire a container event. Traefik rebuilt its routes, and local and public HTTPS returned 200 within seconds.
3. Verified: public 200 from the VPS and from the owner's PC; n8n restarts 0; the inbound Thaara workflow unchanged (last edit 15:18:59) and inactive.

**State now:** the pilot API remains alone on `thaara-v2-pilot-n8n` (harmless). n8n can no longer reach the pilot, so Step 108.13 is paused after Part B. The Meta test connection exists and the events-only key is on it, but nothing in n8n or Meta has changed.

**Lesson / rule:** never attach a Traefik-routed container to an extra network unless it has an explicit `traefik.docker.network` label. A safe pilot link must keep n8n single-network. The candidate design is attaching the pilot API to `n8n_default` instead, which needs a new owner approval. `deploy/hostinger-pilot/n8n-link.sh` is superseded and must not be re-run.
