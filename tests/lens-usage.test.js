import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, mergeRequests, sumRequests, addTotals, estimateCost, cacheState } from '../dist/lens/usage.js';

const row = (id, raw, client = 'claude', model = 'm') => normalizeUsage(client, raw, id, model, '2026-10-05T00:00:00Z');
test('streaming duplicates use response maxima; main and agents have a weighted hit rate', () => {
  const a = row('a', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90 });
  const b = row('a', { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 90 });
  const child = row('b', { input_tokens: 900, output_tokens: 50, cache_read_input_tokens: 0 });
  const main = sumRequests([a, b, a]);
  assert.equal(main.input, 100);
  assert.equal(main.output, 20);
  assert.equal(main.cacheReadRequests, 1);
  const all = addTotals(main, sumRequests([child]));
  assert.equal(all.hitRate, 0.09);
  assert.equal(all.requests, 2);
  assert.equal(mergeRequests([a, b])[0].output, 20);
});
test('custom pricing separates cached input, TTL writes and output reasoning; missing rates stay partial', () => {
  const a = row('a', { input_tokens: 1000000, output_tokens: 100000, cached_input_tokens: 600000, reasoning_output_tokens: 80000 }, 'codex');
  const cfg = { currency: 'CNY', prices: { m: { input: 10, output: 30, cacheRead: 1 } } };
  assert.equal(estimateCost([a], cfg).amount, 7.6);
  assert.equal(estimateCost([a], { ...cfg, prices: { m: { input: 20, output: 30, cacheRead: 1 } } }).amount, 11.6);
  assert.equal(estimateCost([a], { ...cfg, prices: {} }).amount, null);
  const b = row('b', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 1000000,
    cache_creation: { ephemeral_5m_input_tokens: 400000, ephemeral_1h_input_tokens: 600000 } }, 'claude', 'n');
  assert.equal(estimateCost([b], { ...cfg, prices: { n: { cacheWrite5m: 2, cacheWrite1h: 5 } } }).amount, 3.8);
  assert.equal(estimateCost([a, b], cfg).complete, false);
  assert.deepEqual(estimateCost([a, b], cfg).unpricedModels, ['n']);
});
test('cache expiry is computed from reported TTL, past hits do not imply a warm cache', () => {
  assert.equal(cacheState(undefined, 1000).state, 'unknown');
  assert.equal(cacheState({ warm: true, expires_at: 2 }, 1000).state, 'warm');
  assert.equal(cacheState({ warm: true, expires_at: 2 }, 3000).state, 'expired');
  assert.equal(cacheState({ warm: false }, 3000).state, 'unknown');
});
