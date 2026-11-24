import type {DbClient} from '@thaara/db';
import {makeInboundDiagnostic} from '../../src/services/phone-inbound-diagnostics.js';
export type FixtureIdentityDiagnostic=Readonly<{step:'capture'|'restore';verified:boolean;identityMatches:boolean;sessionMatches:boolean;administrator:boolean;auditReadable:boolean;sqlState:string|null}>;
interface Identity{current_identity:string;session_identity:string;is_superuser:boolean;can_read_audit:boolean}
const SQL=`SELECT current_user AS current_identity,session_user AS session_identity,r.rolsuper AS is_superuser,
 pg_catalog.has_table_privilege(current_user,'public.audit_events','SELECT') AS can_read_audit
 FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;
/** Fixture-only, no DB constructor, pool, environment target, privilege grants or provider access. */
export async function captureInboundFixtureAdmin(db:DbClient,onDiagnostic?:(d:FixtureIdentityDiagnostic)=>void){
 if(process.env.NODE_ENV!=='test')throw Error('PHONE113_FIXTURE_IDENTITY_TEST_ONLY');
 const query=db.query.bind(db),exec=db.exec?.bind(db);
 if(!exec)throw Error('PHONE113_FIXTURE_ADMIN_UNVERIFIED');
 const emit=(d:FixtureIdentityDiagnostic)=>{try{const observed:unknown=onDiagnostic?.(Object.freeze(d));if(observed instanceof Promise)void observed.catch(()=>{});}catch{/* A diagnostic must not alter identity verification. */}};
 let initial:string|undefined;
 async function verify(step:'capture'|'restore'){
  let metadata:Identity|undefined,sqlState:string|null=null;
  try{const r=await query<Identity>(SQL);if(r.rows.length===1)metadata=r.rows[0];}catch(error){sqlState=makeInboundDiagnostic('unknown',error).sqlState;}
  const safeName=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=128&&!/[\x00-\x1f\x7f]/.test(s);
  const identityMatches=!!metadata&&safeName(metadata.current_identity)&&(initial===undefined||metadata.current_identity===initial);
  const sessionMatches=!!metadata&&safeName(metadata.session_identity)&&metadata.session_identity===(initial??metadata.current_identity);
  const administrator=metadata?.is_superuser===true,auditReadable=metadata?.can_read_audit===true;
  const verified=identityMatches&&sessionMatches&&administrator&&auditReadable;
  emit({step,verified,identityMatches,sessionMatches,administrator,auditReadable,sqlState});
  if(!verified)throw Error('PHONE113_FIXTURE_ADMIN_UNVERIFIED');
  return metadata!.current_identity;
 }
 initial=await verify('capture');
 const original=initial; // Captured only from the fresh fixture, never caller input; not returned or logged.
 return Object.freeze({async restore(){
  try{
   await exec('SET SESSION AUTHORIZATION "'+original.replaceAll('"','""')+'"');
   await exec('RESET ROLE');
  }catch(error){
   emit({step:'restore',verified:false,identityMatches:false,sessionMatches:false,administrator:false,auditReadable:false,sqlState:makeInboundDiagnostic('unknown',error).sqlState});
   throw Error('PHONE113_FIXTURE_ADMIN_UNVERIFIED');
  }
  await verify('restore');
 }});
}
