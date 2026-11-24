# Existing owner Calendar review — local implementation, not deployed

7November update: the metadata preflight below was executed ONCE successfully and its approval is
consumed. Current verified image44387266137de5747b3bd68a647af0cbbbce9387cd66239dcfcdfb0dd6aab927
differs from the historical baseline. Do not repeat that command. Next bounded source-reconciliation
scope is prepared in `PHONE_RELEASE_SOURCE_APPROVAL_2026-11-07.md`; it has NOT been authorized/executed.

The owner can propose an appointment for an existing completed, non-simulated outbound call using
the existing Calendar plan/approval/PolicyGateway and event readback. The new optional startup switch
is `THAARA_PHONE_OWNER_CALENDAR_REVIEW=approved`; it is OFF unless explicitly configured, requires
the existing durable Phone ledger, and requires the existing live Calendar connector outside tests.
No environment setting has been changed. No new database objects are required for this owner action.
Before activation, verify that the pilot Google loader is ready with the existing live Calendar
connector. If it is missing/refused, do not enable the switch: app startup rejects that configuration.
The7November browser is signed out of Thaara; owner sign-in is required for a fresh connection check.

This is not automatic in-call capture. Sarvam receives no owner session or Calendar permission.
The generic/inbound appointment admission gates remain unchanged. New inbound journal/principal
installation still requires F03. Confirmed booking still requires a verified receipt and exact event
readback after separate owner approval. A saved proposal is not a confirmed appointment.

Local evidence:144/144checks across15files,0failed/skipped; API typecheck/build PASS. Tests include
absence of112h/113htables, owner/session rejection, defaultOFF, inbound production refusal,
Calendar approval/idempotency/event readback, existing Phone/WhatsApp/Calendar APIs and Phone UI.
Source review found no concrete blocker; this is not production execution approval.

## Fresh baseline check — one approval needed before release reconciliation

The last retained VPS image/profile is historical6November data. The shared image may have changed
through Antigravity's WhatsApp deployment. Never deploy the local app.ts or frontend over that image
without reconciling the actual current baseline and retaining WhatsApp features/assets.

Prepared exact command (NOT executed):

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-owner-calendar-preflight-20261107.readonly.ps1 -ApprovedPhoneRuntimeReadOnly -ManifestSha256 f141b80ee4666465e82e637caf78b4f628d61c51566d26f52f6b54b340d3dcc8
```

Manifest: `PHONE_OWNER_CALENDAR_PREFLIGHT_20261107.review.json`

SHA256:`f141b80ee4666465e82e637caf78b4f628d61c51566d26f52f6b54b340d3dcc8`.

One SSH connection, existing encrypted dedicated key through the same temporary-agent mechanism,
strict trusted-host pin; no plaintext key file. Only existing API container identity/image/health
before and after reading the exact non-secret `/run/secrets/sarvam_profile` metadata. No API-key or
webhook-secret reads, provider request, SQL, Docker build/infrastructure, service/configuration change,
deployment, agent switch, real call/message/appointment, commit or push. Stop on mismatch/error,
no retry. Fresh one-use marker/result; preserve all older markers. Verify owned auth cleanup.

The wrapper preserves every earlier reviewed authentication/remote-command byte except fresh paths
and an added manifest-hash check before authentication. Two local source-integrity tests and
ReviewOnly PASS. An initial generated draft had a PowerShell parse error; corrected locally before
approval. No authentication or remote command occurred. Both new execution marker/result are absent.

Owner approval text: **Approve ONE read-only owner-Calendar release preflight using the exact command
and manifest above, including existing encrypted-key agent authentication and verified cleanup.
No deployment, SQL, provider requests, configuration changes or real calls.**

After that inventory and owner Calendar readiness check, prepare a separate checksum-pinned,
current-baseline release for owner approval. Preserve Antigravity's current API/web assets; a local
source review bundle is not an approved deployable overlay against an unknown live image.
This document does not authorize execution and does not claim full Phone integration is complete.
