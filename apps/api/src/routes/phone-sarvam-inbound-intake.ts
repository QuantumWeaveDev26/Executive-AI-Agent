import type {FastifyInstance} from 'fastify';
import type {createSarvamInboundIntake} from '../services/phone-sarvam-inbound-intake.js';
/** LOCAL ONLY. No production registration or provider configuration exists. Never log auth/body/error payloads. */
export async function phoneSarvamInboundIntakeRoutes(app:FastifyInstance,intake:ReturnType<typeof createSarvamInboundIntake>){
 if(process.env.NODE_ENV!=='test')throw new Error('Inbound intake route is test-only pending production admission.');
 app.post<{Params:{routeId:string}}>('/connectors/phone/inbound/intake/:routeId',{bodyLimit:65536,logLevel:'silent'},async(request,reply)=>{
  reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');
  try{
   const r=await intake.ingest(request.params.routeId,request.headers.authorization,request.body);
   return {saved:true,reportId:r.id,outcome:r.outcome};
  }catch(error){
   const status=(error as {statusCode?:number})?.statusCode;
   return reply.code(status===403?403:status===409?409:503).send({saved:false,code:'PHONE_INBOUND_DELIVERY_REJECTED'});
  }
 });
}
