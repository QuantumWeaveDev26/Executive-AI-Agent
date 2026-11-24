# Thaara V2 — developer setup and handoff

Start here when cloning on a different computer. This is a pnpm/TypeScript monorepo, not a machine-specific Windows application. Use Windows (PowerShell), macOS or Linux with Git, Node.js 22.14+ and Docker Compose v2. Docker Desktop must be running on Windows/macOS. Local addresses below belong to your computer, never the production VPS.

## What GitHub contains

- `apps/api`: Fastify API, authentication, conversations, integrations and orchestration.
- `apps/web`: React/Vite interface. Its development proxy targets API port **3002**.
- `apps/worker`: BullMQ workers, recovery and background processing.
- `packages/contracts`: shared request/response schemas; `packages/policy`: execution authorization.
- `packages/db`: PostgreSQL repositories, role bootstrap and **12 core SQL migrations** in `src/migrations`.
- `packages/config`, `packages/observability`: validated environment and redacted logging.
- `docs/integrations`: additional feature SQL, review scopes and integration references. These are not all automatically applied by the core migration runner.
- `docs/pending/whatsapp-style-leads.patch`: unfinished isolated WhatsApp work. It is **not applied** to the canonical source because newer conversation changes require reconciliation. Do not apply it blindly.

PostgreSQL is a running database service, not a portable `.db` file. The schema/code is in Git; live customer rows, messages, queues, passwords, OAuth grants and provider credentials are not. Cloning creates a separate development environment, not a copy of production integrations. Historical handovers describe past deployments; their image IDs and approval windows are not current authorization.

## Fresh local installation

Use a new private folder and a terminal without production credentials. The commands below work in PowerShell and POSIX shells. They create only a fresh local database; never run the migration/bootstrap commands against production.

```sh
git clone https://github.com/QuantumWeaveDev26/Executive-AI-Agent.git
cd Executive-AI-Agent
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install --frozen-lockfile
node scripts/setup-local.mjs
docker compose --env-file .env.local-dev -f compose.development.yml up -d --wait
pnpm build
```

If Corepack is unavailable, install the pinned pnpm 9.15.4 using your approved Node package-manager setup. Do not change the lockfile to work around an installation error. If the existing source fails a build, retain the actual error and fix/review it; do not disable type checking or assume this source snapshot is a verified release.

The setup helper generates independent random local passwords and session keys. It never reads production secrets, prints values, connects to a server, or overwrites an existing `.env.local-dev`. This file is ignored by Git. On Unix it is created with mode `0600`; on Windows restrict it to your Windows account through file **Properties → Security**. Do not place the checkout in a shared/public folder. Do not display this file, paste it into chat, or use `docker compose config` without `--quiet`, which could print resolved credentials.

Initialize the **new local** database after a successful build:

```sh
node --env-file=.env.local-dev packages/db/dist/cli/migrate.js
node --env-file=.env.local-dev packages/db/dist/cli/provision-role.js
node --env-file=.env.local-dev --experimental-strip-types packages/db/scripts/bootstrap-runtime-identities.ts
```

The first command applies the core migrations, the second enables the local `thaara_app` login, and the third creates the separate local worker/admin/seeder identities. The API uses the restricted app login; the worker checks out `thaara_worker_user` as `thaara_worker`. Do not run either service using the PostgreSQL administrator login.

Start these in **three separate terminals**, each at the repository root:

```sh
# Terminal 1: API
node --env-file=.env.local-dev apps/api/dist/server.js
```

```sh
# Terminal 2: worker
node --env-file=.env.local-dev apps/worker/dist/worker.js
```

```sh
# Terminal 3: frontend
pnpm --filter @thaara/web dev
```

Open `http://localhost:5173`; API documentation is at `http://localhost:3002/docs`. The local API has a single-use `POST /api/v1/bootstrap` route for the first development owner (`email`, `password`, `displayName`, `workspaceName`); use the frontend's initial setup when available or the API documentation. Use a new development identity, not a production password. It returns 403 after initialization or in production by design. Keep `localhost` consistent in the browser for cookies/CORS.

The core database is now independent on your machine. Optional Phone/WhatsApp/Google/voice features may still report `not_configured`; obtain their approved development credentials and apply only their reviewed local schema/setup. No live integrations are automatically transferred or enabled. Add server-side keys only to private configuration; never `VITE_*` variables or frontend code. Do not point development webhooks at live accounts without owner approval.

Stop local services without deleting their data:

```sh
docker compose --env-file .env.local-dev -f compose.development.yml stop
```

Run the same `up -d --wait` command to resume. Docker volumes preserve local rows on that computer. Avoid `down -v` and volume deletion unless you intend to discard the local database. Do not regenerate local passwords while reusing an initialized database volume: PostgreSQL does not automatically change existing passwords when the environment file changes.

## Tests and everyday changes

```sh
node --test scripts/setup-local.test.mjs
pnpm test
pnpm build
```

Run the task-specific integration/runtime gates from `docs/tasks` when changing database or connector behavior. These commands are not a claim that the complete current source has passed on every operating system. The new setup helper is verified separately; clean-machine application/database acceptance still needs a developer run.

Read `AGENTS.md`, `docs/THAARA_PROJECT_HANDOFF.md`, the latest dated handover, and the relevant task before editing. Keep workspace/tenant scope, row-level security, approvals, audit events and idempotency intact. A successful HTTP acknowledgment alone is not a verified external outcome.

Work on a branch, commit reviewed source, and push it to the new repository. On another computer clone/pull that branch and install the pinned dependencies. Do not synchronize `node_modules`, `.env` files, Docker volumes, tokens or customer data through Git. Coordinate one deployment owner before changing shared production services.

## Moving actual database contents between computers

There are two separate needs:

1. **Develop from the same schema:** use the local setup above. No production records are needed.
2. **Use the same existing records:** this requires a separately approved private database transfer or least-privilege access to an approved shared environment. It is not accomplished by a Git push.

For a transfer, the database owner must identify the source, target and permitted data, then make a PostgreSQL custom-format backup (`pg_dump`), encrypt it, restrict access and send it through an approved private channel. Verify its checksum and restore it to a fresh isolated database; review role/ownership mappings, schema version, row counts and tenant boundaries. Prefer sanitized synthetic data for development. Keep all outbound providers and workers disabled during restore validation. Do not restore raw production data to a general developer laptop without explicit authorization. Never commit a dump or reuse the production login on another machine.

An existing production backup has **not** been exported as part of this repository task. Actual production-data portability remains pending secure owner-approved transfer, if required. API keys/OAuth grants, n8n workflow configuration and provider webhooks require their own authorized setup; a database restore alone does not recreate those external services.

## Known troubleshooting

| Symptom | Check |
|---|---|
| UI requests fail or show connection refused | Run the API on 3002 as generated; the current Vite proxy uses that port. |
| PostgreSQL password fails | Use `.env.local-dev` consistently and the matching new volume; do not mix `.env.example` with the local Compose file. |
| Core tables or roles missing | Build first, then run all three local initialization commands in order. |
| Worker rejects role identity | Use `WORKER_DATABASE_URL` from the generated file and complete identity bootstrap. |
| Optional feature table missing | Its reviewed feature SQL may be outside the 12 core migrations; inspect its task instead of applying every review SQL file. |
| Models/Google/Sarvam not configured | Provision approved development keys server-side. Working production credentials were intentionally not copied. |
| Port already in use | Stop the conflicting local program or coordinate changes to local ports and matching URLs; do not stop production services. |

Do not run historical scripts named `deploy`, `activate`, `restart`, `live`, or `provision` against a VPS merely to get local development running. This guide does not authorize a production operation.
