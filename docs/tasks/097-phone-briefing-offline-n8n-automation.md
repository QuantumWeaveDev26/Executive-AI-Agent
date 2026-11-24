# Task 097 — Phone Briefing & Offline n8n Automation

## Goal

Enable Thaara to prepare authorized Phone call-history briefings (total calls, incoming/outgoing breakdown, missed/failed calls, recent call activity, and follow-up items with masked phone numbers and sanitized untrusted text) and generate validated offline n8n automation blueprints (`active: false`, `recordingEnabled: false`, `transcriptionEnabled: false`, `outboundCallingEnabled: false`, zero raw phone numbers or private call details embedded) with explicit approval gating where appropriate.

## Implemented Scope

1. **Contracts (`packages/contracts/src/phone.ts`)**
   - Added `PhoneBriefingQuerySchema`, `PhoneBriefingActivityItemSchema`, `PhoneBriefingFollowUpItemSchema`, `PhoneBriefingN8nContextSchema`, and `PhoneBriefingResponseSchema`.
2. **PolicyGateway Registry (`packages/policy/src/registry.ts`)**
   - Registered `phone.briefing.prepare` (`actionClass: 'read'`, `risk: 'low'`, `approvalMode: 'none'`, `requiredRole: 'member'`, `auditRequired: true`, `capabilityScope: 'external_connector'`, `schemaIdentifier: 'phone.briefing.prepare.v1'`).
3. **Phone Briefing Service & Offline n8n Blueprint (`apps/api/src/services/phone.ts`, `apps/api/src/routes/phone.ts`)**
   - Implemented `PhoneFoundation.prepareBriefing` and `POST /api/v1/connectors/phone/briefing`.
   - Implemented `buildPhoneBriefingN8nBlueprint` (`active: false`, `recordingEnabled: false`, `transcriptionEnabled: false`, `outboundCallingEnabled: false`, `rawPrivateCallDetailsEmbedded: false`), embedding only metadata (`callIds`, `missedOrFailedCallIds`, `followUpCallIds`, `totalCalls`, `inboundCount`, `outboundSimulatedCount`, `missedOrFailedCount`) and never raw phone numbers or private call details.
4. **Chat Orchestration (`apps/api/src/services/chat-automation-orchestrator.ts`, `apps/api/src/routes/conversations.ts`, `apps/api/src/app.ts`)**
   - Added `detectPhoneBriefingChatRequest` (strictly keeping briefing requests separate from outbound-call intents) and `executeChatPhoneBriefingPlan` wired into `POST /api/v1/conversations/:id/stream` with explicit approval gating (`automation.email.stage_workflow_artifact`), idempotency, workspace/user isolation, and truthful receipts.
5. **Focused Verification (`apps/api/test/phone-briefing.test.ts`)**
   - Verified call-history briefings, incoming/outgoing breakdown, missed/failed & follow-up extraction, PII phone masking, untrusted script stripping, `active: false` n8n blueprint with zero raw phone numbers or private call details, outbound-call intent separation, viewer/cross-user/cross-workspace isolation, and governed chat approval flow.
