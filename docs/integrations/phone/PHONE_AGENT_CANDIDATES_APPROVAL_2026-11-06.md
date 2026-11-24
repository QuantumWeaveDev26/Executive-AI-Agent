# Sarvam candidate preparation approval — 6 November 2026

Prepared only. No provider changes, live rollout or calls have been made.

Exact prompt manifest SHA256: `57537d91e84dc83ec95d91b3c85843737012394d068343df35243945f77ee4ab`

Proposed scope in the EXISTING Thaara AI Voice Assistant only:
1. Verify latest working copy is still v9 Draft. Stop on a different head. Preserve v9 as a committed version without changing any configuration; this protects existing work before preparing another draft.
2. Prepare one inbound candidate from committed v5 using the exact inbound candidate prompt below. Save as a NEW committed candidate so it cannot be lost when preparing outbound.
3. Prepare one outbound candidate from committed v6 (whose existing business-question evaluation was read back with actual KB tool results) using the exact outbound candidate prompt below. Save as a NEW committed candidate.
4. Maximum three preservation/candidate commits in total; expected v9/v10/v11. Do not overwrite committed v5, v6 or v7. If versioning differs or preservation cannot be verified, stop.

Only prompt changes: reuse the existing strict no-price-disclosure policy; collect consent-backed minimal appointment/callback details; require a successful saved request and separate owner-approved, verified Calendar event before confirming a booking. If the authenticated tool is unavailable, explicitly say the request cannot be saved/confirmed. Retain the exact outbound recipient and approved purpose.

Preserve Chaitra, configured languages, five-minute maximum, attached qw-company-kb-v1, existing tools, phone number/connection and live inbound v5 routing. Do not attach a new live tool, change runtime profiles/routing, run a test, place a call, deploy, read credentials, use SQL, or modify other agents/integrations.

This does NOT authorize appointment activation or a live outbound version switch. F-03, service identity, endpoint deployment and controlled real-test approvals remain outstanding.

Exact prompt inputs:
- `docs/integrations/phone/knowledge/appointment-candidates-20261106/inbound-instructions.candidate.txt` — SHA256 `5e001e4fece07f289af1b9a9f50cb912fd7d11870413def9373fa79c7c37f45b`; base committed v5 source SHA256 `073a8337945dc1df71fd9750e63249c0ab96022952938a1c933840cae360352a`.
- `docs/integrations/phone/knowledge/appointment-candidates-20261106/outbound-instructions.candidate.txt` — SHA256 `1b2e3003effc3b5e067957baa6bb66609c38a113087c86e5ae405e839b329b00`; base committed v6 source SHA256 `33b999ea92a185f9fd7c71f9f42951e67c96635a02a55c83a503c174a5d3ac56`.

Owner approval text: I approve preparation only of these two exact Sarvam prompt candidates, including preservation-only v9 commit and saving the two new candidates, at most three commits total. Keep live inbound v5, committed v7, routing, credentials and all integrations unchanged. No tool activation, deployment, paid tests or real calls.
