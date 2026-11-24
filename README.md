# THAARA V2 — Executive AI Partner

> **Core Product Rule**: *Safety before automation, reliability before feature count, truthfulness before personality, and user control before capability.*

Thaara V2 is a secure, production-oriented, multi-tenant **Executive AI Partner** for Quantum Weave. It transforms executive intent into governed multi-step plans, drafts, two-person approvals, verified execution receipts, and context-aware conversations across chat, voice, memory, and approved business connectors.

V2 is a clean build engineered with strict zero-trust boundaries: PostgreSQL Row-Level Security (RLS) on every business table, multi-role database privilege isolation, deterministic policy validation before any external execution, and truthful failure reporting without simulated success.

---

## Current Status & Verification Traceability

Every capability claimed as implemented is backed by live code paths and automated verification across unit, integration, and live container runtime test suites.

### Implementation Summary

| Workstream | Status | Verified Capabilities & Controls |
|---|---|---|
| **Platform Foundation (Task 001)** | **IMPLEMENTED** | Monorepo structure, Fastify HTTP API, TypeBox contracts & OpenAPI schema, opaque sessions in HttpOnly cookies, CSRF validation, single-use bootstrap, rate limiting, Helmet security headers, redacted structured logging, BullMQ worker queue with bounded retries. |
| **Tenant Isolation & PostgreSQL RLS (Task 001 & 003)** | **IMPLEMENTED** | Native PostgreSQL RLS on all workspace-owned tables with zero fail-open clauses, server-derived `sessionTokenHash` validation, cross-tenant isolation tests running directly against real PostgreSQL 16 container as non-superuser `thaara_app`. |
| **Governed Plan Execution (Task 002)** | **IMPLEMENTED** | Plan DAG dependency cascades, multi-step plan execution, leased step execution, approval-gated mutations, conservative crash recovery (expired lease on non-idempotent action marks receipt `unverified`), and native idempotent step reconciliation. |
| **Executive Chat, Context & Streaming (Task 003 Phases 1–3)** | **IMPLEMENTED** | Private conversation sessions, deterministic context assembly with 4096-token hard ceiling (`cl100k_base`), SSE executive streaming (`context_ready`, `stream_status`, `token`, `done`), monotonic reconnection with `Last-Event-ID`, active idempotency replaying durable events, and model gateway with truthful `not_configured` emission. |
| **Executive Memory & Privacy Governance (Task 003 Phases 1–4)** | **IMPLEMENTED** | Consented memory lifecycle, atomic supersession, token-bound auxiliary RLS, self-service privacy purge with cutoff generation, privacy export, administrative inspection with mandatory justification, durable continuations, bounded delivery budgets, authoritative outbox dispatch sweeper, sole-owner account closure protection, and worker stale stream sweeper. |
| **Governed Capabilities & Personas (Task 004 Phase A/B)** | **IMPLEMENTED** | Platform preset catalog, tenant capability grants, persona definitions with model/tool/risk constraints, schema backfill guards, typed capability registry, and credential leak defense preventing secret propagation into prompts or telemetry. |
| **Governed Knowledge** | PLANNED | Versioned ingestion, citations, approval, conflict policy, retention, and scope tests. |
| **Google Workspace Connectors** | PLANNED | OAuth 2.0 / PKCE, encrypted credentials, Gmail/Calendar/Contacts adapters, sandbox execution receipts. |
| **WhatsApp Business Connector** | PLANNED | Signed webhook validation, consent/opt-out lifecycle, HSM templates, delivery reconciliation, live sandbox verification. |
| **Realtime Multilingual Voice** | PLANNED | Short-lived ephemeral sessions, audio streaming, barge-in detection, language switching, verbal confirmation before write actions. |
| **Proactive Executive Loop** | PLANNED | Quiet-hours scheduling, consent gates, frequency throttling, and event de-duplication. |

### Live CI & Container Test Evidence

All tests run continuously against live PostgreSQL 16 Alpine and Redis 7 Alpine containers with zero skips or mock substitutions:

- **CI Run `34839159543`** (Commit `6808f1c`): **274 tests passed** (132 unit/integration + 142 live container runtime tests across 6 runtime test suites).
- **CI Run `34808276108`** (Commit `c6b972d`): **229 tests passed** verifying SSE streaming lifecycle, model gateway, and reciprocal deferred constraint triggers.
- **CI Run `34694435882`** (Commit `1918d12`): **183 tests passed** verifying token-bound auxiliary RLS, forged GUC isolation, and 17 hardened `SECURITY DEFINER` procedures.
- **CI Run `34566541462`** (Commit `d3ffed0`): **16 PostgreSQL RLS tests + 6 Redis BullMQ tests** verifying non-superuser application boundaries.
- **Task 004 Integration Suite**: **37 tests passed** verifying capability registry, persona governance, and migration 0012 platform catalog prerequisites.

Full evidence history is maintained in [`docs/requirements-traceability.md`](docs/requirements-traceability.md).

---

## Architectural Principles & Non-Negotiables

1. **Tenant Isolation at Every Layer**: Every request scope contains an authenticated `workspaceId`, `userId`, and membership role. PostgreSQL Row-Level Security (RLS) acts as the final perimeter; all queries are tenant-scoped at the repository layer first.
2. **Deterministic Policy Gateway**: AI models propose plans and drafts, but never make authorization, risk, or execution decisions. A typed policy gateway validates action schemas, permissions, risk levels, two-person rules, and idempotency before any connector or mutation executes.
3. **Approval-Gated External Mutations**: Consequential actions require explicit approval. A requester cannot approve their own high-impact action (two-person rule). Approvals expire with bounded TTLs.
4. **Untrusted External Data**: All connector payloads, documents, webhooks, memory records, and LLM outputs are treated as untrusted data that cannot alter system instructions, policies, or permissions.
5. **Truthful State Reporting**: Connectors report truthful operational states (`not_configured`, `queued`, `awaiting_approval`, `failed`, `unverified`, `verified`). The system never emits simulated success for unconfigured or unverified integrations.
6. **Zero Secret Exposure**: Secrets are loaded from environment variables in development and managed secret stores in deployment. Telemetry and audit loggers employ automatic regex-based credential redaction.
7. **Database Role Separation**:
   - **Migration Admin** (`MIGRATION_DATABASE_URL` / `thaara_migrator`): DDL-capable administrator for applying schema migrations.
   - **Runtime Application** (`DATABASE_URL` / `thaara_app`): Non-superuser application connection. Denied direct DML on sensitive tables; interacts exclusively through audited, parameterized `SECURITY DEFINER` procedures.
   - **Runtime Worker** (`WORKER_DATABASE_URL` / `thaara_worker`): Asynchronous worker connection. Authorized for lease acquisition, outbox claiming, continuation recovery, and stale sweeping; denied execution of user-facing application procedures.

---

## Monorepo Layout

```text
thaara-ai-agent-v2/
├── apps/
│   ├── api/             # Fastify HTTP API (Auth, SSE Streaming, Approvals, Memory, Audit)
│   ├── web/             # React executive workspace (Vite, React Router, TanStack Query)
│   └── worker/          # BullMQ worker (Plan execution, Sweepers, Purge processor, Recovery)
├── packages/
│   ├── contracts/       # Shared TypeBox schemas for API, actions, events, and policy
│   ├── db/              # Migrations (0001-0012), RLS policies, scoped repositories, PGlite
│   ├── policy/          # Capability registry, risk evaluation, persona policy gateway
│   ├── observability/   # Redacted structured logging, OpenTelemetry tracing, audit formatters
│   └── config/          # TypeBox-validated environment configuration
├── docs/
│   ├── architecture.md               # System design, lifecycle diagrams, data flow
│   ├── requirements-traceability.md  # Live-CI evidence matrix & audit record
│   ├── adr/                          # Architecture Decision Records
│   └── tasks/                        # Phased task specifications (001-004)
└── docker-compose.yml   # Local PostgreSQL 16 & Redis 7 services
```

---

## Database Migrations

The database schema is strictly versioned through additive SQL migrations under `packages/db/src/migrations/`:

| Migration | Scope / Control |
|---|---|
| `0001_initial_schema.sql` | Core tenancy, users, workspaces, memberships, sessions, audit events, approvals. |
| `0002_rls_policies.sql` | Native RLS policies and `resolve_session_scope()` function. |
| `0003_worker_tables.sql` | BullMQ job leases, worker heartbeat, execution idempotency keys. |
| `0004_context_and_memory.sql` | Conversation threads, messages, memory items, user purge cutoffs. |
| `0005_task002_plans.sql` | Governed plan DAGs, plan steps, receipts, outbox dispatch. |
| `0006_task003_procedure_hardening.sql` | 11 `SECURITY DEFINER` procedures, direct DML denial, search path pinning. |
| `0007_task003_token_bound_auxiliary_rls.sql` | Token-bound auxiliary RLS on purge cutoffs and outbox dispatch. |
| `0008_task003_assistant_stream_lifecycle.sql` | SSE assistant stream executions, events, reciprocal deferred constraint triggers. |
| `0009_task003_privacy_purge_and_outbox_hardening.sql` | Worker purge procedures, bounded lease acquisition, sole-owner protection. |
| `0010_task003_purge_recovery_after_claim.sql` | Crash recovery for in-flight claimed purges before batch completion. |
| `0011_task003_purge_recovery_hardening.sql` | Hardened `recover_stranded_purge_operations`, grace interval, safe JSON payload matching. |
| `0012_task004_governed_capabilities_and_personas.sql` | Platform preset catalog, tenant capability grants, persona definitions, governance triggers. |

---

## Quality Gates & Verification

Run the full verification pipeline before any commit:

```bash
# Verify entire monorepo (build, lint, typecheck, unit & integration tests)
pnpm verify

# Run unit tests only (fast in-memory suite)
pnpm test

# Run integration tests (PGlite / in-memory database)
pnpm test:integration

# Run live container runtime tests (requires Docker PostgreSQL 16 & Redis 7)
pnpm test:runtime

# Run security audit on production dependencies
pnpm audit --prod
```

---

## Getting Started (Local Development)

### Prerequisites

- **Node.js**: `>= 22.0.0`
- **pnpm**: `>= 9.0.0`
- **Docker & Docker Compose**: For local PostgreSQL 16 and Redis 7 containers

### Setup Instructions

1. **Clone the repository and install dependencies**:
   ```bash
   git clone https://github.com/QuantumWeaveDev26/thaara-ai-agent-v2.git
   cd thaara-ai-agent-v2
   pnpm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```

3. **Start backing services (PostgreSQL & Redis)**:
   ```bash
   docker compose up -d
   ```

4. **Run migrations and bootstrap runtime database roles**:
   ```bash
   # Execute schema migrations (as migration admin)
   pnpm db:migrate

   # Provision thaara_app, thaara_worker, and test identities
   pnpm db:bootstrap-identities
   ```

5. **Start development processes**:
   ```bash
   # Run all apps concurrently (API, Worker, Web)
   pnpm dev

   # Or run individual services:
   pnpm --filter @thaara/api dev
   pnpm --filter @thaara/worker dev
   pnpm --filter @thaara/web dev
   ```

6. **Interactive Documentation**:
   With the API running, visit `http://localhost:3000/docs` for the OpenAPI specification.
