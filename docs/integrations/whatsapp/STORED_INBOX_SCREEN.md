# Stored WhatsApp inbox screen — 27 October 2026

Implemented the next complete read-only feature under the same master task: owner-scoped account discovery and a stored-conversation panel in the existing WhatsApp screen. No real send/receive/provider call, workflow change, credential creation/replacement, service start/restart, SQL execution, migration, commit, push or deployment.

## Behavior and security

- Authenticated GET `/api/v1/connectors/whatsapp/n8n/durable/connections` calls `DurableWhatsAppService.connections()` and real `PostgresWhatsAppStateStore.listOwned()`. Session/workspace/owner/role are checked before/after the scoped SELECT; RLS remains mandatory. Binding must match its actual SQL connection_id and revision/owner. Only connectionId/revision/disconnected metadata is returned; no credential, owner/session hash or raw recipient address. At most20 connections; overflow fails unavailable rather than silently truncating.
- Shared catalog schema and browser-safe interpreted Value.Check predicates live in the existing leaf contracts module. Frontend consumes that browser-safe leaf directly, avoiding the contracts root's Node-only exports and any new dependency installation. No eval/TypeCompiler browser validator.
- `whatsapp-stored-inbox.ts` validates catalog/message payloads, exact connection/revision, explicit offline/verified=false flags, masked contacts, dates, cursors and duplicate IDs. Fixed same-origin read endpoints, cookie authentication, abort signals and no-store. Search is bounded literal text; existing server logging strips query strings. No tokens in requests/URLs/body.
- State model aborts previous requests and fences late completion after search/account/filter changes or disposal. Private message data is cleared immediately on context changes and on errors. Access revocation also clears catalog/selection. No automatic retry after409; user refreshes. Pages append without duplicates, total bounded2000, and repeated/backward/cross-snapshot next cursors are rejected.
- StoredWhatsAppInbox is keyed by the existing authenticated workspace/user/role subject. It provides discovered inbox selection, conversation selection, search, refresh, timestamps in the existing workspace timezone and load-more. Labels say Test data / Sending is disabled; outgoing reservations say Prepared, not sent. No compose/send controls, fake fallback messages, unread claim or verified provider outcome. Message text is React-escaped. Existing mock screen remains under Demo inbox (offline foundation).
- Empty/unconfigured/disconnected/unauthorized/stale/unavailable states are explicit. This source binding is not proof of a running server, populated development schema or actual WhatsApp history.

## Verification

Initial repository discovery regression failed for missing listOwned; frontend suite failed for absent client/view. A later catalog key-mismatch regression failed before SQL-row/binding correlation was enforced. Repeated-cursor regression failed before monotonic snapshot cursor checks. No existing assertion weakened or skipped.

Final focused run: **184/184 across14 files**, zero failures/skips, exit0, 38.20s. Includes16 new web client/model/static-view cases,18 repository boundary cases,5 inbox HTTP cases,11 inbox projection cases, existing durable/bridge/transport/HTTP and Gmail/Calendar/auth/session/integration UI regressions. The new catalog HTTP test uses synthetic auth and a transactional fixture; repository tests inspect queries rather than execute PostgreSQL.

Contracts build, DB build, API build and final API typecheck passed; final web build (TypeScript + Vite) passed, 4.98s Vite stage. No runtime dependency or lockfile change. An offline install attempt requested module purge; it was not confirmed or forced, and the implementation reused existing dependencies instead. Existing modules and private fixture cache remain present; package/lock diffs clean.

One targeted source review found no additional consequential defect beyond the catalog correlation issue already corrected. Review identified an evidence gap: tests render the view statically and exercise the model, not a mounted React browser. **Mounted controls/account remount/effect cleanup, real browser/CSP behavior and PostgreSQL catalog RLS/session-revocation runtime acceptance remain unverified.** No browser preview is claimed. App services were not started and new SQL was not applied to existing databases.

Earlier941/941 full regression remains historical same-day baseline for unchanged areas, not a fresh full run of this new screen revision. Focused coverage was broadened to affected API/repository/UI/security/Google areas; no duplicate aggregate test count claimed. Historical21 PostgreSQL acceptance does not certify the new catalog query.

## Continuation

Next: production machine callback authentication/service-principal/RLS design, managed directional secret references/lifecycle, durable callback/dispatch wiring, LIVE-mode admission and authenticated owned-HTTPS connectivity. Then Meta eligibility/asset/version/signature/subscription checks, Chat commands/approvals and permitted media. Prepare concrete reviewable changes before requesting new schema/infrastructure/deployment/secret provisioning approval. Keep workflow activation and real-message pilot separately gated. Owner's tested credentials remain recorded; do not request recreation from sanitized metadata omission. Continue same master task without a new prompt per phase or background-work promise.
