# Portable developer onboarding

Scope: document the published source snapshot, distinguish database schema from private database records, and provide isolated local configuration for another computer. No existing runtime behavior, integration credentials or production service changes.

Deliverables: root `DEVELOPER.md`, local-only Compose file, a no-overwrite random local environment generator and focused safety test. Dependencies: Git, Node 22.14+, pnpm 9.15.4, Docker Compose v2; core SQL and existing role/bootstrap CLIs.

Acceptance: helper creates only local configuration, keeps keys out of output, preserves existing files, and the guide uses the frontend's actual API port. Compose publishes both services only on loopback. Repository includes schema/migrations; production data and secrets stay excluded. Application build and full fresh-database boot must be reported as unverified unless actually exercised.

Validation: `node --test scripts/setup-local.test.mjs`; `node --check scripts/setup-local.mjs`; Compose syntax validation with synthetic configuration only. Full clean-machine and optional-provider acceptance remain separate.

24 November 2026 follow-up: fresh locked installation, full build, native local PostgreSQL migrations/roles, idempotent second migration pass, restricted worker identity, API/OpenAPI, frontend and frontend-to-API proxy passed. See `docs/verification/local-onboarding-20261124.md`. No optional provider or interactive product acceptance is claimed.

24 November portability follow-up: reproduced checksum failure under Git Windows checkout filters for historical/current release overlays. Pinned overlay/core SQL checkout bytes and set compiler output to LF. Added a behavior-based regression check and a non-secret existing-database restore guide. No existing backup, secret, database, provider or production configuration changed. Current verification is recorded in docs/verification/portable-release-checkout-20261124.md.
