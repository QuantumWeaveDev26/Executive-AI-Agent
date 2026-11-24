// Source-pinned LOCAL recipes. Identity pins are NOT review authorization or observed DB evidence.
const pins={
 assert_column:new Set(['9a6ff11fb430c267ca44a7b5b57be13d73d6c7d2710ccc00c60af222d91bf19d','9f686502c5bfa9c8aee776e6e742757e0c7a01514340a83b64b0ebdebfbeb2ad']),
 assert_unique:new Set(['9af6b0eefefd57c6ec229503c404910b950e74ec856d468d04babe21cfdcc19b']),
 assert_fk:new Set(['0cd1ebaa136b4daf4f3ad88eb24deb986b3df6e608d20e88a016c1346f0e0d3a','3c67584419c970637fcd992517f7836ed670687e0cd86466b5e6e7d0ff66e664']),
 assert_check:new Set(['3c9ca72d06568fea8f4e267353f18cbe3a2649f816a5b73bd04c6b1e3dbf5d11']),
 assert_rls:new Set(['4b7f504a6932c31a020ede963f59851f2f70337ac41e249c29448a82bc486a39']),
 assert_trigger:new Set(['6e98421378cad34940e8b1cc21eba5b94544a1c931a7de2e486ab2f0f46a2156'])
};
const deny=(code='helper-argument-unsupported')=>{const e=Error('HELPER_RECIPE_DENIED');e.code=code;throw e;};
const simple=v=>typeof v==='string'&&/^[a-z_][a-z0-9_]*$/.test(v);
function split(t){const r=[];let start=0,depth=0;for(let i=0;i<t.length;i++){if(['(','['].includes(t[i].word))depth++;if([')',']'].includes(t[i].word))depth--;if(!depth&&t[i].word===','){r.push(t.slice(start,i));start=i+1;}}r.push(t.slice(start));return r;}
function literal(t){
 if(t.length===1){const v=t[0].value;if(v.startsWith("'")&&v.endsWith("'"))return v.slice(1,-1).replaceAll("''","'");if(t[0].word==='null')return null;if(['true','false'].includes(t[0].word))return t[0].word==='true';}
 if(t[0]?.word==='array'&&t[1]?.word==='['&&t.at(-1)?.word===']')return split(t.slice(2,-1)).map(literal);
 deny();
}
function typeName(column,lex){
 const t=lex(column.declaration);let i=1;if(t[i]?.word==='pg_catalog'&&t[i+1]?.word==='.')i+=2;const n=t[i]?.word;
 const names={uuid:'uuid',text:'text',jsonb:'jsonb',json:'json',integer:'int4',int:'int4',int4:'int4',bigint:'int8',int8:'int8',smallint:'int2',int2:'int2',numeric:'numeric',decimal:'numeric',boolean:'bool',bool:'bool',timestamptz:'timestamptz',timestamp:t[i+1]?.word==='with'?'timestamptz':'timestamp'};
 if(!names[n])deny('helper-type-unsupported');return names[n];
}
export function applyPinnedHelper({t,ref,temporaryFunctions,tables,triggers,requiredPreconditions,lex,qname,parens,id}){
 if(process.env.NODE_ENV!=='test')throw Error('Helper recipes are test-only');
 const n=qname(t,1),name=n.value.slice('pg_temp.'.length),p=parens(t,n.next);
 if(!n.value.startsWith('pg_temp.')||!Object.hasOwn(pins,name)||p.next!==t.length)deny('invoked-helper-effects');
 const definitions=[...temporaryFunctions.values()].filter(f=>f.signature.startsWith(n.value+'('));
 if(definitions.length!==1||!pins[name].has(definitions[0].origin.sha256))deny('helper-body-not-pinned');
 const args=split(p.inside).map(literal),tableName=args[0];if(!simple(tableName))deny();const table=tables.get('public.'+tableName);if(!table)deny('helper-table-missing');
 const condition=(kind,data={})=>requiredPreconditions.push({...ref,kind,table:table.name,helper:name,helperDefinitionSha256:definitions[0].origin.sha256,...data});
 const cols=values=>{if(!Array.isArray(values)||!values.length||values.some(v=>!simple(v))||new Set(values).size!==values.length)deny();for(const col of values)if(!table.columns.some(c=>c.name===col))deny('helper-column-missing');return values;};
 const keyCols=(tokens,start)=>{const part=parens(tokens,start);return {columns:split(part.inside).map(x=>{if(x.length!==1)deny();return id(x[0]);}),next:part.next};};
 const describe=(definition,label,inlineColumn=null)=>{
  const a=lex(definition);let i=inlineColumn?1:0,explicitName=label;
  // Inspect only outer declaration tokens: nested expressions do not become constraint keywords.
  if(inlineColumn){let depth=0,found=-1;for(let j=1;j<a.length;j++){if(['(','['].includes(a[j].word))depth++;if([')',']'].includes(a[j].word))depth--;if(!depth&&['constraint','primary','unique','references'].includes(a[j].word)){found=j;break;}}if(found<0)return null;i=found;}
  if(a[i]?.word==='constraint'){explicitName=id(a[i+1]);i+=2;}
  let kind,columns,next;
  if(a[i]?.word==='primary'&&a[i+1]?.word==='key'){kind='p';next=i+2;}
  else if(a[i]?.word==='unique'){kind='u';next=i+1;}
  else if(a[i]?.word==='check')return {kind:'c',name:explicitName,inline:!!inlineColumn};
  else if(a[i]?.word==='foreign'&&a[i+1]?.word==='key'){kind='f';next=i+2;}
  else if(a[i]?.word==='references'){kind='f';next=i;}
  else return null;
  if(inlineColumn)columns=[inlineColumn];else{const c=keyCols(a,next);columns=c.columns;next=c.next;}
  if(kind!=='f')return {kind,columns,name:explicitName,inline:!!inlineColumn};
  if(a[next]?.word!=='references')deny();const target=qname(a,next+1);next=target.next;let targetColumns=null;
  if(a[next]?.word==='('){const c=keyCols(a,next);targetColumns=c.columns;next=c.next;}
  let deleteAction='a';for(let j=next;j<a.length;j++)if(a[j].word==='on'&&a[j+1]?.word==='delete'){
   deleteAction={restrict:'r',cascade:'c',no:'a',set:a[j+3]?.word==='null'?'n':'d'}[a[j+2]?.word];if(!deleteAction)deny();
  }
  return {kind,columns,name:explicitName,target:target.value,targetColumns,deleteAction,inline:!!inlineColumn};
 };
 const descriptors=()=>[...table.constraints.map(c=>describe(c.definition,c.name)),...table.columns.map(c=>describe(c.declaration,'column:'+c.name,c.name))].filter(Boolean);
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const replace=(constraintName,definition)=>{
  const previous=descriptors().find(d=>d.name===constraintName);if(previous?.inline)deny('helper-inline-constraint-rewrite');
  if(previous)condition('no-dependent-object-replacement',{constraint:constraintName});else condition('constraint-name-available-in-catalog',{constraint:constraintName});
  table.constraints=table.constraints.filter(c=>c.name!==constraintName);table.constraints.push({name:constraintName,definition,recipeGenerated:true,origin:ref});
 };
 if(name==='assert_rls'){
  if(args.length!==1)deny();table.rls=true;table.forceRls=true;
 }else if(name==='assert_column'){
  if(![4,5].includes(args.length)||!simple(args[1])||!['uuid','text','int4','jsonb','timestamptz','numeric','bool'].includes(args[2])||typeof args[3]!=='boolean'||(args[4]!==undefined&&args[4]!==null&&typeof args[4]!=='string'))deny();
  let col=table.columns.find(c=>c.name===args[1]);const suppliedDefault=args[4]??null;
  if(!col){
   if(suppliedDefault===null)deny('helper-missing-required-column');if(lex(suppliedDefault).some(x=>x.word===';'))deny();
   col={name:args[1],declaration:`${args[1]} ${args[2]} DEFAULT ${suppliedDefault}${args[3]?' NOT NULL':''}`,notNull:args[3],default:suppliedDefault,recipeGenerated:true};table.columns.push(col);
   if(args[3])condition('default-expression-compatible-with-not-null',{column:col.name,expression:suppliedDefault});
  }else{
   if(typeName(col,lex)!==args[2])deny('helper-column-type-mismatch');
   const primary=descriptors().some(d=>d.kind==='p'&&d.columns.includes(col.name));
   if(args[3]&&!col.notNull){if(!primary)condition('no-null-values',{column:col.name});col.notNull=true;}
  }
 }else if(name==='assert_unique'){
  if(args.length!==3||!simple(args[1]))deny();const columns=cols(args[2]);
  if(!descriptors().some(d=>['p','u'].includes(d.kind)&&same(d.columns,columns))){
   if(descriptors().some(d=>d.name===args[1]))deny('helper-constraint-name-conflict');condition('no-duplicate-key-groups',{columns,nullsGroupedTogether:true});replace(args[1],`CONSTRAINT ${args[1]} UNIQUE (${columns.join(', ')})`);
  }
 }else if(name==='assert_fk'){
  if(![5,6].includes(args.length)||!simple(args[1])||!simple(args[3]))deny();const columns=cols(args[2]),target=tables.get('public.'+args[3]),targetColumns=args[4],action=args[5]??'r';
  if(!target||!Array.isArray(targetColumns)||targetColumns.length!==columns.length||targetColumns.some(c=>!simple(c)||!target.columns.some(x=>x.name===c))||!['a','r','c','n','d'].includes(action))deny();
  const fks=descriptors().filter(d=>d.kind==='f');if(fks.some(d=>same(d.columns,columns)&&d.targetColumns===null))deny('helper-implicit-fk-target');
  if(!fks.some(d=>same(d.columns,columns)&&d.target==='public.'+args[3]&&same(d.targetColumns,targetColumns)&&d.deleteAction===action)){
   condition('no-orphan-key-rows',{columns,target:target.name,targetColumns,predicate:'any-non-null-source-component-and-no-target'});
   // Exact pinned helper body always emits RESTRICT; it does NOT interpolate p_deltype here.
   replace(args[1],`CONSTRAINT ${args[1]} FOREIGN KEY (${columns.join(', ')}) REFERENCES ${target.name} (${targetColumns.join(', ')}) ON DELETE RESTRICT`);
  }
 }else if(name==='assert_check'){
  if(args.length!==3||!simple(args[1])||typeof args[2]!=='string'||!args[2]||lex(args[2]).some(x=>x.word===';'))deny();
  if(!descriptors().some(d=>d.kind==='c'&&d.name===args[1])){condition('no-false-expression-rows',{expression:args[2],nullIsViolation:false});replace(args[1],`CONSTRAINT ${args[1]} CHECK (${args[2]})`);}
 }else if(name==='assert_trigger'){
  if(args.length!==3||!simple(args[1])||!simple(args[2]))deny();const tr=triggers.get(table.name+':'+args[1]);if(!tr)deny('helper-trigger-missing');
  const tokens=lex(tr.definition),at=tokens.findIndex(x=>x.word==='execute');if(at<0||qname(tokens,at+2).value.split('.').at(-1)!==args[2])deny('helper-trigger-procedure-mismatch');
 }else deny();
 return {...ref,helper:name,helperDefinitionSha256:definitions[0].origin.sha256,status:'modeled-not-runtime-verified'};
}
