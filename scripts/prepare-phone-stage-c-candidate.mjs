// Local, non-secret review artifacts only. No network, secret reader, admission switch or installation.
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const rel='docs/integrations/phone/';
const read=path=>readFileSync(resolve(root,path));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sha=path=>hash(read(path));
const json=path=>JSON.parse(read(path).toString('utf8'));
const encode=value=>JSON.stringify(value,null,2)+'\n';
const need=ok=>{if(!ok)throw Error('STAGE_C_REVIEW_INPUT_REJECTED');};
const args=process.argv.slice(2);
need(args.length===1&&['--write','--check'].includes(args[0]));
const activePath=rel+'sarvam-runtime-profile.pilot.json';
const active=json(activePath);
const preservedFiles={
 [activePath]:'7a41b4f34482ccf833fcdab6b7bb0c8a5c198f52a994ec4d8c0ca11a19596447',
 'apps/web/vite.config.ts':'a9417a262d8290a66002c09aafee6705268285dc04a7095e3b475f68a792b706',
 [rel+'INBOUND_V5_ROLLOUT_APPROVAL_2026-11-03.md']:'aa6ad1a19ea12caacd862902566d9dc4b249f470f50a9a739372af546efd6f76',
};
for(const [path,digest] of Object.entries(preservedFiles))need(sha(path)===digest);
need(active.appVersion===2&&active.reviewOnly===false&&active.runtimeProfile===true);
const pinned={
 [rel+'knowledge/review-v1/quantum-weave-public.md']:'7305b37a82c67fede9951b7e77acb41b5ae4d8f782c7b7a9fadc3de1f93a2e25',
 [rel+'knowledge/language-fix-v2/inbound-instructions.proposed.txt']:'073a8337945dc1df71fd9750e63249c0ab96022952938a1c933840cae360352a',
 [rel+'knowledge/language-fix-v2/outbound-instructions.proposed.txt']:'33b999ea92a185f9fd7c71f9f42951e67c96635a02a55c83a503c174a5d3ac56',
};
for(const [path,digest] of Object.entries(pinned))need(sha(path)===digest);
const common=direction=>{const text=read(rel+`knowledge/language-fix-v2/${direction}-instructions.proposed.txt`).toString('utf8');
 const at=text.indexOf('You are Thaara, an AI assistant representing Quantum Weave.');need(at>0);return text.slice(at);};
need(common('inbound')===common('outbound'));
const receiptPath='node_modules/.cache/sarvam-eval-paced-20261103-execution-v4.json';
const r=json(receiptPath);
const required=['Identity and recipient','Knowledge-grounded business answer','Return to approved objective','Truthful result','Scope and ending'];
need(r.status==='completed_requires_manual_review'&&r.appVersion===6&&r.providerJudgePassed===true&&r.passedChecks===5&&r.totalChecks===5
 &&r.providerAcceptanceVerified===false&&r.telephoneCalls===0&&r.cleanupVerified===true&&r.gateResetVerified===true);
need(Array.isArray(r.evaluationChecks)&&r.evaluationChecks.length===5&&required.every(name=>r.evaluationChecks.filter(x=>x.name===name&&x.verdict==='Pass').length===1));
// The recorded transcript digest covers the ORIGINAL provider object; sanitized speech has different bytes.
need(Array.isArray(r.transcriptTurns)&&r.transcriptTurns.length>0&&r.transcriptTurns.every(x=>['assistant','user'].includes(x.role)&&typeof x.text==='string')
 &&typeof r.transcriptSha256==='string'&&/^[a-f0-9]{64}$/.test(r.transcriptSha256));
const gates=readdirSync(resolve(root,rel)).filter(name=>/^PHONE_SARVAM_.*\.review\.json$/.test(name)).sort().map(name=>rel+name);
need(gates.length===10&&gates.every(path=>json(path).remoteExecutionAllowed===false));
const evidence={reviewOnly:true,installationAuthorized:false,providerAcceptanceVerified:false,
 status:'synthetic_pass_manual_admission_pending',
 sourceReceipt:{path:receiptPath,sha256:sha(receiptPath)},
 providerSynthetic:{appVersion:6,status:r.status,passedChecks:5,totalChecks:5,providerJudgePassed:true,telephoneCalls:0,
  existingCasesPreserved:r.existingCasesPreserved,transcriptSha256:r.transcriptSha256,rawTranscriptDigestIndependentlyRecomputed:false,
  sanitizedSpeechSha256:hash(Buffer.from(JSON.stringify(r.transcriptTurns))),sanitizedSpeechTurnCount:r.transcriptTurns.length,
  verdicts:r.evaluationChecks.map(x=>({name:x.name,verdict:x.verdict}))},
 hashes:{knowledgeSha256:pinned[rel+'knowledge/review-v1/quantum-weave-public.md'],
  inboundPromptSha256:pinned[rel+'knowledge/language-fix-v2/inbound-instructions.proposed.txt'],
  outboundPromptSha256:pinned[rel+'knowledge/language-fix-v2/outbound-instructions.proposed.txt'],commonPolicySha256:hash(Buffer.from(common('outbound')))},
 voicePolicyVersion:'qw-voice-policy-v2',routePolicyVersion:'qw-route-policy-v1',
 pending:{rawToolFramesManuallyVerified:false,inboundV5RolloutVerified:false,v6DurationAdmissionAttested:false,liveChatCallReportVerified:false,ownerAdmissionApproved:false},
 limitations:['Saved result contains sanitized speech and judge grades; raw tool frames are not in this receipt.',
  'Five-minute configuration evidence is historical; no live hang-up verification is inferred.',
  'Inbound v5 route switch and outbound installation remain separately approved actions.'],
};
const evidencePath=rel+'knowledge/stage-c-v6-review/admission-evidence.review.json';
const candidatePath=rel+'sarvam-runtime-profile.stage-c-v6.review.json';
const candidate={...active,reviewOnly:true,runtimeProfile:false,appVersion:6,verifiedMaxCallLengthMinutes:null,
 verificationBasis:'LOCAL REVIEW CANDIDATE ONLY. v6 configured five-minute limit was recorded historically; duration admission, raw tool-frame review, inbound v5 rollout and owner approval remain pending. Active v2 is untouched.',
 companyKnowledge:{reviewOnly:true,providerAcceptanceVerified:false,direction:'outbound',appVersion:6,inboundAppVersion:5,maxDurationSeconds:300,
  knowledgeBaseId:'01a19bee-d7ed-778c-b0db-e320e8209de9',knowledgeVersion:'qw-company-kb-v1',knowledgeSha256:evidence.hashes.knowledgeSha256,
  policyVersion:'qw-route-policy-v1',policySha256:evidence.hashes.outboundPromptSha256,commonPolicySha256:evidence.hashes.commonPolicySha256,
  acceptanceEvidenceSha256:hash(Buffer.from(encode(evidence)))}};
const outputs={[candidatePath]:encode(candidate),[evidencePath]:encode(evidence)};
const manifest={reviewOnly:true,installationAuthorized:false,liveIntegration:false,outboundAppVersion:6,inboundAppVersion:5,
 preservedFiles,gates,inputs:{...pinned,[receiptPath]:sha(receiptPath),'scripts/prepare-phone-stage-c-candidate.mjs':sha('scripts/prepare-phone-stage-c-candidate.mjs')},
 artifacts:Object.fromEntries(Object.entries(outputs).map(([path,text])=>[path,{sha256:hash(Buffer.from(text)),utf8Bytes:Buffer.byteLength(text)}])),
 policyHashBasis:{policySha256:'Exact full committed outbound v6 instruction artifact; route v1 and voice v2.',commonPolicySha256:'Exact shared instruction suffix beginning You are Thaara, identical in v5/v6 artifacts.'}};
outputs[rel+'knowledge/stage-c-v6-review/admission-manifest.review.json']=encode(manifest);
for(const [path,text] of Object.entries(outputs)){
 if(args[0]==='--check')need(read(path).toString('utf8')===text);
 else{mkdirSync(dirname(resolve(root,path)),{recursive:true});writeFileSync(resolve(root,path),text);}
}
for(const [path,digest] of Object.entries(preservedFiles))need(sha(path)===digest);
process.stdout.write(JSON.stringify({status:args[0]==='--check'?'verified':'prepared_review_only',outboundAppVersion:6,inboundAppVersion:5,
 artifacts:Object.keys(outputs),installationAuthorized:false,providerAcceptanceVerified:false,providerRequests:0})+'\n');
