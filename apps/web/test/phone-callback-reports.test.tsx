import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { loadPhoneCallbackReports, callbackNotificationLabel } from '../src/phone-callback-reports';
import { PhoneCallbackReports } from '../src/PhoneCallbackReports';
import { PhoneHistoryPage } from '../src/PhonePages';
import { PhoneInboundPage } from '../src/PhoneInboundPage';

const report = {
  requestId: 'a'.repeat(64), callId: 'call-1', direction: 'outbound' as const,
  name: '<script>alert(1)</script>', business: null, service: 'Website', phoneNumber: '+919000000001',
  callbackRequested: true as const, callbackConfirmed: true, notificationStatus: 'submitted' as const,
  notificationMeaning: 'Accepted by email provider; inbox delivery unconfirmed', missingFields: ['business'], occurredAt: '2026-11-11T00:00:00Z',
};
afterEach(() => vi.unstubAllGlobals());
const response = (value: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(value), { status }));

it('reads same-origin private reports without a mutation or caller-controlled routing', async () => {
  const fetcher = response({ status: 'ready', reports: [report] });
  const controller = new AbortController();
  vi.stubGlobal('fetch', fetcher);
  expect(await loadPhoneCallbackReports(controller.signal)).toEqual({ status: 'ready', reports: [report] });
  expect(fetcher).toHaveBeenCalledWith('/api/v1/connectors/phone/callbacks/reports', {
    method: 'GET', credentials: 'include', cache: 'no-store', signal: controller.signal,
  });
});

it.each([
  { status: 'not_configured', reports: [report] },
  { status: 'ready', reports: Array(101).fill(report) },
  { status: 'ready', reports: [report, report] },
  ...[{ notificationStatus: 'delivered' }, { callbackConfirmed: false }, { phoneNumber: 'javascript:alert(1)' },
    { occurredAt: 'yesterday' }, { name: 'x'.repeat(241) }, { missingFields: ['password'] }, { workspaceId: 'other' }]
    .map(patch => ({ status: 'ready', reports: [{ ...report, ...patch }] })),
])('rejects inconsistent, oversized or unexpected responses', async value => {
  vi.stubGlobal('fetch', response(value));
  await expect(loadPhoneCallbackReports()).rejects.toThrow('Callback reports could not be verified.');
});

it('preserves disabled and denied states without exposing server error details', async () => {
  vi.stubGlobal('fetch', response({ status: 'not_configured', reports: [] }));
  expect(await loadPhoneCallbackReports()).toEqual({ status: 'not_configured', reports: [] });
  vi.stubGlobal('fetch', response({ secret: 'private server detail' }, 403));
  await expect(loadPhoneCallbackReports()).rejects.toThrow('Only the workspace owner can view callback reports.');
});

it('renders callback fields as text and separates provider acceptance from inbox delivery', () => {
  const html = renderToStaticMarkup(<PhoneCallbackReports initialState={{ status: 'ready', reports: [report] }} />);
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  for (const text of ['Not provided', 'Website', 'delivery unconfirmed', 'Missing details: business']) expect(html).toContain(text);
  expect(html).not.toContain('href="tel:');
  expect(html).not.toContain('Send email');
});

it('shows only the selected call and never describes missing capture as a rejected callback', () => {
  const html = renderToStaticMarkup(<PhoneCallbackReports callId="other-call" initialState={{ status: 'ready', reports: [report] }} />);
  expect(html).not.toContain('Website');
  expect(html).toContain('No saved callback request is available');
  expect(callbackNotificationLabel('unverified')).toContain('human review');
  expect(callbackNotificationLabel('needs_review')).toContain('confirmation incomplete');
});

it('connects owner Phone history and inbound views without rendering private feeds for members', () => {
  const owner = { role: 'owner', userId: 'owner', workspaceId: 'tenant' };
  expect(renderToStaticMarkup(<PhoneHistoryPage ownerIdentity={owner} initialState={{ calls: [] }} />)).toContain('data-testid="phone-callback-reports"');
  expect(renderToStaticMarkup(<PhoneHistoryPage ownerIdentity={{ ...owner, role: 'member' }} initialState={{ calls: [] }} />)).not.toContain('data-testid="phone-callback-reports"');
  expect(renderToStaticMarkup(<PhoneInboundPage role="owner" ownerIdentity={owner} initialState={{ status: 'ready', reports: [] }} />)).toContain('data-testid="phone-callback-reports"');
  expect(renderToStaticMarkup(<PhoneInboundPage role="member" initialState={{ status: 'ready', reports: [] }} />)).not.toContain('data-testid="phone-callback-reports"');
});
