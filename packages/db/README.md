# @thaara/db - Database Layer, RLS & Migrations

This package encapsulates PostgreSQL schema migrations, Row-Level Security (RLS) policies, transactional database connections, and typed repositories for Thaara V2.

## Security Architecture: RLS & Role Separation

PostgreSQL superusers bypass Row-Level Security unconditionally. To guarantee tenant isolation, Thaara V2 enforces a strict separation between **Migration Admin** and **Runtime Application** roles:

### 1. Migration Admin Role (`thaara_admin` / superuser)
- Executes schema DDL migrations (`CREATE TABLE`, `ALTER TABLE ... FORCE ROW LEVEL SECURITY`, `CREATE POLICY`, `CREATE ROLE`, `CREATE FUNCTION`).
- Has administrative privileges to define tables and functions.
- Used exclusively during deployment migration runs via `MIGRATION_DATABASE_URL` or migration pipeline steps:
  ```bash
  MIGRATION_DATABASE_URL="postgresql://thaara_admin:<secret>@db:5432/thaara_v2" pnpm db:migrate
  ```

### 2. Runtime Application Role (`thaara_app`)
- Non-superuser role created during initial migration (`0002_rls_policies.sql`).
- Granted DML-only permissions (`SELECT, INSERT, UPDATE, DELETE`) on public tables and `EXECUTE` on public functions.
- Has **NO DDL privileges** (cannot create, alter, or drop tables).
- Application runtime services (`apps/api`, `apps/worker`) connect using this role via `DATABASE_URL`:
  ```bash
  DATABASE_URL="postgresql://thaara_app:<secret>@db:5432/thaara_v2"
  ```
- Because `thaara_app` is a non-superuser, PostgreSQL natively and unconditionally enforces Row-Level Security on every query based on `app.workspace_id`.
- The application does not require superuser privileges or runtime `SET ROLE` commands in production.

## Authentication & Scope Resolution Boundary

Tenant tables (`sessions`, `memberships`, `audit_events`, `idempotency_keys`, `approval_requests`, `job_runs`) have strict fail-closed RLS policies:
```sql
CREATE POLICY tenant_isolation_<table_name> ON <table_name>
  FOR ALL
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
```

When a request arrives, authentication and scope resolution cannot perform unscoped table reads on `sessions` or `memberships`. Instead, dedicated `SECURITY DEFINER` functions resolve identity safely:
- `resolve_session_scope(p_token_hash TEXT)`: Resolves an unauthenticated session cookie hash to `(session_id, workspace_id, user_id, role, expires_at)` without exposing raw tables to unscoped reads.
- `get_user_memberships_for_auth(p_user_id UUID)`: Retrieves workspace memberships for an authenticated user during initial login.

All subsequent operations execute inside `withScopedTransaction(scope, ...)`, which sets transaction-local configuration parameters:
- `set_config('app.workspace_id', scope.workspaceId, true)`
- `set_config('app.user_id', scope.userId, true)`
- `set_config('app.role', scope.role, true)`

## Production Deployment Migration Path

1. **Pre-deployment Step**: Run the database migrator container or CI step with migration admin credentials:
   ```bash
   MIGRATION_DATABASE_URL="postgresql://thaara_admin:${ADMIN_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" pnpm db:migrate
   ```
2. **Service Boot**: Start `api` and `worker` instances with runtime non-superuser credentials:
   ```bash
   DATABASE_URL="postgresql://thaara_app:${APP_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}" pnpm start
   ```
3. **Verification**: Verify migration status using `pnpm --filter @thaara/db run migrate`.
