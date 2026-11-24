
import { Type,Static } from '@sinclair/typebox';
export const N8nCreateInactiveSchema=Type.Object({
 artifactId:Type.String({pattern:'^stg_[a-f0-9]{16}$'}),
 workflowHash:Type.String({pattern:'^[a-f0-9]{64}$'})
},{additionalProperties:false});
export type N8nCreateInactive=Static<typeof N8nCreateInactiveSchema>;
export const N8nConnectionStatusSchema=Type.Object({
 connectorName:Type.Literal('n8n'),configured:Type.Boolean(),
 status:Type.Union([Type.Literal('not_configured'),Type.Literal('configured_unverified')]),
 mode:Type.Union([Type.Literal('disabled'),Type.Literal('mock'),Type.Literal('live')]),
 liveProvidersStatus:Type.Literal('not_configured')
},{additionalProperties:false});
export const N8nRunResponseSchema=Type.Object({
 planId:Type.String({format:'uuid'}),stepId:Type.String({format:'uuid'}),
 receiptId:Type.Union([Type.String({format:'uuid'}),Type.Null()]),
 status:Type.Union(['queued','running','verified','failed','unverified','not_configured'].map(s=>Type.Literal(s))),
 workflowId:Type.Union([Type.String(),Type.Null()]),workflowName:Type.Union([Type.String(),Type.Null()]),
 active:Type.Union([Type.Literal(false),Type.Null()]),
 verificationMethod:Type.Union([Type.String(),Type.Null()]),liveProvidersStatus:Type.Literal('not_configured')
},{additionalProperties:false});

export const N8nConfigureConnectionSchema=Type.Object({profileId:Type.String({pattern:'^[a-zA-Z0-9_-]{1,64}$'})},{additionalProperties:false});
export type N8nConfigureConnection=Static<typeof N8nConfigureConnectionSchema>;
export const N8nConnectionDetailsSchema=Type.Object({
 connectorName:Type.Literal('n8n'),status:Type.Union(['not_configured','disconnected','configured_unverified'].map(s=>Type.Literal(s))),
 configured:Type.Boolean(),mode:Type.Union([Type.Literal('disabled'),Type.Literal('mock')]),
 managementEnabled:Type.Boolean(),storage:Type.Union([Type.Literal('unavailable'),Type.Literal('ephemeral_encrypted_mock'),Type.Literal('postgres_durable')]),
 revision:Type.Optional(Type.Integer({minimum:0,maximum:Number.MAX_SAFE_INTEGER-1})),
 selectedProfileId:Type.Union([Type.String(),Type.Null()]),
 profiles:Type.Array(Type.Object({id:Type.String(),label:Type.String()},{additionalProperties:false})),
 liveProvidersStatus:Type.Literal('not_configured')
},{additionalProperties:false});
export type N8nConnectionDetails=Static<typeof N8nConnectionDetailsSchema>;
