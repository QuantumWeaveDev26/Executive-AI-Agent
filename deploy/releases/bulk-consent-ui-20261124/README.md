# Current live code reconciliation — 24 November 2026

Live API was confirmed healthy as bulk-consent-ui-20261124, OCI identity sha256:6789a69843b3226f66e80b0ccddfafb10809be1e09cd507f69e5c5959a257cc8. The identity remained stable during the code-hash read. This is newer than the originally requested consolidated release. Production was not changed.

All eight source workspaces built successfully in an offline Linux build. The source build matches 944 of 992 declared live compiled/static files. The remaining 48 files are unchanged preserved runtime files whose hashes match the current image, including historical helpers/generated files and retained old frontend assets. Native compiled helpers are not represented as recovered original TypeScript. The production container image digest is not reproduced by this source build.

From a fresh checkout, follow DEVELOPER.md to install dependencies, configure fresh local services, and run pnpm build. To assemble the declared current code for review:

```sh
node scripts/stage-exact-release.mjs --release bulk-consent-ui-20261124 --built-root . --output ./artifacts/release-runtime-current-20261124
```

The staging utility performs no deployment, SQL installation, provider call, credential lookup or service startup. This current manifest covers compiled/static application files; it is not a full VPS/configuration/credential snapshot. Private deployment configuration and original runtime dependencies are separate.

The earlier requested consolidated source is preserved at commit 5b6aea80047a6b04cfce9b644c63e43c1340bbc6 and branch codex/release-consolidated-20261124. Check out that reference before building/staging the earlier release; do not build the earlier manifest from newer source.

## Known deployment location and approval boundary

Live Compose labels identify project thaara-v2-pilot, service api, directory /opt/thaara-v2-pilot and file /opt/thaara-v2-pilot/compose.json. These locations were verified read-only; the original historical shell invocation was not verified. Keep its protected bindings private. An API-only image change would use that existing model plus an explicitly reviewed image-only override and --no-deps --pull never. Do not execute it without owner approval and a coordinated window. Do not reuse the production Compose model, live domain or production secrets as a staging environment.

Use a separate local/staging project, fresh credentials, isolated ports and no outbound provider connections. Follow DEVELOPER.md for an empty schema, or the approved private restore guide for the separately encrypted real database. Avoid automatic replay of integration SQL. The 12 bundled core SQL files were unchanged in the historical release comparison; actual feature migration history needs verification before a production rollout.

For rollback, capture the pre-change image and protected configuration before any approved operation; restore only that API image/configuration. Do not roll the database or queues backward as part of an API rollback. Recovery instructions and image archives remain in the company handover account's restricted Drive folder.
