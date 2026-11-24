import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {verifyOwnedRelayManifest,ownedRelayCommand} from './phone-inbound-hosted-gates.review.mjs';
import {INBOUND_HOSTED_GATE_FIXTURE as INBOUND_RUNTIME} from './phone-inbound-runtime-config.mjs';
const files=['synthetic'],read=(p:string)=>Buffer.from(p),pin='a'.repeat(64);
const manifest=()=>({reviewOnly:true,purpose:'hosted-install-gate-validation',transport:'owned-exec-loopback',dockerPublication:'none',validationPlan:'hosted-gates',fixture:INBOUND_RUNTIME,expectedTests:9,files:{synthetic:createHash('sha256').update(read('synthetic')).digest('hex')}});
it('pins a distinct explicit transport/scope and rejects direct fallback or permissive targets',()=>{
 expect(()=>verifyOwnedRelayManifest(manifest(),files,read)).not.toThrow();
 for(const change of [{transport:'direct'},{dockerPublication:'optional'},{expectedTests:8},{fixture:{...INBOUND_RUNTIME,port:5432}},{files:{}},{extra:true}])expect(()=>verifyOwnedRelayManifest({...manifest(),...change},files,read)).toThrow();
 expect(()=>verifyOwnedRelayManifest(manifest(),files,()=>Buffer.from('changed'))).toThrow();
});
it('requires exact modes and hash arguments; preparation and preflight never authorize a run',()=>{
 expect(ownedRelayCommand(['--prepare-review'])).toEqual({mode:'--prepare-review',pin:null});expect(ownedRelayCommand(['--preflight-only','--manifest-sha256',pin]).mode).toBe('--preflight-only');
 expect(()=>ownedRelayCommand(['--approved-isolated-inbound113','--manifest-sha256',pin])).toThrow();expect(()=>ownedRelayCommand(['--approved-hosted-gates','--manifest-sha256','bad'])).toThrow();expect(()=>ownedRelayCommand(['--prepare-review','extra'])).toThrow();
});
