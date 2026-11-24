import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareCoreSolutions, pricing, solutions } from './prepare-phone-core-solutions.mjs';
const base = fs.readFileSync('docs/integrations/phone/knowledge/linktree-v3/quantum-weave-public.md');
test('retains public knowledge and adds owner-confirmed core offerings and exact pricing', () => {
  const result = prepareCoreSolutions(base);
  for (const service of solutions) assert.ok(result.knowledge.includes(service) && result.policy.includes(service));
  for (const text of ['FilmSuccess', 'Appu', 'Core custom solutions', pricing]) assert.ok(result.knowledge.includes(text));
  assert.ok(result.policy.includes(pricing));
  for (const rule of ['not an end-of-call condition', 'verified incoming caller number', 'connect@brandmintai.io', 'Yield immediately', 'Never claim to be human', 'two to four', 'explicit consent']) assert.ok(result.policy.includes(rule));
});
test('refuses an edited historical knowledge baseline', () => {
  assert.throws(() => prepareCoreSolutions(Buffer.concat([base, Buffer.from('changed')])), /baseline changed/);
});
