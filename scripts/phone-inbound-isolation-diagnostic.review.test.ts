import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {verifyIsolationDiagnosticManifest,runInboundIsolationOnly} from './phone-inbound-isolation-diagnostic.review.mjs';
import {INBOUND_RUNTIME} from './phone-inbound-runtime-guard.mjs';
const read=(p:string)=>Buffer.from(p),files=['synthetic'];
const manifest=()=>({reviewOnly:true,purpose:'isolation-diagnostic-only',schemaExecution:false,acceptanceTests:false,fixture:INBOUND_RUNTIME,files:{synthetic:createHash('sha256').update(read('synthetic')).digest('hex')}});
it('checks a new diagnostic-only snapshot and refuses widened scope, targets or changed pins',()=>{
 expect(()=>verifyIsolationDiagnosticManifest(manifest(),files,read)).not.toThrow();
 for(const change of [{schemaExecution:true},{acceptanceTests:true},{purpose:'acceptance'},{fixture:{...INBOUND_RUNTIME,port:5432}},{extra:'value'},{files:{}}])expect(()=>verifyIsolationDiagnosticManifest({...manifest(),...change},files,read)).toThrow();
 expect(()=>verifyIsolationDiagnosticManifest(manifest(),files,()=>Buffer.from('changed'))).toThrow();
});
it('never reads or calls SQL/acceptance capabilities even when isolation passes',async()=>{
 const e={runId:'d'.repeat(32),containerId:'a'.repeat(64),networkId:'b'.repeat(64),imageId:'sha256:'+'c'.repeat(64)},labels={'thaara.step':'113-inbound','thaara.run':e.runId};
 const ports={preflight:async()=>({reviewIntegrity:true,existingResources:false,portAvailable:true,localEngine:true,imageId:e.imageId}),createNetwork:async()=>e.networkId,createContainer:async()=>e.containerId,waitReady:async()=>{},verifyIsolation:async()=>true,closeConnections:async()=>{},inspectOwnedContainer:async()=>({Id:e.containerId,Image:e.imageId,Name:'/'+INBOUND_RUNTIME.container,Labels:labels}),removeContainer:async()=>{},inspectOwnedNetwork:async()=>({Id:e.networkId,Name:INBOUND_RUNTIME.network,Internal:true,Labels:labels,Containers:{}}),removeNetwork:async()=>{},verifyRemoval:async()=>({containerAbsent:true,networkAbsent:true,destroyEventVerified:true,portFree:true}),
  get applySchemas(){throw Error('SQL CAPABILITY MUST NOT BE READ');},get runAcceptance(){throw Error('TEST CAPABILITY MUST NOT BE READ');}};
 const r=await runInboundIsolationOnly(ports,{runId:e.runId});expect(r.scope).toBe('isolation_only');expect(r.status).toBe('passed');expect(r.schemaResults).toBeNull();expect(r.tests).toBeNull();
});
