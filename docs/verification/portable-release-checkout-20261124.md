# Portable checkout and release assembly verification — 24 November 2026

Scope: other-computer checkout/build/assembly and non-secret recovery instructions only. No production services, integration configuration, credentials, database contents or provider behavior changed.

## Errors reproduced and fixed

1. Git with Windows `core.autocrlf=true` changed immutable runtime overlay bytes, causing SHA-256 failure. Two regression checks failed before the fix. Release overlays now use `-text` so checkout preserves exact committed bytes. Core SQL is explicitly byte-preserved as well; existing migration content and checksums were not rewritten.
2. The documented staging output under a fresh missing `artifacts/` parent failed with ENOENT after checksum validation. A focused test reproduced it. The utility now creates only the output parent after all inputs pass checksum checks, and still refuses an existing output. Corrupt input fails before creating any output directory.
3. TypeScript now explicitly emits LF on all operating systems. This is an output-format setting, not a change to application behavior.

## Current verification

- Windows, Node 24.22.1, pnpm 9.15.4: `pnpm build` passed across all eight workspaces.
- `node --test scripts/portable-checkout-artifacts.test.mjs scripts/stage-exact-release.test.mjs`: 6 passed, 0 failed. Covers both release overlay checkout modes, all 12 core migration byte identities, a fresh nested output, tampered input refusal and existing-output preservation.
- The actual Windows release assembly verifies the declared current-release files against their immutable manifest; its receipt is retained with the task checkpoint.
- Existing fresh-database initialization/startup and 73 focused feature tests retain their previously documented evidence; they were not unnecessarily repeated for these local-output changes.

macOS end-user startup, Node 22 runtime, provider-enabled conversations and a newly restored customer's permissions have not been exercised by these checks. The new private-database recovery guide labels its unexecuted destination setup clearly. No new real-database restore was performed.

## Another developer

Follow DEVELOPER.md for a fresh local environment, then use the release staging guide if exact application-file assembly is needed. Use docs/recovery/restore-existing-database.md only with a separately authorized private backup and unlock key. Git alone does not grant provider access or customer-data permission. Never publish those private materials to make cloning easier.
