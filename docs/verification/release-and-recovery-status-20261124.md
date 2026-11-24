# Release and recovery status — 24 November 2026

## Ready for independent development

The repository includes application source, dependency lockfile, 12 core database migrations, fresh local PostgreSQL/Redis setup, local identity provisioning and DEVELOPER.md. A fresh checkout, installation, all eight workspace builds and API/worker/frontend startup passed on Windows. Follow DEVELOPER.md; do not copy another computer's dependencies, environment files or credentials.

Anyone can clone the public repository, run a separate development environment and edit the source. Only authorized collaborators can push to the upstream repository. Live provider features are optional and remain not_configured until their approved development configuration and schema are present. Other operating systems, owner/conversation acceptance and every optional integration have not been verified by the startup test.

## Separate private recovery delivery

- Real application PostgreSQL backup: encrypted private storage, 49 public tables restored, ownership/grants checked, 14 role definitions without login passwords. No database dump/customer rows or unlock key is committed.
- Five deployment images: requested API release, its predecessor, later normalization release, WhatsApp worker and Phone receiver. Encrypted preservation and local OCI manifest/configuration verification passed; no preserved application image was started.
- n8n: all 47 active workflows exported from their published versions, sanitized and imported inactive. Eight published versions differed from editor drafts. Separate credential-name/routing lists require authorized rebinding. Credential values and execution samples were not exported.
- Private handoff package: 3,590 files, round-trip decryption verified, including recovered runtime file hashes/differences, source snapshot, migration inventory and recovery instructions. Owner staging permissions remain unchanged; company ownership/access is not yet confirmed.

## Source reconciliation still pending

Requested release bulk-auto-followup-consolidated-20261124 has OCI image identity sha256:03dc82f708ba1be6364870d1b526e4af5097b3c3b8d1751ca13aa2358be088ee. Its predecessor is sha256:f288ddef0d25c2c4e35e17577e06f16224dcf427a0e4cfced04cbd2b8246bdc1. A newer bulk-auto-normalization-20261124 image was subsequently observed serving: sha256:466d85870eca3bc1bb887af263c23d3abf09a54d19783f7210ae429d8467cfac.

The requested image differs from the predecessor in nine recovered application files; the newer image differs from the requested image in six. The 12 bundled core SQL files are unchanged across the predecessor/requested comparison. Actual applied feature SQL history is not established by that comparison.

Original TypeScript release provenance remains unverified: the bulk service TypeScript was absent from the image, source maps do not contain its source text, and newer local source changed during review. Exact preserved images and recovered JavaScript are available privately, but this Git commit must not be presented as a reproducible build of the live release. Unverified source was not merged over working integrations.

## Remaining gates

Obtain/reconcile the original release source and build invocation; confirm actual current deployment files and migration ledger; validate the final restored-app overlays on another machine; complete company-controlled private delivery and named access. Complete n8n database/credential, Redis state and uploaded-file recovery coverage requires separately scoped protected backups. The definition/image/database artifacts above do not constitute a full VPS or provider-account transfer.

No production deployment, restart, workflow activation, credential change, invitation or sharing change was performed for this handoff. Historical deployment documentation is not permission to operate production.

## Reconciliation update

The requested historical release is now reconciled through a full source build plus unchanged runtime overlays. Three TypeScript/TSX source files were recovered and matched to the preserved output. Linux build passed all eight workspaces; its frontend bundle matches index-DQH3IG5A.js. The source-only comparison matched 933 of 990 declared compiled/static files. Sixty preserved files (including three runtime bootstrap files) complete the assembly, and the staging utility verified all 993 declared files. These overlays preserve compiled-only helpers/generated declarations and are explicitly not presented as recovered original TypeScript.

Focused regression coverage: 68 tests passed initially; two were blocked by deployment fixtures omitted from the local Docker test image. After mounting the existing fixtures read-only, both passed (2/2). No application behavior was changed to make the tests pass. Total confirmed coverage is 70 tests for the unchanged tested source. No provider requests or production changes occurred.

See deploy/releases/bulk-auto-followup-consolidated-20261124/README.md, manifest.json, build-evidence.json and scripts/stage-exact-release.mjs for the reproducible file assembly. Earlier statements above about the requested source gap describe the state before this reconciliation. The later normalization release and exact historical deployment invocation remain separate.

## Current live release update

A subsequent read-only inspection confirmed bulk-consent-ui-20261124, image sha256:6789a69843b3226f66e80b0ccddfafb10809be1e09cd507f69e5c5959a257cc8, healthy with API health HTTP 200. Actual current Compose labels identify /opt/thaara-v2-pilot/compose.json and project thaara-v2-pilot. Original historical shell invocation is not verified.

Current source builds all eight workspaces successfully. Its source-only output matches 944 of 992 declared live compiled/static files. Forty-eight unchanged historical files complete the assembly. The staging utility verified all 992 expected file hashes. The two focused current-source suites passed all 73 tests. No production deployment, restart, credential change or provider call was performed. See deploy/releases/bulk-consent-ui-20261124/README.md and its manifest/build evidence.

The owner designated team.quantumweaveai@gmail.com for company handover and identified QuantumWeaveDev26 as the GitHub account. That account already owns this repository. Company handover ciphertext is in that Google account's restricted folder; private keys and credentials are excluded. Other service invitations remain unissued because account-administration tools/browser access are unavailable.
