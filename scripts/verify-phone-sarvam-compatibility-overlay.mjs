import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let stage = 'module_hashes';
try {
  const [manifestPath, serviceDirectory = '/app/apps/api/dist/services'] = process.argv.slice(2);
  const manifest = typeof PACKED_MANIFEST === 'undefined' ? JSON.parse(readFileSync(manifestPath, 'utf8')) : PACKED_MANIFEST;
  const { overlayFiles, retainedResultsSha256 } = manifest;
  const files = ['phone-sarvam-runtime.js', 'phone-sarvam-knowledge-binding.js', 'phone-sarvam-calls.js', 'phone-sarvam-results.js'];
  const hashes = retainedResultsSha256 === undefined ? overlayFiles : { ...overlayFiles, 'phone-sarvam-results.js': retainedResultsSha256 };
  assert.deepEqual(Object.keys(hashes).sort(), [...files].sort());
  if (retainedResultsSha256 !== undefined) assert.equal(Object.hasOwn(overlayFiles, 'phone-sarvam-results.js'), false);
  for (const file of files) {
    const actual = createHash('sha256').update(readFileSync(join(serviceDirectory, file))).digest('hex');
    assert.equal(actual, hashes[file], file);
  }
  if (manifest.contractOverlayFiles !== undefined) {
    const contracts = resolve(serviceDirectory, '../../node_modules/@thaara/contracts/dist');
    const names = ['index.js', 'phone-sarvam-compat.js'];
    assert.deepEqual(Object.keys(manifest.contractOverlayFiles).sort(), names);
    for (const name of names) {
      const actual = createHash('sha256').update(readFileSync(join(contracts, name))).digest('hex');
      assert.equal(actual, manifest.contractOverlayFiles[name], name);
    }
  }

  const importService = (name) => import(pathToFileURL(resolve(serviceDirectory, name)).href);
  stage = 'runtime_import';
  const { loadSarvamRuntime } = await importService('phone-sarvam-runtime.js');
  stage = 'adapter_import';
  const { createSarvamCallProvider } = await importService('phone-sarvam-calls.js');
  const legacy = {
    reviewOnly: false, runtimeProfile: true, orgId: 'test-org', workspaceId: 'test-workspace',
    appId: 'test-agent', appVersion: 2, connectionId: 'test-connection', agentPhoneNumber: '+918000000001',
    requiredMaxCallLengthMinutes: 5, verifiedMaxCallLengthMinutes: 5,
    variableMapping: { call_purpose: 'approvedDraft.purpose', user_name: 'approvedDraft.recipient.displayName' },
  };
  const digest = 'a'.repeat(64);
  const next = {
    ...legacy, appVersion: 19,
    companyKnowledge: {
      reviewOnly: false, providerAcceptanceVerified: true, direction: 'outbound', appVersion: 19,
      inboundAppVersion: 21, maxDurationSeconds: 300, knowledgeBaseId: 'test-linktree',
      knowledgeVersion: 'qw-company-kb-v3-linktree', knowledgeSha256: digest, policyVersion: 'qw-route-policy-v1',
      policySha256: digest, commonPolicySha256: digest, acceptanceEvidenceSha256: digest,
    },
  };
  const env = {
    THAARA_PHONE_LIVE_CALLING: 'approved', THAARA_PHONE_CALLBACK_ORIGIN: 'https://thaara.example.com',
    THAARA_SARVAM_PROFILE_FILE: '/synthetic/profile', THAARA_SARVAM_API_KEY_FILE: '/synthetic/key',
    THAARA_SARVAM_WEBHOOK_SECRET_FILE: '/synthetic/hook',
  };
  const load = (profile) => loadSarvamRuntime(env, {
    mode: async () => 0o600,
    readText: async (path) => {
      if (path === '/synthetic/profile') return JSON.stringify(profile);
      if (path === '/synthetic/key') return 'synthetic-api-key';
      assert.equal(path, '/synthetic/hook');
      return 'synthetic-callback-secret-0123456789abcdef';
    },
  });

  stage = 'legacy_profile';
  const oldRuntime = await load(legacy);
  assert.equal(oldRuntime.status, 'ready');
  assert.equal(oldRuntime.providerOptions.companyKnowledge, undefined);
  stage = 'candidate_profile';
  const nextRuntime = await load(next);
  assert.equal(nextRuntime.status, 'ready');
  assert.equal(nextRuntime.providerOptions.companyKnowledge.inboundAppVersion, 21);
  stage = 'evidence_gate';
  const blocked = await load({ ...next, companyKnowledge: { ...next.companyKnowledge, acceptanceEvidenceSha256: null } });
  assert.deepEqual(blocked, { status: 'refused', reasons: ['knowledge_binding_invalid'] });

  const fakeRequests = [];
  const interactionId = '20261108/synthetic-interaction';
  const makeProvider = (runtime) => createSarvamCallProvider({
    ...runtime.providerOptions, liveCallingEnabled: true,
    fetch: async (url, options) => {
      if (options.method === 'GET') {
        if (new URL(url).pathname.endsWith('/attempts')) return Response.json({ items: [{
          attempt_id: 'synthetic-attempt', app_version: runtime.profile.appVersion, channel_direction: 'outbound',
          connectivity_status: 'connected', interaction_id: interactionId, end_datetime: '2026-11-08T01:01:00Z',
        }] });
        assert.ok(new URL(url).pathname.endsWith('/transcripts/' + encodeURIComponent(interactionId)));
        return Response.json({ interaction_id: interactionId, messages: [
          { role: 'assistant', content: 'When can we talk?' }, { role: 'user', content: 'Tomorrow afternoon.' },
        ] });
      }
      fakeRequests.push(JSON.parse(options.body));
      return new Response('{"attempt_id":"synthetic-attempt"}');
    },
  });
  stage = 'approval_binding';
  const previousProvider = makeProvider(oldRuntime);
  const candidateProvider = makeProvider(nextRuntime);
  assert.notEqual(previousProvider.configurationFingerprint, candidateProvider.configurationFingerprint);
  const request = {
    callId: 'aaaaaaaa-1111-4111-8111-111111111111', to: '+918000000002', recipientName: 'Preview Tester',
    purpose: 'Ask about apps.', language: 'en-IN', maxDurationSeconds: 300, aiDisclosure: 'I am Thaara, an AI assistant.',
  };
  for (const provider of [previousProvider, candidateProvider]) {
    stage = 'simulated_dispatch';
    assert.equal((await provider.dispatch(request)).status, 'unverified');
    stage = 'report_readback';
    const report = await provider.readResult({ attemptId: 'synthetic-attempt', createdAt: '2026-11-08T01:00:00Z' });
    assert.equal(report.status, 'available');
    assert.deepEqual(report.responses, ['Tomorrow afternoon.']);
  }
  stage = 'dispatch_scope';
  assert.deepEqual(fakeRequests.map((body) => body.app_config.app_version), [2, 19]);
  for (const body of fakeRequests) {
    assert.equal(body.user_config.user_phone_number, request.to);
    assert.deepEqual(body.app_config.agent_variables, { user_name: request.recipientName, call_purpose: request.purpose });
  }
  console.log(JSON.stringify({ status: 'passed', filesVerified: files.length, rollbackV2Ready: true,
    syntheticV19Ready: true, evidenceRequired: true, separateApprovalFingerprints: true, resultReaderVerified: true, providerRequests: 0 }));
} catch {
  console.log(JSON.stringify({ status: 'failed', stage }));
  process.exitCode = 1;
}
