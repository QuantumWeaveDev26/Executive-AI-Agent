// LOCAL source-effect reducer. Never evaluates SQL/PLpgSQL or claims unresolved effects are final.
import {fingerprint} from './phone-inbound-expected-schema.mjs';
import {sqlStatementEvidence} from './phone-schema-source-evidence.mjs';
import {assertSupportedDdl} from './phone-schema-ddl-grammar.mjs';
import {modelPinnedProcedural} from './phone-schema-procedural-recipes.mjs';
import {modelRoleAclBlock,modelConditionalConstraint} from './phone-schema-procedural-effects.mjs';
import {parseSourceAcl,createSourceAclState} from './phone-schema-acl-effects.mjs';
import {applyPinnedHelper} from './phone-schema-helper-recipes.mjs';
import {readSourceReferenceContext,knownReferenceDataEffect} from './phone-schema-reference-context.mjs';
import {createSourceSessionState} from './phone-schema-session-effects.mjs';
const fail=(reason='unresolved-source-effect')=>{const e=Error('EFFECTIVE_CONTRACT_DENIED');e.code=reason;throw e;};
function lex(text){
 const out=[];let i=0;
 while(i<text.length){
  if(/\s/.test(text[i])){i++;continue;}
  if(text.startsWith('--',i)){const e=text.indexOf('\n',i+2);i=e<0?text.length:e+1;continue;}
  if(text.startsWith('/*',i)){let d=1;i+=2;while(i<text.length&&d){if(text.startsWith('/*',i)){d++;i+=2;}else if(text.startsWith('*/',i)){d--;i+=2;}else i++;}if(d)fail();continue;}
  const start=i,quote=text[i];
  if(quote==="'"||quote==='"'){i++;let closed=false;while(i<text.length){if(text[i]===quote){if(text[i+1]===quote){i+=2;continue;}i++;closed=true;break;}i++;}if(!closed)fail();}
  else if(quote==='$'&&/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(text.slice(i))){const tag=text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)[0],e=text.indexOf(tag,i+tag.length);if(e<0)fail();i=e+tag.length;}
  else if(/[A-Za-z_0-9]/.test(quote)){while(i<text.length&&/[A-Za-z_0-9$]/.test(text[i]))i++;}
  else i++;
  const value=text.slice(start,i);out.push({value,word:value.toLowerCase(),start,end:i});
 }
 return out;
}
const word=(t,i)=>t[i]?.word;
function id(t){if(!t)fail();if(t.value.startsWith('"'))return t.value.slice(1,-1).replaceAll('""','"');if(!/^[a-z_][a-z0-9_$]*$/i.test(t.value))fail();return t.word;}
function qname(t,i){let value=id(t[i++]);if(word(t,i)==='.'){value+='.'+id(t[i+1]);i+=2;}else value='public.'+value;return {value,next:i};}
function parens(t,i){if(word(t,i)!=='(')fail();let d=1,j=i+1;for(;j<t.length;j++){if(word(t,j)==='(')d++;if(word(t,j)===')'&&!--d)break;}if(d)fail();return {inside:t.slice(i+1,j),next:j+1};}
function split(t){const r=[];let start=0,d=0;for(let i=0;i<t.length;i++){if(['(','['].includes(word(t,i)))d++;if([')',']'].includes(word(t,i)))d--;if(word(t,i)===','&&d===0){r.push(t.slice(start,i));start=i+1;}}r.push(t.slice(start));return r.filter(x=>x.length);}
const raw=(source,t)=>t.length?source.slice(t[0].start,t.at(-1).end):'';
function typeText(t){return t.map(x=>x.value.startsWith('"')?x.value:x.value.toLowerCase()).join(' ').replace(/\s*\.\s*/g,'.').replace(/\s*\[\s*\]/g,'[]').replace(/^pg_catalog\./,'').replace(/^timestamptz$/,'timestamp with time zone').replace(/^int(?:4|eger)?$/,'integer').replace(/^int8$/,'bigint').replace(/^bool$/,'boolean');}
function identity(t,declared){
 return split(t).flatMap(arg=>{
  let a=[...arg];if(word(a,0)==='out')return [];if(['in','inout','variadic'].includes(word(a,0)))a.shift();
  const stop=a.findIndex(x=>['default','='].includes(x.word));if(stop>=0)a=a.slice(0,stop);
  if(declared&&a.length>1&&a[0].value!== '"char"'&&!['uuid','text','boolean','bool','integer','int','int4','int8','bigint','smallint','numeric','jsonb','json','timestamp','timestamptz','double','real','bytea','character','varchar','pg_catalog','public'].includes(a[0].word))a.shift();
  return [typeText(a)];
 }).join(',');
}
function top(t){const r=[];let d=0;for(const token of t){if(['(','['].includes(token.word)){d++;continue;}if([')',']'].includes(token.word)){d--;continue;}if(!d)r.push(token);}return r;}
function column(source,t){
 const name=id(t[0]),tt=top(t.slice(1)),di=tt.findIndex(x=>x.word==='default');let def=null;
 if(di>=0){const start=t.indexOf(tt[di])+1;let end=start,depth=0;while(end<t.length){const w=word(t,end);if(depth===0&&(['constraint','check','references','unique','primary','collate'].includes(w)||(w==='not'&&word(t,end+1)==='null')))break;if(['(','['].includes(w))depth++;if([')',']'].includes(w))depth--;end++;}def=raw(source,t.slice(start,end));}
 return {name,declaration:raw(source,t),notNull:tt.some((x,i)=>x.word==='not'&&tt[i+1]?.word==='null')||tt.some((x,i)=>x.word==='primary'&&tt[i+1]?.word==='key'),default:def};
}
function policy(source,t,at){
 const name=id(t[at++]);if(word(t,at++)!=='on')fail();const table=qname(t,at);at=table.next;
 const value={name,table:table.value,command:'all',permissive:true,roles:['PUBLIC'],using:null,check:null,definition:source};
 while(at<t.length&&word(t,at)!==';'){
  const w=word(t,at++);
  if(w==='as'){const mode=word(t,at++);if(!['permissive','restrictive'].includes(mode))fail();value.permissive=mode==='permissive';}
  else if(w==='for'){value.command=word(t,at++);if(!['all','select','insert','update','delete'].includes(value.command))fail();}
  else if(w==='to'){const roles=[];while(at<t.length&&!['using','with',';'].includes(word(t,at))){if(word(t,at)!==',')roles.push(word(t,at)==='public'?'PUBLIC':id(t[at]));at++;}value.roles=roles;}
  else if(w==='using'||w==='with'){if(w==='with'&&word(t,at++)!=='check')fail();const expr=parens(t,at);value[w==='using'?'using':'check']=raw(source,expr.inside);at=expr.next;}
  else fail();
 }
 return value;
}
export function deriveEffectiveContract(sources,options={}){
 if(process.env.NODE_ENV!=='test')throw Error('Effective contract reducer is test-only');
 if(!Array.isArray(sources)||sources.length!==14||new Set(sources.map(x=>x.path)).size!==14)fail();
 const inputs=sources.map(s=>({path:s.path,evidence:sqlStatementEvidence(Buffer.from(s.bytes))}));
 const tables=new Map(),functions=new Map(),policies=new Map(),indexes=new Map(),triggers=new Map(),schemas=new Map(),roles=new Map(),temporaryFunctions=new Map();
 if(Object.keys(options).some(k=>k!=='referenceContext'))fail();
 const context=options.referenceContext===undefined?null:readSourceReferenceContext(options.referenceContext);
 const sessions=context?new Map(inputs.map(i=>[i.path,createSourceSessionState()])):null;
 const aclState=createSourceAclState({pg16PublicNamespace:true,collectionModeledUnderExternalAbsence:context!==null});
 const unresolved=[],aclProgram=[],aclEffects=[],proceduralEffects=[],dataPreconditions=[],lineage=[],requiredPreconditions=[],helperEffects=[];let statementCount=0;
 if(context){
  const sql=context.bootstrap.sql,t=lex(sql).slice(0,-1),n=qname(t,5),parts=parens(t,n.next);
  const columns=split(parts.inside).map(c=>column(sql,c));
  tables.set(n.value,{name:n.value,owner:'postgres',rls:false,forceRls:false,columns,constraints:[],definition:sql,origin:context.bootstrap.source,mutations:[],bootstrapSource:true});
  aclState.create('table',n.value,'postgres',{columns:columns.map(c=>c.name)});
  requiredPreconditions.push({kind:'source-context-bootstrap-and-external-coverage',contextSha256:options.referenceContext.sha256,conditions:context.conditions,verified:false});
  requiredPreconditions.push({kind:'migration-ledger-write-fence-required',object:n.value,reason:'Base0002 grants application writes; separately reviewed and authorized correction required before admission',verified:false});
 }
 for(const input of inputs)for(const statement of input.evidence.statements){
  statementCount++;const source=statement.text,all=lex(source);if(all.at(-1)?.word!==';')fail();const t=all.slice(0,-1),w=t.map(x=>x.word),ref={path:input.path,ordinal:statement.ordinal,sha256:statement.sha256};
  const uncertain=reason=>unresolved.push({...ref,reason});
  const applyAcl=e=>{for(const table of tables.values())aclState.setColumns(table.name,table.columns.map(c=>c.name));const blockers=aclState.apply(e);aclEffects.push({...e,sourceModeled:true,blockers});return blockers;};
  const maps=[tables,functions,policies,indexes,triggers,schemas,roles,temporaryFunctions];
  const saved=['create','alter','drop','select'].includes(w[0])&&!(w[0]==='alter'&&w[1]==='default')?maps.map(m=>structuredClone([...m])):null;
  const aclSaved=saved?aclState.checkpoint():null;
  const preconditionCount=requiredPreconditions.length,helperCount=helperEffects.length;
  try{
   if(w[0]==='do'){let modeled;try{modeled=modelRoleAclBlock(t,{roles,ref,lex,id,qname,parens,identity});}catch{try{modeled=modelConditionalConstraint(t,{tables,ref,lex,id,qname,parens,assertSupportedDdl});}catch{modeled=modelPinnedProcedural({source,ref,t,lex,functions,temporaryFunctions,roles,id,qname,parens,identity});}}if(modeled.constraint)tables.get(modeled.table).constraints.push(modeled.constraint);for(const r of modeled.created)roles.set(r.name,r);const aclBlockers=modeled.effects.flatMap(applyAcl);requiredPreconditions.push(...modeled.conditions);proceduralEffects.push({...ref,kind:modeled.kind??(modeled.constraint?'conditional-constraint':'role-and-acl'),groups:modeled.groups,createdRoles:modeled.created.map(r=>r.name),aclEffects:modeled.effects.length,...(modeled.externalEffects?{externalEffects:modeled.externalEffects}:{}),...(modeled.membershipProgram?{membershipProgram:modeled.membershipProgram}:{})});for(const reason of modeled.unresolvedReasons??[]){
    if(context&&reason==='external-extension-schema-unverified'&&modeled.kind==='conditional-extension'){
     for(const declaration of context.native.functions){const signature='public.'+declaration.signature.replace(/,\s*/g,',');if(functions.has(signature))fail();functions.set(signature,{signature,owner:'postgres',definition:null,origin:ref,mutations:[],nativeSource:true,sourceDeclaration:declaration,dependencySource:context.native.source});aclState.create('function',signature,'postgres');}
     continue;
    }
    if(context&&reason==='conditional-membership-grant-unverified'&&modeled.kind==='managed-roles-and-membership'){
     requiredPreconditions.push({...ref,kind:'superuser-membership-branch',actor:'postgres',expectedBranch:'no GRANT because PostgreSQL16 superuser MEMBER and SET predicates are true',definition:source,verified:false});continue;
    }
    uncertain(reason);
   }if(aclBlockers.length)uncertain('acl-effective-grantor-unverified');continue;}
   if(w[0]==='select'){helperEffects.push(applyPinnedHelper({t,ref,temporaryFunctions,tables,triggers,requiredPreconditions,lex,qname,parens,id}));continue;}
   if(['grant','revoke'].includes(w[0])||(w[0]==='alter'&&w[1]==='default')){const effect=parseSourceAcl(t,{qname,parens,id,identity});aclProgram.push({...ref,definition:source});if(applyAcl({...ref,...effect}).length)uncertain('acl-effective-grantor-unverified');continue;}
   if(['begin','commit','set'].includes(w[0])){assertSupportedDdl(t,{qname,parens,id});if(context&&(['begin','commit'].includes(w[0])||w[2]==='search_path')){const effect=sessions.get(input.path).apply(t,ref);for(const reason of effect.blockers)uncertain(reason);if(effect.kind==='local-search-path')requiredPreconditions.push({...ref,kind:'session-search-path-realization',effect,definition:source,requiredAt:'original-source-position-inside-migration-transaction',verified:false});}else if(w[0]==='set'&&w[2]==='search_path')uncertain('session-search-path-precondition');lineage.push({...ref,kind:'transaction-or-session-control',definition:source});continue;}
   if(['insert','update'].includes(w[0])){dataPreconditions.push({...ref,definition:source});if(context&&knownReferenceDataEffect(ref))requiredPreconditions.push({...ref,kind:'data-effect-runtime-validation',definition:source,requiredAt:'original-source-position',verified:false});else uncertain('data-dependent-precondition');continue;}
   const recognized=assertSupportedDdl(t,{qname,parens,id});
   if(w[0]==='create'&&w[1]==='table'){
    let at=2;if(w[at]==='if'&&w[at+1]==='not'&&w[at+2]==='exists')at+=3;const n=qname(t,at),parts=parens(t,n.next);
    if(tables.has(n.value)){if(w[2]==='if')fail('conditional-object-exists');fail();}
    if(w[2]==='if')requiredPreconditions.push({...ref,kind:'conditional-create-requires-absence',object:n.value});
    const columns=[],constraints=[];for(const [i,c] of split(parts.inside).entries()){
     if(['constraint','primary','unique','check','foreign','exclude'].includes(word(c,0)))constraints.push({name:word(c,0)==='constraint'?id(c[1]):`unresolved-generated-name:${statement.sha256}:${i}`,definition:raw(source,c)});else columns.push(column(source,c));
    }
    tables.set(n.value,{name:n.value,owner:'postgres',rls:false,forceRls:false,columns,constraints,definition:source,origin:ref,mutations:[]});aclState.create('table',n.value,'postgres');continue;
   }
   if(w[0]==='alter'&&w[1]==='table'){
    const n=qname(t,2),table=tables.get(n.value);if(!table)fail();
    for(const a of split(t.slice(n.next).filter(x=>x.word!==';'))){
     const aw=a.map(x=>x.word);
     if(aw.join(' ')==='enable row level security')table.rls=true;
     else if(aw.join(' ')==='force row level security')table.forceRls=true;
     else if(aw[0]==='owner'&&aw[1]==='to'){table.owner=id(a[2]);aclState.transfer('table',n.value,table.owner);}
     else if(aw[0]==='add'&&aw[1]==='column'){
      const start=aw[2]==='if'?5:2,c=column(source,a.slice(start));if(table.columns.some(x=>x.name===c.name)){if(start===5)fail('conditional-object-exists');fail();}else{if(start===5)requiredPreconditions.push({...ref,kind:'conditional-create-requires-absence',object:n.value+'.'+c.name});table.columns.push(c);}
     }else if(aw[0]==='drop'&&aw[1]==='constraint'){
      const at=aw[2]==='if'?4:2,name=id(a[at]),exists=table.constraints.some(x=>x.name===name);if(!exists&&at!==4)fail();table.constraints=table.constraints.filter(x=>x.name!==name);
     }else if(aw[0]==='add'&&aw[1]==='constraint'){
      const name=id(a[2]);if(table.constraints.some(x=>x.name===name))fail();table.constraints.push({name,definition:raw(source,a.slice(1))});
     }else if(aw[0]==='alter'&&aw[1]==='column'){
      const c=table.columns.find(x=>x.name===id(a[2]));if(!c)fail();const action=aw.slice(3).join(' ');
      if(action==='set not null')c.notNull=true;else if(action==='drop not null')c.notNull=false;else if(action==='drop default')c.default=null;else if(aw[3]==='set'&&aw[4]==='default')c.default=raw(source,a.slice(5));else fail();
     }else fail();
    }
    table.mutations.push(ref);continue;
   }
   let createFn=w[0]==='create'&&(w[1]==='function'||(w[1]==='or'&&w[2]==='replace'&&w[3]==='function'));
   if(createFn){const at=w[1]==='or'?4:2,n=qname(t,at),signature=n.value+'('+recognized.argumentTypes.map(typeText).join(',')+')',map=n.value.startsWith('pg_temp.')?temporaryFunctions:functions;
    const old=map.get(signature);if(old&&w[1]!=='or')fail();map.set(signature,{signature,owner:old?.owner??'postgres',definition:source,origin:ref,mutations:old?.mutations??[]});if(map===functions)aclState.create('function',signature,old?.owner??'postgres',{replace:!!old});continue;
   }
   if(['alter','drop'].includes(w[0])&&w[1]==='function'){
    const at=w[2]==='if'?4:2,n=qname(t,at),args=parens(t,n.next),signature=n.value+'('+identity(args.inside,false)+')';
    const map=n.value.startsWith('pg_temp.')?temporaryFunctions:functions;
    if(w[0]==='drop'){if(!map.delete(signature)&&at!==4)fail();if(map===functions)aclState.drop('function',signature);continue;}
    const f=map.get(signature);if(!f||word(t,args.next)!=='owner'||word(t,args.next+1)!=='to')fail();f.owner=id(t[args.next+2]);if(map===functions)aclState.transfer('function',signature,f.owner);f.mutations.push(ref);continue;
   }
   if(w[0]==='create'&&w[1]==='policy'){const p=policy(source,t,2),key=p.table+':'+p.name;if(policies.has(key))fail();policies.set(key,{...p,origin:ref,mutations:[]});continue;}
   if(['drop','alter'].includes(w[0])&&w[1]==='policy'){
    const at=w[2]==='if'?4:2,name=id(t[at]);if(word(t,at+1)!=='on')fail();const n=qname(t,at+2),key=n.value+':'+name;
    if(w[0]==='drop'){if(!policies.delete(key)&&at!==4)fail();continue;}
    const p=policies.get(key);if(!p)fail();const change=policy(source,t,2);for(const field of ['using','check'])if(change[field]!==null)p[field]=change[field];if(w.slice(n.next).includes('to'))p.roles=change.roles;p.mutations.push(ref);continue;
   }
   if(w[0]==='create'&&(w[1]==='index'||(w[1]==='unique'&&w[2]==='index'))){let at=w[1]==='unique'?3:2;const conditional=w[at]==='if';if(conditional)at+=3;const n=qname(t,at);if(word(t,n.next)!=='on')fail();const table=qname(t,n.next+1);const name=word(t,at+1)==='.'?n.value:table.value.slice(0,table.value.indexOf('.'))+'.'+id(t[at]);if(indexes.has(name)){if(conditional)fail('conditional-object-exists');fail();}else{if(conditional)requiredPreconditions.push({...ref,kind:'conditional-create-requires-absence',object:name});indexes.set(name,{name,table:table.value,definition:source,origin:ref});}continue;}
   if(w[0]==='create'&&(w[1]==='trigger'||(w[1]==='constraint'&&w[2]==='trigger'))){const name=id(t[w[1]==='trigger'?2:3]),on=w.indexOf('on'),n=qname(t,on+1),key=n.value+':'+name;if(on<0||triggers.has(key))fail();triggers.set(key,{name,table:n.value,definition:source,origin:ref});continue;}
   if(w[0]==='drop'&&w[1]==='trigger'){const at=w[2]==='if'?4:2,name=id(t[at]);if(word(t,at+1)!=='on')fail();const n=qname(t,at+2);if(!triggers.delete(n.value+':'+name)&&at!==4)fail();continue;}
   if(w[0]==='create'&&w[1]==='schema'){const at=w[2]==='if'?5:2,name=id(t[at]);if(schemas.has(name))fail(w[2]==='if'?'conditional-object-exists':'unresolved-source-effect');if(w[2]==='if')requiredPreconditions.push({...ref,kind:'conditional-create-requires-absence',object:name});schemas.set(name,{name,owner:w[at+1]==='authorization'?id(t[at+2]):'postgres',definition:source,origin:ref});aclState.create('schema',name,schemas.get(name).owner);continue;}
   if(w[0]==='alter'&&w[1]==='schema'&&w[3]==='owner'&&w[4]==='to'){const name=id(t[2]),s=schemas.get(name);if(!s)fail();s.owner=id(t[5]);aclState.transfer('schema',name,s.owner);continue;}
   if(w[0]==='create'&&w[1]==='role'){const name=id(t[2]);if(roles.has(name))fail();roles.set(name,{name,definition:source,origin:ref});continue;}
   uncertain('unsupported-statement');
  }catch(e){if(aclSaved)aclState.restore(aclSaved);if(saved)for(let i=0;i<maps.length;i++){maps[i].clear();for(const [k,v] of saved[i])maps[i].set(k,v);}requiredPreconditions.length=preconditionCount;helperEffects.length=helperCount;uncertain(e.code??'unresolved-source-effect');}
 }
 const sourceSet=inputs.map(x=>({path:x.path,sha256:x.evidence.sha256}));
 if(aclEffects.length)requiredPreconditions.push({kind:'initial-acl-and-grantor-context',sourceSet,actor:'postgres',requiredSuperuser:true,requiredInitialDefaults:'PG16 pristine defaults',verified:false});
 const effectiveAclCandidate=aclState.snapshot();
 requiredPreconditions.push({kind:'source-to-pg16-semantic-realization',sourceSet,postgresMajor:16,verified:false});
 requiredPreconditions.push({kind:'public-namespace-bootstrap-contract',sourceSet,dependency:effectiveAclCandidate.externalDependencies[0],verified:false});
 if(effectiveAclCandidate.ownershipTransfers.length)requiredPreconditions.push({kind:'pg16-ownership-acl-runtime-proof',sourceSet,transfers:effectiveAclCandidate.ownershipTransfers,verified:false});
 const admissionConditions=[...requiredPreconditions.map(condition=>({condition,kind:'precondition'})),...unresolved.map(condition=>({condition,kind:'unresolved-effect'}))].map(x=>({...x,id:fingerprint(x),blocking:true,verified:false}));
 const values=(m,key)=>[...m.values()].sort((a,b)=>a[key]<b[key]?-1:a[key]>b[key]?1:0);
 return {format:'source-effective-contract-v1',status:'UNAPPROVED STATIC EFFECT CANDIDATE',productionAdmission:false,executionAuthorized:false,expectedCatalog:null,staticResolutionComplete:unresolved.length===0&&requiredPreconditions.length===0,staticEffectsOnly:true,...(context?{referenceContext:options.referenceContext}:{}),assumptions:['source execution identity postgres','initial declared source objects absent','unresolved effects can invalidate provisional state'],sources:inputs.map(x=>({path:x.path,sha256:x.evidence.sha256,statements:x.evidence.statements.map(s=>s.sha256)})),statementCount,tables:values(tables,'name'),functions:values(functions,'signature'),policies:values(policies,'table'),indexes:values(indexes,'name'),triggers:values(triggers,'table'),schemas:values(schemas,'name'),roles:values(roles,'name'),temporaryFunctions:values(temporaryFunctions,'signature'),aclProgram,aclEffects,effectiveAclCandidate,admissionConditions,proceduralEffects,dataPreconditions,lineage,requiredPreconditions,helperEffects,unresolved};
}
