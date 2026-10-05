import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../dist/lens/context.js';

const budget = { tokens: 200000, source: 'test settings', accuracy: 'configured', scope: 'total' };
const category = { tokens: 20000, source: 'diagnostic', accuracy: 'reported' };
test('budget changes recalculate every percentage without counting the outside reserve twice', () => {
  const args = { used: 80000, capacity: 256000, budget, categories: { mcpTools: category } };
  const x = buildContext(args);
  assert.equal(x.percent, 40);
  assert.equal(x.segments.find(s => s.id === 'mcpTools').percent, 10);
  assert.equal(x.segments.find(s => s.id === 'free').tokens, 120000);
  assert.equal(x.segments.find(s => s.id === 'buffer').tokens, 0);
  const model = buildContext({ ...args, view: 'model' });
  assert.equal(model.segments.find(s => s.id === 'buffer').tokens, 56000);
  assert.equal(model.segments.reduce((n, s) => n + (s.tokens ?? 0), 0), 256000);
  assert.equal(buildContext({ ...args, budget: { ...budget, tokens: 100000 } }).percent, 80);
});
test('unknown buffer, compaction, prefix scope, overrun and category conflicts stay visible', () => {
  const x = buildContext({ used: 80000, capacity: null, budget });
  assert.equal(x.segments.find(s => s.id === 'free').tokens, null);
  assert.equal(buildContext({ used: null, capacity: 256000, budget }).percent, null);
  assert.equal(buildContext({ used: 250000, capacity: 256000, budget }).percent, 125);
  assert.equal(buildContext({ used: 80000, capacity: 256000, budget: { ...budget, scope: 'body_after_prefix' } }).percent, null);
  const y = buildContext({ used: 10000, capacity: 256000, budget, categories: { mcpTools: category } });
  assert.match(y.warnings.join(), /conflict/);
  assert.equal(y.segments[0].tokens, 20000);
  assert.equal(buildContext({ used: 128000, capacity: 256000, budget: { ...budget, disabled: true } }).percent, 50);
});
