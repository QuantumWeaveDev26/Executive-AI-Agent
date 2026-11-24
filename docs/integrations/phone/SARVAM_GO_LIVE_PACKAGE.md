# Sarvam calling — go-live package for one controlled call (DRAFT for owner approval)

Status (30 Oct 2026): **live setup/deployment/calling not approved or executed.** Isolated local PostgreSQL acceptance has completed8/8;
this remains a preparation checklist, not yet an executable live approval package.
Consolidate the sensitive actions into one exact scoped owner request once its artifacts, IDs, isolation and recovery steps are ready.
Earlier approvals (voice tests, commits, libraries or WhatsApp infrastructure) do not authorize this phone deployment or call.

## Verified provider facts (official Sarvam docs, read 30 Oct 2026)

| Control | Fact | Consequence |
|---|---|---|
| Call duration | Agent setting **Max call length**, minutes, up to 60; "the agent wraps up and hangs up" | Hard provider cap — must be set on the Sarvam agent (owner). Thaara's `thaara_max_duration_seconds` variable remains advisory. |
| Cost | ₹3.50/min pay-as-you-go (excl. GST), rounded up per 60 s; Sarvam telephony ₹0.20 per 30 s; number ₹59/30 days | Recalculate the controlled-test budget for the selected five-minute maximum at approval time; the old two-minute estimate is superseded. |
| Unanswered calls | "Only calls that connect are charged"; voicemail counts as connected | Busy/no-answer/failed attempts cost nothing. |
| Spending exposure | Self-serve plans use **prepaid credits** | Verify the actual plan, shared account usage, renewals and any automatic top-ups. A small balance alone is not evidence of an enforced per-call spending cap. |
| Webhook security | No signature/secret documented | Thaara uses per-call capability URLs; results stay "unverified". |
| Number expiry | If credits cannot renew the number it is released, campaigns/deployments cancelled | Keep ≥₹59 headroom while testing. |

Thaara-side controls already in code: one approval = one dispatch; **daily live-call limit (default 5/24 h by owner decision 31 Oct, max 20) enforced in the
claim transaction under a per-owner lock**; consent + contact-binding re-check; no automatic retry; unknown outcomes never redialled.

Official sources rechecked 30 Oct: [pricing](https://docs.sarvam.ai/voice-agents/pricing),
[conversation settings](https://docs.sarvam.ai/voice-agents/build/conversation-settings).
The displayed cost estimate excludes number rental, report TTS, taxes and any other account usage; it is not a guaranteed bill.
Provider capability is documented, but the owner's actual published agent settings are not yet verified.

## Gate 1 — Owner Sarvam setup (owner does this in the Sarvam dashboard)

**Actual confirmed setup:** existing agent **Thaara AI Voice Assistant**, committed numeric version **2**, Chaitra, English/Kannada/Hindi,
Sarvam Managed (Vobiz) number **+918064269780**, active inbound deployment and owner-reported real inbound acceptance. Preserve all of it.
Existing connection ID `255c00af-3e-542ffe50-6043` is owner-supplied and recorded in the review profile; provider access remains unverified.
31Oct owner update: existing Vobiz connection/number active and healthy, deployment `inbound_outbound` bound to committed v2; no telephony changes
needed. The individual Instant Outbound adapter is preserved; no campaigns/cohorts. Specific workspace/key endpoint permission remains unverified
by public docs alone. See [contract review](SARVAM_INSTANT_OUTBOUND_CONTRACT_REVIEW_2026-10-31.md) and [next preflight approval](PHONE_BACKUP_RESTORE_APPROVAL_2026-10-31.md).
Do not create another agent, number or connection merely to follow this checklist.

**Owner duration decision:** outbound approval drafts may use **five minutes**, matching existing v2. Preserve the active inbound version;
no new version/agent is needed to pursue a two-minute target. Local Sarvam configuration must declare `enforcedMaxDurationSeconds:300`;
the duration is included in the profile fingerprint and each exact approval, and mismatched shorter/longer drafts are refused.
Actual provider cap still needs version-specific verification before activation. This decision does not authorize deployment or outbound calls.

See *USER SETUP REQUIRED* in [SARVAM_CALLING.md](SARVAM_CALLING.md). Required settings on the "Thaara" agent: chosen female voice;
Preserve the existing English/Kannada/Hindi agent, Chaitra and its tested instructions; **Max call length = 5 minutes**; verify nudges with
**Hang up after unanswered nudges = on**; a committed version. One rented number with KYC complete; small prepaid balance.
Thaara needs only non-secret ids (org, workspace, app id + version, connection id, last 4 digits of the number).
Confirm these settings belong to the exact committed version used by the API. Disable call transfers, external tools and campaigns
for the controlled test; do not infer their permission from a call approval. Check existing setup before buying anything or creating keys.

## Gate 2 — Database (persistent migration)

Install reviewed SQL in order on the pilot PostgreSQL, each in its own transaction with its approval setting:
`110a-phone-contacts` → `110b-phone-calls` → `110c-phone-live-mode`. Pre-step: private database backup with isolated restore verification.
**No 110c rollback artifact exists.** The existing 110a/110b destructive rollback files are not an approved or verified recovery chain
after 110c: callback functions, role, grants and altered policies also need consideration. Never run them automatically or use DROP CASCADE.
Default incident response: disable calling and preserve data/evidence; use a separately reviewed forward repair. A schema downgrade or
restore must have its own reviewed, tested procedure and owner authorization; never restore the shared pilot database over newer Gmail,
Calendar or WhatsApp data. Recover a backup into isolation first. Recovery readiness remains a deployment blocker.

Actual local PostgreSQL16 acceptance is now **8/8 passed,0 failed/skipped** in one separately approved disposable run: unchanged110a–110c,
restricted-role/forced RLS, owner/workspace isolation, independent-service competition for the last slot/no replay dial, fresh-pool persistence/
rolling window, archived-contact fence, audit rollback, callback binding and review-ack refusal. All source/base hashes and actual isolation
checks passed; fresh tmpfs-only container/internal network cleaned and removal/destruction/loopback15435 independently verified.
See `THAARA_DAILY_HANDOVER_2026-10-30.md` and local cache `phone110-runtime/acceptance-v1-evidence.json`. No persistent phone schema installed.
Local acceptance does not authorize a shared database migration or prove live provider behavior; backup/restore/recovery gates above remain.
Pin exact SQL checksums before requesting approval and before execution; this document authorizes no SQL or infrastructure.

Review-artifact SHA256 snapshot (30 Oct; any file change invalidates its pin):

| File under `docs/migrations/` | SHA256 |
|---|---|
| `110a-phone-contacts.review.sql` | `7c2066959edd4b129751bf858e31af1dbed5ae9b300226597e4ce4e160c06a8e` |
| `110b-phone-calls.review.sql` | `1030cd5b9d2015cad94221cce19c34699fa049b541606f9b081f65f6acc5aa6e` |
| `110c-phone-live-mode.review.sql` | `479c06d456577a120a95382b25f29d703366ac624dcae71f1d4839e346a67b5d` |

The prior 110c pin `6479f058…` is superseded by the reviewed date/slash-ID compatibility edit. No persistent or production SQL was executed.

## Gate 3 — Secrets and configuration (owner enters secrets privately)

| Item | Where | Never |
|---|---|---|
| Sarvam API key | root-only file on the VPS (same pattern as the WhatsApp secret files), read at startup | chat, Git, logs, image |
| Webhook secret (≥32 random bytes) | generated on the VPS by a script, root-only file | chat, Git, logs |
| Non-secret ids, daily limit (start at **1**), callback origin `https://thaara-v2.quantumweaveai.io` | pilot environment config | — |

31 Oct: startup loader written and locally tested (`phone-pilot-startup.ts`, `pilot-start.mjs`), not deployed. It binds agent version 2 and the 300-second maximum from the pilot profile; drafts must match them.
The five-minute value rests on the owner's dashboard confirmation, not a provider API read. The secret files do not exist on the VPS yet.

31 Oct Gate 2 status: 110a/110b/110c are installed on the pilot and post-verified, with a verified backup. See [execution record](PHONE_MIGRATION_110_APPROVAL.md).

## Gate 4 — Callback ingress and logging

The webhook path `/api/v1/connectors/phone/sarvam/calls/<callId>/<token>` contains a capability token. Before go-live verify on the
VPS: Traefik access logs are disabled or exclude/redact that path; no APM/proxy layer records full URLs; application-log redaction
(already in code) is active. Any log that recorded a token makes that call's webhook untrustworthy.

## Gate 5 — Deployment

New pilot image built from the reviewed tree (now includes Phone code and `plivo`, `@fastify/websocket`, `@redis/client`);
recreate only the pilot API container; keep WhatsApp/n8n/PostgreSQL/Redis untouched; record the previous image id for rollback.
Live calling stays **off** after deploy; health checks + one draft-only Chat request ("Call <owner> …" showing the card).

## Gate 6 — One controlled call (to the owner's own phone only)

1. Owner saves themself as a contact with consent; daily limit = 5 (only one test call is approved).
2. Owner types the Chat command, checks the card, taps **Call now** once.
3. Pass criteria: phone rings from the Sarvam number; first words are Thaara's AI introduction with "on behalf of <owner>"; the call
   ends by itself within 5 minutes; Chat card displays the five-minute approval maximum and actual outcome/recipient evidence;
   Play report speaks it; no second dial; audit rows present.
4. Switch live calling back off afterwards until the owner decides on wider use.

## Approval request format (to be sent when Gate 1 ids are known)

One message naming: exact image tag, SQL files and backup location, secret file paths (not values), config values, daily limit,
the single recipient (owner's own number, last 4 digits), the time window, and the rollback commands.
