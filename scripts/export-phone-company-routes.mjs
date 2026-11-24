// LOCAL export only. Build @thaara/api first. No provider, credentials, network, database or runtime configuration changes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildCompanyVoiceRouteCandidates} from '../apps/api/dist/services/phone-company-routing-review.js';

if(process.argv.slice(2).some(a=>a!=='--check'))throw Error('Only --check or no arguments allowed');
const check=process.argv.includes('--check'),root=new URL('../',import.meta.url);
const destination=new URL('docs/integrations/phone/knowledge/direction-review-v1/',root);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const c=buildCompanyVoiceRouteCandidates();
const artifacts={'inbound-instructions.review.txt':c.inbound.instructions,'outbound-instructions.review.txt':c.outbound.instructions};
const sourceHashes={};
for(const name of ['apps/api/src/knowledge/quantum-weave.v1.ts','apps/api/src/services/phone-company-knowledge.ts',
 'apps/api/src/services/phone-company-routing-review.ts'])sourceHashes[name]=hash(await readFile(new URL(name,root)));
const manifest={reviewOnly:true,uploadAuthorized:false,dispatchAllowed:false,liveIntegration:false,
 knowledgeVersion:c.knowledgeVersion,knowledgeSha256:c.knowledgeSha256,policyVersion:c.policyVersion,commonPolicySha256:c.commonPolicySha256,
 providerApp:'same-existing-agent',workspaceId:null,ownerUserId:null,appId:null,
 inbound:{direction:'inbound',routeType:'inbound_deployment',appVersion:null,deploymentId:null,policySha256:c.inbound.policySha256},
 outbound:{direction:'outbound',routeType:'instant_outbound',appVersion:null,policySha256:c.outbound.policySha256},
 maxDurationSeconds:300,dailyCallLimit:5,variableMapping:{call_purpose:'approvedDraft.purpose',user_name:'approvedDraft.recipient.displayName'},
 unresolved:['Actual reviewed committed versions and inbound deployment binding','Provider conversation/route acceptance',
  'Live runtime KB/policy binding and stale-approval enforcement','Separate publish/deployment/call authorization'],
 sourceHashes,artifacts:Object.fromEntries(Object.entries(artifacts).map(([name,text])=>[name,{sha256:hash(text),utf8Bytes:Buffer.byteLength(text)}]))};
artifacts['routing-manifest.review.json']=JSON.stringify(manifest,null,2)+'\n';
if(!check)await mkdir(destination,{recursive:true});
for(const [name,text]of Object.entries(artifacts)){
 const file=new URL(name,destination);
 if(check){if(await readFile(file,'utf8')!==text)throw Error('Review artifact stale: '+name);}
 else await writeFile(file,text,'utf8');
}
console.log(JSON.stringify({status:check?'verified':'exported',reviewOnly:true,providerCalls:0,liveIntegration:false,
 outputDirectory:fileURLToPath(destination),files:Object.keys(artifacts)}));
