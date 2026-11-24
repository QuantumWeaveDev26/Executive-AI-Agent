# Step 108.29 — WhatsApp go-live (text, templates, files): consolidated approval request

**Status: PREPARED, NOT EXECUTED.** Every message still needs the owner's per-message approval; contacts must be opted in; text/files only inside Meta's 24 h window; templates any time.

## Verified prerequisites

Pilot image `522a3dd8…` (108.25–108.28): contacts manager, templates, two-stage uploads, Meta key connected (owner confirmed image preview + template list work). 10825 applied. Sending OFF. Outbound workflow `RrqXTplIBXginMSD` read 29 Oct: inactive, webhook + send nodes disabled, hard never-send condition present, execution saving off. Credential for sends: **"Thaara WhatsApp Test"** (`Ub44cxSJarXiuVBb`). "WhatsLearn" credential/workflows are NOT touched.

## Sequence

1. **Host script** (VPS): install updated `pilot-send-live-on.sh` (new optional `rich` mode writes `richMessages:true`; checksum-verified copy). No restart.
2. **Switch on** (VPS): `pilot-send-live-on.sh --approved unlimited rich` — generates the n8n header key on the server, profile = opted-in contacts, no Thaara daily cap, 30 days, rich messages allowed; relay events+claim+receipts; API-only recreate; private link restore; auto-rollback via live-off.
3. **Owner**: copy the new key (`cat /opt/thaara-v2-pilot-private/handoff/n8n_dispatch_secret; echo`) into the n8n credential used by "Authenticated Thaara dispatch" (header `X-Thaara-Dispatch`). Never in chat.
4. **n8n edits** (only `RrqXTplIBXginMSD`, atomic operations, existing credential bindings untouched):
   - Deployment send gate: remove the `never-enable-from-request` condition; keep `authorized === true && dispatchEnabled === true`.
   - Add IF "Is rich message" (`messageType` is `template` or `media`); false → existing text send node; true → new HTTP Request "Send rich message (template/media)": POST `https://graph.facebook.com/v21.0/{phoneNumberId}/messages`, predefined credential `whatsAppApi` = Thaara WhatsApp Test, body = tested builder (`deploy/n8n/rich-message-body.mjs`, 4/4), redirects off, 15 s timeout, error output → existing sanitized error node; success → existing receipt relay.
   - Enable webhook and text send node; keep execution saving OFF; publish (activate).
5. **Owner tests** (each approved in Thaara): one text to the owner phone → Sent/Delivered/Read; then `hello_world` template; then one small image (two approvals: upload, then send).

Switch-off any time: `bash /opt/thaara-v2-pilot/pilot-send-live-off.sh --approved` + unpublish the outbound workflow.

## Evidence

Builder tests 4/4 (template header/body, bare template, image/document/audio with permitted fields, refusals, expression equivalence). live-on `rich` mode: syntax ok; profile parses with `richMessages` true/false. Service: template/media never handed to n8n unless `richMessages` (unit tests); claim payload `messageType`/`template`/`media`. Isolated PostgreSQL 10825 7/7.

## Limits / truthfulness

Ticks only from Meta status events. The rich HTTP node uses the n8n WhatsApp credential through n8n's predefined-credential mode; if that credential type is not accepted by the HTTP node, the error path reports a sanitized, unverified failure (no false success) and text sending is unaffected.
