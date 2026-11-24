// Bounded recipe for exact upstream REL_16_15 pgcrypto1.3 sources. No SQL is executed.
import {createHash} from 'node:crypto';
const deny=()=>{throw Error('PGCRYPTO_SOURCE_DENIED');};
const sha=b=>createHash('sha256').update(b).digest('hex');
const sqlSha='84f8eee1d6b03982fac596988b46bf89d5d5d8790d3133783eedad38bc7d8d38';
const controlSha='2a6c81eef34ae6cee9ff5b557f3b6285db7fdd7bc76ee57798e82c945c61c939';
export function derivePgcryptoSourceDeclarations(sqlBytes,controlBytes){
 if(process.env.NODE_ENV!=='test'||!Buffer.isBuffer(sqlBytes)||!Buffer.isBuffer(controlBytes)||sha(sqlBytes)!==sqlSha||sha(controlBytes)!==controlSha)deny();
 const control=controlBytes.toString('utf8');
 const value=k=>{const m=control.match(new RegExp('^'+k+"\\s*=\\s*'([^']+)'\\s*$",'m'));if(!m)deny();return m[1];};
 const flag=k=>{const m=control.match(new RegExp('^'+k+'\\s*=\\s*(true|false)\\s*$','m'));if(!m)deny();return m[1]==='true';};
 const extension={name:'pgcrypto',version:value('default_version'),library:value('module_pathname'),relocatable:flag('relocatable'),trusted:flag('trusted')};
 let text=sqlBytes.toString('utf8').replace(/\/\*[\s\S]*?\*\//g,'').replace(/--[^\r\n]*/g,'');
 text=text.replace(/^\\echo Use "CREATE EXTENSION pgcrypto" to load this file\. \\quit\s*$/m,'').trim();
 const statement=/\s*CREATE FUNCTION\s+([a-z_][a-z0-9_]*)\(([^()]*)\)\s+RETURNS\s+(SETOF\s+record|bytea|text|uuid)\s+AS\s+'MODULE_PATHNAME'\s*,\s*'([a-z_][a-z0-9_]*)'\s+LANGUAGE\s+C\s+([^;]+);/giy;
 const functions=[];let position=0;
 while(position<text.length){
  statement.lastIndex=position;const m=statement.exec(text);if(!m)deny();position=statement.lastIndex;
  const args=m[2].trim()?m[2].split(',').map(s=>s.trim()):[],input=[],declaredArguments=[];
  for(const arg of args){
   const out=arg.match(/^([a-z_][a-z0-9_]*)\s+OUT\s+text$/i);
   if(out){declaredArguments.push({mode:'out',name:out[1],type:'text',source:arg});continue;}
   if(!/^(text(?:\[\])?|bytea|int4)$/i.test(arg))deny();
   const type=arg.toLowerCase()==='int4'?'integer':arg.toLowerCase();input.push(type);declaredArguments.push({mode:'in',name:null,type,source:arg});
  }
  const options=m[5].trim().toUpperCase().split(/\s+/);let strict=false,volatility='v',parallel='u';const seen=new Set();
  for(let i=0;i<options.length;i++){
   const token=options[i],key=['IMMUTABLE','VOLATILE'].includes(token)?'volatility':token;
   if(seen.has(key))deny();seen.add(key);
   if(token==='IMMUTABLE')volatility='i';else if(token==='VOLATILE')volatility='v';
   else if(token==='STRICT')strict=true;else if(token==='PARALLEL'&&options[++i]==='SAFE')parallel='s';else deny();
  }
  functions.push({signature:m[1]+'('+input.join(', ')+')',arguments:declaredArguments,result:m[3].replace(/\s+/g,' '),language:'c',symbol:m[4],library:extension.library,strict,volatility,parallel,securityDefiner:false,leakproof:false});
  if(!text.slice(position).trim())break;
 }
 if(functions.length!==36||new Set(functions.map(f=>f.signature)).size!==36)deny();
 return {format:'pgcrypto-upstream-source-declarations-v1',productionAdmission:false,verified:false,
  source:{tag:'REL_16_15',sqlSha256:sqlSha,controlSha256:controlSha,baseUrl:'https://raw.githubusercontent.com/postgres/postgres/REL_16_15/contrib/pgcrypto/'},
  extension,functions,preconditions:['Independently review upstream source provenance and image/source relationship',
   'Bind installation schema/owner and ordered grants to separately reviewed migration context']};
}
