import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionCollector } from '../dist/lens/snapshot.js';
import { parseEvents } from '../dist/lens/reader.js';
import { normalizeUsage, estimateCost } from '../dist/lens/usage.js';
import { BUNDLED_PRICES } from '../dist/lens/pricing-data.js';

const temporary = mkdtempSync(path.join(tmpdir(), 'lens-independent-third-party-'));
const previous = { lens: process.env.CONTEXT_LENS_HOME, claude: process.env.CLAUDE_CONFIG_DIR };
process.env.CONTEXT_LENS_HOME = path.join(temporary, 'state');
process.env.CLAUDE_CONFIG_DIR = path.join(temporary, 'claude-config');
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
after(() => {
  for (const [key, value] of [['CONTEXT_LENS_HOME', previous.lens], ['CLAUDE_CONFIG_DIR', previous.claude]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(temporary, { recursive: true, force: true });
});

const model = 'gemini-4-argon';
const at = '2026-10-18T12:40:27.690Z';
const usage = { input_tokens: 2711, cache_read_input_tokens: 167750, cache_creation_input_tokens: 0,
  output_tokens: 182, service_tier: 'standard' };
const config = { currency: 'USD', prices: {} };
const info = { client: 'claude', id: 'synthetic-session', model: '', cwd: '/synthetic-project', updatedAt: at };
const response = (id = 'synthetic-response', extra = {}) => ({ type: 'assistant', timestamp: at,
  cwd: '/synthetic-project', message: { id, model, usage: { ...usage } }, ...extra });
const request = (extra = {}) => ({ ...normalizeUsage('claude', usage, 'synthetic-request', model, at), ...extra });
const price = (row = request(), prices = {}) => estimateCost([row], { ...config, prices }, true, BUNDLED_PRICES);
const near = (actual, expected) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-12,
  `expected ${expected}, received ${actual}`);
let fixture = 0;

async function snapshot(events, options = {}) {
  const id = `synthetic-session-${++fixture}`;
  const root = path.join(temporary, id, 'claude');
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, `${id}.jsonl`), events.map(event => JSON.stringify({
    cwd: '/synthetic-project', ...event, sessionId: id,
  })).join('\n') + '\n');
  const collector = new SessionCollector({ claude: root, codex: path.join(temporary, id, 'codex') });
  const file = collector.list().find(value => value.id === id);
  assert.ok(file, 'the synthetic session must be discoverable');
  const live = typeof options.live === 'function' ? options.live(id) : options.live;
  return collector.snapshot(file, { ...options, ...(live ? { live } : {}) });
}

const live = (id, extra = {}) => ({ at: '2026-10-18T12:41:00Z', environment: {},
  stdin: { session_id: id, model: { id: 'claude-sonnet-alias' },
    context_window: { context_window_size: 262144, current_usage: { ...usage } } }, ...extra });

test('Claude 兼容 Gemini 在无实时窗口时保留用量、模型和费用，但不借用公开上限', async () => {
  const value = await snapshot([response()]);
  assert.equal(value.session.model, model);
  assert.equal(value.context.usedTokens, 170461);
  assert.equal(value.context.modelTokens, null);
  assert.equal(value.context.percent, null);
  assert.equal(value.context.windowPercent, null);
  assert.equal(value.totals.main.requests, 1);
  near(value.cost.amount, .024017);
  assert.equal(value.nativeCostUsd, null);
});

test('a Claude request alias and its client cost-state cannot replace the actual Gemini response or token cost', async () => {
  const value = await snapshot([
    { type: 'attachment', timestamp: '2026-10-18T12:39:00Z',
      attachment: { type: 'model', identity: { modelId: 'claude-sonnet-alias[1m]' } } },
    response(),
    { type: 'cost-state', totalCostUSD: 2.5227525,
      modelUsage: { 'claude-sonnet-alias[1m]': { costUSD: 2.5227525 } } },
  ]);
  assert.equal(value.session.model, model);
  assert.equal(value.context.usedTokens, 170461);
  assert.equal(value.context.modelTokens, null);
  assert.equal(value.nativeCostUsd, null);
  near(value.cost.amount, .024017);
});

test('GPT 响应在缺少实时容量时保留真实模型、用量和费用，不借用 Claude 别名的窗口', async () => {
  for (const raw of ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6-sol']) {
    const value = await snapshot([
      { type: 'attachment', timestamp: '2026-10-18T12:39:00Z',
        attachment: { type: 'model', identity: { modelId: 'claude-fable-5[1m]' } } },
      response('mapped-response', { message: { id: 'mapped-response', model: raw, usage } }),
    ]);
    assert.equal(value.session.model, raw);
    assert.equal(value.context.usedTokens, 170461);
    assert.equal(value.context.modelTokens, null);
    assert.equal(value.context.denominator, null);
    assert.equal(value.context.percent, null);
    assert.ok(value.cost.amount > 0);
    assert.equal(value.cost.complete, true);
    assert.deepEqual(value.cost.unpricedModels, []);
    assert.equal(value.nativeCostUsd, null);
  }
});

test('an unverified Gemini alias keeps known tokens while window, percent and official cost remain unknown', async () => {
  for (const unknown of ['gemini4', 'gemini-4-argon-extra', 'proxy/gemini-4-argon']) {
    const value = await snapshot([response('unknown-response', { message: { id: 'unknown-response', model: unknown, usage } })]);
    assert.equal(value.session.model, unknown);
    assert.equal(value.context.usedTokens, 170461);
    assert.equal(value.context.modelTokens, null);
    assert.equal(value.context.percent, null);
    assert.equal(value.cost.amount, null);
  }
});

test('Google 资源前缀保留实际模型和单价，但不推断会话窗口', async () => {
  for (const raw of ['models/gemini-4-argon', 'Google/gemini-4-argon', 'google/models/GEMINI-4-ARGON']) {
    const value = await snapshot([response('wrapped-response', { message: { id: 'wrapped-response', model: raw, usage } })]);
    assert.equal(value.session.model, raw);
    assert.equal(value.context.usedTokens, 170461);
    assert.equal(value.context.modelTokens, null);
    near(value.cost.amount, .024017);
  }
});

test('a fresh same-session live mapping alias keeps its valid client window ahead of the published limit', async () => {
  const value = await snapshot([response()], { live: id => live(id) });
  assert.equal(value.session.model, model);
  assert.equal(value.context.usedTokens, 170461);
  assert.equal(value.context.modelTokens, 262144);
});

test('过期且模型不匹配的实时记录不能提供当前窗口或用量', async () => {
  const value = await snapshot([response()], { live: id => live(id, { at: '2026-10-18T12:00:00Z' }) });
  assert.equal(value.session.model, model);
  assert.equal(value.context.usedTokens, 170461);
  assert.equal(value.context.modelTokens, null);
});

test('a live record from another session cannot supply this session with counters or capacity', async () => {
  const value = await snapshot([response()], { live: () => live('another-synthetic-session') });
  assert.equal(value.context.usedTokens, 170461);
  assert.equal(value.context.modelTokens, null);
});

test('非法窗口值不能触发公开模型上限回退', async () => {
  for (const invalid of [0, -1, 1024.5]) {
    const value = await snapshot([response()], { live: id => {
      const candidate = live(id); candidate.stdin.context_window.context_window_size = invalid; return candidate;
    } });
    assert.equal(value.context.modelTokens, null);
    assert.equal(value.context.usedTokens, 170461);
  }
});

test('fresh explicit null and zero live counters preserve the existing unknown context boundary', async () => {
  for (const counters of [null, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }]) {
    const value = await snapshot([response()], { live: id => {
      const candidate = live(id); candidate.stdin.context_window.current_usage = counters; return candidate;
    } });
    assert.equal(value.context.usedTokens, null);
    assert.equal(value.context.percent, null);
    assert.equal(value.context.modelTokens, 262144);
  }
});

test('显式压缩预算与 HUD 预算不会推断当前窗口容量', async () => {
  const configured = await snapshot([response()], { launch: { autoCompact: 180000 } });
  assert.equal(configured.context.modelTokens, null);
  assert.equal(configured.context.budget.tokens, 180000);
  assert.equal(configured.context.budget.accuracy, 'configured');
  const hud = await snapshot([response()], { live: id => ({ ...live(id), hudWindow: 190000 }) });
  assert.equal(hud.context.modelTokens, 262144);
  assert.equal(hud.context.budget.tokens, 190000);
  assert.equal(hud.context.budget.accuracy, 'configured');
});

test('Gemini Standard uses the request date for both published price periods', () => {
  const earlier = price(request({ at: '2026-10-18T00:00:00Z' }));
  const later = price(request({ at: '2026-12-02T00:00:00Z' }));
  near(earlier.amount, .024017); near(later.amount, .048034);
  assert.equal(earlier.complete, true); assert.equal(later.complete, true);
});

test('the internal UTC date boundary changes rates exactly at December 1 without changing token counts', () => {
  near(price(request({ at: '2026-11-30T23:59:59.999Z' })).amount, .024017);
  near(price(request({ at: '2026-12-01T00:00:00.000Z' })).amount, .048034);
});

test('missing, invalid or explicitly uncertain request timestamps cannot select Gemini date-dependent rates', () => {
  for (const extra of [{ at: '' }, { at: 'invalid' }, { at: undefined }, { timestampKnown: false }]) {
    const value = price(request(extra));
    assert.equal(value.amount, null); assert.equal(value.complete, false);
    assert.deepEqual(value.unpricedModels, [model]);
  }
});

test('an unverified service tier cannot silently use Gemini Standard rates', () => {
  for (const serviceTier of ['priority', 'fast', 'unrecognized']) {
    const value = price(request({ serviceTier }));
    assert.equal(value.amount, null); assert.equal(value.complete, false);
  }
});

test('empty exact and wildcard custom price objects cannot hide verified Gemini rates', () => {
  for (const prices of [{ [model]: {} }, { '*': {} }, { [model]: {}, '*': {} }]) {
    const value = price(request(), prices);
    near(value.amount, .024017); assert.equal(value.complete, true);
  }
});

test('nonempty exact custom rates outrank wildcard rates and wildcard rates outrank official prices', () => {
  const exact = { input: 1, output: 1, cacheRead: 1 };
  const wildcard = { input: 2, output: 2, cacheRead: 2 };
  near(price(request(), { [model]: exact, '*': wildcard }).amount, .170643);
  near(price(request(), { [model]: {}, '*': wildcard }).amount, .341286);
});

test('custom prices continue matching the original wrapped response identifier exactly', () => {
  const raw = 'Google/gemini-4-argon';
  const exact = { input: 1, output: 1, cacheRead: 1 };
  near(price(request({ model: raw }), { [raw]: exact }).amount, .170643);
  near(price(request({ model: raw }), { [model]: exact }).amount, .024017);
});

test('explicit zero rates remain a valid complete free custom price', () => {
  const value = price(request(), { [model]: { input: 0, output: 0, cacheRead: 0 } });
  assert.equal(value.amount, 0); assert.equal(value.complete, true);
  assert.deepEqual(value.unpricedModels, []);
});

test('a nonempty incomplete exact custom price stays partial instead of mixing wildcard or official components', () => {
  const value = price(request(), { [model]: { input: 1 }, '*': { input: 2, output: 2, cacheRead: 2 } });
  near(value.amount, .002711); assert.equal(value.complete, false);
  assert.deepEqual(value.unpricedModels, [model]);
});

test('unreported Gemini cache-write rates remain partial when positive cache creation is observed', () => {
  const row = normalizeUsage('claude', { ...usage, cache_creation_input_tokens: 1000 }, 'cache-write-response', model, at);
  const value = price(row);
  near(value.amount, .024017); assert.equal(value.complete, false);
  assert.deepEqual(value.unpricedModels, [model]);
});

test('thinking already included in Gemini output is not billed a second time', () => {
  const row = normalizeUsage('claude', { ...usage, output_tokens_details: { thinking_tokens: 100 } },
    'thinking-response', model, at);
  assert.equal(row.output, 182); assert.equal(row.reasoning, 100);
  near(price(row).amount, .024017);
});

test('streamed and replayed Gemini response IDs count and charge only once', async () => {
  const first = response('streamed-response', { message: { id: 'streamed-response', model, usage: { ...usage, output_tokens: 80 } } });
  const last = response('streamed-response');
  const value = await snapshot([first, last, last]);
  assert.equal(value.totals.main.requests, 1);
  assert.equal(value.totals.main.input, 170461);
  assert.equal(value.totals.main.output, 182);
  near(value.cost.amount, .024017);
});

test('synthetic and API-error rows cannot erase valid Gemini counters or create extra charges', async () => {
  const fake = response('synthetic-error', { isApiErrorMessage: true,
    message: { id: 'synthetic-error', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } });
  const error = response('real-model-error', { isApiErrorMessage: true });
  const value = await snapshot([response(), fake, error]);
  assert.equal(value.session.model, model);
  assert.equal(value.context.usedTokens, 170461);
  assert.equal(value.totals.main.requests, 1);
  near(value.cost.amount, .024017);
});

test('compaction and explicit model switches keep the prior context unknown until a new measurement', async () => {
  const compact = { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-18T12:41:00Z' };
  const compacted = await parseEvents(info, [response(), compact, response()]);
  assert.equal(compacted.used, null);
  assert.equal(compacted.requests.length, 1);
  const switched = await parseEvents(info, [response(), { type: 'attachment', timestamp: '2026-10-18T12:41:00Z',
    attachment: { type: 'model', identity: { modelId: 'unverified-model' } } }]);
  assert.equal(switched.used, null); assert.equal(switched.capacity, null);
  assert.equal(switched.info.model, 'unverified-model');
});
