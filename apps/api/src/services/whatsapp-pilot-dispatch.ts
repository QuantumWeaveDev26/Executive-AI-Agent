import type { WhatsAppDispatcher } from './whatsapp-durable.js';

/**
 * Pilot-only hand-over of a reserved dispatch to the Thaara outgoing n8n workflow over the private Docker
 * network. Fixed internal origin, no redirects, short timeout, file-backed webhook secret (pilot exception).
 * It carries only the dispatch ID and revision: n8n must claim through the authenticated relay, where
 * approval, revision, opt-in, 24 h window and the send profile are re-checked. The n8n response is not
 * trusted as a delivery result; outcomes arrive only through the receipts relay and Meta status events.
 */
export const PILOT_N8N_ORIGIN = 'http://n8n-n8n-1:5678';
export interface PilotDispatchConfig {
  webhookPath: string;
  headerName: string;
  secret: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  autoReply?: boolean;
}

export function createPilotWhatsAppDispatcher(config: PilotDispatchConfig): WhatsAppDispatcher {
  const { webhookPath, headerName, secret } = config, timeoutMs = config.timeoutMs ?? 15000;
  if (!/^\/webhook\/[a-z0-9][a-z0-9-]{0,79}$/.test(webhookPath) || !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(headerName)
    || /^(authorization|cookie|host)$/i.test(headerName) || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error('Pilot WhatsApp dispatch configuration denied');
  const doFetch = config.fetchImpl ?? fetch;
  return {
    autoReplyEnabled: config.autoReply !== false,
    async submit({ connectionId, revision, dispatchId }) {
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(connectionId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(dispatchId) || !Number.isSafeInteger(revision) || revision < 1) {
        throw Object.assign(new Error('Pilot dispatch input denied'), { preTransmissionFailure: true as const });
      }
      const response = await doFetch(PILOT_N8N_ORIGIN + webhookPath, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', [headerName]: secret },
        body: JSON.stringify({ dispatchId, connectionRevision: revision })
      });
      if (!response.ok) throw new Error('Pilot dispatch hand-over was not accepted');
    }
  };
}
