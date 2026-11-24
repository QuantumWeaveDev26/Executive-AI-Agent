# Task 093 — WhatsApp Briefing & Offline n8n Automation

## Goal

Enable Thaara to prepare authorized WhatsApp conversation briefings (unread counts, thread summaries, items needing attention with masked phone numbers and sanitized untrusted text) and generate validated offline n8n automation blueprints (`active: false`, zero raw private messages embedded) with explicit approval gating where appropriate.

## Implemented Scope

1. **Contracts (`packages/contracts/src/whatsapp.ts`)**
   - Added `WhatsAppBriefingQuerySchema`, `WhatsAppBriefingThreadSummarySchema`, `WhatsAppBriefingAttentionItemSchema`, `WhatsAppBriefingN8nContextSchema`, and `WhatsAppBriefingResponseSchema`.
2. **PolicyGateway Registry (`packages/policy/src/registry.ts`)**
   - Registered `whatsapp.briefing.prepare` (`actionClass: 'read'`, `risk: 'low'`, `approvalMode: 'none'`, `requiredRole: 'member'`, `auditRequired: true`, `capabilityScope: 'external_connector'`, `schemaIdentifier: 'whatsapp.briefing.prepare.v1'`).
3. **WhatsApp Briefing Service & Offline n8n Blueprint (`apps/api/src/services/whatsapp.ts`, `apps/api/src/routes/whatsapp.ts`)**
   - Implemented `WhatsAppFoundation.prepareBriefing` and `POST /api/v1/connectors/whatsapp/briefing`.
   - Implemented `buildWhatsAppBriefingN8nBlueprint` (`active: false`, `rawPrivateMessagesEmbedded: false`, `outboundMessageSendingEnabled: false`), embedding only metadata (`threadIds`, `attentionMessageIds`, `unreadTotal`) and never raw private messages or raw phone numbers.
4. **Chat Orchestration (`apps/api/src/services/chat-automation-orchestrator.ts`, `apps/api/src/routes/conversations.ts`, `apps/api/src/app.ts`)**
   - Added `detectWhatsAppBriefingChatRequest` and `executeChatWhatsAppBriefingPlan` wired into `POST /api/v1/conversations/:id/stream` with explicit approval gating (`automation.email.stage_workflow_artifact`), idempotency, workspace/user isolation, and truthful receipts.
5. **Focused Verification (`apps/api/test/whatsapp-briefing.test.ts`)**
   - Verified conversation briefings, unread/attention extraction, PII phone masking, untrusted script stripping, `active: false` n8n blueprint with zero raw private messages, viewer/cross-user/cross-workspace isolation, and governed chat approval flow.
