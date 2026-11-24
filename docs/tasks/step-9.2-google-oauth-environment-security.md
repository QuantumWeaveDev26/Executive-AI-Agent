# Step 9.2 — Google OAuth environment security

Date: 2026-10-22 (Asia/Calcutta). Branch: dev-thaara-continuation; committed checkpoint: 78c84f9.

Status: COMPLETE — environment loading and dedicated-key security fixes verified; credentials and real OAuth remain unconfigured.

## Changes

- The API entrypoint invokes a backend-only local environment loader before loadConfig and Google initialization. Node native loadEnvFile resolves the root .env from the module location in both src and dist, independent of working directory. Existing process environment variables win. Local loading is development-only (also when NODE_ENV is unset); test, production and unknown modes do not load local credentials. Missing optional files are tolerated; other errors fail with a fixed value-free message.
- Root .env remains Git-ignored and untracked. No .env contents or existing credentials were read, copied, generated, edited or printed. No Vite, browser environment prefixes, package scripts, dependencies or runtime services were changed.
- Live Google configuration requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and a dedicated GOOGLE_VAULT_KEY. Key format: exactly 64 hexadecimal characters (32 bytes), excluding repeated-byte placeholders and reuse of SESSION_SECRET. No session-key fallback. Partial OAuth client configuration fails closed; absence of both client fields remains not_configured, preserving credential-free tests/mocks.
- Existing AES-256-GCM vaults and domain-separated key derivation remain. The ciphertext store is still a temporary process-local Map; restarts lose tokens and pending OAuth state. No persistence redesign or migrations.

## Files

- apps/api/src/local-environment.ts (new)
- apps/api/src/server.ts
- apps/api/src/services/google-live.ts (preserves Step101 uncommitted implementation)
- apps/api/test/local-environment.test.ts (new)
- apps/api/test/google-live-security.test.ts (new)
- docs/tasks/step-9.2-google-oauth-environment-security.md (new)
- docs/requirements-traceability.md

## Verification

- Regression red run: 14 expected failures, 2 passes; missing environment-loader module also failed collection. Confirmed absent key validation/fallback and partial-configuration defects before production edits.
- Focused run: 82/82 tests, 8/8 files, 0 failed/skipped (14.97s). Includes the initial 25 new security/loading tests and existing Gmail/Calendar foundations, authenticated API, isolation, CSRF, refresh/provider-error handling and live/mock UI tests. Google calls mocked; API fixtures use isolated in-memory PGlite only. No external databases or provider calls.
- Additional edge coverage: 17/17 vault-security cases passed, including an added trailing-newline case that the existing guard correctly rejected; no further production change was needed. There are 26 new regression cases in total.
- Full pnpm.cmd verify: invoked once; build, lint, typecheck and 736/736 tests across 68/68 files passed, 0 failed/skipped. Vitest duration: 499.16s.
- Independent read-only security review: no actionable findings.
- git diff --check: passed. Preservation: 315/318 starting files remain byte-identical; the remaining three changes are the intended startup, Google factory and traceability edits. In-memory reversal checks confirm the two source edits preserve all previous content outside the targeted additions/replacement. All Canvas Blue frontend, dependency and migration files are unchanged.

## Remaining blockers and next action

Do not add credentials or start OAuth in this step. Later, the user must securely supply the five named Google variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_VAULT_KEY, GOOGLE_GMAIL_REDIRECT_URI, GOOGLE_CALENDAR_REDIRECT_URI), with a dedicated privately provisioned 32-byte hex key; review and personally consent to read-only Google access separately. Production must provide environment settings via its secret-management system. Durable Google token storage remains outstanding and requires its own approved design/migration work. No live connection or restart persistence is claimed. All existing Canvas Blue/integration edits are preserved; no n8n access, Git writes, installs, migrations, emails, paid calls or service restarts.
