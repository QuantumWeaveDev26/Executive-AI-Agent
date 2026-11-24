// Diagnostic-only: one unchanged, checksum-verified 110a artifact; no later migrations or tests.
import {phoneFixturePoolCounts} from './phone-fixture-session.mjs';
export function classifyPhoneFixtureError(error){
 const nodeCodes={EPIPE:'broken_pipe',ECONNRESET:'connection_reset',ECONNREFUSED:'connection_refused',ETIMEDOUT:'transport_timeout',ENOTFOUND:'host_not_found',EAI_AGAIN:'name_resolution_temporary_failure'};
 const messages={'Connection terminated unexpectedly':'connection_terminated_unexpectedly','Connection terminated':'connection_terminated','Connection terminated due to connection timeout':'connection_timeout','timeout exceeded when trying to connect':'connection_timeout','Query read timeout':'query_read_timeout','Client has encountered a connection error and is not queryable':'client_not_queryable','Client was closed and is not queryable':'client_closed'};
 const own=(object,key)=>typeof key==='string'&&Object.hasOwn(object,key)?object[key]:null;
 const clientCategory=own(nodeCodes,error?.code);
 if(clientCategory)return {sqlstate:null,category:clientCategory};
 // PostgreSQL classes only: e.g. EPIPE/TOKEN must never be emitted as a SQLSTATE.
 const code=typeof error?.code==='string'&&/^(00|01|02|03|08|09|0A|0B|0F|0L|0P|0Z|10|20|21|22|23|24|25|26|27|28|2B|2D|2F|34|38|39|3B|3D|3F|40|42|44|53|54|55|57|58|72|F0|HV|P0|XX)[A-Z0-9]{3}$/.test(error.code)?error.code:null;
 return {sqlstate:code,category:own({42601:'syntax_error',42501:'insufficient_privilege',42704:'undefined_object','42P01':'undefined_table',42703:'undefined_column',42883:'undefined_function','2201B':'invalid_regular_expression','57014':'query_canceled',P0001:'raised_exception'},code)??(code?'postgresql_error':own(messages,error?.message)??'client_transport_or_runner_error')};
}

export async function diagnosePhone110a(db, sql, {now=()=>performance.now(),getPoolCounts=()=>null}={}) {
 const started=now();
 const result={status:'failed',migration:'110a-phone-contacts.review.sql',phase:'acknowledgement',sqlstate:null,category:null,sourceLine:null,context:null};
 try {
  await db.query("SELECT set_config('thaara.step110a_review_approved','yes',false),set_config('thaara.step110a_target_database',current_database(),false)");
  result.phase='context';
  const row=(await db.query(`SELECT pg_backend_pid() AS backend_pid,
   current_setting('thaara.step110a_review_approved',true)='yes' AS review_acknowledged,
   current_setting('thaara.step110a_target_database',true)=current_database() AS target_matches,
   (SELECT count(*)::int FROM public.schema_migrations) AS base_migration_count,
   to_regprocedure('public.current_authenticated_scope()') IS NOT NULL AS scope_function_exists,
   to_regclass('public.audit_events') IS NOT NULL AS audit_table_exists,
   to_regclass('public.phone_contacts') IS NOT NULL AS contacts_already_exist,
   current_setting('is_superuser')='on' AS is_superuser`)).rows[0];
  result.context={backendPid:Number.isSafeInteger(row?.backend_pid)?row.backend_pid:null,baseMigrationCount:Number.isSafeInteger(row?.base_migration_count)?row.base_migration_count:null};
  for(const key of ['review_acknowledged','target_matches','scope_function_exists','audit_table_exists','contacts_already_exist','is_superuser'])result.context[key]=typeof row?.[key]==='boolean'?row[key]:null;
  result.phase='migration';
  await db.exec(sql);
  result.status='applied';result.category='none';
 } catch(error) {
  Object.assign(result,classifyPhoneFixtureError(error));
  const position=typeof error?.position==='string'&&/^[0-9]{1,9}$/.test(error.position)?Number(error.position):0;
  if(result.sqlstate&&result.phase==='migration'&&position>0&&position<=sql.length)result.sourceLine=sql.slice(0,position-1).split('\n').length;
  // Never copy message, detail, hint, where, query or arbitrary object names from an exception.
 }
 const elapsed=now()-started;
 result.elapsedMs=Number.isFinite(elapsed)&&elapsed>=0?Math.min(86400000,Math.floor(elapsed)):null;
 result.poolCounts=phoneFixturePoolCounts(getPoolCounts());
 return result;
}
