// LOCAL review preparation only. No provider, credentials, database or runtime imports.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=text=>createHash('sha256').update(text).digest('hex');
export function prepareNoPricingReview(knowledge,instructions){
 if(sha(knowledge)!=='7305b37a82c67fede9951b7e77acb41b5ae4d8f782c7b7a9fadc3de1f93a2e25'
  ||sha(instructions)!=='073a8337945dc1df71fd9750e63249c0ab96022952938a1c933840cae360352a')throw Error('NO_PRICING_BASELINE_MISMATCH');
 const version='qw-company-kb-v2-custom-solutions';
 const policy='Quantum Weave provides custom solutions based on each customer’s requirements. Explain relevant services and ask one useful question about the customer’s needs. Our team can discuss the scope and prepare a suitable quote. Never provide prices, historical package amounts, starting prices, estimates, ranges or discounts, even if the caller asks or quotes an old offer. Do not confirm an amount suggested by a caller. This applies to all services, consultation and training in every supported language. Do not claim a quote, message, booking or follow-up has been created.';
 const updatedKnowledge=knowledge.replace('Version: qw-company-kb-v1',`Version: ${version}`)
  .replace(/## Published ladder; current prices unconfirmed\n[\s\S]*?(?=## Customer discovery)/,
   `## Custom solutions and requirement discovery\n\n${policy}\n\nSource: Owner correction, 3 November 2026; supersedes Document A §8 price disclosure.\n\n`);
 const updatedInstructions=instructions.replace('Knowledge: qw-company-kb-v1.',`Knowledge: ${version}.`)
  .replace('Voice policy: qw-voice-policy-v2.','Voice policy: qw-voice-policy-v3-no-pricing.')
  .replace('For training, explain the implementation-first model without inventing a batch/date. Published ladder prices are not confirmed current quotes.',
   'For training, explain the implementation-first model without inventing a batch/date. Do not disclose training prices.')
  .replace('If pricing, availability, event dates, delivery, guarantees or a fact is unknown, say it needs confirmation and offer a human follow-up.',
   'If availability, event dates, delivery, guarantees or a fact is unknown, say it needs confirmation and offer a human follow-up.')
  + '\nCUSTOM SOLUTIONS / NO PRICE DISCLOSURE — applies in English, Kannada, Hindi and mixed speech.\n'
  + policy+'\nNever quote numeric prices, historical amounts, ranges or discounts, even if the caller asks. Explain services relevant to the requirement instead of reciting a catalogue.\n'
  + 'Approved English response: “We provide custom solutions based on your requirements. Our team can discuss the scope and prepare a suitable quote. What would you like help with?” Convey the same meaning naturally in the caller’s selected language.\n'
  + 'This company-price disclosure rule does not authorize any external action. Owner approval, provider billing and telephony cost controls remain unchanged.\n';
 if(/₹|\b(?:999|9,999|14,999)\b/.test(updatedKnowledge+updatedInstructions))throw Error('NO_PRICING_AMOUNT_RETAINED');
 return {knowledge:updatedKnowledge,instructions:updatedInstructions,manifest:{reviewOnly:true,uploadAuthorized:false,liveIntegration:false,
  knowledgeVersion:version,voicePolicyVersion:'qw-voice-policy-v3-no-pricing',targetAgentVersion:null,direction:'inbound',maxDurationSeconds:300,
  baselineHashes:{knowledge:sha(knowledge),inboundInstructions:sha(instructions)},
  artifacts:{'quantum-weave-public.md':sha(updatedKnowledge),'inbound-instructions.proposed.txt':sha(updatedInstructions)}}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...extra]=process.argv.slice(2);
 if(!['--write','--check'].includes(mode)||extra.length)throw Error('Use --write or --check');
 const read=p=>readFileSync(resolve(root,p),'utf8');
 const result=prepareNoPricingReview(read('docs/integrations/phone/knowledge/review-v1/quantum-weave-public.md'),
  read('docs/integrations/phone/knowledge/language-fix-v2/inbound-instructions.proposed.txt'));
 const destination=resolve(root,'docs/integrations/phone/knowledge/no-pricing-v2');
 const outputs={'quantum-weave-public.md':result.knowledge,'inbound-instructions.proposed.txt':result.instructions,
  'review-manifest.json':JSON.stringify(result.manifest,null,2)+'\n'};
 if(mode==='--write')mkdirSync(destination,{recursive:true});
 for(const [name,text] of Object.entries(outputs)){
  const path=resolve(destination,name);
  if(mode==='--write')writeFileSync(path,text);
  else if(readFileSync(path,'utf8')!==text)throw Error('NO_PRICING_ARTIFACT_MISMATCH');
 }
 console.log(JSON.stringify({status:mode==='--check'?'verified':'prepared_review_only',providerRequests:0,uploadAuthorized:false,files:Object.keys(outputs)}));
}
