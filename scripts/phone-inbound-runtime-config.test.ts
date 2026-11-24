import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {inboundRuntimeConfig} from './phone-inbound-runtime-config.mjs';
const bytes=Buffer.from(JSON.stringify({containerId:'a'.repeat(64),networkId:'b'.repeat(64),imageId:'sha256:'+'c'.repeat(64),runId:'d'.repeat(32)}));
const env=()=>({THAARA_PHONE113_RUNTIME_APPROVED:'isolated-runtime-only',THAARA_PHONE113_PROOF_SHA:createHash('sha256').update(bytes).digest('hex'),THAARA_PHONE113_ADMIN_URL:'postgresql://postgres:'+'x'.repeat(43)+'@127.0.0.1:15436/thaara_phone113_review',THAARA_PHONE113_INGEST_URL:'postgresql://thaara_phone_ingest:'+'y'.repeat(43)+'@127.0.0.1:15436/thaara_phone113_review',THAARA_PHONE113_APP_URL:'postgresql://thaara_app:'+'z'.repeat(43)+'@127.0.0.1:15436/thaara_phone113_review'});
it.each(['f03-reference-capture','ledger-write-fence'])('requires its own explicit plan and proof: %s',plan=>{
 const proof={...JSON.parse(bytes.toString()),transport:'owned-exec-loopback',dockerEndpoint:'npipe:////./pipe/dockerDesktopLinuxEngine',validationPlan:plan},value=Buffer.from(JSON.stringify(proof));
 const settings={...env(),THAARA_PHONE113_RUNTIME_TRANSPORT:'owned-exec-loopback',THAARA_PHONE113_VALIDATION_PLAN:plan,THAARA_PHONE113_PROOF_SHA:createHash('sha256').update(value).digest('hex')};
 for(const key of ['THAARA_PHONE113_ADMIN_URL','THAARA_PHONE113_APP_URL','THAARA_PHONE113_INGEST_URL'])settings[key as keyof typeof settings]=String(settings[key as keyof typeof settings]).replace('thaara_phone113_review','thaara_vps_pilot');
 expect(inboundRuntimeConfig(settings,value,()=>true,{validationPlan:plan}).proof.validationPlan).toBe(plan);
 expect(()=>inboundRuntimeConfig(settings,value,()=>true,{validationPlan:'hosted-gates'})).toThrow();
 expect(()=>inboundRuntimeConfig({...settings,THAARA_PHONE113_RUNTIME_APPROVED:undefined},value,()=>true,{validationPlan:plan})).toThrow();
});
it('separately binds appointment-storage proof, plan and hosted-gated fixture database',()=>{
 const proof={...JSON.parse(bytes.toString()),transport:'owned-exec-loopback',dockerEndpoint:'npipe:////./pipe/dockerDesktopLinuxEngine',validationPlan:'appointment-storage'},value=Buffer.from(JSON.stringify(proof));
 const settings={...env(),THAARA_PHONE113_RUNTIME_TRANSPORT:'owned-exec-loopback',THAARA_PHONE113_VALIDATION_PLAN:'appointment-storage',THAARA_PHONE113_PROOF_SHA:createHash('sha256').update(value).digest('hex')};
 for(const key of ['THAARA_PHONE113_ADMIN_URL','THAARA_PHONE113_APP_URL','THAARA_PHONE113_INGEST_URL'])settings[key as keyof typeof settings]=String(settings[key as keyof typeof settings]).replace('thaara_phone113_review','thaara_vps_pilot');
 expect(inboundRuntimeConfig(settings,value,()=>true,{validationPlan:'appointment-storage'}).proof.validationPlan).toBe('appointment-storage');
 expect(()=>inboundRuntimeConfig(settings,value,()=>true,{validationPlan:'hosted-gates'})).toThrow();
 expect(()=>inboundRuntimeConfig(settings,value,()=>true)).toThrow();
});
it('does not let V1 proof or approval select the fresh V2 appointment plan',()=>{
 const proof={...JSON.parse(bytes.toString()),transport:'owned-exec-loopback',dockerEndpoint:'npipe:////./pipe/dockerDesktopLinuxEngine',validationPlan:'appointment-storage-v2'},value=Buffer.from(JSON.stringify(proof));
 const settings={...env(),THAARA_PHONE113_RUNTIME_TRANSPORT:'owned-exec-loopback',THAARA_PHONE113_VALIDATION_PLAN:'appointment-storage-v2',THAARA_PHONE113_PROOF_SHA:createHash('sha256').update(value).digest('hex')};
 for(const key of ['THAARA_PHONE113_ADMIN_URL','THAARA_PHONE113_APP_URL','THAARA_PHONE113_INGEST_URL'])settings[key as keyof typeof settings]=String(settings[key as keyof typeof settings]).replace('thaara_phone113_review','thaara_vps_pilot');
 expect(inboundRuntimeConfig(settings,value,()=>true,{validationPlan:'appointment-storage-v2'}).proof.validationPlan).toBe('appointment-storage-v2');
 expect(()=>inboundRuntimeConfig(settings,value,()=>true,{validationPlan:'appointment-storage'})).toThrow();
});
it('binds the hosted-gate database only to its separate explicit proof and validation plan',()=>{
 const proof={...JSON.parse(bytes.toString()),transport:'owned-exec-loopback',dockerEndpoint:'npipe:////./pipe/dockerDesktopLinuxEngine',validationPlan:'hosted-gates'},value=Buffer.from(JSON.stringify(proof));
 const settings={...env(),THAARA_PHONE113_RUNTIME_TRANSPORT:'owned-exec-loopback',THAARA_PHONE113_VALIDATION_PLAN:'hosted-gates',THAARA_PHONE113_PROOF_SHA:createHash('sha256').update(value).digest('hex')};
 for(const key of ['THAARA_PHONE113_ADMIN_URL','THAARA_PHONE113_APP_URL','THAARA_PHONE113_INGEST_URL'])settings[key as keyof typeof settings]=String(settings[key as keyof typeof settings]).replace('thaara_phone113_review','thaara_vps_pilot');
 expect(inboundRuntimeConfig(settings,value,()=>true,{validationPlan:'hosted-gates'}).admin).toContain('/thaara_vps_pilot');
 expect(()=>inboundRuntimeConfig(settings,value,()=>true)).toThrow();expect(()=>inboundRuntimeConfig(env(),bytes,()=>true,{validationPlan:'hosted-gates'})).toThrow();
});
it('requires exact isolated targets, fresh-shaped credentials and verified current Docker proof',()=>{expect(inboundRuntimeConfig(env(),bytes,()=>true).proof.runId).toBe('d'.repeat(32));});
for(const change of [{THAARA_PHONE113_RUNTIME_APPROVED:'yes'},{DATABASE_URL:'forbidden'},{SARVAM_API_KEY:'forbidden'},{THAARA_PHONE113_ADMIN_URL:env().THAARA_PHONE113_ADMIN_URL.replace('127.0.0.1','remote.test')},{THAARA_PHONE113_PROOF_SHA:'0'.repeat(64)}])it('rejects unsafe runtime configuration before inspection',()=>{const verify=vi.fn(()=>true);expect(()=>inboundRuntimeConfig({...env(),...change},bytes,verify)).toThrow();expect(verify).not.toHaveBeenCalled();});
it('rejects unavailable or mismatching fixture inspection',()=>{expect(()=>inboundRuntimeConfig(env(),bytes,()=>false)).toThrow();});
it('admits only an explicitly bound private transport proof on a fixed local Docker endpoint',()=>{
 const proof={...JSON.parse(bytes.toString()),transport:'owned-exec-loopback',dockerEndpoint:'npipe:////./pipe/dockerDesktopLinuxEngine'},value=Buffer.from(JSON.stringify(proof)),settings={...env(),THAARA_PHONE113_RUNTIME_TRANSPORT:'owned-exec-loopback',THAARA_PHONE113_PROOF_SHA:createHash('sha256').update(value).digest('hex')};
 expect(inboundRuntimeConfig(settings,value,()=>true).proof.transport).toBe('owned-exec-loopback');
 expect(()=>inboundRuntimeConfig({...settings,THAARA_PHONE113_RUNTIME_TRANSPORT:'direct'},value,()=>true)).toThrow();
 const remote=Buffer.from(JSON.stringify({...proof,dockerEndpoint:'tcp://remote'}));expect(()=>inboundRuntimeConfig({...settings,THAARA_PHONE113_PROOF_SHA:createHash('sha256').update(remote).digest('hex')},remote,()=>true)).toThrow();
});
