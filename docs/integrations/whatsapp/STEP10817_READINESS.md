# Step 108.17 WhatsApp readiness — 28 Oct 2026

## Delivered locally

- Pilot configuration now accepts a maximum of 10 attempts per rolling 24 hours; reviewed enable profile writes 10 with the same 24-hour expiry and single recipient. Durable domain already supported 10; its claim/approval/idempotency/audit/consent/revision logic and SQL were not changed for this budget update.
- A new regression admits ten distinct authorized claims, disables an eleventh and refuses every consumed dispatch replay. Failed/uncertain claims remain counted; no automatic resend or reset. The earlier count of three followed earlier explicit caps of 1, 2 and 3; restoring send-off did not erase history.
- CLI error output now retains only recognized outcome labels, supplied numeric error codes and fixed explanatory messages. It never echoes free-form error values or treats workflow-provided `verified:true`/`sent` as proof. Missing numeric codes stay unknown; authentication failures are classified without inventing a Meta code.
- Configuration-only image: `sha256:46605527c350d405a3294f01b0d7ae768666bd390c2020825de4e129e1600fb6`, base `sha256:475db13d15194c7b91506c6fe80acd5c52e37364eea9429e879591a2f5fa999f`, user 1000:1000, original startup command. Overlay copies only pilot-config, CLI, unchanged synthetic seed import and the build acceptance script. **No paused Phone code is included.** Exact local file hashes: `deploy/hostinger-pilot/whatsapp-10817-build-evidence.json`.
- Initial image build exposed a missing CLI import dependency (`pilot-seed.mjs`); the second build includes the unchanged module and passed. Importing it does not execute its separately guarded seed entrypoint. No seed, SQL or provider request was run during the build.
- No image upload or remote configuration change. **The allowance is prepared, not active on the VPS.** Old approval pins and old caps in historical documents are superseded; a new deployment/test approval must identify this image and current scripts.

## Verification

- Final focused WhatsApp: **75/75**, five files, zero failed/skipped, exit 0, 8.00 s. Includes profile max 10/deny 11, one-use claims, sanitizer and executable fake-Docker failure/rollback cases.
- Gmail Chat, Calendar scheduling, WhatsApp Chat/transport/owner controls/inbox: **102/102**, six files, exit 0, 26.63 s. Calendar's nine scheduling regressions pass; existing in-memory fixtures and mocked external adapters only. No LIVE Google/Meta traffic.
- API build and web production build: exit 0; web 309 modules, 3.81 s. Contracts and policy builds passed earlier in the paused Phone work. No full-project regression rerun is claimed.
- Offline image build acceptance: send-off without secret reads, cap 10 accepted, 11 denied, authentication error sanitized and false verification rejected; network none.
- Independent focused static security review: no consequential findings; it did not independently rerun image/provider/runtime validation.
- Git diff whitespace check passed; branch remains `dev-thaara-continuation`, HEAD `d6331e0`; all earlier dirty/staged/paused work preserved, no commit/push.

## Fresh remote read-only evidence

28 Oct 2026 07:39:47 UTC: API, PG and Redis healthy/restarts 0; n8n running/restarts 0 and `n8n_default` only. API uses the receive image `ebac2a93...20d1`, send flag false; principal events-only, enabled, unrevoked/unexpired; temporary send files absent; sender/WABA and exactly one opted-in owner recipient match. Three claims remain in the preceding 24 hours. Outbound `RrqXTplIBXginMSD` remains inactive/version `b83f6a8b...`, hard-false AND server-authorization gate, execution saving all OFF. No remote mutation was performed.

## Exact external blockers

1. **n8n account:** latest owner decision requires team.quantumweaveai@gmail.com before any workflow change. Connector metadata still exposes the dedicated WhatsApp Test credential under `Quantumweave academy <quantumweave26@gmail.com>`, personal project `fn6pQNcDpG7hLM3t`. Searching for the requested email returns no project. Owner must establish access through the requested n8n identity to the same two workflows/credentials and reconnect the connector. No duplication, transfer, sharing change or billing upgrade is authorized/performed automatically.
2. **Meta failure:** previous actual n8n send step reported `Authorization failed - please check your credentials`; no numeric Meta error code was retained. Owner reports a replacement token saved/tested; exact validity, asset grants and permissions have not been independently verified. Do not blame the recipient: owner verified it and the stored binding matches. Metadata cannot prove credential contents or fresh Meta eligibility. No secret values or retained webhook headers were retrieved.
3. **Deployment + one real test:** the new configuration-only image and four scripts (enable/disable/CLI/owner helper) require an updated concrete approval before transfer, API recreation or workflow publication. Verify account, credentials, Meta-use eligibility and customer-service window before a new recipient/text approval. Prior approval cannot execute against the changed account/configuration. No real message is presently authorized.

## Remaining functionality (truthful scope)

Real inbound text was verified in the earlier owner pilot. Durable storage, scoped inbox, one-use approvals/claims and synthetic delivery/read/failure correlation have tests. Inbox/Chat reply preparation (English/Kannada/Kanglish) works locally; hosted UI/login and actual delivered/read receipts remain unverified. Named-contact selection, media/document/audio handling, approved templates and truthful LIVE-mode labelling remain incomplete. Their existing disabled placeholder nodes do not establish implementation. Provider acceptance alone will not establish delivery. Relay principal renewal is required before 25 Nov 2026.

Production must replace development-only numeric caps with approved per-account/provider quotas and abuse controls while retaining per-message approval and durable duplicate protection. This task makes no production limit-policy change.
