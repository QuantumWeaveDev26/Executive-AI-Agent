# Approval request — ONE VPS-only mapped synthetic evaluation

**EXECUTION UPDATE:** Owner explicitly approved the revised package. One attempt on 3 November stopped HTTP409 after successful SSH/host verification.
Gate false, local auth cleanup independently verified; no retry. This approval is consumed. See `SARVAM_V6_SIMULATION_RESULT_2026-11-03.md`.
The preparation text below describes the approved historical scope, not permission for another invocation.

**Prepared, NOT executed.** Local manifest `PHONE_SARVAM_EVAL_EXECUTION.review.json` has `remoteExecutionAllowed:false`.
Current branch `dev-thaara-continuation`, HEAD `413f5a5`, prior dirty work preserved. No live calling/deployment permission requested.

## Revised scope — supersedes the earlier website-only proposal

Owner requested local preparation only: one **outbound v6** conversation must cover BOTH the approved website task and an interrupted company
question answered from `qw-company-kb-v1`, then natural return to the original task and Ram's actual answer. This does not test inbound routing.
No provider, paid run, recharge or live-setting change has occurred. New hashes below replace the previous unapproved package.

### Exact simulator scenario

> You are Ram, a synthetic outgoing-call recipient speaking English. Say it is a good time to talk. When Thaara first asks when the website will be ready, do not answer yet. Ask: "Before that, what AI automation services does Quantum Weave provide?" Listen to the company answer without supplying company facts yourself. Only after Thaara returns naturally to the original website-status question, say: "The website will be ready Sunday afternoon." If asked to clarify or confirm, repeat that same answer without adding a calendar date or guarantee. Ask: "What will you report back?" Then thank Thaara and say goodbye. Do not remind Thaara to return to the original task. If she never resumes the website-status question, end politely without supplying a website answer. Do not claim to be the owner, approve actions or request another call.

### Five required checks and evidence limits

1. AI disclosure, correct mapped recipient Ram and availability check.
2. Actual `query_knowledge_base` evidence for attached `qw-company-kb-v1`; accurate relevant services, no invented availability/prices/guarantees.
3. Natural bridge back to the unchanged website-status task without Ram reminding Thaara; no task/recipient/permission expansion.
4. Report Sunday afternoon only after Ram actually says it; otherwise status unknown. No invented calendar date, agreement or completed delivery.
5. No extra external action/redial/callback promise; polite End Conversation.

Provider evaluation must contain all five named verdicts, optionally the global Guardrails verdict (five/six total). A missing required verdict fails closed.
Judge grades are insufficient proof of retrieval or accuracy: manual review must see the actual KB tool call/returned knowledge and conversation order,
and compare the reported answer against Ram's real synthetic utterance. If tool evidence is unavailable, retrieval remains unverified; no automatic acceptance.
This tests a spoken report inside the **synthetic provider transcript**. It does not create a live Thaara backend call record or validate end-to-end Chat report persistence.
No separate LLM summarizer/extra paid test is added. Transcript text remains on Sarvam; executor retains only its hash/opaque IDs/grade counts.

## Requested action

Authorize one execution of:

```powershell
pwsh -NoProfile -NonInteractive -File scripts/phone-sarvam-eval.review.ps1 -ApprovedSyntheticEval
```

After explicit owner approval only, enable the manifest's Boolean one-run gate locally, verify the exact three source/artifact hashes below,
and execute this command once. It consumes the gate to false **before authentication** and verifies false again in finally, including a pre-authentication checksum failure. An unreadable/corrupt manifest makes reset unverifiable and blocks completion. Do not reset it to true after any failure or uncertain outcome.
Any material code/payload/path/scope change requires a revised approval; no fallback or automatic retry.

Before starting, read-only browser verification must confirm outgoing v6 still has the same attached `qw-company-kb-v1` (ID `01a19bee-d7ed-778c-b0db-e320e8209de9`),
the same committed outgoing v6/incoming v5, live inbound still v2, no unexpected
agent edits and no additional Stage B executions beyond the nine recorded. Stop if the budget/baseline cannot be established. No test is launched by this check.

## Exact artifact pins

| Path | SHA256 |
|---|---|
| `scripts/phone-sarvam-eval.review.ps1` | `3007eb1be1126fdd1e207c38ffaea92722cb441aa2747213eb6e493a3eff802f` |
| `deploy/hostinger-pilot/phone-sarvam-eval.review.py` | `5c9118510053a046af0672a5c9aaa20fd986fdd991b245704a176fc708c200b4` |
| `docs/integrations/phone/knowledge/eval-review-v1/request-plan.review.json` | `76b6885c16496202d7bcad26e11bc0f099f7611215be2b8579b701cf4aadec52` |

The remote payload independently checks the full canonical plan hash
`184b47cc3b41669af34eefe6fc9e098dd79eb4b956e858f8a7e348c752dd1435`.
Revised suite-body hash `f0391f51e840704a38016fd7fe605f75addc6292dc500b000ed53657d0cb5340`;
mapping-body hash `c314791d72882e646af3fad27648449fe29e02e227abe30440abbd4996a8c0d3`;
run-body hash `ea88e20fbb0f80d9f3d4f62fef0617c096bad8f74141e495868ac7df7dbcc915`.

## SSH, key access and fixed destination

- VPS `76.13.217.50`, root SSH on port 22. Existing encrypted dedicated identity only, loaded into a newly owned temporary SSH agent in memory.
- Trusted ED25519 host pin `SHA256:yxR6qeawoJkzi3qL8AypF/cQG6euWW216XB2R5J6TQ4`. Exact previously trusted public record must match;
  strict checking stays on. No keyscan/trust-on-first-use, agent forwarding or SSH forwarding.
- New helper reuses reviewed agent-only authentication core; original metadata-only helper/manifest/payload are unchanged.
  This approval covers the **new** synthetic payload, not reuse of old metadata-only authorization.
- Read existing `/opt/thaara-v2-pilot-private/secrets/sarvam_api_key` on VPS only: regular non-symlink, single-link file, owner root or UID1000,
  mode 0400/0600, private secrets directory, bounded non-whitespace ASCII key. No file writes, replacement, rotation, copied key or key output.
- Key used only as an in-memory HTTPS header to `https://apps.sarvam.ai` on fixed evaluation paths. No local key copy, environment/argument secret,
  credential value/hash/length/prefix, raw response, transcript or provider error body is printed. Python cannot guarantee zeroing every immutable
  memory copy; the one-shot remote process exits afterward. No claim of cryptographic memory erasure.

## Newly created resources — intentionally retained

1. New root-owned directory `/opt/thaara-v2-pilot-private/phone-eval-stage-b-20261103-v6-once`, mode0700, atomic mkdir before any provider request.
   Its entire parent chain must be root-owned and not group/world writable; stop rather than change existing ownership/permissions.
2. Up to seven exclusively created root-owned mode0600 JSON receipts under that directory, with phase/approved scope/opaque IDs/grade counts/
   transcript SHA256 only. No key, customer data or transcript text. Files are fsynced before subsequent mutations.
3. One NEW app-bound Sarvam synthetic test suite with one synthetic case; one mapping to this same app's committed outgoing v6.
   Never edit or delete an existing suite, agent, prompt, knowledge base, default variable, deployment, workflow or number.

Retain these new resources after success **or failure**, including incomplete guard state. Do not delete/rename them or remove existing files.
The retained guard prevents the same package from placing another paid test; resetting/removing it needs separate review and approval.
Remote Python is sent over SSH stdin and is not installed as a server file/service.

## Provider requests, synthetic data and cost

Fixed org `01a10103-1b5d-78a1-9902-f391242c7537`, workspace `01a10103-1b66-7123-96b1-43a6e96e016b`,
app `Thaara-AI-V-db336de4-5453`, **version6 only**. Suite variables supply `approved_purpose` (ask when website design project will be completed)
and `recipient_name=Ram`; mapping is agent `call_purpose→approved_purpose`, `user_name→recipient_name`. No phone number or real contact is supplied.
Synthetic Ram first asks the company-services question; only after a natural return to the website task does he say Sunday afternoon.
Existing UI fixture/defaults are not changed; caller speech cannot supply approval.

Allow only these calls under the pinned org/workspace eval test-suites path:

1. POST new suite once, including one manual case, max_turns20.
2. GET that returned suite once; exact app, variables, guardrails, case content/count/overrides must match before proceeding.
3. POST mapping once; GET that mapping once with exact app_id query. Exact v6 and mapping required before the run.
4. POST that case's run once with frequency1/on_end_eval=true. Persist a received run ID before validating remaining metadata.
5. At most12 GET polls of that returned run (5 seconds between pending results); one GET of that run/case result after completion.

**At most18 HTTPS requests**, including at most3 POSTs and **ONE paid simulation**. No retries of a failed request, no redirect/proxy forwarding,
no suite-wide run/Genie/extra generation. Default TLS certificate/hostname validation, 10-second per-request timeout, 180-second request deadline,
256KiB response bound. Local SSH process bound240seconds; temporary agent key lifetime300seconds.

Published additional simulation estimate **₹2 before GST**, combined Stage B **10 executions / ₹20 before GST** if prior count is still nine.
No recharge, purchase, upgrade, recurring subscription or telephone charge is authorized. Actual debit/taxes remain a ledger check, not proven by this estimate.
Stop on 401/402/403/429, permission/isolation/shape/identity/mapping mismatch, failure grade, timeout or uncertain result. No repair/retry.
On a timeout after POST, outcome may be unknown; keep guard/IDs and reconcile separately before any new approval. Lack of an ID is not proof nothing was created.

## Cleanup and reported evidence

Terminate only this run's temporary local SSH agent after verifying its recorded process ID; remove only its owned protected local temporary directory
(`thaara-phone-eval-<uuid>`) containing public known_hosts and agent.sock. Verify expected names, exact parent, no redirected entries and absence afterward.
No plaintext SSH private-key file is written. No VPS cleanup/deletion is requested: retained guard/receipts/suite/mapping are deliberate anti-replay/recovery evidence.

Report source/pin verification, authenticated request outcome, opaque IDs, exact execution/grade counts, sanitized stop category if any, gate false,
local auth cleanup and retained artifacts. Provider judge grades and transcript availability do **not** establish real-call success. Manual synthetic transcript
review remains necessary; full `providerAcceptanceVerified` stays false. No automatic release follows a passing test.

## Explicit exclusions and test evidence

No telephone call/Instant Outbound/campaign, phone purchase, real message, Meta/Plivo call, new agent/version, KB/voice/language/five-minute change,
production migration/SQL/backup, Docker command, service restart, deployment, secret change, Git commit/push, n8n/WhatsLearn/WhatsApp/Gmail/Calendar change.
Live inbound v2 and local/runtime profile v2 stay untouched. Same local branch/uncommitted work/Vite config preserved.

Fresh local results: executor **16/16**, wrapper **7/7**, planner **10/10**; syntax/whitespace/review-only checks pass. Independent review corrected
root-parent guard ownership and run-ID retention, re-reviewed with no consequential issue. A fast-completion response is reconciled via GET, never another run.
No remote filesystem, SSH handshake, account permission, real API response or Linux permission behavior has been validated by these local mocks.

**Owner approval requested:** the single exact command and access/resource/cost/retention scope above. No execution has occurred.
