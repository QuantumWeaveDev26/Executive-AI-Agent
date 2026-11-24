// Fixed diagnostic vocabulary only. Never copy error messages, bodies, SQL, tokens or identifiers.
const expectedStatus=Object.freeze({wrong_credentials:403,call_binding:403,revoked_identity:503,expired_identity:503});
const marker='APPOINTMENT_ASSERTION';
export function assertAppointmentDenial(response,check){
 if(!Object.hasOwn(expectedStatus,check))throw Error('APPOINTMENT_ASSERTION_CHECK_INVALID');
 const status=Number.isInteger(response?.statusCode)&&response.statusCode>=100&&response.statusCode<=599?response.statusCode:'invalid';
 if(status!==expectedStatus[check])throw Error(`${marker}|${check}|http_status|${expectedStatus[check]}|${status}`);
 let body;try{body=response.json();}catch{/* Invalid JSON is only reported as a finite boolean-state error. */}
 const saved=body?.saved===true?'true':body?.saved===false?'false':'invalid';
 if(saved!=='false')throw Error(`${marker}|${check}|saved|false|${saved}`);
}
function validFailure(value){
 if(!value||!Number.isInteger(value.caseNumber)||value.caseNumber<1||value.caseNumber>9)return null;
 const location=Number.isInteger(value.sourceLine)&&value.sourceLine>0&&value.sourceLine<=100000&&Number.isInteger(value.sourceColumn)&&value.sourceColumn>0&&value.sourceColumn<=10000?{sourceLine:value.sourceLine,sourceColumn:value.sourceColumn}:{};
 if(value.assertion==='unclassified')return {caseNumber:value.caseNumber,assertion:'unclassified',...location};
 if(!Object.hasOwn(expectedStatus,value.assertion))return null;
 const field=value.field,expected=field==='http_status'?expectedStatus[value.assertion]:field==='saved'?'false':null;
 if(expected===null||value.expected!==expected)return null;
 const actual=value.actual;
 if(field==='http_status'&&!(actual==='invalid'||Number.isInteger(actual)&&actual>=100&&actual<=599))return null;
 if(field==='saved'&&!['true','false','invalid'].includes(actual)||actual===expected)return null;
 return {caseNumber:value.caseNumber,assertion:value.assertion,field,expected,actual,...location};
}
/** Read already-parsed bounded Vitest JSON. Unknown assertions stay unclassified; no raw text escapes. */
export function appointmentTestDiagnostics(result){
 const assertions=result?.testResults?.[0]?.assertionResults;
 if(!Array.isArray(assertions)||assertions.length!==9)return {failedAssertions:[],notExecutedCaseNumbers:[]};
 const failedAssertions=[],notExecutedCaseNumbers=[];
 for(let i=0;i<assertions.length;i++){
  const a=assertions[i],caseNumber=i+1;
  if(a?.status==='passed')continue;
  if(a?.status!=='failed'){notExecutedCaseNumbers.push(caseNumber);continue;}
  let found,location;
  for(const message of Array.isArray(a.failureMessages)?a.failureMessages.slice(0,4):[]){
   if(typeof message!=='string')continue;
   const text=message.slice(0,8192),line=text.match(/phone-inbound-appointment-storage\.runtime\.test\.ts:([1-9][0-9]{0,4}):([1-9][0-9]{0,3})(?![0-9])/);
   if(line)location={sourceLine:Number(line[1]),sourceColumn:Number(line[2])};
   const m=text.match(/APPOINTMENT_ASSERTION\|(wrong_credentials|call_binding|revoked_identity|expired_identity)\|(http_status|saved)\|(403|503|false)\|([1-5][0-9]{2}|true|false|invalid)(?![A-Za-z0-9_-])/);
   if(!m)continue;
   found=validFailure({caseNumber,assertion:m[1],field:m[2],expected:m[3]==='false'?'false':Number(m[3]),actual:/^[1-5][0-9]{2}$/.test(m[4])?Number(m[4]):m[4],...location});if(found)break;
  }
  failedAssertions.push(found??{caseNumber,assertion:'unclassified',...location});
 }
 return {failedAssertions,notExecutedCaseNumbers};
}
/** Reconstruct allowlisted fields again at the lifecycle/reporting boundary; never forward a raw object. */
export function sanitizedAppointmentDiagnostics(value){
 try{
  const failedAssertions=Array.isArray(value?.failedAssertions)?value.failedAssertions.slice(0,9).map(validFailure).filter(Boolean):[];
  const notExecutedCaseNumbers=Array.isArray(value?.notExecutedCaseNumbers)?[...new Set(value.notExecutedCaseNumbers.filter(n=>Number.isInteger(n)&&n>=1&&n<=9))].sort((a,b)=>a-b):[];
  return {failedAssertions,notExecutedCaseNumbers};
 }catch{return {failedAssertions:[],notExecutedCaseNumbers:[]};}
}
