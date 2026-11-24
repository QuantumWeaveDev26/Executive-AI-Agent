import { FastifyInstance,FastifyReply } from 'fastify';
import { N8nConnectionDetailsSchema,N8nConfigureConnectionSchema,N8nConfigureConnection } from '@thaara/contracts';
import { TransactionalDbClient,AuthenticatedScope,AuditEventRepository } from '@thaara/db';
import { PolicyGateway } from '@thaara/policy';
import { AppError,ForbiddenError,ValidationError } from '@thaara/observability';
import { LocalConnectorDiagnosticReader } from './connector-diagnostics.js';
import { DurableN8nSecurityPrototype,DurableN8nSecurityOptions } from '../services/durable-n8n-security.js';
import { N8nConnectionManager,N8nConnectionOptions } from '../services/n8n-connections.js';
export async function registerN8nConnections(app:FastifyInstance,options:{
 db:TransactionalDbClient;policyGateway:PolicyGateway;connections?:N8nConnectionOptions;durable?:DurableN8nSecurityOptions;
}) {
 const authorize=async(scope:AuthenticatedScope,action?:string,payload:Record<string,unknown>={})=>{
  await options.db.withScopedTransaction(scope,async tx=>{
   const {rows}=await tx.query<{workspace_id:string;user_id:string;role:string}>('SELECT workspace_id,user_id,role FROM public.resolve_session_scope($1)',[scope.sessionTokenHash]);
   const row=rows[0];
   if(!row||row.workspace_id!==scope.workspaceId||row.user_id!==scope.userId||row.role!==scope.role)throw new ForbiddenError('Active matching workspace membership is required.');
   if(!['admin','owner'].includes(scope.role))throw new ForbiddenError('Workspace admin access required.');
   if(action)await new AuditEventRepository(tx).create(scope.workspaceId,action,'n8n_connection',payload,scope.userId);
  });
 };
 const manager=new N8nConnectionManager(options.connections,options.policyGateway,authorize);
 const durable=options.durable?new DurableN8nSecurityPrototype(options.durable,options.policyGateway):undefined;
 const expected=(header:unknown)=>{
  if(header===undefined)throw new AppError('Refresh the connection and supply its revision.','CONNECTOR_REVISION_REQUIRED',428);
  if(typeof header!=='string'||!/^"(0|[1-9][0-9]{0,15})"$/.test(header))throw new ValidationError('A quoted integer If-Match revision is required.');
  const value=Number(header.slice(1,-1));
  if(!Number.isSafeInteger(value)||value>=Number.MAX_SAFE_INTEGER)throw new ValidationError('Invalid connection revision.');
  return value;
 };
 const details=async(scope:AuthenticatedScope)=>{
  if(!durable)return manager.details(scope);
  const status=await durable.status(scope),binding=status.configured?await durable.capture(scope):undefined;
  if(binding&&binding.revision!==status.revision)throw new AppError('Connector connection changed during the request.','CONNECTOR_CONNECTION_CHANGED',409);
  await authorize(scope);
  return {...status,connectorName:'n8n' as const,status:status.status as 'not_configured'|'disconnected'|'configured_unverified',
   mode:'mock' as const,storage:'postgres_durable' as const,managementEnabled:true,liveProvidersStatus:'not_configured' as const,
   selectedProfileId:binding?.profileId??null,profiles:options.durable!.profiles.filter(p=>p.workspaceId===scope.workspaceId).map(p=>({id:p.id,label:p.label}))};
 };
 const preHandler=[async(_request:unknown,reply:FastifyReply)=>{reply.header('Cache-Control','no-store');},app.requireAuth];
 app.get('/connectors/n8n/connection',{preHandler,schema:{tags:['n8n'],response:{200:N8nConnectionDetailsSchema}}},async request=>{
  await authorize(request.scope!,'n8n.connection.viewed',{localOnly:true});return details(request.scope!);
 });
 app.put<{Body:N8nConfigureConnection}>('/connectors/n8n/connection',{
  preHandler,
  // Fastify normally strips additional properties; reject secret/endpoint input before that transformation.
  preValidation:async request=>{
   const body=request.body;
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='profileId'))
    throw new ValidationError('Only an approved server profile ID is accepted.');
  },
  schema:{tags:['n8n'],body:N8nConfigureConnectionSchema,response:{200:N8nConnectionDetailsSchema}}
 },async request=>{
  await authorize(request.scope!);
  if(durable)await durable.configure(request.scope!,request.body.profileId,expected(request.headers['if-match']));
  const result=durable?await details(request.scope!):await manager.configure(request.scope!,request.body);
  await authorize(request.scope!);return result;
 });
 app.delete('/connectors/n8n/connection',{preHandler,schema:{tags:['n8n'],response:{200:N8nConnectionDetailsSchema}}},async request=>{
  await authorize(request.scope!);
  if(durable)await durable.disconnect(request.scope!,expected(request.headers['if-match']));
  const result=durable?await details(request.scope!):await manager.disconnect(request.scope!);
  await authorize(request.scope!);return result;
 });
 const diagnostics:LocalConnectorDiagnosticReader={connectorName:'n8n',connectionScope:'workspace',
  storageKind:durable?'postgres_durable':options.connections?'ephemeral_encrypted_mock':'unavailable',kmsStatus:durable?'mock_only':'not_configured',
  read:async scope=>{
   const value=durable?await durable.status(scope):manager.details(scope);
   return {connectionState:value.status as 'not_configured'|'disconnected'|'configured_unverified',storageStatus:durable||options.connections?'readable':'not_configured'};
  }};
 return {details,diagnostics,transport:async(scope:AuthenticatedScope)=>{
  if(!durable)return manager.transport(scope.workspaceId);
  const status=await durable.status(scope);
  return status.configured&&options.durable!.transportFactory?durable.transport(scope):undefined;
 }};
}
