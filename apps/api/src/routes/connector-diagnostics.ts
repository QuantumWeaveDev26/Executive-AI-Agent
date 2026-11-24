import { FastifyInstance } from 'fastify';
import { AuthenticatedScope,TransactionalDbClient } from '@thaara/db';
import { ConnectorDiagnostic,ConnectorDiagnosticsSchema } from '@thaara/contracts';
import { PolicyGateway } from '@thaara/policy';
import { ForbiddenError,ValidationError } from '@thaara/observability';
export interface LocalConnectorDiagnosticReader {
 connectorName:ConnectorDiagnostic['connectorName'];connectionScope:ConnectorDiagnostic['connectionScope'];
 storageKind:ConnectorDiagnostic['storageKind'];kmsStatus:ConnectorDiagnostic['kmsStatus'];
 read(scope:AuthenticatedScope):Promise<{connectionState:ConnectorDiagnostic['connectionState'];storageStatus:ConnectorDiagnostic['storageStatus']}>;
}
export async function connectorDiagnosticsRoutes(app:FastifyInstance,options:{db:TransactionalDbClient;policyGateway:PolicyGateway;readers:readonly LocalConnectorDiagnosticReader[]}) {
 const authorize=async(scope:AuthenticatedScope)=>{
  if(!['owner','admin'].includes(scope.role)||!options.policyGateway.evaluate(scope,{actionName:'connectors.diagnostics',parameters:{}}).allowed)throw new ForbiddenError('Workspace admin access required.');
  await options.db.withScopedTransaction(scope,async tx=>{
   const {rows}=await tx.query<{workspace_id:string;user_id:string;role:string}>('SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)',[scope.sessionTokenHash]);
   if(!rows[0]||rows[0].workspace_id!==scope.workspaceId||rows[0].user_id!==scope.userId||rows[0].role!==scope.role)throw new ForbiddenError('Active matching workspace membership required.');
  });
 };
 app.get('/admin/connectors/diagnostics',{
  preHandler:[async(_request,reply)=>{reply.header('Cache-Control','no-store').header('Referrer-Policy','no-referrer');},app.requireAuth],
  preValidation:async request=>{if(Object.keys(request.query as object).length)throw new ValidationError('Diagnostics accepts no connection targets.');},
  schema:{tags:['Admin'],response:{200:ConnectorDiagnosticsSchema}}
 },async request=>{
  const scope=Object.freeze({...request.scope!});await authorize(scope);
  const connectors:ConnectorDiagnostic[]=[];
  for(const reader of options.readers){
   let connectionState:ConnectorDiagnostic['connectionState']='unavailable',storageStatus:ConnectorDiagnostic['storageStatus']='unavailable';
   let code:ConnectorDiagnostic['lastDiagnostic']['code']='local_metadata_unavailable';
   try{
    const value=await reader.read(scope);
    if(!['not_configured','disconnected','connected_mock','configured_unverified','reconnect_required'].includes(value.connectionState)||
     !['not_configured','not_checked','readable','unavailable'].includes(value.storageStatus))throw Error('Invalid local metadata');
    connectionState=value.connectionState;storageStatus=value.storageStatus;code=connectionState==='not_configured'?'not_configured':'local_metadata_read';
   }catch(error){if(error instanceof ForbiddenError)throw error;}
   connectors.push({connectorName:reader.connectorName,connectionScope:reader.connectionScope,connectionState,storageKind:reader.storageKind,storageStatus,kmsStatus:reader.kmsStatus,
    lastDiagnostic:{code,checkedAt:new Date().toISOString(),providerContacted:false}});
  }
  await authorize(scope);return {connectors};
 });
}
