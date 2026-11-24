// Local review TEXT only; no database import, credential access or execution mode.
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {INBOUND_SQL_SOURCES} from './phone-inbound-runtime-sql.mjs';
export const INBOUND_INSTALL_DRAFTS=Object.freeze({112:'docs/migrations/112p-phone-inbound-events.install-draft.sql',113:'docs/migrations/113p-phone-inbound-principals.install-draft.sql'});
const deny=()=>{throw Error('INBOUND_INSTALL_DRAFT_REVIEW_DENIED');};
export function deriveInboundInstallDraft(step,source){
 const entry=INBOUND_SQL_SOURCES[step];if(!entry||typeof source!=='string'||createHash('sha256').update(source).digest('hex')!==entry.sha256)deny();
 const start=source.indexOf(' IF current_setting('),end=source.indexOf(' IF to_reg');
 if(start<0||end<=start)deny();
 return '-- DISABLED INSTALL DRAFT. Not approved, target-specific admission not prepared. NEVER execute as-is.\n'
  +source.slice(0,start)+" RAISE EXCEPTION 'Inbound production install draft is disabled; target-specific approval required';\n"+source.slice(end);
}
export function verifyInboundInstallDraft(step,source,draft){
 if(draft!==deriveInboundInstallDraft(step,source))deny();
 return {step,schemaBodyUnchanged:true,executionAllowed:false,productionReady:false,sqlExecuted:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||!['--prepare-drafts','--check-drafts'].includes(process.argv[2]))deny();
  const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
  const inside=path=>{const r=relative(root,realpathSync(path));if(isAbsolute(r)||r==='..'||r.startsWith('../')||r.startsWith('..\\'))deny();return path;};
  const drafts=Object.entries(INBOUND_INSTALL_DRAFTS).map(([step,path])=>{const source=readFileSync(inside(resolve(root,INBOUND_SQL_SOURCES[step].path)),'utf8');return {step:Number(step),path:resolve(root,path),source,text:deriveInboundInstallDraft(Number(step),source)};});
  for(const draft of drafts)inside(dirname(draft.path));
  if(process.argv[2]==='--prepare-drafts')for(const draft of drafts)writeFileSync(draft.path,draft.text,{flag:'wx'});
  for(const draft of drafts)verifyInboundInstallDraft(draft.step,draft.source,readFileSync(inside(draft.path),'utf8'));
  console.log(JSON.stringify({status:'disabled_install_drafts_verified',drafts:2,executionAllowed:false,productionReady:false,sqlExecuted:false}));
 }catch{console.error('INBOUND_INSTALL_DRAFT_REVIEW_DENIED');process.exitCode=1;}
}
