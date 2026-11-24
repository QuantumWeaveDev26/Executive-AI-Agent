// Bounded source grammar, not a PL/pgSQL interpreter. Unknown bodies remain unresolved.
import {parseSourceAcl} from './phone-schema-acl-effects.mjs';
const deny=()=>{const e=Error('PROCEDURAL_MODEL_DENIED');e.code='procedural-block';throw e;};
export function modelRoleAclBlock(t,{roles,ref,lex,id,qname,parens,identity}){
 if(process.env.NODE_ENV!=='test')throw Error('Procedural model is test-only');
 if(t.length!==2||t[0].word!=='do')deny();const match=t[1].value.match(/^(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)([\s\S]*)\1$/);if(!match)deny();
 const body=match[2],a=lex(body),w=i=>a[i]?.word,copy=new Map(structuredClone([...roles])),created=[],effects=[],conditions=[];let i=0,innerOrdinal=0,groups=0;
 if(w(i++)!=='begin')deny();
 while(w(i)==='if'){
  groups++;i++;const absent=w(i)==='not';if(absent)i++;if(w(i++)!=='exists')deny();const p=parens(a,i);i=p.next;const c=p.inside;let n=0;
  if(c[n++]?.word!=='select')deny();if(c[n]?.word==='1')n++;if(c[n++]?.word!=='from')deny();
  if(c[n]?.word==='pg_catalog'){n++;if(c[n++]?.word!=='.')deny();}if(c[n++]?.word!=='pg_roles'||c[n++]?.word!=='where'||c[n++]?.word!=='rolname'||c[n++]?.word!=='=')deny();
  const literal=c[n++]?.value;if(!literal||!/^'[a-z_][a-z0-9_]*'$/.test(literal)||n!==c.length)deny();const role=literal.slice(1,-1);
  if(w(i++)!=='then')deny();const known=copy.has(role);if(!absent&&!known)deny();const active=absent?!known:known;
  if(absent&&!known)conditions.push({...ref,kind:'initial-role-absence',role,verified:false});
  let statements=0;
  while(w(i)!=='end'){
   const start=i;while(i<a.length&&w(i)!==';')i++;if(i===a.length)deny();const action=a.slice(start,i++);innerOrdinal++;statements++;
   if(action[0]?.word==='create'&&action[1]?.word==='role'){
    if(!absent||id(action[2])!==role)deny();let at=3;if(action[at]?.word==='with')at++;
    const options=action.slice(at).map(x=>x.word);if(!options.length||options.some(x=>!['nologin','nobypassrls','nosuperuser','nocreatedb','nocreaterole','noreplication','noinherit','inherit'].includes(x))||new Set(options).size!==options.length||(options.includes('inherit')&&options.includes('noinherit')))deny();
    if(active){if(copy.has(role))deny();const value={name:role,definition:body.slice(action[0].start,action.at(-1).end)+';',origin:ref,proceduralOrigin:true};copy.set(role,value);created.push(value);}
   }else{
    if(absent)deny();const effect=parseSourceAcl(action,{id,qname,parens,identity});
    if(active)effects.push({...ref,...effect,proceduralOrigin:true,innerOrdinal});
   }
  }
  if(!statements||w(i++)!=='end'||w(i++)!=='if'||w(i++)!==';')deny();
 }
 if(!groups||w(i++)!=='end')deny();if(w(i)===';')i++;if(i!==a.length)deny();
 return {created,effects,conditions,groups};
}

export function modelConditionalConstraint(t,{tables,ref,lex,id,qname,parens,assertSupportedDdl}){
 if(process.env.NODE_ENV!=='test')throw Error('Procedural model is test-only');
 if(t.length!==2||t[0].word!=='do')deny();const m=t[1].value.match(/^(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)([\s\S]*)\1$/);if(!m)deny();
 const body=m[2],a=lex(body),w=i=>a[i]?.word;let i=0;
 if(w(i++)!=='begin'||w(i++)!=='if'||w(i++)!=='not'||w(i++)!=='exists')deny();const p=parens(a,i);i=p.next;
 const c=p.inside;let n=0;if(c[n++]?.word!=='select'||c[n++]?.word!=='1'||c[n++]?.word!=='from')deny();
 if(c[n]?.word==='pg_catalog'){n++;if(c[n++]?.word!=='.')deny();}if(c[n++]?.word!=='pg_constraint'||c[n++]?.word!=='where'||c[n++]?.word!=='conname'||c[n++]?.word!=='=')deny();
 const v=c[n++]?.value;if(!v||!/^'[a-z_][a-z0-9_]*'$/.test(v)||n!==c.length||w(i++)!=='then')deny();const name=v.slice(1,-1),start=i;
 while(i<a.length&&w(i)!==';')i++;const action=a.slice(start,i++);if(action[0]?.word!=='alter'||action[1]?.word!=='table')deny();
 const target=qname(action,2),at=target.next;if(action[at]?.word!=='add'||action[at+1]?.word!=='constraint'||id(action[at+2])!==name)deny();
 assertSupportedDdl(action,{qname,parens,id});
 if(w(i++)!=='end'||w(i++)!=='if'||w(i++)!==';'||w(i++)!=='end')deny();if(w(i)===';')i++;if(i!==a.length)deny();
 const table=tables.get(target.value);if(!table||[...tables.values()].some(t=>t.constraints.some(c=>c.name===name)))deny();
 const definition=body.slice(action[at+1].start,action.at(-1).end);
 return {table:target.value,constraint:{name,definition,origin:ref},created:[],effects:[],groups:1,
  conditions:[{...ref,kind:'global-constraint-name-absence',constraint:name,verified:false},{...ref,kind:'constraint-data-validation',table:target.value,constraint:name,definition,verified:false}]};
}
