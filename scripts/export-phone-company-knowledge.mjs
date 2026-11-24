// Local deterministic export only. Build @thaara/api first. No provider, account, credential or database access.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {renderCompanyKnowledge,renderUnifiedVoiceInstructions,QUANTUM_WEAVE_KNOWLEDGE_VERSION} from '../apps/api/dist/services/phone-company-knowledge.js';

const root=new URL('../',import.meta.url);
const destination=new URL('docs/integrations/phone/knowledge/review-v1/',root);
if(process.argv.slice(2).some(a=>a!=='--check'))throw Error('Only --check or no arguments allowed');
const check=process.argv.includes('--check');
const hash=data=>createHash('sha256').update(data).digest('hex');
const exports={
 'quantum-weave-public.md':renderCompanyKnowledge(),
 'unified-voice-instructions.txt':renderUnifiedVoiceInstructions()+'\n'
};
const sources={};
for(const path of ['apps/api/src/knowledge/quantum-weave.v1.ts','apps/api/src/services/phone-company-knowledge.ts'])sources[path]=hash(await readFile(new URL(path,root)));
const manifest={reviewOnly:true,uploadAuthorized:false,liveIntegration:false,knowledgeVersion:QUANTUM_WEAVE_KNOWLEDGE_VERSION,policyVersion:'qw-voice-policy-v1',
 sourceHashes:sources,artifacts:Object.fromEntries(Object.entries(exports).map(([name,text])=>[name,{sha256:hash(text),utf8Bytes:Buffer.byteLength(text)}]))};
exports['review-manifest.json']=JSON.stringify(manifest,null,2)+'\n';
if(!check)await mkdir(destination,{recursive:true});
for(const [name,text] of Object.entries(exports)){
 const file=new URL(name,destination);
 if(check){if(await readFile(file,'utf8')!==text)throw Error('Review artifact stale: '+name);}
 else await writeFile(file,text,{encoding:'utf8'});
}
console.log(JSON.stringify({status:check?'verified':'exported',knowledgeVersion:QUANTUM_WEAVE_KNOWLEDGE_VERSION,reviewOnly:true,
 outputDirectory:fileURLToPath(destination),files:Object.keys(exports),providerCalls:0}));
