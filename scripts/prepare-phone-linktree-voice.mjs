// Offline candidate export. Only the standalone public Markdown is uploaded to Sarvam KB.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const knowledgeRoot=new URL('../docs/integrations/phone/knowledge/',import.meta.url);
const output=new URL('linktree-v3/',knowledgeRoot);
const sha=text=>createHash('sha256').update(text).digest('hex');
const sourcePaths={
 inbound:'listening-fix-20261106/inbound-listening.candidate.txt',
 outbound:'appointment-candidates-20261106/outbound-instructions.candidate.txt',
};
const sourceHashes={
 inbound:'bec521dfbc48e23e8526b33de60e9d726a2563971549dab78bc5f7d5505063ee',
 outbound:'1b2e3003effc3b5e067957baa6bb66609c38a113087c86e5ae405e839b329b00',
};

export const knowledgeVersion='qw-company-kb-v3-linktree';
export const listeningPolicy=[
 'LISTENING AND TURN-TAKING',
 'Speak one or two short sentences per turn. Ask at most one question, then wait. For a broad enquiry, identify the relevant category before describing specific offers.',
 'When the caller interrupts, yield immediately. Wait for the caller to finish. Answer their latest question or correction in their chosen language. Drop the interrupted answer unless they ask you to continue.',
 'Treat a brief thinking pause as part of the caller’s turn. Ask one short clarification for unclear speech. Avoid repeating a greeting, question or answer.',
 'Search only the relevant offer in the attached public knowledge base when you need a company fact. Reuse verified details already discussed. If a detail is missing, offer human confirmation.',
].join('\n');

export function prepareLinktreeVoice(inbound,outbound){
 if(sha(inbound)!==sourceHashes.inbound||sha(outbound)!==sourceHashes.outbound){
  throw Error('PHONE_LINKTREE_BASELINE_MISMATCH');
 }
 const versioned=source=>source.replace('Knowledge: qw-company-kb-v1.',`Knowledge: ${knowledgeVersion}.`);
 const inboundBase=inbound.slice(0,inbound.indexOf('\nLISTENING AND TURN-TAKING')).trimEnd();
 return {
  inbound:`${versioned(inboundBase)}\n\n${listeningPolicy}\n`,
  outbound:`${versioned(outbound.trimEnd())}\n\n${listeningPolicy}\n`,
 };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,...extra]=process.argv.slice(2);
 if(!['--write','--check'].includes(mode)||extra.length)throw Error('Use --write or --check');
 const read=url=>readFileSync(url,'utf8');
 const knowledge=read(new URL('quantum-weave-public.md',output));
 const drafts=prepareLinktreeVoice(...Object.values(sourcePaths).map(path=>read(new URL(path,knowledgeRoot))));
 const outputs=Object.fromEntries(Object.entries(drafts).map(([direction,prompt])=>[`${direction}-instructions.candidate.txt`,prompt]));
 const artifacts={'quantum-weave-public.md':sha(knowledge),...Object.fromEntries(Object.entries(outputs).map(([name,body])=>[name,sha(body)]))};
 outputs['manifest.review.json']=JSON.stringify({
  reviewOnly:true,liveRoutingAuthorized:false,paidTestsAuthorized:false,providerAcceptanceVerified:false,
  knowledgeVersion,sourceHashes,artifacts,targetVersions:null,maxDurationSeconds:300,
  listening:{allowInterruptions:true,responseTiming:'Patient',sensitivity:'preserve initially',background:'No sound'},
 },null,2)+'\n';
 for(const [name,body] of Object.entries(outputs)){
  const target=new URL(name,output);
  if(mode==='--write')writeFileSync(target,body);
  else if(read(target)!==body)throw Error(`PHONE_LINKTREE_EXPORT_MISMATCH: ${name}`);
 }
 console.log(JSON.stringify({status:mode==='--check'?'verified_local':'prepared_local',knowledgeVersion,providerCalls:0}));
}
