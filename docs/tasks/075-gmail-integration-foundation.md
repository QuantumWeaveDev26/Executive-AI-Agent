# Step 75 — Gmail integration foundation

Date: 17 October 2026. Workspace: C:\ThaaraProjects\thaara-ai-agent-v2. Branch: dev-thaara-continuation. Saved HEAD: 4d3fc87bbe5564364bdcbc92e9172ce768c4ab30. Step 74 work is preserved; no Git write operations.

## Scope and implementation

Build the requested OAuth/connection/read-search foundation with mocked providers. Existing authentication, CSRF, typed contracts, PolicyGateway and workspace-scoped audit repository are reused. No dependencies, SQL schema changes, real accounts, sending, or external setup.

- Shared Gmail schemas and six versioned routes:
  - GET /api/v1/connectors/gmail/status
  - POST /api/v1/connectors/gmail/oauth/start
  - GET /api/v1/connectors/gmail/oauth/callback
  - DELETE /api/v1/connectors/gmail/connection
  - POST /api/v1/connectors/gmail/messages/search
  - GET /api/v1/connectors/gmail/messages/:messageId
- Authorization-code flow foundation requests only gmail.readonly, with S256 PKCE and cryptographically random OAuth state. Pending authorization is encrypted, single-use, expires after five minutes and binds workspace/user/initiating session. Superseded, expired, wrong-session and replayed callbacks are rejected before exchange.
- Server-controlled HTTPS redirect; no caller-provided redirect, provider endpoint, mailbox identity, scope or access token. Callback error text is never reflected. Actual token-granted scope must equal the requested read-only scope.
- AES-256-GCM vault uses a dedicated injected 256-bit key and fresh 96-bit IV; authenticated context binds workspace/user/purpose. Store interfaces accept only ciphertext and require atomic take. Neither session secrets nor application tables are repurposed for token storage.
- No durable credential store exists in the current architecture. The foundation therefore has no production provider/store configuration and reports not_configured by default. Explicit mock injection is accepted only under NODE_ENV=test; every mock response is labelled mode=mock. There is no automatically created in-memory production credential store.
- Scoped, policy-gated read/search has bounded query/page/message fields. Results expose selected safe fields and explicit untrusted=true; raw provider objects, credentials and arbitrary fields are excluded. No mailbox data is fed to model instructions or action execution.
- Connection status exposes no account credentials. Expired access tokens require reconnection; automatic refresh is deferred. Disconnect immediately forgets local credentials and pending OAuth state; epoch fencing prevents an earlier start, exchange, or read from undoing disconnect or releasing stale output. Repeated disconnect is safe.
- Mutating route methods require existing CSRF checks. Every connection/read operation uses the policy gateway. Local credential controls have explicit user routes and no model/worker adapters; their narrow local-only writes use approvalMode=none. Read operations require member or higher; connection status may be read by viewers. Email mutation actions are not registered.
- Audit reads/writes use authenticated workspace scope and existing RLS. Audit checkpoints re-resolve the current session and exact workspace/user/role before provider access and before saving tokens/returning mailbox data, blocking mid-request permission revocation. Audits contain mode/outcome/count only, never state, authorization code, token, message body, subject or search terms.
- Request logging omits query strings, protecting OAuth callbacks. Gmail responses set Cache-Control:no-store and Referrer-Policy:no-referrer.

## Validation

Focused command:
~~~powershell
pnpm.cmd exec vitest run apps/api/test/gmail-foundation.test.ts apps/api/test/gmail-api.test.ts packages/policy/test/capability-registry.test.ts --silent
~~~

Result before final verification: 65/65 passed across three files; 0 failed, 0 skipped (28 foundation, 12 API, 25 existing capability registry). API fixtures use only in-memory PGlite and existing migrations; the runtime PostgreSQL/Redis containers were not accessed. Targeted contracts/policy build and API typecheck passed.

Test-first failures reproduced missing implementation and a real delayed-start/disconnect race. Regression coverage now includes epoch invalidation, audit persistence failure before/after provider work, encrypted credential confidentiality, GCM ciphertext transplant refusal, invalid scopes, expired/replayed state, account isolation, parameter validation, callback log redaction, CSRF, RLS audit visibility and authorization downgrade during a provider read. Read-only security review found no remaining concrete defect.

Final pnpm.cmd verify evidence will be appended after its single run. Logs remain ignored under node_modules/.cache/step75/.

## Files

- packages/contracts/src/gmail.ts
- packages/contracts/src/index.ts
- packages/policy/src/registry.ts
- apps/api/src/services/gmail.ts
- apps/api/src/services/gmail-vault.ts
- apps/api/src/routes/gmail.ts
- apps/api/src/app.ts
- apps/api/test/gmail-foundation.test.ts
- apps/api/test/gmail-api.test.ts
- docs/tasks/075-gmail-integration-foundation.md
- docs/tasks/074-database-worker-reliability-testing.md (postponement note)
- docs/THAARA_CONTINUATION_CHECKPOINT.md
- docs/requirements-traceability.md (foundation evidence; live Google Workspace remains planned)

## Limitations and next step

Step 75 implements the mocked integration foundation, not live Gmail. Approved Google OAuth project/consent configuration, managed encrypted durable storage and key lifecycle, real HTTP provider, refresh/revocation behavior, UI connection controls and sandbox verification remain outstanding. Local disconnect does not revoke a Google grant. No Google setup, account access or email sending occurred.

Step 74 advanced PostgreSQL/Redis concurrency/crash-recovery testing and the legacy Task 004 fresh-database lifecycle are explicitly postponed by the user while main features take priority. This does not turn their remaining checks into passing evidence.

Recommended Step 76: implement a durable secret-store adapter and Google provider transport using mocked HTTP tests; request approval before external setup, live account authorization, dependencies or schema changes. Any future model/worker dispatch must reuse existing plan execution, approval/idempotency and verified receipt machinery.

Official protocol references consulted (documentation only):
- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google PKCE authorization flow](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Gmail messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list): gmail.metadata does not support query search; gmail.readonly is the least read-only scope supporting the requested read/search capability.
- [Gmail messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get)

## Final verification — completed

- pnpm.cmd verify ran exactly once and exited 0: build, lint and typecheck passed; 384/384 tests passed across 31 files, 0 failed and 0 skipped. Test phase duration: 1008.14 seconds. Existing database-backed fixtures account for most runtime; no suite was restarted.
- Focused run remains 65/65 passing (including 40 new Gmail checks). Final verification includes those checks and the preserved Step 74 guards.
- git diff --check passed. All 196 baseline files outside the six explicitly changed existing files remain byte-for-byte unchanged; seven expected new files were added. No Step 74 source, helper, Compose or test-setting changes were made.
- Development .env hash remains equal to the saved Step 74 baseline. Reviewed files contain none of the generated isolated service credentials. No SQL migration source, dependency manifest or lockfile changed.
- No live Google/provider HTTP calls, account authorization, email sending, Docker changes, runtime PostgreSQL/Redis access, Git staging/commit/push/merge or external setup.
- Evidence: node_modules/.cache/step75/verify.log, focused.log and preservation.json (ignored).
- Status: Step 75 mocked OAuth/read-search foundation complete; live Gmail remains not_configured and is not claimed implemented. Step 74 advanced runtime scenarios/legacy Task 004 remain postponed. Stop after this step.
