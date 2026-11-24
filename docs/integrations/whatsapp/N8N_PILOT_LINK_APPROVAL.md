# Private n8n ↔ pilot link — consolidated approval request (Step 108.11)

Status: **APPROVED and EXECUTED 27 Oct 2026.** Owner approval (verbatim): "I approve the private n8n-to-pilot link exactly as described in N8N_PILOT_LINK_APPROVAL.md: one internal network with only n8n-n8n-1 and the pilot API, live attach, no n8n restart or config change, no workflow, port, DNS, firewall, provider or message changes."

Results: members exactly n8n-n8n-1 + thaara-v2-pilot-api-1; n8n→pilot health 200; forged callback token 403; pilot not on n8n_default; n8n not restarted (same ID, start time 2026-10-16T20:14:11Z, restarts 0); all 23 containers identical before/after. Workflows were not read or modified in this step (last read-back: inactive).

## Why

n8n receives WhatsApp events from Meta, and Thaara needs them. Today n8n and the pilot cannot reach each other. This step creates a **private** link between exactly those two containers.

## What changes (VPS srv1871828)

| Item | Change |
|---|---|
| New network | `thaara-v2-pilot-n8n`, **internal** (no internet path), labelled as pilot |
| `thaara-v2-pilot-api-1` | Also attached to the new network, alias `thaara-pilot-api` |
| `n8n-n8n-1` | Also attached to the new network. **Live attach: no restart, no change to n8n's compose file, settings, data, credentials or workflows.** It keeps its existing network |
| Probes (read-only) | From inside n8n: pilot health must return 200, and a forged callback token must be refused (403) |

Not changed: Traefik, `n8n_default` and its other members (aicampus, agent-arjun, praja, brandmint stay unable to reach the pilot), ports, DNS, firewall, legacy Thaara, workflows (they stay inactive), Meta, messages.

Exact scripts (reviewed and syntax-checked; a test pins them to network-only Docker commands): [n8n-link.sh](../../../deploy/hostinger-pilot/n8n-link.sh), [n8n-link-rollback.sh](../../../deploy/hostinger-pilot/n8n-link-rollback.sh).

## Safety checks built in

- The script aborts if either container isn't running or if the network already exists.
- It confirms n8n was **not restarted**: its container ID, start time and restart count must match before and after.
- It confirms the link network contains exactly the 2 containers, and that the pilot is **not** on `n8n_default`.
- Every n8n → Thaara callback still needs a per-connection secret token. None exists yet, so the link carries no usable access until Step 108.12.
- I'll compare the full container list before and after, as in the pilot deployment.

## Trade-off you should know

A live attach is not saved in n8n's compose file. If n8n is ever recreated (for example by a Hostinger update), the link disappears. That fails **closed**: n8n simply can't reach the pilot until the script is run again. I chose this over editing n8n's compose file so that n8n's own configuration stays untouched.

## Impact and cost

- **Cost:** none.
- **n8n:** no restart, no downtime, no config change. It gains one extra private network.
- **What you need to do:** nothing for this step.

## Rollback (seconds, no restart)

Run `n8n-link-rollback.sh`: it detaches both containers and deletes the network.

## After this (separate approval, Step 108.12)

1. Create a synthetic pilot owner, a WhatsApp test connection and a per-connection callback token. The token is generated on the server; only its hash is stored in the database.
2. **USER SETUP:** you copy that token from the Hostinger browser terminal into a new n8n "Header Auth" credential. It never goes through chat.
3. Point the inactive n8n workflows' HTTP nodes at `http://thaara-pilot-api:3002` and test them with pinned sample data (no Meta, no messages).

Then HTTPS, Meta webhook verification, and one controlled test-number message, each approved separately.
