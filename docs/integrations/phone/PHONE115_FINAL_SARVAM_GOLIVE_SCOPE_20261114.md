# Phone Step 115 — Final End-to-End Sarvam & Standing-Service Go-Live Scope (2026-11-14)

## 1. Verified Pre-Release State
- **Standing Notification Worker Prepared on VPS `1871828`**:
  - Image built & verified: `thaara-phone115-standing-worker:review-20261114-r5` (`sha256:9ffca943a55dcbd960a9e6719da41306dcfe9717cd1a0aa494eca54169819915`).
  - Standing schema installed (`115s-callback-standing-service.install.review.sql`): `public.phone_callback_service_configuration` (`forcedRls = true`, `rows = 0`), `public.phone_callback_service_worker_operation` (`5e2ee6c3adf5faf16f21942b77e390b4818aa2d373b43460599ee4b3f7a83669`).
  - Protected backup & restore verified: `/opt/thaara-v2-pilot-private/phone-backups/phone110-20261114T044231Z-12e91de65ede66a3d63ace42c4620171`.
- **Signed-In Sarvam Live Runtime Inspection (`Thaara-AI-V-db336de4-5453`)**:
  - Live inbound deployment `Thaara-V2---6bdfef25-f9ad` (`+918064269780`, `300s`) remains Active on committed **`v5`**.
  - Committed **`v6`** (OUTBOUND ONLY) and snapshots **`v22`–`v23`** remain untouched.
  - **`v24 · Draft`** has the exact `v5` baseline prompt (`4,811` chars) + verbatim 4-paragraph callback block (`6,477` chars total).
- **Receiver Compatibility Overlay (`artifacts/phone115-sarvam-live-release-20261114-r1/`)**:
  - Adapts `thaara-phone115-receiver` (`FROM sha256:a15f7ad5a40c67be17c941bb386e7ae0b3e992e190993707b19331da4af25513`) to verified live Sarvam platform behavior without changing any PostgreSQL function or weakening trust boundaries:
    1. **Mid-call `save_callback_request` (`During the conversation`)**: Binds non-LLM platform `Agent variable` fields (`interaction_id`, `user_identifier` E.164 `+91...`, `app_id`, `app_version`, `agent_phone_number`); saves confirmed callback requests in held `notification_status = 'needs_review'` (`0` emails sent during call) because Sarvam exposes `interaction_transcript` only in `on_end`.
    2. **End-of-call `complete_inbound_call` (`When the call ends`)**: Authenticated `Bearer` API tool sending platform-locked `app_id`, `app_version`, `deployment_id`, `interaction_id`, `user_phone_number`, `agent_phone_number`, `start_datetime`, `end_datetime`, `duration`, and `interaction_transcript` (`{ transcript: [{ role: "assistant"|"user", content, english_content, tools }] }`), verifying caller confirmation / non-withdrawal before promoting `needs_review` -> `pending`.

## 2. Exact Final Go-Live Actions Requiring Explicit Owner Approval
1. **Receiver Compatibility Overlay & `v24` Profile Update on VPS `1871828`**:
   - Build `thaara-phone115-receiver:sarvam-compat-20261114-r1` offline (`--network=none`, `DOCKER_BUILDKIT=0`) with baseline SHA-256 guards.
   - Archive `phone_callback_api_profile` (`v5`), update `appVersion` to the committed Sarvam inbound version (`24`, `revision: 2`), update `public.phone_inbound_principals` (`profile_fingerprint`, `revision = 2` — keeping `route_id` `qw-callback-dd60ce8ff4e842df8d19ab50674810c2` and `phone_callback_inbound_token` unchanged), and restart `thaara-phone115-receiver` cleanly.
2. **Sarvam `v24` Tool Binding, Commit & Inbound Cutover (`+918064269780`)**:
   - Bind workspace secret `thaara_phone_inbound_callback_token` (created by owner in `Settings → Secrets`) to:
     - `save_callback_request` (`During the conversation`, `Max wait: 10s`, non-LLM `Agent variable` `callContext.*` + `details.*`).
     - `complete_inbound_call` (`When the call ends`, 100% non-LLM `Agent variable` + `Fixed value` completion fields).
   - Commit `v24 · Draft` (leaving `v1`–`v23`, including `v5` rollback anchor and `v6` outbound-only, untouched) and switch deployment `Thaara-V2---6bdfef25-f9ad` (`+918064269780`) from `v5` to `v24`.
3. **Standing-Service Email Worker Activation**:
   - Execute `115s-callback-standing-service.configure.review.sql` (enabling standing automatic notifications from `notifications@brandmintai.io` to `connect@brandmintai.io`, subject `New Callback Request — Thaara AI`, with no recurring 30-day Dashboard approval).
   - Update `thaara-phone115-tls-bridge-f3a0ab369fe5061f` `/32` allowlist for API + receiver + worker and start `thaara-phone115-worker` (`sha256:9ffca943a55dcbd960a9e6719da41306dcfe9717cd1a0aa494eca54169819915`).
4. **Live End-to-End Acceptance Verification**:
   - Verify live inbound call booking speech, ended-call promotion, Resend dispatch, and actual inbox delivery at `connect@brandmintai.io`. Rollback anchor remains committed `v5` + `115s-callback-standing-service.revoke.review.sql`.
