# ADR 0001: TypeScript monorepo, PostgreSQL RLS, Fastify, and durable workers

**Status:** Accepted  
**Date:** 2026-09-10

## Context

Thaara V2 begins clean but must reach production-grade security, multi-tenancy, connector reliability, and auditable approval workflows. The reference system established useful product behavior but relies on a local SQLite architecture whose isolation and worker guarantees are insufficient for the V2 production target.

## Decision

Use a pnpm TypeScript monorepo with Fastify API and worker applications, a React/Vite client, PostgreSQL with versioned migrations and RLS, Redis/BullMQ for durable jobs, S3-compatible object storage, TypeBox contracts, and opaque secure-cookie sessions.

Application repositories require an explicit request scope. Database requests run in transactions with workspace/user claims set as transaction-local PostgreSQL parameters; RLS policies deny access when the scope is absent or mismatched. This makes accidental unscoped reads fail even when application code has a defect.

All connector writes traverse a deterministic policy gateway and durable plan/approval lifecycle. Provider acceptance is distinct from verified completion.

## Consequences

- Local setup requires PostgreSQL and Redis, provided through Docker Compose; it remains close to production behavior.
- Services are more explicit than a single Express/SQLite application, but the boundaries protect tenant data and preserve retries and auditability.
- Each new table needs a migration, indexes, RLS policies, and cross-workspace tests before it can be considered complete.
- Production deployment needs managed PostgreSQL, Redis, object storage, and a secret manager; credentials are not a development substitute for those controls.

