# Step 85 — Gmail connection and inbox UI

Date: 17 October 2026 (Asia/Calcutta)
Status: COMPLETE
Workspace: C:\ThaaraProjects\thaara-ai-agent-v2
Branch: dev-thaara-continuation
Unchanged HEAD: d3b2921d42e5581c1e1991a7cab5a63261a80b8e

## Implemented

- Added a Gmail screen to the existing dashboard beside the existing connector diagnostics and n8n controls. Uses existing authenticated Gmail APIs, policy/CSRF boundaries and card/toolbar/badge styles; backend services, contracts and routes are unchanged.
- Shows safe connection state, Inbox, search, next-page navigation, message summaries, plain-text preview, refresh and local disconnect. Handles loading, empty, partial-message, error, reconnect and unauthorized states. Owners/admins/members may use the screen; viewers receive an access message and no Gmail requests.
- Real Connect Gmail is always disabled because the existing foundation supports only disabled/mock providers. No browser OAuth launch, Google redirect, credential input or mock-login production pathway was added. Synthetic OAuth start/callback is exercised only by NODE_ENV=test API tests using existing injected mock infrastructure.
- Inbox/search uses an explicit page size of 10. Existing search returns IDs; the browser hydrates at most 10 message reads for row summaries, discards their body fields and performs a fresh read for selected previews. Page tokens stay opaque and are submitted with the committed search in POST bodies. Search strings never enter URLs or local storage.
- Frontend helpers reuse request() cookie authentication and CSRF handling. They reject unsafe IDs, wrong returned IDs, live response modes, missing untrusted markers, excessive pages and invalid fields. Unknown HTML/token fields are discarded before state storage.
- Message subject, sender, snippet, date and body are React text nodes only. No raw HTML, automatic links, remote images, scripts, instruction dispatch, send or compose actions are provided.
- Gmail mount identity includes workspace, user and role. Subject guards, disposal, AbortController and separate list/preview generations discard old status/search/preview responses after context changes, refresh or disconnect. Disconnect clears private content immediately and stays locally cleared on failure. Authorization or reconnect errors clear cached messages; query changes clear prior previews.
- Existing diagnostics remain a separate local-metadata view with their own refresh/timestamps; their API and behavior are preserved.

## Files changed

- apps/web/src/App.tsx
- apps/web/src/GmailScreen.tsx (new)
- apps/web/src/gmail-api.ts (new)
- apps/web/src/gmail-model.ts (new)
- apps/web/test/gmail-screen.test.tsx (new)
- apps/web/test/gmail-api.test.ts (new)
- apps/web/test/gmail-model.test.ts (new)
- apps/api/test/gmail-inbox.test.ts (new)
- docs/requirements-traceability.md
- docs/tasks/085-gmail-connection-inbox-ui.md (new)

## Actual validation

- Browser tests: 29/29 passed in 3 files (6 view/escaping states, 10 HTTP boundary checks, 13 lifecycle/concurrency tests); 0 failed, 0 skipped.
- New synthetic inbox API scenarios: 5/5 passed in 1 file, 0 failed, 0 skipped. Covers mocked OAuth-to-inbox-preview-disconnect, same-workspace user isolation plus workspace isolation, untrusted content and audit redaction, disconnect during a valid delayed read, CSRF rejection and no send endpoint.
- Existing Gmail API/foundation regressions: 40/40 passed in 2 files during the combined focused run. That run initially reported 73 passed/1 failed: a new assertion matched the ordinary word credentials inside allowed email body text. The assertion was corrected to check absence of credential/HTML JSON properties while retaining untrusted text; the corrected new API suite then passed 5/5. No production behavior was weakened.
- Focused web typecheck passed after correcting an overly readonly empty-row reset type.
- Independent static security review: no actionable findings.
- pnpm.cmd verify: PASSED (50/50 test files, 624/624 tests passed, 0 failed).

## Preservation and limits

Starting hashes cover 261 existing files. Preserve all Steps 81–84 uncommitted work; only the existing dashboard mount and requirements traceability are edited. No backend production changes, new migrations, dependency changes, credentials, .env changes, Git writes, real Gmail/n8n calls, sending or workflow activation.

New API integration tests use isolated in-memory PGlite and synthetic OAuth/provider stubs. No PostgreSQL runtime suite, temporary grants or previous permission approval were used. Existing role/session/RLS, PolicyGateway and CSRF assertions remain intact.

Default development/production stays not_configured. Real Google OAuth/provider/refresh, durable Gmail credential storage and live verification remain blockers for actual accounts. The screen displays synthetic mail only when an explicitly injected test backend reports a connected mock subject. Inbox hydration uses bounded reads rather than a new batch/header API; no mail or query history is persisted. Step 74 advanced crash testing and legacy Task 004 remain postponed.

Recommended Step 86: Google Calendar mock connection and read-only agenda foundation, reusing the existing connector security and diagnostics boundaries. Keep real Google access disabled until separately approved.
