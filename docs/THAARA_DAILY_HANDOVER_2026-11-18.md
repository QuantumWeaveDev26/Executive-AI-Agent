# THAARA V2 — DAILY HANDOVER (18 November 2026)

## 1. Executive Summary
- **Milestone**: Option A Zero-Restart Live Production Verification, Verified PostgreSQL Backup, Cross-Integration Regression Suite, and Targeted Sample-Demo Correction (Prepared & Locked).
- **Production Status**:
  - **Live API Container**: `thaara-v2-pilot-api-1` (`ba65bea152269402f569e0ca5a4b64171e7926ac64dcbd780b2a6d42bc6dd0e0`) — **RUNNING & HEALTHY WITHOUT RESTART** (`StartedAt: 2026-11-17T12:46:28.76664734Z`, `RestartCount: 0`).
  - **Live API Image**: `thaara-v2-pilot-api:phone-n8n-sync-r1` (`sha256:898adf507bcef93d515729fdc547d37d993dd220ab2563ec1af9672d6440db7d`).
  - **Zero Database / Config / Workflow Mutations**: Pre-test and post-test row counts across all 37 PostgreSQL tables in `thaara_vps_pilot` are **100% identical** (`diffs: {}`); all tests executed inside PostgreSQL `BEGIN ... SAVEPOINT ... ROLLBACK` as non-superuser `thaara_app` with external `fetch` hard-blocked (`blockedExternalNetworkCallsCount: 0`).
  - **Zero Real Calls or Messages**: `THAARA_BULK_CAMPAIGN_LIVE_ENABLED` is unset; `liveCallingEnabled = false`, `liveSendingEnabled = false`, `emailPlan.liveSendingEnabled = false`, and `mode: 'live'` is rejected with `400 LIVE_COMMUNICATIONS_DISABLED`.

---

## 2. Verified PostgreSQL Backup
- **Backup File**: `/opt/thaara-v2-pilot-private/backups/backup_bulk_campaign_live_verify_1794982662.dump`
- **Size**: `1,348,912` bytes
- **SHA-256**: `2844b9fe36904fe0a22c4ed10dc0a110f538e5818e3b344fe0e40e863ae1db74`
- **`pg_restore -l` TOC Check**: **PASSED** (`823` schema/data objects verified, including `plans`, `approval_requests`, `audit_events`, `job_runs`, `whatsapp_n8n_*`, `phone_*`).

---

## 3. Live Bulk Campaigns Usability & End-to-End Results
- **Usability Verdict**: **GENUINELY USABLE IN PRODUCTION FOR UPLOADED CONTACTS & CHAT CAMPAIGNS (SIMULATION-ONLY)**, with **1 isolated defect** on the built-in **"Load 5-Contact Sample Simulation"** per-call approval button (fix prepared locally, undeployed).
- **Verified Working in Live Production (`200 OK`)**:
  1. **Dashboard & Navigation**: `https://thaara-v2.quantumweaveai.io/integrations/bulk-campaign` (`/bulk-campaign`, `/bulk-campaigns`) serves `index.html` (`3c3b2ab6...`) and bundle `index-Dw7huqnA.js` (`34e3a799...`) with **"Bulk Campaigns"** visible under Integrations in sidebar navigation.
  2. **Contact Imports**: CSV (`custom-leads.csv`), Excel OOXML (`.xlsx`), compressed FlateDecode PDF (`.pdf`), Paste, and Saved Contacts import (`POST /api/v1/campaigns/bulk/import-saved-contacts`) — 5-bucket classification (`eligible`, `unauthorized`, `unsupported`, `duplicates`, `invalidEntries`) verified.
  3. **Campaign Draft Editing & DND Safety**: `PATCH /api/v1/campaigns/bulk/:id` updates webinar details, channels (`whatsapp`, `phone`, `email`), message/script previews, call caps, and `ownerVerifiedConsent` while keeping DND contacts strictly blocked.
  4. **Chat Campaign Creation & Approval Cards**: Dashboard `POST /api/v1/campaigns/bulk/chat-create` (English & Kanglish), main Chat SSE `POST /api/v1/conversations/:id/stream` emitting governed `plan_id` + `approval_id` (`campaign.bulk.execute`), `POST /api/v1/approvals/:id/decide` (`200 approved`), and Chat follow-up queries (`Who confirmed?`, `Show customers needing a callback.`) truthfully labelled `SIMULATION-ONLY RESULTS`.
  5. **Owner Approvals, Scheduling, Simulation & CSV Reporting (Uploaded Contacts)**:
     - Per-call draft preparation (`POST .../phone-drafts/prepare` -> `200`), per-call approval (`POST .../phone-drafts/approve-all` -> `200`), campaign owner approval (`POST .../approve` -> `200`), future scheduling (`POST .../schedule` -> `200` + pre-start safety block), simulation execution (`POST .../execute` `{ mode: 'simulation' }` -> `200 completed`), cold-start PostgreSQL `public.plans` reload (`200`), and CSV export (`GET .../export.csv` -> `200`).
- **1 Defect Identified & Smallest Compatible Fix Prepared (Not Deployed)**:
  - **Defect**: Clicking **"Load 5-Contact Sample Simulation"** (`useSyntheticDemo: true`, synthetic IDs `pdir_1`..`pdir_5`) -> **"Prepare Per-Call Drafts"** (`200 OK`) -> **"Approve All Prepared Calls"** returns `400 PHONE_CALLING_DENIED: Unknown approvalId <uuid>` because `createScopedPhoneCampaignAdapter` created a new in-memory `MockBulkCampaignPhoneAdapter` per HTTP request without rehydrating synthetic `pdir_*` drafts persisted in `campaign.contacts` (note: WhatsApp + Email sample simulation without per-call approval still completes `200 OK`, and real uploaded CSV/XLSX/PDF per-call approvals work `200 OK` via PostgreSQL `approval_requests`).
  - **Smallest Compatible Fix Prepared Locally (`OWNER_APPROVED_BULK_CAMPAIGN = False`)**:
    - Updated `apps/api/src/services/bulk-campaign.ts` (`MockBulkCampaignPhoneAdapter` & `createScopedPhoneCampaignAdapter`) to rehydrate synthetic `pdir_*` demo drafts from persisted `campaign.contacts` when `useDemoFallbackWhenEmpty` is active in simulation mode, covered by new Test 18 (`18/18` API + `4/4` UI tests passing).
    - Revised Staged Package (`publication.tar.gz`) SHA-256: `4f92480bb042dc8614d5fb40468d373d2782b8fedb7a9e6d1cfaf157207ed1c0` (262,846 bytes), locked and **not deployed**.

---

## 4. Cross-Integration Regression Results (Live Container & Active Workflows)
- **Phone Calling**: `GET /api/v1/connectors/phone/ai/status` (`200`, `live_enabled`), `/contacts` (`200`), `/calls` (`200`), `/requests` (`200`); `thaara-phone115-receiver` and `thaara-phone115-worker` running untouched.
- **n8n Call History & Callback Email**: `ThaarSarvamSync1` (`active=1`, recent executions `success`) and `ThaaraCbNotif001` (`active=1`, recent executions `success`); `GET /api/v1/connectors/phone/call-history/inbound` (`200`), `GET /api/v1/connectors/phone/callbacks/reports` (`200`), `/connectors/phone/n8n/checkpoint` auth enforcement (`401`/`403`) verified.
- **Chat Voice**: `GET /api/v1/chat/voice/status` (`200`), `/assets/chat-voice-processor-v1.js` (`200`, `16a700c9...`).
- **WhatsApp**: `GET /api/v1/connectors/whatsapp/status` (`200`), `GET /api/v1/connectors/whatsapp/n8n/durable/connections` (`200`), n8n workflows `ezIrlr7y9dEowujw` & `RrqXTplIBXginMSD` (`active=1`).
- **Gmail**: `GET /api/v1/connectors/gmail/status` (`200`).
- **Google Calendar**: `GET /api/v1/connectors/google-calendar/status` (`200`).
- **Google Drive**: `GET /api/v1/connectors/google-drive/status` (`200`), n8n workflow `upU4clCyj1VvJlpk` (`active=1`). *(Minor unrelated SPA note: direct browser hard-refresh on `/integrations/drive` and `/integrations/phone/outbound` returns `404` because `pilot-start.mjs` omits those two paths from its static route list, while sidebar navigation works normally; left untouched per scope rules.)*


---

## 5. Milestone 2 — Bulk Campaigns Final UI & Intelligent Outreach Integration (Prepared & Locked)
- **Live Production Baseline Re-Verified Read-Only**:
  - Container `thaara-v2-pilot-api-1` (`f7cad0cea738c009a33115d6071fc43e771bcf9a9ae3b16622609bf26bd3e059`) is running **`thaara-v2-pilot-api:phone-n8n-sync-r2`** (`sha256:29c2582088b81ba22f3ec498d7198f193acfe359983d41176629c72b2db2108c`) — completely untouched (`OWNER_APPROVED_BULK_CAMPAIGN = False`).
- **Delivered Enhancements (Reusing Existing Thaara Services — Zero Duplicate Agents)**:
  1. **Simplified Campaign Creation UI (`BulkCampaignCreateView` in `apps/web/src/BulkCampaignPanel.tsx`)**:
     - Follows the owner's reference card: **Create a Campaign**, natural-language instruction field with right-side **`+` Campaign Knowledge attachment button** (`PDF`, `DOCX`, `TXT`, `CSV`, `XLSX`) and removable chips, strictly separate **"Upload your contacts"** dropzone/paste area, selectable **WhatsApp / AI Calling / Email** channel pills, primary **`Prepare Campaign`** CTA, and collapsed **Advanced Details**.
  2. **Campaign-Scoped Knowledge Engine (`apps/api/src/services/bulk-campaign-knowledge.ts`)**:
     - Reuses `extractTextFromPdf` & `extractTextFromDocx` from `chat-attachments.ts` plus structured OOXML `.xlsx` (`sharedStrings.xml` + `sheet1.xml`), `.csv`, and `.txt` extraction, magic-byte/executable rejection, prompt-injection stripping, conflict & missing-detail detection, and approved Quantum Weave Company KB (`quantum-weave.v1.ts`) fallback with strict anti-hallucination pricing/guarantee rules.
  3. **Existing Communication Integrations Connected**:
     - **Phone (`Thaara AI — Sarvam outbound v6`)**: Feeds the bounded verified `sarvamBoundedFactBrief` (`<= 1000` chars) via existing `PhoneCallingService` -> `createSarvamCallProvider` (`agent_variables.call_purpose`) without creating or modifying any Sarvam agent. *(Live-provider boundary: Sarvam's outbound REST API accepts `<= 1000` chars in `agent_variables.call_purpose` at call start rather than mid-call server RAG callbacks over multi-MB files.)*
     - **WhatsApp (`DurableWhatsAppService` + `WhatsAppAIService`)**: Injects workspace-scoped and campaign-scoped `<campaign_reference_data>` into customer follow-up replies without creating a second bot or affecting non-campaign WhatsApp enquiries / Google Sheets leads.
     - **Email (`GmailFoundation`)**: Detects connected Gmail account & `gmail.send` readiness and wires governed `gmail.messages.send_new` approval/audit execution while keeping live campaign sending disabled (`liveSendingEnabled = false`) and isolated from Phone Step 115 callback notifications.
- **Offline Verification & Cross-Integration Regression Evidence**:
  - `apps/api/test/bulk-campaign.test.ts`: **24/24 passed** (including Tests A–G).
  - `apps/web/test/bulk-campaign-ui.test.tsx`: **5/5 passed**.
  - Cross-integration regressions (**Test H**): `canvas-blue-redesign.test.tsx` (`9/9`), `whatsapp-ai-service.test.ts` (pass), `whatsapp-durable.test.ts` (`37/37`), `phone-calling.test.ts` (`32/32`), `phone-n8n-sync.test.ts` (pass), `phone-callback-mail.test.ts` (`8/8`), `chat-voice-http.test.ts` (`10/10`), `gmail-send-new.test.ts` (pass), `google-calendar-foundation.test.ts` (`6/6`), `google-drive-api.test.ts` (`6/6`), plus zero TypeScript errors across `@thaara/contracts`, `@thaara/api`, and `@thaara/web`.
- **Staged Compatible Release Artifact (Rebased onto `phone-n8n-sync-r2`, Locked)**:
  - Base Image: `thaara-v2-pilot-api:phone-n8n-sync-r2` (`sha256:29c2582088b81ba22f3ec498d7198f193acfe359983d41176629c72b2db2108c`)
  - Staged Archive (`publication.tar.gz`) SHA-256: `bf7a3eb7b360e98bca68bfc4d8a684613aa59b7c602449e3e012b1876fe89691` (`318,231` bytes, `18` files)
  - Publisher (`deploy/hostinger-pilot/publish-bulk-campaign.py`) SHA-256: `645b46841964af250ee701f5dc950e875f04b717fb4ecb86dd93aa64b995538a` (`OWNER_APPROVED_BULK_CAMPAIGN = False`)


---

## 6. Controlled Simulation-Only Production Deployment & Post-Deploy Verification (Completed)
- **Pre-Deploy Verification Passed**:
  - Confirmed live baseline unchanged on `thaara-v2-pilot-api:phone-n8n-sync-r2` (`sha256:29c2582088b81ba22f3ec498d7198f193acfe359983d41176629c72b2db2108c`) with `0` in-flight jobs/callbacks and `THAARA_BULK_CAMPAIGN_LIVE_ENABLED` unset.
  - Confirmed `11/11` preserved backend modules (`phone-n8n-sync.js`, `phone-callback-mail.js`, `phone-callback-reports.js`, `phone-callback-authorization.js`, `phone-sarvam-calls.js`, `phone-calling.js`, `chat-voice-sarvam.js`, `gmail.js`, `google-calendar.js`, `google-drive.js`) are byte-identical in the built candidate image.
  - Tagged rollback image: `thaara-v2-pilot-api:rollback-pre-bulk-campaign-sim` -> `sha256:29c2582088b81ba22f3ec498d7198f193acfe359983d41176629c72b2db2108c`.
  - Created & verified PostgreSQL backup: `/opt/thaara-v2-pilot-private/backups/backup_pre_bulk_campaign_sim_1794996556.dump` (`1,382,253` bytes, SHA-256 `859f86c6de74148e37fbb6256c40f5916d5b198a8fea467b8ae69ac824b8d608`, `872` `pg_restore -l` TOC objects).
- **Deployed Production Release**:
  - **Deployed Image**: `thaara-v2-pilot-api:bulk-campaign-sim-r2` (`sha256:e153908bfd8bdeeb75143f3cb142e09b34946fc81fc251389b2de373e5d9d973`)
  - **Running Container**: `thaara-v2-pilot-api-1` (`365b0e6e1fb3dd915f221b61f3b6f3dc061955577f39ee7d70a8a1ef58054203`, `healthy`, `n8n_default` connected)
  - **Active Web Bundle**: `index-H-hbFUio.js` + `index-Dr6Sl8uG.css` + `chat-voice-processor-v1.js` (`19/19` Bulk Campaigns & Phone n8n UI markers verified)
  - **Simulation-Only Lock**: `liveCallingEnabled = false`, `liveSendingEnabled = false` (`mode: 'live'` rejected with `400 LIVE_COMMUNICATIONS_DISABLED`; `0` external calls/messages sent; `postgres_table_diffs = {}`).
- **Post-Deploy Live Verification & Cross-Integration Regressions**:
  - **Bulk Campaigns 5-Step Flow**: `200 OK` on `/integrations/bulk-campaign` & `/bulk-campaigns`; verified `PDF` + `DOCX` knowledge ingestion, brochure-phone exclusion, WhatsApp/Phone/Email channel selection, grounded Q&A (`/ask-question`) + anti-hallucination pricing check, `sarvamBoundedFactBrief` (`789` chars `<= 1000`), review edits, 5-contact sample demo per-call approvals (`5/5` simulated), owner approvals, simulation execution, and CSV export inside a rolled-back PostgreSQL savepoint.
  - **Cross-Integration Regressions (`200 OK`)**: `/connectors/phone/ai/status`, `/contacts`, `/calls`, `/connectors/phone/call-history/inbound`, `/connectors/phone/callbacks/reports`, live HTTPS `/connectors/phone/n8n/checkpoint` (`401` unauthenticated / `200` HMAC), `/chat/voice/status`, `/connectors/whatsapp/status`, `/connectors/whatsapp/n8n/durable/connections`, `/connectors/gmail/status`, `/connectors/google-calendar/status`, `/connectors/google-drive/status`, `thaara-phone115-receiver` (`running`), and active n8n workflows (`ThaarSarvamSync1`, `ThaaraCbNotif001`, `ezIrlr7y9dEowujw`, `RrqXTplIBXginMSD`, `upU4clCyj1VvJlpk` all `active=1`).
- **Remaining Known Limitations**:
  1. **Sarvam 1,000-Character Outbound Campaign Brief Limit**: Sarvam's outbound REST API (`phone-sarvam-calls.ts`) accepts `agent_variables.call_purpose` (`<= 1000` chars) at call start rather than mid-call server RAG callbacks over full multi-MB uploaded documents. Live outbound phone calls therefore receive the distilled `<= 1000`-character verified Campaign Fact Brief alongside the existing global Quantum Weave KB (never full raw multi-page files), while WhatsApp follow-up replies and simulation query all extracted campaign chunks.
  2. **Live Bulk Outreach Disabled by Design**: `THAARA_BULK_CAMPAIGN_LIVE_ENABLED` remains unset (`false`), keeping live bulk Phone calls, WhatsApp campaign dispatches, and promotional Gmail sends disabled until separately authorized by the owner.


---

## 7. Milestone 3 — Company Introduction Campaign Simulation & Chaitra Baseline Rebase (Prepared & Locked — Awaiting Final Approval)
- **Live Production Baseline Verified Read-Only**:
  - Container `thaara-v2-pilot-api-1` (`870e6d056f6e859d6ce1d14152a1162a4e931a70eb7d6ec0bf747ce2d4d0643c`, `running`, `healthy`, networks `n8n_default`, `thaara-v2-pilot-data`, `thaara-v2-pilot-entry`).
  - Actual Running Image Tag: **`thaara-v2-pilot-api:chat-voice-restored-20261118`** (newer than `phone-history-ui-20261118`; note that while the Chaitra rollout was referred to as `chat-voice-chaitra-20261118`, the actual live container and `compose.json` run tag `thaara-v2-pilot-api:chat-voice-restored-20261118`).
  - Actual Running Image Digest: **`sha256:a44bb2a34fafb6260b8f43b0445e71e43fa6d2ecc669300c7bd32c1ca4977099`**.
  - Verified Live Chaitra Voice Files Inside Container: `/app/apps/api/dist/services/chat-voice-sarvam.js` (`dad804e8...`, `model: 'bulbul:v4-flash', speaker: 'chaitra_kn_conversation'`) and `/app/apps/api/pilot-start.mjs` (`8b808b3d...`, `pilotChatVoiceApiKey` + `/integrations/bulk-campaign` SPA routes).
  - Verified Existing Campaign `camp_0e04b97b` (`company Campaign`) Untouched: `4` uploaded contacts, `4` `unauthorized` (`0` database or live container mutations).
- **Rebased Compatible Overlay Prepared (Not Deployed)**:
  - Rebased `Dockerfile.bulk-campaign`, `publish-bulk-campaign.py`, `reconcile-bulk-campaign.mjs`, and `scripts/stage-bulk-campaign.mjs` onto `thaara-v2-pilot-api:chat-voice-restored-20261118` (`sha256:a44bb2a34fafb6260b8f43b0445e71e43fa6d2ecc669300c7bd32c1ca4977099`).
  - Overlay does **not** touch `chat-voice-sarvam.js`, `pilot-start.mjs`, `phone-calling.js`, `phone-sarvam-calls.js`, `phone-n8n-sync.js`, or `phone-callback-mail.js`; web bundle `index-DIz41n0d.js` includes Simplified Bulk Campaign Review & Results UI, Phone History UI (`20261118`), and byte-identical `chat-voice-processor-v1.js` (`16a700c9...`).
  - Regression Tests Passed: `bulk-campaign.test.ts` (`25/25`), `bulk-campaign-ui.test.tsx` (`6/6`), `chat-voice-http.test.ts` (`11/11`), `chat-voice-consultant.test.ts` (`7/7`), `phone-pages.test.tsx` (`21/21`), `phone-calling-panel.test.tsx` (`22/22`), `phone-n8n-media-options.test.tsx` (`2/2`), `phone-calling.test.ts` (`32/32`), `phone-callback-mail.test.ts` (`8/8`), `phone-n8n-sync.test.ts` (`4/4`), `whatsapp-n8n.test.ts` (`19/19`).
  - **Revised Staged Archive (`publication.tar.gz`) SHA-256**: `6a33bcc27e8d305aea737ce34bf9839e880e05118b4a02b229d04d81167526f7` (`332,559` bytes, `18` files).
  - **Safety Locks & Rollback Readiness**: `OWNER_APPROVED_BULK_CAMPAIGN = False`, `liveCallingEnabled = false`, `liveSendingEnabled = false`; rollback tag `thaara-v2-pilot-api:rollback-pre-bulk-campaign-sim` -> `chat-voice-restored-20261118` and pre-deploy `pg_dump -Fc` + `pg_restore -l` TOC check verified ready (`/opt/thaara-v2-pilot-private/backups`, `35G` free).
