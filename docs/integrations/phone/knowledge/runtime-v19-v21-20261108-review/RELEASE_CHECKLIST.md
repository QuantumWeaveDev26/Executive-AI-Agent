# Sarvam v19 and v21 release checks

The [candidate profile](runtime-profile.candidate.json) pins outbound v19, inbound v21, `qw-company-kb-v3-linktree` and a five-minute cap. It is staged for review. SHA-256 `356817ecbc08500d9d73943eb988caa5b4d3490eee3fb070426a5036cc657a3e`.

| Check | Required evidence | Status |
| --- | --- | --- |
| Outbound v19 browser Voice | With synthetic recipient and purpose, interrupt a company answer. The agent yields promptly, hears the full question, answers from the company guide and returns only to the approved purpose. | Pending owner test |
| Inbound v21 browser Voice | Verify the help-first greeting and AI disclosure. Interrupt the services answer in English or Kannada/Kanglish. The agent yields, hears the full question and answers it. | Pending owner test |
| Duration | Record version-specific provider evidence for the configured five-minute cap. Record automatic hang-up separately if observed. | Setting read back on both versions. Enforcement pending |
| Outbound rollback and compatibility | Preserve the exact v2 profile and the previous shared API image. Verify private relay and public health with the new image active. | Complete. V4 is live on VPS 1871828. Outbound still uses the verified v2 profile. |
| Inbound rollback | Confirm the named inbound deployment is active on v5 just before changing it. Preserve its number, connection, schedule and starting language. | v5 verified on 8 November |
| Live acceptance | With explicit approval and one consenting test recipient, verify one call per direction, final call status, Thaara report delivery and outbound spoken readback. Use verified recipient speech for any claimed outcome. | Pending |

Record candidate version, direction, language, interruption result, observed duration, report result and the source of the observation. Use synthetic details in previews. Keep phone numbers, private audio and transcripts out of the receipt.

For each preview record whether Thaara stopped speaking, heard and answered the complete interruption, and dropped the old answer. Also record whether outbound v19 kept its approved purpose and inbound v21 disclosed that it is AI. After reviewing these observations and the exact-version five-minute settings, use `node scripts/prepare-phone-sarvam-v19-release.mjs <evidence.json>` to produce a separate local profile for approval. It pins the evidence checksum and refuses incomplete results, wrong versions or an edited candidate. It does not authenticate provider observations or install the profile.

After the previews and preflight pass, request a single scoped approval for the exact switch, rollback and consented live checks. Build a separate admitted runtime profile only from verified evidence. Preserve the existing authenticated draft and approval path, and re-prepare any outbound call draft bound to the previous configuration. Verify the rollback target before changing traffic and restore that direction if its live checks fail. Keep the separate Calendar and shared WhatsApp releases outside this change.

## Retained deployment and rollback targets

| Component | Candidate | Rollback |
| --- | --- | --- |
| Shared API image | `sha256:da0cf28a92658a89498693e8b1724377be8a399c5c693f31db506f3d64b12d81`, V4 deployed and verified | `sha256:df1499e3a4b7cfbfab87f9ba4face080bb44737a8a3f2d4b0767cd7b270a99c5` |
| Outbound runtime profile | v19 with admitted v19/v21 evidence | v2, profile SHA-256 `7a41b4f34482ccf833fcdab6b7bb0c8a5c198f52a994ec4d8c0ca11a19596447` |
| Sarvam inbound binding | v21 | v5, same deployment and number |

The approved compatibility deployment is complete. It preserved the shared relay and verified public assets and access. Before applying the admitted outbound profile or switching the inbound binding, recheck that V4 is healthy and that v2 and v5 are still the live versions. Preserve the exact previous image reference, v2 profile and v5 binding. Include the verified relay reattachment and conditional public-route refresh in the approved rollout if it recreates the API. Stop on unexpected shared changes and restore the previous state if a release check fails.
