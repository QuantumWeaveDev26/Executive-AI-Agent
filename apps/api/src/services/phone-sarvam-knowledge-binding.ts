/** Server-owned reviewed profile data, never caller/model variables. Attestations require separate real provider evidence before installation. */
export interface SarvamKnowledgeBinding {
 readonly reviewOnly:false;readonly providerAcceptanceVerified:true;readonly direction:'outbound';
 readonly appVersion:number;readonly inboundAppVersion:number;readonly maxDurationSeconds:300;
 readonly knowledgeBaseId:string;readonly knowledgeVersion:'qw-company-kb-v1'|'qw-company-kb-v3-linktree';readonly knowledgeSha256:string;
 readonly policyVersion:'qw-route-policy-v1';readonly policySha256:string;readonly commonPolicySha256:string;
 readonly acceptanceEvidenceSha256:string;
}
const KEYS=['reviewOnly','providerAcceptanceVerified','direction','appVersion','inboundAppVersion','maxDurationSeconds','knowledgeBaseId',
 'knowledgeVersion','knowledgeSha256','policyVersion','policySha256','commonPolicySha256','acceptanceEvidenceSha256'].sort().join();

/** Validates/copies an operator attestation. Does NOT fetch or authenticate provider state, content, routing or test results. */
export function parseSarvamKnowledgeBinding(raw:unknown,appVersion:number,maxDurationSeconds:number):SarvamKnowledgeBinding {
 const denied=()=>new Error('PHONE_KNOWLEDGE_BINDING_INVALID');
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw denied();
 const p=raw as Record<string,unknown>;
 if(Object.keys(p).sort().join()!==KEYS||p.reviewOnly!==false||p.providerAcceptanceVerified!==true||p.direction!=='outbound'||
  !Number.isSafeInteger(appVersion)||appVersion<1||p.appVersion!==appVersion||!Number.isSafeInteger(p.inboundAppVersion)||
  (p.inboundAppVersion as number)<1||p.inboundAppVersion===appVersion||p.maxDurationSeconds!==300||maxDurationSeconds!==300||
  typeof p.knowledgeBaseId!=='string'||!/^[-A-Za-z0-9_.:]{1,128}$/.test(p.knowledgeBaseId)||
  (p.knowledgeVersion!=='qw-company-kb-v1'&&p.knowledgeVersion!=='qw-company-kb-v3-linktree')||
  p.policyVersion!=='qw-route-policy-v1'||![p.knowledgeSha256,p.policySha256,p.commonPolicySha256,p.acceptanceEvidenceSha256]
   .every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))throw denied();
 // Fixed property order and detached primitive values keep fingerprinting independent of JSON insertion order or later caller mutation.
 return Object.freeze({reviewOnly:false,providerAcceptanceVerified:true,direction:'outbound',appVersion,
  inboundAppVersion:p.inboundAppVersion as number,maxDurationSeconds:300,knowledgeBaseId:p.knowledgeBaseId,
  knowledgeVersion:p.knowledgeVersion,knowledgeSha256:p.knowledgeSha256 as string,policyVersion:'qw-route-policy-v1',
  policySha256:p.policySha256 as string,commonPolicySha256:p.commonPolicySha256 as string,acceptanceEvidenceSha256:p.acceptanceEvidenceSha256 as string});
}
