# Stage C outbound v6 admission candidate — LOCAL ONLY, approval pending

## Verified checkpoint

The paced v6 synthetic evaluation is complete: saved v4 receipt reports five required verdicts Pass, one simulation, no telephone calls,
successful cleanup/reset. All ten `PHONE_SARVAM_*.review.json` gates are false. No completed diagnostics or provider tests were repeated.
The original inbound rollout/personal-phone test package remains prepared and unchanged:
`INBOUND_V5_ROLLOUT_APPROVAL_2026-11-03.md`. It still awaits approval for the existing inbound deployment v2→v5.

The actual saved receipt contains **nine sanitized speech turns**; its narrative report says eight. This local package records the actual nine.
Its `transcriptSha256` hashes the original provider transcript, NOT the sanitized turns. The raw transcript is absent locally, so that original
digest is retained as a reported value, not independently recomputed. A separate digest covers the saved sanitized speech. No raw tool-frame proof is invented.

## Prepared artifacts

- `sarvam-runtime-profile.stage-c-v6.review.json`: separate, non-secret candidate; `appVersion:6`, `companyKnowledge.inboundAppVersion:5`.
- `knowledge/stage-c-v6-review/admission-evidence.review.json`: redacted source-receipt hash, five verdicts, transcript digest provenance and pending gates.
- `knowledge/stage-c-v6-review/admission-manifest.review.json`: exact artifact/source hashes and preservation snapshot.
- `scripts/prepare-phone-stage-c-candidate.mjs`: deterministic local generator/checker; no network, credentials, deployment or execution-gate writes.

Commands for this local package only:

```sh
node scripts/prepare-phone-stage-c-candidate.mjs --check
```

`--write` regenerates only these three review artifacts after checking pinned inputs. It never writes the active pilot profile or any reviewed execution gate.

The candidate preserves existing provider identity, connection, phone number and task/recipient mapping. Its binding pins the existing KB ID/version,
KB bytes, exact committed outgoing v6 prompt bytes, identical v5/v6 shared policy suffix and pending evidence manifest. Route policy remains v1,
voice policy v2. `policySha256` covers the FULL v6 instruction artifact; `commonPolicySha256` covers its exact common suffix, not an old v1 policy.
New content/evidence/version changes must produce a different binding/fingerprint and invalidate stale approvals.

## Intentionally NOT admitted

The actual generated candidate has `reviewOnly:true`, `runtimeProfile:false`, `companyKnowledge.reviewOnly:true` and
`providerAcceptanceVerified:false`. `verifiedMaxCallLengthMinutes:null` prevents silently carrying the active v2 duration attestation to v6.
Required duration remains five minutes / 300seconds. Historical v6 five-minute configuration evidence exists; explicit admission must state its basis
and distinguish a configured cap from an independently observed five-minute hang-up. Do not repeat paid tests solely to recreate unchanged evidence.

The existing runtime parser rejects this artifact with profile-not-runtime, duration-not-verified and knowledge-binding-invalid reasons.
Even flipping only the top-level flags cannot admit it. The live switch remains mandatory, and the loader refuses the candidate before reading secrets.
No new startup wiring, policy exception, provider adapter, database or environment change was introduced.

Unit tests use a hypothetical admitted copy **in memory only** to prove parser/fingerprint compatibility. This is not a provider attestation and is never
exported/installed. The existing parser checks the structure of a trusted operator attestation; it does not independently authenticate the referenced evidence.
**Do not promote by flipping flags.** First complete/approve admission evidence, regenerate a separately reviewed installable profile and pin its new hashes.
Leave the original synthetic receipt unchanged, including its acceptancefalse flag.

## Approval and rollout sequence — no execution in this local task

| Step | Exact bounded owner decision / required evidence | Current state |
|---|---|---|
| A — inbound | Approve the existing inbound v2→v5 routing package and owner-initiated personal-phone test, including its explicit cost scope. Preserve deployment/number/schedule; verify post-switch readback. Roll back to preserved v2 only under its scoped approval. | Prepared; not executed. |
| B — outbound evidence admission | Separately approve a read-only review of the EXISTING completed v6 result/tool trace and unchanged v6/KB/duration settings. Use existing receipt references; no new simulation, Genie, provider mutation, credentials change or VPS deployment. Raw KB tool call + returned source must be observable; stop if unavailable rather than substituting the judge's claim. Record inbound v5 routing readback after A, and explicit operator duration/admission basis. | Pending; no provider access authorized now. |
| C — finalize locally | After evidence review/owner sign-off, produce a NEW admitted profile/evidence manifest with new exact hashes; validate it through existing loader/fingerprint tests. Do not alter the review candidate or original receipt to fabricate historical verification. | Candidate prepared; no admissible profile generated yet. |
| D — controlled outbound installation | Present a separate exact VPS profile-install/startup/rollback package against the finalized hashes. Preserve existing credentials/300second/daily5/consent/approval/audit/no-redial controls. Review API restart/reload requirements; do not assume a profile file edit updates an already-created provider instance. Existing Gmail/Calendar memory-only sessions may require reconnect if that service is restarted; include impact explicitly. | Not approved or executed. |
| E — real end-to-end test | Separately approve one consenting own-number call with exact purpose/language/time/cost scope; new approval bound to new fingerprint, no automatic retry. Verify actual conversation/result correlation, written Chat report and spoken report; mark uncertain results honestly. | Not authorized; provider simulation did not test live Thaara Chat report persistence. |

Step A is independently ready for scoped approval using its existing package. B's read-only review scope can be approved separately; it is NOT permission for
installation/calls. D must become concrete after the admitted profile/evidence hashes exist—do not claim the blocked review artifact is ready to deploy.
No key/account setup is requested or repeated. The existing protected credentials remain where they are; no secrets should be pasted into chat.

## Local verification and preservation

Fresh focused run: **48/48 passed in four files** — new candidate8, knowledge-binding22, runtime-security14, configuration-pinning4.
Initial Vitest startup was blocked by local process-spawn EPERM; authorized local execution then confirmed seven expected missing-artifact failures
before generation. The loader test was strengthened to require the intended refusal reasons, not merely any error.
Generator initially rejected an incorrect equality assumption between raw and sanitized transcript digests; inspected the existing sanitizer and kept the
digests/provenance distinct rather than changing the recorded evidence. `--check` now verifies exact deterministic bytes.
Machine-readable results: `node_modules/.cache/phone-stage-c-local-verification-20261103.json`.
Independent focused review found no consequential issue. Full API/web regression and builds were not repeated for unchanged application source.

Active `sarvam-runtime-profile.pilot.json` remains byte-identical, appVersion2, SHA256
`7a41b4f34482ccf833fcdab6b7bb0c8a5c198f52a994ec4d8c0ca11a19596447`.
Inbound rollout document and `apps/web/vite.config.ts` remain byte-identical. No VPS connection, provider request, live routing change, call,
SQL/infrastructure, credentials, service restart, commit/push or deployment occurred. All ten execution gates remain false.
