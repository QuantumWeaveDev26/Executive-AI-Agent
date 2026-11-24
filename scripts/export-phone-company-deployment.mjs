// Local deterministic prompt preparation only. Build API first. No provider/API/credential/database access.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildCompanyVoiceDeploymentArtifacts} from '../apps/api/dist/services/phone-company-deployment-instructions.js';
import {buildCompanyVoiceRouteCandidates} from '../apps/api/dist/services/phone-company-routing-review.js';

if(process.argv.slice(2).some(a=>a!=='--check'))throw Error('Only --check or no arguments allowed');
const check=process.argv.includes('--check'),root=new URL('../',import.meta.url);
const destination=new URL('docs/integrations/phone/knowledge/deployment-v1/',root);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const f=buildCompanyVoiceDeploymentArtifacts(),r=buildCompanyVoiceRouteCandidates();
for(const direction of ['inbound','outbound']){
 const reviewed=await readFile(new URL(`docs/integrations/phone/knowledge/direction-review-v1/${direction}-instructions.review.txt`,root),'utf8');
 if(reviewed!==r[direction].instructions)throw Error('Reviewed route artifact stale: '+direction);
}
if(hash(await readFile(new URL('docs/integrations/phone/knowledge/review-v1/quantum-weave-public.md',root)))!==f.knowledgeSha256)throw Error('Knowledge artifact mismatch');
const artifacts={'inbound-instructions.txt':f.inbound.instructions,'outbound-instructions.txt':f.outbound.instructions};
artifacts['changes-from-review.md']='# Final instruction changes from reviewed candidates\n\n'+
 'LOCAL files prepared for owner approval. No provider changes or authorization inferred.\n\n'+
 `The common conversation/security rules are unchanged; only the development header and final rollout-commentary sentence are moved out of the prompt. Common body SHA256: ${f.commonPolicySha256}.\n\n`+
 ['inbound','outbound'].map(d=>`## ${d}\n\nReviewed SHA256: ${f[d].reviewedInstructionsSha256}\n\nFinal SHA256: ${f[d].sha256}\n\n`+
 f[d].changes.map((s,i)=>`${i+1}. ${s}`).join('\n')+'\n').join('\n')+
 '\nNo other common-body rule was removed or rewritten. No new company fact, authority, action tool, provider hook or live route was added.\n'+
 'Final prompt hashes differ from review hashes; a future operator attestation must bind the exact final committed content and actual provider evidence.\n'+
 'The original mixed v3 full replacement is a separate baseline; these files derive from the separately tested direction-review candidates.\n';
const sourceHashes={};
for(const path of ['apps/api/src/knowledge/quantum-weave.v1.ts','apps/api/src/services/phone-company-knowledge.ts',
 'apps/api/src/services/phone-company-routing-review.ts','apps/api/src/services/phone-company-deployment-instructions.ts',
 'scripts/export-phone-company-deployment.mjs'])sourceHashes[path]=hash(await readFile(new URL(path,root)));
const manifest={reviewOnly:true,uploadAuthorized:false,dispatchAllowed:false,liveIntegration:false,providerAcceptanceVerified:false,
 voicePolicyVersion:f.voicePolicyVersion,policyVersion:f.policyVersion,knowledgeVersion:f.knowledgeVersion,
 knowledgeSha256:f.knowledgeSha256,commonPolicySha256:f.commonPolicySha256,
 providerKnowledgeBaseId:'01a19bee-d7ed-778c-b0db-e320e8209de9',inboundAppVersion:null,outboundAppVersion:null,
 maxDurationSeconds:300,dailyCallLimit:5,voice:'Chaitra - Kannada Mix Support',
 prerequisites:['Owner Stage A approval','Reverified provider baselines/settings/KB identity','Distinct committed numeric provider versions',
  'Actual provider conversation/cap acceptance and separate activation approval'],sourceHashes,
 artifacts:Object.fromEntries(Object.entries(artifacts).map(([name,text])=>[name,{sha256:hash(text),utf8Bytes:Buffer.byteLength(text)}]))};
artifacts['artifact-manifest.json']=JSON.stringify(manifest,null,2)+'\n';
if(!check)await mkdir(destination,{recursive:true});
for(const [name,text]of Object.entries(artifacts)){
 const path=new URL(name,destination);
 if(check){if(await readFile(path,'utf8')!==text)throw Error('Final artifact stale: '+name);}
 else await writeFile(path,text,'utf8');
}
console.log(JSON.stringify({status:check?'verified':'exported',outputDirectory:fileURLToPath(destination),providerCalls:0,uploadAuthorized:false,
 inboundSha256:f.inbound.sha256,outboundSha256:f.outbound.sha256,files:Object.keys(artifacts)}));
