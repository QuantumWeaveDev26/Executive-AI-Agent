// Exact source identity recipes. Pins identify source, NOT independent approval or runtime evidence.
import {createHash} from 'node:crypto';
import {parseSourceAcl} from './phone-schema-acl-effects.mjs';
const pins=[
  {
    "path": "packages/db/src/migrations/0001_initial_schema.sql",
    "ordinal": 1,
    "sha256": "99de86c80166bb10a6491d90c0a50fde1897c792131fdf928952df53ce230f02",
    "kind": "conditional-extension"
  },
  {
    "path": "packages/db/src/migrations/0003_plans_and_receipts.sql",
    "ordinal": 7,
    "sha256": "eb8853c0a2b0715789a63766abcd829ffdc7c8fe4c47f54ba736a7e4cd1fa22e",
    "kind": "assertion"
  },
  {
    "path": "packages/db/src/migrations/0003_plans_and_receipts.sql",
    "ordinal": 164,
    "sha256": "d027e87e7d99eb3a75438a6b9e888b3e8c3e1a23128e2577830107c99db50767",
    "kind": "assertion"
  },
  {
    "path": "packages/db/src/migrations/0004_context_and_memory.sql",
    "ordinal": 245,
    "sha256": "143e8b611cdd7bb7e781b5779479af9b2b8531dc1bc091e662bedf6c0e3a62b6",
    "kind": "assertion"
  },
  {
    "path": "packages/db/src/migrations/0005_task003_runtime_fixes.sql",
    "ordinal": 9,
    "sha256": "1a3a3c1696b23d0474ca7b3515be28afa38e117276b1aa4524d739d5aaed1757",
    "kind": "assertion"
  },
  {
    "path": "packages/db/src/migrations/0006_task003_procedure_hardening.sql",
    "ordinal": 45,
    "sha256": "1b0062bcba26919795c4e6d848ae8eef2beded97fb40f26502da952d4670d219",
    "kind": "assertion"
  },
  {
    "path": "packages/db/src/migrations/0007_task003_token_bound_auxiliary_rls.sql",
    "ordinal": 35,
    "sha256": "df8efa0f9bd17db9e807db9099d796bb9b469f05d16b769593dfcc0050e3ef36",
    "kind": "assertion"
  },
  {
    "path": "packages/db/src/migrations/0008_task003_assistant_stream_lifecycle.sql",
    "ordinal": 69,
    "sha256": "b071503afaef43aaaf2ef2f6e11df492b9e8ab501da55b2035405f07d03fb2b2",
    "kind": "assertion"
  },
  {
    "path": "packages/db/src/migrations/0009_task003_privacy_purge_and_outbox_hardening.sql",
    "ordinal": 32,
    "sha256": "53e470f7febd6ad0f55695c109cd59a9153419f7655f393cae9bdd0df3e34334",
    "kind": "assertion"
  },
  {
    "path": "packages/db/src/migrations/0010_task003_purge_recovery_after_claim.sql",
    "ordinal": 9,
    "sha256": "209919d578cc6091cfaa968ecdbc4cf7c7b540a5df7044d1a2fa64fb15521086",
    "kind": "assertion"
  },
  {
    "path": "packages/db/src/migrations/0011_task003_purge_recovery_hardening.sql",
    "ordinal": 12,
    "sha256": "856bc1443ea56b9761361ed15d5a5fe5a9e97ecd0bab52837c4ae19b32b7d227",
    "kind": "assertion"
  },
  {
    "path": "packages/db/src/migrations/0012_task004_governed_capabilities_and_personas.sql",
    "ordinal": 2,
    "sha256": "d23a78dda61264f94ee9d3998a9436bfca66f8483bb9a107751cda13543317e6",
    "kind": "managed-roles-and-membership"
  },
  {
    "path": "packages/db/src/migrations/0012_task004_governed_capabilities_and_personas.sql",
    "ordinal": 7,
    "sha256": "21d87c3e115a711525fed044bb59b326e2831d07f049fe4f3b0fe5280c34fde4",
    "kind": "conditional-function-grant"
  },
  {
    "path": "packages/db/src/migrations/0012_task004_governed_capabilities_and_personas.sql",
    "ordinal": 130,
    "sha256": "7df2b8e7dbbab2e6688a8cc3bddc398d86cf5962a5926c5a7eb0b66085dce2af",
    "kind": "assertion"
  },
  {
    "path": "docs/migrations/112h-phone-inbound-events.hosted-review.sql",
    "ordinal": 5,
    "sha256": "a89ad4c332267e535b2ee33707a7c8b3ee9193ac74617d1ad2813217fbfb6a2e",
    "kind": "assertion"
  },
  {
    "path": "docs/migrations/113h-phone-inbound-principals.hosted-review.sql",
    "ordinal": 5,
    "sha256": "1c3e3115a3dafe424f584a0974a764acb2509838c3a28b7d1bcb3143af16dd14",
    "kind": "assertion"
  }
];
const deny=()=>{const e=Error('PINNED_PROCEDURAL_DENIED');e.code='procedural-block';throw e;};
export function modelPinnedProcedural({source,ref,t,lex,functions,temporaryFunctions,roles,id,qname,parens,identity}){
 if(process.env.NODE_ENV!=='test')throw Error('Procedural recipes are test-only');
 const pin=pins.find(p=>p.path===ref.path&&p.ordinal===ref.ordinal&&p.sha256===ref.sha256);
 if(!pin||createHash('sha256').update(source).digest('hex')!==pin.sha256||t.length!==2||t[0].word!=='do')deny();
 const condition=(kind,extra={})=>({...ref,kind,...extra,verified:false});
 const result={kind:pin.kind,created:[],effects:[],conditions:[],groups:1,unresolvedReasons:[]};
 if(pin.kind==='conditional-extension'){
  result.externalEffects=[{extension:'pgcrypto',when:'available-in-pg_available_extensions',operation:'CREATE EXTENSION IF NOT EXISTS',definition:source}];
  result.conditions.push(condition('extension-environment-contract',{extension:'pgcrypto',definition:source}));
  result.unresolvedReasons.push('external-extension-schema-unverified');return result;
 }
 if(pin.kind==='managed-roles-and-membership'){
  for(const role of ['thaara_definer','thaara_platform_owner']){
   if(!roles.has(role)){result.created.push({name:role,definition:'CREATE ROLE '+role+' WITH NOLOGIN NOBYPASSRLS NOSUPERUSER;',origin:ref,proceduralOrigin:true});result.conditions.push(condition('initial-role-absence',{role}));}
  }
  result.membershipProgram={definition:source,actor:'CURRENT_USER',conditionalGrants:['thaara_definer','thaara_platform_owner'],adminOption:true,condition:'not (pg_has_role MEMBER and SET)',verified:false};
  result.conditions.push(condition('migration-authority-and-ownership-guards',{definition:source}));
  result.unresolvedReasons.push('conditional-membership-grant-unverified');return result;
 }
 if(pin.kind==='conditional-function-grant'){
  if(!functions.has('public.current_authenticated_scope()')||!roles.has('thaara_definer'))deny();
  const e=parseSourceAcl(lex('GRANT EXECUTE ON FUNCTION public.current_authenticated_scope() TO thaara_definer;').slice(0,-1),{id,qname,parens,identity});
  result.effects.push({...ref,...e,proceduralOrigin:true,innerOrdinal:1});return result;
 }
 // These exact known assertion bodies have no database mutation. Their predicates are retained in full,
 // bound to their original source position; no parser verdict is a successful catalog/data assertion.
 const tag=t[1].value.match(/^(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)([\s\S]*)\1$/);if(!tag)deny();
 const words=lex(tag[2]).map(x=>x.word);if(words.some(w=>['create','alter','drop','grant','revoke','insert','update','delete','execute','truncate','call'].includes(w)))deny();
 if(words.includes('perform')){
  const f=temporaryFunctions.get('pg_temp.assert_0005(boolean,text)');
  if(!f||f.origin.sha256!=='c2fa0830f7084e77ef63b1f5d2ea1bb2f933ab7443d34ba79865d550b1fc7cd7')deny();
 }
 result.conditions.push(condition('source-assertion-program',{definition:source,programSha256:pin.sha256,requiredAt:'original-source-position'}));return result;
}
