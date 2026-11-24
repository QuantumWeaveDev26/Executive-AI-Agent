import type {FastifyInstance} from 'fastify';
import {Type} from '@sinclair/typebox';
import {PhoneInboundListSchema,PhoneInboundDetailSchema} from '@thaara/contracts';
import {readInboundReports,type PhoneInboundReportReader} from '../services/phone-inbound-reports.js';
import type {InboundJournalReportFeed} from '../services/phone-inbound-journal-feed.js';

/** Owner-only read API. No public intake or booking endpoint; absent feed returns not_configured. */
export async function phoneInboundReportRoutes(app:FastifyInstance,reader?:PhoneInboundReportReader,journalFeed?:InboundJournalReportFeed){
 if(journalFeed&&process.env.NODE_ENV!=='test')throw Error('Inbound journal routes are test-only pending production admission.');
 if(journalFeed&&reader)throw Error('Inbound report sources are ambiguous.');
 const feed=journalFeed?Object.freeze({list:journalFeed.list.bind(journalFeed),detail:journalFeed.detail.bind(journalFeed)}):undefined;
 const preHandler=[app.requireAuth];
 const noStore=async(_r:unknown,reply:{header(name:string,value:string):unknown})=>{reply.header('Cache-Control','no-store');reply.header('Referrer-Policy','no-referrer');};
 app.get('/connectors/phone/inbound/reports',{preHandler,onSend:noStore,schema:{response:{200:PhoneInboundListSchema}}},
  r=>feed?feed.list(r.scope!):readInboundReports(r.scope!,reader));
 app.get<{Params:{id:string}}>('/connectors/phone/inbound/reports/:id',{preHandler,onSend:noStore,schema:{params:Type.Object({id:Type.String({pattern:'^[A-Za-z0-9_-]{1,128}$'})},{additionalProperties:false}),response:{200:PhoneInboundDetailSchema}}},
  r=>feed?feed.detail(r.scope!,r.params.id):readInboundReports(r.scope!,reader,r.params.id));
}
