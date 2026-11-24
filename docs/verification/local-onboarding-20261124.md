# Fresh local setup verification — 24 November 2026

Environment: isolated source checkout on Windows; Node 24.22.1, pnpm 9.15.4, Docker Engine 29.8.2. Dependencies were installed afresh into a separate package store using the committed lockfile. The existing project's dependencies, Git state and production environment were not modified.

| Check | Observed result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed; 327 packages installed, lockfile unchanged |
| `pnpm build` | Passed across all 8 workspace packages/apps |
| Local PostgreSQL 16 and Redis 7 | Both healthy; isolated Compose project and loopback ports 15432/16379 |
| Core migrations on empty PostgreSQL | All 12 applied, 0001–0012 |
| Application login provisioning | `thaara_app` configured locally |
| Separate runtime identity bootstrap | Local admin/worker/seeder identities configured |
| Second migration pass | No changes; all 12 skipped |
| Setup helper safety test | 1 passed, 0 failed; random keys hidden and existing config preserved |
| `node scripts/verify-local-stack.mjs` | Passed; API, worker, frontend and proxy checked |

Startup receipt (no credentials or customer data):

```json
{"status":"passed","apiHealth":200,"openApi":200,"frontend":200,"frontendApiProxy":200,"workerReady":true,"restrictedWorkerRoleVerified":true,"providerRequestsMade":0,"productionChanged":false}
```

The smoke check stops only the API/worker/frontend processes it starts. The separate local database volumes contain schema/test infrastructure only and are not committed. No production database export, provider setup, real messages, calls, customer rows or deployments occurred.

Limitations: frontend bundle size warning is non-fatal. The complete unit/integration regression suite was not rerun for this documentation/setup-only task. Interactive owner creation, conversations, provider features, other operating systems and Node 22 were not tested here. Additional feature SQL outside the core migrator remains subject to each integration's reviewed setup. Actual production-data transfer requires a separately approved private process.
