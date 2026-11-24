#!/usr/bin/env node
/**
 * Focused End-to-End Offline Validation for Verified Live Sarvam Runtime Shapes:
 * 1. Mid-call (`During the conversation`) `save_callback_request` WITHOUT `callContext.transcript`
 *    (non-LLM `Agent variable` bindings: `interactionId`, `incomingNumber`, `appId`, `appVersion`, `agentPhoneNumber`).
 * 2. End-of-call (`When the call ends`) `complete_inbound_call` WITH real Sarvam Monitor shapes:
 *    - `{ transcript: [{ role: "assistant"|"user", content, english_content, tools, ... }] }` (and JSON-stringified form)
 *    - Formatted IST timestamps (`"Nov 14, 2026, 12:15:13 PM"`), ISO `+05:30`, and ISO `...Z`
 *    - Integer and stringified `app_version` (`24` / `"24"`) and float/string `duration` (`300.5` / `"142.5"`)
 *    - Closing `"No, thanks"` after confirmed save does NOT cancel callback
 *    - Explicit withdrawal or unconfirmed hallucinated tool call cancels callback (`0` emails)
 * 3. Standing-service automatic email dispatch (`notifications@brandmintai.io` -> `connect@brandmintai.io`,
 *    subject `New Callback Request — Thaara AI`, PolicyGateway + idempotency verified, zero 30-day Dashboard grant).
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const PKG = path.join(ROOT, 'artifacts/phone115-sarvam-live-release-20261114-r3');

const origEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const code = typeof args[0] === 'object' ? args[0]?.code : args[1];
  if (code === 'FSTDEP023' || String(warning).includes('FSTDEP023')) return;
  return origEmitWarning(warning, ...args);
};

// Hard-block any accidental outbound sockets/HTTP
import net from 'node:net';
import tls from 'node:tls';
net.Socket.prototype.connect = () => { throw new Error('OFFLINE_VIOLATION'); };
tls.connect = () => { throw new Error('OFFLINE_VIOLATION'); };
globalThis.fetch = async () => { throw new Error('OFFLINE_VIOLATION'); };

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function findPnpmEntry(pnpmRoot, prefix, rel) {
  const dir = fs.readdirSync(pnpmRoot).find(d => d.startsWith(prefix));
  if (!dir) throw new Error(`Missing ${prefix}`);
  return pathToFileURL(path.join(pnpmRoot, dir, 'node_modules', rel)).href;
}

const CALLBACK_INTAKE_ATTESTATIONS = [
  { signature: 'public.phone_callback_intake_finalize(text)', ownerRole: 'thaara_phone_guard', securityDefiner: true, definitionSha256: '26f12a9508623926057a534cf397620a5bbb984ace0bf0ee7a140155f81b7175' },
  { signature: 'public.phone_callback_intake_save(jsonb)', ownerRole: 'thaara_phone_guard', securityDefiner: true, definitionSha256: '971ef97b34974e0cc0c6f9af84c895647a57461de466f99f7494961e421e3e31' },
];

function createMockStack({ inboundProfile, profileFingerprint, rawInboundToken, rawWorkerToken, configurationId }) {
  const inboundHash = crypto.createHash('sha256').update(rawInboundToken).digest('hex');
  const workerHash = crypto.createHash('sha256').update(rawWorkerToken).digest('hex');
  const state = {
    grant: {
      routeId: inboundProfile.routeId,
      workspaceId: inboundProfile.workspaceId,
      ownerUserId: inboundProfile.ownerUserId,
      principalId: inboundProfile.principalId,
      revision: inboundProfile.revision,
      profileFingerprint,
      tokenHash: inboundHash,
      activeOwner: true,
      revokedAt: null,
      expiresAt: '2027-12-31T23:59:59.000Z',
      operations: ['callback', 'completion'],
    },
    standingConfig: {
      configurationId,
      workspaceId: inboundProfile.workspaceId,
      userId: inboundProfile.ownerUserId,
      enabled: true,
      workerTokenHash: workerHash,
    },
    callbackRequests: [],
    callEvents: [],
    auditEvents: [],
    sentEmails: [],
  };

  function resolveGrant(w, h, r, op) {
    const g = state.grant;
    if (!g || g.tokenHash !== h || g.routeId !== r || !g.operations.includes(op)) return null;
    w.locals.set('app.phone_inbound_hash', h);
    w.locals.set('app.phone_inbound_route', r);
    w.locals.set('app.phone_inbound_operation', op);
    w.locals.set('app.phone_inbound_workspace_id', g.workspaceId);
    w.locals.set('app.phone_inbound_owner_user_id', g.ownerUserId);
    return structuredClone(g);
  }

  const ingestPool = Object.freeze({
    async connect() {
      let tx = null;
      return {
        async query(sql, params = []) {
          const t = sql.trim();
          if (t.includes('publicExecute') && t.includes('AS functions')) {
            return { rows: [{ role_name: 'thaara_phone_ingest', session_role_name: 'thaara_phone_ingest', functions: CALLBACK_INTAKE_ATTESTATIONS.map(a => ({ ...a, canExecute: true, publicExecute: false })) }], rowCount: 1 };
          }
          if (t === 'BEGIN') {
            tx = { callbackRequests: structuredClone(state.callbackRequests), callEvents: structuredClone(state.callEvents), auditEvents: structuredClone(state.auditEvents), locals: new Map() };
            return { rows: [], rowCount: 0 };
          }
          if (t.startsWith('SET LOCAL ')) return { rows: [], rowCount: 0 };
          if (t.includes('phone_inbound_role_preflight')) {
            return { rows: [{ role_name: 'thaara_phone_ingest', session_role_name: 'thaara_phone_ingest', schema_create: false, rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolinherit: false, elevated_membership: false, owns_protected: false, journal_rls: true, journal_force_rls: true, direct_journal_access: false, direct_protected_access: false }], rowCount: 1 };
          }
          if (t.startsWith("SELECT pg_catalog.set_config('app.session_token_hash'")) return { rows: [{}], rowCount: 1 };
          if (t.startsWith('SELECT grant_record FROM public.phone_inbound_resolve_grant')) {
            const g = resolveGrant(tx, params[0], params[1], params[2]);
            return g ? { rows: [{ grant_record: g }], rowCount: 1 } : { rows: [], rowCount: 0 };
          }
          if (t.startsWith('SELECT public.phone_callback_intake_save')) {
            const p = JSON.parse(params[0]);
            const d = p.details;
            let r = tx.callbackRequests.find(x => x.request_id === p.id);
            if (!r) {
              r = { workspace_id: p.workspaceId, owner_user_id: p.ownerUserId, request_id: p.id, call_id: p.callId, direction: 'inbound', request_hash: p.hash, details: structuredClone(d), occurred_at: '2026-11-14T06:45:00.000Z', request_status: 'requested', notification_status: 'needs_review', attempts: 0, notification_attempt_id: null, provider_message_id: null };
              tx.callbackRequests.push(r);
              tx.auditEvents.push({ action: 'phone.callback.inbound_saved', target_id: p.id, payload: { capturePhase: 'during_call', status: 'needs_review' } });
            } else if (r.request_hash !== p.hash) {
              r.details = { ...r.details, reviewRequired: true };
              r.notification_status = 'needs_review';
              return { rows: [{ receipt: { saved: false, reviewRequired: true, requestId: p.id, workspaceId: p.workspaceId, ownerUserId: p.ownerUserId, callId: r.call_id } }], rowCount: 1 };
            }
            return { rows: [{ receipt: { saved: true, requestId: r.request_id, requestHash: r.request_hash, workspaceId: r.workspace_id, ownerUserId: r.owner_user_id, callId: r.call_id, details: structuredClone(r.details), ownerNotification: 'pending' } }], rowCount: 1 };
          }
          if (t.startsWith('SELECT public.phone_inbound_append_event')) {
            const ev = JSON.parse(params[0]);
            const existing = tx.callEvents.filter(e => e.call_id === ev.callId);
            let duplicate = false;
            if (existing.some(e => e.eventId === ev.eventId)) duplicate = true;
            else {
              const rec = { workspace_id: ev.report.workspaceId, owner_user_id: ev.report.ownerUserId, call_id: ev.callId, eventId: ev.eventId, kind: ev.kind, sequence: existing.length + 1, sourceDigest: ev.sourceDigest, report: structuredClone(ev.report) };
              tx.callEvents.push(rec);
              existing.push(rec);
            }
            return { rows: [{ receipt: { saved: true, duplicate, events: existing.map(e => ({ eventId: e.eventId, callId: e.call_id, kind: e.kind, sequence: e.sequence, sourceDigest: e.sourceDigest, report: structuredClone(e.report) })) } }], rowCount: 1 };
          }
          if (t.startsWith('SELECT public.phone_callback_intake_finalize')) {
            const callId = params[0];
            const r = tx.callbackRequests.find(x => x.call_id === callId && x.details?.capturePhase === 'during_call');
            if (!r) return { rows: [{ receipt: { found: false } }], rowCount: 1 };
            const completed = tx.callEvents.find(e => e.call_id === callId && e.kind === 'call_completed');
            if (!completed || completed.report?.callStatus !== 'ended' || completed.report?.callerPhone !== r.details.phoneNumber) {
              throw new Error('Callback intake completion binding denied');
            }
            if (r.details?.reviewRequired === true) return { rows: [{ receipt: { found: true, status: 'needs_review', requestId: r.request_id } }], rowCount: 1 };
            if (r.attempts !== 0 || r.request_status !== 'requested') return { rows: [{ receipt: { found: true, status: r.request_status } }], rowCount: 1 };
            const targetStatus = (completed.report?.callbackConsent === 'declined' || completed.report?.callbackPreference === 'declined') ? 'cancelled' : 'requested';
            const targetNotification = targetStatus === 'cancelled' ? 'needs_review' : 'pending';
            r.request_status = targetStatus;
            r.notification_status = targetNotification;
            tx.auditEvents.push({ action: 'phone.callback.inbound_saved', target_id: r.request_id, payload: { capturePhase: 'call_finalized', status: targetStatus } });
            return { rows: [{ receipt: { found: true, status: targetStatus, requestId: r.request_id } }], rowCount: 1 };
          }
          if (t === 'COMMIT') {
            state.callbackRequests = tx.callbackRequests;
            state.callEvents = tx.callEvents;
            state.auditEvents = tx.auditEvents;
            tx = null;
            return { rows: [], rowCount: 0 };
          }
          if (t === 'ROLLBACK') { tx = null; return { rows: [], rowCount: 0 }; }
          throw new Error(`Unexpected SQL: ${t}`);
        },
        release() {},
      };
    },
    async close() {},
  });

  // Standing-service `public.phone_callback_service_worker_operation` mock
  function toWorkerRow(r) {
    return {
      id: r.request_id,
      workspaceId: r.workspace_id,
      userId: r.owner_user_id,
      callId: r.call_id,
      direction: r.direction,
      name: r.details.name,
      business: r.details.business,
      service: r.details.service,
      phoneNumber: r.details.phoneNumber,
      numberSource: r.details.numberSource,
      email: r.details.email ?? null,
      emailDeclined: r.details.emailDeclined === true,
      discussionDetails: r.details.discussionDetails ?? '',
      capturePhase: r.details.capturePhase,
      occurredAt: r.occurred_at,
      status: r.request_status,
      notificationStatus: r.notification_status,
      notificationAttemptId: r.notification_attempt_id,
      providerMessageId: r.provider_message_id,
      attempts: r.attempts,
    };
  }

  const workerDb = {
    async query(_sql, params) {
      const [hashArg, wsArg, uidArg, op, idArg, attemptArg, outcomeArg, providerIdArg, configIdArg] = params;
      if (hashArg !== state.standingConfig.workerTokenHash || wsArg !== state.standingConfig.workspaceId || uidArg !== state.standingConfig.userId) {
        throw new Error('Standing worker principal denied');
      }
      let data = null;
      if (op === 'recover') data = 0;
      else if (op === 'pending') {
        data = state.callbackRequests.filter(r => r.workspace_id === wsArg && r.owner_user_id === uidArg && r.request_status === 'requested' && r.notification_status === 'pending' && r.attempts < 2).map(r => r.request_id);
      } else if (op === 'read') {
        const r = state.callbackRequests.find(x => x.request_id === idArg);
        data = r ? toWorkerRow(r) : null;
      } else if (op === 'grant') {
        data = state.standingConfig.enabled ? {
          kind: 'standing_callback_notification',
          enabled: true,
          configurationId: state.standingConfig.configurationId,
          workspaceId: wsArg,
          userId: uidArg,
          authorizedByUserId: uidArg,
          sender: 'notifications@brandmintai.io',
          recipient: 'connect@brandmintai.io',
        } : null;
      } else if (op === 'claim') {
        const r = state.callbackRequests.find(x => x.request_id === idArg);
        if (!r || r.notification_status !== 'pending' || r.request_status !== 'requested' || r.attempts >= 2 || configIdArg !== state.standingConfig.configurationId) {
          data = null;
        } else {
          r.attempts += 1;
          r.notification_status = 'sending';
          r.notification_attempt_id = attemptArg;
          data = r.attempts;
        }
      } else if (op === 'finish') {
        const r = state.callbackRequests.find(x => x.request_id === idArg && x.notification_attempt_id === attemptArg);
        if (r) {
          r.notification_status = outcomeArg === 'submitted' ? 'sent' : outcomeArg;
          r.provider_message_id = providerIdArg ?? null;
        }
        data = true;
      }
      return { rows: [{ result: { workspaceId: wsArg, userId: uidArg, data } }], rowCount: 1 };
    },
  };

  return { ingestPool, workerDb, state };
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thaara-phone115-live-compat-'));
  const apiDir = path.join(tempRoot, 'apps/api');
  try {
    // Stage compiled `phone-*.js` services (fast <0.3s, replacing pre-r15 test-only guards as r15 does) + r15 `isAdmittedInboundPrincipalGate`
    fs.mkdirSync(path.join(apiDir, 'dist/services'), { recursive: true });
    for (const svc of fs.readdirSync(path.join(ROOT, 'apps/api/dist/services')).filter(f => f.startsWith('phone-') && f.endsWith('.js'))) {
      const content = fs.readFileSync(path.join(ROOT, 'apps/api/dist/services', svc), 'utf8').replaceAll("process.env.NODE_ENV !== 'test'", 'false');
      fs.writeFileSync(path.join(apiDir, 'dist/services', svc), content);
    }
    const basePrincipal = fs.readFileSync(path.join(apiDir, 'dist/services/phone-inbound-principal.js'), 'utf8');
    fs.writeFileSync(path.join(apiDir, 'dist/services/phone-inbound-principal.js'), basePrincipal
      .replace('export function createInboundPrincipalGate(', 'const __gates = new WeakSet();\nexport function isAdmittedInboundPrincipalGate(g) { return !!g && typeof g === "object" && __gates.has(g); }\nexport function __rawCreateInboundPrincipalGate(')
      + '\nexport function createInboundPrincipalGate(opts) { const g = Object.freeze(__rawCreateInboundPrincipalGate(opts)); __gates.add(g); return g; }\n');
    for (const pkg of ['contracts', 'observability', 'policy']) {
      copyDir(path.join(ROOT, `packages/${pkg}/dist`), path.join(apiDir, `node_modules/@thaara/${pkg}/dist`));
      fs.writeFileSync(path.join(apiDir, `node_modules/@thaara/${pkg}/package.json`), JSON.stringify({ name: `@thaara/${pkg}`, type: 'module', exports: { '.': './dist/index.js', './*': './dist/*' } }, null, 2));
    }
    // Append re-export of `./phone-callback-intake.js` to staged `@thaara/contracts/dist/index.js` matching r15
    const contractsIndex = path.join(apiDir, 'node_modules/@thaara/contracts/dist/index.js');
    fs.appendFileSync(contractsIndex, "\nexport * from './phone-callback-intake.js';\n");

    // Stage unchanged intake routes / store / readiness matching r15
    fs.writeFileSync(path.join(apiDir, 'phone-callback-intake-store.mjs'), `
export async function saveCallbackIntakeInTransaction(tx,request){
  const result=await tx.query('SELECT public.phone_callback_intake_save($1::jsonb) AS receipt',[JSON.stringify(request)]);
  if(result.rows.length!==1||!result.rows[0]?.receipt)throw Error('Callback request save could not be verified.');
  return result.rows[0].receipt;
}
export async function finalizeCallbackIntakeInTransaction(tx,callId){
  const result=await tx.query('SELECT public.phone_callback_intake_finalize($1) AS receipt',[callId]);
  const receipt=result.rows[0]?.receipt;
  if(result.rows.length!==1||!receipt||typeof receipt.found!=='boolean')throw Error('Callback intake finalization could not be verified.');
  return receipt;
}
`);
    fs.writeFileSync(path.join(apiDir, 'phone-callback-intake-readiness.mjs'), `
import {isAdmittedPhoneCallbackPool} from './dist/services/phone-callback-startup.js';
export const CALLBACK_INTAKE_ATTESTATIONS=Object.freeze([
 Object.freeze({signature:'public.phone_callback_intake_finalize(text)',ownerRole:'thaara_phone_guard',securityDefiner:true,definitionSha256:'26f12a9508623926057a534cf397620a5bbb984ace0bf0ee7a140155f81b7175'}),
 Object.freeze({signature:'public.phone_callback_intake_save(jsonb)',ownerRole:'thaara_phone_guard',securityDefiner:true,definitionSha256:'971ef97b34974e0cc0c6f9af84c895647a57461de466f99f7494961e421e3e31'}),
]);
const sql="SELECT current_user AS role_name,session_user AS session_role_name, '[]'::jsonb AS functions";
export async function assertCallbackIntakeReady(pool){
 if(!isAdmittedPhoneCallbackPool(pool,'thaara_phone_ingest'))throw Error('denied');
 const lease=await pool.connect();try{await lease.query('SELECT publicExecute AS functions');}finally{lease.release();}
}
`);
    fs.writeFileSync(path.join(apiDir, 'phone-callback-intake-routes.mjs'), `
import {PhoneCallbackIntakeToolSchema,PhoneCallbackIntakeReceiptSchema} from '@thaara/contracts';
import {isAdmittedPhoneCallbackIntakeService} from './phone-callback-intake-runtime.mjs';
import {createInboundIngressLimiter} from './dist/services/phone-inbound-ingress.js';
import {Value} from '@sinclair/typebox/value';
export async function phoneCallbackIntakeRoutes(app,service){
 if(!isAdmittedPhoneCallbackIntakeService(service))throw Error('denied');
 const handle=service.handle.bind(service),limiter=createInboundIngressLimiter();
 const unavailable=()=>({saved:false,status:'unavailable',missingFields:[]});
 app.post('/connectors/phone/inbound/:routeId/callback-request',{
  bodyLimit:65536,logLevel:'silent',
  preValidation:async(request,reply)=>{if(!Value.Check(PhoneCallbackIntakeToolSchema,request.body))return reply.code(400).send(unavailable());},
  schema:{params:{type:'object',properties:{routeId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,128}$'}},required:['routeId'],additionalProperties:false},
   body:PhoneCallbackIntakeToolSchema,response:{200:PhoneCallbackIntakeReceiptSchema,503:PhoneCallbackIntakeReceiptSchema}},
 },async(request,reply)=>{
  const release=limiter.acquire();if(!release)return reply.code(429).send(unavailable());
  try{const result=await handle(request.params.routeId,request.headers.authorization,request.body);
   return reply.code(result.status==='unavailable'?503:200).send(result);
  }catch{return reply.code(503).send(unavailable());}finally{release();}
 });
}
`);

    // Stage r15-equivalent `phone-sarvam-inbound-service.js` calling `finalizeCallbackIntakeInTransaction`
    fs.writeFileSync(path.join(apiDir, 'dist/services/phone-sarvam-inbound-service.js'), `
import { computeCanonicalParameterHash } from '@thaara/contracts';
import { ForbiddenError } from '@thaara/observability';
import { createInboundPrincipalGate } from './phone-inbound-principal.js';
import { createInboundPrincipalJournal } from './phone-inbound-principal-journal.js';
import { normalizeSarvamInboundPayload } from './phone-sarvam-inbound-normalize.js';
import { finalizeCallbackIntakeInTransaction } from '../../phone-callback-intake-store.mjs';
const admitted = new WeakSet();
const deny = () => { throw new ForbiddenError('Inbound service request could not be confirmed.'); };
export function isAdmittedSarvamInboundService(v) { return !!v && typeof v === 'object' && admitted.has(v); }
export function buildInboundServiceBinding(input) {
  const p = structuredClone(input);
  const profileFingerprint = computeCanonicalParameterHash({ ...p, policy: 'phone.inbound.service.v1', direction: 'inbound', callbackMeaning: 'human_team_request', consentPolicy: 'explicit-recap.v1', mediaRetention: 'off', calendarBooking: 'disabled' });
  return Object.freeze({ routeId: p.routeId, workspaceId: p.workspaceId, ownerUserId: p.ownerUserId, principalId: p.principalId, revision: p.revision, profileFingerprint });
}
export function createSarvamInboundService(options) {
  const intakeApproved = process.env.THAARA_PHONE_CALLBACK_INTAKE === 'approved';
  const profile = Object.freeze(structuredClone(options.profile)), binding = buildInboundServiceBinding(profile), now = options.now ?? Date.now;
  const journal = createInboundPrincipalJournal(createInboundPrincipalGate({ profile: binding, transactions: options.transactions, now }));
  const svc = Object.freeze({
    async complete(routeId, authorization, payload) {
      const { report } = await journal.appendPrepared(routeId, authorization, 'completion', async () => {
        const snapshot = structuredClone(payload);
        const normalized = await normalizeSarvamInboundPayload(profile, snapshot, { now });
        const report = normalized.report;
        return {
          event: { eventId: 'call_completed-' + report.id, callId: report.id, kind: 'call_completed', sourceDigest: normalized.sourceDigest, report },
          matchesCommitted: normalized.matchesCommitted,
          afterAppend: intakeApproved && report.callStatus === 'ended' ? async (tx) => {
            await finalizeCallbackIntakeInTransaction(tx, report.id);
          } : undefined,
        };
      });
      return { saved: true, reportId: report.id, outcome: report.outcome };
    },
  });
  admitted.add(svc);
  return svc;
}
`);

    // Overlay our 6 candidate files from `artifacts/phone115-sarvam-live-release-20261114-r1`
    copyDir(path.join(PKG, 'apps/api'), apiDir);

    // Also stage standing-service worker logic (mirroring `phone115-standing-service-20261114-r5`)
    fs.writeFileSync(path.join(apiDir, 'dist/services/standing-worker-harness.mjs'), `
import { createHash, randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { ActionRegistry, PolicyGateway } from '@thaara/policy';
import { createPhoneCallbackQueue } from './phone-callback-queue.js';

function formatAutomaticCallbackEmail(request) {
  const text = (value) => typeof value === 'string' ? value.replace(/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu, ' ').trim().slice(0, 2000) : '';
  return {
    subject: 'New Callback Request — Thaara AI',
    bodyText: [
      'New Callback Request',
      'Customer name: ' + text(request.name),
      'Business name: ' + text(request.business),
      'Phone: ' + text(request.phoneNumber),
      'Email: ' + (request.emailDeclined === true ? 'Declined by caller' : text(request.email)),
      'Services requested: ' + text(request.service),
      'Relevant conversation context:',
      text(request.discussionDetails),
      'Call ID: ' + text(request.callId),
      'Callback request ID: ' + request.id,
      'Created: ' + text(request.occurredAt),
    ].join('\\n'),
  };
}

export function createStandingWorkerForTest({ scope, db, credential, transport }) {
  const hash = async () => createHash('sha256').update(await credential()).digest('hex');
  const op = async (name, id, attempt, outcome, providerId, configId) => {
    const res = await db.query('SELECT public.phone_callback_service_worker_operation($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result', [
      await hash(), scope.workspaceId, scope.userId, name, id ?? null, attempt ?? null, outcome ?? null, providerId ?? null, configId ?? null,
    ]);
    return res.rows[0].result.data;
  };
  const repository = {
    read: (_s, id) => op('read', id),
    claim: (_s, id, attempt, configId) => op('claim', id, attempt, undefined, undefined, configId),
    finish: (_s, id, attempt, outcome, providerId) => op('finish', id, attempt, outcome, providerId),
    pending: () => op('pending'),
    recoverInterrupted: () => op('recover'),
  };
  const registry = new ActionRegistry();
  registry.register({
    metadata: { name: 'phone.callback.notify_company', actionClass: 'write', risk: 'high', approvalMode: 'none', idempotencyRequired: true, timeoutMs: 10000, retryPolicy: { maxRetries: 0, backoffMs: 0, exponential: false }, requiredRole: 'owner', auditRequired: true, capabilityScope: 'external_connector', schemaIdentifier: 'phone.callback.notify_company.v1' },
    inputSchema: Type.Object({ requestId: Type.String({ pattern: '^[a-f0-9]{64}$' }), to: Type.String(), from: Type.String() }, { additionalProperties: false }),
  });
  const policy = new PolicyGateway({ registry });
  const notify = async (s, requestId) => {
    const request = await repository.read(s, requestId);
    if (!request || request.notificationStatus !== 'pending' || request.status !== 'requested') return 'not_eligible';
    const grant = await op('grant');
    if (!grant || grant.kind !== 'standing_callback_notification' || grant.enabled !== true) return 'awaiting_owner_authorization';
    const idempotencyKey = 'callback:' + requestId;
    if (!policy.evaluate({ ...s, role: 'owner' }, { actionName: 'phone.callback.notify_company', parameters: { requestId, to: grant.recipient, from: grant.sender }, idempotencyKey }).allowed) {
      return 'awaiting_owner_authorization';
    }
    const attempt = randomUUID();
    const claimed = await repository.claim(s, requestId, attempt, grant.configurationId);
    if (claimed === null) return 'not_eligible';
    const res = await transport.send({ ...formatAutomaticCallbackEmail(request), to: grant.recipient, from: grant.sender, idempotencyKey });
    await repository.finish(s, requestId, attempt, 'submitted', res.acceptedId);
    return 'submitted';
  };
  const drain = createPhoneCallbackQueue({ repository, notify });
  return { run: () => drain(scope) };
}
`);
    fs.writeFileSync(path.join(apiDir, 'package.json'), JSON.stringify({ name: '@thaara/api-compat-test', type: 'module' }, null, 2));

    const pnpmRoot = path.join(ROOT, 'node_modules/.pnpm');
    const fastifyUrl = findPnpmEntry(pnpmRoot, 'fastify@', 'fastify/fastify.js');
    const typeboxBase = findPnpmEntry(pnpmRoot, '@sinclair+typebox@', '@sinclair/typebox/build/esm/');
    const contractsUrl = pathToFileURL(path.join(apiDir, 'node_modules/@thaara/contracts/dist/index.js')).href;
    const observabilityUrl = pathToFileURL(path.join(apiDir, 'node_modules/@thaara/observability/dist/index.js')).href;
    const policyUrl = pathToFileURL(path.join(apiDir, 'node_modules/@thaara/policy/dist/index.js')).href;
    const mockStartup = `
      const admitted = new WeakMap();
      export function isAdmittedPhoneCallbackPool(pool, role) { return admitted.get(pool)?.role === role; }
      export function matchesPhoneCallbackPoolBinding(pool, binding, role = 'thaara_phone_ingest') { return isAdmittedPhoneCallbackPool(pool, role) && !!binding; }
      export async function openPhoneCallbackIngestResources({ environment }) { return globalThis.__TEST_RESOURCES__({ environment, registerPool(p, r, b) { admitted.set(p, { role: r, binding: b }); }, revokePool(p) { admitted.delete(p); } }); }
    `;
    fs.writeFileSync(path.join(apiDir, 'dist/services/phone-callback-startup.js'), mockStartup);
    const loader = `
      const map = ${JSON.stringify({ fastify: fastifyUrl, '@sinclair/typebox': new URL('index.mjs', typeboxBase).href, '@thaara/contracts': contractsUrl, '@thaara/observability': observabilityUrl, '@thaara/policy': policyUrl })};
      const tb = ${JSON.stringify(typeboxBase)};
      export async function resolve(spec, ctx, next) {
        if (Object.hasOwn(map, spec)) return { url: map[spec], shortCircuit: true };
        if (spec.startsWith('@sinclair/typebox/')) return { url: new URL(spec.slice('@sinclair/typebox/'.length) + '/index.mjs', tb).href, shortCircuit: true };
        return next(spec, ctx);
      }
    `;
    register(`data:text/javascript;base64,${Buffer.from(loader, 'utf8').toString('base64')}`);

    process.env.NODE_ENV = 'production';
    process.env.THAARA_PHONE_CALLBACK_INTAKE = 'approved';

    const { createPhoneCallbackReceiver } = await import(pathToFileURL(path.join(apiDir, 'phone-callback-receiver.mjs')).href);
    const { CALLBACK_SAVED_RESPONSE } = await import(pathToFileURL(path.join(apiDir, 'phone-callback-intake.mjs')).href);
    const { buildInboundServiceBinding } = await import(pathToFileURL(path.join(apiDir, 'dist/services/phone-sarvam-inbound-service.js')).href);
    const { createStandingWorkerForTest } = await import(pathToFileURL(path.join(apiDir, 'dist/services/standing-worker-harness.mjs')).href);

    const ROUTE_ID = 'qw-callback-dd60ce8ff4e842df8d19ab50674810c2';
    const INBOUND_TOKEN = 'synthetic_sarvam_inbound_secret_token_20261114';
    const WORKER_TOKEN = 'synthetic_standing_worker_secret_token_20261114';
    const CONFIG_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const PROFILE = {
      routeId: ROUTE_ID,
      workspaceId: '11111111-2222-4333-8444-555555555555',
      ownerUserId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
      principalId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      revision: 2,
      appId: 'Thaara-AI-V-db336de4-5453',
      appVersion: 24,
      deploymentId: 'Thaara-V2---6bdfef25-f9ad',
      agentPhoneNumber: '+918064269780',
      maxCallLengthSeconds: 300,
    };

    async function boot() {
      const binding = buildInboundServiceBinding(PROFILE);
      const mock = createMockStack({ inboundProfile: PROFILE, profileFingerprint: binding.profileFingerprint, rawInboundToken: INBOUND_TOKEN, rawWorkerToken: WORKER_TOKEN, configurationId: CONFIG_ID });
      globalThis.__TEST_RESOURCES__ = async ({ registerPool, revokePool }) => {
        registerPool(mock.ingestPool, 'thaara_phone_ingest', binding);
        return { status: 'resources_ready', runtimeAdmitted: false, profileFingerprint: binding.profileFingerprint, inboundProfile: PROFILE, ingestPool: mock.ingestPool, async close() { revokePool(mock.ingestPool); } };
      };
      const receiver = await createPhoneCallbackReceiver({ THAARA_PHONE_CALLBACK_RECEIVER: 'approved' });
      assert.equal(receiver.status, 'ready');
      const worker = createStandingWorkerForTest({
        scope: { workspaceId: PROFILE.workspaceId, userId: PROFILE.ownerUserId },
        db: mock.workerDb,
        credential: async () => WORKER_TOKEN,
        transport: {
          sender: 'notifications@brandmintai.io',
          ready: async () => true,
          async send(mail) { mock.state.sentEmails.push(mail); return { acceptedId: 're_msg_' + (mock.state.sentEmails.length) }; },
        },
      });
      return { receiver, worker, state: mock.state };
    }

    const results = [];
    async function test(id, title, fn) {
      await fn();
      results.push({ id, title, passed: true });
    }

    // -------------------------------------------------------------------------
    // TEST 1: Live Sarvam Mid-Call (`During the conversation` — no transcript)
    //         + End-of-Call (`When the call ends` — real Monitor `{ transcript: [...] }`
    //         + closing `"No, thanks"` + formatted IST timestamps + string app_version)
    //         + Standing Worker Resend Dispatch
    // -------------------------------------------------------------------------
    await test('L1_E2E_ENGLISH_MONITOR_SHAPE', 'Mid-call save (no transcript) -> held -> Monitor `{transcript:[...]}` completion with closing "No, thanks" -> 1 standing Resend email', async () => {
      const { receiver, worker, state } = await boot();
      try {
        const interactionId = '20261114/c0797629-12:15:00-a1b2c3d4';
        const midCallRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            callContext: {
              interactionId,
              incomingNumber: '+919845012345',
              appId: 'Thaara-AI-V-db336de4-5453',
              appVersion: 24,
              agentPhoneNumber: '+918064269780',
            },
            details: {
              name: 'Rohan Sharma',
              business: 'Kaveri Logistics Pvt Ltd',
              service: 'WhatsApp automation and inbound AI voice agent',
              email: 'rohan@kaverilogistics.in',
              emailDeclined: 'false',
              relevantDetails: 'Need Kannada + English inbound voice support for 150 daily shipment calls.',
              callerConfirmed: 'true',
            },
          },
        });
        assert.equal(midCallRes.statusCode, 200);
        const midBody = midCallRes.json();
        assert.equal(midBody.saved, true);
        assert.equal(midBody.status, 'saved');
        assert.equal(midBody.responseText, CALLBACK_SAVED_RESPONSE);
        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.callbackRequests[0].notification_status, 'needs_review');

        // Worker runs BEFORE call ends -> MUST send 0 emails!
        await worker.run();
        assert.equal(state.sentEmails.length, 0);

        // Call ends -> Sarvam `When the call ends` API Tool sends real Monitor transcript wrapper (JSON-stringified as `json_type: "string"`)
        const monitorTranscript = JSON.stringify({
          transcript: [
            { role: 'assistant', content: "Hello! I'm Thaara, an AI voice assistant from Quantum Weave. Is this a good time to speak with you?", english_content: null, language_name: 'English', turn_id: 1, tools: null, audio_start_time: 0.0, audio_end_time: 4.1 },
            { role: 'user', content: 'Yes, I am Rohan Sharma from Kaveri Logistics Pvt Ltd. Please have your team call me back about WhatsApp automation and inbound AI voice agent.', english_content: null, language_name: 'English', turn_id: 2, tools: null, audio_start_time: 4.5, audio_end_time: 12.2 },
            { role: 'assistant', content: 'To recap: Rohan Sharma from Kaveri Logistics Pvt Ltd, looking for WhatsApp automation and inbound AI voice agent, email rohan@kaverilogistics.in. May I save your callback request with these details?', english_content: null, language_name: 'English', turn_id: 5, tools: null, audio_start_time: 22.0, audio_end_time: 31.4 },
            { role: 'user', content: 'Yes, go ahead please.', english_content: null, language_name: 'English', turn_id: 6, tools: null, audio_start_time: 31.8, audio_end_time: 33.5 },
            { role: 'assistant', content: 'Your callback request has been successfully booked. Our team will contact you soon. Is there anything else I can help you with today?', english_content: null, language_name: 'English', turn_id: 7, tools: [{ name: 'save_callback_request', args: { 'details.name': 'Rohan Sharma' } }], audio_start_time: 34.1, audio_end_time: 41.0 },
            { role: 'user', content: 'No, thanks.', english_content: null, language_name: 'English', turn_id: 8, tools: null, audio_start_time: 41.5, audio_end_time: 42.6 },
          ],
        });

        const compRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/completion/${ROUTE_ID}`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            app_id: 'Thaara-AI-V-db336de4-5453',
            app_version: '24',
            deployment_id: 'Thaara-V2---6bdfef25-f9ad',
            interaction_id: interactionId,
            user_phone_number: '+919845012345',
            agent_phone_number: '+918064269780',
            start_datetime: 'Nov 14, 2026, 12:15:00 PM',
            end_datetime: 'Nov 14, 2026, 12:15:45 PM',
            duration: '45.2',
            interaction_transcript: monitorTranscript,
          },
        });
        assert.equal(compRes.statusCode, 200);
        assert.equal(state.callbackRequests[0].notification_status, 'pending');

        // Standing worker runs -> dispatches exact 1 email via Resend!
        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.equal(state.sentEmails[0].from, 'notifications@brandmintai.io');
        assert.equal(state.sentEmails[0].to, 'connect@brandmintai.io');
        assert.equal(state.sentEmails[0].subject, 'New Callback Request — Thaara AI');
        assert.match(state.sentEmails[0].bodyText, /Customer name: Rohan Sharma/);
        assert.match(state.sentEmails[0].bodyText, /Business name: Kaveri Logistics Pvt Ltd/);
        assert.match(state.sentEmails[0].bodyText, /Phone: \+919845012345/);
        assert.match(state.sentEmails[0].bodyText, /Email: rohan@kaverilogistics\.in/);
        assert.equal(state.callbackRequests[0].notification_status, 'sent');

        // Replay completion + worker run -> idempotent, still 1 email!
        const replayRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/completion/${ROUTE_ID}`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            app_id: 'Thaara-AI-V-db336de4-5453',
            app_version: 24,
            deployment_id: 'Thaara-V2---6bdfef25-f9ad',
            interaction_id: interactionId,
            user_phone_number: '+919845012345',
            agent_phone_number: '+918064269780',
            start_datetime: 'Nov 14, 2026, 12:15:00 PM',
            end_datetime: 'Nov 14, 2026, 12:15:45 PM',
            duration: 45.2,
            interaction_transcript: monitorTranscript,
          },
        });
        assert.equal(replayRes.statusCode, 200);
        await worker.run();
        assert.equal(state.sentEmails.length, 1);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // TEST 2: Missing details (`business: ""`) and unconfirmed (`callerConfirmed: false`)
    // -------------------------------------------------------------------------
    await test('L2_MISSING_AND_UNCONFIRMED', 'Empty string missing field returns 200 needs_details; unconfirmed returns 200 needs_confirmation', async () => {
      const { receiver, state } = await boot();
      try {
        const res1 = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            callContext: { interactionId: '20261114/missing-01', incomingNumber: '+919845012345' },
            details: { name: 'Kavya Hegde', business: '', service: 'AI Voice Agent', email: '', emailDeclined: false, callerConfirmed: true },
          },
        });
        assert.equal(res1.statusCode, 200);
        assert.deepEqual(res1.json(), { saved: false, status: 'needs_details', missingFields: ['business', 'email'] });

        const res2 = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            callContext: { interactionId: '20261114/unconf-01', incomingNumber: '+919845012345' },
            details: { name: 'Kavya Hegde', business: 'Malnad Coffee', service: 'AI Voice Agent', email: null, emailDeclined: true, callerConfirmed: false },
          },
        });
        assert.equal(res2.statusCode, 200);
        assert.deepEqual(res2.json(), { saved: false, status: 'needs_confirmation', missingFields: [] });
        assert.equal(state.callbackRequests.length, 0);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // TEST 3: Spoofed phoneNumber / wrong appVersion / wrong Bearer rejected
    // -------------------------------------------------------------------------
    await test('L3_TRUST_BOUNDARY_REJECTIONS', 'Spoofed details.phoneNumber, workspaceId, wrong appVersion, and missing Bearer are rejected', async () => {
      const { receiver, state } = await boot();
      try {
        const spoofPhone = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            callContext: { interactionId: '20261114/spoof-01', incomingNumber: '+919845012345' },
            details: { name: 'A', business: 'B', service: 'C', emailDeclined: true, phoneNumber: '+919999999999' },
          },
        });
        assert.equal(spoofPhone.statusCode, 400);

        const wrongVer = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            callContext: { interactionId: '20261114/ver-01', incomingNumber: '+919845012345', appVersion: 6 },
            details: { name: 'A', business: 'B', service: 'C', emailDeclined: true, callerConfirmed: true },
          },
        });
        assert.equal(wrongVer.statusCode, 503);
        assert.equal(wrongVer.json().saved, false);

        const noAuthComp = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/completion/${ROUTE_ID}`,
          payload: { app_id: PROFILE.appId, app_version: 24, deployment_id: PROFILE.deploymentId, interaction_id: '20261114/ver-01', user_phone_number: '+919845012345', agent_phone_number: PROFILE.agentPhoneNumber },
        });
        assert.equal(noAuthComp.statusCode, 403);
        assert.equal(state.callbackRequests.length, 0);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // TEST 4: Caller withdrawal OR unconfirmed tool invocation in ended-call transcript cancels notification
    // -------------------------------------------------------------------------
    await test('L4_WITHDRAWAL_AND_HALLUCINATION_BLOCKED', 'Ended-call withdrawal or unconfirmed save_callback_request tool call cancels callback and sends 0 emails', async () => {
      const { receiver, worker, state } = await boot();
      try {
        // Case A: Saved mid-call, then caller says "Actually please don't call me" before hangup
        const idWithdraw = '20261114/withdraw-01';
        await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            callContext: { interactionId: idWithdraw, incomingNumber: '+919845012345' },
            details: { name: 'Ananya', business: 'Nandi Tech', service: 'CRM', emailDeclined: true, callerConfirmed: true },
          },
        });
        const compWithdraw = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/completion/${ROUTE_ID}`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            app_id: PROFILE.appId, app_version: 24, deployment_id: PROFILE.deploymentId,
            interaction_id: idWithdraw, user_phone_number: '+919845012345', agent_phone_number: PROFILE.agentPhoneNumber,
            start_datetime: '2026-11-14T06:00:00Z', end_datetime: '2026-11-14T06:02:00Z', duration: 120,
            interaction_transcript: {
              transcript: [
                { role: 'assistant', content: 'May I save your callback request with these details?', english_content: null },
                { role: 'user', content: 'Yes', english_content: null },
                { role: 'assistant', content: 'Your callback request has been successfully booked. Our team will contact you soon.', tools: [{ name: 'save_callback_request', args: {} }] },
                { role: 'user', content: "Actually please don't call me, cancel the callback.", english_content: null },
              ],
            },
          },
        });
        assert.equal(compWithdraw.statusCode, 200);
        assert.equal(state.callbackRequests[0].request_status, 'cancelled');
        assert.equal(state.callbackRequests[0].notification_status, 'needs_review');

        // Case B: Model invoked `save_callback_request` WITHOUT caller ever confirming in transcript!
        const idUnconfirmed = '20261114/hallucinated-01';
        await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            callContext: { interactionId: idUnconfirmed, incomingNumber: '+919845099999' },
            details: { name: 'Vikram', business: 'Test Co', service: 'Automation', emailDeclined: true, callerConfirmed: true },
          },
        });
        const compUnconfirmed = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/completion/${ROUTE_ID}`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            app_id: PROFILE.appId, app_version: 24, deployment_id: PROFILE.deploymentId,
            interaction_id: idUnconfirmed, user_phone_number: '+919845099999', agent_phone_number: PROFILE.agentPhoneNumber,
            start_datetime: '2026-11-14T06:10:00Z', end_datetime: '2026-11-14T06:11:00Z', duration: 60,
            interaction_transcript: {
              transcript: [
                { role: 'assistant', content: 'May I save your callback request with these details?', english_content: null },
                { role: 'user', content: 'Wait, my business name is wrong, let me think.', english_content: null },
                { role: 'assistant', content: 'Let me check.', tools: [{ name: 'save_callback_request', args: {} }] },
              ],
            },
          },
        });
        assert.equal(compUnconfirmed.statusCode, 200);
        assert.equal(state.callbackRequests[1].request_status, 'cancelled');
        assert.equal(state.callbackRequests[1].notification_status, 'needs_review');

        await worker.run();
        assert.equal(state.sentEmails.length, 0);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // TEST 5: Kannada + Declined Email + >64 turns (e.g. 80 turns) succeeds end-to-end
    // -------------------------------------------------------------------------
    await test('L5_KANNADA_DECLINED_EMAIL_80_TURNS', 'Kannada call with declined email and 80 turns succeeds end-to-end', async () => {
      const { receiver, worker, state } = await boot();
      try {
        const idKn = '20261114/kannada-80turns';
        const midRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            callContext: { interactionId: idKn, incomingNumber: '+919900112233' },
            details: { name: 'Kavya Hegde', business: 'Malnad Coffee Works', service: 'AI Voice Receptionist', email: '', emailDeclined: true, relevantDetails: 'ಒಳಬರುವ ಕರೆಗಳಿಗಾಗಿ ಕನ್ನಡ ವಾಯ್ಸ್ ಏಜೆಂಟ್ ಬೇಕು', callerConfirmed: true },
          },
        });
        assert.equal(midRes.statusCode, 200);
        assert.equal(midRes.json().saved, true);

        const fillerTurns = Array.from({ length: 76 }, (_, idx) => ({
          role: idx % 2 === 0 ? 'assistant' : 'user',
          content: idx % 2 === 0 ? 'ಖಂಡಿತ, ಮತ್ತೇನು ಮಾಹಿತಿ ಬೇಕು?' : 'ಸ್ವಲ್ಪ ವಿವರ ತಿಳಿಸಿ.',
          english_content: idx % 2 === 0 ? 'Sure, what other details do you need?' : 'Please share more details.',
          language_name: 'Kannada',
        }));
        const transcript = {
          transcript: [
            ...fillerTurns,
            { role: 'assistant', content: 'ದೃಢೀಕರಿಸುತ್ತಿದ್ದೇನೆ: ಕಾವ್ಯ ಹೆಗ್ಡೆ, ಮಲೆನಾಡು ಕಾಫಿ ವರ್ಕ್ಸ್, ಎಐ ವಾಯ್ಸ್ ರಿಸೆಪ್ಷನಿಸ್ಟ್, ಇಮೇಲ್ ಬೇಡ. ನಿಮ್ಮ ಮರಳಿ ಕರೆ ವಿನಂತಿಯನ್ನು ದಾಖಲಿಸಲೇ?', english_content: 'Confirming: Kavya Hegde, Malnad Coffee Works, AI Voice Receptionist, no email. May I save your callback request?', language_name: 'Kannada' },
            { role: 'user', content: 'ಹೌದು ದಯವಿಟ್ಟು', english_content: 'Yes please', language_name: 'Kannada' },
            { role: 'assistant', content: 'ನಿಮ್ಮ ಮರಳಿ ಕರೆ ವಿನಂತಿಯನ್ನು ಯಶಸ್ವಿಯಾಗಿ ದಾಖಲಿಸಲಾಗಿದೆ.', english_content: CALLBACK_SAVED_RESPONSE, tools: [{ name: 'save_callback_request', args: {} }], language_name: 'Kannada' },
            { role: 'user', content: 'ಧನ್ಯವಾದಗಳು', english_content: 'Thank you', language_name: 'Kannada' },
          ],
        };
        assert.equal(transcript.transcript.length, 80);

        const compRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/completion/${ROUTE_ID}`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            app_id: PROFILE.appId, app_version: 24, deployment_id: PROFILE.deploymentId,
            interaction_id: idKn, user_phone_number: '+919900112233', agent_phone_number: PROFILE.agentPhoneNumber,
            start_datetime: '2026-11-14T12:00:00+05:30', end_datetime: '2026-11-14T12:04:30+05:30', duration: 270,
            interaction_transcript: transcript,
          },
        });
        assert.equal(compRes.statusCode, 200);
        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.match(state.sentEmails[0].bodyText, /Email: Declined by caller/);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // TEST 6: Exact `v24` Sarvam Custom Tools Wire Shape (`details.notes` + `/:routeId/call-completion` with `callContext.*`)
    // -------------------------------------------------------------------------
    await test('L6_EXACT_V24_SARVAM_TOOLS_WIRE_SHAPE', 'Exact v24 save_callback_request (details.notes) + save_call_completion_event (/:routeId/call-completion + callContext.*) dispatches 1 Resend email', async () => {
      const { receiver, worker, state } = await boot();
      try {
        const interactionId = '20261114/v24-exact-01';
        const midRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            callContext: {
              interactionId,
              incomingNumber: '+919880011223',
              appId: PROFILE.appId,
              appVersion: 24,
              agentPhoneNumber: PROFILE.agentPhoneNumber,
            },
            details: {
              name: 'Siddharth Nair',
              business: 'BrandMint Studio',
              service: 'WhatsApp & Voice AI Integration',
              email: 'siddharth@brandmint.example',
              emailDeclined: false,
              notes: 'Caller wants callback regarding multi-agent automation.',
            },
          },
        });
        assert.equal(midRes.statusCode, 200);
        assert.equal(midRes.json().saved, true);
        assert.equal(midRes.json().responseText, CALLBACK_SAVED_RESPONSE);

        const compRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            callContext: {
              interactionId,
              incomingNumber: '+919880011223',
              appId: PROFILE.appId,
              appVersion: 24,
              agentPhoneNumber: PROFILE.agentPhoneNumber,
              durationSeconds: 92.4,
              callStartTime: 'Nov 14, 2026, 01:10:00 PM',
              callEndTime: 'Nov 14, 2026, 01:11:32 PM',
              transcript: {
                transcript: [
                  { role: 'assistant', content: 'To recap: Siddharth Nair from BrandMint Studio, WhatsApp & Voice AI Integration, email siddharth@brandmint.example. May I save your callback request with these details?', english_content: null },
                  { role: 'user', content: 'Yes, please.', english_content: null },
                  { role: 'assistant', content: CALLBACK_SAVED_RESPONSE, tools: [{ name: 'save_callback_request', args: {} }] },
                ],
              },
            },
          },
        });
        assert.equal(compRes.statusCode, 200);
        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.match(state.sentEmails[0].bodyText, /Caller wants callback regarding multi-agent automation\./);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // TEST 7: Exact Reproduction of Owner Live Call (`20261114/afcd65d2-13:41:20-4e756176` — Krishna)
    //         using `v25` Flat Snake-Case Sarvam HTTP Tool Contract (`caller_name`, `business_name`,
    //         `required_services`, `email`, `email_declined`, `notes` + `user_identifier` + `interaction_id`)
    //         and exact spoken phrasing: "Shall I go ahead and submit this callback request for you?" -> "Yeah, submit it."
    // -------------------------------------------------------------------------
    await test('L7_EXACT_KRISHNA_LIVE_CALL_SNAKE_CASE', 'Exact Krishna live call with flat snake_case v25 tools + "Shall I go ahead and submit..." + "Yeah, submit it." persists DB row, continues call, promotes at on_end, and dispatches 1 Resend email with 0 duplicates', async () => {
      const { receiver, worker, state } = await boot();
      try {
        const interactionId = '20261114/afcd65d2-13:41:20-4e756176';
        const callerE164 = '+919845091539';
        const midRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerE164,
            app_id: PROFILE.appId,
            app_version: 24,
            agent_phone_number: PROFILE.agentPhoneNumber,
            caller_name: 'Krishna',
            business_name: 'clothing business',
            required_services: 'AI webchat',
            email: 'krishna@gmail.com',
            email_declined: false,
            notes: 'Clothing business requesting AI webchat integration.',
          },
        });
        assert.equal(midRes.statusCode, 200);
        const midBody = midRes.json();
        assert.equal(midBody.saved, true);
        assert.equal(midBody.status, 'saved');
        assert.equal(midBody.responseText, CALLBACK_SAVED_RESPONSE);
        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.callbackRequests[0].details.name, 'Krishna');
        assert.equal(state.callbackRequests[0].details.business, 'clothing business');
        assert.equal(state.callbackRequests[0].details.service, 'AI webchat');
        assert.equal(state.callbackRequests[0].details.email, 'krishna@gmail.com');
        assert.equal(state.callbackRequests[0].details.phoneNumber, callerE164);
        assert.equal(state.callbackRequests[0].details.numberSource, 'call_metadata');
        assert.equal(state.callbackRequests[0].notification_status, 'needs_review');

        // Held until call completion
        await worker.run();
        assert.equal(state.sentEmails.length, 0);

        // Call continues naturally ("Okay, thank you.") and ends -> flat snake_case `save_call_completion_event`
        const compPayload = {
          interaction_id: interactionId,
          user_phone_number: callerE164,
          app_id: PROFILE.appId,
          app_version: 24,
          deployment_id: PROFILE.deploymentId,
          agent_phone_number: PROFILE.agentPhoneNumber,
          start_datetime: 'Nov 14, 2026, 01:41:20 PM',
          end_datetime: 'Nov 14, 2026, 01:43:29 PM',
          duration: 129.0,
          interaction_transcript: JSON.stringify({
            transcript: [
              { role: 'assistant', content: "Hello! I'm Thaara, an AI voice assistant from Quantum Weave. Is this a good time to speak with you?", english_content: null },
              { role: 'user', content: "Hey Tara, I'm calling from my business. I need someone from your team to call me back regarding AI webchat.", english_content: null },
              { role: 'assistant', content: 'I can certainly arrange a callback for that. May I have your name, your business name, and your email address?', english_content: null },
              { role: 'user', content: 'My name is Krishna, my business name is clothing business and Gmail ID is krishna@gmail.com.', english_content: null },
              { role: 'assistant', content: "Got it. So, just to make sure I have everything right, I have your name as Krishna from a clothing business, and you're looking for a callback regarding an AI webchat. Your email is krishna@gmail.com. Shall I go ahead and submit this callback request for you?", english_content: null },
              { role: 'user', content: 'Yeah, submit it.', english_content: null },
              { role: 'assistant', content: `${CALLBACK_SAVED_RESPONSE} Is there anything else I can help you with today?`, tools: [{ name: 'save_callback_request', args: { caller_name: 'Krishna', business_name: 'clothing business', required_services: 'AI webchat', email: 'krishna@gmail.com' } }], english_content: null },
              { role: 'user', content: 'Okay, thank you.', english_content: null },
              { role: 'assistant', content: "You're very welcome, Krishna. Thank you for calling Quantum Weave, and have a great day!", english_content: null },
            ],
          }),
        };
        const compRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: compPayload,
        });
        assert.equal(compRes.statusCode, 200);
        assert.equal(state.callEvents.length, 1);
        assert.equal(state.callbackRequests[0].notification_status, 'pending');

        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.equal(state.sentEmails[0].from, 'notifications@brandmintai.io');
        assert.equal(state.sentEmails[0].to, 'connect@brandmintai.io');
        assert.equal(state.sentEmails[0].subject, 'New Callback Request — Thaara AI');
        assert.match(state.sentEmails[0].bodyText, /Customer name: Krishna/);
        assert.match(state.sentEmails[0].bodyText, /Business name: clothing business/);
        assert.match(state.sentEmails[0].bodyText, /Phone: \+919845091539/);
        assert.match(state.sentEmails[0].bodyText, /Email: krishna@gmail\.com/);
        assert.match(state.sentEmails[0].bodyText, /Services requested: AI webchat/);
        assert.equal(state.callbackRequests[0].notification_status, 'sent');

        // Idempotent replay of both mid-call and completion -> still 1 DB row & 1 email!
        const replayComp = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: compPayload,
        });
        assert.equal(replayComp.statusCode, 200);
        await worker.run();
        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.sentEmails.length, 1);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // TEST 8: Backward-Compatible Flat Dot-Notation Keys (`callContext.*` / `details.*`)
    //         + Declined Email Sentinel (`email: "none"`, `email_declined: true`)
    // -------------------------------------------------------------------------
    await test('L8_FLAT_DOTTED_AND_DECLINED_EMAIL_SENTINEL', 'Flat dot-notation keys on both endpoints succeed, and declined email sentinel "none" normalizes to null cleanly', async () => {
      const { receiver, worker, state } = await boot();
      try {
        const interactionId = '20261114/flat-dotted-01';
        const midRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            'callContext.interactionId': interactionId,
            'callContext.incomingNumber': '+919731001122',
            'callContext.appId': PROFILE.appId,
            'callContext.appVersion': 24,
            'callContext.agentPhoneNumber': PROFILE.agentPhoneNumber,
            'details.name': 'Deepak Rao',
            'details.business': 'Mysuru Silk House',
            'details.service': 'WhatsApp CRM automation',
            'details.email': 'none',
            'details.emailDeclined': true,
            'details.notes': 'none',
          },
        });
        assert.equal(midRes.statusCode, 200);
        assert.equal(midRes.json().saved, true);
        assert.equal(state.callbackRequests[0].details.email, null);
        assert.equal(state.callbackRequests[0].details.emailDeclined, true);

        const compRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            'callContext.interactionId': interactionId,
            'callContext.incomingNumber': '+919731001122',
            'callContext.appId': PROFILE.appId,
            'callContext.appVersion': 24,
            'callContext.agentPhoneNumber': PROFILE.agentPhoneNumber,
            'callContext.durationSeconds': 68.2,
            'callContext.callStartTime': 'Nov 14, 2026, 02:10:00 PM',
            'callContext.callEndTime': 'Nov 14, 2026, 02:11:08 PM',
            'callContext.transcript': {
              transcript: [
                { role: 'assistant', content: 'Confirming: Deepak Rao from Mysuru Silk House, WhatsApp CRM automation, no email. Would you like me to book this callback request?', english_content: null },
                { role: 'user', content: 'Yes, book it.', english_content: null },
                { role: 'assistant', content: CALLBACK_SAVED_RESPONSE, tools: [{ name: 'save_callback_request', args: {} }] },
              ],
            },
          },
        });
        assert.equal(compRes.statusCode, 200);
        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.match(state.sentEmails[0].bodyText, /Email: Declined by caller/);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // TEST 9: Unknown Caller Name Guard & Corrected Caller Name Precedence (`caller_name` > `user_name`)
    // -------------------------------------------------------------------------
    await test('L9_CALLER_NAME_UNKNOWN_AND_OVERRIDE_GUARD', 'Empty caller_name returns needs_details: [name] (never Manan); corrected caller_name overrides any stale user_name', async () => {
      const { receiver, state } = await boot();
      try {
        const missingNameRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: '20261114/noname-01',
            user_identifier: '+919845012345',
            caller_name: '',
            business_name: 'Clothing Co',
            required_services: 'AI webchat',
            email: 'info@clothing.example',
            email_declined: false,
          },
        });
        assert.equal(missingNameRes.statusCode, 200);
        assert.deepEqual(missingNameRes.json(), { saved: false, status: 'needs_details', missingFields: ['name'] });
        assert.equal(state.callbackRequests.length, 0);

        const overrideRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: '20261114/override-01',
            user_identifier: '+919845012345',
            caller_name: 'Krishna',
            user_name: 'Manan',
            business_name: 'Clothing Co',
            required_services: 'AI webchat',
            email: 'krishna@clothing.example',
            email_declined: false,
          },
        });
        assert.equal(overrideRes.statusCode, 200);
        assert.equal(overrideRes.json().saved, true);
        assert.equal(state.callbackRequests[0].details.name, 'Krishna');
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // TEST 10: Flat Snake-Case Spoofing Rejections (`phone_number`, `workspace_id`, `owner_user_id`)
    // -------------------------------------------------------------------------
    await test('L10_FLAT_SPOOFING_REJECTED', 'Flat snake_case payload attempting to spoof phone_number or workspace_id is rejected HTTP 400', async () => {
      const { receiver, state } = await boot();
      try {
        const spoof1 = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: '20261114/flat-spoof-01',
            user_identifier: '+919845012345',
            phone_number: '+919999999999',
            caller_name: 'Krishna',
            business_name: 'Clothing Co',
            required_services: 'AI webchat',
            email_declined: true,
          },
        });
        assert.equal(spoof1.statusCode, 400);

        const spoof2 = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: '20261114/flat-spoof-02',
            user_identifier: '+919845012345',
            workspace_id: '00000000-0000-4000-8000-000000000000',
            caller_name: 'Krishna',
            business_name: 'Clothing Co',
            required_services: 'AI webchat',
            email_declined: true,
          },
        });
        assert.equal(spoof2.statusCode, 400);
        assert.equal(state.callbackRequests.length, 0);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // TEST 11: Exact Committed Sarvam v25 Wire Payloads (`caller_email`, `caller_notes`,
    //          `call_transcript`, `duration_seconds`, `call_start_time`, `call_end_time`, no `deployment_id`)
    // -------------------------------------------------------------------------
    await test('L11_EXACT_COMMITTED_V25_WIRE_PAYLOADS', 'Exact committed v25 wire keys on save_callback_request (caller_email, caller_notes) and save_call_completion_event (9 native platform fields, no deployment_id) persist and send 1 email', async () => {
      const { receiver, worker, state } = await boot();
      try {
        const interactionId = '20261114/v25-committed-exact-01';
        const midRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: '+919845099887',
            app_id: 'Thaara-AI-V-db336de4-5453',
            app_version: 24,
            agent_phone_number: '+918064269780',
            caller_name: 'Arjun Rao',
            business_name: 'Rao Textiles',
            required_services: 'AI webchat and WhatsApp bot',
            caller_email: 'arjun@raotextiles.in',
            email_declined: false,
            caller_notes: 'Wants AI webchat and WhatsApp bot for online orders.',
          },
        });
        assert.equal(midRes.statusCode, 200);
        assert.equal(midRes.json().saved, true);
        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.callbackRequests[0].details.name, 'Arjun Rao');
        assert.equal(state.callbackRequests[0].details.email, 'arjun@raotextiles.in');
        assert.equal(state.callbackRequests[0].notification_status, 'needs_review');

        const compTranscript = JSON.stringify({
          transcript: [
            { role: 'assistant', content: "Hello! I'm Thaara, an AI voice assistant from Quantum Weave. Is this a good time to speak with you?", language_name: 'English' },
            { role: 'user', content: 'Yes, I am Arjun Rao from Rao Textiles. Please arrange a callback for AI webchat and WhatsApp bot.', language_name: 'English' },
            { role: 'assistant', content: 'To recap: Arjun Rao from Rao Textiles, interested in AI webchat and WhatsApp bot, email arjun@raotextiles.in. Shall I go ahead and submit this callback request for you?', language_name: 'English' },
            { role: 'user', content: 'Yeah, submit it.', language_name: 'English' },
            { role: 'assistant', content: 'Your callback request has been noted and someone will follow up. Is there anything else I can help with?', language_name: 'English', tools: [{ name: 'save_callback_request', args: { caller_name: 'Arjun Rao' } }] },
            { role: 'user', content: 'No, thank you.', language_name: 'English' },
          ],
        });

        const endRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: '+919845099887',
            app_id: 'Thaara-AI-V-db336de4-5453',
            app_version: '24',
            agent_phone_number: '+918064269780',
            call_transcript: compTranscript,
            duration_seconds: 68,
            call_start_time: 'Nov 14, 2026, 03:45:00 PM',
            call_end_time: 'Nov 14, 2026, 03:46:08 PM',
          },
        });
        assert.equal(endRes.statusCode, 200);
        assert.equal(state.callbackRequests[0].notification_status, 'pending');

        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.match(state.sentEmails[0].bodyText, /Customer name: Arjun Rao/);
        assert.match(state.sentEmails[0].bodyText, /Email: arjun@raotextiles\.in/);
        assert.equal(state.callbackRequests[0].notification_status, 'sent');
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // TEST 12: Exact Reproduction of Live Call `20261114/afcd65d2-16:40:12-30b32b0b`
    //          (`customer_email`, omitted optional `email_declined` & `caller_notes`,
    //           spoken ASR `"Yes, I'll do it."`, `role: "tool"` turn in `transcript`,
    //           `app_version: "v24"`, naive ISO timestamps, 12-digit `91...` CLI, `/call-completion-event`)
    // -------------------------------------------------------------------------
    await test('L12_EXACT_LIVE_V26_REAL_CALL_REPRODUCTION', 'Exact 20261114/afcd65d2-16:40:12-30b32b0b call shape with omitted optional fields, customer_email alias, "Yes, I\'ll do it." ASR, and tool-role transcript turn saves & sends 1 email', async () => {
      const { receiver, worker, state } = await boot();
      try {
        const interactionId = '20261114/afcd65d2-16:40:12-30b32b0b';
        const midRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: '919845091539',
            app_id: 'Thaara-AI-V-db336de4-5453',
            app_version: 'v24',
            agent_phone_number: '+918064269780',
            customer_name: 'Krishna',
            business_name: 'real estate business',
            required_services: 'voice assistant like Alexa',
            customer_email: 'krishna@gmail.com',
          },
        });
        assert.equal(midRes.statusCode, 200);
        assert.equal(midRes.json().saved, true);
        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.callbackRequests[0].details.name, 'Krishna');
        assert.equal(state.callbackRequests[0].details.business, 'real estate business');
        assert.equal(state.callbackRequests[0].details.service, 'voice assistant like Alexa');
        assert.equal(state.callbackRequests[0].details.email, 'krishna@gmail.com');
        assert.equal(state.callbackRequests[0].details.emailDeclined, false);
        assert.equal(state.callbackRequests[0].details.phoneNumber, '+919845091539');
        assert.equal(state.callbackRequests[0].notification_status, 'needs_review');

        const compTranscript = JSON.stringify({
          transcript: [
            { role: 'assistant', content: "Hello! I'm Thaara, an AI voice assistant from Quantum Weave. Is this a good time to speak with you?", language_name: 'English' },
            { role: 'user', content: 'My name is Krishna and we are handling the real estate business. We need a voice assistant like Alexa. My email address is krishna@gmail.com.', language_name: 'English' },
            { role: 'assistant', content: 'To confirm: Krishna from a real estate business, looking for a voice assistant like Alexa, email krishna@gmail.com. Shall I go ahead and submit this callback request for you?', language_name: 'English' },
            { role: 'user', content: "Yes, I'll do it.", language_name: 'English' },
            { role: 'tool', name: 'save_callback_request', content: '{"saved":true,"status":"saved"}' },
            { role: 'assistant', content: `${CALLBACK_SAVED_RESPONSE} Is there anything else I can help you with?`, language_name: 'English', tools: [{ name: 'save_callback_request', args: { caller_name: 'Krishna' } }] },
            { role: 'user', content: 'No, thanks.', language_name: 'English' },
          ],
        });

        const endRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion-event`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: '919845091539',
            app_id: 'Thaara-AI-V-db336de4-5453',
            app_version: 'v24',
            agent_phone_number: '918064269780',
            transcript: compTranscript,
            duration_seconds: 99,
            call_start_time: '2026-11-14T11:10:12.123456',
            call_end_time: '2026-11-14T11:11:51.654321',
          },
        });
        assert.equal(endRes.statusCode, 200);
        assert.equal(state.callbackRequests[0].notification_status, 'pending');

        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.match(state.sentEmails[0].bodyText, /Customer name: Krishna/);
        assert.match(state.sentEmails[0].bodyText, /Business name: real estate business/);
        assert.match(state.sentEmails[0].bodyText, /Phone: \+919845091539/);
        assert.match(state.sentEmails[0].bodyText, /Email: krishna@gmail\.com/);
        assert.equal(state.callbackRequests[0].notification_status, 'sent');
      } finally {
        await receiver.close();
      }
    });

    console.log(JSON.stringify({ status: 'PASS', total: results.length, passed: results.length, failed: 0, results }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
