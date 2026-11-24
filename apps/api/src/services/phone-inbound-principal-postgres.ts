import {AppError,ForbiddenError} from '@thaara/observability';
import type {DbClient} from '@thaara/db';
import type {InboundPrincipalGrant,InboundPrincipalTransactions} from './phone-inbound-principal.js';
import {makeInboundDiagnostic,type InboundDiagnostic,type InboundDiagnosticPhase,type InboundDiagnosticCheck} from './phone-inbound-diagnostics.js';

/** Inject only a dedicated, connection-timeout-bounded pool. This module never opens/configures a real pool. */
export interface InboundPrincipalPool{
 connect():Promise<{query:DbClient['query'];release(discard?:boolean):void}>;
}
const fail=()=>new AppError('Inbound principal transaction is unavailable.','PHONE_INBOUND_TRANSACTION_UNAVAILABLE',503);
const digest=/^[a-f0-9]{64}$/;
const grantKey=(g:InboundPrincipalGrant)=>JSON.stringify([g.routeId,g.workspaceId,g.ownerUserId,g.principalId,g.revision,g.profileFingerprint,g.tokenHash,g.activeOwner,g.revokedAt,g.expiresAt,[...g.operations].sort()]);
const ROLE_SQL=`/* phone_inbound_role_preflight */
SELECT current_user AS role_name,session_user AS session_role_name,
 pg_catalog.has_schema_privilege(current_user,'public','CREATE') AS schema_create,
 r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,r.rolreplication,r.rolinherit,
 EXISTS(SELECT 1 FROM pg_catalog.pg_roles x WHERE x.rolname<>current_user AND pg_catalog.pg_has_role(current_user,x.oid,'MEMBER')) AS elevated_membership,
 EXISTS(SELECT 1 FROM pg_catalog.pg_class t WHERE t.relnamespace='public'::regnamespace AND t.relowner=r.oid) AS owns_protected,
 c.relrowsecurity AS journal_rls,c.relforcerowsecurity AS journal_force_rls,
 (pg_catalog.has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  OR pg_catalog.has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')) AS direct_journal_access,
 EXISTS(SELECT 1 FROM pg_catalog.pg_class t WHERE t.relnamespace='public'::regnamespace
  AND t.relkind IN('r','p','v','m','f') AND (pg_catalog.has_table_privilege(current_user,t.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   OR pg_catalog.has_any_column_privilege(current_user,t.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS direct_protected_access
FROM pg_catalog.pg_roles r JOIN pg_catalog.pg_class c ON c.oid=pg_catalog.to_regclass('public.phone_inbound_call_events')
WHERE r.rolname=current_user`;

/**
 * TEST-ONLY adapter for a future phone-only DB role and scoped resolver. NOT installed or production-wired.
 * No generic owner role/session is synthesized. The dedicated role must have no direct journal privileges:
 * future audited append functions, not raw INSERT, are its only permitted data-write surface.
 */
export function createInboundPrincipalTransactions(options:{pool:InboundPrincipalPool;now?:()=>number;onDiagnostic?:(diagnostic:InboundDiagnostic)=>void}):InboundPrincipalTransactions<DbClient>{
 if(process.env.NODE_ENV!=='test')throw new Error('Inbound principal transactions are test-only pending schema and production admission review.');
 const connect=options.pool.connect.bind(options.pool),now=options.now??Date.now,onDiagnostic=options.onDiagnostic;
 return {async withGrant(request,work){
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(request.routeId)||!digest.test(request.tokenHash)||!['callback','completion'].includes(request.operation))throw fail();
  const {routeId,tokenHash,operation}=request;
  let phase:InboundDiagnosticPhase='connect',check:InboundDiagnosticCheck|undefined;
  const report=(error:unknown,at=phase)=>{
   try{const observed:unknown=onDiagnostic?.(makeInboundDiagnostic(at,error,at===phase?check:undefined));if(observed instanceof Promise)void observed.catch(()=>{});}catch{/* Diagnostics cannot skip cleanup or change authorization. */}
  };
  const reject=(reason:InboundDiagnosticCheck):never=>{check=reason;throw fail();};
  let client:Awaited<ReturnType<InboundPrincipalPool['connect']>>;
  try{client=await connect();}catch(error){report(error);throw fail();}
  let begun=false,discard=false,active=false;
  try{
   const started=now();if(!Number.isFinite(started))reject('initial_clock');
   phase='begin';
   await client.query('BEGIN');begun=true;
   phase='timeouts';
   await client.query("SET LOCAL statement_timeout='3s'");
   await client.query("SET LOCAL lock_timeout='1s'");
   await client.query("SET LOCAL idle_in_transaction_session_timeout='5s'");
   phase='role_query';
   const flags=(await client.query(ROLE_SQL)).rows;
   const role=flags[0];
   phase='role_validation';
   if(flags.length!==1||!role||role.role_name!=='thaara_phone_ingest')reject('runtime_identity');
   if(role.session_role_name!=='thaara_phone_ingest')reject('session_identity');
   if(role.schema_create!==false)reject('schema_create');
   if(['rolsuper','rolbypassrls','rolcreaterole','rolcreatedb','rolreplication','rolinherit','elevated_membership','owns_protected','direct_journal_access','direct_protected_access'].some(k=>role[k]!==false))reject('role_flags');
   if(role.journal_rls!==true||role.journal_force_rls!==true)reject('journal_rls');
   // Clear any browser identity inherited from a pooled session. Resolver installs only LOCAL phone scope.
   phase='clear_identity';
   await client.query("SELECT pg_catalog.set_config('app.session_token_hash','',true),pg_catalog.set_config('app.workspace_id','',true),pg_catalog.set_config('app.user_id','',true),pg_catalog.set_config('app.role','',true)");
   const readGrant=async()=>{
    const result=await client.query<{grant_record:InboundPrincipalGrant}>('SELECT grant_record FROM public.phone_inbound_resolve_grant($1,$2,$3)',[tokenHash,routeId,operation]);
    const resolved=result.rows[0]?.grant_record;
    if(result.rows.length!==1||!resolved)return reject('grant_missing');
    return structuredClone(resolved);
   };
   phase='grant_initial';
   const before=await readGrant(),admittedKey=grantKey(before);
   // Raw query is for trusted backend work only, under the restrictive DB role. It is never exposed to models.
   const tx:DbClient=Object.freeze({query:async<R=any>(sql:string,params?:any[])=>{
    if(!active)throw new ForbiddenError('Inbound transaction is closed.');
    return client.query<R>(sql,params);
   }});
   active=true;phase='policy_and_work';
   let result;
   try{result=await work(before,tx);}finally{active=false;}
   phase='grant_final';
   const after=await readGrant(),ended=now();phase='final_validation';
   if(!Number.isFinite(ended)||ended<started||ended-started>8000)reject('final_clock');
   if(admittedKey!==grantKey(after))reject('grant_changed');
   if(after.activeOwner!==true)reject('owner_inactive');
   if(after.revokedAt!==null)reject('grant_revoked');
   if(!Number.isFinite(Date.parse(after.expiresAt))||Date.parse(after.expiresAt)<=ended)reject('grant_expired');
   phase='commit';
   try{await client.query('COMMIT');begun=false;}catch(error){discard=true;throw error;}
   return result;
  }catch(error){
   report(error);
   active=false;
   let rolledBack=false;
   if(begun){try{await client.query('ROLLBACK');rolledBack=true;}catch(rollbackError){discard=true;report(rollbackError,'rollback');}}
   else discard=true;
   // An explicit application-policy denial remains a denial after a VERIFIED rollback.
   // Never expose its original message, or turn SQL/commit/rollback uncertainty into a403.
   if(error instanceof ForbiddenError&&phase==='policy_and_work'&&rolledBack&&!discard)throw new ForbiddenError('Inbound principal admission was denied.');
   // Commit failures remain uncertain; never retry or return the callback's saved receipt.
   throw fail();
  }finally{try{client.release(...(discard?[true] as const:[]));}catch(releaseError){report(releaseError,'release');throw fail();}}
 }};
}
