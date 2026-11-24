// Finite fixture diagnostics only. Never retain raw subprocess output, paths or credentials.
const checks=new Set(['source_integrity','context_metadata','port_probe','container_inventory','network_inventory','image_metadata']);
const kinds=new Set(['command_timeout','command_unavailable','permission_denied','port_in_use','invalid_json','validation_failed','operation_failed']);
const validation=Symbol('preflight_validation');
export function rejectPreflight(){throw {[validation]:true};}
export function readPreflightDiagnostic(error){
 try{const check=error?.preflightCheck,kind=error?.preflightKind;return checks.has(check)&&kinds.has(kind)?{check,kind}:null;}catch{return null;}
}
export async function preflightCheck(check,work){
 if(!checks.has(check))throw Error('INBOUND_PREFLIGHT_CHECK_DENIED');
 try{return await work();}catch(error){
  let kind='operation_failed';
  try{
   if(error?.[validation]===true)kind='validation_failed';
   else if(error instanceof SyntaxError)kind='invalid_json';
   else if(error?.code==='ETIMEDOUT')kind='command_timeout';
   else if(error?.code==='ENOENT')kind='command_unavailable';
   else if(['EACCES','EPERM'].includes(error?.code))kind='permission_denied';
   else if(error?.code==='EADDRINUSE')kind='port_in_use';
  }catch{/* Hostile getters cannot escape the diagnostic boundary. */}
  throw Object.assign(Error('INBOUND_PREFLIGHT_STOPPED'),{preflightCheck:check,preflightKind:kind});
 }
}
