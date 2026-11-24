import {createHash} from 'node:crypto';
import {INBOUND_RUNTIME} from './phone-inbound-runtime-guard.mjs';
const deny=()=>{throw Error('INBOUND_RUNTIME_CONFIG_DENIED');};
// Fresh one-use scope; v1 evidence remains retained and its pinned launcher stays invalidated.
export const INBOUND_RELAY_CACHE_PATH='node_modules/.cache/phone113-owned-relay-v2';
export const INBOUND_HOSTED_GATE_CACHE_PATH='node_modules/.cache/phone113-hosted-gates-v1';
export const INBOUND_APPOINTMENT_CACHE_PATH='node_modules/.cache/phone-appointment-storage-v1';
export const INBOUND_APPOINTMENT_V2_CACHE_PATH='node_modules/.cache/phone-appointment-storage-v2';
export const INBOUND_F03_REFERENCE_CACHE_PATH='node_modules/.cache/phone-f03-reference-v3';
export const INBOUND_LEDGER_WRITE_FENCE_CACHE_PATH='node_modules/.cache/phone-ledger-write-fence-v1';
export const INBOUND_LEDGER_WRITE_FENCE_MANIFEST_PATH='docs/integrations/phone/PHONE_LEDGER_WRITE_FENCE_V1.review.json';
export const INBOUND_HOSTED_GATE_FIXTURE=Object.freeze({...INBOUND_RUNTIME,database:'thaara_vps_pilot'});
export function inboundRuntimeConfig(env,proofBytes,verifyFixture,{validationPlan='journal-acceptance'}={}){
 if(!['journal-acceptance','hosted-gates','appointment-storage','appointment-storage-v2','f03-reference-capture','ledger-write-fence'].includes(validationPlan))deny();
 const hosted=validationPlan!=='journal-acceptance';
 if(hosted?env.THAARA_PHONE113_VALIDATION_PLAN!==validationPlan:env.THAARA_PHONE113_VALIDATION_PLAN!==undefined)deny();
 if(env.THAARA_PHONE113_RUNTIME_APPROVED!=='isolated-runtime-only'||! /^[a-f0-9]{64}$/.test(env.THAARA_PHONE113_PROOF_SHA??''))deny();
 for(const [key,value]of Object.entries(env))if(value&&(/^(PG|SARVAM_|META_|GOOGLE_)/.test(key)||['DATABASE_URL','MIGRATION_DATABASE_URL','BOOTSTRAP_DATABASE_URL','WORKER_DATABASE_URL','REDIS_URL','NODE_OPTIONS','NODE_PATH'].includes(key)))deny();
 if(createHash('sha256').update(proofBytes).digest('hex')!==env.THAARA_PHONE113_PROOF_SHA)deny();
 let proof;try{proof=JSON.parse(proofBytes.toString('utf8'));}catch{deny();}
 const relay=env.THAARA_PHONE113_RUNTIME_TRANSPORT==='owned-exec-loopback';
 if(env.THAARA_PHONE113_RUNTIME_TRANSPORT!==undefined&&!relay)deny();
 if(hosted&&(!relay||proof.validationPlan!==validationPlan))deny();
 const proofKeys=relay?'containerId,dockerEndpoint,imageId,networkId,runId,transport'+(hosted?',validationPlan':''):'containerId,imageId,networkId,runId';
 if(Object.keys(proof??{}).sort().join(',')!==proofKeys||! /^[a-f0-9]{32}$/.test(proof.runId)
  ||! /^[a-f0-9]{64}$/.test(proof.containerId)||! /^[a-f0-9]{64}$/.test(proof.networkId)||! /^sha256:[a-f0-9]{64}$/.test(proof.imageId))deny();
 if(relay&&(proof.transport!=='owned-exec-loopback'||!['npipe:////./pipe/dockerDesktopLinuxEngine','npipe:////./pipe/docker_engine'].includes(proof.dockerEndpoint)))deny();
 const urls={};for(const [name,key,role]of [['admin','THAARA_PHONE113_ADMIN_URL','postgres'],['ingest','THAARA_PHONE113_INGEST_URL','thaara_phone_ingest'],['app','THAARA_PHONE113_APP_URL','thaara_app']]){
  let url;try{url=new URL(env[key]);}catch{deny();}
  if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.port!==String(INBOUND_RUNTIME.port)||url.pathname!=='/'+(hosted?INBOUND_HOSTED_GATE_FIXTURE.database:INBOUND_RUNTIME.database)||url.username!==role
   ||! /^[A-Za-z0-9_-]{43}$/.test(url.password)||url.search||url.hash)deny();urls[name]=url.href;
 }
 if(verifyFixture(Object.freeze({...proof}))!==true)deny();return Object.freeze({...urls,proof:Object.freeze({...proof})});
}
