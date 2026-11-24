# New current-baseline Phone Chat package — awaiting approval

Verified live base:
`sha256:d19e2e2217e8c41b8ce0eeb677b5585d7968acbd1bea6b37c69639a549d67df9`

Verified existing FROM reference:`thaara-v2-whatsapp-enquiries:10831`. It must resolve to the pinned ID before
and after build. Prior packages/manifests/markers and retained failure directories are NOT reused or changed.

New ZIP:`output/THAARA_PHONE_CHAT_CURRENT_BASELINE_2026-11-05_V3.zip`
SHA256:`855c92e8d49a8e2b4c4470766c068f7403e304beb14bd268c9b8b7871ddc29b8`

Execution manifest:`docs/integrations/phone/PHONE_CHAT_CURRENT_DEPLOY_20261105.review.json`
SHA256:`11c1b4fc0da75ccca4b1d38f8cf3b7723260a1f7aaf55a593923213d4aa78c26`

## Evidence

Read-only healthy live capture includes exact4Phone files,4WhatsApp review dependencies, all360API/web hashes,
current compose/link hashes and other-service identities. All captured Phone inputs are unchanged from the
earlier baseline; newer WhatsApp read/inbox modules, enquiry dependency and web dashboard/Chat assets are
preserved. Only4APIcompiledfiles change; other356hashes identical, allwebfiles unchanged. New Chat/grouping/
incoming filtering/dashboard code is retained, not replaced with root-workspace assets. No WhatsApp source
or worktree edits. No new route/contract/frontend rebuild, appointment activation or F03 changes.

106backend tests/8files passed against exact compiled overlay plus captured live WhatsApp dependencies:
Phone41,WhatsApp60,Calendar5. Initial missing live dependency prevented6suite loads; after capturing the exact
existing dependency, those6files reran71/71; earlier unchanged2Phonefiles35/35 retained. No missing coverage.
Phone approval-card UI21/21 passed. Deployment/diagnostic/rollback mocks17/17 and package guards8/8 passed.
Total127functional tests and25preparation checks. Windows fixture access failure reran with local-test access;
no permission/security bypass in application source. Original9PGacceptance not rerun.

Read-only authentication agents23632,25392,23684 and ownedtempdirs independently absent. No live writes,
Docker builds, validationcontainers, deployments, SQL, calls/messages, agents or credentials changed.

## Exact next authorization — NOT GIVEN

Approve ONE checksum-pinned build+isolated-validation+API-only deployment execution:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-chat-current-deploy.review.ps1 -ApprovedCurrentPhoneChatDeploy -ManifestSha256 11c1b4fc0da75ccca4b1d38f8cf3b7723260a1f7aaf55a593923213d4aa78c26
```

Scope:existing protected encrypted-key/temporary-agent SSH; transfer pinned new ZIP into NEW protected
`/opt/thaara-v2-pilot-private/handoff/phone-chat-current-20261105`; recheck exact image/container/compose/link/
other-service/source hashes and local tag; build once with no pull/network; one isolated no-network/no-ports/
no-mount validation container, exact360-file verification and ownership-checked removal; retain exact current
compose and WhatsApp base image; change only API image/recreate API; restore existing reviewedn8n-link-v2
private link; verify health/auth/publicPhone+WhatsApp and unchangedPostgreSQL/Redis/n8n/Traefik identities.
Stop on any mismatch. No automatic retry. Failed post-switch checks restore THIS SAME baseline/compose
and verify it. Refuse rollback over a concurrent compose change; stop and report any rollback failure.

Retain new protected package/rollback files, sanitized failure receipt and built image for owner review; no
deletion of old images/backups/failed packages. Sanitized stage, operation and numeric exit/timeout retained
locally and remotely on failure; raw stderr/config/environment never emitted. Empty SSH output also retains
numeric exit/safe category. Allow brief API interruption, usually1–3minutes; health/rollback may take longer.

No `.env`/credential modifications, database commands/migrations, Sarvam/agent/routing changes, appointment
activation, real calls/messages, paid provider tests, commits/pushes. All caller consent/PolicyGateway/one-use
approval protections unchanged. A fresh call request and separate call approval follow deployment.

## Limits

Package ready for scoped review/approval; image build, isolated image validation and live deployment/UI
verification have NOT been executed. Baseline drift must stop rather than overwrite newer WhatsApp work.
No independent live acceptance or F03 admission implied. Current build/deploy marker remains absent.
