import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import dns from 'node:dns/promises';
import https from 'node:https';
import { ForbiddenError } from '@thaara/observability';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppDispatchHttpTransport } from '../src/services/whatsapp-dispatch-http.js';

const scope = { workspaceId: '11111111-1111-4111-8111-111111111111', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', role: 'member' as const, sessionTokenHash: 'synthetic-authenticated-session' };
const dispatchId = '99999999-9999-4999-8999-999999999999';
const token = 'synthetic_directional_dispatch_secret_1084';
const profile = { workspaceId: scope.workspaceId, ownerUserId: scope.userId, connectionId: 'wa_transport_test', revision: 1, webhookOrigin: 'https://n8n.example.com', credentialRef: 'whatsapp/dispatch/test' };
function fixture(overrides: Record<string, unknown> = {}) {
  const authorize = vi.fn(async () => {}), resolveToken = vi.fn(async () => token);
  const transport = new WhatsAppDispatchHttpTransport({ profile, assertDispatchAuthorized: authorize, credentials: { mode: 'managed', resolveToken }, ...overrides } as any);
  return { transport, authorize, resolveToken };
}
function network(options: { status?: number; body?: string; chunks?: string[]; headers?: Record<string, string>; error?: Error; hang?: boolean; bodyHang?: boolean } = {}) {
  const lookup = vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }] as any);
  let sent = '', requestOptions: any, requestedUrl: any;
  const request = vi.spyOn(https, 'request').mockImplementation(((url: any, opts: any, callback: any) => {
    requestedUrl = url; requestOptions = opts;
    const req = new EventEmitter() as any;
    req.destroy = vi.fn((error?: Error) => { if (error) queueMicrotask(() => req.emit('error', error)); });
    req.end = (body: string) => {
      sent = body;
      queueMicrotask(() => {
        if (options.hang) return;
        if (options.error) { req.emit('error', options.error); return; }
        const res = new PassThrough() as any;
        res.statusCode = options.status ?? 200;
        res.headers = options.headers ?? { 'content-type': 'application/json' };
        callback(res);
        for (const chunk of options.chunks ?? [options.body ?? JSON.stringify({ dispatchId, status: 'unverified', verified: false })]) res.write(chunk);
        if (options.bodyHang) return;
        res.end();
      });
    };
    return req;
  }) as any);
  return { lookup, request, get sent() { return sent; }, get options() { return requestOptions; }, get url() { return requestedUrl; } };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('governed WhatsApp opaque-dispatch HTTPS transport', () => {
  it('sends only the opaque dispatch reference, pins public DNS and keeps TLS/auth strict', async () => {
    const wire = network(), f = fixture();
    expect(await f.transport.submit(scope, dispatchId, 1)).toEqual({ dispatchId, status: 'unverified', verified: false });
    expect(JSON.parse(wire.sent)).toEqual({ dispatchId, connectionRevision: 1 });
    expect(wire.url.href).toBe('https://n8n.example.com/webhook/thaara-v2-dev-whatsapp-approved-1082');
    expect(wire.options).toMatchObject({ method: 'POST', rejectUnauthorized: true, servername: 'n8n.example.com', agent: false, family: 4, headers: { Authorization: 'Bearer ' + token } });
    const result = vi.fn(); wire.options.lookup('n8n.example.com', {}, result);
    expect(result).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(f.authorize).toHaveBeenCalledTimes(3);
    expect(f.resolveToken).toHaveBeenCalledWith(expect.objectContaining({ scope, connectionId: profile.connectionId, revision: 1, credentialRef: profile.credentialRef }));
    expect(wire.request).toHaveBeenCalledTimes(1);
  });
  it.each(['http://n8n.example.com', 'https://user:pass@n8n.example.com', 'https://n8n.example.com:444', 'https://n8n.example.com/path', 'https://n8n.example.com?q=1', 'https://127.0.0.1', 'https://n8n.local', 'https://n8n.example.com/#fragment'])('rejects an unsafe server profile %s', origin => {
    expect(() => fixture({ profile: { ...profile, webhookOrigin: origin } })).toThrow();
  });
  it('snapshots the trusted profile against later caller mutation', async () => {
    const wire = network(), mutable = { ...profile }, f = fixture({ profile: mutable });
    mutable.webhookOrigin = 'https://attacker.example.com'; mutable.revision = 2;
    await f.transport.submit(scope, dispatchId, 1);
    expect(wire.url.hostname).toBe('n8n.example.com');
  });
  it('rejects wrong tenant, owner, viewer, session, revision and malformed dispatch before credentials/network', async () => {
    const wire = network(), f = fixture();
    for (const caller of [{ ...scope, workspaceId: 'other' }, { ...scope, userId: 'other' }, { ...scope, role: 'viewer' }, { ...scope, sessionTokenHash: '' }]) await expect(f.transport.submit(caller as any, dispatchId, 1)).rejects.toMatchObject({ statusCode: 403 });
    await expect(f.transport.submit(scope, dispatchId, 2)).rejects.toThrow();
    await expect(f.transport.submit(scope, 'bad\r\nid', 1)).rejects.toThrow();
    expect(f.resolveToken).not.toHaveBeenCalled(); expect(wire.lookup).not.toHaveBeenCalled(); expect(wire.request).not.toHaveBeenCalled();
  });
  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.64.0.1', '192.168.1.1', '192.0.2.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::'])('rejects nonpublic DNS answer %s', async address => {
    const wire = network(), f = fixture(); wire.lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }] as any);
    await expect(f.transport.submit(scope, dispatchId, 1)).rejects.toMatchObject({ code: 'WHATSAPP_DISPATCH_UNAVAILABLE' });
    expect(f.resolveToken).not.toHaveBeenCalled(); expect(wire.request).not.toHaveBeenCalled();
  });
  it('rejects mixed public/private answers rather than silently choosing the public address', async () => {
    const wire = network(), f = fixture(); wire.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] as any);
    await expect(f.transport.submit(scope, dispatchId, 1)).rejects.toThrow(); expect(wire.request).not.toHaveBeenCalled();
  });
  it('pins a valid IPv6 answer without a second DNS lookup', async () => {
    const wire = network(), f = fixture(); wire.lookup.mockResolvedValue([{ address: '2001:4860:4860::8888', family: 6 }] as any);
    await f.transport.submit(scope, dispatchId, 1); expect(wire.options.family).toBe(6); expect(wire.lookup).toHaveBeenCalledTimes(1);
  });
  it('denies initial authorization failure before reading a credential', async () => {
    const wire = network(), f = fixture(); f.authorize.mockRejectedValue(new Error('private authorization details'));
    await expect(f.transport.submit(scope, dispatchId, 1)).rejects.toMatchObject({ statusCode: 403 });
    expect(f.resolveToken).not.toHaveBeenCalled(); expect(wire.request).not.toHaveBeenCalled();
  });
  it('rechecks revocation after slow credential resolution and does not transmit', async () => {
    const wire = network(), f = fixture(); f.authorize.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('revoked'));
    await expect(f.transport.submit(scope, dispatchId, 1)).rejects.toMatchObject({ statusCode: 403 }); expect(wire.request).not.toHaveBeenCalled();
  });
  it('rechecks revocation during DNS before reading any directional secret', async () => {
    const wire = network(), f = fixture(); let release!: (value: any) => void;
    wire.lookup.mockImplementation(() => new Promise(resolve => { release = resolve; }) as any);
    const pending = expect(f.transport.submit(scope, dispatchId, 1)).rejects.toMatchObject({ statusCode: 403 });
    await vi.waitFor(() => expect(wire.lookup).toHaveBeenCalledTimes(1));
    f.authorize.mockRejectedValue(new Error('revoked while DNS pending'));
    release([{ address: '8.8.8.8', family: 4 }]); await pending;
    expect(f.resolveToken).not.toHaveBeenCalled(); expect(wire.request).not.toHaveBeenCalled();
  });
  it.each(['', 'short', 'bad\r\nsecret', 'x'.repeat(257)])('rejects malformed directional credentials', async secret => {
    const wire = network(), f = fixture(); f.resolveToken.mockResolvedValue(secret);
    await expect(f.transport.submit(scope, dispatchId, 1)).rejects.toMatchObject({ code: 'WHATSAPP_DISPATCH_UNAVAILABLE' }); expect(wire.request).not.toHaveBeenCalled();
  });
  it.each([
    { status: 302 }, { status: 500 }, { body: 'not json' }, { body: JSON.stringify({ dispatchId: 'other', status: 'unverified' }) },
    { body: JSON.stringify({ dispatchId, status: 'sent' }) }, { body: JSON.stringify({ dispatchId, status: 'unverified', verified: true }) },
    { headers: { 'content-type': 'text/html' } }, { chunks: ['x'.repeat(9000), 'x'.repeat(9000)] },
    { headers: { 'content-type': 'application/json', 'content-length': '999999' } }, { error: new Error('TLS secret details') }
  ])('marks invalid/uncertain HTTP responses unverified without retry or secret leakage: %j', async response => {
    const wire = network(response), f = fixture();
    await expect(f.transport.submit(scope, dispatchId, 1)).rejects.toMatchObject({ code: 'WHATSAPP_DISPATCH_UNVERIFIED', statusCode: 502 });
    expect(wire.request).toHaveBeenCalledTimes(1);
  });
  it('accepts only a matching conservative not-configured acknowledgement', async () => {
    network({ body: JSON.stringify({ dispatchId, status: 'not_configured', verified: false }) });
    expect(await fixture().transport.submit(scope, dispatchId, 1)).toEqual({ dispatchId, status: 'not_configured', verified: false });
  });
  it('rejects acknowledgements missing the explicit unverified assertion', async () => {
    network({ body: JSON.stringify({ dispatchId, status: 'unverified' }) });
    await expect(fixture().transport.submit(scope, dispatchId, 1)).rejects.toMatchObject({ code: 'WHATSAPP_DISPATCH_UNVERIFIED' });
  });
  it('redacts a managed resolver failure without transmitting', async () => {
    const wire = network(), f = fixture(); f.resolveToken.mockRejectedValue(new Error('private-secret-' + token));
    try { await f.transport.submit(scope, dispatchId, 1); throw Error('expected rejection'); }
    catch (error: any) { expect(error.code).toBe('WHATSAPP_DISPATCH_UNAVAILABLE'); expect(error.message).not.toContain(token); expect(error.cause).toBeUndefined(); }
    expect(wire.request).not.toHaveBeenCalled();
  });
  it('does not expose a credential-provider ForbiddenError as an authorization response', async () => {
    const wire = network(), f = fixture(); f.resolveToken.mockRejectedValue(new ForbiddenError('private-secret-' + token));
    try { await f.transport.submit(scope, dispatchId, 1); throw Error('expected rejection'); }
    catch (error: any) { expect(error.code).toBe('WHATSAPP_DISPATCH_UNAVAILABLE'); expect(error.message).not.toContain(token); }
    expect(wire.request).not.toHaveBeenCalled();
  });
  it.each(['dns', 'credential'])('bounds deferred %s and blocks transmission after late completion', async stage => {
    vi.useFakeTimers(); const wire = network(), f = fixture(); let release!: (value: any) => void;
    if (stage === 'dns') wire.lookup.mockImplementation(() => new Promise(resolve => { release = resolve; }) as any);
    else f.resolveToken.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = expect(f.transport.submit(scope, dispatchId, 1)).rejects.toMatchObject({ code: 'WHATSAPP_DISPATCH_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(3100); await pending;
    release(stage === 'dns' ? [{ address: '8.8.8.8', family: 4 }] : token); await vi.advanceTimersByTimeAsync(1);
    expect(wire.request).not.toHaveBeenCalled(); if (stage === 'dns') expect(f.resolveToken).not.toHaveBeenCalled();
  });
  it('bounds a stalled partial response body and aborts the single socket', async () => {
    vi.useFakeTimers(); const wire = network({ chunks: ['{"dispatchId":'], bodyHang: true });
    const pending = expect(fixture().transport.submit(scope, dispatchId, 1)).rejects.toMatchObject({ code: 'WHATSAPP_DISPATCH_UNVERIFIED' });
    await vi.advanceTimersByTimeAsync(3100); await pending;
    expect(wire.options.signal.aborted).toBe(true); expect(wire.request).toHaveBeenCalledTimes(1);
  });
  it('bounds a stalled response with an uncertain outcome', async () => {
    vi.useFakeTimers(); const wire = network({ hang: true }), f = fixture();
    const pending = expect(f.transport.submit(scope, dispatchId, 1)).rejects.toMatchObject({ code: 'WHATSAPP_DISPATCH_UNVERIFIED' });
    await vi.advanceTimersByTimeAsync(3100); await pending; expect(wire.request).toHaveBeenCalledTimes(1);
  });
  it('bounds stalled authorization and prevents a late completion from transmitting', async () => {
    vi.useFakeTimers(); const wire = network(); let release!: () => void;
    const f = fixture({ assertDispatchAuthorized: () => new Promise<void>(resolve => { release = resolve; }) });
    const pending = expect(f.transport.submit(scope, dispatchId, 1)).rejects.toMatchObject({ code: 'WHATSAPP_DISPATCH_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(3100); await pending; release(); await vi.advanceTimersByTimeAsync(1);
    expect(f.resolveToken).not.toHaveBeenCalled(); expect(wire.request).not.toHaveBeenCalled();
  });
});
