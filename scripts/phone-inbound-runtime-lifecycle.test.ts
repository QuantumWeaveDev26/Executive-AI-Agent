import {it,expect,vi} from 'vitest';
import {runInboundRuntimeLifecycle,INBOUND_RUNTIME_MIGRATIONS} from './phone-inbound-runtime-lifecycle.mjs';
import {INBOUND_RUNTIME} from './phone-inbound-runtime-guard.mjs';
const ids={containerId:'a'.repeat(64),networkId:'b'.repeat(64),imageId:'sha256:'+'c'.repeat(64),runId:'d'.repeat(32)};
const labels={'thaara.step':'113-inbound','thaara.run':ids.runId};
it('runs four permission-correction cases without journal SQL and preserves owned cleanup',async()=>{
 const f=fixture();f.ports.applySchemas.mockResolvedValue(INBOUND_RUNTIME_MIGRATIONS.slice(0,12));f.ports.runAcceptance.mockResolvedValue({success:true,passed:4,failed:0,skipped:0});
 const result=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId,validationPlan:'ledger-write-fence'});
 expect(result.status).toBe('passed');expect(result.schemaResults).toHaveLength(12);expect(result.cleanup.verified).toBe(true);
});
it('runs only three reference-capture checks and still verifies owned cleanup',async()=>{
 const f=fixture();f.ports.applySchemas.mockResolvedValue(INBOUND_RUNTIME_MIGRATIONS.slice(0,12));f.ports.runAcceptance.mockResolvedValue({success:true,passed:3,failed:0,skipped:0});
 const result=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId,validationPlan:'f03-reference-capture'});
 expect(result.status).toBe('passed');expect(result.cleanup.verified).toBe(true);expect(f.ports.runAcceptance).toHaveBeenCalledOnce();
});
function fixture(failure?:string){
 const calls:string[]=[];const owned={Id:ids.containerId,Image:ids.imageId,Name:'/'+INBOUND_RUNTIME.container,Labels:labels};
 const network=(empty=false)=>({Id:ids.networkId,Name:INBOUND_RUNTIME.network,Internal:true,Labels:labels,Containers:empty?{}:{[ids.containerId]:{}}});
 const port=(name:string,result:any)=>vi.fn(async()=>{calls.push(name);if(name===failure)throw Object.assign(Error('PRIVATE SYNTHETIC CONTENT'),{code:'42501'});return typeof result==='function'?result():result;});
 // Inspector is exercised separately with real-shaped synthetic Docker facts; this fixture uses a trusted verifier port.
 const ports={preflight:port('preflight',{reviewIntegrity:true,existingResources:false,portAvailable:true,localEngine:true,imageId:ids.imageId}),
  createNetwork:port('create_network',ids.networkId),createContainer:port('create_container',ids.containerId),waitReady:port('ready',undefined),
  verifyIsolation:port('verify_isolation',true),applySchemas:port('schemas',INBOUND_RUNTIME_MIGRATIONS),runAcceptance:port('tests',{success:true,passed:9,failed:0,skipped:0}),closeConnections:port('close',undefined),
  inspectOwnedContainer:port('inspect_container',owned),removeContainer:port('remove_container',undefined),inspectOwnedNetwork:port('inspect_network',()=>network(true)),removeNetwork:port('remove_network',undefined),
  verifyRemoval:port('verify_removal',{containerAbsent:true,networkAbsent:true,destroyEventVerified:true,portFree:true})};
 return {ports,calls};
}
it('orders integrity and isolation before SQL, validates tests, then verifies owned cleanup',async()=>{
 const f=fixture(),r=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId});expect(r.status).toBe('passed');expect(r.cleanup.verified).toBe(true);
 expect(f.calls).toEqual(['preflight','create_network','create_container','ready','verify_isolation','schemas','verify_isolation','tests','close','inspect_container','remove_container','inspect_network','remove_network','verify_removal']);
});
it('accepts V2 only with five fresh cases and four historical skips, with owned cleanup',async()=>{
 const f=fixture();f.ports.applySchemas.mockResolvedValueOnce(INBOUND_RUNTIME_MIGRATIONS.slice(0,12));
 f.ports.runAcceptance.mockResolvedValueOnce({success:true,passed:5,failed:0,skipped:4});
 const r=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId,validationPlan:'appointment-storage-v2'});
 expect(r.status).toBe('passed');expect(r.cleanup.verified).toBe(true);
 expect(r.tests?.freshCaseNumbers).toEqual([5,6,7,8,9]);expect(r.tests?.plannedSkippedCaseNumbers).toEqual([1,2,3,4]);
});
it('refuses old nine-case totals for V2 and still cleans up',async()=>{
 const f=fixture();f.ports.applySchemas.mockResolvedValueOnce(INBOUND_RUNTIME_MIGRATIONS.slice(0,12));
 const r=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId,validationPlan:'appointment-storage-v2'});
 expect(r.status).toBe('stopped');expect(r.cleanup.verified).toBe(true);
});
it('retains only sanitized appointment assertion diagnostics and unexecuted cases after cleanup',async()=>{
 const f=fixture();f.ports.applySchemas.mockResolvedValueOnce(INBOUND_RUNTIME_MIGRATIONS.slice(0,12));
 f.ports.runAcceptance.mockResolvedValueOnce({success:false,passed:4,failed:1,skipped:0,failedCaseNumbers:[5],notExecutedCaseNumbers:[6,7,8,9,'PRIVATE'],failedAssertions:[{caseNumber:5,assertion:'call_binding',field:'http_status',expected:403,actual:503,secret:'PRIVATE'}]});
 const r=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId,validationPlan:'appointment-storage'});
 expect(r.status).toBe('stopped');expect(r.cleanup.verified).toBe(true);
 expect(r.tests?.failedAssertions).toEqual([{caseNumber:5,assertion:'call_binding',field:'http_status',expected:403,actual:503}]);expect(r.tests?.notExecutedCaseNumbers).toEqual([6,7,8,9]);expect(JSON.stringify(r)).not.toContain('PRIVATE');
});
it('accepts only the base-only schema plan for hosted-gate tests without mislabelling them as112r/113r',async()=>{
 const f=fixture();f.ports.applySchemas.mockResolvedValueOnce(INBOUND_RUNTIME_MIGRATIONS.slice(0,12));
 const r=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId,validationPlan:'hosted-gates'});expect(r.status).toBe('passed');expect(r.validationPlan).toBe('hosted-gates');expect(r.schemaResults).toHaveLength(12);
 const g=fixture();const rejected=await runInboundRuntimeLifecycle(g.ports,{runId:ids.runId,validationPlan:'hosted-gates'});expect(rejected.status).toBe('stopped');expect(g.ports.runAcceptance).not.toHaveBeenCalled();
});
for(const phase of ['preflight','create_network','create_container','ready','verify_isolation','schemas','tests'])it('stops without repair or retry at '+phase,async()=>{
 const f=fixture(phase),r=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId});expect(r.status).toBe('stopped');expect(r.failure.phase).toBe(phase);expect(JSON.stringify(r)).not.toContain('PRIVATE');
 expect(f.calls.filter(x=>x===phase)).toHaveLength(1);if(['preflight','create_network','create_container','ready','verify_isolation'].includes(phase))expect(f.ports.applySchemas).not.toHaveBeenCalled();
});
it('refuses a failed integrity result and a false isolation verification',async()=>{
 const f=fixture();f.ports.preflight.mockResolvedValueOnce({reviewIntegrity:false});expect((await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId})).status).toBe('stopped');expect(f.ports.createNetwork).not.toHaveBeenCalled();
 const g=fixture();g.ports.verifyIsolation.mockResolvedValueOnce(false);await runInboundRuntimeLifecycle(g.ports,{runId:ids.runId});expect(g.ports.applySchemas).not.toHaveBeenCalled();
});
it('never deletes a container with mismatched ownership or claims cleanup after an ambiguous removal',async()=>{
 const f=fixture();f.ports.inspectOwnedContainer.mockResolvedValueOnce({Id:ids.containerId,Labels:{}});const r=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId});expect(r.cleanup.verified).toBe(false);expect(f.ports.removeContainer).not.toHaveBeenCalled();
 const g=fixture();g.ports.verifyRemoval.mockResolvedValueOnce({containerAbsent:true,networkAbsent:true,destroyEventVerified:false,portFree:true});expect((await runInboundRuntimeLifecycle(g.ports,{runId:ids.runId})).status).toBe('stopped');
});
it('refuses partial test results and invalid resource IDs before SQL',async()=>{
 const f=fixture();f.ports.runAcceptance.mockResolvedValueOnce({success:true,passed:8,failed:0,skipped:1});expect((await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId})).status).toBe('stopped');
 const g=fixture();g.ports.createContainer.mockResolvedValueOnce('unexpected');await runInboundRuntimeLifecycle(g.ports,{runId:ids.runId});expect(g.ports.applySchemas).not.toHaveBeenCalled();expect(g.ports.removeContainer).not.toHaveBeenCalled();
});
it('retains only allowlisted isolation diagnostics and still verifies cleanup',async()=>{
 const f=fixture();f.ports.verifyIsolation.mockRejectedValueOnce(Object.assign(Error('PRIVATE RAW DOCKER DATA'),{isolationCheck:'actual_ports',isolationKind:'validation_failed'}));
 const result=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId});
 expect(result.failure?.isolation).toEqual({check:'actual_ports',kind:'validation_failed'});expect(result.cleanup.verified).toBe(true);expect(JSON.stringify(result)).not.toContain('PRIVATE');expect(f.ports.applySchemas).not.toHaveBeenCalled();
});
it('sanitizes throwing diagnostic getters without skipping owned cleanup',async()=>{
 const f=fixture();f.ports.verifyIsolation.mockRejectedValueOnce(Object.defineProperty({},'code',{get(){throw Error('PRIVATE');}}));
 const result=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId});expect(result.status).toBe('stopped');expect(result.cleanup.verified).toBe(true);expect(result.failure?.sqlState).toBeNull();
});
it('ends isolation-only diagnostics before all schema and acceptance operations',async()=>{
 const f=fixture(),r=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId,isolationOnly:true});
 expect(r.status).toBe('passed');expect(r.scope).toBe('isolation_only');expect(r.schemaResults).toBeNull();expect(r.tests).toBeNull();expect(r.cleanup.verified).toBe(true);
 expect(f.ports.applySchemas).not.toHaveBeenCalled();expect(f.ports.runAcceptance).not.toHaveBeenCalled();
});
it('retains sanitized transport failure and refuses removal until relay shutdown is proven',async()=>{
 const f=fixture();f.ports.verifyIsolation.mockRejectedValueOnce(Object.assign(Error('PRIVATE'),{fixtureTransportReason:'relay_idle_timeout'}));
 f.ports.closeConnections.mockRejectedValueOnce(Object.assign(Error('PRIVATE'),{fixtureTransportReason:'relay_shutdown_unverified'}));
 const r=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId});
 expect(r.failure?.fixtureTransportReason).toBe('relay_idle_timeout');expect(r.cleanup.fixtureTransportReason).toBe('relay_shutdown_unverified');
 expect(r.cleanup.verified).toBe(false);expect(f.ports.removeContainer).not.toHaveBeenCalled();expect(JSON.stringify(r)).not.toContain('PRIVATE');
});
it('retains a finite preflight category and never creates resources after preflight fails',async()=>{
 const f=fixture();f.ports.preflight.mockRejectedValueOnce(Object.assign(Error('PRIVATE'),{preflightCheck:'context_metadata',preflightKind:'command_unavailable'}));
 const r=await runInboundRuntimeLifecycle(f.ports,{runId:ids.runId});
 expect(r.failure?.preflight).toEqual({check:'context_metadata',kind:'command_unavailable'});expect(f.ports.createNetwork).not.toHaveBeenCalled();expect(f.ports.applySchemas).not.toHaveBeenCalled();expect(JSON.stringify(r)).not.toContain('PRIVATE');
});
