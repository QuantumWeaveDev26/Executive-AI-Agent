// PG16 source syntax model only; no SQL execution or approved ACL/grantor evidence.
const deny=()=>{const e=Error('SOURCE_ACL_DENIED');e.code='unsupported-acl-syntax';throw e;};
const rights={table:['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'],function:['EXECUTE'],schema:['USAGE','CREATE'],sequence:['USAGE','SELECT','UPDATE']};
export function parseSourceAcl(t,{qname,parens,id,identity}){
 if(process.env.NODE_ENV!=='test')throw Error('ACL model is test-only');
 const w=i=>t[i]?.word;let i=0,scope='object',creatorRoles=[],schemas=[];
 const list=stop=>{const out=[];while(i<t.length){if(stop?.(w(i)))break;if(t[i]?.value.startsWith('"')&&id(t[i]).toUpperCase()==='PUBLIC')deny();out.push(w(i)==='public'?'PUBLIC':id(t[i]));i++;if(w(i)!==',')break;i++;}if(!out.length||new Set(out).size!==out.length)deny();return out;};
 if(w(i)==='alter'){
  if(w(++i)!=='default'||w(++i)!=='privileges')deny();i++;scope='default';
  if(w(i)==='for'){i++;if(!['role','user'].includes(w(i++)))deny();creatorRoles=list(x=>x==='in'||x==='grant'||x==='revoke');}else creatorRoles=['postgres'];
  if(w(i)==='in'){i++;if(w(i++)!=='schema')deny();schemas=list(x=>x==='grant'||x==='revoke').map(x=>x==='PUBLIC'?'public':x);}
 }
 const action=w(i++);if(!['grant','revoke'].includes(action))deny();let grantOptionOnly=false;
 if(action==='revoke'&&w(i)==='grant'){if(w(i+1)!=='option'||w(i+2)!=='for')deny();i+=3;grantOptionOnly=true;}
 const privileges=[];
 while(i<t.length&&w(i)!=='on'){
  const privilege=w(i++)?.toUpperCase();if(!privilege||(!Object.values(rights).flat().includes(privilege)&&privilege!=='ALL'))deny();
  if(privilege==='ALL'&&w(i)==='privileges')i++;
  let columns=[];if(w(i)==='('){const p=parens(t,i);let a=0;while(a<p.inside.length){columns.push(id(p.inside[a++]));if(a<p.inside.length&&p.inside[a++].word!==',')deny();}if(!columns.length||new Set(columns).size!==columns.length)deny();i=p.next;}
  privileges.push({privilege,columns});if(w(i)!==',')break;i++;
 }
 if(!privileges.length||w(i++)!=='on'||new Set(privileges.map(p=>p.privilege)).size!==privileges.length)deny();
 let objectKind='table',objects=[],allInSchemas=[];const kinds={table:'table',tables:'table',function:'function',functions:'function',schema:'schema',sequence:'sequence',sequences:'sequence'};
 if(scope==='object'&&w(i)==='all'){
  i++;if(!['tables','functions','sequences'].includes(w(i)))deny();objectKind=kinds[w(i++)];
  if(w(i++)!=='in'||w(i++)!=='schema')deny();allInSchemas=list(x=>x==='to'||x==='from').map(x=>x==='PUBLIC'?'public':x);
 }
 if(kinds[w(i)])objectKind=kinds[w(i++)];
 if(scope==='default'){if(!['tables','functions','sequences'].includes(t[i-1]?.word))deny();}
 else if(!allInSchemas.length)while(i<t.length){
  if(objectKind==='schema')objects.push(id(t[i++]));else{const n=qname(t,i);i=n.next;let name=n.value;if(objectKind==='function'){const p=parens(t,i),args=identity(p.inside,false);if(args&&args.split(',').some(x=>! /^(?:uuid|text|boolean|integer|bigint|smallint|numeric|jsonb|json|bytea|timestamp with time zone|timestamp without time zone)(?:\[\])?$/.test(x)))deny();name+='('+args+')';i=p.next;}objects.push(name);}
  if(w(i)!==',')break;i++;
 }
 if(w(i++)!==(action==='grant'?'to':'from'))deny();const grantees=list();let grantOption=false;
 if(action==='grant'&&w(i)==='with'){if(w(i+1)!=='grant'||w(i+2)!=='option')deny();i+=3;grantOption=true;}
 if(action==='revoke'&&w(i)==='restrict')i++;
 if(i!==t.length||(!objects.length&&!allInSchemas.length&&scope==='object')||new Set(objects).size!==objects.length)deny();
 for(const p of privileges){if(p.privilege!=='ALL'&&!rights[objectKind]?.includes(p.privilege))deny();if(p.columns.length&&(scope==='default'||objectKind!=='table'||!['SELECT','INSERT','UPDATE','REFERENCES'].includes(p.privilege)))deny();}
 if(privileges.some(p=>p.privilege==='ALL')&&privileges.length!==1)deny();if(grantOption&&grantees.includes('PUBLIC'))deny();
 return {scope,action,objectKind,objects,allInSchemas,privileges,grantees,grantOption,grantOptionOnly,creatorRoles,schemas,...(scope==='default'?{defaultSemantics:schemas.length?'schema-additive-only':'global'}:{}),verified:false};
}

// Local PG16 ACL fold under explicit pristine-default/superuser assumptions. Never a runtime approval.
export function createSourceAclState({pg16PublicNamespace=false,collectionModeledUnderExternalAbsence=false}={}){
 if(process.env.NODE_ENV!=='test')throw Error('ACL state is test-only');
 if(typeof pg16PublicNamespace!=='boolean'||typeof collectionModeledUnderExternalAbsence!=='boolean')deny();
 const externalDependencies=pg16PublicNamespace?[{schema:'public',owner:'pg_database_owner',publicUsage:true,reference:'PostgreSQL16 pg_namespace.dat and initdb.c',verified:false}]:[];
 const objects=new Map(),defaults=new Map(),ownershipTransfers=[];
 // Context covers public and explicitly source-created namespaces, never PostgreSQL built-ins.
 const completeCollections=new Set(collectionModeledUnderExternalAbsence?['public']:[]);
 const key=(kind,name)=>kind+':'+name;
 const tupleKey=x=>JSON.stringify([x.grantor,x.grantee,x.privilege,x.column]);
 const builtin=(kind,owner)=>[...rights[kind].map(privilege=>({grantor:owner,grantee:owner,privilege,column:null,grantOption:false})),...(kind==='function'?[{grantor:owner,grantee:'PUBLIC',privilege:'EXECUTE',column:null,grantOption:false}]:[])];
 const compare=(a,b)=>a<b?-1:a>b?1:0;
 const sorted=acl=>[...acl.values()].map(x=>({...x})).sort((a,b)=>compare(tupleKey(a),tupleKey(b)));
 const update=(acl,e,grantor)=>{
  for(const requested of e.privileges)for(const privilege of requested.privilege==='ALL'?rights[e.objectKind]:[requested.privilege]){
   const matchingColumns=e.action==='revoke'&&e.objectKind==='table'&&!requested.columns.length?[...new Set([...acl.values()].filter(x=>x.grantor===grantor&&x.privilege===privilege&&e.grantees.includes(x.grantee)&&x.column!==null).map(x=>x.column))]:[];
   for(const column of requested.columns.length?requested.columns:[null,...matchingColumns])for(const grantee of e.grantees){
   const row={grantor,grantee,privilege,column,grantOption:e.grantOption===true},k=tupleKey(row),previous=acl.get(k);
   if(e.action==='grant')acl.set(k,{...row,grantOption:row.grantOption||previous?.grantOption===true});
   else if(e.grantOptionOnly){if(previous)acl.set(k,{...previous,grantOption:false});}else acl.delete(k);
   }
  }
 };
 const defaultKey=(role,schema,kind)=>JSON.stringify([role,schema,kind]);
 const api={
  create(kind,name,owner,{replace=false,columns=null}={}){
   if(!rights[kind]||typeof name!=='string'||!name||typeof owner!=='string'||!owner)deny();
   const k=key(kind,name),existing=objects.get(k);if(existing){if(!replace)deny();return;}
   const schema=kind==='schema'?null:name.split('.')[0],global=defaults.get(defaultKey(owner,null,kind));
   const acl=new Map((global?[...global.values()]:builtin(kind,owner)).map(x=>[tupleKey(x),{...x}]));
   const local=defaults.get(defaultKey(owner,schema,kind));if(local)for(const x of local.values()){const prior=acl.get(tupleKey(x));acl.set(tupleKey(x),{...x,grantOption:x.grantOption||prior?.grantOption===true});}
   objects.set(k,{kind,name,owner,schema,columns:columns===null?null:[...columns],acl,ownershipBlocked:false});
   if(collectionModeledUnderExternalAbsence&&kind==='schema'&&name!=='information_schema'&&!name.startsWith('pg_'))completeCollections.add(name);
  },
  setColumns(name,columns){const o=objects.get(key('table',name));if(o)o.columns=[...columns];},
  checkpoint(){return structuredClone({objects:[...objects],defaults:[...defaults],ownershipTransfers,completeCollections:[...completeCollections]});},
  restore(value){objects.clear();defaults.clear();ownershipTransfers.length=0;completeCollections.clear();for(const s of value.completeCollections)completeCollections.add(s);for(const [k,v]of value.objects)objects.set(k,v);for(const [k,v]of value.defaults)defaults.set(k,v);ownershipTransfers.push(...value.ownershipTransfers);},
  drop(kind,name){objects.delete(key(kind,name));},
  transfer(kind,name,owner){
   const o=objects.get(key(kind,name));if(!o)return ['acl-object-dependency-unverified'];if(o.owner===owner)return [];
   const old=o.owner,next=new Map();
   // PG16 aclnewowner: replace old owner wherever grantor/grantee occurs; OR collision rights/options.
   for(const row of o.acl.values()){const updated={...row,grantor:row.grantor===old?owner:row.grantor,grantee:row.grantee===old?owner:row.grantee},k=tupleKey(updated),previous=next.get(k);next.set(k,{...updated,grantOption:updated.grantOption||previous?.grantOption===true});}
   o.acl=next;o.owner=owner;o.ownershipBlocked=false;ownershipTransfers.push({kind,name,oldOwner:old,newOwner:owner,verified:false});return [];
  },
  apply(e){
   if(e.scope==='default'){
    for(const role of e.creatorRoles)for(const schema of e.schemas.length?e.schemas:[null]){
     const k=defaultKey(role,schema,e.objectKind),acl=defaults.get(k)??new Map((schema===null?builtin(e.objectKind,role):[]).map(x=>[tupleKey(x),x]));
     update(acl,e,role);defaults.set(k,acl);
    }return [];
   }
   const selected=e.allInSchemas.length?[...objects.values()].filter(o=>o.kind===e.objectKind&&e.allInSchemas.includes(o.schema)):e.objects.map(n=>objects.get(key(e.objectKind,n)));
   if(selected.some(o=>!o))return ['acl-object-dependency-unverified'];
   if(selected.some(o=>o.ownershipBlocked))return ['ownership-transfer-acl-unverified'];
   if(selected.some(o=>e.privileges.some(p=>p.columns.some(c=>!o.columns?.includes(c)))))return ['acl-column-dependency-unverified'];
   for(const o of selected)update(o.acl,e,o.owner);
   return e.allInSchemas.some(schema=>!completeCollections.has(schema))?['acl-collection-coverage-unverified']:[];
  },
  snapshot(){return {postgresMajor:16,assumptions:['source executor is postgres superuser','pristine initial role default privileges','ALL IN SCHEMA needs complete external-object coverage'],baselineVerified:false,
   ownershipTransfers:structuredClone(ownershipTransfers),externalDependencies:structuredClone(externalDependencies),
   objects:[...objects.values()].map(o=>({kind:o.kind,name:o.name,owner:o.owner,acl:sorted(o.acl),aclVerified:false,ownershipTransferBlocked:o.ownershipBlocked})).sort((a,b)=>compare(key(a.kind,a.name),key(b.kind,b.name))),
   defaultScopes:[...defaults].map(([k,v])=>({scope:JSON.parse(k),acl:sorted(v),verified:false})).sort((a,b)=>compare(JSON.stringify(a.scope),JSON.stringify(b.scope)))};}
 };
 if(pg16PublicNamespace){api.create('schema','public','pg_database_owner');api.apply({scope:'object',action:'grant',objectKind:'schema',objects:['public'],allInSchemas:[],privileges:[{privilege:'USAGE',columns:[]}],grantees:['PUBLIC'],grantOption:false,grantOptionOnly:false});}
 return api;
}
