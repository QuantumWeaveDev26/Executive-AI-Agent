# Pilot activation plan — existing Chat model, Gmail, Calendar, WhatsApp, Phone (DRAFT for owner approval, 31 Oct 2026)

Nothing in this plan has been executed.

## Audit (evidence-based)

| Feature | Pilot state | Root cause | Category |
|---|---|---|---|
| Chat | `MODEL_GATEWAY_NOT_CONFIGURED` | The original model is **OpenAI `gpt-4.1-mini`** via `OpenAIModelGatewayAdapter`, configured locally by `OPENAI_API_KEY` / `OPENAI_MODEL` in `.env` (handover 16 Oct; commit `1849bd1`). The pilot startup check `pilotEnvironment()` in `deploy/hostinger-pilot/pilot-config.mjs` **deliberately denies `OPENAI_API_KEY`**, because the pilot was built as `isolated_synthetic_only`. So `createModelGateway()` falls back to the unconfigured adapter. | Disabled by design |
| Gmail + Calendar | Not connected | The existing live integration (`createLiveGoogleIntegrationFromEnv`) is only wired in `server.ts`. `pilot-start.mjs` does not call it, and `pilotEnvironment()` denies `GOOGLE_*` / `GMAIL_*`. | Disabled by design |
| WhatsApp | Live text/image sending since 29 Oct; send state preserved by every deploy since | Not yet known. Health after the 110a–c migration and the new images is unverified, and the owner hasn't said what fails. | Needs evidence |
| Phone | Working: a real call was received on 31 Oct | Earlier failures were 401s from the wrong Sarvam key type (fixed by the owner). The report in the card or Chat is not yet verified. | Working, verification pending |

## Local fixes (done, not deployed)

- Removed the undeployed Claude code. `model-gateway.ts`, `package.json` and `pnpm-lock.yaml` are back to HEAD.
- `apps/api/src/services/pilot-providers.ts` reuses the existing adapters:
  - **Chat:** `OpenAIModelGatewayAdapter`, model fixed to the original `gpt-4.1-mini`, key read from `/run/secrets/openai_api_key`.
  - **Google:** `createLiveGoogleIntegrationFromEnv`, with the existing OAuth client from three key files and fixed HTTPS pilot callbacks (localhost callbacks off).
  - Each is off unless its exact switch and mounts are present. A refusal leaves that feature not_configured and the API up.
- `pilot-start.mjs` and `pilot-config.mjs` are wired accordingly: exact switches, mounts and switches together, and the model limited to the original one.
- Owner scripts: `pilot-openai-key-entry.sh` and `pilot-google-entry.sh`. They use hidden prompts, never overwrite, make files readable only by the API user, and generate a new pilot token key.
- Publisher modes:
  - `--approved-chat-model-deploy`: new image; Chat and Google off; installs both scripts. Rollback is UI image `a7f8a210…`.
  - `--approved-chat-model-on` / `-off`: the OpenAI key mount and its switch only.
  - `--approved-google-on` / `-off`: the Google mounts and their switch only.
- Runner flags exist for each, with manifests locked (`remoteExecutionAllowed: false`).
- Tests: API **837/837** (new pilot providers 16/16), pilot config 8/8, publisher 19/19, transport 27/27, typecheck clean.

## Known limitation (existing code, not changed)

The live Google integration stores OAuth tokens **in memory**. Every API restart or deploy requires reconnecting Gmail and Calendar. Persistent encrypted token storage is a separate development task, needed before multi-user launch.

## Owner setup (no secrets in chat)

1. **OpenAI:** use the existing OpenAI key (the one in local `.env`) or a new one from platform.openai.com. Check the OpenAI account has credit.
2. **Google Cloud Console** (the existing OAuth client — the same Client ID as local `.env`):
   - Add Authorized redirect URIs `https://thaara-v2.quantumweaveai.io/api/v1/connectors/gmail/oauth/callback` and `https://thaara-v2.quantumweaveai.io/api/v1/connectors/google-calendar/oauth/callback`.
   - On the OAuth consent screen, keep **Testing** mode with your Google account as a test user. A public launch later needs Google verification and, for Gmail, a security assessment.
3. **WhatsApp:** send a screenshot of what fails, or approve a read-only health check.

## Execution order (each step needs its own approval; single run; stop on failure; no retry)

1. Local image build on the UI image, plus the local start check. This needs a temporary local database.
2. `-ApprovedChatModelDeploy`: swaps only the image. Phone live, WhatsApp send state and other services are preserved. Installs both owner scripts.
3. Owner runs `pilot-openai-key-entry.sh` and `pilot-google-entry.sh` on the VPS.
4. `-ApprovedChatModelOn`. Owner verifies: "hi" in Chat gets a natural reply.
5. `-ApprovedGoogleOn`. Owner connects Gmail and Calendar in the app, then tests: read inbox, draft an email (send only with approval), list and schedule an event (with approval).
6. WhatsApp: fix based on evidence.
7. Phone: verify the call report in Chat (`hyy thaara call for <contact> and ask …`, one approved call).

**Rollback:** each publisher step restores the previous compose and image automatically on any failed check. `-ApprovedChatModelOff` and `-ApprovedGoogleOff` remove a feature without a new image. The previous image is kept.
