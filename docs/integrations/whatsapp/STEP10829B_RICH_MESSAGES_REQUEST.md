# Step 108.29b — switch on template and file sending (approval request)

**Status: PREPARED, NOT EXECUTED.** Text sending is live and verified (29 Oct 08:12 IST: sent/delivered/read). Per-message approval, opt-in and audit unchanged.

## Sequence

1. **Install** `deploy/hostinger-pilot/pilot-send-rich-mode.sh` on the VPS (checksum-verified, not run yet).
2. **n8n** (only `RrqXTplIBXginMSD`, 10 atomic operations in `deploy/n8n/rich-branch-ops.json`): add IF "Is rich message" (claim `messageType` is template/media) after the server authorization gate; true → new HTTP Request "Send rich message (template/media)" (POST `https://graph.facebook.com/v21.0/{phoneNumberId}/messages`, predefined credential `whatsAppApi` = "Thaara WhatsApp Test", body = tested builder, redirects off, 15 s, error → sanitized error node, success → existing receipt relay); false → existing text node unchanged. Execution saving stays none. Then publish the new version (the live text version keeps running until then).
3. **Switch rich mode on**: `pilot-send-rich-mode.sh --approved on` — flips only `richMessages` in the live profile (same n8n key, same file/owner/mode), restarts only the API, verifies health, n8n→API link, public health, other services unchanged and that the API loaded the flag; restores the previous profile on any failure.
4. **Owner tests** (each approved in Thaara): `hello_world` template to Owner Test Phone (allowed even outside 24 h); then one small image (approve upload, then approve send). Verify Sent/Delivered/Read from Meta events.

## Rollback

`pilot-send-rich-mode.sh --approved off` (text continues) and/or republish n8n version `87470677-af70-4dbf-819b-90f7b68af954` (text-only). Full stop: `pilot-send-live-off.sh --approved` + unpublish.

## Evidence

Builder 4/4 (Graph template/media payloads, refusals, expression equivalence); toggle script syntax ok, dry-run edit keeps every other profile field and parses with `richMessages:true`; service never hands template/media to n8n unless the flag is on (unit tests); isolated PostgreSQL 10825 7/7; template list and image preview already confirmed by the owner. Unknown until the first test: whether n8n accepts the WhatsApp credential in the HTTP node's predefined-credential mode — if not, the error path reports an unverified failure and nothing is sent; text is unaffected.
