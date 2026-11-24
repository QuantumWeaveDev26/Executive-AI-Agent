# Phone calling — runtime configuration, callback security and database recovery (30 Oct 2026)

Local preparation only. No database, server, provider, credential or phone call was touched. Follows the 8/8 disposable PostgreSQL
acceptance ([handover](../../THAARA_DAILY_HANDOVER_2026-10-30.md)).

## A. Secure runtime configuration (implemented, not wired into startup)

`apps/api/src/services/phone-sarvam-runtime.ts` — `loadSarvamRuntime(env, files)`; tests `apps/api/test/phone-sarvam-runtime.test.ts`.

| Setting | Source | Rule |
|---|---|---|
| `THAARA_PHONE_LIVE_CALLING` | environment | anything except exactly `approved` = off; no file is read |
| `THAARA_SARVAM_PROFILE_FILE` | non-secret JSON (ids, version, number, limits) | must say `reviewOnly:false`, `runtimeProfile:true`; ids safe; version integer; number `+91…`; **`verifiedMaxCallLengthMinutes` must equal `requiredMaxCallLengthMinutes`**; variable mapping exactly `call_purpose`→purpose, `user_name`→recipient name |
| `THAARA_SARVAM_API_KEY_FILE` | private file | absolute path; verified0400/0600 (unknown/null/noninteger metadata refused before reading); ≥8 chars, no spaces |
| `THAARA_SARVAM_WEBHOOK_SECRET_FILE` | private file | same; ≥32 chars |
| `THAARA_PHONE_CALLBACK_ORIGIN` | environment | `https://` DNS-name origin only, no path/port/credentials; IP literals and local/single-label aliases refused without DNS/network access |
| `THAARA_PHONE_DAILY_CALL_LIMIT` | environment | 1–20, default **5** for first live use (owner decision, 31 Oct 2026) |

Secrets are re-read and re-checked on every use (rotation without restart; a file made world-readable or deleted fails closed). Results
contain reason codes only (`duration_not_verified`, `secret_file_permissions`, …), never values. The checked-in review profile
(`sarvam-existing-agent.review.json`) is refused as-is (`profile_not_runtime`, `duration_not_verified`) — by design.

31 Oct hardening: unknown permission metadata no longer bypasses the live-file check; only verified0400/0600 is accepted (regular-file Stat
mode equivalents supported). Local/abbreviated/numeric IPv4 and IPv6 callback literals are rejected along with local aliases. Syntax validation
does not prove a hostname resolves publicly; DNS/TLS/proxy/logging verification remains a separately approved deployment gate. No real files read.

**31 Oct startup wiring (local code, not deployed):** `phone-pilot-startup.ts` calls this loader and `pilot-start.mjs` uses it. `THAARA_PHONE_DURABLE=approved` enables the installed tables with calling
off; `THAARA_PHONE_LIVE_CALLING=approved` adds live dialing only if every check passes; a refusal logs reason codes and leaves calling off with the API up. buildApp accepts a live provider outside tests only if
this loader created it. Provider report voice stays refused outside tests. `pilot-sarvam-key-entry.sh` is the owner's private entry for the key; it also generates the webhook secret and installs
`sarvam-runtime-profile.pilot.json`, whose five-minute value rests on the owner's dashboard confirmation, not a provider API read. Nothing is active until a separately approved deployment.

## B. Callback and result security review

| Control | Status (code) | Residual risk / note |
|---|---|---|
| Private callback token | HMAC(call id, server-only secret), timing-safe compare | Token is in the URL path: proxy/APM/access logs must not record paths (app logs already redact). Verify Traefik before go-live. |
| Correlation to the exact attempt | attempt id must equal the id Thaara dispatched; echoed `thaara_call_id` must match | Sarvam signs nothing: a leaked capability URL could post a fabricated result first. Results stay "unverified"; owner can run **Check provider result**. |
| Replay | event ids derived from attempt; duplicates ignored; conflicting replays rejected; illegal state moves ignored | — |
| Interaction ids | opaque ids incl. `YYYYMMDD/…` date/slash form accepted in adapter, contracts, ledger and 110c SQL | — |
| Transcript access | recipient lines only; owner/workspace RLS; audit never stores words | Webhook text is Sarvam's English (`en_text`); provider read returns original-language text — they cannot be auto-compared. |
| Authenticated reconciliation | owner-triggered, fixed Sarvam origin, two GETs max, exactly one matching outbound attempt of the pinned version, 256 KB cap, no retry | Recipient phone number is not cross-checked (field not documented). |
| Unknown outcomes | recorded as unknown; never redialled; Chat says to check history | — |
| Spend/duration | daily limit in claim transaction (default **5** in code and runtime config, owner decision 31 Oct); agent Max call length 5 min | Provider-side 5 min must be **verified** in the account before the profile can load. |

## C. Database recovery readiness (plan; nothing executed)

1. **Backup before any change:** `pg_dump --format=custom` of the pilot database from inside the PostgreSQL container to a root-only
   directory on the VPS, plus `pg_dumpall --globals-only` (roles). Record size and SHA-256.
2. **Verify the backup in isolation:** restore into a fresh disposable PostgreSQL 16 container (no network, loopback only), compare table
   row counts for the existing data (users, conversations, approvals, Gmail/Calendar/WhatsApp tables) with the source, then destroy it.
3. **Order:** 110a → 110b → 110c, each in its own transaction with its approval settings; stop at the first error. All three are
   additive (new tables, functions, one role, column-scoped grants); no existing row is rewritten.
4. **If a phone migration fails:** the transaction rolls back by itself; fix forward with a reviewed new artifact. Do not restore the
   full backup for a phone-only failure.
5. **No automatic downgrade:** no 110c rollback artifact exists. The older 110a/110b rollback files do not form a verified recovery chain after
   110c (roles, functions, callbacks and grants also need review). Disable calling and preserve evidence; use a separately reviewed forward repair.
   Never run DROP CASCADE or a schema downgrade based on this plan.
6. **Never** restore an older full backup over the shared pilot database unless the owner explicitly accepts losing everything written
   since (Gmail, Calendar, WhatsApp, chats). Prefer restoring to a side database and copying back only what is needed.

31 Oct clarification for the pending backup approval package: source data and role metadata remain private on the VPS. Dump globals with
`--no-role-passwords`; never print dump contents, role hashes, connection strings or credentials. Restore only into a newly owned network-disabled,
temporary container via local exec/stdin; attach no existing volume and publish no port. Use a consistent snapshot/baseline for source counts:
comparing a restored snapshot with later live counts can falsely report data loss while Gmail/Calendar/WhatsApp continue writing.
Record only bounded counts, schema inventory, sizes/checksums and owned resource IDs. Cleanup must verify IDs/labels and remove only the
new restore fixture; retain the private backup under the approved retention rule. Exact commands, resolved backup paths and source identities
are prepared in the [exact backup/restore approval package](PHONE_BACKUP_RESTORE_EXECUTION_APPROVAL.md), following the successful host preflight;
execution still requires separate scoped backup/restore approval. The owner's
telephony/cap/balance confirmations are now recorded; do not ask to repeat them. Nothing in this document authorizes execution.

## D. Provider compatibility (official docs vs our account)

| Capability | Documented | Verified on our account |
|---|---|---|
| Instant Outbound API, agent id + version, connection, from-number | yes | no (no outbound call yet) |
| Per-call input variables (`agent_variables`) | yes | `call_purpose`, `user_name` tested in the browser only |
| Max call length per agent version (≤60 min, agent hangs up) | yes | owner reconfirmed5min on31 Oct; not independently verified |
| Completion webhook payload | yes, unsigned | no |
| Analytics attempts + transcripts read | yes | inbound transcripts seen in the dashboard; API read not tried |
| Outbound telephony eligibility | account-specific | owner confirmed healthy Vobiz number/connection and inbound_outbound deployment bound to committed v2 on31Oct; no changes needed |
| Instant Outbound endpoint/key permission | workspace API key required; policy controls depend on org plan | not independently established by telephony status/public docs; no live request or credential inspection |
| Billing | historical documented rates; recheck before any spending approval | owner confirmed prepaid balance31 Oct; amount/top-up policies not independently checked |

## E. Approval boundaries (each needs an explicit, scoped "yes")

1. Owner has confirmed telephony inbound_outbound/v2,5-minute cap and prepaid balance. Specific Instant Outbound workspace/key permission remains
   unverified without account/admin evidence or a separately approved controlled request; no new agent, number, campaign or key needed for preparation.
2. Create the private secret files on the VPS (owner pastes values there, not in chat).
3. Backup + isolated restore check of the pilot database.
4. Persistent install of 110a–110c.
5. Live-switch code change (loader at startup) + reviewed deployment, calling still off.
6. One own-number test call (daily limit 5; the approval still covers only that one call).
