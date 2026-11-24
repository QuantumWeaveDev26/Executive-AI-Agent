# Thaara V2 Antigravity handoff — 11 November 2026

Continue the existing project at `C:\ThaaraProjects\thaara-ai-agent-v2`, branch `dev-thaara-continuation`, HEAD `413f5a5`. Verify actual state before working. Preserve all uncommitted and untracked work. Do not rebuild, commit, push, interrupt other development agents or modify WhatsApp/Bulk Campaign files.

Read `AGENTS.md`, `docs/THAARA_PROJECT_HANDOFF.md`, the top entry in `docs/THAARA_DAILY_HANDOVER_2026-11-11.md`, `docs/THAARA_MASTER_BUILDER.md`, and active task `docs/tasks/115-phone-callback-notification.md`.

## Immediate owner request — pending knowledge/prompt update

The owner manually tested inbound Thaara and says the remaining conversation behavior works correctly. Make only the following requested changes, preserving the working voice/language/interruption/disclosure behavior:

1. Add **Custom solutions** to the Quantum Weave general service list. When asked what custom solutions are offered, enumerate these exact five services:
   - AI-Powered personalisation/customisation
   - AI integration
   - AI workforce building/Workforce Multiplier
   - AI Workflow and automation building
   - Executive AI Assistant building for business leaders
2. Naturally offer a callback after a few meaningful exchanges, once the customer has discussed their needs. Do not wait until the closing. Answer the current question first, ask one question per turn, respect refusal and avoid repeatedly pushing a callback.
3. Reuse known details and collect missing name, kind of business and requested service. Use the backend-verified incoming phone number for inbound requests; do not ask the caller to repeat it or substitute an extracted/model-supplied number.
4. Recap details and obtain explicit callback consent. Callback confirmation must not trigger hang-up. Acknowledge and continue the useful conversation until the caller finishes or the existing safety/duration limit requires ending. Preserve the five-minute cap and interruption handling.
5. Callback notifications go only to `connect@brandmintai.io`, through the dedicated Resend path, separate from Gmail. Preserve truthful persistence/submission/delivery states. Never claim a save or sent/delivered email without corresponding backend evidence.

The new five-service KB text and provider prompt change have **not yet been written or published**. Start here. Existing public KB is `docs/integrations/phone/knowledge/linktree-v3/quantum-weave-public.md`. It is hash-pinned by existing artifacts; create a new versioned candidate instead of silently editing the immutable v3 baseline. Existing callback guidance is `docs/integrations/phone/knowledge/runtime-v19-v21-20261108-review/CALLBACK_COLLECTION.review.md`. Its “Offer a callback once near the end” rule must be superseded. Older inbound candidate instructions also say to end when answered; replace that conflicting rule in the reviewed new candidate. Do not append contradictory guidance or revert later voice fixes by blindly deploying the old v3 prompt. Verify the actual current Sarvam versions/bindings before any exact promotion proposal; old v19/v21 documents are historical, not proof of the live configuration.

## Latest local code changes — tested, not deployed

- `apps/api/src/services/phone-callback-notification.ts`: a generic “No/No, thanks/ಇಲ್ಲ/नहीं” to an unrelated later question no longer invalidates an already confirmed callback. Explicit callback withdrawal still cancels, and refusal to the callback recap remains enforced.
- `apps/api/src/services/phone-sarvam-callback-completion.ts`: inbound completion ignores extracted `callback_phone_number`, retaining the admitted incoming number. Outbound number behavior remains unchanged.
- New regressions in `apps/api/test/phone-callback-continued-conversation.test.ts` reproduced five failures before the fixes.
- Fresh focused run: **39 passed, zero failed, three files** (new continuation tests, callback-notification tests, Sarvam inbound-service tests). Receipt `node_modules/.cache/phone-step115-continued-callback-tests.result.json`.
- The API build and compiled artifacts have not been refreshed since these two latest TypeScript edits. Run appropriate build/typecheck and focused integration tests before packaging. Do not call old release ZIPs current or deployable.

## Verified database work already completed — do not repeat

Found running Docker Desktop at `C:\Users\Admin\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe`, local `desktop-linux` context. No installation was needed. Cached PostgreSQL image matches production: `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`, server version `160015`.

The real isolated PG16.15 rehearsal passed exact installation, pre-commit rollback, shared synthetic-data preservation, forced RLS, four restricted NOLOGIN roles, real backup/restore before and after installation, schema/ACL/role/membership/database access checks, and cleanup. Seven offline rehearsal tests passed. See `docs/integrations/phone/STEP115_PG16_REHEARSAL_20261111.md` and `node_modules/.cache/phone-step115-pg16-local-rehearsal.result.json`.

The owner separately approved protected VPS backup/isolated restore followed by the exact disabled Step115 transaction. Both succeeded. See `docs/integrations/phone/STEP115_INSTALLATION_RESULT_20261111.md`.

- VPS `1871828`; DB `thaara_vps_pilot`.
- Current verified API image: `sha256:3985893e8cef0ac5117af145e4785c5ae60bb95e3c997a74532b164860bd1cf9` (WhatsApp team's update), container `266e7ea1f430fdbc433d5e3dae449068f41628411c3f57644a2a71fe1eae3d60`.
- SQL already applied: `docs/migrations/115-step115-hosted-install-20261111-r2.review.sql`, SHA-256 `c809ba7c0a44f9bdf3b76a1566edf1fbe6fc33e39a1d0c1d25e58a53025dcf8e`.
- Post-install metadata: 10 forced-RLS Phone tables / 106 columns, seven selected roles, twelve selected functions. Both original provider function hashes preserved. API remained healthy.
- Installation receipt `node_modules/.cache/phone-step115-disabled-install-20261111-r2.result.json`, SHA-256 `1808e7c139a801195fedd5ab5ed6c030a489e19f7c4c23f9dc0aa4884b98f9a8`.
- Protected backup/restore receipt `node_modules/.cache/phone-step115-protected-backup-20261111.result.json`, SHA-256 `aba15c91f51e3fcee208b76484849740ad93a071a4f9144bbf14be24156515af`. Private backup contents remain on the VPS. No backup contents or credentials were exported.
- Keep all consumed markers and backups. Do not rerun the already applied guarded transaction. The earlier stopped attempt correctly refused API drift before SQL.

## Runtime compatibility and remaining integration

The owner approved one checksum-only comparison, which completed successfully: `node_modules/.cache/phone-step115-runtime-hashes-20261111.result.json`. Local comparison is `node_modules/.cache/phone-step115-runtime-compatibility.result.json`.

Eight of nine release files differ from this workspace's compiled outputs. Only `whatsapp-durable.js` matches. App, pilot startup, Phone startup, contracts index, WhatsApp enquiries, Phone calling, Sarvam webhook and web index differ. Do not copy whole local shared files into production. No matching current-image artifact was found in the targeted local docs/cache search, and the exact API image is not cached in local Docker. The nine-hash authorization is consumed and did not authorize source export. Further privileged inspection/source reconciliation must respect a concrete appropriate scope; never access credentials or overwrite another team's changes.

The callback pipeline, durable grants/worker, inbound/outbound bindings and Phone/Chat callback display exist locally. Historical local evidence includes 97 API acceptance tests and 86 UI tests, plus TypeScript/web builds; the latest two fixes require a refreshed API build. Owner report routes, authorization repository and provider composition still retain production admission guards. Dedicated managed credentials, service identities, verified startup reconciliation, runtime deployment/activation, full automatic new-message Chat report persistence and separate live call/email acceptance remain pending. Callback email sending has **not** been activated by this work.

Latest existing archive is R5 (`node_modules/.cache/PHONE_STEP115_RELEASE_REVIEW_20261111_r5.zip`, SHA-256 `86f87c374753cc7c464ba79bcb4f72fa7ea8624a0be139cacee49c511945f956`). It is historical review-only evidence and excludes the latest fixes and later production receipts. No new current archive was generated after those edits.

## Authorization and operating limits

No deployment, service restart, credential provisioning, sending enablement, real call, real email, commit or push has been authorized by the latest backup/SQL/checksum approvals. The owner performed their own inbound test; it does not authorize automated calls or mail. Prepare the requested KB/prompt/backend changes and exact reviewable release before requesting the relevant separate sensitive-action approval. Never remove admission guards just to make the feature appear live. Do not repeat completed DNS setup: Resend DKIM/rsend/send were verified. Sending-key configuration remains unverified; never request secret values in chat.

Work efficiently within Step115. Keep brief `THAARA DEVELOPMENT UPDATE` reports, use focused tests, preserve tenant scope/PolicyGateway/audit/idempotency/explicit approvals, and maintain truthful pending/failed/unverified states. No background-work promises. The immediate next action is the five-service knowledge candidate plus earlier callback/continued-conversation guidance, followed by build/test verification of the latest local fixes.
