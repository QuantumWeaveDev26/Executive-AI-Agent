# Task 096: Phone Call Dashboard & History UI

## Status
- **Classification**: `MOCK UI IMPLEMENTED; real telephony provider, recording, and transcription NOT CONFIGURED`
- **Branch**: `dev-thaara-continuation`
- **Base Checkpoint**: `b5a551e`

## Summary of Changes
1. **Typed Phone Client (`apps/web/src/phone-api.ts`)**:
   - Implemented client wrappers for `GET /api/v1/connectors/phone/status`, `POST /api/v1/connectors/phone/calls/list`, `GET /api/v1/connectors/phone/calls/:callId`, and `DELETE /api/v1/connectors/phone/connection`.
   - Enforced client-side response schema checks: `connectorName === 'phone_telephony'`, masked phone number pattern (`^\+\d{1,3} \*{6}\d{4}$`), `recordingEnabled === false`, `transcriptionEnabled === false`, `untrusted === true`, `mode === 'mock'`, valid directions (`inbound | outbound_simulated`), and valid lifecycle states (`queued | ringing | answered | completed | failed | cancelled`).
2. **State Model (`apps/web/src/phone-model.ts`)**:
   - Implemented `PhoneScreenModel` with client-side role gating (`owner`, `admin`, `member` permitted; `viewer` blocked before network calls).
   - Added search query, call direction (`inbound` / `outbound_simulated`), and lifecycle state (`queued`, `ringing`, `answered`, `completed`, `failed`, `cancelled`) filtering, pagination (`nextPageToken`), selected call preview, local disconnect, request version fencing, and fail-closed state clearing on `401`/`403`/`409`/`503`.
3. **Dashboard UI (`apps/web/src/PhoneScreen.tsx` & `apps/web/src/App.tsx`)**:
   - Built `PhoneScreen.tsx` showing connection status, masked line number, recording & transcription disabled notice, call history list, incoming/outgoing call type, all 6 call lifecycle badges, masked phone numbers, timestamps (`startedAt`, `endedAt`) and formatted duration, search/direction/lifecycle filters, refresh, loading/empty/error/unauthorized states, plain-text untrusted call purpose preview, and disabled `Connect Phone Telephony` and `Request Outbound Call` buttons.
   - Mounted `<PhoneScreen />` in `apps/web/src/App.tsx` keyed by `workspaceId`, `userId`, and `role`.
4. **Focused UI & Security Tests (`apps/web/test/phone-screen.test.tsx`)**:
   - Added 5 tests covering `viewer` role restriction, mock status & 6 lifecycle states, search/direction/lifecycle filtering, call detail selection, local disconnect, unmasked phone number rejection, and `401`/`403` fail-closed state wiping.
