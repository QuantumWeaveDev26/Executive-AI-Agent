import type { FastifyInstance } from 'fastify';
import { PhoneCallbackReportListSchema } from '@thaara/contracts';
import { readCallbackReports, type PhoneCallbackReportReader } from '../services/phone-callback-reports.js';

export async function phoneCallbackReportRoutes(app: FastifyInstance, reader?: PhoneCallbackReportReader) {
  if (reader && process.env.NODE_ENV !== 'test') throw new Error('Callback report storage requires production admission.');
  app.get('/connectors/phone/callbacks/reports', {
    preHandler: [app.requireAuth], schema: { response: { 200: PhoneCallbackReportListSchema } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return readCallbackReports(request.scope!, reader);
  });
}
