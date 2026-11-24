// LOCAL VALIDATION ONLY: closed PG16 security representation, not a SQL parser/extractor.
import {canonical} from './phone-inbound-expected-schema.mjs';
const fail=()=>{throw Error('PG16_SCHEMA_DENIED');};
const str=v=>{if(typeof v!=='string'||!v.length||v.length>131072||v.includes('\0'))fail();return v;};
const bool=v=>{if(typeof v!=='boolean')fail();return v;};
const integer=v=>{if(!Number.isSafeInteger(v))fail();return v;};
const enumeration=(...values)=>v=>{if(!values.includes(v))fail();return v;};
const nullable=f=>v=>v===null?null:f(v);
const name=v=>{str(v);if(!/^[a-z_][a-z0-9_]*$/.test(v))fail();return v;};
const qualified=v=>{str(v);if(!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(v))fail();return v;};
const digest=v=>{if(typeof v!=='string'||! /^[a-f0-9]{64}$/.test(v))fail();return v;};
function object(shape){return v=>{
 if(!v||Object.getPrototypeOf(v)!==Object.prototype||canonical(Object.keys(v).sort())!==canonical(Object.keys(shape).sort()))fail();
 return Object.fromEntries(Object.entries(shape).map(([k,f])=>[k,f(v[k])]));
};}
function list(f,{key=null,ordered=false}={}){return v=>{
 if(!Array.isArray(v)||v.length>4096||Object.keys(v).length!==v.length)fail();
 const result=v.map(f),ids=result.map(x=>canonical(key?key(x):x));if(new Set(ids).size!==ids.length)fail();
 return ordered?result:result.sort((a,b)=>canonical(a)<canonical(b)?-1:canonical(a)>canonical(b)?1:0);
};}
// Grantor remains part of EVERY tuple. Nothing infers or rewrites ownership-transfer effects.
const acl=list(object({grantor:name,grantee:v=>v==='PUBLIC'?v:name(v),privilege:enumeration('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','EXECUTE','USAGE','CREATE','CONNECT','TEMPORARY'),grantable:bool}),{key:x=>[x.grantor,x.grantee,x.privilege]});
const config=list(str,{key:x=>x.split('=')[0]});
const absent=v=>{if(!Array.isArray(v)||v.length!==0)fail();return [];};
const column=object({name,position:integer,type:enumeration('uuid','text','jsonb','smallint','integer','bigint','boolean','timestamp with time zone','text[]','bytea','double precision','numeric'),notNull:bool,default:nullable(str),identity:enumeration('','a','d'),generated:enumeration('','s'),collation:nullable(qualified)});
const constraint=object({name,type:enumeration('p','u','f','c','x','t'),definition:str,validated:bool,deferrable:bool,deferred:bool,referencedTable:nullable(qualified)});
const index=object({name,definition:str,valid:bool,ready:bool,unique:bool,primary:bool,nullsNotDistinct:bool});
const policy=object({name,command:enumeration('*','r','a','w','d'),permissive:bool,roles:list(v=>v==='PUBLIC'?v:name(v)),using:nullable(str),check:nullable(str)});
const noTransition=v=>{if(v!==null)fail();return null;};
// Exact PG16 catalog fields, not SQL rewriting or a claim of semantic equivalence.
const trigger=object({name,definition:str,function:str,enabled:enumeration('O','D','R','A'),constraint:bool,deferrable:bool,initiallyDeferred:bool,oldTransitionTable:noTransition,newTransitionTable:noTransition});
const table=object({name:qualified,owner:name,rls:bool,forceRls:bool,kind:enumeration('r'),persistence:enumeration('p'),options:config,parents:absent,triggers:list(trigger,{key:x=>x.name}),rules:absent,columns:list(column,{key:x=>x.name,ordered:true}),constraints:list(constraint,{key:x=>x.name}),indexes:list(index,{key:x=>x.name}),policies:list(policy,{key:x=>x.name}),acl,columnAcl:list(object({column:name,acl}),{key:x=>x.column})});
// Native declarations are comparable evidence, not approval of a library or extension.
// Exact definition (library/entrypoint), attributes, ACLs and outer provenance remain bound.
const fn=object({signature:str,owner:name,definition:str,language:enumeration('sql','plpgsql','c'),result:str,kind:enumeration('f'),securityDefiner:bool,leakproof:bool,strict:bool,volatility:enumeration('i','s','v'),parallel:enumeration('s','r','u'),config,acl});
const role=object({name,login:bool,inherit:bool,super:bool,bypassRls:bool,createDb:bool,createRole:bool,replication:bool,connectionLimit:integer,validUntil:nullable(str),config});
const schema=object({name,owner:name,acl});
const membership=object({role:name,member:name,grantor:name,adminOption:bool,inheritOption:bool,setOption:bool});
const defaults=object({role:name,schema:nullable(name),objectType:enumeration('r','S','f','T','n'),acl});
const catalog=object({format:enumeration('pg16-security-v1'),serverVersionNum:integer,stage:enumeration('after112','after113'),tables:list(table,{key:x=>x.name}),functions:list(fn,{key:x=>x.signature}),roles:list(role,{key:x=>x.name}),schemas:list(schema,{key:x=>x.name}),memberships:list(membership,{key:x=>[x.role,x.member,x.grantor]}),defaultPrivileges:list(defaults,{key:x=>[x.role,x.schema,x.objectType]}),dependencies:list(object({name:str,kind:enumeration('reviewed-contract','pg16-dependency-graph'),sha256:digest}),{key:x=>x.name})});
export function normalizePg16(value){
 if(process.env.NODE_ENV!=='test')throw Error('PG16 schema validator is test-only');
 try{
  const c=catalog(value);if(c.serverVersionNum<160000||c.serverVersionNum>169999||canonical(c).length>1048576)fail();
  const requiredTables=['workspaces','users','memberships','sessions','audit_events','phone_inbound_call_events',...(c.stage==='after113'?['phone_inbound_principals']:[])].map(n=>'public.'+n);
  const requiredFns=['public.current_authenticated_scope()','public.resolve_session_scope(text)',...(c.stage==='after113'?['public.phone_inbound_resolve_grant(text,text,text)','public.phone_inbound_scope_matches(uuid,uuid)','public.phone_inbound_append_event(jsonb)']:[])];
  const requiredRoles=['postgres','thaara_app','thaara_worker',...(c.stage==='after113'?['thaara_phone_guard','thaara_phone_ingest']:[])];
  // PG16 oidvectortypes emits comma-space; legacy synthetic fixtures used comma alone.
  // Recognize these exact required identities only; never rewrite returned values or comparison.
  if(requiredTables.some(n=>!c.tables.some(t=>t.name===n))||requiredFns.some(n=>!c.functions.some(f=>f.signature===n||f.signature===n.replaceAll(',',', ')))||requiredRoles.some(n=>!c.roles.some(r=>r.name===n))||!c.schemas.some(s=>s.name==='public')||!c.dependencies.length)fail();
  for(const t of c.tables){
   if(!t.columns.length||t.columns.some((x,i)=>x.position!==i+1)||t.columnAcl.some(x=>!t.columns.some(col=>col.name===x.column)))fail();
   // The existing base SQL uses this PG16 deferred constraint-trigger representation.
   // Reject unpaired, inconsistent or other unsupported trigger-constraint forms.
   for(const con of t.constraints.filter(con=>con.type==='t')){
    const tr=t.triggers.find(tr=>tr.name===con.name);
    if(!tr||!tr.constraint||!tr.deferrable||!tr.initiallyDeferred||!con.deferrable||!con.deferred
     ||con.referencedTable!==null||con.definition!=='TRIGGER DEFERRABLE INITIALLY DEFERRED')fail();
   }
   for(const tr of t.triggers){
    const f=c.functions.find(f=>f.signature===tr.function);
    if(!f||f.result!=='trigger'||!new RegExp('^CREATE '+(tr.constraint?'CONSTRAINT ':'')+'TRIGGER '+tr.name+' (?:BEFORE|AFTER|INSTEAD OF) ').test(tr.definition)
     ||!tr.definition.includes(' ON '+t.name+' ')||!tr.definition.endsWith(' EXECUTE FUNCTION '+tr.function)
     ||tr.initiallyDeferred&&!tr.deferrable||!tr.constraint&&(tr.deferrable||tr.initiallyDeferred))fail();
   }
  }
  const permitted=(grants,allowed)=>{if(grants.some(g=>!allowed.includes(g.privilege)))fail();};
  for(const t of c.tables){permitted(t.acl,['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']);for(const col of t.columnAcl)permitted(col.acl,['SELECT','INSERT','UPDATE','REFERENCES']);}
  for(const f of c.functions)permitted(f.acl,['EXECUTE']);
  for(const s of c.schemas)permitted(s.acl,['USAGE','CREATE']);
  const defaultsAllowed={r:['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'],S:['USAGE','SELECT','UPDATE'],f:['EXECUTE'],T:['USAGE'],n:['USAGE','CREATE']};
  for(const d of c.defaultPrivileges)permitted(d.acl,defaultsAllowed[d.objectType]);
  return c;
 }catch{fail();}
}
export function comparePg16(expected,observed){
 if(process.env.NODE_ENV!=='test')throw Error('PG16 schema validator is test-only');
 try{return canonical(normalizePg16(expected))===canonical(normalizePg16(observed));}catch{return false;}
}
