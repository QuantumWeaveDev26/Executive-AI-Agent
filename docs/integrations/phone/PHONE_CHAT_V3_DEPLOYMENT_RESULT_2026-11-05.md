# ONE approved V3 attempt — stopped before API switch

Approved ZIP855c92e8d49a8e2b4c4470766c068f7403e304beb14bd268c9b8b7871ddc29b8 and manifest
11c1b4fc0da75ccca4b1d38f8cf3b7723260a1f7aaf55a593923213d4aa78c26 independently matched, all source
pins matched, one-run gate unused. Exact approved command executed ONCE; exit1. No automatic retry/resume.

Build succeeded using the verified existing base tag. Candidate:
`sha256:213c9d89b6db4e3cc861f9adc548a629a0092285a9610bd147b56a3fd6bbc4e3`

Failure:stage=isolated_validation, category=validation_cleanup_unverified; sanitized protected/local receipt
retained. The cleanup guard required case-sensitive `No such object` from Docker inspect. A read-only
nonexistent-ID probe on this actual Docker reports exit1 and lowercase `no such object`, confirming the
compatibility defect. A successful filtered full-ID container listing returns0/empty instead.

Read-only postchecks:exact originalAPIcontainer/image unchanged and healthy; current compose hash and
PostgreSQL/Redis/n8n/Traefik identity/start/restart metadata unchanged. Health/Phone/WhatsAppGET200.
No current-validation containers remain. Candidate/backup/rollback compose files absent, so API switch
and rollback not reached. Owned SSHagents19348,25380,19928/authdirs independently absent. No provider,
SQL,agent,credentials,appointment,message/call actions. One-run marker/old ZIP/source pins preserved.

Event queries returned no records; do NOT claim event-based destruction evidence. No container remained
in independent scoped listing. Full360-file candidate validation outcome was not retained separately from
the finally-block cleanup failure, so it must be revalidated; do not infer it passed.

## Local correction and prepared next scope — NOT executed

Absence verification now requires successful Docker listing filtered by the exact verified64hex ownedID,
with empty stdout. It rejects remaining containers and daemon errors. Eight synthetic cleanup tests pass.
Existing-candidate activation-only script runs NO Docker build. Four synthetic success/rollback/conflict/
config tests pass. Historical127application tests remain unchanged and reused, not fresh live evidence.

New package:`output/THAARA_PHONE_CHAT_EXISTING_CANDIDATE_ACTIVATION_2026-11-05.zip`
SHA256:`aecbcb904955a9b0dac68b816e7a414f64801d5fda5c8db92a81e5356015eaf6`
New manifest:`docs/integrations/phone/PHONE_CHAT_CURRENT_ACTIVATION_20261105.review.json`
SHA256:`c21647f348e2bdf01ecfda884d5fbd592026506f8de06d9a6f6460847835243a`

Exact next scope requiring fresh approval:ONE isolated validation container for the EXISTING213c9d…candidate,
corrected ownership/absence cleanup, then conditional API-only activation/private-link restore/health/auth
and unchanged-service checks; defined rollback ONLY to currentd19e…baseline if post-switch checks fail.
NO rebuild, SQL, Sarvam changes, appointments, calls or messages. New protected handoff directory and
rollback/sanitized receipt retained. Stop on any pin/image/config/identity mismatch or rollback failure.

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-chat-current-activation.review.ps1 -ApprovedCurrentPhoneChatActivation -ManifestSha256 c21647f348e2bdf01ecfda884d5fbd592026506f8de06d9a6f6460847835243a
```

Current LIVE image remains:
`sha256:d19e2e2217e8c41b8ce0eeb677b5585d7968acbd1bea6b37c69639a549d67df9`.
Phone Chat fixes remain unactivated; real call test needs later separate owner approval.
