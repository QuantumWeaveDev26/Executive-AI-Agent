# Authenticated durable WhatsApp inbox — 27 October 2026

Read-only backend feature under the same master task. Existing WhatsApp UI/mock endpoints, Gmail/Calendar and Vite proxy preserved. No frontend/LIVE/provider outcome claimed.

## Endpoint and source

`GET /api/v1/connectors/whatsapp/n8n/durable/:connectionId/inbox`

Requires an actual signed-in user session via existing auth middleware. A relay Bearer token is not user authorization. Request scope is derived once by the server; route/domain/store keep explicit workspace/user/session and policy/RLS checks. The route is wired in buildApp to the existing real PostgresWhatsAppStateStore; no new database connection, privileged pool, migration, seed data or automatic configuration. If schema/storage is absent, responds safely with503. No new POST/PUT/DELETE route or external transport.

Query: optional literal `query` (max256 characters), `recipientId` (existing bounded identifier), `pageSize` (1–50, default20), `pageToken` (bounded snapshot cursor). Unknown query fields, including workspace/user claims, are rejected before schema stripping. English/Kannada/mixed text uses Unicode normalization and literal substring matching, never a user-supplied regex.

Shared TypeBox contracts: N8nWhatsAppInboxQuerySchema and N8nWhatsAppInboxSchema in the existing WhatsApp n8n contracts file. Response has mode=offline_test, verified=false and liveSendingEnabled=false. Messages/conversations derive only from persisted state supplied by the scoped repository; empty state remains empty. No account-connected flag or LIVE label is fabricated.

Inbound messages show received. Outgoing reservations show reserved; consumed claims/uncertain receipts show unverified, and stored synthetic statuses remain explicitly offline/unverified. These are sanitized previews, not a claim of full original body/media retention. Contacts are masked; raw addresses, approval records/hashes, credentials and session hashes never enter the response. Provider IDs/recipient IDs remain owner-scoped references. No unread count or mark-read behavior is invented.

Conversation counts/summaries reflect matching filtered messages across the bounded snapshot; messages are newest-first with a deterministic ID tie-break, then paginated. Cursor binds to authenticated owner/workspace, connection/revision, filters, page size and matching data snapshot. Cross-scope/stale/filter-altered cursors cannot select another dataset and are rejected with409. This hash enforces consistency, not authorization; all authorization is repeated independently. On409, clients should refresh the first page.

Reads do not mutate connector state or create connector audits. Existing auth middleware may update session last-active as it already did. Existing repository transaction locks/revalidates scope before and after projection. Generic storage failures return a sanitized unavailable response and no raw SQL/provider/credential details.

## Tests and limits

Test-first domain and HTTP suites initially failed for absent implementation. Clock-sensitive synthetic approval tests use their explicit fixed date. New focused result: **15/15**, two files, exit0, 19.99s. Covers empty/no fabrication, stored inbound/outbound mapping, consumed-claim status, literal Kannada/English search, pagination/deduplication/stale filters, owner/tenant/viewer/session denial, bounded/unknown input, disconnect fencing, no connector writes/audits, no secret/raw-recipient exposure, user-session delegation, bearer rejection, no-cache, no write route, missing storage and generic errors.

Independent read-only security review found no consequential defect in the read surface. It did not run tests or certify authenticated PostgreSQL HTTP integration. New domain/HTTP tests use an explicitly labelled transactional double and synthetic auth. Historical21 PostgreSQL cases establish earlier store/RLS behavior only. Current disposable fixture is stopped and was not restarted; no new SQL executed in this milestone. Do not claim this route has been exercised against PostgreSQL, in a browser, or against hosted n8n.

Milestone coverage: **941/941 tests across82 files**, zero failures/skips, completed in partitions after the original verify process ended without a final summary. Build/lint/typecheck passed. Original command exit1 is not relabelled a pass:23 complete passing files/298 tests were retained, then59 remaining unchanged files passed in bounded batches220+246+177, all exit0. JSON reports and repository test-file inventory confirm complete coverage without duplicates or omissions. See [27 October handover](../../THAARA_DAILY_HANDOVER_2026-10-27.md). Only existing approved in-memory fixtures ran; no new SQL/runtime suite, actual provider call or browser preview. The15 new cases are included in941, not additional tests.

## Next connection work

Add frontend binding to these contracts with honest empty/unavailable/offline states, then secure machine callback principal/RLS/profile/managed-secret admission. Existing session-token-only repository authorization must not be bypassed or supplied a fabricated session hash. No sender/receiver traffic, activation, real-message pilot or production schema/configuration/restart until separately reviewed and explicitly authorized. Owner credential setup is recorded as completed/user-tested; sanitized connector omission is not proof of missing assignment. No user action is required for this local read feature.
