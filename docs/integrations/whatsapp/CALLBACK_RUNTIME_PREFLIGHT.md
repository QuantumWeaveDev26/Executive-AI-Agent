# Step 108.5 callback runtime preflight — 27 October 2026

EXECUTION UPDATE: owner approved this package;35/35 passed initially and again with full owner/API integration assertions. [Actual results](CALLBACK_RUNTIME_RESULTS.md). The preflight's UNRUN/approval-pending wording below is historical preparation evidence, not current status. No production installation or LIVE messaging authorization follows from those results.

Status: source and static review prepared; **35 PostgreSQL tests NOT RUN**. This is the same coordinated WhatsApp master task. No real-message readiness claim. New infrastructure and new SQL require a separate explicit approval under the owner's engineering contract; the earlier Step1084 approval covered a different schema/fixture.

Final Git checkpoint: dev-thaara-continuation /6936e386f0b811614cbaa2acf0fc85378d24bc4c;10 tracked modifications,63 untracked files, zero staged. Existing dirty work retained, including Calendar fixture/Vite changes. No commit/push. No Gmail/Calendar/Vite edits in this callback slice.

## Prepared implementation and evidence

Default callback routes now use the durable service rather than an implicit memory bridge. A separate server-only callback principal binds a token hash to one owner/workspace/connection/revision, permitted operation, expiry and revocation. It never fabricates a browser session. Every database transaction checks restricted login privileges and resolves/rechecks the current actor; mixed cookie/session and callback authority is denied. Missing schema/storage fails closed. Claims still return dispatchEnabled=false and receipts verified=false.

Fresh focused verification: **188/188 tests across16 files**, zero failed/skipped, exit0,83.20s. Includes callback HTTP/domain and transaction fixtures, repository/scope boundaries, authentication/CSRF, cross-tenant isolation, inbox/UI and existing transport/bridge checks. API build and DB typecheck passed. Node runner/guard and PowerShell runner syntax checks passed; git diff --check passed. These tests do not execute the new SQL. The941-case regression is historical evidence for the earlier inbox registration milestone, not a fresh full regression of this revision.

Independent static review found an events-only principal could associate a provider receipt through direct SQL. The corrected trigger now rejects that transition; the actual PostgreSQL negative case is prepared. Reviewer rechecked this correction and fixture boundaries without running infrastructure or SQL. SQL privileges/RLS/locking remain runtime-unverified.

## Exact isolated target and safeguards

| Boundary | Required value |
|---|---|
| New container | thaara-step1085-callback-postgres |
| New internal network | thaara-step1085-isolated |
| Database | thaara_step1085_test |
| Host binding | 127.0.0.1:15433 only |
| Image | postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea, already cached; no image pull |
| Storage | Fresh tmpfs only; read-only root filesystem; no existing/persistent volumes or bind mounts |
| Limits | 768MB memory,1 CPU,64MB shared memory; data tmpfs512MB |
| Credentials | Fresh synthetic admin/restricted-app passwords; Windows DPAPI cache; process environment only for execution; no plaintext credential files, chat or logs |
| Network fallback | If Docker internal-network publication is unavailable, loopback-only binary relay targets this new immutable container ID; never another database |

The runner rejects inherited generic database/Redis/PG overrides; verifies names, immutable IDs, image, labels, mounts, network, restart count and binding before database work. Name/port conflicts abort. It never reads Docker Config.Env. The SQL itself requires the exact new database and explicit approval settings. No existing Thaara database, container, volume, Redis, old fixture, service or application is modified/restarted. Infrastructure consumes some shared host resources; limits bound the new container's use.

## Reviewed SQL and pins

1. Twelve existing base migrations: sorted filename/raw-SHA manifest digest `29498d7da36994347371a77f0e93467c7898db6c01b0223db6916499fb2d59a2`.
2. Original1083 artifact, unchanged: `4ad4e53f5d1c30b6a2806728359b79ab47695399c79db354bcac1d479d18228e`.
3. New [callback principal SQL](../../migrations/1085-whatsapp-callback-principal.review.sql): `0bee4ba36c23ec620bae3074efe637c6ee8355cf0de4ad5df78135525ed1c774`.

The new patch adds a forced-RLS principal table, scoped callback policies and narrowly owned scope/approval accessors. It replaces two WhatsApp-specific functions to preserve transaction-bound audit proof/state guards while admitting the distinct actor. No DROP/TRUNCATE/data purge, global authentication replacement, LIVE mode or preconfigured principal. App/worker cannot read principal hashes, mutate approvals through callback authority or assume the nonlogin guard role. Temporary guard schema-CREATE is revoked. Runtime tests must establish effective privileges, not merely inspect SQL text. Changes are fixture-only; these artifacts are not a production migration plan.

## Prepared runtime acceptance

The original21 cases are preserved and run against this new target, plus14 callback cases: real HTTP injection backed by PostgreSQL; hidden hashes/role and approval-mutation denial; browser owner/workspace isolation; forged context; wrong token/connection/operation; mixed identity; revocation; wall-clock expiry; membership demotion; disconnect/revision fencing; independent-pool concurrent one-use claims; exact fresh approval; receipt correlation; direct-SQL events-only receipt-association denial/rollback; historical audit replay. Existing cases cover persistence across pool recreation, audit failure/rollback, immutable state and duplicate protection. No real provider call/send is possible in these fixtures.

## Commands — only AFTER explicit approval

Run from `C:\ThaaraProjects\thaara-ai-agent-v2`:

```powershell
pnpm.cmd --filter @thaara/db build
pnpm.cmd --filter @thaara/api build
& 'C:/ThaaraProjects/thaara-ai-agent-v2/scripts/step1085-runtime.ps1' -Mode initialize -Approved
```

Initialization creates only the new fixture, applies the pinned schemas, and runs both runtime files (35 cases). Repeat against its verified identity, without reinstalling SQL:

```powershell
& 'C:/ThaaraProjects/thaara-ai-agent-v2/scripts/step1085-runtime.ps1' -Mode test -Approved
```

Do not execute either runner yet. Approval requested: this exact new fixture, fresh test-only credentials, pinned schema installation,35 cases, and necessary corrections/repeats confined to it. If an installed patch changes, stop using the old checksum and re-review/pin; recreating only this new owned fixture must stay within the approved correction scope. No automatic cleanup of other resources. A mismatch aborts; never retarget an existing database.

## Remaining after this gate

Actual runtime results first; then durable outbound profile/managed-secret authorization, hosted authenticated HTTPS round trip, Meta asset/version/signature/business-use/AI eligibility checks, separately approved configuration/deployment and tightly scoped message pilot. Dedicated Meta credentials are owner-reported created/tested: do not ask for recreation or secret disclosure. Stored screen has focused model/static coverage; mounted browser/CSP and actual catalog SQL acceptance remain open. Real sending, workflow activation, Meta calls, app restarts, commits/pushes and deployment remain excluded.
