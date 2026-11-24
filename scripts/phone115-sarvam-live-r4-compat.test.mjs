#!/usr/bin/env node
/**
 * Focused End-to-End Offline Validation for `phone115-sarvam-live-release-20261116-r4`:
 * - Preserves all L1–L12 compatibility checks from `phone115-sarvam-live-compat.test.mjs`
 * - Verifies Stage A fix: 64-char hex `user_identifier` (`SHA256(user_contact)`) resolved via
 *   read-only Sarvam Analytics `/attempts` with cryptographic SHA-256 preimage verification,
 *   including both mid-call indexed resolution (with 15m cache hit at `on_end`) and mid-call
 *   unindexed staging flushed + verified at `on_end`.
 * - Verifies Stage B fix: real Indian-English ASR `"Ah submitted."` confirmation turn.
 * - Verifies auth-first gate (0 Sarvam fetches on unauthenticated calls) and hash-mismatch rejection.
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
const PKG_R3 = path.join(ROOT, 'artifacts/phone115-sarvam-live-release-20261114-r3');
const PKG_R4 = path.join(ROOT, 'artifacts/phone115-sarvam-live-release-20261116-r4');

// Hard-block any real outbound sockets/HTTP
import net from 'node:net';
import tls from 'node:tls';
net.Socket.prototype.connect = () => { throw new Error('OFFLINE_VIOLATION'); };
tls.connect = () => { throw new Error('OFFLINE_VIOLATION'); };
globalThis.fetch = async () => { throw new Error('OFFLINE_VIOLATION'); };

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

async function main() {
  // 1. Run the existing L1-L12 suite against the new r4 overlay by copying r4 into an isolated temp package
  const r3TestSrc = fs.readFileSync(path.join(ROOT, 'scripts/phone115-sarvam-live-compat.test.mjs'), 'utf8');
  const tempRunner = path.join(ROOT, 'scripts/.tmp-phone115-r4-base-check.mjs');
  try {
    fs.writeFileSync(tempRunner, r3TestSrc.replace(
      "artifacts/phone115-sarvam-live-release-20261114-r3",
      "artifacts/phone115-sarvam-live-release-20261116-r4"
    ));
    const { execFileSync } = await import('node:child_process');
    const baseOut = JSON.parse(execFileSync(process.execPath, [tempRunner], { encoding: 'utf8' }));
    assert.equal(baseOut.status, 'PASS');
    assert.equal(baseOut.passed, 12);
    assert.equal(baseOut.failed, 0);
  } finally {
    fs.rmSync(tempRunner, { force: true });
  }

  // 2. Run dedicated r4 Stage A + Stage B tests (L13 - L16) under full production v26 profile
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'thaara-phone115-r4-compat-'));
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
      + '\nexport function createInboundPrincipalGate(opts) { const g = Object.freeze(__rawCreateInboundPrincipalGate(opts)); __gates.add(g); return g; }\n');
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
import { ForbiddenError } from '@thaara/observability';
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
    copyDir(path.join(PKG_R4, 'apps/api'), apiDir);

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
    fs.writeFileSync(path.join(apiDir, 'package.json'), JSON.stringify({ name: '@thaara/api-r4-compat-test', type: 'module' }, null, 2));
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
                  r = { workspace_id: p.workspaceId, owner_user_id: p.ownerUserId, request_id: p.id, call_id: p.callId, direction: 'inbound', request_hash: p.hash, details: structuredClone(p.details), occurred_at: '2026-11-16T07:19:50.000Z', request_status: 'requested', notification_status: 'needs_review', attempts: 0, notification_attempt_id: null, provider_message_id: null };
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

    async function bootWithSarvamMock(fetchHandler) {
      const binding = buildInboundServiceBinding(PROFILE_V26);
      const mock = createMockDb(PROFILE_V26, binding.profileFingerprint);
      let fetchCount = 0;
      globalThis.__TEST_RESOURCES__ = async ({ registerPool, revokePool }) => {
        registerPool(mock.ingestPool, 'thaara_phone_ingest', binding);
        return { status: 'resources_ready', runtimeAdmitted: false, profileFingerprint: binding.profileFingerprint, inboundProfile: PROFILE_V26, ingestPool: mock.ingestPool, async close() { revokePool(mock.ingestPool); } };
      };
      const receiver = await createPhoneCallbackReceiver(
        { THAARA_PHONE_CALLBACK_RECEIVER: 'approved' },
        {
          sarvamResolverOptions: {
            sleep: async () => {},
            resolveCredentials: async () => ({ orgId: 'org-test-01', workspaceId: 'ws-test-01', apiKey: SARVAM_API_KEY }),
            fetch: async (url, init) => {
              fetchCount += 1;
              assert.equal(init.headers['X-API-Key'], SARVAM_API_KEY);
              const bodyObj = await fetchHandler(url, fetchCount);
              return new Response(JSON.stringify(bodyObj), { status: 200, headers: { 'content-type': 'application/json' } });
            },
          },
        }
      );
      assert.equal(receiver.status, 'ready');
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
      return { receiver, worker, state: mock.state, getFetchCount: () => fetchCount };
    }

    const r4Results = [];
    async function test(id, title, fn) {
      await fn();
      r4Results.push({ id, title, passed: true });
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
        // Verified cache hit: 0 additional Sarvam HTTP calls during completion!
        assert.equal(getFetchCount(), 1);
        assert.equal(state.callbackRequests[0].notification_status, 'pending');

        await worker.run();
        assert.equal(state.sentEmails.length, 1);
        assert.equal(state.sentEmails[0].from, 'notifications@brandmintai.io');
        assert.equal(state.sentEmails[0].to, 'connect@brandmintai.io');
        assert.equal(state.sentEmails[0].subject, 'New Callback Request — Thaara AI');
        assert.match(state.sentEmails[0].bodyText, /Customer name: Nikhil Shetty/);
        assert.match(state.sentEmails[0].bodyText, /Phone: \+919845011223/);
        assert.equal(state.callbackRequests[0].notification_status, 'sent');
      } finally {
        await receiver.close();
      }
    });

    // -------------------------------------------------------------------------
    // L14: First-time caller unindexed mid-call -> staged -> flushed + finalized at on_end -> 1 email
    // -------------------------------------------------------------------------
    await test('L14_HASHED_UNINDEXED_MIDCALL_STAGED_TO_COMPLETION', 'Unindexed active call validates missing fields, stages valid mid-call intake truthfully, and flushes + dispatches 1 email at on_end', async () => {
      const callerE164 = '+919900887766';
      const callerHash = sha256(callerE164);
      const interactionId = '20261116/synthetic-unindexed-01';
      let indexed = false;
      const { receiver, worker, state } = await bootWithSarvamMock(async () => {
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
        // Missing business_name still returns `needs_details` even when hashed CLI is not indexed yet!
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

        // Complete details mid-call while still unindexed -> staged cleanly, truthful 503 unavailable
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
        assert.equal(stageRes.statusCode, 503);
        assert.equal(stageRes.json().saved, false);
        assert.equal(state.callbackRequests.length, 0);

        // Call ends -> Sarvam Analytics indexes the attempt -> completion flushes + finalizes!
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
        assert.match(state.sentEmails[0].bodyText, /Phone: \+919900887766/);
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
      const { receiver, worker, state } = await bootWithSarvamMock(async () => (
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
          user_contact: tamperedE164, // Does NOT match sha256(realE164)!
          user_contact_hashed: callerHash,
        }],
      }));
      try {
        // 1. Unauthenticated requests -> 0 fetches!
        const unauthMid = await receiver.app.inject({
          method: 'POST',
          url: `/api/v1/connectors/phone/inbound/${ROUTE_ID}/callback-request`,
          headers: { authorization: 'Bearer wrong_token' },
          payload: {
            interaction_id: interactionId,
            user_identifier: callerHash,
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

        // 2. Authenticated completion with tampered user_contact -> rejected 403!
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
        assert.equal(state.callEvents.length, 0);
        await worker.run();
        assert.equal(state.sentEmails.length, 0);
      } finally {
        await receiver.close();
      }
    });

    console.log(JSON.stringify({
      status: 'PASS',
      baseCompatibilityPassed: 12,
      r4SpecificPassed: r4Results.length,
      totalPassed: 12 + r4Results.length,
      failed: 0,
      r4Results,
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
