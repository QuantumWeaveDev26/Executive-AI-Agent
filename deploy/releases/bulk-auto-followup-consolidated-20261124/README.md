# Reconciled requested release — 24 November 2026

This is bulk-auto-followup-consolidated-20261124 (OCI identity in manifest.json). It is the requested historical release; the later normalization image was observed serving afterward. No production change is authorized by this package.

Three source files were reconciled with the preserved image. A full Linux workspace build passed. The compiled route, auto-followup implementation, unchanged bulk service and requested frontend bundle match their preserved bytes. The source-only comparison matched 933 of 990 expected compiled/static files; the remaining files are supplied unchanged in overlay/. These include compiled-only Phone/WhatsApp helpers, a contract module, generated declarations/maps and an older retained frontend asset. Original TypeScript for every historical helper is not available. Do not call this a pure TypeScript rebuild or claim the new Docker image will have the old OCI identity.

## Build and assemble on another computer

Use the pinned dependencies and fresh local setup in DEVELOPER.md. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/stage-exact-release.mjs --built-root . --output ./artifacts/release-runtime-consolidated-20261124
```

The staging command reads only declared build/overlay files, verifies all checksums, refuses an existing output folder and copies the 993 declared runtime files into a separate application tree. It does not start services, apply SQL, read environment files, copy credentials, call providers or deploy anything. The CLI output reports the verified file count. Output is release application code, not a complete runnable container: production dependencies, approved private configuration and original runtime platform remain separate. The preserved original images provide exact container recovery.

## Migrations

The 12 bundled core SQL files in packages/db/src/migrations and dist/migrations are unchanged from the predecessor. Their exact hashes are in manifest.json. Actual applied feature SQL outside the core migrator is not established by this comparison. Do not replay all integration SQL against a restored database. The private restore guide preserves the real schema/ownership/grants.

## Preservation and rollback

The original requested image, predecessor, later normalization image and existing worker/receiver images are encrypted in owner-approved private cloud storage. Full image identity is not reproduced by recompiling this code. Do not use historical pilot Compose files as a current deployment definition. Resolve the current Compose file set, private bindings and migration history before requesting a coordinated API-only rollout. Roll back to the image captured immediately before an approved deployment; do not automatically select the historical predecessor. Database rollback is separate.

No credentials, database records or private unlock key are included. This package makes the historical code and retained runtime patch files reviewable; it does not grant live provider or server access.
