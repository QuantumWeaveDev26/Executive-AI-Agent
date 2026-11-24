// Bounded source grammar: consumes every structural token; expressions/bodies are retained opaque.
// This is not a PostgreSQL parser, semantic-equivalence engine or execution adapter.
const fail=()=>{const e=Error('UNSUPPORTED_DDL_SYNTAX');e.code='unsupported-ddl-syntax';throw e;};
export function assertSupportedDdl(t,{qname,parens,id}){
 const w=(i)=>t[i]?.word,done=i=>{if(i!==t.length)fail();},named=i=>qname(t,i).next;
 const commaNames=part=>{if(!part.length)fail();for(let i=0;i<part.length;i++)if(i%2===0)id(part[i]);else if(part[i].word!==',')fail();if(part.length%2!==1)fail();};
 const grouped=i=>parens(t,i).next;
 const options=new Set(['language','as','security','immutable','stable','volatile','strict','called','returns','parallel','cost','rows','set','leakproof','not']);
 function type(a,i){
  const start=i,word=a[i]?.word;if(!word)fail();
  if(['public','platform'].includes(word)&&a[i+1]?.word==='.'){id(a[i+2]);return i+3;}
  if(word==='pg_catalog'&&a[i+1]?.word==='.'){i+=2;}
  const n=a[i]?.word;
  if(!['uuid','text','jsonb','json','smallint','int2','integer','int','int4','bigint','int8','boolean','bool','numeric','decimal','double','real','float4','float8','bytea','timestamp','timestamptz','date','time','interval','varchar','character','void','record','trigger','name','oid','"char"'].includes(n))fail();i++;
  if(n==='double'){if(a[i++]?.word!=='precision')fail();}
  if(n==='character'&&a[i]?.word==='varying')i++;
  if(a[i]?.word==='('){let d=1;i++;while(i<a.length&&d){if(a[i].word==='(')d++;if(a[i].word===')')d--;i++;}if(d)fail();}
  if(['timestamp','time'].includes(n)&&['with','without'].includes(a[i]?.word)){i++;if(a[i++]?.word!=='time'||a[i++]?.word!=='zone')fail();}
  while(a[i]?.word==='['){if(a[i+1]?.word!==']')fail();i+=2;}
  if(i===start)fail();return i;
 }
 function constraint(a,i=0,inline=false){
  const aw=j=>a[j]?.word,p=j=>{let d=1,k=j+1;if(aw(j)!=='(')fail();for(;k<a.length;k++){if(aw(k)==='(')d++;if(aw(k)===')'&&!--d)break;}if(d)fail();return k+1;};
  if(aw(i)==='constraint'){id(a[i+1]);i+=2;}
  if(aw(i)==='primary'){if(aw(i+1)!=='key')fail();i+=2;if(!inline){const end=p(i);commaNames(a.slice(i+1,end-1));i=end;}}
  else if(aw(i)==='unique'){i++;if(!inline){const end=p(i);commaNames(a.slice(i+1,end-1));i=end;}}
  else if(aw(i)==='check')i=p(i+1);
  else if(aw(i)==='foreign'){if(inline||aw(i+1)!=='key')fail();i=p(i+2);if(aw(i)!=='references')fail();}
  else if(aw(i)!=='references')fail();
  if(aw(i)==='references'){
   i=qname(a,i+1).next;if(aw(i)==='('){const end=p(i);commaNames(a.slice(i+1,end-1));i=end;}
   while(aw(i)==='on'){
    if(!['update','delete'].includes(aw(i+1)))fail();i+=2;
    if(['cascade','restrict'].includes(aw(i)))i++;
    else if(aw(i)==='no'&&aw(i+1)==='action')i+=2;
    else if(aw(i)==='set'&&['null','default'].includes(aw(i+1)))i+=2;else fail();
   }
  }
  if(aw(i)==='not'&&aw(i+1)==='deferrable')i+=2;else if(aw(i)==='deferrable')i++;
  if(aw(i)==='initially'){if(!['deferred','immediate'].includes(aw(i+1)))fail();i+=2;}
  return i;
 }
 function column(a){
  id(a[0]);let i=type(a,1);
  while(i<a.length){
   const v=a[i].word;
   if(v==='not'&&a[i+1]?.word==='null'){i+=2;continue;}if(v==='null'){i++;continue;}
   if(v==='collate'){i=qname(a,i+1).next;continue;}
   if(v==='default'){
    let depth=0,start=++i;
    while(i<a.length){const x=a[i].word;if(!depth&&(['constraint','primary','unique','check','references','collate'].includes(x)||(x==='not'&&a[i+1]?.word==='null')))break;if(['(','['].includes(x))depth++;if([')',']'].includes(x))depth--;i++;}if(i===start||depth)fail();continue;
   }
   if(['constraint','primary','unique','check','references'].includes(v)){i=constraint(a,i,true);continue;}fail();
  }
 }
 const split=part=>{const result=[];let depth=0,start=0;for(let i=0;i<part.length;i++){if(['(','['].includes(part[i].word))depth++;if([')',']'].includes(part[i].word))depth--;if(!depth&&part[i].word===','){result.push(part.slice(start,i));start=i+1;}}result.push(part.slice(start));if(result.some(p=>!p.length))fail();return result;};
 if(w(0)==='create'&&w(1)==='table'){
  let at=2;if(w(at)==='if'){if(w(at+1)!=='not'||w(at+2)!=='exists')fail();at+=3;}
  at=named(at);const p=parens(t,at);done(p.next);
  for(const part of split(p.inside)){if(['constraint','primary','unique','check','foreign'].includes(part[0].word)){if(constraint(part)!==part.length)fail();}else column(part);}return;
 }
 if(w(0)==='alter'&&w(1)==='table'){
  const at=named(2);for(const a of split(t.slice(at))){
   const aw=a.map(x=>x.word),s=aw.join(' ');
   if(['enable row level security','force row level security'].includes(s))continue;
   if(aw[0]==='owner'&&aw[1]==='to'){if(a.length!==3)fail();id(a[2]);continue;}
   if(aw[0]==='add'&&aw[1]==='column'){let start=2;if(aw[2]==='if'){if(aw[3]!=='not'||aw[4]!=='exists')fail();start=5;}column(a.slice(start));continue;}
   if(aw[0]==='drop'&&aw[1]==='constraint'){let n=2;if(aw[2]==='if'){if(aw[3]!=='exists')fail();n=4;}if(a.length!==n+1)fail();id(a[n]);continue;}
   if(aw[0]==='add'&&aw[1]==='constraint'){if(constraint(a,1)!==a.length)fail();continue;}
   if(aw[0]==='alter'&&aw[1]==='column'){
    id(a[2]);const action=aw.slice(3).join(' ');if(['set not null','drop not null','drop default'].includes(action))continue;
    if(aw[3]==='set'&&aw[4]==='default'&&a.length>5)continue;fail();
   }fail();
  }return;
 }
 if(w(0)==='create'&&(w(1)==='function'||(w(1)==='or'&&w(2)==='replace'&&w(3)==='function'))){
  const at=named(w(1)==='function'?2:4),args=parens(t,at);let i=args.next,body=false,language=false,returns=false;
  const argumentTypes=[];
  for(const arg of (args.inside.length?split(args.inside):[])){
   let offset=0,mode='in';if(['in','out','inout','variadic'].includes(arg[0]?.word)){mode=arg[0].word;offset++;}
   let end=-1,start=offset;
   try{end=type(arg,start);if(end<arg.length&&!['default','='].includes(arg[end].word))end=-1;}catch{end=-1;}
   if(end<0){id(arg[offset]);start=offset+1;end=type(arg,start);}
   if(end<arg.length&&(!['default','='].includes(arg[end].word)||end+1===arg.length))fail();
   if(mode!=='out')argumentTypes.push(arg.slice(start,end));
  }
  if(w(i)==='returns'){
   returns=true;i++;
   if(w(i)==='table'){const p=parens(t,i+1);for(const col of split(p.inside)){id(col[0]);if(type(col,1)!==col.length)fail();}i=p.next;}
   else {if(w(i)==='setof')i++;i=type(t,i);}
  }
  if(!returns&&!args.inside.some(x=>['out','inout'].includes(x.word)))fail();
  while(i<t.length){
   const v=w(i++);
   if(v==='language'){if(language||!['sql','plpgsql'].includes(w(i)))fail();language=true;i++;}
   else if(v==='as'){if(body||!t[i]||!(/^(?:\$|')/.test(t[i].value)))fail();body=true;i++;}
   else if(v==='security'){if(!['definer','invoker'].includes(w(i++)))fail();}
   else if(['immutable','stable','volatile','strict','leakproof'].includes(v)){}
   else if(v==='not'&&w(i)==='leakproof')i++;
   else if(v==='parallel'){if(!['safe','unsafe','restricted'].includes(w(i++)))fail();}
   else if(['cost','rows'].includes(v)){if(!/^\d+$/.test(t[i++]?.value??''))fail();}
   else if(v==='called'){if(t.slice(i,i+3).map(x=>x.word).join(' ')!=='on null input')fail();i+=3;}
   else if(v==='set'){
    id(t[i++]);if(!['=','to'].includes(w(i++)))fail();const start=i;
    while(i<t.length&&!options.has(w(i))){if(w(i)!==','&&!/^(?:[a-z_][a-z0-9_]*|'[^']*')$/i.test(t[i].value))fail();i++;}if(i===start)fail();
   }else fail();
  }
  if(!body||!language)fail();return {argumentTypes};
 }
 if(['alter','drop'].includes(w(0))&&w(1)==='function'){
  let at=2;if(w(at)==='if'){if(w(at+1)!=='exists')fail();at+=2;}at=grouped(named(at));
  if(w(0)==='drop'){done(at);return;}if(w(at)!=='owner'||w(at+1)!=='to')fail();id(t[at+2]);done(at+3);return;
 }
 if(['create','alter','drop'].includes(w(0))&&w(1)==='policy'){
  let at=2;if(w(at)==='if'){if(w(at+1)!=='exists')fail();at+=2;}id(t[at++]);if(w(at++)!=='on')fail();at=named(at);
  if(w(0)==='drop'){done(at);return;}let last=0;
  while(at<t.length){const v=w(at++),rank={as:1,for:2,to:3,using:4,with:5}[v];if(!rank||rank<=last||(w(0)==='alter'&&rank<3))fail();last=rank;
   if(v==='as'){if(!['permissive','restrictive'].includes(w(at++)))fail();}
   if(v==='for'){if(!['all','select','insert','update','delete'].includes(w(at++)))fail();}
   if(v==='to'){let count=0;while(at<t.length&&!['using','with'].includes(w(at))){id(t[at++]);count++;if(at<t.length&&!['using','with'].includes(w(at))){if(w(at++)!==',')fail();}}if(!count)fail();}
   if(v==='using')at=grouped(at);if(v==='with'){if(w(at++)!=='check')fail();at=grouped(at);}
  }done(at);return;
 }
 if(w(0)==='create'&&(w(1)==='index'||(w(1)==='unique'&&w(2)==='index'))){
  let at=w(1)==='index'?2:3;if(w(at)==='if'){if(w(at+1)!=='not'||w(at+2)!=='exists')fail();at+=3;}at=named(at);if(w(at++)!=='on')fail();at=named(at);
  if(w(at)==='using'){id(t[at+1]);at+=2;}at=grouped(at);
  if(w(at)==='include')at=grouped(at+1);
  if(w(at)==='where'){if(at+1>=t.length)fail();return;}done(at);return;
 }
 if(w(0)==='create'&&(w(1)==='trigger'||(w(1)==='constraint'&&w(2)==='trigger'))){
  let at=w(1)==='trigger'?2:3;id(t[at++]);if(!['before','after'].includes(w(at++)))fail();
  while(true){const event=w(at++);if(!['insert','update','delete','truncate'].includes(event))fail();if(event==='update'&&w(at)==='of'){const start=++at;while(at<t.length&&!['or','on'].includes(w(at)))at++;commaNames(t.slice(start,at));}if(w(at)!=='or')break;at++;}
  if(w(at++)!=='on')fail();at=named(at);if(w(at)==='from')at=named(at+1);
  if(w(at)==='not'&&w(at+1)==='deferrable')at+=2;else if(w(at)==='deferrable')at++;
  if(w(at)==='initially'){if(!['deferred','immediate'].includes(w(at+1)))fail();at+=2;}
  if(w(at)==='for'){at++;if(w(at)==='each')at++;if(!['row','statement'].includes(w(at++)))fail();}
  if(w(at)==='when')at=grouped(at+1);
  if(w(at++)!=='execute'||!['function','procedure'].includes(w(at++)))fail();at=named(at);const args=parens(t,at);for(const part of split(args.inside.length?args.inside:[{word:"''",value:"''"}]))if(part.length!==1||!part[0].value.startsWith("'"))fail();done(args.next);return;
 }
 if(w(0)==='drop'&&w(1)==='trigger'){let at=2;if(w(at)==='if'){if(w(at+1)!=='exists')fail();at+=2;}id(t[at++]);if(w(at++)!=='on')fail();done(named(at));return;}
 if(w(0)==='create'&&w(1)==='schema'){let at=2;if(w(at)==='if'){if(w(at+1)!=='not'||w(at+2)!=='exists')fail();at+=3;}id(t[at++]);if(w(at)==='authorization'){id(t[at+1]);at+=2;}done(at);return;}
 if(w(0)==='alter'&&w(1)==='schema'){id(t[2]);if(w(3)!=='owner'||w(4)!=='to')fail();id(t[5]);done(6);return;}
 if(w(0)==='create'&&w(1)==='role'){id(t[2]);let at=3;if(w(at)==='with')at++;const flags=new Set(['login','nologin','inherit','noinherit','superuser','nosuperuser','bypassrls','nobypassrls','createdb','nocreatedb','createrole','nocreaterole','replication','noreplication']);while(at<t.length)if(!flags.has(w(at++)))fail();return;}
 if(['begin','commit'].includes(w(0))){done(1);return;}
 if(w(0)==='set'){if(w(1)!=='local'||!['lock_timeout','statement_timeout','search_path'].includes(w(2))||!['=','to'].includes(w(3)))fail();if(w(2)!=='search_path'){if(!t[4]?.value.startsWith("'"))fail();done(5);}else commaNames(t.slice(4));return;}
 fail();
}
