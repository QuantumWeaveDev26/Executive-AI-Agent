# Inbound company pricing disclosure correction — 3 November 2026

Status: LOCAL REVIEW ONLY. Owner confirmed to keep the existing knowledge and change only pricing disclosure. No provider change authorized by this document.

## Prepared change

Same company facts, services, training framework, contact, languages and security rules. Remove historical company price amounts from the customer-facing knowledge revision. Replace the historical-price permission in inbound instructions with a prohibition on quoting prices, including old prices, estimates, ranges, discounts or confirming amounts suggested by callers. Apply in English, Kannada, Hindi and mixed speech.

Suggested response: “We provide custom solutions based on your requirements. Our team can discuss the scope and prepare a suitable quote. What would you like help with?”

Do not volunteer prices or recite the entire service catalogue; answer the actual service question. Do not claim a quote, booking, follow-up or message has been created. Telephony billing disclosures, owner call budgets and authorization safeguards are unaffected by this customer-facing company-price policy.

Review files: `knowledge/no-pricing-v2/quantum-weave-public.md`, `inbound-instructions.proposed.txt` and `review-manifest.json`. The revision label is proposed metadata, not a new agent or a provider resource already created. The same existing knowledge is reused; company/services/training sections are preserved. Baseline v1/v5 artifacts remain intact for existing pins and rollback.

## Verification

Five local tests passed with `node --test --test-isolation=none scripts/prepare-phone-no-pricing.test.mjs`: historical amounts removed/services and training preserved; custom requirements/no-price policy; direction/language/duration/action restrictions; billing safeguards; changed-baseline rejection. Initial ordinary Node test mode could not spawn a subprocess (EPERM); in-process mode ran successfully. Initial missing-module failure preceded implementation.

Deterministic `node scripts/prepare-phone-no-pricing.mjs --check` passed. Existing `prepare-phone-stage-c-candidate.mjs --check` also passed; active and candidate profiles and their pinned evidence unchanged. No full regression repeated for this unwired artifact-only change. Local text checks do not prove spoken provider compliance.

## Live update boundary

Owner reports inbound calling is working; its current deployed version has NOT been independently verified in this session because browser control is disabled. Do not assume the previously approved v2→v5 switch was executed. That approval does not authorize publishing a changed version or modifying a KB.

Before live work, restore browser control or guide the owner through manual read-only verification of the actual current route, KB and agent settings. Capture that exact baseline for rollback. Then request scoped approval for applying this pricing-only knowledge/instruction revision to the SAME agent, saving one new committed inbound version and routing only the existing inbound deployment to that version, with rollback to the captured baseline. No new agent or number. Preserve Chaitra, enabled languages, five-minute setting, number, connection and schedule.

Do not overwrite a shared live KB in place: that could change outbound v6 and other pinned consumers. Use an isolated knowledge revision with identical non-pricing content for the new inbound version; confirm actual provider revision/attachment mechanics before proposing exact mutations. No changes to outbound v6 or Stage C. No automatic paid simulation, test call, credential change, VPS/database action, deployment, commit or push. If exact provider mechanics differ, report before acting.

Owner can instead apply the reviewed text manually after the same baseline/rollback checks; do not claim the update is live until post-save version/attachment/route readback is verified.
