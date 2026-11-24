import {createHash} from 'node:crypto';
import type {MigrationFile} from '@thaara/db';
const prefix='packages/db/src/migrations/';
const journalPath='docs/migrations/112-phone-inbound-events.review.sql';
const principalPath='docs/migrations/113-phone-inbound-principals.review.sql';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
/** Database-free exact-set validation. Returns captured, verified SQL, never directory-discovered execution. */
export function loadPinnedInboundFixtureSql(files:Record<string,string>,actualNames:readonly string[],read:(path:string)=>string){
 const paths=Object.keys(files).filter(p=>p.startsWith(prefix)).sort();
 if(paths.length!==12||paths.some(p=>!/^packages\/db\/src\/migrations\/[0-9]{4}_[A-Za-z0-9_]+\.sql$/.test(p)))throw Error('PHONE113_DIAGNOSTIC_BASE_SET_INVALID');
 const names=paths.map(p=>p.slice(prefix.length));
 if(JSON.stringify([...actualNames].filter(n=>n.endsWith('.sql')).sort())!==JSON.stringify(names)
  ||names.some((n,i)=>n.slice(0,4)!==String(i+1).padStart(4,'0')))throw Error('PHONE113_DIAGNOSTIC_BASE_SET_CHANGED');
 const snapshot=(path:string)=>{
  if(!/^[a-f0-9]{64}$/.test(files[path]??''))throw Error('PHONE113_DIAGNOSTIC_SQL_PIN_MISSING');
  const sql=read(path);if(hash(sql)!==files[path])throw Error('PHONE113_DIAGNOSTIC_SQL_CHANGED');return sql;
 };
 const base:MigrationFile[]=paths.map(path=>{const name=path.slice(prefix.length),sql=snapshot(path);return {version:name.slice(0,4),name,sql,checksum:hash(sql.trim())};});
 return {base,journal:snapshot(journalPath),principal:snapshot(principalPath)};
}
