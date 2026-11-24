import {it,expect,vi} from 'vitest';
import {generateKeyPairSync,sign} from 'node:crypto';
import fs from 'node:fs';
import {normalizePg16,comparePg16} from './phone-schema-pg16.mjs';
import {createLocalReviewVerifier} from './phone-schema-review-verifier.mjs';
import {sqlStatementEvidence} from './phone-schema-source-evidence.mjs';
import {canonical,fingerprint} from './phone-inbound-expected-schema.mjs';
const acl=()=>[{grantor:'postgres',grantee:'thaara_app',privilege:'SELECT',grantable:false}];
function table(name:string){return {name,owner:'postgres',rls:true,forceRls:true,kind:'r',persistence:'p',options:[],parents:[],triggers:[],rules:[],columns:[{name:'id',position:1,type:'uuid',notNull:true,default:null,identity:'',generated:'',collation:null}],constraints:[{name:'pk',type:'p',definition:'PRIMARY KEY (id)',validated:true,deferrable:false,deferred:false,referencedTable:null}],indexes:[{name:'pk',definition:'CREATE UNIQUE INDEX pk ON public.synthetic USING btree (id)',valid:true,ready:true,unique:true,primary:true,nullsNotDistinct:false}],policies:[{name:'owner',command:'*',permissive:true,roles:['thaara_app'],using:'(id IS NOT NULL)',check:'(id IS NOT NULL)'}],acl:acl(),columnAcl:[]};}
function fn(signature:string){return {signature,owner:'postgres',definition:'CREATE OR REPLACE FUNCTION public.synthetic() RETURNS boolean LANGUAGE sql AS $function$ SELECT true $function$',language:'sql',result:'boolean',kind:'f',securityDefiner:true,leakproof:false,strict:false,volatility:'v',parallel:'u',config:['search_path=pg_catalog, pg_temp'],acl:[{...acl()[0],privilege:'EXECUTE'}]};}
function catalog():any{return {format:'pg16-security-v1',serverVersionNum:160006,stage:'after113',tables:['workspaces','users','memberships','sessions','audit_events','phone_inbound_call_events','phone_inbound_principals'].map(n=>table('public.'+n)),functions:['public.current_authenticated_scope()','public.resolve_session_scope(text)','public.phone_inbound_resolve_grant(text,text,text)','public.phone_inbound_scope_matches(uuid,uuid)','public.phone_inbound_append_event(jsonb)'].map(fn),roles:['postgres','thaara_app','thaara_worker','thaara_phone_guard','thaara_phone_ingest'].map(name=>({name,login:false,inherit:false,super:false,bypassRls:false,createDb:false,createRole:false,replication:false,connectionLimit:-1,validUntil:null,config:[]})),schemas:[{name:'public',owner:'postgres',acl:[{...acl()[0],privilege:'USAGE'}]}],memberships:[],defaultPrivileges:[],dependencies:[{name:'base-contract',kind:'reviewed-contract',sha256:'1'.repeat(64)}]};}
it('normalizes set order without discarding security definitions',()=>{const a=catalog(),b=structuredClone(a);b.tables.reverse();b.functions.reverse();b.roles.reverse();expect(normalizePg16(a)).toEqual(normalizePg16(b));expect(comparePg16(a,b)).toBe(true);});
it('represents native declarations without discarding library, entrypoint, attributes or ACL drift',()=>{
 const a=catalog();a.functions.push({...a.functions[0],signature:'public.digest(text, text)',language:'c',result:'bytea',definition:"CREATE OR REPLACE FUNCTION public.digest(text, text) RETURNS bytea LANGUAGE c IMMUTABLE STRICT AS '$libdir/pgcrypto', 'pg_digest';"});
 expect(normalizePg16(a).functions.find(f=>f.language==='c')?.definition).toContain('$libdir/pgcrypto');
 for(const field of ['library','entrypoint','attribute','grant']){
  const b=structuredClone(a),f=b.functions.find(f=>f.language==='c')!;
  if(field==='library')f.definition=f.definition.replace('pgcrypto','other');
  if(field==='entrypoint')f.definition=f.definition.replace('pg_digest','different_digest');
  if(field==='attribute')f.securityDefiner=!f.securityDefiner;
  if(field==='grant')f.acl[0].grantable=!f.acl[0].grantable;
  expect(comparePg16(a,b)).toBe(false);
 }
});
it('recognizes exact PG16 comma-space required identities without rewriting comparable definitions',()=>{
 const a=catalog();for(const f of a.functions)f.signature=f.signature.replaceAll(',',', ');
 const normalized=normalizePg16(a);expect(normalized.functions.some(f=>f.signature==='public.phone_inbound_scope_matches(uuid, uuid)')).toBe(true);
 const bad=structuredClone(a);bad.functions=bad.functions.filter(f=>!f.signature.startsWith('public.phone_inbound_scope_matches('));expect(()=>normalizePg16(bad)).toThrow();
});
it.each(['column-default','constraint','index','function-body','function-config','policy','owner','role','grantor','grant-option','membership','default-acl','base-dependency'])('detects exact semantic drift: %s',mode=>{
 const a=catalog(),b=structuredClone(a);
 if(mode==='column-default')b.tables[0].columns[0].default='gen_random_uuid()';if(mode==='constraint')b.tables[0].constraints[0].definition='CHECK (false)';
 if(mode==='index')b.tables[0].indexes[0].definition+=' WHERE false';if(mode==='function-body')b.functions[0].definition+=' -- altered';if(mode==='function-config')b.functions[0].config=['search_path=public'];
 if(mode==='policy')b.tables[0].policies[0].using='true';if(mode==='owner')b.tables[0].owner='foreign';if(mode==='role')b.roles[0].super=true;
 if(mode==='grantor')b.tables[0].acl[0].grantor='foreign';if(mode==='grant-option')b.tables[0].acl[0].grantable=true;
 if(mode==='membership')b.memberships.push({role:'thaara_app',member:'thaara_worker',grantor:'postgres',adminOption:false,inheritOption:true,setOption:true});
 if(mode==='default-acl')b.defaultPrivileges.push({role:'postgres',schema:'public',objectType:'r',acl:acl()});if(mode==='base-dependency')b.dependencies[0].sha256='2'.repeat(64);
 expect(comparePg16(a,b)).toBe(false);
});
it.each(['unknown-field','unknown-kind','unsupported-version','missing-table','missing-function','duplicate','duplicate-grant','position','sparse','missing-definition'])('rejects unsupported or incomplete representations: %s',mode=>{
 const x=catalog();if(mode==='unknown-field')x.tables[0].unknown=true;if(mode==='unknown-kind')x.functions[0].language='plpython3u';if(mode==='unsupported-version')x.serverVersionNum=170000;
 if(mode==='missing-table')x.tables.pop();if(mode==='missing-function')x.functions.pop();if(mode==='duplicate')x.tables.push(structuredClone(x.tables[0]));
 if(mode==='duplicate-grant')x.tables[0].acl.push({...x.tables[0].acl[0]});if(mode==='position')x.tables[0].columns[0].position=2;
 if(mode==='sparse')delete x.tables[0].columns[0];if(mode==='missing-definition')delete x.functions[0].definition;
 expect(()=>normalizePg16(x)).toThrow(/PG16_SCHEMA_DENIED/);
});
it('preserves expression whitespace rather than claiming SQL equivalence',()=>{const a=catalog(),b=structuredClone(a);b.tables[0].policies[0].using='( id IS NOT NULL )';expect(comparePg16(a,b)).toBe(false);});
function triggerFixture(){const c=catalog(),signature='public.guard_source_row()';c.functions.push({...fn(signature),result:'trigger'});c.tables[0].triggers=[{name:'guard_source_row',definition:'CREATE TRIGGER guard_source_row BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.guard_source_row()',function:signature,enabled:'O',constraint:false,deferrable:false,initiallyDeferred:false,oldTransitionTable:null,newTransitionTable:null}];return c;}
it('represents deferred PG16 trigger constraints only with their exact matching constraint trigger',()=>{
 const c=triggerFixture(),t=c.tables[0].triggers[0];t.constraint=true;t.deferrable=true;t.initiallyDeferred=true;t.definition='CREATE CONSTRAINT TRIGGER guard_source_row AFTER UPDATE ON public.workspaces DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.guard_source_row()';
 c.tables[0].constraints.push({name:'guard_source_row',type:'t',definition:'TRIGGER DEFERRABLE INITIALLY DEFERRED',validated:true,deferrable:true,deferred:true,referencedTable:null});
 expect(normalizePg16(c).tables.find(t=>t.name==='public.workspaces')!.constraints.some(c=>c.type==='t')).toBe(true);
 for(const mode of ['missing','flags','definition','reference']){const b=structuredClone(c);if(mode==='missing')b.tables[0].triggers=[];if(mode==='flags')b.tables[0].constraints.at(-1)!.deferred=false;if(mode==='definition')b.tables[0].constraints.at(-1)!.definition='TRIGGER';if(mode==='reference')b.tables[0].constraints.at(-1)!.referencedTable='public.users';expect(()=>normalizePg16(b)).toThrow();}
});
it('preserves complete source trigger identity, definition and firing mode',()=>{
 const c=triggerFixture();expect(normalizePg16(c).tables.find((t:any)=>t.name==='public.workspaces')!.triggers).toEqual(c.tables[0].triggers);
});
it.each(['enabled','definition','function','deferrable','initiallyDeferred'])('detects source trigger drift: %s',field=>{
 const a=triggerFixture(),b=structuredClone(a),t=b.tables[0].triggers[0];
 if(field==='enabled')t.enabled='D';if(field==='definition')t.definition=t.definition.replace('BEFORE UPDATE','BEFORE DELETE');if(field==='function')t.function='public.missing_guard()';if(field==='deferrable')t.deferrable=true;if(field==='initiallyDeferred')t.initiallyDeferred=true;
 expect(comparePg16(a,b)).toBe(false);
});
it.each(['missing-function','wrong-table','wrong-name','unknown-field','transition-table','string-only'])('rejects unsupported or inconsistent trigger representation: %s',mode=>{
 const c=triggerFixture(),t=c.tables[0].triggers[0];if(mode==='missing-function')c.functions.pop();if(mode==='wrong-table')t.definition=t.definition.replace('public.workspaces','public.other');if(mode==='wrong-name')t.name='other';if(mode==='unknown-field')t.unknown=true;if(mode==='transition-table')t.oldTransitionTable='old_rows';if(mode==='string-only')c.tables[0].triggers=['CREATE TRIGGER unverified'];expect(()=>normalizePg16(c)).toThrow();
});
it('supports the distinct after112 minimum scope',()=>{const c=catalog();c.stage='after112';c.tables.pop();c.functions.splice(2);c.roles.splice(3);expect(normalizePg16(c).stage).toBe('after112');});

function approvalFixture(){
 const reviewer=generateKeyPairSync('ed25519'),authority=generateKeyPairSync('ed25519');let now=150;
 const doc={format:'synthetic-only',provenance:{sql112Sha256:'1'.repeat(64),baseContractSha256:'2'.repeat(64)},catalog:catalog()};
 const review={kind:'expected-schema-review-v1',approvalId:'review-1',reviewerId:'independent-1',documentSha256:fingerprint(doc),provenanceSha256:fingerprint(doc.provenance),scope:'phone-inbound-expected-schema',issuedAt:100,expiresAt:200};
 const status={kind:'schema-revocations-v1',issuerId:'authority-1',sequence:4,issuedAt:140,expiresAt:170,revokedApprovalIds:[],revokedReviewerIds:[]};
 const envelope=(payload:any,key:any)=>({payload,signature:sign(null,Buffer.from(canonical(payload)),key).toString('base64')});
 const verify=createLocalReviewVerifier({reviewerKeys:{'independent-1':reviewer.publicKey},authorityKeys:{'authority-1':authority.publicKey},now:()=>now,minRevocationSequence:4,maxSnapshotAge:20,maxApprovalLifetime:100});
 return {verify,doc,review,status,reviewer,authority,envelope,setNow:(n:number)=>now=n,run:()=>verify(doc,envelope(review,reviewer.privateKey),envelope(status,authority.privateKey))};
}
it('requires independent signatures and fresh revocation evidence, never authorizes execution',()=>{expect(approvalFixture().run()).toEqual({status:'local_review_verified',executionAuthorized:false});});
it.each(['boolean','tamper','wrong-key','unknown-reviewer','wrong-scope','wrong-document','wrong-provenance','expired','future','revoked','revoked-reviewer','stale-status','rollback-status','unknown-authority','tampered-status'])('denies approval failure: %s',mode=>{
 const f:any=approvalFixture();let a:any,b:any;
 if(mode==='boolean')return expect(f.verify(f.doc,{approved:true},{}).status).toBe('denied');
 if(mode==='wrong-scope')f.review.scope='execute';if(mode==='wrong-document')f.review.documentSha256='0'.repeat(64);if(mode==='wrong-provenance')f.review.provenanceSha256='0'.repeat(64);
 if(mode==='expired')f.setNow(200);if(mode==='future')f.review.issuedAt=151;if(mode==='revoked')f.status.revokedApprovalIds=['review-1'];if(mode==='revoked-reviewer')f.status.revokedReviewerIds=['independent-1'];
 if(mode==='stale-status')f.status.issuedAt=100;if(mode==='rollback-status')f.status.sequence=3;if(mode==='unknown-reviewer')f.review.reviewerId='unknown';if(mode==='unknown-authority')f.status.issuerId='unknown';
 a=f.envelope(f.review,mode==='wrong-key'?f.authority.privateKey:f.reviewer.privateKey);b=f.envelope(f.status,f.authority.privateKey);
 if(mode==='tamper')a.payload.scope='tampered';if(mode==='tampered-status')b.payload.sequence=5;
 expect(f.verify(f.doc,a,b).status).toBe('denied');
});
it('rechecks time and revocation on every call',()=>{const f=approvalFixture();expect(f.run().status).toBe('local_review_verified');f.status.revokedApprovalIds.push('review-1' as never);expect(f.run().status).toBe('denied');});
it('remembers a newer revocation snapshot even when that snapshot denies the review',()=>{
 const f=approvalFixture();const old=structuredClone(f.status);f.status.sequence=5;f.status.revokedApprovalIds.push('review-1' as never);expect(f.run().status).toBe('denied');
 Object.assign(f.status,old);expect(f.run().status).toBe('denied');
});
it('copies trusted key registries so request-side mutations cannot enroll keys',()=>{const f=approvalFixture();f.review.reviewerId='new';expect(f.run().status).toBe('denied');});
it('rejects one key reused for reviewer and authority under different names',()=>{
 const k=generateKeyPairSync('ed25519');expect(()=>createLocalReviewVerifier({reviewerKeys:{reviewer:k.publicKey},authorityKeys:{authority:k.publicKey},now:()=>150,minRevocationSequence:0,maxSnapshotAge:20,maxApprovalLifetime:100})).toThrow();
});
it('rejects rollback or equivocation after a newer signed revocation snapshot',()=>{
 const f=approvalFixture();expect(f.run().status).toBe('local_review_verified');f.status.sequence=5;expect(f.run().status).toBe('local_review_verified');f.status.sequence=4;expect(f.run().status).toBe('denied');
 const g=approvalFixture();expect(g.run().status).toBe('local_review_verified');g.status.revokedApprovalIds.push('other-review' as never);expect(g.run().status).toBe('denied');
});
it.each(['parents','triggers','rules'])('rejects currently unsupported table feature %s',key=>{const c=catalog();c.tables[0][key]=['unreviewed'];expect(()=>normalizePg16(c)).toThrow();});
it('preserves complete SQL statement bodies and exact source spans',()=>{
 const sql="-- leading\r\nCREATE FUNCTION public.x() RETURNS text AS $body$ BEGIN RETURN 'a;b'; END $body$ LANGUAGE plpgsql;\r\n/* outer /* inner; */ end */ GRANT EXECUTE ON FUNCTION public.x() TO app;\r\n";
 const x=sqlStatementEvidence(Buffer.from(sql));expect(x.statements).toHaveLength(2);expect(x.statements[0].text).toContain("RETURN 'a;b'");expect(x.statements.map((s:any)=>s.text).join('')+x.trailing).toBe(sql);
});
it.each(["SELECT 'unterminated;",'/* missing end', 'DO $body$ missing', 'SELECT 1', 'SELECT E\'unsupported\\\';'])('rejects unknown/incomplete source representation: %s',sql=>{expect(()=>sqlStatementEvidence(Buffer.from(sql))).toThrow(/SOURCE_EVIDENCE_DENIED/);});
it('does not split comments, quoted identifiers or SQL doubled quotes',()=>{const x=sqlStatementEvidence(Buffer.from('SELECT \'x\'\';y\', "a;""b"; -- tail'));expect(x.statements).toHaveLength(1);});
it('covers every byte and complete body of the fourteen pinned source artifacts without SQL execution',()=>{
 const e=JSON.parse(fs.readFileSync('docs/integrations/phone/INBOUND_SCHEMA_COMPLETE_SOURCE_EVIDENCE_2026-11-04.json','utf8'));
 expect(e.expectedCatalog).toBeNull();expect(e.reviewAuthorization).toBeNull();expect(e.semanticDerivationComplete).toBe(false);expect(e.sources).toHaveLength(14);
 for(const source of e.sources){
  expect(source.path).toMatch(/^(packages\/db\/src\/migrations\/00(0[1-9]|1[0-2])_[a-z0-9_]+\.sql|docs\/migrations\/11[23]h-phone-inbound-[a-z-]+\.hosted-review\.sql)$/);
  const raw=fs.readFileSync(source.path);const actual=sqlStatementEvidence(raw);expect(actual.sha256).toBe(source.sha256);expect(actual.statements).toEqual(source.statements);expect(actual.trailing).toBe(source.trailing);
  expect(Buffer.from(source.statements.map((s:any)=>s.text).join('')+source.trailing)).toEqual(raw);
 }
 expect(e.sources.reduce((n:number,s:any)=>n+s.statements.length,0)).toBe(e.statementCount);
});
it('rejects malformed byte encodings, duplicate fields and registry policy errors',()=>{
 expect(()=>sqlStatementEvidence(Buffer.from([0xff]))).toThrow();expect(()=>sqlStatementEvidence(Buffer.from('SELECT \0;'))).toThrow();
 const f=approvalFixture();const key=f.reviewer.publicKey;
 for(const change of [{now:()=>NaN},{minRevocationSequence:-1},{maxSnapshotAge:0},{maxApprovalLifetime:0},{reviewerKeys:{bad:{}}}]){
  expect(()=>createLocalReviewVerifier({reviewerKeys:{reviewer:key},authorityKeys:{authority:f.authority.publicKey},now:()=>150,minRevocationSequence:0,maxSnapshotAge:20,maxApprovalLifetime:100,...change})).toThrow();
 }
});
it.each(['function','table','column','schema','default'])('rejects impossible PostgreSQL ACL privilege on %s',kind=>{
 const c=catalog(),bad={...acl()[0],privilege:'CONNECT'};
 if(kind==='function')c.functions[0].acl=[bad];if(kind==='table')c.tables[0].acl=[bad];if(kind==='column')c.tables[0].columnAcl=[{column:'id',acl:[bad]}];if(kind==='schema')c.schemas[0].acl=[bad];if(kind==='default')c.defaultPrivileges=[{role:'postgres',schema:'public',objectType:'f',acl:[bad]}];
 expect(()=>normalizePg16(c)).toThrow();
});
it('keeps the new validators outside production',()=>{vi.stubEnv('NODE_ENV','production');try{expect(()=>normalizePg16(catalog())).toThrow(/test-only/);expect(()=>approvalFixture()).toThrow(/test-only/);}finally{vi.unstubAllEnvs();}});
