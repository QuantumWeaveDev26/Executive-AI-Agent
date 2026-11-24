# Portable developer onboarding

Scope: document the published source snapshot, distinguish database schema from private database records, and provide isolated local configuration for another computer. No existing runtime behavior, integration credentials or production service changes.

Deliverables: root `DEVELOPER.md`, local-only Compose file, a no-overwrite random local environment generator and focused safety test. Dependencies: Git, Node 22.14+, pnpm 9.15.4, Docker Compose v2; core SQL and existing role/bootstrap CLIs.

Acceptance: helper creates only local configuration, keeps keys out of output, preserves existing files, and the guide uses the frontend's actual API port. Compose publishes both services only on loopback. Repository includes schema/migrations; production data and secrets stay excluded. Application build and full fresh-database boot must be reported as unverified unless actually exercised.

Validation: `node --test scripts/setup-local.test.mjs`; `node --check scripts/setup-local.mjs`; Compose syntax validation with synthetic configuration only. Full clean-machine and optional-provider acceptance remain separate.
