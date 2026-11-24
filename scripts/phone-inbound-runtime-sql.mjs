// Creates/verifies REVIEW TEXT ONLY. Never imports a database or runs SQL.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const INBOUND_SQL_SOURCES=Object.freeze({
 112:Object.freeze({path:'docs/migrations/112-phone-inbound-events.review.sql',sha256:'d5c6a338b2bddba4e70bd527e8b0601b8bfe47602f3e46fc6306cc937adbbd8a',candidate:'docs/migrations/112r-phone-inbound-events.runtime-review.sql'}),
 113:Object.freeze({path:'docs/migrations/113-phone-inbound-principals.review.sql',sha256:'318eee1bad52b2674b1af21a186723e6c76d0433e247cacc0c4d983f61711680',candidate:'docs/migrations/113r-phone-inbound-principals.runtime-review.sql'})
});
export function deriveInboundRuntimeSql(step,source){
 const entry=INBOUND_SQL_SOURCES[step];if(!entry)throw Error('INBOUND_RUNTIME_SQL_STEP_INVALID');
 if(createHash('sha256').update(source).digest('hex')!==entry.sha256)throw Error('INBOUND_RUNTIME_SQL_SOURCE_CHANGED');
 const start=source.indexOf(' IF current_setting('),end=source.indexOf(' IF to_reg');
 if(start<0||end<=start)throw Error('INBOUND_RUNTIME_SQL_BOUNDARY_INVALID');
 const gate=` IF current_setting('thaara.step${step}_runtime_review_approved',true) IS DISTINCT FROM 'isolated-runtime-only'
  OR current_setting('thaara.step${step}_runtime_target_database',true) IS DISTINCT FROM current_database()
  OR current_database() IS DISTINCT FROM 'thaara_phone113_review'
  OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999 THEN
  RAISE EXCEPTION 'Inbound runtime review requires separate approval and exact isolated PostgreSQL16 database';
 END IF;
`;
 return '-- NEW RUNTIME REVIEW CANDIDATE: not executed or authorized. Original schema file remains unchanged.\n'+source.slice(0,start)+gate+source.slice(end);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||!['--prepare-review','--check-review'].includes(process.argv[2]))throw Error('invalid_command');
  const root=fileURLToPath(new URL('../',import.meta.url));
  // Capture and verify BOTH sources before writing either candidate.
  const candidates=Object.entries(INBOUND_SQL_SOURCES).map(([step,e])=>({path:resolve(root,e.candidate),text:deriveInboundRuntimeSql(Number(step),readFileSync(resolve(root,e.path),'utf8'))}));
  if(process.argv[2]==='--prepare-review')for(const c of candidates)writeFileSync(c.path,c.text,{flag:'wx'});
  for(const c of candidates)if(readFileSync(c.path,'utf8')!==c.text)throw Error('candidate_changed');
  console.log(JSON.stringify({status:'runtime_sql_review_text_verified',candidates:2,sqlExecuted:false,executionAllowed:false}));
 }catch{console.error('INBOUND_RUNTIME_SQL_REVIEW_FAILED');process.exitCode=1;}
}
