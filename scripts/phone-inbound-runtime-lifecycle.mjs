import {assertInboundOwnedContainer,assertInboundOwnedNetwork,readInboundIsolationDiagnostic} from './phone-inbound-runtime-guard.mjs';
import {readOwnedRelayDiagnostic} from './phone-inbound-fixture-relay.mjs';
import {readPreflightDiagnostic} from './phone-inbound-preflight-diagnostics.mjs';
import {sanitizedAppointmentDiagnostics} from './phone-appointment-assertions.mjs';
const validId=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const denied=()=>{throw Error('INBOUND_RUNTIME_PHASE_DENIED');};
export const INBOUND_RUNTIME_MIGRATIONS=Object.freeze([...Array.from({length:12},(_,i)=>'base:'+String(i+1).padStart(4,'0')),'112r','113r']);
const diagnostic=(phase,error)=>{
 let code,migrationId;try{code=error?.code;migrationId=error?.migrationId;}catch{/* Diagnostics must not disrupt cleanup or reporting. */}
 return {phase,sqlState:typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)?code:null,
  migrationId:INBOUND_RUNTIME_MIGRATIONS.includes(migrationId)||migrationId==='fixture_roles'?migrationId:null,isolation:readInboundIsolationDiagnostic(error),fixtureTransportReason:readOwnedRelayDiagnostic(error),preflight:phase==='preflight'?readPreflightDiagnostic(error):null};
};

/** Offline-testable orchestration kernel, NOT a command or infrastructure backend.
 * Trusted ports must be bounded/cancellable and reject only after their own operation settles.
 * No caller may supply these ports to a live endpoint. Owner approval + pinned backend remain prerequisites.
 */
export async function runInboundRuntimeLifecycle(ports,{runId,signal,isolationOnly=false,validationPlan='journal-acceptance'}={}){
 if(!['journal-acceptance','hosted-gates','appointment-storage','appointment-storage-v2','f03-reference-capture','ledger-write-fence'].includes(validationPlan)||typeof isolationOnly!=='boolean'||typeof runId!=='string'||!/^[a-f0-9]{32}$/.test(runId))denied();
 const migrations=validationPlan!=='journal-acceptance'?INBOUND_RUNTIME_MIGRATIONS.slice(0,12):INBOUND_RUNTIME_MIGRATIONS;
 const expected={runId};let phase='preflight',failure=null,creationUncertain=false,tests=null,schemaResults=null;
 const cleanup={verified:false,containerRemoved:false,networkRemoved:false,failure:null};
 const step=async(name,work)=>{phase=name;if(signal?.aborted)denied();return work();};
 try{
  const preflight=await step('preflight',()=>ports.preflight());
  if(preflight?.reviewIntegrity!==true||preflight.existingResources!==false||preflight.portAvailable!==true||preflight.localEngine!==true||!/^sha256:[a-f0-9]{64}$/.test(preflight.imageId))denied();
  expected.imageId=preflight.imageId;
  creationUncertain=true;const network=await step('create_network',()=>ports.createNetwork(expected,signal));
  if(!validId(network))denied();expected.networkId=network;creationUncertain=false;
  creationUncertain=true;const container=await step('create_container',()=>ports.createContainer(expected,signal));
  if(!validId(container))denied();expected.containerId=container;creationUncertain=false;
  await step('ready',()=>ports.waitReady(expected,signal));
  if(await step('verify_isolation',()=>ports.verifyIsolation(expected,signal))!==true)denied();
  if(!isolationOnly){
   schemaResults=await step('schemas',()=>ports.applySchemas(expected,signal));
   if(JSON.stringify(schemaResults)!==JSON.stringify(migrations))denied();
   if(await step('verify_isolation',()=>ports.verifyIsolation(expected,signal))!==true)denied();
   tests=await step('tests',()=>ports.runAcceptance(expected,signal));
   if(tests?.success!==true||tests.passed!==(validationPlan==='ledger-write-fence'?4:validationPlan==='f03-reference-capture'?3:validationPlan==='appointment-storage-v2'?5:9)||tests.failed!==0||tests.skipped!==(validationPlan==='appointment-storage-v2'?4:0))denied();
  }
 }catch(error){failure=diagnostic(phase,error);}
 finally{
  try{
   // Settle/close SQL clients before deleting only verified owned IDs. Never race cleanup against work.
   await ports.closeConnections();
   if(expected.containerId){
    assertInboundOwnedContainer(expected,await ports.inspectOwnedContainer(expected));
    await ports.removeContainer(expected.containerId);cleanup.containerRemoved=true;
   }
   if(expected.networkId){
    assertInboundOwnedNetwork(expected,await ports.inspectOwnedNetwork(expected),{empty:true});
    await ports.removeNetwork(expected.networkId);cleanup.networkRemoved=true;
   }
   const proof=await ports.verifyRemoval(expected);
   cleanup.verified=!creationUncertain&&proof?.containerAbsent===true&&proof.networkAbsent===true&&proof.destroyEventVerified===true&&proof.portFree===true;
   if(!cleanup.verified)cleanup.failure='INBOUND_RUNTIME_REMOVAL_UNVERIFIED';
  }catch(error){cleanup.failure='INBOUND_RUNTIME_CLEANUP_STOPPED';cleanup.isolation=readInboundIsolationDiagnostic(error);cleanup.fixtureTransportReason=readOwnedRelayDiagnostic(error);}
 }
 return {status:!failure&&cleanup.verified?'passed':'stopped',scope:isolationOnly?'isolation_only':'acceptance',...(validationPlan!=='journal-acceptance'?{validationPlan}:{}),failure,cleanup,creationUncertain,ownedResources:{...expected},schemaResults,tests:tests?{passed:tests.passed,failed:tests.failed,skipped:tests.skipped,...(validationPlan!=='journal-acceptance'?{failedCaseNumbers:tests.failedCaseNumbers??[]}: {}),...(['appointment-storage','appointment-storage-v2'].includes(validationPlan)?sanitizedAppointmentDiagnostics(tests):{}),...(validationPlan==='appointment-storage-v2'?{freshCaseNumbers:[5,6,7,8,9],plannedSkippedCaseNumbers:[1,2,3,4]}:{})}:null};
}
