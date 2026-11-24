import {computeCanonicalParameterHash} from '@thaara/contracts';
import {AuditEventRepository,type AuthenticatedScope,type DbClient,type TransactionalDbClient} from '@thaara/db';
import {ForbiddenError,ConflictError} from '@thaara/observability';
import {makeInboundReport,readInboundReports,type InboundReportInput,type StoredInboundReport} from './phone-inbound-reports.js';
const validId=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
type Row={event_id:string;report_hash:string;report:StoredInboundReport};

/** Unwired final-report storage. Requires reviewed111 SQL. NOT a provider authenticator or callback booking tool. */
export class PhoneInboundReportRepository{
 constructor(private readonly db:TransactionalDbClient){}
 private run<T>(scope:AuthenticatedScope,work:(tx:DbClient)=>Promise<T>){
  if(scope.role!=='owner'||!scope.sessionTokenHash||!scope.workspaceId||!scope.userId)throw new ForbiddenError('An active owner session is required.');
  return this.db.withScopedTransaction(scope,async tx=>{
   const {rows}=await tx.query<{workspace_id:string;user_id:string;role:string}>('SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)',[scope.sessionTokenHash]);
   if(rows.length!==1||rows[0]?.workspace_id!==scope.workspaceId||rows[0]?.user_id!==scope.userId||rows[0]?.role!=='owner')throw new ForbiddenError('Active owner membership could not be verified.');
   return work(tx);
  });
 }
 private async validate(scope:AuthenticatedScope,rows:Row[]){
  // Reuse output validation; scope and snapshot corruption fail closed before any response.
  await readInboundReports(scope,async()=>rows.map(r=>r.report));
  return rows.map(r=>Object.freeze(structuredClone(r.report)));
 }
 private async privacyView(scope:AuthenticatedScope,reports:StoredInboundReport[]){
  return Promise.all(reports.map(async report=>{
   const projected=await readInboundReports(scope,async()=>[report],report.id);
   if(!('report' in projected)||!projected.report)throw new ForbiddenError('Inbound report could not be read.');
   return Object.freeze({...projected.report,workspaceId:scope.workspaceId,ownerUserId:scope.userId});
  }));
 }
 /** Server-admitted or owner-reviewed reports only; never expose this directly as a public webhook. */
 async save(scope:AuthenticatedScope,eventId:string,input:InboundReportInput):Promise<StoredInboundReport>{
  if(!validId(eventId))throw new ForbiddenError('Invalid inbound event identifier.');
  const snapshot=makeInboundReport(structuredClone(input),{workspaceId:scope.workspaceId,userId:scope.userId,role:scope.role,direction:'inbound',authenticatedRoute:true});
  // Hash only the declared projection; extra provider fields never create authority or a booked status.
  const reportHash=computeCanonicalParameterHash({snapshot,callbackInterest:input.callbackInterest});
  return this.saveNormalized(scope,eventId,snapshot,reportHash);
 }
 /** Internal typed intake persistence only; sourceDigest must come from server canonicalization, never a webhook field. */
 async saveNormalized(scope:AuthenticatedScope,eventId:string,record:StoredInboundReport,sourceDigest?:string):Promise<StoredInboundReport>{
  if(!validId(eventId))throw new ForbiddenError('Invalid inbound event identifier.');
  const snapshot=Object.freeze(structuredClone(record));
  await readInboundReports(scope,async()=>[snapshot]);
  const reportHash=sourceDigest??computeCanonicalParameterHash(snapshot);
  if(!/^[a-f0-9]{64}$/.test(reportHash))throw new ForbiddenError('Invalid inbound event digest.');
  return this.run(scope,async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`phone-inbound:${scope.workspaceId}:${scope.userId}`]);
   const {rows}=await tx.query<Row>('SELECT event_id,report_hash,report FROM public.phone_inbound_reports WHERE workspace_id=$1 AND owner_user_id=$2 AND (report_id=$3 OR event_id=$4)',[scope.workspaceId,scope.userId,snapshot.id,eventId]);
   if(rows.length){
    if(rows.length!==1||rows[0]?.event_id!==eventId||rows[0]?.report_hash!==reportHash||rows[0]?.report.id!==snapshot.id)throw new ConflictError('Inbound report replay conflicts with the saved record.');
    return (await this.validate(scope,rows))[0]!;
   }
   const inserted=await tx.query<Row>(`INSERT INTO public.phone_inbound_reports(workspace_id,owner_user_id,report_id,event_id,report_hash,occurred_at,report)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING event_id,report_hash,report`,
    [scope.workspaceId,scope.userId,snapshot.id,eventId,reportHash,snapshot.occurredAt,JSON.stringify(snapshot)]);
   if(inserted.rows.length!==1)throw new ConflictError('Inbound report was not saved.');
   const report=(await this.validate(scope,inserted.rows))[0]!;
   await new AuditEventRepository(tx).create(scope.workspaceId,'phone.inbound.report_saved','phone_inbound_report',{reportId:snapshot.id,outcome:snapshot.outcome},scope.userId,snapshot.id);
   return report;
  });
 }
 async list(scope:AuthenticatedScope):Promise<StoredInboundReport[]>{
  return this.run(scope,async tx=>{
   const {rows}=await tx.query<Row>(`SELECT event_id,report_hash,report FROM public.phone_inbound_reports WHERE workspace_id=$1 AND owner_user_id=$2 ORDER BY occurred_at DESC,report_id LIMIT 100`,[scope.workspaceId,scope.userId]);
   const result=await this.validate(scope,rows);
   await new AuditEventRepository(tx).create(scope.workspaceId,'phone.inbound.reports_read','phone_inbound_report',{count:result.length},scope.userId);
   return this.privacyView(scope,result);
  });
 }
 async read(scope:AuthenticatedScope,id:string):Promise<StoredInboundReport|null>{
  if(!validId(id))throw new ForbiddenError('Invalid report identifier.');
  return this.run(scope,async tx=>{
   const {rows}=await tx.query<Row>('SELECT event_id,report_hash,report FROM public.phone_inbound_reports WHERE workspace_id=$1 AND owner_user_id=$2 AND report_id=$3',[scope.workspaceId,scope.userId,id]);
   const report=(await this.validate(scope,rows))[0]??null;
   await new AuditEventRepository(tx).create(scope.workspaceId,'phone.inbound.details_read','phone_inbound_report',{reportId:id,found:report!==null},scope.userId,id);
   return report?(await this.privacyView(scope,[report]))[0]!:null;
  });
 }
}
