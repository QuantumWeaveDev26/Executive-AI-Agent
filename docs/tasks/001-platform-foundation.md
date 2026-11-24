# Task 001 — Platform foundation and security boundary

**Status:** COMPLETED  
**Owner:** Antigravity implementation executor  
**Architecture owner:** Codex  
**Depends on:** `docs/architecture.md`, `docs/adr/0001-platform-stack-and-tenant-boundary.md`, and `AGENTS.md`

## Outcome

Create the runnable V2 monorepo foundation that establishes tenant scope, opaque sessions, PostgreSQL RLS, auditable writes, a policy-gateway contract, durable job plumbing, and a minimal authenticated executive shell. No real connector execution is in scope.

## In scope

1. Initialize pnpm workspaces for `apps/api`, `apps/web`, `apps/worker`, and `packages/{contracts,db,policy,config,observability}`. Pin Node 22 LTS and package-manager version. Add root scripts: `lint`, `typecheck`, `test`, `build`, `verify`, `dev`, and `test:integration`.
2. Add Docker Compose for local PostgreSQL 16 and Redis 7. Provide `.env.example` with only variable names, safe placeholder values, and explanatory comments. Do not create `.env`.
3. Implement validated configuration. Development refuses to start when session/encryption secrets are unsafe placeholders. Tests receive generated test-only values. Production configuration requires HTTPS/cookie/security values and external services.
4. Implement versioned SQL migrations with a baseline schema:
   - `workspaces`, `users`, `memberships`, `sessions`;
   - `audit_events`, `idempotency_keys`, `approval_requests`;
   - `job_runs` plus a minimal plan/step structure only if required by the queue contract.
   Every workspace-owned table has `workspace_id`, timestamps, required indexes, foreign keys, and RLS policies. Direct connections fail closed without transaction-local request claims.
5. Implement API request scope, correlation IDs, structured redacted errors/logs, route-aware rate limits, security headers, JSON body limits, CORS allow-list, secure HttpOnly session cookies, CSRF protection for mutating cookie-authenticated endpoints, logout, and server-side session revocation.
6. Implement a bootstrap-only local owner creation path that is disabled after first use and never enabled in production. Build login, logout, current-user, and a minimal authenticated web shell. Passwords use a current memory-hard KDF available in the selected runtime; no custom crypto.
7. Implement a shared TypeBox contract package and a policy-gateway interface. It must represent action schemas, action class (`read`/`write`), risk, required approval mode, idempotency, timeout, retry policy, tenant authorization, and audit requirements. Include a deliberately non-executing `not_configured` adapter to prove truthful connector state.
8. Configure BullMQ and worker lifecycle with idempotent job enqueueing, leased processing, bounded retry/backoff, and an audit record. Do not introduce a connector write or model call in this task.
9. Add CI for install with frozen lockfile, lint, typecheck, unit/integration tests, build, dependency audit, secret scan, and migration verification. Use only free, maintained tooling.
10. Document local startup, test database isolation, migration commands, required environment variable names, and the security model in the repository README or linked docs.

## Out of scope

- OAuth, Gmail, Calendar, WhatsApp, voice, CRM, live API keys, knowledge ingestion, model calls, external webhooks, or deployment.
- Broad product UI. The web app only needs the account bootstrap/login/current-session boundary and a clearly minimal authenticated shell.
- Production infrastructure creation or secrets.

## Required validation

Run and report exact commands/results:

```text
pnpm install --frozen-lockfile
pnpm verify
pnpm audit --prod
docker compose config
```

The integration suite must start isolated PostgreSQL/Redis services or document an equivalent repeatable CI service setup.

## Acceptance gates

- A fresh checkout can boot the local dependency stack and run API, worker, and web applications from documented commands.
- Schema migrations apply cleanly twice (second run is a no-op) and fail safely on an incompatible migration state.
- An unauthenticated request cannot access authenticated routes; a revoked session fails immediately.
- CSRF is required for authenticated mutations and session cookies have secure production settings.
- A member of workspace A cannot read or write a workspace-B resource, including through a deliberately attempted direct repository call. Verify both application authorization and RLS rejection.
- Invalid input yields stable validation responses without stack traces or secrets. Logs/audits redact secret-shaped fields.
- Idempotent job submission creates one logical job; a transient failure retries within bounds; a permanently failing job records a truthful failure and audit event.
- The policy gateway rejects a write with no approval and a configured test adapter returns `not_configured` without fabricating a receipt.
- API OpenAPI output derives from shared contracts. The web app compiles and can display the signed-in user and workspace.
- `docs/requirements-traceability.md` only marks foundation sub-items that have direct implementation and test evidence.

## Handoff report format

Return: modified files; architecture decisions or deviations; commands and results; test count; coverage of each acceptance gate; known limitations; and the proposed next task. Do not claim that unconfigured external systems are connected or verified.

