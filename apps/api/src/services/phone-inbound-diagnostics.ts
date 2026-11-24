/** Finite diagnostic vocabulary only. Never copies messages, SQL, identifiers, request bodies or credentials. */
const phases=['unknown','connect','begin','timeouts','role_query','role_validation','clear_identity','grant_initial','policy_and_work','grant_final','final_validation','commit','rollback','release'] as const;
const checks=['runtime_identity','session_identity','schema_create','role_flags','journal_rls','grant_missing','initial_clock','final_clock','grant_changed','grant_expired','grant_revoked','owner_inactive'] as const;
export type InboundDiagnosticPhase=typeof phases[number];
export type InboundDiagnosticCheck=typeof checks[number];
type Category='unknown'|'local_validation'|'permission'|'schema'|'constraint'|'invalid_data'|'timeout'|'connection'|'transaction'|'database_exception';
export type InboundDiagnostic=Readonly<{phase:InboundDiagnosticPhase;category:Category;sqlState:string|null;check:InboundDiagnosticCheck|null}>;
const states=new Map<string,Category>([
 ['42501','permission'],['42601','schema'],['42703','schema'],['42P01','schema'],['42883','schema'],['42809','schema'],['42704','schema'],['42P17','schema'],
 ['23505','constraint'],['23514','constraint'],['23503','constraint'],['23502','constraint'],
 ['22023','invalid_data'],['22P02','invalid_data'],['22007','invalid_data'],['22008','invalid_data'],
 ['57014','timeout'],['55P03','timeout'],['08006','connection'],['08003','connection'],['57P01','connection'],['53300','connection'],['25P02','transaction'],['40001','transaction'],['40P01','transaction'],['P0001','database_exception']
]);
export function makeInboundDiagnostic(phase:InboundDiagnosticPhase,error:unknown,check?:InboundDiagnosticCheck):InboundDiagnostic{
 let code:unknown;
 try{
  // Read only an own data property; do not execute error getters or stringify an arbitrary error object.
  if(error&&typeof error==='object'){const d=Object.getOwnPropertyDescriptor(error,'code');if(d&&'value'in d)code=d.value;}
 }catch{/* A hostile proxy/error is unknown, never a reason to expose its contents. */}
 const sqlState=typeof code==='string'&&states.has(code)?code:null;
 const safeCheck=checks.includes(check as InboundDiagnosticCheck)?check!:null;
 return Object.freeze({phase:phases.includes(phase)?phase:'unknown',category:safeCheck?'local_validation':sqlState?states.get(sqlState)!:'unknown',sqlState,check:safeCheck});
}
