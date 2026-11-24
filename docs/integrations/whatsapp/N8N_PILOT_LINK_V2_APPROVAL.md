# Safer n8n ↔ pilot link — consolidated approval request (Step 108.11b)

Status: **AWAITING OWNER APPROVAL.** Nothing below has been run.

## Why a new design

The first link put **n8n** on a second network. That confused Traefik and took public n8n down for about 12 minutes ([incident](INCIDENT_2026-10-27_N8N_PUBLIC_OUTAGE.md)). In the new design **n8n is never touched**: the **Thaara pilot API** joins n8n's existing network instead. n8n keeps exactly one network, so Traefik's route to n8n can't change.

## What changes (VPS srv1871828)

| Item | Change |
|---|---|
| `thaara-v2-pilot-api-1` | Joins `n8n_default` with the alias `thaara-pilot-api`. Live attach, no restart. It has no Traefik labels and Traefik only routes labelled containers, so it gets **no public route** |
| `thaara-v2-pilot-n8n` | The old, now-empty link network is removed (only the pilot API is on it today) |
| `n8n-n8n-1`, Traefik, all other containers | **No change.** No network change, no restart, no config edit |

There are no ports, DNS, firewall, compose files, workflows or Meta changes in this step. Script: [n8n-link-v2.sh](../../../deploy/hostinger-pilot/n8n-link-v2.sh). Undo: [n8n-link-v2-rollback.sh](../../../deploy/hostinger-pilot/n8n-link-v2-rollback.sh).

## How I'll prove public n8n stays healthy

1. **Before:** the script refuses to start unless public `https://n8n.srv1871828.hstgr.cloud/healthz` returns 200 and n8n is on exactly one network.
2. **Right after connecting:** public check must return 200.
3. **Deliberate Traefik rebuild:** it starts one throwaway container (the exact trigger of the incident), then public must still return 200.
4. **2-minute watch:** a public check every 10 seconds, 12 out of 12 must pass.
5. **Final:** n8n still on one network, and **not restarted** (same container ID, start time and restart count).
6. Afterwards I check public n8n from **your PC** as well, and compare the full container snapshot before and after.

**Automatic rollback:** if any public check fails, the script immediately detaches the pilot, refreshes Traefik and re-checks. That's the same quick fix that restored n8n today, and it would happen within seconds.

## Proof the link works

From inside n8n: pilot health returns 200, and a fake callback token is refused (403).

## Trade-off (please read)

On `n8n_default`, the other containers on that network (aicampus, agent-arjun portals, praja-seva, brandmint) can also *reach* the pilot API's address. They still can't do anything without credentials: every Thaara endpoint except health needs a signed-in session or the per-connection relay key, and requests are rate-limited. The previous design was more isolated but unsafe for n8n. This one is safe for n8n with slightly wider network reach. If the pilot API container is ever recreated, the link disappears and fails **closed**.

## After a successful link: continue Step 108.13 (already approved)

Your existing 108.13 approval covers Parts C–D: point the inbound workflow at `wa_pilot_meta_test_10813`, attach the "Thaara WhatsApp Trigger" credential, enable both nodes, activate, then run the forged-request check and your "Hello Thaara" test. I'll continue with those **only if every link check above passes**, and I'll re-check public n8n after activation too. If you'd rather approve 108.13 Parts C–D again separately, say so.

## Cost and impact

- **Cost:** none.
- **n8n:** untouched.
- **What you need to do now:** nothing.

## Evidence (local)

Scripts are syntax-checked. Guard tests (14/14) prove the scripts never connect or disconnect n8n, only use throwaway no-network containers, contain no restart/compose/firewall commands, and include every public-health proof and the auto-rollback. The old link script is blocked (`exit 1`).
