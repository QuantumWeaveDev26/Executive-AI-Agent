# Step 108.18 — Owner-usable HTTPS web access and sign-in plan (Private VPS Pilot)

**28 Oct HTTPS correction:** DNS now resolves correctly. After owner-approved Thaara-only router refresh, normal public TLS validation succeeds (Let's Encrypt YR1, hostname matches, expiry 26 Jan 2027). Web/health return 200; anonymous account/inbox catalog requests return 401. The earlier DNS-pending notes below are historical. Owner browser sign-in still needs confirmation; no password was accessed during this repair. See `docs/tasks/108.18-pilot-https-repair.md` for safeguards and exact results.

Status: **DEPLOYED & VERIFIED ON VPS `1871828` (28 Oct 2026 ~11:36 UTC) — Option A (`https://thaara-v2.quantumweaveai.io` via VPS Traefik + secret-safe owner password) approved by owner. Only DNS `A` record (`thaara-v2` -> `76.13.217.50`) remains for public browser resolution.**
- Running image on VPS: `sha256:eb47f512b0f9bf2e475e1602c6c5191b1500883fcc01d153efe23ea5e2dc8bee` (excludes paused Step 110 Phone code; `send_enabled=false`).
- Traefik HTTPS verification (`--resolve thaara-v2.quantumweaveai.io:443:127.0.0.1`): `/` -> `200`, `/api/v1/health` -> `200`, `POST /api/v1/auth/login` -> `200`, `GET /api/v1/auth/me` -> `200`, `GET /api/v1/connectors/whatsapp/n8n/durable/connections` -> `200`, `GET /api/v1/connectors/whatsapp/n8n/durable/wa_pilot_meta_test_10813b/inbox` -> `200`.
- n8n link & public watch (`n8n-link-v2.sh`): `n8n_to_pilot_health=200`, `forged_callback_status=403`, `public_watch=12/12 ok`, `n8n_single_network=yes`, `n8n_not_restarted=yes`, `data_services_untouched=yes`.
- Owner login password stored only in root-only `0400` `/opt/thaara-v2-pilot-private/handoff/owner_login_password` (rotatable anytime via `bash /opt/thaara-v2-pilot/thaara-owner-login.sh --approved`).

## Goal

Give the owner a secure browser login to the existing private VPS pilot (`thaara-v2-pilot` on VPS `1871828` / `76.13.217.50`) so the owner can:
1. Open the Thaara web app in a browser over HTTPS (`https://thaara-v2.quantumweaveai.io`),
2. Sign in as the pilot owner (`pilot-owner-10812@thaara-pilot.invalid` or the owner's chosen login email),
3. Read stored WhatsApp conversations (with contact names and masked phone numbers),
4. Prepare and approve WhatsApp replies from the **WhatsApp Inbox** or **Thaara Chat**.

---

## Why browser access is not active yet

1. **No web bundle in the pilot image:** `deploy/hostinger-pilot/Dockerfile.api` currently compiles and stages only `@thaara/api`. The API listens on `127.0.0.1:15440 -> 3002` with no static web asset serving and no public HTTPS route.
2. **Pilot owner account has a non-login placeholder hash:** `deploy/hostinger-pilot/pilot-seed.mjs` created `pilot-owner-10812@thaara-pilot.invalid` with `password_hash = 'synthetic-unused-hash-no-login'`, which always fails `POST /api/v1/auth/login`.
3. **Cookies and CORS are set for loopback HTTP:** `deploy/hostinger-pilot/pilot-start.mjs` sets `CORS_ORIGIN='http://127.0.0.1:15440'` and `COOKIE_SECURE='false'`.
4. **No DNS `A` record for `thaara-v2.quantumweaveai.io`:** The owner selected `thaara-v2.quantumweaveai.io` for planning; the `A` record to `76.13.217.50` and the Traefik HTTPS router have not been applied yet.

---

## Proposed architecture (minimal, isolated, reversible)

### Option A (Recommended): Public HTTPS via existing VPS Traefik (`https://thaara-v2.quantumweaveai.io`)
1. **Single-origin web + API container:**
   - Extend the pilot image build so `@thaara/web` is compiled (`apps/web/dist`) and served as read-only static assets by the pilot Fastify server (`/` and SPA routes), while `/api/v1/*` serves the existing governed API on the same origin.
   - Because UI and API share `https://thaara-v2.quantumweaveai.io`, session (`thaara_session`, `HttpOnly`, `Secure`, `SameSite=Lax`) and CSRF (`thaara_csrf`, `Secure`, `SameSite=Lax`) cookies work natively with `CORS_ORIGIN=https://thaara-v2.quantumweaveai.io` and `COOKIE_SECURE=true`.
2. **DNS (`quantumweaveai.io`):**
   - Add one DNS record only: `A` `thaara-v2` -> `76.13.217.50` (TTL `300`).
   - Do **not** touch root `@`, `www`, `ftp`, `send`/`rsend`, `TXT`, `DKIM` or `DMARC` records.
3. **Traefik HTTPS routing (without restarting n8n or legacy Thaara):**
   - Read-only inspect the existing Traefik container labels/network on VPS `1871828` first to confirm its certificate resolver name and external Docker network.
   - Expose only the pilot container's port `3002` to Traefik via Docker labels for `Host(\`thaara-v2.quantumweaveai.io\`)` with TLS enabled. Keep PostgreSQL and Redis on the internal `thaara-v2-pilot-data` network with zero host ports.
4. **Owner login password (secret-safe):**
   - Add a one-time owner password helper script (`/opt/thaara-v2-pilot/thaara-owner-password.sh`) that the **owner** runs in the Hostinger terminal.
   - It reads a password from `/opt/thaara-v2-pilot-private/secrets/owner_login_password` (or prompts silently with `read -rsp`), hashes it with Thaara's `scrypt` (`hashPassword`), and updates only the single pilot owner row in `thaara_vps_pilot.public.users` (`pilot-owner-10812@thaara-pilot.invalid`), revoking any prior sessions.
   - The password is never typed into chat, logs or Git.

### Option B (Zero-DNS / Local SSH Tunnel Alternative)
If you prefer to test the browser UI immediately **before** adding a public DNS record or Traefik route:
- We build the same web+API pilot image (with `apps/web/dist` served on `127.0.0.1:15440`), set the owner password via the private VPS script, and you open `http://localhost:15440` on your Windows PC over an SSH port-forward (`ssh -L 15440:127.0.0.1:15440 ...`).

---

## Security guarantees preserved

- **WhatsApp sending remains OFF by default** (`THAARA_WHATSAPP_SEND_ENABLED=false`). Approving a reply in the browser saves and reserves the reply as **"Prepared, not sent"** unless a separate controlled send window is explicitly enabled and approved by the owner.
- **No n8n changes:** Inbound `ezIrlr7y9dEowujw` and outbound `RrqXTplIBXginMSD` are untouched; `WhatsLearn` and all other workflows are untouched.
- **No schema migration:** Uses the existing `public.users`, `public.sessions`, `public.workspaces`, and `1083` WhatsApp durable tables.
