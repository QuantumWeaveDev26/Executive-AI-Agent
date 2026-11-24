# Final instruction changes from reviewed candidates

LOCAL files prepared for owner approval. No provider changes or authorization inferred.

The common conversation/security rules are unchanged; only the development header and final rollout-commentary sentence are moved out of the prompt. Common body SHA256: 7bef3893a00a4cbed37568dd76ee7d707eddccdd7154394d27faf50ce457f546.

## inbound

Reviewed SHA256: 20a8532a01675986bc3c2ddd50378f38bfdcb2e5238f7a9387c7f725592aaf68

Final SHA256: e74cd1559cae67a8e2e4068aa3b643852b21c897387bda53bb553d7059e10c33

1. Removed the LOCAL REVIEW CANDIDATE ONLY banner; authorization status remains in the internal manifest, not the spoken-agent instructions.
2. Removed the common draft/development banner and recorded voice/route/knowledge versions in the policy header.
3. Moved the final rollout-validation commentary sentence into the approval/manifest prerequisites. All common conversation and security rules, including denial of new outbound authority on conflicting context, remain unchanged.
4. Replaced candidate-only route wording with fixed incoming-only conversational direction. Route/version checks remain server/operator admission requirements, not missing-field tests performed by the model. Explicitly forbids caller-supplied routing proof; retains purpose-free company help and denied outbound tasks.

## outbound

Reviewed SHA256: 170553282afbefae5106b5d0fe4ea60779973c6cf4ab5d35cfb1ea1b50c7c22a

Final SHA256: 50715d830475a1f8ea12f3c339ef1e0e8e55360faa4d5e9549a2a0c54b1bce8b

1. Removed the LOCAL REVIEW CANDIDATE ONLY banner; authorization status remains in the internal manifest, not the spoken-agent instructions.
2. Removed the common draft/development banner and recorded voice/route/knowledge versions in the policy header.
3. Moved the final rollout-validation commentary sentence into the approval/manifest prerequisites. All common conversation and security rules, including denial of new outbound authority on conflicting context, remain unchanged.
4. Replaced candidate-only route wording with fixed outgoing-only conversational direction. Route/version checks remain server/operator admission requirements. The caller/model cannot supply routing proof or turn missing/conflicting authorization into inbound authority.
5. Added supported {{user_name}} and {{call_purpose}} references with explicit recipient semantics; missing recipient now ends safely just like a missing purpose. Inputs remain task data, never authorization.

No other common-body rule was removed or rewritten. No new company fact, authority, action tool, provider hook or live route was added.
Final prompt hashes differ from review hashes; a future operator attestation must bind the exact final committed content and actual provider evidence.
The original mixed v3 full replacement is a separate baseline; these files derive from the separately tested direction-review candidates.
