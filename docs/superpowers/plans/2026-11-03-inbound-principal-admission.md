# Inbound principal admission implementation plan

Goal: locally verify a distinct, narrow inbound service identity without removing existing test-only protections.
Architecture: a transaction-bound grant gate takes a server-owned route binding, hashes the presented dedicated
Bearer credential and asks an injected transactional grant reader for the matching identity. Validate the grant
inside that transaction before invoking report-only work. No owner login credential or WhatsApp relay is reused.
Tech stack: TypeScript, Node crypto, existing observability errors and Vitest mocks.

- [x] Add `apps/api/test/phone-inbound-principal.test.ts`: invalid credentials never reach storage; matching grant
  obtains only callback/completion scope; cross-tenant/profile/version/revision, stale/revoked grant and inactive
  owner fail; provider/body data cannot choose principal; scopes immutable; failed transaction cannot return success.
- [x] Add `apps/api/src/services/phone-inbound-principal.ts`: test-only constructor, frozen server binding,
  explicit transaction port, grant validation, sanitized errors, no retries and distinct service scope.
- [x] Run focused tests plus existing inbound workflow regressions and API typecheck/build. Do not execute SQL.
- [x] Document required production database grant/RLS/role boundaries, authenticated tool delivery/rate controls
  and staged approval dependencies. Save handover with exact fresh results and remaining limitations.

Do not remove any existing guard, register routes, alter SQL111/112, reuse consumed approval manifests, call a
provider or access deployed resources. These are ordinary authorized local changes; no commit is authorized.

## Next bounded slice: restricted transaction adapter

- [x] Add failing mock-pool tests for restricted role/RLS metadata, begin/commit/rollback order, missing/changed/
  revoked/expired grants, timeouts, commit/rollback failures, connection release and retained-client use.
- [x] Implement TEST-ONLY `phone-inbound-principal-postgres.ts` over an injected pool: bounded transaction settings,
  exact dedicated role, no elevated memberships/table ownership, RLS enabled+forced, no direct table privileges;
  use future narrow resolver/assertion functions. Recheck grant and deadline before commit, discard broken clients.
- [x] Document exact future database function/role contract; no SQL execution or live registration. Run focused
  synthetic tests, typecheck/build and independent review. Preserve prior SQL/manifests/markers unchanged.

## Next bounded slice: review SQL and committed service journal composition

- [x] Prepare additive113 grant table, two NOLOGIN roles, locked current-grant resolver, role-specific RLS and
  narrow atomic append+audit routine. Preserve prior SQL bytes and other roles/policies. Do not execute SQL.
- [x] Add failing mock tests then a TEST-ONLY service journal: transaction-bound service identity, typed report-only
  policy validation, shared reducer, bounded phase receipts and save confirmation only AFTER the outer commit.
  Never promote service identity to an owner session; use existing owner-shaped validator only as a pure validator.
- [x] Harden adapter against elevated session_user hidden behind SET ROLE and writable public schema.
- [x] Run database-free checks, review SQL/code independently, document privileges and gaps. Prepare separate
  isolated acceptance scope only after review; no new SQL execution or provider actions.
