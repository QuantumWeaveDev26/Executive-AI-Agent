import {AuditEventRepository,type AuthenticatedScope,type DbClient,type TransactionalDbClient} from '@thaara/db';
import {ForbiddenError,ConflictError} from '@thaara/observability';
import {readInboundReports,type StoredInboundReport} from './phone-inbound-reports.js';
import {projectInboundEvents,type InboundCallEvent,type InboundEventInput,type InboundEventReceipt} from './phone-inbound-events.js';
const EVENT=`jsonb_build_object('eventId',event_id,'callId',call_id,'kind',kind,'sourceDigest',source_digest,'sequence',sequence,'report',report)`;
const SELECT=`SELECT ${EVENT} AS event FROM public.phone_inbound_call_events`;
const validId=(id:string)=>/^[a-f0-9]{64}$/.test(id);
type Row={event:InboundCallEvent};
/** Unwired journal; requires NEW reviewed112 schema. Never edits111 reports or initiates external work. */
export class PhoneInboundEventRepository{
 constructor(private readonly db:TransactionalDbClient){}
 private run<T>(scope:AuthenticatedScope,work:(tx:DbClient)=>Promise<T>){
  if(scope.role!=='owner'||!scope.workspaceId||!scope.userId||!scope.sessionTokenHash)throw new ForbiddenError('An active owner session is required.');
  return this.db.withScopedTransaction(scope,async tx=>{
   const {rows}=await tx.query<{workspace_id:string;user_id:string;role:string}>('SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)',[scope.sessionTokenHash]);
   if(rows.length!==1||rows[0]?.workspace_id!==scope.workspaceId||rows[0]?.user_id!==scope.userId||rows[0]?.role!=='owner')throw new ForbiddenError('Active owner membership could not be verified.');
   return work(tx);
  });
 }
 private async validate(scope:AuthenticatedScope,events:InboundCallEvent[]){
  for(const event of events)await readInboundReports(scope,async()=>[event.report]);
  if(events.length)projectInboundEvents(scope,events);
 }
 private async privacy(scope:AuthenticatedScope,report:StoredInboundReport){
  const result=await readInboundReports(scope,async()=>[report],report.id);
  if(!('report'in result)||!result.report)throw new ForbiddenError('Inbound call report could not be read.');
  return {...result.report,workspaceId:scope.workspaceId,ownerUserId:scope.userId};
 }
 async append(scope:AuthenticatedScope,input:InboundEventInput):Promise<InboundEventReceipt>{
  const snapshot=structuredClone(input);await this.validate(scope,[{...snapshot,sequence:1}]);
  return this.run(scope,async tx=>{
   await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`phone-inbound-events:${scope.workspaceId}:${scope.userId}:${snapshot.callId}`]);
   const {rows}=await tx.query<Row>(`${SELECT} WHERE workspace_id=$1 AND owner_user_id=$2 AND call_id=$3 ORDER BY sequence LIMIT 4`,[scope.workspaceId,scope.userId,snapshot.callId]);
   const events=rows.map(r=>structuredClone(r.event));await this.validate(scope,events);
   const existing=events.find(e=>e.eventId===snapshot.eventId);
   if(existing){
    if(existing.kind!==snapshot.kind||existing.sourceDigest!==snapshot.sourceDigest)throw new ConflictError('Inbound event replay conflicts with the saved record.');
    return {saved:true,event:existing,report:projectInboundEvents(scope,events),revision:events.length,duplicate:true};
   }
   if(events.length>=3||events.some(e=>e.kind===snapshot.kind))throw new ConflictError('Inbound phase is already recorded.');
   const next:InboundCallEvent={...snapshot,sequence:events.length+1};
   // Validate reconciliation before INSERT as well; caller binding changes must not leave a new event behind.
   projectInboundEvents(scope,[...events,next]);
   const inserted=await tx.query<Row>(`INSERT INTO public.phone_inbound_call_events(workspace_id,owner_user_id,call_id,event_id,kind,source_digest,sequence,report)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING ${EVENT} AS event`,
    [scope.workspaceId,scope.userId,next.callId,next.eventId,next.kind,next.sourceDigest,next.sequence,JSON.stringify(next.report)]);
   if(inserted.rows.length!==1)throw new ConflictError('Inbound event was not saved.');
   const committed=structuredClone(inserted.rows[0]!.event);await this.validate(scope,[...events,committed]);
   await new AuditEventRepository(tx).create(scope.workspaceId,'phone.inbound.event_saved','phone_inbound_call',
    {callId:next.callId,kind:next.kind,revision:next.sequence},scope.userId,next.callId);
   return {saved:true,event:committed,report:projectInboundEvents(scope,[...events,committed]),revision:next.sequence,duplicate:false};
  });
 }
 async read(scope:AuthenticatedScope,id:string):Promise<StoredInboundReport|null>{
  if(!validId(id))throw new ForbiddenError('Invalid inbound call identifier.');
  return this.run(scope,async tx=>{
   const {rows}=await tx.query<Row>(`${SELECT} WHERE workspace_id=$1 AND owner_user_id=$2 AND call_id=$3 ORDER BY sequence LIMIT 4`,[scope.workspaceId,scope.userId,id]);
   const events=rows.map(r=>r.event);await this.validate(scope,events);
   await new AuditEventRepository(tx).create(scope.workspaceId,'phone.inbound.event_details_read','phone_inbound_call',{callId:id,found:!!events.length},scope.userId,id);
   return events.length?this.privacy(scope,projectInboundEvents(scope,events)):null;
  });
 }
 async list(scope:AuthenticatedScope):Promise<StoredInboundReport[]>{
  return this.run(scope,async tx=>{
   const {rows:calls}=await tx.query<{call_id:string}>(`SELECT call_id,MAX(created_at) AS last_seen FROM public.phone_inbound_call_events WHERE workspace_id=$1 AND owner_user_id=$2
    GROUP BY call_id ORDER BY last_seen DESC,call_id DESC LIMIT 100`,[scope.workspaceId,scope.userId]);
   const ids=calls.map(c=>c.call_id);if(ids.length>100||ids.some(id=>!validId(id)))throw new ForbiddenError('Inbound call list failed validation.');
   const {rows}=ids.length?await tx.query<Row>(`${SELECT} WHERE workspace_id=$1 AND owner_user_id=$2 AND call_id=ANY($3::text[]) ORDER BY call_id,sequence LIMIT 301`,[scope.workspaceId,scope.userId,ids]):{rows:[]};
   if(rows.length>300)throw new ForbiddenError('Inbound event list exceeds its bound.');
   const result:StoredInboundReport[]=[];
   for(const id of ids){const events=rows.filter(r=>r.event.callId===id).map(r=>r.event);await this.validate(scope,events);if(!events.length)throw new ForbiddenError('Inbound call projection is missing.');result.push(await this.privacy(scope,projectInboundEvents(scope,events)));}
   await new AuditEventRepository(tx).create(scope.workspaceId,'phone.inbound.events_list_read','phone_inbound_call',{count:result.length},scope.userId);
   return result;
  });
 }
}
