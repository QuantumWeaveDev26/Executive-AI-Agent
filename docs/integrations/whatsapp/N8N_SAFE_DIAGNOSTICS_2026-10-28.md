# Thaara-only n8n configuration — 28 Oct 2026

## Authorization and preserved scope

Owner: **"use quantumweave26@gmail.com this account"**, then **"dont change anything in the existing just work with the thaara workflows"**. Correct personal project: `fn6pQNcDpG7hLM3t`. No account migration or new workflow. Native n8n plugin used for workflow configuration, schema validation, pinned tests and readback. Browser inspection was read-only and stopped when the owner clarified the account; its temporary tab was closed.

Only outbound `RrqXTplIBXginMSD` was modified. Inbound `ezIrlr7y9dEowujw` remains active at unchanged version `68b66159-eb3b-46f3-8597-b1bda6000871`. WhatsLearn and all other workflows untouched. No VPS/configuration deployment, services, database migrations, source changes, credentials/secret changes, real provider requests/messages, commit or push.

## Outbound changes

- Send node explicitly uses resource `message`, operation `send`, type `text`, with sender/recipient/body still taken only from the server-approved claim.
- Existing credential references assigned by acknowledged update operations: send → `Thaara WhatsApp Test` (`Ub44cxSJarXiuVBb`); claim and provider acknowledgement → `Thaara Pilot Relay 10812` (`9HD0gaPEC54utMLN`); webhook → `Thaara Dispatch Webhook` (`utwjoeN0Hf9FD94O`). No secret was retrieved or replaced. Sanitized details/version responses omit the references, so do not overstate independent readback of credential contents or current Meta validity.
- Error formatter emits only fixed fields: status `unverified`, verified=false, a numeric error code when present in supported structured locations (otherwise `unknown`), and fixed explanatory text. Authentication strings produce a fixed authentication-failure message; other errors remain uncertain. It does not copy raw descriptions, headers, tokens, phones or arbitrary exception strings to its response. Serialized errors whose numeric code cannot safely be parsed remain unknown.
- Sending remains disabled. No gate bypass, activation, credential connection test or Meta request.

## Actual verification and correction

1. Existing node schemas fetched; updated Set and WhatsApp-send configurations validated.
2. Initial atomic update rejected a `setNodeParameter` path; readback confirmed no partial mutation, then the update succeeded with the documented whole-parameter operation.
3. Six local synthetic checks passed against the first pure formatter. An actual pinned n8n run (`39417`) then caught **invalid syntax** in its complex raw expression. This was a real test failure, not provider authentication failure. The temporary diagnostic trigger was removed in finally.
4. Replaced it with simple typed Set assignments and expressions. Three actual pinned n8n runs passed: **39422** authentication failure, **39423** structured numeric error, **39424** timeout. The temporary manual diagnostic entry connected only to the error formatter; provider HTTP/send nodes were pinned, disabled or unreachable. No provider traffic or backend claims occurred.
5. Removed the temporary entry again; final graph returns to the original ten nodes. Six local assertions on the **final exact expressions** passed: authentication, nested numeric codes, timeout, serialized-error uncertainty and credential-like text suppression. These local assertions verify output values; remote execution statuses verify expression execution.
6. Tried to read only the synthetic formatter output for 39423; execution was not found because execution saving remains OFF. Do not enable saving to obtain output and do not claim retained remote response-value verification.

Final outbound version **`71021ca3-cd59-46aa-b50f-9ace7881b653`**. Readback verifies inactive/activeVersionId null, webhook/send nodes disabled, false AND server-authorization gate, success/error saving `none`, manual/progress saving false, exact final formatter parameters, no temporary trigger. Existing disconnected future-media/template placeholders remain disabled/unimplemented; their validator warnings do not establish working media/template support.

## Remaining boundaries

The previous real attempt's only recorded failure is generic authentication refusal; **synthetic code 190 is not evidence that the previous real Meta response had code 190**. Owner-replaced token has not been proven by a fresh real send. Reuse the existing credential; do not repeatedly request token recreation.

Local ten-attempt configuration/image `46605527...fb6` remains prepared but **not deployed**. The latest scope permits workflow-only work, so no backend/profile/relay write, fresh dispatch secret or image upload occurred. Before a real test: separately approve the exact backend update/temporary enable, privately update the existing dispatch header credential, authenticate a fake-ID refusal probe, check fresh customer-service window/Meta eligibility, and obtain a new exact recipient/message approval. Restore all send controls immediately after that one attempt. Do not auto-retry old/uncertain dispatches.
