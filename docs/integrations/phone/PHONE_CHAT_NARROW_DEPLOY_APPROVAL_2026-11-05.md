# Phone Chat — narrow current-baseline deployment approval

## Verified preparation

Current running healthy API container was read twice through strict trusted-host, encrypted-key temporary-agent SSH. Both reads agreed on:

`sha256:0287204a4b9ba3db5febc37e5bf022e0d615f4c600d23a4452288f07a7533161`

Captured 360 API/web file hashes, four exact compiled source files, current compose/link hashes and PostgreSQL/Redis/n8n/Traefik identities. Both temporary agents and owned authentication directories were removed and independently checked. No remote writes, SQL, provider requests, Docker builds or calls occurred.

Reconciled only four compiled files from that baseline. WhatsApp route statements are preserved; all other 356 API/web file hashes are unchanged. Exact compiled-overlay tests:86/86 passed (31 Phone,10 Phone service,40 WhatsApp Chat,5 Calendar =86; Phone total41). Package/source/approval guards:6/6; deployment mocks:6/6; read-only baseline mocks:5/5. No frontend replacement, new endpoint, appointment activation or F03 admission change.

## Pinned artifacts

- ZIP:`output/THAARA_PHONE_CHAT_NARROW_DEPLOY_2026-11-05.zip`
- ZIP SHA256:`ada9bb9714c8e398f028270b6fcd8d77180e81c81af9dc4b7d6e719f48f55d69`
- Execution manifest:`docs/integrations/phone/PHONE_CHAT_NARROW_DEPLOY_20261105.review.json`
- Execution manifest SHA256:`efd321d8ebefe74cea70a2948fe63ac2b9b7cfc9d7078dfc3b066ae6f7db5deb`
- Manifest pins ZIP, SSH wrapper and remote bootstrap. ZIP manifest pins its10 other entries. All11 ZIP entries read back and verified.

## Exact approval requested — NOT YET GIVEN

Approve ONE execution of:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-chat-deploy.review.ps1 -ApprovedPhoneChatDeploy -ManifestSha256 efd321d8ebefe74cea70a2948fe63ac2b9b7cfc9d7078dfc3b066ae6f7db5deb
```

This authorizes only the pinned ZIP above: existing protected SSH authentication; one new protected handoff directory; build a four-file image overlay from the verified current base without pulls/network; one isolated temporary validation container (no network/ports/mounts) with identity-verified removal; API-only image replacement/recreation; existing reviewed n8n-link-v2 private-link restoration; health/auth and unchanged-service checks. The entire360-file expected inventory must match before changing the API. No configuration except the API image may differ. No `.env` or credential-file reads/writes by this package. Compose may internally use its existing configuration, without printing it.

Preserve current WhatsApp image and exact compose bytes for rollback. If post-change checks fail, restore that SAME baseline/compose, restore its existing private link and verify health/other services. If rollback cannot be verified, stop and report the state. Stop on any preflight identity/image/checksum/config mismatch. No automatic deployment retry. Retain protected package/rollback files and new image for owner review; do not delete old images/backups.

Expect a brief API interruption; allow1–3 minutes, longer if health or rollback checks fail. PostgreSQL, Redis, n8n and Traefik must not restart. No workflow or n8n network attachment changes.

No database commands/migrations, appointment enablement, Sarvam agent/routing/credential changes, calls/messages, paid provider tests, commits or pushes. A real call needs another approval after the Chat card is verified.

## Remaining verification

No image build, Docker smoke check, live deployment or UI result has been claimed as completed. Those run only under the exact approval above. Baseline drift stops rather than replacing newer WhatsApp work. Existing Phone calling/history remain operational; old unbound Chat requests are not backfilled or approved. A fresh Chat request after deployment is required. Appointment admission remains blocked by F03.
