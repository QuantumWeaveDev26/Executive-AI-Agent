# Step 91 — WhatsApp Business Integration Foundation

Date: 19 October 2026 (Asia/Calcutta)
Status: COMPLETE — mock/synthetic foundation only; live WhatsApp Business remains `not_configured`
Workspace: `C:\ThaaraProjects\thaara-ai-agent-v2`
Branch: `dev-thaara-continuation`
Base Checkpoint (`HEAD`): `8c2deaa`

## Implemented

1. **Typed WhatsApp Business Contracts ([`packages/contracts/src/whatsapp.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/packages/contracts/src/whatsapp.ts), [`packages/contracts/src/index.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/packages/contracts/src/index.ts))**:
   - Published strict TypeBox schemas (`additionalProperties: false`) for `WhatsAppStatusSchema`, `WhatsAppConnectInputSchema`, `WhatsAppContactSummarySchema`, `WhatsAppMessageSchema`, `WhatsAppThreadSummarySchema`, `WhatsAppListMessagesSchema`, `WhatsAppListMessagesResponseSchema`, `WhatsAppSendMessageDraftSchema`, `WhatsAppWebhookEventEnvelopeSchema`, and `WhatsAppN8nContextSchema`.
   - Every message, thread, list response, and n8n context enforces `untrusted: true` and `mode: 'mock'`.
2. **PolicyGateway Action Catalog ([`packages/policy/src/registry.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/packages/policy/src/registry.ts))**:
   - Registered `whatsapp.connection.status`, `whatsapp.connection.connect`, `whatsapp.connection.disconnect`, `whatsapp.messages.list`, and `whatsapp.messages.read` (`requiredRole: 'member'`).
   - Registered `whatsapp.messages.send` as a high-risk mutating external connector action (`actionClass: 'write'`, `risk: 'high'`, `approvalMode: 'explicit'`, `idempotencyRequired: true`, `auditRequired: true`).
3. **WhatsApp Business Foundation, Vault, PII Masking, Webhook Verification & Offline n8n Context ([`apps/api/src/services/whatsapp.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/services/whatsapp.ts))**:
   - `WhatsAppVault` encrypts session records with AES-256-GCM and AAD bound to `[workspaceId, userId, purpose]`.
   - `maskPhoneNumber`, `hashContactPhone`, and `sanitizeWhatsAppText` prevent raw phone numbers, script/style blocks, HTML tags, or control characters from leaking into API responses, audit logs, or automation contexts.
   - `WhatsAppFoundation.verifyAndIngestMockWebhookEvent` verifies `X-Hub-Signature-256` HMAC-SHA256 signatures via `timingSafeEqual`, enforces timestamp replay windows (`maxSkewSeconds`), validates tenant/user scope, and deduplicates repeat `eventId` and `messageId` deliveries without exposing any live public webhook endpoint.
   - `WhatsAppFoundation.sendMessage` strictly requires an approved `ApprovalRequest` verified through `PolicyGateway.evaluate` and returns truthful `status: 'not_configured'` in Step 91.
   - `WhatsAppFoundation.toN8nContext` produces a validated, sanitized n8n context with `active: false` without touching existing n8n workflows.
4. **Authenticated API Routes ([`apps/api/src/routes/whatsapp.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/routes/whatsapp.ts), [`apps/api/src/app.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/src/app.ts))**:
   - Mounted `/api/v1/connectors/whatsapp/{status,connect,connection,messages/list,messages/:messageId}` with `no-store` headers, authentication, CSRF protection, `resolve_session_scope` membership verification, redacted RLS `audit_events`, and `NODE_ENV === 'test'` guard on mock injection.

## Verification

- **Focused Step 91 Suite**: `7/7` passed in [`apps/api/test/whatsapp-foundation.test.ts`](file:///c:/ThaaraProjects/thaara-ai-agent-v2/apps/api/test/whatsapp-foundation.test.ts).
- **Full Verification (`pnpm.cmd verify`)**: `57/57` test files passed (`667/667` tests, `0` failed), plus full workspace build, lint, and typecheck.

## Limitations & Recommended Step 92

- Default runtime remains `not_configured` (`mode: 'disabled'`); no live Meta/WhatsApp API calls, live webhooks, or outbound message dispatches are enabled.
- **Recommended Step 92**: Build the **WhatsApp Business Inbox UI & Governed Draft/Briefing Workflow** (`WhatsAppScreen.tsx` + offline `active: false` n8n digest blueprint and approval-gated reply draft preview).
