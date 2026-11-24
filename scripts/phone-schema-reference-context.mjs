// Source-only, fresh-cluster model. This object never establishes approval or database trust.
import {deriveMigratorBootstrap} from './phone-schema-dependency-evidence.mjs';
import {derivePgcryptoSourceDeclarations} from './phone-schema-pgcrypto-source.mjs';
import {fingerprint} from './phone-inbound-expected-schema.mjs';
const contexts=new WeakMap();
const deny=()=>{throw Error('SOURCE_REFERENCE_CONTEXT_DENIED');};
export function createSourceReferenceContext(input){
 if(process.env.NODE_ENV!=='test'||!input||Object.keys(input).sort().join(',')!=='bootstrapCompiled,bootstrapSource,pgcryptoControl,pgcryptoSql')deny();
 // Existing parsers verify exact source hashes; copy input bytes before retaining declarations.
 const bootstrap=deriveMigratorBootstrap(Buffer.from(input.bootstrapSource),Buffer.from(input.bootstrapCompiled));
 const native=derivePgcryptoSourceDeclarations(Buffer.from(input.pgcryptoSql),Buffer.from(input.pgcryptoControl));
 const data={bootstrap,native,productionAdmission:false,executionAuthorized:false,
  conditions:['Fresh public namespace with no unmodeled objects or sequences','Bootstrap resolves to public before base migrations','pgcrypto 1.3 is available, installed into public by postgres','Executor is postgres superuser with pristine defaults','Membership branch follows PostgreSQL16 superuser MEMBER/SET behavior']};
 const token=Object.freeze({format:'source-reference-context-v1',sha256:fingerprint(data),productionAdmission:false,executionAuthorized:false});
 contexts.set(token,structuredClone(data));return token;
}
export function readSourceReferenceContext(token){
 if(process.env.NODE_ENV!=='test'||!token||!contexts.has(token))deny();return structuredClone(contexts.get(token));
}
const path='packages/db/src/migrations/0012_task004_governed_capabilities_and_personas.sql';
const dataPins=new Map([
 [path+':12','f4f63785e1503f2f1c03cafec43b0f22b1f3d778fc2d33183c7b93cac17ee610'],
 [path+':30','33058690a61376a441495601ef201b6765c2e0b555c63d99ca6516ee2ee2be20']
]);
export function knownReferenceDataEffect(ref){return dataPins.get(ref.path+':'+ref.ordinal)===ref.sha256;}
