import { Config } from '@thaara/config';
import { PostgresDatabase,TransactionalDbClient } from '@thaara/db';
import { getIsolatedRuntimeConfig } from '../../../../scripts/step74-runtime-guard.mjs';
import { DurableN8nSecurityOptions } from './durable-n8n-security.js';
import { PostgresConnectorStateStore,PostgresConnectorProfileInput } from './postgres-connector-store.js';

export interface VerifiedDurableN8nTestDependency {readonly db:PostgresDatabase;readonly mode:'mock';readonly storage:'postgres_durable';}
const verified=new WeakMap<object,{url:string;options:DurableN8nSecurityOptions}>();
const denied=()=>new Error('Durable n8n requires verified isolated test configuration.');
export async function createDurableN8nTestDependency(input:Omit<DurableN8nSecurityOptions,'store'|'mode'|'profiles'>&{
 config:Config;testEnvironment:Record<string,string|undefined>;profiles:ReadonlyArray<PostgresConnectorProfileInput>;
}):Promise<VerifiedDurableN8nTestDependency> {
 let url:string;
 try {
  if(input.config.NODE_ENV!=='test'||input.cipher.mode!=='mock')throw denied();
  url=getIsolatedRuntimeConfig({...input.testEnvironment}).appUrl;
  if(input.config.DATABASE_URL!==url)throw denied();
 }catch{throw denied();}
 let db:PostgresDatabase|undefined;
 try {
 const profiles=Object.freeze(input.profiles.map(p=>Object.freeze({...p})));
 db=new PostgresDatabase(url);
 const options:DurableN8nSecurityOptions=Object.freeze({mode:'mock',store:new PostgresConnectorStateStore({mode:'mock',db,profiles}),
  cipher:input.cipher,profiles,resolveProfileSecret:input.resolveProfileSecret,transportFactory:input.transportFactory});
  const {rows}=await db.query<{db:string;actor:string;elevated:boolean;can_read:boolean;can_commit:boolean;forced_rls_tables:number;direct_table_access:boolean}>(
   `SELECT current_database() AS db,current_user AS actor,
    (SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles WHERE rolname=current_user) AS elevated,
    has_function_privilege(current_user,'public.read_workspace_connector_connection(text)','EXECUTE') AS can_read,
    has_function_privilege(current_user,'public.commit_workspace_connector_connection(text,bigint,text,text,text,jsonb)','EXECUTE') AS can_commit,
    (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN ('workspace_connector_profiles','workspace_connector_connections')
      AND c.relrowsecurity AND c.relforcerowsecurity) AS forced_rls_tables,
    (has_table_privilege(current_user,'public.workspace_connector_connections','SELECT,INSERT,UPDATE,DELETE') OR
     has_table_privilege(current_user,'public.workspace_connector_profiles','SELECT,INSERT,UPDATE,DELETE')) AS direct_table_access`);
  const row=rows[0];
  if(!row||row.db!=='thaara_step74_test'||row.actor!=='thaara_app'||row.elevated!==false||row.can_read!==true||row.can_commit!==true||row.forced_rls_tables!==2||row.direct_table_access!==false)throw denied();
  const dependency=Object.freeze({db,mode:'mock' as const,storage:'postgres_durable' as const});
  verified.set(dependency,{url,options});return dependency;
 }catch{await db?.close().catch(()=>{});throw denied();}
}
export function verifiedDurableN8nOptions(dependency:VerifiedDurableN8nTestDependency,config:Config,db:TransactionalDbClient):DurableN8nSecurityOptions {
 const value=verified.get(dependency);
 if(!value||config.NODE_ENV!=='test'||config.DATABASE_URL!==value.url||db!==dependency.db)throw denied();
 return value.options;
}
