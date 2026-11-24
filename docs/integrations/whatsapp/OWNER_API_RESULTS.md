# Durable WhatsApp owner API acceptance — 27 October 2026

PASS for this bounded offline feature in the SAME WhatsApp master task. Full production/LIVE integration remains incomplete.

## Delivered

Connection-qualified durable owner APIs under `/api/v1/connectors/whatsapp/n8n/durable/:connectionId`: GET status, POST dispatches (exact approved reservation only), DELETE connection (audited revision fence). Shared contracts validate the truthful offline status/disconnect responses. Existing `/api/v1/connectors/whatsapp/n8n/dispatches` now uses durable reservation by default; explicit test-only bridge injection remains preserved. Existing unqualified bridge status/history/disconnect are unchanged; use qualified owner APIs for stored connections.

Auth/CSRF, exact approval/draft/idempotency/revision, owner/workspace scope, input bounds/unknown-field rejection, path/draft correlation, no-store and generic errors are enforced. Callback credentials cannot authorize owner controls. No automatic approval, provisioning, provider submission or send path was added. Disconnect fences subsequent callbacks/reservations. No new SQL beyond the separately approved1085 artifact was required.

## Actual verification

- Five new focused owner HTTP cases first failed404 for absent routes, then5/5 passed. A test import typo was corrected before the meaningful RED run. Fixture clock was pinned to its synthetic approval date; no production expiry/policy check was changed.
- Repeat **35/35 real PostgreSQL tests**,2 files, zero failed/skipped, exit0,136.21s. The browser-isolation case in the14-case callback suite was expanded without weakening any assertions: default full API registration, real sessions/CSRF, owner/peer/foreign catalog/status/inbox, reservation/idempotency via both paths, principal callback ingestion and disconnect rejection. Initial35/35 passed before this expansion,55.60s. [Resource identities and SQL pins](CALLBACK_RUNTIME_RESULTS.md).
- **Full non-runtime milestone982/982 tests across87 files**, zero failed/skipped, exit0 in five bounded batches. Batch counts204+242+169+138+229=982; file counts18+18+18+18+15=87. Exact inventory/JSON result comparison verified every non-runtime test/spec file once, no missing/duplicate/unexpected files. Includes Gmail/Calendar scheduling/API/Chat/UI, security, worker and package regressions. Existing authorized in-memory fixture migrations only; runtime SQL suites separately gated above.
- Full workspace build, lint and typecheck passed, exit0. Diff whitespace check passed. Narrow independent static owner-route review found no consequential issue; it did not establish runtime acceptance itself.
- Git-ignored evidence: `node_modules/.cache/whatsapp-1086-inventory.json`, `whatsapp-1086-batch1..5.json` and corresponding logs, `whatsapp-1086-aggregate.json`. Historical941/184/188 results retain their original revisions/scopes and are not counted again.

## Boundaries and next action

No existing database/container/volume, Gmail/Calendar/Vite source, real credential, remote workflow, provider, application service, commit/push or deployment changed in this slice. Actual PostgreSQL work targeted only the approved disposable1085 fixture, retained for approved repeats. Sending remains false/offline; no actual socket listener or browser/provider test acceptance claimed.

Owner confirmed backend unhosted and Hostinger preference subject to suitability. Hostinger MCP is not configured; browser helper initialization failed. [Concrete account-access/hosting gate](HOSTING_CONNECTION_GATE.md) is next, with private owner sign-in and separately approved deployment. Outbound managed-secret/profile/LIVE-mode admission, authenticated public HTTPS, Meta IDs/ownership/signature/version/eligibility and explicitly approved activation/message pilot remain open. UI compose/Chat/media are not certified by these backend controls. [Product readiness](TEST_READINESS.md).
