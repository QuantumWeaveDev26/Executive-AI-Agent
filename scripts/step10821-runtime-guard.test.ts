import { describe, expect, it } from 'vitest';
import { assertMediaFixture, MEDIA_CONTAINER, MEDIA_NETWORK } from './step10821-runtime-guard.mjs';
const expected = { ContainerId: 'a'.repeat(64), ImageId: 'sha256:pinned', NetworkId: 'b'.repeat(64) };
const facts = { Id: expected.ContainerId, Image: expected.ImageId, Name: '/' + MEDIA_CONTAINER, Labels: { 'thaara.step': '10821' }, State: { Running: true }, Restarts: 0, ReadOnly: true, Mounts: [], Binds: [], Tmpfs: { '/tmp': '', '/var/run/postgresql': '', '/var/lib/postgresql/data': '' }, Networks: { [MEDIA_NETWORK]: {} }, Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '15432' }] } };
const network = { Id: expected.NetworkId, Name: MEDIA_NETWORK, Internal: true, Labels: { 'thaara.step': '10821' }, Containers: { [expected.ContainerId]: {} } };
describe('10821 fixture admission without Docker or SQL', () => {
  it('admits the exact owned tmpfs-only isolated fixture', () => expect(() => assertMediaFixture(expected, facts, network)).not.toThrow());
  it.each([
    { Id: 'c'.repeat(64) }, { Name: '/thaara-v2-postgres' }, { Image: 'foreign' }, { ReadOnly: false },
    { Restarts: 1 }, { Mounts: [{ Type: 'volume' }] }, { Binds: ['host-data'] },
    { Networks: { [MEDIA_NETWORK]: {}, n8n_default: {} } },
    { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '15432' }] } },
  ])('rejects changed container boundaries: %j', change => expect(() => assertMediaFixture(expected, { ...facts, ...change }, network)).toThrow());
  it.each([{ Internal: false }, { Id: 'foreign' }, { Containers: { foreign: {} } }])('rejects changed network boundaries: %j', change => expect(() => assertMediaFixture(expected, facts, { ...network, ...change })).toThrow());
});
