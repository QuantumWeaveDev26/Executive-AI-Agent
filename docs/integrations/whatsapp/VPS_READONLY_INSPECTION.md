# VPS1871828 read-only inspection — 27 October 2026 (Claude)

Scope: owner-approved read-only inspection only. No writes, installs, restarts, firewall/DNS/proxy/n8n changes, SQL or secret/env output.

## Access and identity

- THAARA AI V2 public key (RSA3072, `SHA256:XTONfdhNPUp/3JK7mXedUlwWhxXm5biKSEvte++rVGI`) registered on the VPS after the owner confirmed again in Claude. Read-back showed exactly 4 root keys; the 3 existing ones were unchanged.
- Host key `ssh-ed25519 SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4` matched the owner's Hostinger browser-terminal output. It was captured with auth `none` (no credential offered), then pinned in a session-local known_hosts. The login used StrictHostKeyChecking=yes, ed25519 host key only, and rsa-sha2 signatures only.
- The private key was decrypted from DPAPI into a temporary file with an owner-only ACL, used for one SSH session, then deleted (removal verified). The key was never printed, and nothing was stored in the repository.

## Findings

| Area | Observed |
|---|---|
| Host | Ubuntu 24.04.4, 2 vCPU, 7.9 GB RAM (~5.1 GB available), disk 96 GB (33 GB used / 64 GB free), load ~0.1, up 10 days, 2 login sessions at inspection time |
| Docker | Engine 29.6.1, Compose v5.3.0; 9 images 7.7 GB, 13 volumes 5.8 GB |
| Compose projects | agent-arjun-{brahmastra,full,guides,staging,workspace}, aicampus, n8n, praja-seva-pilot, thaara-ai-platform (legacy) |
| Public listeners | 22, 80/443 (n8n-traefik), 5000 (legacy Thaara backend), 8080 (legacy Thaara frontend), *:20241 (unidentified) |
| Loopback listeners | 3100 aicampus, 5678 n8n, 65529 (unidentified), DNS stub |
| Proxy | Single Traefik (`n8n-traefik-1`) on network `n8n_default` only; docker provider, exposedbydefault=false, HTTP→HTTPS redirect, ACME TLS-challenge resolver `mytlschallenge` |
| n8n | `n8n-n8n-1`, restart=always, network `n8n_default`, loopback 5678 behind Traefik |
| Legacy Thaara | `thaara-ai-platform` frontend/backend + `thaara-ssl` cloudflared container |
| Firewall | UFW inactive; iptables INPUT policy ACCEPT; no Hostinger firewall group (`firewall_group_id: null`) |

## Pilot collision check (compose.review.json)

- No existing project, network, volume or container uses the `thaara-v2-pilot*` names. Port 127.0.0.1:15440 is free.
- Pilot limits (384 MB + 192 MB + 512 MB RAM, 1.25 CPU) fit the observed headroom. This is metadata only, not a load test.
- Not yet checked: whether `/opt/thaara-v2-pilot-private` exists, and CPU architecture (expected amd64 for KVM 2). Check both read-only immediately before any approved deployment.
- Reaching the pilot from n8n or the public internet later needs one of two things: the API joining `n8n_default`, or Traefik joining a pilot network. Either one touches the shared proxy path and needs its own approval. The current pilot design (loopback only) needs neither.

## Security observations (not changed; owner decision)

1. The host firewall is off, and the legacy Thaara ports 5000/8080 are publicly reachable. This is outside V2 scope, but it is a risk to existing services.
2. Port *:20241 and loopback port 65529 are unidentified listeners. The next read-only pass should map them to their processes.
3. All Hostinger SSH keys grant root. There is still no restricted V2 user.

## Remaining blocker before the deployment approval request

The target-specific database installer for the new `thaara_vps_pilot` DB and the restricted `thaara_app` role does not exist yet. The existing 1083/1085 SQL must not be retargeted. Build and test it locally first. Then send one consolidated approval request (containers, volumes, secret files, SQL, rollback).
