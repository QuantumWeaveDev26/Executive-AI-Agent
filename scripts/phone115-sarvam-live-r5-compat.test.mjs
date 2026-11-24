#!/usr/bin/env node
/**
 * Focused End-to-End Offline Validation for `phone115-sarvam-live-release-20261116-r5`:
 * - Preserves all L1–L12 compatibility checks from `phone115-sarvam-live-compat.test.mjs`
 * - Preserves all L13–L16 R4 checks (hashed `user_identifier`, `"Ah submitted."`, withdrawal, auth-first gate, preimage check)
 * - Verifies R5 Defect #1 + Defect #2 fixes on exact live failure `20261116/afcd65d2-17:42:36-aw17a7ae`:
 *   1. Mid-call `save_callback_request` with `interaction_id: null` / `""` / omitted and `user_identifier: null` / `""` / omitted
 *      no longer fails at Fastify `preValidation` (`HTTP 400`); returns truthful `HTTP 200 { saved: false, status: "queued" }`.
 *   2. Background Auto-Completion Finalizer polls Sarvam Analytics `/attempts` + `/transcripts/{id}` when Sarvam's platform
 *      never fires `On end` `save_call_completion_event`, verifies caller SHA-256 preimage + spoken recap & consent
 *      (including spoken email `"at"`/`"dot"` and `{ interaction_id, messages: [...] }` shape), commits PostgreSQL callback +
 *      completion records, promotes `notification_status` to `'pending'`, and dispatches exact 1 Resend email with 0 duplicates.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const PKG_R5 = path.join(ROOT, 'artifacts/phone115-sarvam-live-release-20261116-r5');

// Hard-block any real outbound sockets/HTTP
import net from 'node:net';
import tls from 'node:tls';
net.Socket.prototype.connect = () => { throw new Error('OFFLINE_VIOLATION'); };
tls.connect = () => { throw new Error('OFFLINE_VIOLATION'); };
globalThis.fetch = async () => { throw new Error('OFFLINE_VIOLATION'); };

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

async function main() {
  // 1. Run the existing L1-L12 suite against the new r5 overlay
  const r3TestSrc = fs.readFileSync(path.join(ROOT, 'scripts/phone115-sarvam-live-compat.test.mjs'), 'utf8');
  const tempRunner = path.join(ROOT, 'scripts/.tmp-phone115-r5-base-check.mjs');
  try {
    fs.writeFileSync(tempRunner, r3TestSrc.replace(
      'artifacts/phone115-sarvam-live-release-20261114-r3',
      'artifacts/phone115-sarvam-live-release-20261116-r5'
    ));
    const { execFileSync } = await import('node:child_process');
    const baseOut = JSON.parse(execFileSync(process.execPath, [tempRunner], { encoding: 'utf8' }));
    assert.equal(baseOut.status, 'PASS');
    assert.equal(baseOut.passed, 12);
    assert.equal(baseOut.failed, 0);
  } finally {
    fs.rmSync(tempRunner, { force: true });
  }

  // 2. Run dedicated R4 + R5 tests (L13 - L21) under full production v26 profile
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thaara-phone115-r5-compat-'));
  const apiDir = path.join(tempRoot, 'apps/api');

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

  try {
    fs.mkdirSync(path.join(apiDir, 'dist/services'), { recursive: true });
    for (const svc of fs.readdirSync(path.join(ROOT, 'apps/api/dist/services')).filter(f => f.startsWith('phone-') && f.endsWith('.js'))) {
      const content = fs.readFileSync(path.join(ROOT, 'apps/api/dist/services', svc), 'utf8').replaceAll("process.env.NODE_ENV !== 'test'", 'false');
      fs.writeFileSync(path.join(apiDir, 'dist/services', svc), content);
    }
    const basePrincipal = fs.readFileSync(path.join(apiDir, 'dist/services/phone-inbound-principal.js'), 'utf8');
    fs.writeFileSync(path.join(apiDir, 'dist/services/phone-inbound-principal.js'), basePrincipal
      .replace('export function createInboundPrincipalGate(', 'const __gates = new WeakSet();\nexport function isAdmittedInboundPrincipalGate(g) { return !!g && typeof g === "object" && __gates.has(g); }\nexport function __rawCreateInboundPrincipalGate(')
      + '\nexport function createInboundPrincipalGate(opts) { if (process.env.NODE_ENV !== "test" && (!opts || Reflect.ownKeys(opts).length !== 2 || "now" in opts)) throw new Error("Inbound principal gate production admission was denied."); const g = Object.freeze(__rawCreateInboundPrincipalGate(opts)); __gates.add(g); return g; }\n');
    for (const pkg of ['contracts', 'observability', 'policy']) {
      copyDir(path.join(ROOT, `packages/${pkg}/dist`), path.join(apiDir, `node_modules/@thaara/${pkg}/dist`));
      fs.writeFileSync(path.join(apiDir, `node_modules/@thaara/${pkg}/package.json`), JSON.stringify({ name: `@thaara/${pkg}`, type: 'module', exports: { '.': './dist/index.js', './*': './dist/*' } }, null, 2));
    }
    fs.appendFileSync(path.join(apiDir, 'node_modules/@thaara/contracts/dist/index.js'), "\nexport * from './phone-callback-intake.js';\n");

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
    fs.writeFileSync(path.join(apiDir, 'dist/services/phone-sarvam-inbound-service.js'), `
import { computeCanonicalParameterHash } from '@thaara/contracts';
import { createInboundPrincipalGate } from './phone-inbound-principal.js';
import { createInboundPrincipalJournal } from './phone-inbound-principal-journal.js';
import { normalizeSarvamInboundPayload } from './phone-sarvam-inbound-normalize.js';
import { finalizeCallbackIntakeInTransaction } from '../../phone-callback-intake-store.mjs';
const admitted = new WeakSet();
export function isAdmittedSarvamInboundService(v) { return !!v && typeof v === 'object' && admitted.has(v); }
export function buildInboundServiceBinding(input) {
  const p = structuredClone(input);
  const profileFingerprint = computeCanonicalParameterHash({ ...p, policy: 'phone.inbound.service.v1', direction: 'inbound', callbackMeaning: 'human_team_request', consentPolicy: 'explicit-recap.v1', mediaRetention: 'off', calendarBooking: 'disabled' });
  return Object.freeze({ routeId: p.routeId, workspaceId: p.workspaceId, ownerUserId: p.ownerUserId, principalId: p.principalId, revision: p.revision, profileFingerprint });
}
export function createSarvamInboundService(options) {
  if (process.env.NODE_ENV !== 'test' && (!options || Reflect.ownKeys(options).length !== 2 || 'now' in options)) {
    throw new Error('Inbound service production admission was denied.');
  }
  const intakeApproved = process.env.THAARA_PHONE_CALLBACK_INTAKE === 'approved';
  const profile = Object.freeze(structuredClone(options.profile)), binding = buildInboundServiceBinding(profile), now = Date.now;
  const journal = createInboundPrincipalJournal(createInboundPrincipalGate({ profile: binding, transactions: options.transactions }));
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
    copyDir(path.join(PKG_R5, 'apps/api'), apiDir);

    fs.writeFileSync(path.join(apiDir, 'dist/services/standing-worker-harness.mjs'), `
import { createHash, randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { ActionRegistry, PolicyGateway } from '@thaara/policy';
import { createPhoneCallbackQueue } from './phone-callback-queue.js';
function formatAutomaticCallbackEmail(request) {
  const text = (v) => typeof v === 'string' ? v.replace(/[\\p{Cc}\\p{Cf}\\p{Zl}\\p{Zp}]/gu, ' ').trim().slice(0, 2000) : '';
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
    if (!policy.evaluate({ ...s, role: 'owner' }, { actionName: 'phone.callback.notify_company', parameters: { requestId, to: grant.recipient, from: grant.sender }, idempotencyKey }).allowed) return 'awaiting_owner_authorization';
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
    fs.writeFileSync(path.join(apiDir, 'package.json'), JSON.stringify({ name: '@thaara/api-r5-compat-test', type: 'module' }, null, 2));
    fs.writeFileSync(path.join(apiDir, 'dist/services/phone-callback-startup.js'), `
      const admitted = new WeakMap();
      export function isAdmittedPhoneCallbackPool(pool, role) { return admitted.get(pool)?.role === role; }
      export function matchesPhoneCallbackPoolBinding(pool, binding, role = 'thaara_phone_ingest') { return isAdmittedPhoneCallbackPool(pool, role) && !!binding; }
      export async function openPhoneCallbackIngestResources({ environment }) { return globalThis.__TEST_RESOURCES__({ environment, registerPool(p, r, b) { admitted.set(p, { role: r, binding: b }); }, revokePool(p) { admitted.delete(p); } }); }
    `);

    const pnpmRoot = path.join(ROOT, 'node_modules/.pnpm');
    const fastifyUrl = findPnpmEntry(pnpmRoot, 'fastify@', 'fastify/fastify.js');
    const typeboxBase = findPnpmEntry(pnpmRoot, '@sinclair+typebox@', '@sinclair/typebox/build/esm/');
    const contractsUrl = pathToFileURL(path.join(apiDir, 'node_modules/@thaara/contracts/dist/index.js')).href;
    const observabilityUrl = pathToFileURL(path.join(apiDir, 'node_modules/@thaara/observability/dist/index.js')).href;
    const policyUrl = pathToFileURL(path.join(apiDir, 'node_modules/@thaara/policy/dist/index.js')).href;
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
    const INBOUND_TOKEN = 'synthetic_sarvam_inbound_secret_token_20261116';
    const WORKER_TOKEN = 'synthetic_standing_worker_secret_token_20261116';
    const SARVAM_API_KEY = 'sk_sarvam_synthetic_test_key_20261116';
    const CONFIG_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const PROFILE_V26 = {
      routeId: ROUTE_ID,
      workspaceId: '11111111-2222-4333-8444-555555555555',
      ownerUserId: '66666666-7777-4888-8999-aaaaaaaaaaaa',
      principalId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      revision: 4,
      appId: 'Thaara-AI-V-db336de4-5453',
      appVersion: 26,
      deploymentId: 'Thaara-V2---6bdfef25-f9ad',
      agentPhoneNumber: '+918064269780',
      maxCallLengthSeconds: 300,
    };

    function createMockDb(profile, profileFingerprint) {
      const inboundHash = sha256(INBOUND_TOKEN);
      const workerHash = sha256(WORKER_TOKEN);
      const state = {
        grant: { routeId: profile.routeId, workspaceId: profile.workspaceId, ownerUserId: profile.ownerUserId, principalId: profile.principalId, revision: profile.revision, profileFingerprint, tokenHash: inboundHash, activeOwner: true, revokedAt: null, expiresAt: '2027-12-31T23:59:59.000Z', operations: ['callback', 'completion'] },
        standingConfig: { configurationId: CONFIG_ID, workspaceId: profile.workspaceId, userId: profile.ownerUserId, enabled: true, workerTokenHash: workerHash },
        callbackRequests: [],
        callEvents: [],
        auditEvents: [],
        sentEmails: [],
      };
      const ingestPool = Object.freeze({
        async connect() {
          let tx = null;
          return {
            async query(sql, params = []) {
              const t = sql.trim();
              if (t.includes('AS functions')) return { rows: [{ role_name: 'thaara_phone_ingest', session_role_name: 'thaara_phone_ingest', functions: CALLBACK_INTAKE_ATTESTATIONS }], rowCount: 1 };
              if (t === 'BEGIN') { tx = { callbackRequests: structuredClone(state.callbackRequests), callEvents: structuredClone(state.callEvents), auditEvents: structuredClone(state.auditEvents) }; return { rows: [], rowCount: 0 }; }
              if (t.startsWith('SET LOCAL ') || t.startsWith("SELECT pg_catalog.set_config('app.session_token_hash'")) return { rows: [{}], rowCount: 1 };
              if (t.includes('phone_inbound_role_preflight')) return { rows: [{ role_name: 'thaara_phone_ingest', session_role_name: 'thaara_phone_ingest', schema_create: false, rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false, rolinherit: false, elevated_membership: false, owns_protected: false, journal_rls: true, journal_force_rls: true, direct_journal_access: false, direct_protected_access: false }], rowCount: 1 };
              if (t.startsWith('SELECT grant_record FROM public.phone_inbound_resolve_grant')) {
                const g = state.grant;
                if (!g || g.tokenHash !== params[0] || g.routeId !== params[1] || !g.operations.includes(params[2])) return { rows: [], rowCount: 0 };
                return { rows: [{ grant_record: structuredClone(g) }], rowCount: 1 };
              }
              if (t.startsWith('SELECT public.phone_callback_intake_save')) {
                const p = JSON.parse(params[0]);
                let r = tx.callbackRequests.find(x => x.request_id === p.id);
                if (!r) {
                  r = { workspace_id: p.workspaceId, owner_user_id: p.ownerUserId, request_id: p.id, call_id: p.callId, direction: 'inbound', request_hash: p.hash, details: structuredClone(p.details), occurred_at: '2026-11-16T12:14:11.000Z', request_status: 'requested', notification_status: 'needs_review', attempts: 0, notification_attempt_id: null, provider_message_id: null };
                  tx.callbackRequests.push(r);
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
                const prior = existing.find(e => e.eventId === ev.eventId);
                if (prior) {
                  if (prior.sourceDigest !== ev.sourceDigest) {
                    const conflictErr = new Error('Inbound event replay conflict');
                    conflictErr.statusCode = 409;
                    throw conflictErr;
                  }
                  duplicate = true;
                } else {
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
                if (!completed || completed.report?.callStatus !== 'ended' || completed.report?.callerPhone !== r.details.phoneNumber) throw new Error('Callback intake completion binding denied');
                if (r.details?.reviewRequired === true) return { rows: [{ receipt: { found: true, status: 'needs_review', requestId: r.request_id } }], rowCount: 1 };
                if (r.attempts !== 0 || r.request_status !== 'requested') return { rows: [{ receipt: { found: true, status: r.request_status } }], rowCount: 1 };
                const targetStatus = (completed.report?.callbackConsent === 'declined' || completed.report?.callbackPreference === 'declined') ? 'cancelled' : 'requested';
                r.request_status = targetStatus;
                r.notification_status = targetStatus === 'cancelled' ? 'needs_review' : 'pending';
                return { rows: [{ receipt: { found: true, status: targetStatus, requestId: r.request_id } }], rowCount: 1 };
              }
              if (t === 'COMMIT') { state.callbackRequests = tx.callbackRequests; state.callEvents = tx.callEvents; state.auditEvents = tx.auditEvents; tx = null; return { rows: [], rowCount: 0 }; }
              if (t === 'ROLLBACK') { tx = null; return { rows: [], rowCount: 0 }; }
              throw new Error(`Unexpected SQL: ${t}`);
            },
            release() {},
          };
        },
        async close() {},
      });
      const workerDb = {
        async query(_sql, params) {
          const [hashArg, wsArg, uidArg, op, idArg, attemptArg, outcomeArg, providerIdArg, configIdArg] = params;
          assert.equal(hashArg, state.standingConfig.workerTokenHash);
          let data = null;
          if (op === 'recover') data = 0;
          else if (op === 'pending') data = state.callbackRequests.filter(r => r.request_status === 'requested' && r.notification_status === 'pending' && r.attempts < 2).map(r => r.request_id);
          else if (op === 'read') { const r = state.callbackRequests.find(x => x.request_id === idArg); data = r ? { id: r.request_id, workspaceId: r.workspace_id, userId: r.owner_user_id, callId: r.call_id, direction: r.direction, name: r.details.name, business: r.details.business, service: r.details.service, phoneNumber: r.details.phoneNumber, numberSource: r.details.numberSource, email: r.details.email ?? null, emailDeclined: r.details.emailDeclined === true, discussionDetails: r.details.discussionDetails ?? '', capturePhase: r.details.capturePhase, occurredAt: r.occurred_at, status: r.request_status, notificationStatus: r.notification_status, notificationAttemptId: r.notification_attempt_id, providerMessageId: r.provider_message_id, attempts: r.attempts } : null; }
          else if (op === 'grant') data = { kind: 'standing_callback_notification', enabled: true, configurationId: CONFIG_ID, workspaceId: wsArg, userId: uidArg, authorizedByUserId: uidArg, sender: 'notifications@brandmintai.io', recipient: 'connect@brandmintai.io' };
          else if (op === 'claim') { const r = state.callbackRequests.find(x => x.request_id === idArg); if (r && r.notification_status === 'pending' && r.request_status === 'requested' && configIdArg === CONFIG_ID) { r.attempts += 1; r.notification_status = 'sending'; r.notification_attempt_id = attemptArg; data = r.attempts; } }
          else if (op === 'finish') { const r = state.callbackRequests.find(x => x.request_id === idArg && x.notification_attempt_id === attemptArg); if (r) { r.notification_status = outcomeArg === 'submitted' ? 'sent' : outcomeArg; r.provider_message_id = providerIdArg ?? null; } data = true; }
          return { rows: [{ result: { workspaceId: wsArg, userId: uidArg, data } }], rowCount: 1 };
        },
      };
      return { ingestPool, workerDb, state };
    }

    async function bootWithSarvamMock(fetchHandler, extraOptions = {}) {
      const binding = buildInboundServiceBinding(PROFILE_V26);
      const mock = createMockDb(PROFILE_V26, binding.profileFingerprint);
      let fetchCount = 0;
      globalThis.__TEST_RESOURCES__ = async ({ registerPool, revokePool }) => {
        registerPool(mock.ingestPool, 'thaara_phone_ingest', binding);
        return { status: 'resources_ready', runtimeAdmitted: false, profileFingerprint: binding.profileFingerprint, inboundProfile: PROFILE_V26, ingestPool: mock.ingestPool, async close() { revokePool(mock.ingestPool); } };
      };
      let capturedIntake = null;
      const receiver = await createPhoneCallbackReceiver(
        { THAARA_PHONE_CALLBACK_RECEIVER: 'approved' },
        {
          ...extraOptions,
          onIntakeReady: (svc) => { capturedIntake = svc; },
          sarvamResolverOptions: {
            sleep: async () => {},
            ...(extraOptions.now ? { now: extraOptions.now } : {}),
            resolveCredentials: async () => ({ orgId: 'org-test-01', workspaceId: 'ws-test-01', apiKey: SARVAM_API_KEY }),
            fetch: async (url, init) => {
              fetchCount += 1;
              assert.equal(init.headers['X-API-Key'], SARVAM_API_KEY);
              const bodyObj = await fetchHandler(url, fetchCount);
              if (bodyObj === null) return new Response('Not Found', { status: 404 });
              return new Response(JSON.stringify(bodyObj), { status: 200, headers: { 'content-type': 'application/json' } });
            },
          },
        }
      );
      assert.equal(receiver.status, 'ready');
      assert.deepEqual(Object.keys(receiver).sort(), ['app', 'close', 'runtimeAdmitted', 'status']);
      const worker = createStandingWorkerForTest({
        scope: { workspaceId: PROFILE_V26.workspaceId, userId: PROFILE_V26.ownerUserId },
        db: mock.workerDb,
        credential: async () => WORKER_TOKEN,
        transport: {
          sender: 'notifications@brandmintai.io',
          ready: async () => true,
          async send(mail) { mock.state.sentEmails.push(mail); return { acceptedId: 're_msg_' + mock.state.sentEmails.length }; },
        },
      });
      return { receiver, drainPending: () => capturedIntake.drainPendingCompletions(), worker, state: mock.state, getFetchCount: () => fetchCount };
    }

    const r5Results = [];
    async function test(id, title, fn) {
      await fn();
      r5Results.push({ id, title, passed: true });
    }

    // -------------------------------------------------------------------------
    // L13: Live v26 64-hex `user_identifier` + Indian-English ASR `"Ah submitted."`
    // -------------------------------------------------------------------------
    await test('L13_HASHED_USER_IDENTIFIER_LIVE_V26_AH_SUBMITTED', '64-hex user_identifier resolved via Sarvam /attempts + "Ah submitted." ASR persists mid-call, hits cache at on_end, and dispatches 1 Resend email', async () => {
      const callerE164 = '+919845011223';
      const callerHash = sha256(callerE164);
      const interactionId = '20261116/synthetic-12:47:52-r4test01';
      const { receiver, worker, state, getFetchCount } = await bootWithSarvamMock(async (url) => {
        const u = new URL(url);
        const fc = JSON.parse(u.searchParams.get('filter_conditions'));
        assert.equal(fc[0].field, 'interaction_id');
        assert.equal(fc[0].value, interactionId);
        return {
          items: [{
            interaction_id: interactionId,
            channel_direction: 'inbound',
            app_version: 26,
            user_contact: callerE164,
            user_contact_hashed: callerHash,
          }],
        };
      });
      try {
        const midRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerHash,
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            caller_name: 'Nikhil Shetty',
            business_name: 'Coastal Freight Co',
            required_services: 'AI WhatsApp and voice automation',
            caller_email: 'nikhil@coastalfreight.example',
            email_declined: false,
            caller_notes: 'Wants automated shipment status updates and inbound voice routing.',
          },
        });
        assert.equal(midRes.statusCode, 200);
        assert.equal(midRes.json().saved, true);
        assert.equal(midRes.json().responseText, CALLBACK_SAVED_RESPONSE);
        assert.equal(getFetchCount(), 1);
        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.callbackRequests[0].details.phoneNumber, callerE164);
        assert.equal(state.callbackRequests[0].notification_status, 'needs_review');

        await worker.run();
        assert.equal(state.sentEmails.length, 0);

        const compRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion-event`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerHash,
            app_id: PROFILE_V26.appId,
            app_version: '26',
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            duration_seconds: 121.4,
            call_start_time: '2026-11-16T07:17:52Z',
            call_end_time: '2026-11-16T07:19:53Z',
            call_transcript: JSON.stringify({
              transcript: [
                { role: 'assistant', content: "Hello! I'm Thaara, an AI voice assistant from Quantum Weave. Is this a good time to speak with you?", language_name: 'English' },
                { role: 'user', content: 'Yes, I am Nikhil Shetty from Coastal Freight Co. Please arrange a callback for AI WhatsApp and voice automation. My email is nikhil@coastalfreight.example.', language_name: 'English' },
                { role: 'assistant', content: 'To confirm: Nikhil Shetty from Coastal Freight Co, interested in AI WhatsApp and voice automation, email nikhil@coastalfreight.example. Shall I go ahead and submit this callback request for you?', language_name: 'English' },
                { role: 'user', content: 'Ah submitted.', language_name: 'English' },
                { role: 'tool', name: 'save_callback_request', content: '{"saved":true,"status":"saved"}' },
                { role: 'assistant', content: `${CALLBACK_SAVED_RESPONSE} Is there anything else I can help you with?`, language_name: 'English', tools: [{ name: 'save_callback_request', args: {} }] },
                { role: 'user', content: 'No, thank you.', language_name: 'English' },
              ],
            }),
          },
        });
        assert.equal(compRes.statusCode, 200);
        assert.equal(getFetchCount(), 1);
        assert.equal(state.callbackRequests[0].notification_status, 'pending');

        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.equal(state.sentEmails[0].from, 'notifications@brandmintai.io');
        assert.equal(state.sentEmails[0].to, 'connect@brandmintai.io');
        assert.equal(state.callbackRequests[0].notification_status, 'sent');
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // L14: First-time caller unindexed mid-call -> truthful `200 queued` -> flushed at completion -> 1 email
    // -------------------------------------------------------------------------
    await test('L14_HASHED_UNINDEXED_MIDCALL_QUEUED_TO_COMPLETION', 'Unindexed active call validates missing fields, returns truthful HTTP 200 queued mid-call, and flushes + dispatches 1 email at completion', async () => {
      const callerE164 = '+919900887766';
      const callerHash = sha256(callerE164);
      const interactionId = '20261116/synthetic-unindexed-01';
      let indexed = false;
      const { receiver, drainPending, worker, state } = await bootWithSarvamMock(async () => {
        if (!indexed) return { items: [] };
        return {
          items: [{
            interaction_id: interactionId,
            channel_direction: 'inbound',
            app_version: 26,
            user_contact: callerE164,
            user_contact_hashed: callerHash,
          }],
        };
      });
      try {
        const missingRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerHash,
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            caller_name: 'Meera Pai',
            business_name: '',
            required_services: 'Voice AI Receptionist',
            email_declined: true,
          },
        });
        assert.equal(missingRes.statusCode, 200);
        assert.deepEqual(missingRes.json(), { saved: false, status: 'needs_details', missingFields: ['business'] });

        const stageRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerHash,
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            caller_name: 'Meera Pai',
            business_name: 'Udupi Wellness Clinic',
            required_services: 'Voice AI Receptionist',
            email_declined: true,
            caller_notes: 'Wants Kannada + English appointment triage.',
          },
        });
        assert.equal(stageRes.statusCode, 200);
        assert.deepEqual(stageRes.json(), { saved: false, status: 'queued', missingFields: [] });
        assert.equal(state.callbackRequests.length, 0);

        indexed = true;
        const endRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion-event`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerHash,
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            duration_seconds: 84,
            call_start_time: '2026-11-16T08:00:00Z',
            call_end_time: '2026-11-16T08:01:24Z',
            call_transcript: JSON.stringify({
              transcript: [
                { role: 'assistant', content: 'Confirming: Meera Pai from Udupi Wellness Clinic, interested in Voice AI Receptionist, no email. Shall I go ahead and submit this callback request for you?', language_name: 'English' },
                { role: 'user', content: 'Yes, submit it.', language_name: 'English' },
                { role: 'assistant', content: 'I have noted your details and our team will follow up.', tools: [{ name: 'save_callback_request', args: {} }], language_name: 'English' },
              ],
            }),
          },
        });
        assert.equal(endRes.statusCode, 200);
        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.callbackRequests[0].details.phoneNumber, callerE164);
        assert.equal(state.callbackRequests[0].notification_status, 'pending');

        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.match(state.sentEmails[0].bodyText, /Customer name: Meera Pai/);
        assert.equal(state.callbackRequests[0].notification_status, 'sent');
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // L15: Staged mid-call intake where caller withdraws before hangup -> cancelled, 0 emails!
    // -------------------------------------------------------------------------
    await test('L15_STAGED_WITHDRAWAL_SENDS_ZERO_EMAILS', 'Staged mid-call intake cancelled when ended-call transcript contains caller withdrawal (0 emails)', async () => {
      const callerE164 = '+919886655443';
      const callerHash = sha256(callerE164);
      const interactionId = '20261116/synthetic-staged-withdraw-01';
      let indexed = false;
      const { receiver, drainPending, worker, state } = await bootWithSarvamMock(async () => (
        indexed ? { items: [{ interaction_id: interactionId, channel_direction: 'inbound', app_version: 26, user_contact: callerE164, user_contact_hashed: callerHash }] } : { items: [] }
      ));
      try {
        await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerHash,
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            caller_name: 'Harish',
            business_name: 'Metro Traders',
            required_services: 'CRM',
            email_declined: true,
          },
        });
        indexed = true;
        const endRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion-event`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerHash,
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            duration_seconds: 55,
            call_start_time: '2026-11-16T08:10:00Z',
            call_end_time: '2026-11-16T08:10:55Z',
            call_transcript: JSON.stringify({
              transcript: [
                { role: 'assistant', content: 'Shall I go ahead and submit this callback request for you?', language_name: 'English' },
                { role: 'user', content: "Actually please don't call me, cancel the callback.", language_name: 'English' },
              ],
            }),
          },
        });
        assert.equal(endRes.statusCode, 200);
        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.callbackRequests[0].request_status, 'cancelled');
        assert.equal(state.callbackRequests[0].notification_status, 'needs_review');
        await worker.run();
        assert.equal(state.sentEmails.length, 0);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // L16: Unauthenticated requests trigger 0 Sarvam fetches; SHA-256 preimage mismatch rejected
    // -------------------------------------------------------------------------
    await test('L16_UNAUTH_ZERO_FETCH_AND_HASH_PREIMAGE_VERIFICATION', 'Unauthenticated requests make 0 Sarvam fetches; tampered user_contact failing SHA-256 preimage check is rejected', async () => {
      const realE164 = '+919845077777';
      const tamperedE164 = '+919845088888';
      const callerHash = sha256(realE164);
      const interactionId = '20261116/synthetic-tamper-01';
      const { receiver, worker, state, getFetchCount } = await bootWithSarvamMock(async () => ({
        items: [{
          interaction_id: interactionId,
          channel_direction: 'inbound',
          app_version: 26,
          user_contact: tamperedE164,
          user_contact_hashed: callerHash,
        }],
      }));
      try {
        const unauthMid = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: 'Bearer wrong_token' },
          payload: {
            interaction_id: null,
            user_identifier: null,
            caller_name: 'Test',
            business_name: 'Test Biz',
            required_services: 'Voice AI',
            email_declined: true,
          },
        });
        assert.equal(unauthMid.statusCode, 503);
        const unauthEnd = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion-event`,
          headers: { authorization: 'Bearer wrong_token' },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerHash,
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
          },
        });
        assert.equal(unauthEnd.statusCode, 403);
        assert.equal(getFetchCount(), 0);

        const tamperEnd = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion-event`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerHash,
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            duration_seconds: 30,
            call_start_time: '2026-11-16T08:20:00Z',
            call_end_time: '2026-11-16T08:20:30Z',
            call_transcript: JSON.stringify({ transcript: [] }),
          },
        });
        assert.equal(tamperEnd.statusCode, 403);
        assert.equal(state.callbackRequests.length, 0);
        await worker.run();
        assert.equal(state.sentEmails.length, 0);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // L17: EXACT Reproduction of Post-R4 Real Call `20261116/afcd65d2-17:42:36-aw17a7ae`:
    //      - Mid-call `save_callback_request` has `interaction_id: null, user_identifier: null`
    //      - Sarvam NEVER fires `On end` `save_call_completion_event`
    //      - Receiver R5 returns HTTP 200 `{ saved: false, status: "queued" }` (NOT HTTP 400!),
    //        polls Sarvam Analytics `/attempts` + `/transcripts/{id}` automatically via timer,
    //        verifies SHA256(user_contact) === user_contact_hashed + spoken email ("at"/"dot") +
    //        affirmative `"Yes, submit it."` + closing `"Nothing. Thank you."`, commits DB rows,
    //        promotes to `'pending'`, and dispatches exact 1 Resend email with 0 duplicates!
    // -------------------------------------------------------------------------
    await test('L17_EXACT_POST_R4_NULL_VARS_AND_NO_ON_END_WEBHOOK', 'Exact reproduction of 20261116/afcd65d2-17:42:36-aw17a7ae (interaction_id: null, user_identifier: null, zero On-end webhook) auto-finalizes via Sarvam Analytics and sends 1 Resend email', async () => {
      const syntheticCallerE164 = '+919845065432';
      const syntheticCallerHash = sha256(syntheticCallerE164);
      const interactionId = '20261116/afcd65d2-17:42:36-aw17a7ae';
      const expectedCallId = '112db114367ddefd6fddd98e273e4754495ea01cb466333bddbfa41a4a0fb5e7';
      const invokeClockMs = Date.parse('2026-11-16T12:13:55Z');
      let callEndedInSarvam = false;

      const { receiver, drainPending, worker, state } = await bootWithSarvamMock(
        async (url) => {
          const u = new URL(url);
          if (u.pathname.endsWith('/attempts')) {
            return {
              items: [
                // Include an unrelated short hangup call in the same window to prove strict transcript matching
                {
                  interaction_id: '20261116/other-17:42:10-hangup01',
                  channel_direction: 'inbound',
                  app_version: 26,
                  deployment_id: PROFILE_V26.deploymentId,
                  bot_contact_identifier: PROFILE_V26.agentPhoneNumber,
                  start_datetime: '2026-11-16T12:12:10',
                  end_datetime: '2026-11-16T12:12:22',
                  duration_in_seconds: 12.1,
                  user_contact: '+919880000111',
                  user_contact_hashed: sha256('+919880000111'),
                },
                {
                  interaction_id: interactionId,
                  channel_direction: 'inbound',
                  app_version: 26,
                  deployment_id: PROFILE_V26.deploymentId,
                  bot_contact_identifier: PROFILE_V26.agentPhoneNumber,
                  start_datetime: '2026-11-16T12:12:36',
                  end_datetime: callEndedInSarvam ? '2026-11-16T12:14:11' : null,
                  duration_in_seconds: callEndedInSarvam ? 95.3169174194336 : null,
                  user_contact: syntheticCallerE164,
                  user_contact_hashed: syntheticCallerHash,
                },
              ],
            };
          }
          if (u.pathname.includes('/transcripts/')) {
            if (u.pathname.endsWith(encodeURIComponent('20261116/other-17:42:10-hangup01'))) {
              return {
                interaction_id: '20261116/other-17:42:10-hangup01',
                messages: [
                  { role: 'assistant', language_name: 'English', content: "Hello! I'm Thaara, an AI voice assistant from Quantum Weave. Is this a good time to speak with you?", turn_id: 0 },
                ],
              };
            }
            assert.ok(u.pathname.endsWith(encodeURIComponent(interactionId)));
            return {
              interaction_id: interactionId,
              messages: [
                { role: 'assistant', language_name: 'English', content: "Hello! I'm Thaara, an AI voice assistant from Quantum Weave. Is this a good time to speak with you?", turn_id: 0 },
                { role: 'user', language_name: 'UNKNOWN', content: 'No, call me, book me a call back request.', turn_id: 3 },
                { role: 'assistant', language_name: 'English', content: 'I can definitely help you with that. To get everything set up, may I have your name and the name of your business, please?', turn_id: 4 },
                { role: 'user', language_name: 'UNKNOWN', content: 'My name is Krishna and we are handling the real estate business.', turn_id: 5 },
                { role: 'user', language_name: 'UNKNOWN', content: 'And in the voice agent like you.', turn_id: 7 },
                { role: 'assistant', language_name: 'English', content: "Got it. So you're interested in voice agents like me for your real estate business. Could you please share your email address with me?", turn_id: 8 },
                { role: 'user', language_name: 'UNKNOWN', content: 'krishna.test@example.com.', turn_id: 9 },
                { role: 'assistant', language_name: 'English', content: "Thanks for that. So, just to make sure I have everything right, I have your name as Krishna from a real estate business, and you're interested in voice agents. Your email is krishna dot test at example dot com.\n\nShall I go ahead and submit this callback request for you?", turn_id: 10 },
                { role: 'user', language_name: 'UNKNOWN', content: 'Yes, submit it.', turn_id: 11 },
                { role: 'assistant', language_name: 'English', content: 'All set, Krishna! Your request has been noted, and someone from the Quantum Weave team will reach out to you soon. \n\nIs there anything else I can help you with today?', turn_id: 12 },
                { role: 'user', language_name: 'UNKNOWN', content: 'Nothing. Thank you.', turn_id: 13 },
                { role: 'assistant', language_name: 'English', content: "You're very welcome, Krishna! Thank you for calling. Have a wonderful day!", turn_id: 14 },
              ],
            };
          }
          throw new Error(`Unexpected Sarvam URL: ${url}`);
        },
        {
          now: () => invokeClockMs,
          autoFinalizeDelaysMs: [25, 35, 50],
        }
      );

      try {
        // Exact mid-call payload from `call-37d21939-4c81-45ae-9d0b-065a2c5e7e3d` with null system vars
        const midRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: null,
            user_identifier: null,
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            caller_name: 'Krishna',
            business_name: 'Real Estate Business',
            required_services: 'Voice AI Agents',
            caller_email: 'krishna.test@example.com',
            email_declined: false,
            caller_notes: 'Interested in "voice agent like you" for real estate business.',
          },
        });
        assert.equal(midRes.statusCode, 200);
        assert.deepEqual(midRes.json(), { saved: false, status: 'queued', missingFields: [] });

        // Also verify omitted `interaction_id` & `user_identifier` deduplicates cleanly
        const midOmittedReplay = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            app_id: PROFILE_V26.appId,
            app_version: '26',
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            caller_name: 'Krishna',
            business_name: 'Real Estate Business',
            required_services: 'Voice AI Agents',
            caller_email: 'krishna.test@example.com',
            email_declined: false,
            caller_notes: 'Interested in "voice agent like you" for real estate business.',
          },
        });
        assert.equal(midOmittedReplay.statusCode, 200);
        assert.deepEqual(midOmittedReplay.json(), { saved: false, status: 'queued', missingFields: [] });

        // First timer tick runs while call is still active (`end_datetime: null`) -> nothing persisted yet!
        await delay(35);
        assert.equal(state.callbackRequests.length, 0);
        await worker.run();
        assert.equal(state.sentEmails.length, 0);

        // Call hangs up -> Sarvam NEVER calls `/call-completion`! Background timer tick #2 auto-finalizes!
        callEndedInSarvam = true;
        await delay(60);
        await drainPending();

        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.callbackRequests[0].call_id, expectedCallId);
        assert.equal(state.callbackRequests[0].details.phoneNumber, syntheticCallerE164);
        assert.equal(state.callbackRequests[0].details.name, 'Krishna');
        assert.equal(state.callbackRequests[0].details.business, 'Real Estate Business');
        assert.equal(state.callbackRequests[0].details.service, 'Voice AI Agents');
        assert.equal(state.callbackRequests[0].details.email, 'krishna.test@example.com');
        assert.equal(state.callbackRequests[0].notification_status, 'pending');
        assert.equal(state.callEvents.length, 1);
        assert.equal(state.callEvents[0].report.outcome, 'callback_requested');
        assert.equal(state.callEvents[0].report.callbackConsent, 'confirmed');

        // Standing worker dispatches exact 1 email to connect@brandmintai.io!
        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.equal(state.sentEmails[0].from, 'notifications@brandmintai.io');
        assert.equal(state.sentEmails[0].to, 'connect@brandmintai.io');
        assert.equal(state.sentEmails[0].subject, 'New Callback Request — Thaara AI');
        assert.match(state.sentEmails[0].bodyText, /Customer name: Krishna/);
        assert.match(state.sentEmails[0].bodyText, /Business name: Real Estate Business/);
        assert.match(state.sentEmails[0].bodyText, /Phone: \+919845065432/);
        assert.match(state.sentEmails[0].bodyText, /Email: krishna\.test@example\.com/);
        assert.match(state.sentEmails[0].bodyText, /Services requested: Voice AI Agents/);
        assert.equal(state.callbackRequests[0].notification_status, 'sent');

        // Re-running auto-finalizer and worker produces 0 duplicate rows and 0 duplicate emails!
        await drainPending();
        await worker.run();
        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.sentEmails.length, 1);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // L18: Mid-call saved row (`saved: true`) WITHOUT `On end` webhook auto-finalizes via Sarvam Analytics
    // -------------------------------------------------------------------------
    await test('L18_MIDCALL_SAVED_WITHOUT_ON_END_WEBHOOK_AUTO_FINALIZES', 'Mid-call saved row (known interaction_id + hashed CLI) promotes from needs_review to pending via Sarvam Analytics when On-end webhook never fires', async () => {
      const callerE164 = '+919845022334';
      const callerHash = sha256(callerE164);
      const interactionId = '20261116/saved-no-onend-01';
      let ended = false;
      const invokeClockMs = Date.parse('2026-11-16T12:30:00Z');

      const { receiver, drainPending, worker, state } = await bootWithSarvamMock(
        async (url) => {
          const u = new URL(url);
          if (u.pathname.endsWith('/attempts')) {
            return {
              items: [{
                interaction_id: interactionId,
                channel_direction: 'inbound',
                app_version: 26,
                deployment_id: PROFILE_V26.deploymentId,
                bot_contact_identifier: PROFILE_V26.agentPhoneNumber,
                start_datetime: '2026-11-16T12:29:10',
                end_datetime: ended ? '2026-11-16T12:30:20' : null,
                duration_in_seconds: ended ? 70 : null,
                user_contact: callerE164,
                user_contact_hashed: callerHash,
              }],
            };
          }
          return {
            interaction_id: interactionId,
            messages: [
              { role: 'assistant', content: 'Just to recap: Priya Menon from Apex Dental, interested in WhatsApp appointment bot, no email. Shall I go ahead and submit this for you?', language_name: 'English' },
              { role: 'user', content: 'Yes, you can submit it.', language_name: 'English' },
              { role: 'assistant', content: 'All set!', language_name: 'English' },
            ],
          };
        },
        { now: () => invokeClockMs, autoFinalizeDelaysMs: [20, 40] }
      );

      try {
        const midRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerHash,
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            caller_name: 'Priya Menon',
            business_name: 'Apex Dental',
            required_services: 'WhatsApp appointment bot',
            email_declined: true,
          },
        });
        assert.equal(midRes.statusCode, 200);
        assert.equal(midRes.json().saved, true);
        assert.equal(state.callbackRequests[0].notification_status, 'needs_review');

        ended = true;
        await drainPending();
        assert.equal(state.callbackRequests[0].notification_status, 'pending');

        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.match(state.sentEmails[0].bodyText, /Customer name: Priya Menon/);
        assert.equal(state.callbackRequests[0].notification_status, 'sent');
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // L19: Auto-Finalizer cancels callback & sends 0 emails if caller withdraws before hangup
    // -------------------------------------------------------------------------
    await test('L19_AUTO_FINALIZER_WITHDRAWAL_BLOCKS_EMAIL', 'Auto-Finalizer cancels queued null-var intake when caller withdraws before hangup (0 emails)', async () => {
      const callerE164 = '+919845033445';
      const callerHash = sha256(callerE164);
      const interactionId = '20261116/nullvar-withdraw-01';
      const invokeClockMs = Date.parse('2026-11-16T12:40:30Z');

      const { receiver, drainPending, worker, state } = await bootWithSarvamMock(
        async (url) => {
          const u = new URL(url);
          if (u.pathname.endsWith('/attempts')) {
            return {
              items: [{
                interaction_id: interactionId,
                channel_direction: 'inbound',
                app_version: 26,
                deployment_id: PROFILE_V26.deploymentId,
                bot_contact_identifier: PROFILE_V26.agentPhoneNumber,
                start_datetime: '2026-11-16T12:40:00',
                end_datetime: '2026-11-16T12:41:00',
                duration_in_seconds: 60,
                user_contact: callerE164,
                user_contact_hashed: callerHash,
              }],
            };
          }
          return {
            interaction_id: interactionId,
            messages: [
              { role: 'assistant', content: 'Confirming: Suresh from Metro Mart, CRM automation, no email. Shall I go ahead and submit this callback request for you?', language_name: 'English' },
              { role: 'user', content: 'Yes, submit it.', language_name: 'English' },
              { role: 'assistant', content: 'All set! Anything else?', language_name: 'English' },
              { role: 'user', content: "Wait, please don't call me, cancel the callback.", language_name: 'English' },
            ],
          };
        },
        { now: () => invokeClockMs, autoFinalizeDelaysMs: [1000] }
      );

      try {
        const midRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: '',
            user_identifier: '',
            caller_name: 'Suresh',
            business_name: 'Metro Mart',
            required_services: 'CRM automation',
            email_declined: true,
          },
        });
        assert.equal(midRes.statusCode, 200);
        assert.equal(midRes.json().status, 'queued');

        await drainPending();
        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.callbackRequests[0].request_status, 'cancelled');
        assert.equal(state.callbackRequests[0].notification_status, 'needs_review');

        await worker.run();
        assert.equal(state.sentEmails.length, 0);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // L20: Ambiguous concurrent calls with identical details & null `interaction_id` fail closed
    // -------------------------------------------------------------------------
    await test('L20_AUTO_FINALIZER_AMBIGUOUS_CONCURRENT_CALLS_FAILS_CLOSED', 'Two concurrent ended calls matching same details when interaction_id is null fail closed (0 guessed numbers, 0 emails)', async () => {
      const invokeClockMs = Date.parse('2026-11-16T12:50:30Z');
      const { receiver, drainPending, worker, state } = await bootWithSarvamMock(
        async (url) => {
          const u = new URL(url);
          if (u.pathname.endsWith('/attempts')) {
            return {
              items: [
                {
                  interaction_id: '20261116/ambig-call-01',
                  channel_direction: 'inbound',
                  app_version: 26,
                  deployment_id: PROFILE_V26.deploymentId,
                  bot_contact_identifier: PROFILE_V26.agentPhoneNumber,
                  start_datetime: '2026-11-16T12:50:00',
                  end_datetime: '2026-11-16T12:51:00',
                  duration_in_seconds: 60,
                  user_contact: '+919845000001',
                  user_contact_hashed: sha256('+919845000001'),
                },
                {
                  interaction_id: '20261116/ambig-call-02',
                  channel_direction: 'inbound',
                  app_version: 26,
                  deployment_id: PROFILE_V26.deploymentId,
                  bot_contact_identifier: PROFILE_V26.agentPhoneNumber,
                  start_datetime: '2026-11-16T12:50:05',
                  end_datetime: '2026-11-16T12:51:05',
                  duration_in_seconds: 60,
                  user_contact: '+919845000002',
                  user_contact_hashed: sha256('+919845000002'),
                },
              ],
            };
          }
          return {
            messages: [
              { role: 'assistant', content: 'Confirming: Ravi from Star Retail, Voice AI, no email. Shall I go ahead and submit this callback request for you?', language_name: 'English' },
              { role: 'user', content: 'Yes, submit it.', language_name: 'English' },
            ],
          };
        },
        { now: () => invokeClockMs, autoFinalizeDelaysMs: [1000] }
      );

      try {
        const res = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: null,
            user_identifier: null,
            caller_name: 'Ravi',
            business_name: 'Star Retail',
            required_services: 'Voice AI',
            email_declined: true,
          },
        });
        assert.equal(res.statusCode, 200);
        await drainPending();
        assert.equal(state.callbackRequests.length, 0);
        await worker.run();
        assert.equal(state.sentEmails.length, 0);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // L21: Auto-Finalizer followed by HTTP `/call-completion-event` is 100% idempotent & auth-gated
    // -------------------------------------------------------------------------
    await test('L21_AUTO_FINALIZER_THEN_HTTP_COMPLETION_IDEMPOTENT', 'Auto-Finalizer finalizing before HTTP /call-completion-event returns authenticated 200 without 409 conflict or duplicate email', async () => {
      const callerE164 = '+919845044556';
      const callerHash = sha256(callerE164);
      const interactionId = '20261116/both-paths-01';
      const invokeClockMs = Date.parse('2026-11-16T13:00:30Z');

      const { receiver, drainPending, worker, state } = await bootWithSarvamMock(
        async (url) => {
          const u = new URL(url);
          if (u.pathname.endsWith('/attempts')) {
            return {
              items: [{
                interaction_id: interactionId,
                channel_direction: 'inbound',
                app_version: 26,
                deployment_id: PROFILE_V26.deploymentId,
                bot_contact_identifier: PROFILE_V26.agentPhoneNumber,
                start_datetime: '2026-11-16T13:00:00',
                end_datetime: '2026-11-16T13:01:00',
                duration_in_seconds: 60.4,
                user_contact: callerE164,
                user_contact_hashed: callerHash,
              }],
            };
          }
          return {
            interaction_id: interactionId,
            messages: [
              { role: 'assistant', content: 'Confirming: Anita from Cloud Nine Bakery, WhatsApp ordering, no email. Shall I go ahead and submit this callback request for you?', language_name: 'English' },
              { role: 'user', content: 'Yes, submit it.', language_name: 'English' },
            ],
          };
        },
        { now: () => invokeClockMs, autoFinalizeDelaysMs: [1000] }
      );

      try {
        await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: null,
            user_identifier: null,
            caller_name: 'Anita',
            business_name: 'Cloud Nine Bakery',
            required_services: 'WhatsApp ordering',
            email_declined: true,
          },
        });
        await drainPending();
        await worker.run();
        assert.equal(state.sentEmails.length, 1);

        // Unauthenticated HTTP completion still rejected 403!
        const unauthHttp = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion-event`,
          headers: { authorization: 'Bearer invalid_token' },
          payload: { interaction_id: interactionId },
        });
        assert.equal(unauthHttp.statusCode, 403);

        // Authenticated HTTP completion with slightly different duration formatting succeeds 200 idempotently!
        const authHttp = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion-event`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerHash,
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            duration_seconds: 60,
            call_start_time: '2026-11-16T13:00:00Z',
            call_end_time: '2026-11-16T13:01:00Z',
            call_transcript: JSON.stringify({ transcript: [] }),
          },
        });
        assert.equal(authHttp.statusCode, 200);
        assert.equal(authHttp.json().saved, true);

        await worker.run();
        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.callEvents.length, 1);
        assert.equal(state.sentEmails.length, 1);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // L22: EXACT Reproduction of Post-R5 Real Call `20261117/afcd65d2-11:23:58-aw18dc4d`:
    //      - Mid-call `save_callback_request` sends unrecognized non-null `user_identifier: "+91******1539"`
    //        and `interaction_id: "{interaction_id}"` (which caused HTTP 503 on R5 before gate.run!)
    //      - 2.8s after hangup, `save_call_completion_event` fires with `user_identifier: "+91******1539"`,
    //        `agent_phone_number: "8064269780"`, `duration_seconds: "98.53s"`, `17 Nov 2026` timestamps,
    //        and empty `transcript: ""` (which caused HTTP 403 at 05:55:38.858282Z!)
    //      - Verifies repaired R5 returns HTTP 200 `queued` mid-call, enriches & verifies from Sarvam Analytics,
    //        commits exact `call_id = c57352f3...`, promotes to `'pending'`, and dispatches exact 1 Resend email!
    // -------------------------------------------------------------------------
    await test('L22_EXACT_CALL_112358_MASKED_MIDCALL_AND_ONEND_ENRICHMENT', 'Exact reproduction of 20261117/afcd65d2-11:23:58-aw18dc4d (masked user_identifier + placeholder interaction_id mid-call + partial On-end webhook 2.8s after hangup) persists and sends 1 Resend email', async () => {
      const syntheticCallerE164 = '+919845071539';
      const syntheticCallerHash = sha256(syntheticCallerE164);
      const interactionId = '20261117/afcd65d2-11:23:58-aw18dc4d';
      const expectedCallId = 'c57352f31f125ecd4354cddf8620db765b8787591e90ecf62cae87c85c348397';
      const invokeClockMs = Date.parse('2026-11-17T05:55:20Z');
      let callEndedInSarvam = false;

      const { receiver, drainPending, worker, state } = await bootWithSarvamMock(
        async (url) => {
          const u = new URL(url);
          if (u.pathname.endsWith('/attempts')) {
            return {
              items: [{
                interaction_id: interactionId,
                channel_direction: 'inbound',
                app_version: 26,
                deployment_id: PROFILE_V26.deploymentId,
                bot_contact_identifier: PROFILE_V26.agentPhoneNumber,
                start_datetime: '2026-11-17T05:53:58',
                end_datetime: callEndedInSarvam ? '2026-11-17T05:55:36' : null,
                duration_in_seconds: callEndedInSarvam ? 98.53 : null,
                user_contact: syntheticCallerE164,
                user_contact_hashed: syntheticCallerHash,
              }],
            };
          }
          if (u.pathname.includes('/transcripts/')) {
            return {
              interaction_id: interactionId,
              messages: [
                { role: 'assistant', language_name: 'English', content: "Hello! I'm Thaara, an AI voice assistant from Quantum Weave. Is this a good time to speak with you?", turn_id: 0 },
                { role: 'user', language_name: 'UNKNOWN', content: 'Please have your team call me back. My name is Krishna, real estate business, looking for a voice agent like Thaara, email krishna.re@example.com.', turn_id: 5 },
                { role: 'assistant', language_name: 'English', content: "So, I have your name as Krishna, your business is in real estate, and you're looking for a voice agent. Your email is krishna.re@example.com. Shall I go ahead and submit this for you?", turn_id: 7 },
                { role: 'user', language_name: 'UNKNOWN', content: 'Yeah submit.', turn_id: 8 },
                { role: 'assistant', language_name: 'English', content: 'All set, Krishna! Someone from our team will reach out soon. Anything else?', turn_id: 9 },
                { role: 'user', language_name: 'UNKNOWN', content: 'No, thank you.', turn_id: 10 },
              ],
            };
          }
          throw new Error(`Unexpected Sarvam URL: ${url}`);
        },
        { now: () => invokeClockMs, autoFinalizeDelaysMs: [5000] }
      );

      try {
        const midRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: '{interaction_id}',
            user_identifier: '+91******1539',
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            caller_name: 'Krishna',
            business_name: 'Real Estate business',
            required_services: 'Voice AI Agents',
            caller_email: 'krishna.re@example.com',
            email_declined: false,
            caller_notes: 'needs a voice agent like Thaara',
          },
        });
        assert.equal(midRes.statusCode, 200);
        assert.deepEqual(midRes.json(), { saved: false, status: 'queued', missingFields: [] });

        // 2.8s after hangup: Sarvam's On-end webhook fires with masked CLI, 10-digit agent number, "98.53s", and empty transcript!
        callEndedInSarvam = true;
        const onEndRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion-event`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: '+91******1539',
            app_id: PROFILE_V26.appId,
            app_version: 'v26',
            agent_phone_number: '8064269780',
            duration_seconds: '98.53s',
            call_start_time: '17 Nov 2026, 11:23:58 AM',
            call_end_time: '17 Nov 2026, 11:25:36 AM',
            transcript: '',
          },
        });
        assert.equal(onEndRes.statusCode, 200);
        assert.equal(onEndRes.json().saved, true);
        assert.equal(onEndRes.json().outcome, 'callback_requested');

        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.callbackRequests[0].call_id, expectedCallId);
        assert.equal(state.callbackRequests[0].details.phoneNumber, syntheticCallerE164);
        assert.equal(state.callbackRequests[0].notification_status, 'pending');

        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.equal(state.sentEmails[0].to, 'connect@brandmintai.io');
        assert.match(state.sentEmails[0].bodyText, /Customer name: Krishna/);
        assert.match(state.sentEmails[0].bodyText, /Business name: Real Estate business/);
        assert.match(state.sentEmails[0].bodyText, /Services requested: Voice AI Agents/);
        assert.match(state.sentEmails[0].bodyText, /needs a voice agent like Thaara/);
        assert.equal(state.callbackRequests[0].notification_status, 'sent');

        await drainPending();
        await worker.run();
        assert.equal(state.sentEmails.length, 1);
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // L23: Timing Race — `save_call_completion_event` arrives 2.8s after hangup BEFORE
    //      Sarvam Analytics indexes `end_datetime` / `/transcripts`, then Analytics indexes 5s later!
    // -------------------------------------------------------------------------
    await test('L23_ONEND_BEFORE_ANALYTICS_INDEXING_SURVIVES_AND_FINALIZES', '10-digit mid-call user_identifier + On-end webhook arriving before Sarvam Analytics indexes preserves staged callback and auto-finalizes once indexed', async () => {
      const callerE164 = '+919845081234';
      const callerHash = sha256(callerE164);
      const interactionId = '20261117/race-index-delay-01';
      const invokeClockMs = Date.parse('2026-11-17T06:10:20Z');
      let analyticsIndexed = false;

      const { receiver, drainPending, worker, state } = await bootWithSarvamMock(
        async (url) => {
          if (!analyticsIndexed) return { items: [] };
          const u = new URL(url);
          if (u.pathname.endsWith('/attempts')) {
            return {
              items: [{
                interaction_id: interactionId,
                channel_direction: 'inbound',
                app_version: 26,
                deployment_id: PROFILE_V26.deploymentId,
                bot_contact_identifier: PROFILE_V26.agentPhoneNumber,
                start_datetime: '2026-11-17T06:09:00',
                end_datetime: '2026-11-17T06:10:35',
                duration_in_seconds: 95,
                user_contact: callerE164,
                user_contact_hashed: callerHash,
              }],
            };
          }
          return {
            interaction_id: interactionId,
            messages: [
              { role: 'assistant', content: 'Confirming: Karthik from Horizon Estates, Voice AI, email karthik@horizon.example. Shall I go ahead and submit this for you?', language_name: 'English' },
              { role: 'user', content: 'Yeah submit.', language_name: 'English' },
            ],
          };
        },
        { now: () => invokeClockMs, autoFinalizeDelaysMs: [5000] }
      );

      try {
        const midRes = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: 'UNKNOWN',
            user_identifier: '9845081234',
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            caller_name: 'Karthik',
            business_name: 'Horizon Estates',
            required_services: 'Voice AI',
            caller_email: 'karthik@horizon.example',
            email_declined: false,
          },
        });
        assert.equal(midRes.statusCode, 200);
        assert.equal(midRes.json().status, 'queued');

        // At t_end + 2.8s, On-end webhook arrives with unindexed Analytics & masked CLI -> fails closed 403, WITHOUT losing staged entry!
        const earlyEnd = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion-event`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: '+91******1234',
            app_id: '@App ID',
            app_version: '@App version',
            agent_phone_number: '@Agent phone number',
            transcript: '@Conversation transcript',
            duration_seconds: '@Duration',
            call_start_time: '@Call start time',
            call_end_time: '@Call end time',
          },
        });
        assert.equal(earlyEnd.statusCode, 403);
        assert.equal(state.callbackRequests.length, 0);

        // 5 seconds later, Sarvam Analytics finishes indexing -> Auto-Finalizer drains and sends exact 1 email!
        analyticsIndexed = true;
        await drainPending();
        assert.equal(state.callbackRequests.length, 1);
        assert.equal(state.callbackRequests[0].notification_status, 'pending');

        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.match(state.sentEmails[0].bodyText, /Customer name: Karthik/);
        assert.equal(state.callbackRequests[0].notification_status, 'sent');
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // L24: Zero-PII / Zero-Secret Diagnostics & Mismatched Masked CLI Rejection
    // -------------------------------------------------------------------------
    await test('L24_ZERO_PII_DIAGNOSTICS_AND_MASKED_MISMATCH_REJECTED', 'Diagnostic telemetry never logs PII/secrets; mismatched masked caller hint on completion is rejected HTTP 403', async () => {
      const callerE164 = '+919845091111';
      const callerHash = sha256(callerE164);
      const interactionId = '20261117/diag-safety-01';
      const invokeClockMs = Date.parse('2026-11-17T06:20:00Z');
      const diagEntries = [];

      const { receiver, drainPending } = await bootWithSarvamMock(
        async (url) => {
          const u = new URL(url);
          if (u.pathname.endsWith('/attempts')) {
            return {
              items: [{
                interaction_id: interactionId,
                channel_direction: 'inbound',
                app_version: 26,
                deployment_id: PROFILE_V26.deploymentId,
                bot_contact_identifier: PROFILE_V26.agentPhoneNumber,
                start_datetime: '2026-11-17T06:19:00',
                end_datetime: '2026-11-17T06:20:10',
                duration_in_seconds: 70,
                user_contact: callerE164,
                user_contact_hashed: callerHash,
              }],
            };
          }
          return {
            interaction_id: interactionId,
            messages: [
              { role: 'assistant', content: 'Confirming: SecretPersonName from SecretBiz, Voice AI, email secret.person@private.example. Shall I go ahead and submit this for you?', language_name: 'English' },
              { role: 'user', content: 'Yeah submit.', language_name: 'English' },
            ],
          };
        },
        {
          now: () => invokeClockMs,
          autoFinalizeDelaysMs: [5000],
          onDiagnostic: (entry) => diagEntries.push(entry),
        }
      );

      try {
        // Mismatched masked digits (+91******9999 vs +919845091111) MUST be rejected HTTP 403!
        const mismatchEnd = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/call-completion-event`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: '+91******9999',
            app_id: PROFILE_V26.appId,
            app_version: 26,
            agent_phone_number: PROFILE_V26.agentPhoneNumber,
            transcript: '',
          },
        });
        assert.equal(mismatchEnd.statusCode, 403);

        await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: `Bearer ${INBOUND_TOKEN}` },
          payload: {
            interaction_id: interactionId,
            user_identifier: '+91******1111',
            caller_name: 'SecretPersonName',
            business_name: 'SecretBiz',
            required_services: 'Voice AI',
            caller_email: 'secret.person@private.example',
            email_declined: false,
            caller_notes: 'SuperConfidentialNote123',
          },
        });
        await drainPending();

        assert.ok(diagEntries.length >= 2);
        const serializedDiags = JSON.stringify(diagEntries);
        for (const forbidden of [
          '9845091111',
          '1111',
          'SecretPersonName',
          'SecretBiz',
          'secret.person@private.example',
          'SuperConfidentialNote123',
          INBOUND_TOKEN,
          SARVAM_API_KEY,
          ROUTE_ID,
        ]) {
          assert.equal(serializedDiags.includes(forbidden), false, `Diagnostic leaked forbidden substring: ${forbidden}`);
        }
      } finally {
        await receiver.close();
      }
    });

    console.log(JSON.stringify({
      status: 'PASS',
      baseCompatibilityPassed: 12,
      r5SpecificPassed: r5Results.length,
      totalPassed: 12 + r5Results.length,
      failed: 0,
      r5Results,
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
