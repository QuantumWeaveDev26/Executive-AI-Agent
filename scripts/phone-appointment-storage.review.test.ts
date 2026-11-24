import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {appointmentStorageCommand,verifyAppointmentStorageManifest} from './phone-appointment-storage.review.mjs';
import {INBOUND_HOSTED_GATE_FIXTURE,INBOUND_APPOINTMENT_CACHE_PATH} from './phone-inbound-runtime-config.mjs';
const read=(p:string)=>Buffer.from(p),files=['synthetic'];
const manifest=()=>({reviewOnly:true,purpose:'appointment-journal-postgres-acceptance',validationPlan:'appointment-storage',transport:'owned-exec-loopback',dockerPublication:'none',expectedTests:9,fixture:INBOUND_HOSTED_GATE_FIXTURE,files:{synthetic:createHash('sha256').update(read('synthetic')).digest('hex')}});
it('pins the exact appointment scope and rejects missing/tampered/extra source provenance',()=>{
 expect(()=>verifyAppointmentStorageManifest(manifest(),files,read)).not.toThrow();
 for(const change of [{files:{}},{validationPlan:'hosted-gates'},{transport:'direct'},{reviewOnly:false},{expectedTests:8},{fixture:{...INBOUND_HOSTED_GATE_FIXTURE,port:5432}},{extra:true}])expect(()=>verifyAppointmentStorageManifest({...manifest(),...change},files,read)).toThrow();
 expect(()=>verifyAppointmentStorageManifest(manifest(),files,()=>Buffer.from('tampered'))).toThrow();
});
it('requires a distinct execution flag and SHA; rejects previous consumed approval command modes',()=>{
 const pin='a'.repeat(64);expect(appointmentStorageCommand(['--approved-appointment-storage','--manifest-sha256',pin]).pin).toBe(pin);
 expect(appointmentStorageCommand(['--preflight-only','--manifest-sha256',pin]).mode).toBe('--preflight-only');
 for(const args of [['--approved-hosted-gates','--manifest-sha256',pin],['--approved-appointment-storage'],['--preflight-only','--manifest-sha256','bad'],['--prepare-review','extra']])expect(()=>appointmentStorageCommand(args)).toThrow();
 expect(INBOUND_APPOINTMENT_CACHE_PATH).toBe('node_modules/.cache/phone-appointment-storage-v1');
});
