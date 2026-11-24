# Thaara AI V2 — handoff from Claude Code to Codex (28 Oct 2026)

Read first: `AGENTS.md`, `docs/THAARA_PROJECT_HANDOFF.md`, `docs/THAARA_DAILY_HANDOVER_2026-10-27.md` (newest entries at the top), and this file. Continue the **same WhatsApp Master Task**. Do not restart or recreate anything.

## Git

- Branch `dev-thaara-continuation`. Local commits (not pushed): `f6553cb` (WhatsApp pilot + first real inbound), `d6331e0` (108.14/108.15 reply preparation from inbox and Chat).
- **Uncommitted (review, then commit with owner approval):** the 108.16 send-gate work.
  - Code: `apps/api/src/services/whatsapp-durable.ts` (send profile, `sendAllowed`, hand-over after commit), `apps/api/src/services/whatsapp-pilot-dispatch.ts`, `apps/api/src/app.ts` (`whatsappSend` option), `packages/contracts/src/whatsapp-n8n.ts` (`dispatchEnabled: Boolean`).
  - Pilot deploy files: `deploy/hostinger-pilot/{pilot-config.mjs,pilot-start.mjs,compose.send.review.json,pilot-send-enable-10816.sh,pilot-send-disable-10816.sh,pilot-send-cli.mjs,thaara-send.sh}`.
  - Tests: `apps/api/test/whatsapp-pilot-send.test.ts`, `scripts/hostinger-pilot-db.test.ts`, `scripts/step10812-seed.runtime.test.ts`, plus `.gitattributes` (LF for `deploy/hostinger-pilot/**` and `docs/migrations/*.sql`; `packages/db` migrations intentionally left CRLF).
  - Docs: `docs/tasks/108.16-*`, `docs/integrations/whatsapp/CONTROLLED_SEND_*`.
- Last test evidence: regression 392/392 (30 files); real PostgreSQL harness 9/9 (`node scripts/step10812-seed-acceptance.mjs --approved`); pilot guards 14/14.

## Accounts and infrastructure (verified)

- **n8n:** `https://n8n.srv1871828.hstgr.cloud`, Owner user "Quantumweave academy" (quantumweave26@gmail.com), project `fn6pQNcDpG7hLM3t`. team.quantumweaveai is the Google/Claude account only. **Touch only** inbound `ezIrlr7y9dEowujw` and outbound `RrqXTplIBXginMSD`. Never touch WhatsLearn or other workflows.
- **n8n credentials (Thaara):**
  - `Thaara WhatsApp Trigger` (CEmMGaOs1xn21s1k)
  - `Thaara WhatsApp Test` (Ub44cxSJarXiuVBb, the send token)
  - `Thaara Pilot Relay 10812` (9HD0gaPEC54utMLN, relay bearer)
  - `Thaara Dispatch Webhook` (utwjoeN0Hf9FD94O, header `X-Thaara-Dispatch`; its secret was shredded at switch-off, so the next enable creates a new one that the owner must paste again with `cat …; echo`)
- **VPS** srv1871828 (76.13.217.50). Dedicated key "THAARA AI V2" (DPAPI-protected under `%USERPROFILE%\.codex\credentials\thaara-ai-v2-vps1871828`). Host key `SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4`.
- **Pilot** `thaara-v2-pilot` (API, Postgres, Redis):
  - API reachable as `thaara-pilot-api:3002` on `n8n_default` (live attach; the pilot joins n8n's network; **never attach n8n to another network**, see the incident doc).
  - Current API image: send-capable `sha256:475db13d…999f`, running with **send OFF** (`THAARA_WHATSAPP_SEND_ENABLED=false`).
  - Relay key is events-only (expires 2026-11-25).
- **WhatsApp Thaara number:** +91 91879 51539, Phone Number ID 1402873856243129, WABA 1150709394191450. Pilot connection `wa_pilot_meta_test_10813b`; the only allowed recipient is the owner's phone (`owner_test_phone`, verified in the Meta "To" list). The meta app is 1691352712358994.

## What works (verified live)

- **Inbound:** a real WhatsApp text → Meta → n8n inbound workflow (active) → private link → pilot relay 200, stored once (108.13b).
- **Locally:** reply preparation with approval from the inbox (108.14) and Chat in English, Kanglish and Kannada (108.15); the send gate and pilot transport (108.16).

## Current blocker (controlled send test, 108.16/108.16b)

- Thaara side fully passed: approval, hand-over 200, claim 200, profile/window/cap checks.
- **Meta refused at the n8n WhatsApp send step with "Authorization failed - please check your credentials".** The token in the n8n credential **"Thaara WhatsApp Test"** is not accepted (wrong, expired, or not for app 1691352712358994 / WABA 1150709394191450, or the system user lacks the asset or `whatsapp_business_messaging`).
- **Nothing has ever been sent.** All attempts are recorded in `docs/integrations/whatsapp/CONTROLLED_SEND_RETRY_APPROVAL.md`.
- **Everything is switched OFF (verified 28 Oct ~05:5x UTC):** outbound workflow unpublished, never-send gate restored, send and webhook nodes disabled; VPS send-off, relay events-only, send secrets shredded.

## Next steps

1. **Owner:** in Meta Business Settings → System users, generate a permanent token for app 1691352712358994 with `whatsapp_business_messaging` and `whatsapp_business_management`, with WABA 1150709394191450 assigned. Paste it into the n8n credential "Thaara WhatsApp Test" (Access Token, Business Account ID 1150709394191450) and save. n8n should show "Connection tested successfully".
2. **New owner approval** for one more controlled send, then:
   - run `deploy/hostinger-pilot/pilot-send-enable-10816.sh` (adjust `maxPerDay` if earlier claims fall within 24 h) and `n8n-link-v2.sh`;
   - the owner pastes the new dispatch secret into "Thaara Dispatch Webhook";
   - run the safe fake-ID probe;
   - in the outbound workflow, remove only the never-send condition, enable the webhook and send nodes, and publish;
   - the owner sends "hi", then runs `bash /opt/thaara-v2-pilot/thaara-send.sh prepare "…"`, then `approve <id>` (the output includes a sanitized Meta error);
   - verify the claim, provider message ID and sent/delivered status;
   - **switch off immediately:** unpublish, restore the gate, disable nodes, run `pilot-send-disable-10816.sh`, re-link.
3. **Security:** keep n8n execution saving **off** on the outbound workflow (failed run 39172 captured webhook headers). The owner should delete executions 39172 onwards.
4. **After a verified send:** delivery-status UI check, hosted UI and login for the pilot (needs approval), contact names for "reply to Ram", media, truthful LIVE-mode labelling (stored rows still say `offline_test`), renewing the relay principal before 2026-11-25. Then the Master Builder priorities (Agents SDK, phone, Chat modernisation…).

## Rules learned this session

- PowerShell strips quotes when passing to bash: run remote steps from LF script files (`ssh … bash -s < file`).
- Remote steps were run via a scratchpad helper that decrypts the key to a temp file and deletes it. Never print keys or secrets.
- `n8n-link.sh` is blocked (it caused a public n8n outage). Use `n8n-link-v2.sh` only.
- Active n8n workflow edits need a re-publish. Record owner approvals verbatim, and never exceed the approved scope.
