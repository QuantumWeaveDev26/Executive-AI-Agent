# Existing Sarvam Instant Outbound adapter — contract review,31 October2026

Read-only review. Existing adapter preserved; no campaign/cohort path, provider request, credentials or activation.

## Eligibility and authorization are separate facts

Owner confirmed existing Vobiz managed connection/number ending9780 is active/healthy, deployment type `inbound_outbound`, bound to
Thaara AI Voice Assistant committed version2. Telephony eligibility is **OWNER-CONFIRMED**. No telephony changes are needed.
Earlier owner confirmations of five-minute version cap and prepaid balance stand. Existing review profile remains review-only/live disabled.

[Create outbound call](https://docs.sarvam.ai/voice-agents/api/instant-outbound/create) requires `X-API-Key` described as the workspace API key.
[API-key documentation](https://docs.sarvam.ai/voice-agents/settings/api-key) describes server-side integrations but does not establish this
key's present permissions. [Policy documentation](https://docs.sarvam.ai/voice-agents/settings/policy) says exact org controls depend on the plan.
The public docs inspected do not state an endpoint-specific permission/introspection check that proves this workspace is entitled to Instant Outbound.
No authenticated account API/key has been inspected. Therefore **specific endpoint/key permission remains UNVERIFIED**, rather than denied.
Owner/admin/support may confirm that non-secret fact; eventual actual behavior needs separately approved controlled API/call acceptance.
Do not test permission with a POST: this endpoint places a call. Do not create/rotate keys or campaigns to investigate it.

## Contract comparison

Source: `apps/api/src/services/phone-sarvam-calls.ts`; source and live guard unchanged.
Public static Markdown was read because the web reader could not expand the request properties; no authenticated API was contacted.

| Official Instant Outbound contract | Existing adapter | Review |
|---|---|---|
| POST fixed apps.sarvam.ai `/api/outbounds/v1/orgs/{org_id}/workspaces/{workspace_id}/outbounds` | fixed origin/path, encoded reviewed IDs, X-API-Key, JSON, redirects refused | matches |
| app_config.app_id and integer app_version | owner-controlled profile; existing committed version2 preserved, fingerprint bound to approval | matches |
| connection_config.connection_id and agent_phone_number | exact configured connection and caller, no campaign required by this endpoint | matches |
| optional app_config.agent_variables map | `call_purpose` is approved purpose; `user_name` is resolved recipient name | matches |
| optional app_overrides.initial_bot_message/initial_language_name | approved AI/on-behalf-of disclosure; English or Kannada, including Kanglish routing | matches documented fields/enums |
| user_config.user_phone_number | consenting contact's exact approved number, not model/browser supplied | matches |
| optional webhook_config.url/metadata | per-call HMAC capability URL and thaara_call_id | matches |
| successful200 body requires string attempt_id | strict bounded identifier parsed; treated as unverified dispatch acknowledgement, not completed call | conservative; accepts valid other2xx too |
| no documented per-request hard duration field | profile cap300s required; exact approved duration checked; no invented duration request parameter | preserved; provider-version cap is external evidence |

Completion source: [Instant Outbound webhook payload](https://docs.sarvam.ai/voice-agents/api/instant-outbound/webhook-payload).
Webhook is emitted after an attempt completes. Existing admission matches exact attempt_id/call metadata plus private route capability,
supports connected/no_answer/busy/failed, nullable date/slash interaction_id, and recipient-role en_text only. English may be a translation;
reports preserve provider-English/unverified labels and do not infer task success/agreement. final_agent_variables are not trusted as instructions
or recipient evidence. Optional duration/failure_reason and required channel_info are not used for authorization; this is tolerant parsing,
not a claim of complete schema validation or caller-number reconciliation. Existing residual first-writer/token-leak risk remains:
unsigned payloads cannot establish provider identity; authenticated result readback is separate owner-triggered evidence.

## Safeguards unchanged

Contact consent/revision binding, owner policy/approval/audit, one durable claim per approval, per-owner transaction lock, daily default5/range1–20,
five-minute exact cap, no automatic redial/retry, unknown outcomes retained, no secrets in URL/logs, test-only application guard and unwired loader.
No telephony, deployment, credential or persistent schema change. Recent API803/803, web243/243 and runtime19/19 evidence is historical/reused
for unchanged executable source; this documentation/profile review does not re-run it or prove provider permission.
