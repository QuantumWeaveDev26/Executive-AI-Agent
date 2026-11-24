import {createHash,timingSafeEqual} from 'node:crypto';
import {AppError,ForbiddenError} from '@thaara/observability';

export type InboundPrincipalOperation='callback'|'completion';
export interface InboundPrincipalBinding{
 readonly routeId:string;readonly workspaceId:string;readonly ownerUserId:string;readonly principalId:string;
 readonly revision:number;readonly profileFingerprint:string;
}
export interface InboundPrincipalGrant extends InboundPrincipalBinding{
 readonly tokenHash:string;readonly activeOwner:boolean;readonly revokedAt:string|null;readonly expiresAt:string;
 readonly operations:readonly InboundPrincipalOperation[];
}
/** A distinct service identity. It intentionally cannot satisfy AuthenticatedScope or grant owner privileges. */
export interface InboundPrincipalScope extends InboundPrincipalBinding{
 readonly authKind:'phone_inbound';readonly operation:InboundPrincipalOperation;
}
export interface InboundPrincipalTransactions<Tx>{
 /**
  * Trusted backend port, NOT a payload callback. Production adapter must resolve/lock the current grant and owner
  * membership, verify restricted DB role/RLS and keep fn inside that same transaction. Resolve null on no match.
  * Commit (including report+audit) before resolving; reject on rollback. No concrete production adapter exists yet.
  */
 withGrant<T>(request:Readonly<{routeId:string;tokenHash:string;operation:InboundPrincipalOperation}>,
  fn:(grant:InboundPrincipalGrant|null,transaction:Tx)=>Promise<T>):Promise<T>;
}
const ID=/^[A-Za-z0-9_-]{1,128}$/;
const HASH=/^[a-f0-9]{64}$/;
const denied=()=>new ForbiddenError('Inbound principal admission was denied.');
const unavailable=()=>new AppError('Inbound principal admission is unavailable.','PHONE_INBOUND_PRINCIPAL_UNAVAILABLE',503);
const operation=(value:unknown):value is InboundPrincipalOperation=>value==='callback'||value==='completion';
function validBinding(p:InboundPrincipalBinding){
 return [p.routeId,p.workspaceId,p.ownerUserId,p.principalId].every(v=>typeof v==='string'&&ID.test(v))
  &&Number.isSafeInteger(p.revision)&&p.revision>0&&typeof p.profileFingerprint==='string'&&HASH.test(p.profileFingerprint);
}

/** LOCAL TEST-ONLY prototype; never swaps an owner login into a provider callback or registers a live route. */
export function createInboundPrincipalGate<Tx>(options:{profile:InboundPrincipalBinding;transactions:InboundPrincipalTransactions<Tx>;now?:()=>number}){
 if(process.env.NODE_ENV!=='test')throw new Error('Inbound principal gate is test-only pending database and production admission review.');
 const profile=Object.freeze(structuredClone(options.profile)),withGrant=options.transactions.withGrant.bind(options.transactions),now=options.now??Date.now;
 if(!validBinding(profile)||Object.keys(profile).sort().join(',')!=='ownerUserId,principalId,profileFingerprint,revision,routeId,workspaceId')throw denied();
 return {async run<T>(routeId:string,authorization:string|undefined,requested:InboundPrincipalOperation,
  work:(scope:Readonly<InboundPrincipalScope>,tx:Tx)=>Promise<T>):Promise<T>{
  if(routeId!==profile.routeId||!operation(requested)||typeof authorization!=='string'||!/^Bearer [A-Za-z0-9_-]{32,256}$/.test(authorization)
   ||authorization.includes('\n')||authorization.includes('\r'))throw denied();
  const tokenHash=createHash('sha256').update(authorization.slice(7)).digest('hex');
  try{
   return await withGrant(Object.freeze({routeId:profile.routeId,tokenHash,operation:requested}),async(grant,tx)=>{
    // Recheck inside the transaction, not from a cached/stale startup grant.
    const time=now();
    if(!grant||!validBinding(grant)||!Number.isFinite(time)||grant.activeOwner!==true||grant.revokedAt!==null
     ||typeof grant.expiresAt!=='string'||!/^\d{4}-\d{2}-\d{2}T.*Z$/.test(grant.expiresAt)||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=time
     ||!Array.isArray(grant.operations)||!grant.operations.length||grant.operations.length>2
     ||new Set(grant.operations).size!==grant.operations.length||!grant.operations.every(operation)||!grant.operations.includes(requested)
     ||typeof grant.tokenHash!=='string'||!HASH.test(grant.tokenHash)
     ||!timingSafeEqual(Buffer.from(grant.tokenHash,'hex'),Buffer.from(tokenHash,'hex'))
     ||(['routeId','workspaceId','ownerUserId','principalId','revision','profileFingerprint'] as const).some(key=>grant[key]!==profile[key]))throw denied();
    const scope:Readonly<InboundPrincipalScope>=Object.freeze({...profile,authKind:'phone_inbound',operation:requested});
    return work(scope,tx);
   });
  }catch(error){
   if(error instanceof ForbiddenError)throw denied();
   // No raw adapter, SQL, provider, credential or body details escape the boundary. No retries here.
   throw unavailable();
  }
 }};
}
