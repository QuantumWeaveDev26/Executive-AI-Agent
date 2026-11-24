// TEST-ONLY sequence rehearsal. No CLI, SQL, database, SSH, secret or live execution adapter.
const deny=()=>{throw Error('INBOUND_INSTALL_REHEARSAL_DENIED');};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const keys=(o,expected)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...expected].sort().join(',');
const equal=(a,b)=>JSON.stringify(Object.keys(a).sort().map(k=>[k,a[k]]))===JSON.stringify(Object.keys(b).sort().map(k=>[k,b[k]]));
const copy=v=>Object.freeze(structuredClone(v));
const sourceKeys=['manifestSha256','sql112Sha256','sql113Sha256','expected112CatalogSha256'];
const targetKeys=['containerId','imageId','database','postgresMajor'];
function sources(value){if(!keys(value,sourceKeys)||sourceKeys.some(k=>!sha(value[k])))deny();return copy(value);}
function target(value){
 if(!keys(value,targetKeys)||!sha(value.containerId)||typeof value.imageId!=='string'||!/^sha256:[a-f0-9]{64}$/.test(value.imageId)||value.database!=='thaara_vps_pilot'||value.postgresMajor!==16)deny();return copy(value);
}
/** Trusted fake ports only. A production driver, protected approvals, full catalog baseline and
 * bounded/cancellable operations require separate implementation/review/authorization. */
export async function rehearseInboundInstall(ports,{runId}={}){
 if(process.env.NODE_ENV!=='test')throw Error('Inbound install sequence is test-only; no persistent execution is admitted.');
 if(typeof runId!=='string'||!/^[a-f0-9]{32}$/.test(runId))deny();
 let phase='sources',baseline,identity,stateUncertain=false;const committedSteps=[];
 const authorize=async()=>{
  const a=await ports.authorization();if(!keys(a,['runId','manifestSha256','scope','approved'])||a.runId!==runId||a.manifestSha256!==baseline.manifestSha256||a.scope!=='inbound-schema-only'||a.approved!==true)deny();
 };
 const recovery=async()=>{
  const r=await ports.backup(),now=ports.now(),time=typeof r?.verifiedAt==='string'&&/^\d{4}-\d{2}-\d{2}T.*Z$/.test(r.verifiedAt)?Date.parse(r.verifiedAt):NaN;
  if(!r||r.verified!==true||r.restoreVerified!==true||r.restoreFixtureRemoved!==true||!sha(r.archiveSha256)||!equal(target(r.sourceIdentity),identity)||!Number.isFinite(now)||!Number.isFinite(time)||time>now||now-time>30*60*1000)deny();
 };
 const recheck=async()=>{
  if(!equal(sources(await ports.sources()),baseline)||!equal(target(await ports.target()),identity))deny();await authorize();await recovery();
 };
 const apply=async step=>{
  phase='recheck_'+step;await recheck();phase='apply_'+step;stateUncertain=true;
  const expectedSha=step===112?baseline.sql112Sha256:baseline.sql113Sha256;
  // Future trusted113 driver must lock and verify112 inside its own mutation transaction;
  // the earlier standalone journal read is insufficient to prevent a check/use race.
  const r=await ports.apply(step,Object.freeze({runId,sqlSha256:expectedSha,...(step===113?{expected112CatalogSha256:baseline.expected112CatalogSha256}:{})}));
  const receiptKeys=['step','runId','sqlSha256','committed',...(step===113?['journalCatalogSha256','journalLockedAndVerified']:[])];
  if(!keys(r,receiptKeys)||r.step!==step||r.runId!==runId||r.sqlSha256!==expectedSha||r.committed!==true
   ||(step===113&&(r.journalCatalogSha256!==baseline.expected112CatalogSha256||r.journalLockedAndVerified!==true)))deny();
  committedSteps.push(step);stateUncertain=false;
 };
 try{
  baseline=sources(await ports.sources());phase='target';identity=target(await ports.target());phase='authorization';await authorize();
  phase='preconditions';if((await ports.preconditions())?.ready!==true)deny();phase='recovery';await recovery();
  await apply(112);phase='journal_verification';
  const journal=await ports.journal();if(!keys(journal,['runId','sqlSha256','catalogSha256','verified'])||journal.runId!==runId||journal.sqlSha256!==baseline.sql112Sha256||journal.catalogSha256!==baseline.expected112CatalogSha256||journal.verified!==true)deny();
  await apply(113);phase='privilege_verification';const privileges=await ports.privileges();
  if(!keys(privileges,['runId','sqlSha256','verified'])||privileges.runId!==runId||privileges.sqlSha256!==baseline.sql113Sha256||privileges.verified!==true)deny();
  return {status:'rehearsed',mode:'test-only',productionReady:false,committedSteps,stateUncertain:false,recovery:'keep_reporting_disabled_preserve_evidence_forward_review'};
 }catch{
  return {status:'stopped',mode:'test-only',productionReady:false,phase,committedSteps,stateUncertain,recovery:'keep_reporting_disabled_preserve_evidence_forward_review'};
 }
}
