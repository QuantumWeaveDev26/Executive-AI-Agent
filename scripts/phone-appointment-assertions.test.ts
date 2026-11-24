import {it,expect} from 'vitest';
import {assertAppointmentDenial,appointmentTestDiagnostics,sanitizedAppointmentDiagnostics} from './phone-appointment-assertions.mjs';
const fixture=(failureMessages:unknown[])=>({testResults:[{assertionResults:Array.from({length:9},(_,i)=>({status:i<4?'passed':i===4?'failed':'skipped',failureMessages:i===4?failureMessages:[]}))}]});
it('labels all four denial checks without copying response bodies',()=>{
 for(const [check,status]of [['wrong_credentials',403],['call_binding',403],['revoked_identity',503],['expired_identity',503]] as const){
  expect(()=>assertAppointmentDenial({statusCode:status,json:()=>({saved:false,secret:'PRIVATE'})},check)).not.toThrow();
  let error:any;try{assertAppointmentDenial({statusCode:200,json:()=>({saved:true,secret:'PRIVATE'})},check);}catch(e){error=e;}
  expect(error.message).toBe(`APPOINTMENT_ASSERTION|${check}|http_status|${status}|200`);expect(error.message).not.toContain('PRIVATE');
 }
});
it('retains the exact403/503 mismatch and explicitly records unexecuted cases',()=>{
 const d=appointmentTestDiagnostics(fixture(['Error: APPOINTMENT_ASSERTION|call_binding|http_status|403|503\n PRIVATE TOKEN/PHONE/SQL']));
 expect(d).toEqual({failedAssertions:[{caseNumber:5,assertion:'call_binding',field:'http_status',expected:403,actual:503}],notExecutedCaseNumbers:[6,7,8,9]});expect(JSON.stringify(d)).not.toContain('PRIVATE');
});
it('records saved acknowledgement failures with finite boolean values',()=>{
 let message='';try{assertAppointmentDenial({statusCode:403,json:()=>({saved:true,phone:'PRIVATE'})},'call_binding');}catch(e){message=(e as Error).message;}
 expect(appointmentTestDiagnostics(fixture([message])).failedAssertions[0]).toEqual({caseNumber:5,assertion:'call_binding',field:'saved',expected:'false',actual:'true'});
});
it('retains numeric source location for other assertions without storing the path or values',()=>{
 const d=appointmentTestDiagnostics(fixture(['AssertionError PRIVATE TOKEN\n at C:\\PRIVATE\\phone-inbound-appointment-storage.runtime.test.ts:123:45']));
 expect(d.failedAssertions).toEqual([{caseNumber:5,assertion:'unclassified',sourceLine:123,sourceColumn:45}]);expect(JSON.stringify(d)).not.toContain('PRIVATE');
});
it('does not retain unrecognised, injected or oversized failure details',()=>{
 for(const message of ['PRIVATE SQL/password', 'APPOINTMENT_ASSERTION|PRIVATE|http_status|403|503','APPOINTMENT_ASSERTION|call_binding|http_status|403|503PRIVATE','x'.repeat(9000)+'APPOINTMENT_ASSERTION|call_binding|http_status|403|503']){
  expect(appointmentTestDiagnostics(fixture([message])).failedAssertions).toEqual([{caseNumber:5,assertion:'unclassified'}]);
 }
});
it('sanitizes lifecycle output again and never forwards arbitrary fields',()=>{
 const d=sanitizedAppointmentDiagnostics({failedAssertions:[{caseNumber:5,assertion:'call_binding',field:'http_status',expected:403,actual:503,secret:'PRIVATE'},{caseNumber:6,assertion:'PRIVATE'},{caseNumber:7,assertion:'unclassified',secret:'PRIVATE'}],notExecutedCaseNumbers:[6,7,8,9,'PRIVATE',100]});
 expect(d.failedAssertions).toEqual([{caseNumber:5,assertion:'call_binding',field:'http_status',expected:403,actual:503},{caseNumber:7,assertion:'unclassified'}]);expect(JSON.stringify(d)).not.toContain('PRIVATE');expect(d.notExecutedCaseNumbers).toEqual([6,7,8,9]);
});
it('reports invalid JSON/status only through finite codes and rejects unknown assertion labels',()=>{
 expect(()=>assertAppointmentDenial({statusCode:403,json:()=>{throw Error('PRIVATE');}},'call_binding')).toThrow('APPOINTMENT_ASSERTION|call_binding|saved|false|invalid');
 expect(()=>assertAppointmentDenial({statusCode:'PRIVATE'},'call_binding')).toThrow('APPOINTMENT_ASSERTION|call_binding|http_status|403|invalid');
 expect(()=>assertAppointmentDenial({},'PRIVATE')).toThrow('APPOINTMENT_ASSERTION_CHECK_INVALID');
});
