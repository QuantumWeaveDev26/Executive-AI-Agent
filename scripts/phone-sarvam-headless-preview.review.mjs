import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const PROFILE = '7a41b4f34482ccf833fcdab6b7bb0c8a5c198f52a994ec4d8c0ca11a19596447';
const PROFILE_PATH = '/run/secrets/sarvam_profile';
const KEY_PATH = '/run/secrets/sarvam_api_key';
const FIXTURES = {
  intro: '698a0e3801b110f2273a88e533f86ba7ee18c4bee08e301790b537f1eda659ff',
  interrupt: '48b713e285663e3db1e8fce11dc0ce8c3deddbf6df8ca9bb80454a622eb516f4',
};
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const AUDIO = 'server.media.audio_chunk';
const TEXT = 'server.event.transcription';
const INTERRUPT = 'server.event.user_interrupt';
const PURPOSE = 'Ask whether the business wants to discuss a website project.';

function require(condition, category) {
  if (!condition) throw new Error(category);
}

export function pcmFromWave(bytes) {
  require(bytes.length < 262144 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE', 'invalid_fixture');
  let formatVerified = false;
  let pcm;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    require(start + size <= bytes.length, 'invalid_fixture');
    if (type === 'fmt ') {
      require(size >= 16 && bytes.readUInt16LE(start) === 1 && bytes.readUInt16LE(start + 2) === 1 &&
        bytes.readUInt32LE(start + 4) === 16000 && bytes.readUInt16LE(start + 14) === 16, 'invalid_fixture_format');
      formatVerified = true;
    }
    if (type === 'data') pcm = bytes.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  require(formatVerified && pcm?.length > 32000 && pcm.length < 256000 && pcm.length % 2 === 0, 'invalid_fixture_data');
  return pcm;
}

export function signedVoiceUrl(raw, identifier) {
  const url = new URL(raw);
  require(url.protocol === 'wss:' && (url.hostname === 'sarvam.ai' || url.hostname.endsWith('.sarvam.ai')) &&
    !url.username && !url.password && !url.port && !url.hash, 'signed_host_denied');
  for (const [name, value] of Object.entries({ user_identifier: identifier, user_identifier_type: 'custom',
    sample_rate: '16000', interaction_type: 'call' })) url.searchParams.set(name, value);
  return url;
}

function keyFromMount() {
  require(process.env.THAARA_SARVAM_API_KEY_FILE === KEY_PATH, 'key_mount_denied');
  const fd = openSync(KEY_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    require(info.isFile() && info.size >= 8 && info.size <= 4096 && [0o400, 0o600].includes(info.mode & 0o777), 'key_file_denied');
    const key = readFileSync(fd, 'utf8').trim();
    require(key.length >= 8 && !/\s/.test(key), 'key_file_denied');
    return key;
  } finally { closeSync(fd); }
}

async function preview(version, profile, key, clips) {
  const identifier = 'thaara-voice-preview-' + version + '-' + randomUUID();
  const route = [profile.orgId, profile.workspaceId, profile.appId].map(encodeURIComponent);
  const endpoint = new URL(`https://apps.sarvam.ai/api/app-runtime/orgs/${route[0]}/workspaces/${route[1]}/apps/${route[2]}/url`);
  endpoint.search = new URLSearchParams({ version: String(version), interaction_type: 'call' });
  const observation = createVoiceObservation(version);
  let socket;
  let sessionAttempted = false;
  let phase = 'signed_url';
  let lastAudioAt = 0;
  let greetingAudio = false;
  let greetingDone = false;
  let interruptAt = 0;
  let staleAudio = false;
  let purposeMatched = false;
  let closed = false;
  let connected = false;
  let socketOpened = false;
  let toolEvent = false;
  let stopAt = 0;
  const send = (type, fields = {}) => socket.send(JSON.stringify({ origin: 'client', type, timestamp: Date.now() / 1000, ...fields }));
  const waitFor = async (condition, timeout, category) => {
    const until = Math.min(Date.now() + timeout, stopAt);
    while (!condition()) {
      require(!closed && !toolEvent && Date.now() < until, toolEvent ? 'tool_event_observed' : category);
      await delay(20);
    }
  };
  const feed = async (pcm) => {
    for (let i = 0; i < pcm.length; i += 640) {
      require(!closed && !toolEvent && Date.now() < stopAt, 'voice_stream_ended');
      send('client.media.audio_chunk', { audio_base64: pcm.subarray(i, i + 640).toString('base64'), format: 'audio/wav', sample_rate: 16000 });
      await delay(20);
    }
  };
  try {
    const response = await fetch(endpoint, { headers: { 'X-API-Key': key }, redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return { version, status: 'stopped', stage: phase, providerStatus: response.status, sessionAttempted };
    const signed = signedVoiceUrl((await response.json()).url, identifier);
    phase = 'connect';
    stopAt = Date.now() + 49000;
    sessionAttempted = true;
    socket = new WebSocket(signed);
    socket.addEventListener('open', () => { socketOpened = true; });
    socket.addEventListener('close', () => { closed = true; });
    socket.addEventListener('error', () => { closed = true; });
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string' || event.data.length > 524288) return;
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      if (frame?.type === 'server.system.ping' && Number.isInteger(frame.event_id) && socket.readyState === WebSocket.OPEN) {
        send('client.system.pong', { event_id: frame.event_id });
      }
      if (frame?.type === 'server.action.interaction_connected') connected = true;
      if (frame?.type === 'server.action.interaction_end') closed = true;
      if (frame?.type === 'server.event.tool_call') toolEvent = true;
      if (frame?.type === AUDIO && frame.audio_base64) {
        lastAudioAt = Date.now();
        greetingAudio = true;
        if (interruptAt && lastAudioAt - interruptAt > 250 && !observation.result().questionMatched) staleAudio = true;
      }
      if (frame?.type === AUDIO && frame.status === 'completed') greetingDone = true;
      if (frame?.type === INTERRUPT && observation.readyToInterrupt() === false && phase === 'interrupt' && !interruptAt) interruptAt = Date.now();
      observation.observe(frame ?? {});
      if (frame?.type === TEXT && frame.role === 'bot' && observation.result().answerMatched && typeof frame.content === 'string') {
        purposeMatched ||= /\bwebsite\b/i.test(frame.content) && /\b(project|discuss|interest)\w*\b/i.test(frame.content);
      }
    });
    await waitFor(() => socketOpened, 6000, 'socket_not_open');
    send('client.action.interaction_start', { agent_variables: version === 19 ? { user_name: 'Preview Tester', call_purpose: PURPOSE } : {} });
    await waitFor(() => connected, 6000, 'interaction_not_connected');
    phase = 'greeting';
    await waitFor(() => greetingAudio && (greetingDone || Date.now() - lastAudioAt > 1000), 10000, 'greeting_audio_unverified');
    phase = 'intro';
    await feed(clips.intro);
    await waitFor(observation.readyToInterrupt, 10000, 'agent_reply_audio_unverified');
    require(Date.now() - lastAudioAt < 500, 'overlap_unverified');
    phase = 'interrupt';
    observation.startInterruption();
    await feed(clips.interrupt);
    await waitFor(() => observation.result().answerMatched && (version === 21 || purposeMatched), 8500, 'reply_evidence_incomplete');
    return { ...observation.result(), status: 'observed', sessionAttempted, staleAudio, purposeMatched };
  } catch {
    return { ...observation.result(), status: 'incomplete', stage: phase, sessionAttempted, staleAudio, purposeMatched, toolEvent };
  } finally {
    if (socket?.readyState === WebSocket.OPEN) {
      send('client.action.interaction_end');
      await delay(100);
    }
    socket?.close();
  }
}

// The reviewed launcher supplies the one-use gate and the checksum-pinned fixtures.
if (typeof APPROVED_VOICE_FIXTURES !== 'undefined') {
  try {
    require(typeof WebSocket === 'function' && process.env.THAARA_SARVAM_PROFILE_FILE === PROFILE_PATH, 'runtime_denied');
    const baseline = readFileSync(PROFILE_PATH);
    require(sha(baseline) === PROFILE, 'profile_changed');
    const profile = JSON.parse(baseline);
    const clips = {};
    for (const [name, expected] of Object.entries(FIXTURES)) {
      const bytes = Buffer.from(APPROVED_VOICE_FIXTURES[name], 'base64');
      require(sha(bytes) === expected, 'fixture_changed');
      clips[name] = pcmFromWave(bytes);
    }
    const key = keyFromMount();
    const results = [];
    for (const version of [19, 21]) {
      const result = await preview(version, profile, key, clips);
      results.push(result);
      if ([401, 403, 429].includes(result.providerStatus) || result.toolEvent) break;
    }
    console.log(JSON.stringify({ status: 'finished', results, phoneCalls: 0 }));
  } catch {
    console.log(JSON.stringify({ status: 'stopped', category: 'preview_preflight_or_transport_failed', phoneCalls: 0 }));
  }
  // Prevent a closing socket from exceeding the billed session window.
  process.exitCode = 0;
  setTimeout(() => process.exit(0), 250).unref();
}
