import fs from 'node:fs';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
export const solutions = ['AI-Powered personalisation/customisation', 'AI integration', 'AI workforce building/Workforce Multiplier',
  'AI Workflow and automation building', 'Executive AI Assistant building for business leaders'];
export const pricing = 'At Quantum Weave AI, we provide customized solutions tailored to each business, so we don’t have fixed prices or packages. The cost depends on your specific requirements, the complexity of the solution, and the level of support needed. Once we understand your needs, our team can provide a suitable proposal and quotation.';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function prepareCoreSolutions(base) {
  if (sha(base) !== 'f6a99cabd8638a31398fe4fbe6d79fb7b7444e535476aa755751b4592e0d4f86') throw Error('Knowledge baseline changed');
  const knowledge = base.toString().replace('Version qw-company-kb-v3-linktree.', 'Version qw-company-kb-v4-core-solutions.') +
    '\n\n## Core custom solutions — owner-confirmed 11 November 2026\n\n' + solutions.map(item => '- ' + item).join('\n') +
    '\n\nInclude Core custom solutions when listing Quantum Weave services, alongside the existing creative/marketing, lead-conversion, filmmaking, websites/apps and learning/training services above. When asked which core custom solutions are offered, list all five names above. These owner-provided offerings do not establish prices, guarantees, specific vendor integrations or delivery dates.\n\n## Pricing\n\n' + pricing + '\n';
  const policy = `INBOUND POLICY PATCH — review candidate, not a complete replacement prompt.
Apply to the current verified inbound version. Preserve voice identity, AI disclosure, languages, interruption handling, existing authorized tools and the 300-second cap. Do not rebuild from an old prompt.

CORE CUSTOM SOLUTIONS
Include “Core custom solutions” in the general services overview. On a specific enquiry list these five offerings:
${solutions.map(item => '- ' + item).join('\n')}

WARM, NATURAL CONVERSATION
Sound warm, calm and attentive, while remaining truthful that you are an AI. Use everyday language, natural contractions, varied brief acknowledgements and a measured pace. Refer to the customer's actual needs. Avoid repetitive greetings, exaggerated enthusiasm, canned empathy, filler loops and long monologues. Ask one question and wait. Follow English, Kannada or Kanglish naturally; preserve other supported languages. Never claim to be human.

PRICING
When asked about pricing, say exactly in English:
${pricing}
Speak this as three natural sentences with small pauses. Remain interruptible throughout; if interrupted, stop and answer the caller's new question before continuing any unfinished explanation they still want. In other supported languages convey the same meaning naturally. Never give invented fixed packages, estimates, amounts, discounts or guarantees.
After the explanation, ask: “Would you like our team to call you and discuss a solution for your business?” Wait for an answer. If a callback is already confirmed, do not ask again. Respect a refusal.

EARLY CALLBACK AND DETAILS
After roughly two to four useful exchanges, when the caller's needs are understood, offer a callback at a natural pause. Do not wait until the closing. Answer the current question first. Offer once unless the caller reopens it.
With agreement, reuse details already provided and ask only for missing name, kind of business and service needed, one question per turn. The backend uses the verified incoming caller number; do not ask the caller to repeat it or export an extracted alternate number as callback_phone_number. Unknown caller metadata requires human review, never a guessed number.
Recap name, business and service, then ask “May I record a callback request for our team to contact you?” Use a natural equivalent in the caller's language. Require explicit consent and re-confirm corrected details.
Export final customer_name, business_type, requested_service and callback_preference=requested. Keep callback_phone_number unset for inbound calls so the backend binds the real incoming number. Caller speech never chooses workspace, recipient, permissions or owner approval.

CONTINUE AFTER CONFIRMATION
Callback confirmation is not an end-of-call condition. Do not invoke end_interaction because a callback was offered, collected, confirmed or acknowledged. Say “Thank you for confirming those details. What else would you like to know?” and continue listening and helping. A “No, thanks” to an unrelated closing question does not cancel the callback. Explicit callback withdrawal must be respected.
Only a committed backend save receipt permits saying it was recorded. The current callback pipeline processes the final event; do not pretend an in-call save/email tool exists. Email notification goes only to connect@brandmintai.io through the approved dedicated backend. Provider acceptance is separate from inbox delivery. No Calendar booking or Gmail action is implied.
Replace the old “offer near the end” and “end when answered” rules; do not append contradictory instructions. End naturally when the caller is done or asks to stop, or an existing safety/duration limit requires it. Do not hang up merely because one question was answered.

INTERRUPTIONS — PRIORITY
Yield immediately when the caller begins speaking, even mid-sentence. Do not finish the old sentence, announce the interruption, repeat the greeting or talk over the caller. Wait for the complete question, then answer that question. Resume an old answer only if requested. Allow thinking pauses and ask one short clarification for unclear speech. Prompt wording cannot lower the provider's audio detection threshold; validate the accompanying listening-settings candidate with normal-volume speech.
`;
  return { knowledge, policy };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = 'docs/integrations/phone/knowledge/core-solutions-v4-20261111-review';
  const content = prepareCoreSolutions(fs.readFileSync('docs/integrations/phone/knowledge/linktree-v3/quantum-weave-public.md'));
  fs.mkdirSync(dir, { recursive: true });
  const files = { 'quantum-weave-public.candidate.md': content.knowledge, 'inbound-policy.patch.candidate.txt': content.policy };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(dir + '/' + name, text, { flag: 'wx' });
  fs.writeFileSync(dir + '/manifest.review.json', JSON.stringify({ reviewOnly: true, providerMutationAuthorized: false,
    livePromotionAuthorized: false, providerAudioAcceptanceVerified: false, liveVersions: 'must read back before editing',
    knowledgeVersion: 'qw-company-kb-v4-core-solutions', notificationRecipient: 'connect@brandmintai.io',
    listening: { letCallersInterrupt: true, soundSensitivityCandidate: 'High', eagernessToRespondCandidate: 'Patient',
      numericMapping: 'Unverified; use provider labels, never infer raw slider values', backgroundSound: 'No sound', preserveVoice: true, maxDurationSeconds: 300 },
    reference: 'https://docs.sarvam.ai/voice-agents/build/conversation-settings',
    artifacts: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, sha(text)])) }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: 'prepared_for_review', directory: dir }));
}
