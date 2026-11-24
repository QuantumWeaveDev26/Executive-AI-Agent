# WhatsApp owner setup — 26 October 2026

Latest owner input: Phone Number ID `276710465536610`; labelled Messaging Account ID `356865954168966`. These are owner-supplied non-secret identifiers, not provider-verified ownership or a confirmed WABA mapping. Dedicated Meta App ID remains missing. Never substitute synthetic fixture IDs or silently provision real profiles from this note. Existing Meta credentials need no recreation. Current backend acceptance: [982/982 plus35/35](OWNER_API_RESULTS.md). Hosted backend/account access/private profile/HTTPS/eligibility and separately approved activation/pilot remain pending.

27 October update: [actual isolated PostgreSQL35/35](CALLBACK_RUNTIME_RESULTS.md) passed, including full registered API checks on repeat. Backend owner-confirmed unhosted; Hostinger preferred subject to suitability. [Next hosting/access scope](HOSTING_CONNECTION_GATE.md) needs approval/private owner sign-in because Hostinger is not connected and browser helpers cannot initialize. No Meta credential recreation requested; those remain reported created/tested. Two future backend/webhook credentials below are still unprovisioned and must wait for matching hosted profile/managed-secret admission. Workflows inactive; no real sends.

27 October correction: the owner reports both dedicated credentials were created and connection-tested, and the incoming node showed its selected credential. Fresh credential metadata confirms both saved credentials exist. Workflow detail/version tool responses expose no credential mapping metadata; because these responses are sanitized, omission alone is not proof that the UI assignment is absent. Treat earlier absence claims below as inconclusive, preserve the owner's completed setup and do not ask for recreation. No owner setup is required for the current local inbox implementation. Verify mappings through a reliable metadata/UI view only when the connection phase actually needs them, without opening secret values.

Latest check: [readiness report](READINESS_RESULTS.md). Both Meta credential assignments remain absent on remote read-back. Developer-only pinned synthetic testing is now authorized and was performed through a temporary manual entry, removed afterwards; this does not authorize the owner to test/listen/publish the official Meta trigger. All provider/HTTP/production-trigger nodes stay disabled. Local API 3002 was unavailable; backend authenticated communication is not ready. Follow the owner credential mappings below; never send secret values.

The two required base workflows have been created in the personal n8n project **Quantumweave academy**. They are inactive, have no active version, and all trigger/provider/HTTP nodes are disabled. No credentials were auto-assigned. The literal false outgoing gate is unchanged. Media/template nodes remain disabled and disconnected; they are not working features. Read-back evidence: [remote manifest](remote-setup-2026-10-26.json).

| Workflow | Open in n8n | Role |
|---|---|---|
| THAARA_V2_DEV_WHATSAPP_INBOUND_1082 | https://n8n.srv1871828.hstgr.cloud/workflow/ezIrlr7y9dEowujw | Incoming messages and sent/delivered/read/failed status relay |
| THAARA_V2_DEV_WHATSAPP_OUTGOING_1082 | https://n8n.srv1871828.hstgr.cloud/workflow/RrqXTplIBXginMSD | Approved dispatch, backend claim, guarded text send and acknowledgement relay |

## Owner action now

You confirmed that the saved **Thaara WhatsApp Trigger** and **Thaara WhatsApp Test** credentials belong to the same dedicated Thaara Meta app/test account and do not share another workflow's webhook. No duplicate Meta credential is needed if both are current and valid. This is an owner confirmation, not provider verification.

1. In Meta for Developers, open that dedicated app. Under **App settings → Basic**, note the non-secret **App ID**. Under **WhatsApp → API Setup**, note the **WhatsApp Business Account ID** and **Phone Number ID**. Send only these three identifiers to this chat. They are distinct IDs; do not substitute the phone number for its ID.
2. Open the incoming workflow. On **WhatsApp messages and statuses**, select the saved **Thaara WhatsApp Trigger** credential. Keep the node disabled and the workflow unpublished. Its credential uses the dedicated Meta App ID as Client ID and App Secret as Client Secret.
3. Open the outgoing workflow. On **Send only after Thaara authorization**, select **Thaara WhatsApp Test**. Keep the node disabled and the workflow unpublished. Its credential holds the access token and WhatsApp Business Account ID for that same app/account. Future template/media nodes can remain unconfigured until their functionality is implemented.
4. Confirm only that these assignments are saved and whether the access token has an expiry. Never send the token, App Secret, private recipient numbers or screenshots containing secrets. Enter/update credential values only in n8n. No provider connection test is requested at this stage.

If either saved credential is missing or expired, use the credential editor privately: WhatsApp Trigger OAuth2 requires Client ID/App ID and Client Secret/App Secret; WhatsApp Business Cloud API requires Access Token and Business Account ID. Use only the dedicated test assets. Do not change app mode, register a permanent number, generate broader credentials or alter another app's callbacks to finish this setup.

Do not click **Execute**, **Listen for test event**, **Test workflow**, or **Publish**. Trigger testing/publishing can register or replace Meta webhook configuration. Credential selection alone does not enable the workflow or prove connectivity.

## Backend connections — later, after secure runtime admission

The currently running Thaara backend is not admitted for LIVE WhatsApp callbacks. Keep all `.invalid` URLs and closed gates until a reviewed backend deployment is explicitly authorized. Do not point real messages at the existing offline bridge.

Two additional independent credentials will be needed after scoped backend secret provisioning is implemented. They must be created privately by the owner, then mapped as follows:

| Future credential | n8n type | Nodes | Matching backend requirement |
|---|---|---|---|
| Thaara V2 Relay to Backend | Bearer Auth (`httpBearerAuth`) | Incoming **Relay untrusted event to Thaara**; outgoing **Claim approved dispatch** and **Report provider acknowledgement** | Scoped relay verifier for the connection and revision |
| Thaara V2 Dispatch Webhook | Header Auth (`httpHeaderAuth`), header `Authorization`, value `Bearer <distinct private dispatch secret>` | Outgoing **Authenticated Thaara dispatch** | Server-side sender secret; different from relay and n8n administrative keys |

Do not create these values in chat, source, exports or browser application storage. Do not reuse Google/session secrets. Their matching server-side storage and rotation/revocation must exist before assigning or using them. The developer will identify the concrete provisioning step; no secret generation or production credential change occurred here.

Other remaining prerequisites: owner-controlled public HTTPS Thaara callback origin, trusted connection/workspace/owner profile, least-privilege service principal, durable backend injection, Meta app/WABA/phone ownership and token/version checks, business-use eligibility, correct WABA subscription, approved test recipient, and the approved LIVE UI/Chat/media feature work. The public n8n origin alone cannot expose a localhost Thaara API. Subscription changes, activation, production schema/configuration/restart and each real-send pilot remain separate explicit authorization boundaries.

## Verified evidence and limits

- Both remote SDK graphs validated: incoming 2 nodes, outgoing 9 nodes. Outgoing validator warnings are solely the intentionally disconnected future media/template nodes (reported twice per node by the validator).
- Saved remote workflows read back: inactive, no active version, zero assigned credentials, all eight I/O nodes disabled in total, false AND server-authorization gate intact. Execution success/error payload retention, manual retention and progress retention disabled; 30-second timeout.
- No workflow executed, provider called, subscription registered or WhatsApp message sent. Only these two new workflow IDs were mutated. Existing workflows and credentials were not changed.
- Previous Step 108.4 evidence remains 21/21 real PostgreSQL plus 38/38 focused checks. Unchanged application evidence remains the historical 872/872 full regression; no fresh full application run is claimed for workflow creation.
- Application remains NOT LIVE. Workflow creation is setup evidence, not successful incoming/outgoing messaging, verified receipts or functional media.

Official credential fields: https://docs.n8n.io/integrations/builtin/credentials/whatsapp/

Official trigger/subscription caveats: https://docs.n8n.io/integrations/builtin/trigger-nodes/n8n-nodes-base.whatsapptrigger/
