// Pure guard: never opens Docker or a database.
export const MEDIA_CONTAINER = 'thaara-step10821-postgres';
export const MEDIA_NETWORK = 'thaara-step10821-isolated';
export const MEDIA_DATABASE = 'thaara_step74_test';
export function assertMediaFixture(expected, facts, network) {
  const fail = () => { throw Error('Step10821 fixture identity/isolation mismatch'); };
  if (!/^[a-f0-9]{64}$/.test(expected.ContainerId || '') || facts.Id !== expected.ContainerId || facts.Image !== expected.ImageId
    || facts.Name !== '/' + MEDIA_CONTAINER || facts.Labels?.['thaara.step'] !== '10821' || !facts.State?.Running
    || facts.Restarts !== 0 || facts.ReadOnly !== true || !Array.isArray(facts.Mounts) || facts.Mounts.some(m => m.Type !== 'tmpfs')
    || facts.Binds?.length || Object.keys(facts.Tmpfs || {}).sort().join(',') !== '/tmp,/var/lib/postgresql/data,/var/run/postgresql'
    || Object.keys(facts.Networks || {}).join(',') !== MEDIA_NETWORK || network.Id !== expected.NetworkId
    || network.Name !== MEDIA_NETWORK || network.Internal !== true || network.Labels?.['thaara.step'] !== '10821'
    || Object.keys(network.Containers || {}).join(',') !== expected.ContainerId
    || Object.keys(facts.Ports || {}).join(',') !== '5432/tcp' || facts.Ports['5432/tcp'].length !== 1
    || facts.Ports['5432/tcp'][0].HostIp !== '127.0.0.1' || facts.Ports['5432/tcp'][0].HostPort !== '15432') fail();
}
