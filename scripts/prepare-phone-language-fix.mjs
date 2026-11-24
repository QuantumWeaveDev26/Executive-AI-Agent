// LOCAL proposal only. No network, credentials, provider edit, commit, deployment or test execution.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),destination=new URL('docs/integrations/phone/knowledge/language-fix-v2/',root);
if(process.argv.slice(2).some(a=>a!=='--check'))throw Error('Only --check or no arguments allowed');
const check=process.argv.includes('--check'),sha=t=>createHash('sha256').update(t).digest('hex');
const sourceHashes={inbound:'e74cd1559cae67a8e2e4068aa3b643852b21c897387bda53bb553d7059e10c33',
 outbound:'50715d830475a1f8ea12f3c339ef1e0e8e55360faa4d5e9549a2a0c54b1bce8b'};
const oldLanguage='Speak concise, natural English, Kannada or Hindi as enabled; use natural Kannada-English where supported. Ask a language preference if uncertain.';
const newLanguage=oldLanguage+'\n'+
 "Match a caller's clear language preference from the first substantive answer. When the caller clearly speaks or requests English, Hindi or Kannada and it differs from the selected output language, use the existing Change Output Language tool with the formal language name English, Hindi or Kannada before the next substantive spoken answer. This includes switching back to English after Hindi or Kannada. Do not keep answering in English after a clear Hindi or Kannada preference. If the desired language is already selected, do not repeat the tool call or greeting. Ask a short language-preference question only when the preference is genuinely unclear. For Kannada-English mixed speech, keep natural mixed speech with the supported Kannada language selection. Keep later answers and the closing end_message in the chosen language. Changing language never changes call direction, the approved purpose or recipient, consent, approval or action permissions.";
const files={},artifacts={};
for(const direction of ['inbound','outbound']){
 const old=await readFile(new URL(`docs/integrations/phone/knowledge/deployment-v1/${direction}-instructions.txt`,root),'utf8');
 if(sha(old)!==sourceHashes[direction]||old.split(oldLanguage).length!==2||old.split('Voice policy: qw-voice-policy-v1.').length!==2)throw Error('Approved baseline changed');
 const text=old.replace('Voice policy: qw-voice-policy-v1.','Voice policy: qw-voice-policy-v2.').replace(oldLanguage,newLanguage);
 // Exact round-trip proves there is no unrelated prompt rewrite.
 if(text.replace('Voice policy: qw-voice-policy-v2.','Voice policy: qw-voice-policy-v1.').replace(newLanguage,oldLanguage)!==old)throw Error('Unexpected policy change');
 for(const token of ['{{user_name}}','{{call_purpose}}'])if(text.split(token).length!==old.split(token).length)throw Error('Variable mapping changed');
 const name=`${direction}-instructions.proposed.txt`;files[name]=text;artifacts[name]={sha256:sha(text),utf8Bytes:Buffer.byteLength(text)};
}
files['proposal-manifest.json']=JSON.stringify({reviewOnly:true,uploadAuthorized:false,liveIntegration:false,providerAcceptanceVerified:false,
 voicePolicyVersion:'qw-voice-policy-v2',routePolicyVersion:'qw-route-policy-v1',sourceProviderVersions:{inbound:3,outbound:4},
 proposedProviderVersions:{inbound:null,outbound:null},knowledgeVersion:'qw-company-kb-v1',
 knowledgeSha256:'7305b37a82c67fede9951b7e77acb41b5ae4d8f782c7b7a9fadc3de1f93a2e25',sourcePromptHashes:sourceHashes,artifacts,
 changes:['Voice policy version1→2; route policy unchanged.','Retain original language rule, add explicit existing language-tool use before first substantive response; no redundant switches/greetings.','Preserve all other approved text and native variables exactly, verified by round-trip.'],
 evidence:{failedCase:'IN03',visibleRunId:'01M6E8FW',confirmed:'Hindi question received an English reply/closing; pricing guards passed.',
  suspected:'Language selection/tool was not invoked despite enabled Hindi. Stronger prompt instruction requires provider retesting.'}},null,2)+'\n';
if(!check)await mkdir(destination,{recursive:true});
for(const [name,text]of Object.entries(files)){
 const path=new URL(name,destination);if(check){if(await readFile(path,'utf8')!==text)throw Error('Proposal stale: '+name);}
 else await writeFile(path,text,'utf8');
}
console.log(JSON.stringify({status:check?'verified':'prepared',providerChanges:0,uploadAuthorized:false,artifacts}));
