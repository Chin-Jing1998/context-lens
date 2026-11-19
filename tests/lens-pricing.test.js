import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseOfficialPrices, readOfficialPrices, refreshOfficialPrices, officialPrice, PRICE_SOURCES } from '../dist/lens/pricing.js';
import { BUNDLED_PRICES } from '../dist/lens/pricing-data.js';
import { normalizeUsage, estimateCost, mergeRequests } from '../dist/lens/usage.js';

const testHome = mkdtempSync(path.join(tmpdir(), 'lens-price-tests-'));
const previousHome = process.env.CONTEXT_LENS_HOME;
process.env.CONTEXT_LENS_HOME = testHome;
after(() => {
  if (previousHome === undefined) delete process.env.CONTEXT_LENS_HOME; else process.env.CONTEXT_LENS_HOME = previousHome;
  rmSync(testHome, { recursive: true, force: true });
});

const at = '2026-10-06T00:00:00Z';
const google = readFileSync(new URL('./fixtures/gemini-pricing.md', import.meta.url), 'utf8');
const openai = ['Standard', 'Batch', 'Flex', 'Fast', 'Ultrafast'].map((tier, index) => `### ${tier} pricing data
| Model | Short context input | Short context output | Short context cached input | Short context 30m write | Short context 12h write | Long context input | Long context output | Long context cached input | Long context 30m write | Long context 12h write |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${['gpt-test-a', 'gpt-test-b', 'gpt-test-c'].map(model => `| ${model} | $${index + 1} | $10 | $0.1 | $1.25 | $2.50 | $2 | $15 | $0.2 | $2.5 | $5.00 |`).join('\n')}`).join('\n') + '\nShort context: ≤272K input tokens. Long context: >272K input tokens.\n';
const anthropic = `## Model pricing
| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok<sup>2</sup> | $20 / MTok |
| Claude Opus 5 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |
| Claude Opus 4.8 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |
## Feature-specific pricing
### Fast mode pricing
| Model | Input | Output |
| --- | --- | --- |
| Claude Opus 5.5 | $8 / MTok | $40 / MTok |
| Claude Opus 5 / Claude Opus 4.8 | $10 / MTok | $50 / MTok |
### Batch processing
| Model | Batch input | Batch output |
| --- | --- | --- |
| Claude Opus 5.5 | $2 / MTok | $10 / MTok |
### Tool use pricing
| Claude Opus 5.5 | 286 tokens | 400 tokens |
`;
const deepseek = `<table><tr><td colspan="3">MODEL</td><td>deepseek-flash</td><td>deepseek-v4-pro</td></tr>
<tr><td rowspan="6">PRICING</td><td rowspan="2">1M INPUT TOKENS (CACHE HIT)</td><td>OFF-PEAK</td><td>$0.003</td><td>$0.022</td></tr>
<tr><td>PEAK</td><td>$0.006</td><td>$0.044</td></tr>
<tr><td rowspan="2">1M INPUT TOKENS (CACHE MISS)</td><td>OFF-PEAK</td><td>$0.15</td><td>$0.66</td></tr>
<tr><td>PEAK</td><td>$0.3</td><td>$1.32</td></tr>
<tr><td rowspan="2">1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.6</td><td>$1.98</td></tr>
<tr><td>PEAK</td><td>$1.2</td><td>$3.96</td></tr></table>
01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays`;
const mimo = `Cache Write: Limited-time Free
### Domestic Pricing of the Model
<table><tr><td>mimo-v2.6-pro</td><td>¥3.00</td></tr></table>
### Overseas Pricing of the Model
<table><tr><th>Inference Type</th><th>Model Name</th><th>Input (Cache Hit)</th><th>Input (Cache Miss)</th><th>Output</th></tr>
<tr><td rowspan="2">Real-time API</td><td>mimo-v2.6-pro</td><td>$0.0036</td><td>$0.435</td><td>$0.87</td></tr>
<tr><td>mimo-v2.6-flash</td><td>$0.0028</td><td>$0.14</td><td>$0.28</td></tr>
<tr><td>Batch API</td><td>mimo-v2.6-pro</td><td>$0.0018</td><td>$0.2175</td><td>$0.435</td></tr></table>`;
const zai = `| Model | Input | Cached Input | Cached Input Storage | Output |
| --- | --- | --- | --- | --- |
| GLM-5.3 | $1.4 | $0.26 | Free | $4.4 |
| GLM-4.5-Air | $0.2 | - | Free | $1.1 |
| GLM-4.7-Flash | Free | - | Free | Free |`;

test('agent price parsers retain span alignment, USD region, paid ingestion and absent cache rates through durable refresh', async () => {
  const d = parseOfficialPrices('deepseek', deepseek, at);
  assert.equal(d.models['deepseek-v4-pro'].tiers['off-peak'].rates.output, 1.98);
  assert.equal(d.models['deepseek-flash'].rates.input, .3);
  const m = parseOfficialPrices('mimo', mimo, at);
  assert.equal(m.models['mimo-v2.6-pro'].rates.input, .435);
  assert.equal(m.models['mimo-v2.6-pro'].tiers.batch.rates.output, .435);
  const z = parseOfficialPrices('zai', zai, at);
  assert.equal(z.models['glm-5.3'].rates.cacheWrite, 1.4);
  assert.equal(z.models['glm-4.7-flash'].rates.output, 0);
  assert.equal(Object.hasOwn(z.models['glm-4.5-air'].rates, 'cacheRead'), false);
  const home = mkdtempSync(path.join(tmpdir(), 'lens-agent-pricing-'));
  try {
    const fetch = async url => new Response(url.includes('deepseek.com') ? deepseek : url.includes('mimo.mi.com') ? mimo : url.includes('docs.z.ai') ? zai : url.includes('openai.com') ? openai : anthropic);
    const syncedAt = '2026-11-20T00:00:00.000Z';
    await refreshOfficialPrices({ home, fetch, force: true, now: Date.parse(syncedAt) });
    for (const provider of ['deepseek', 'mimo', 'zai']) {
      const saved = JSON.parse(readFileSync(path.join(home, `official-prices-${provider}.json`), 'utf8'));
      assert.equal(saved.checkedAt, syncedAt);
      assert.deepEqual(readOfficialPrices(home)[provider].models, saved.models);
    }
    assert.throws(() => parseOfficialPrices('mimo', mimo.replace('Cache Write: Limited-time Free', 'Cache write: priced'), at));
    assert.throws(() => parseOfficialPrices('deepseek', deepseek.replace('Monday through Friday', 'Every day'), at));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('official tables retain their columns, processing tiers, long-context boundary and provenance', () => {
  const a = parseOfficialPrices('openai', openai, at);
  assert.equal(a.models['gpt-test-a'].rates.input, 1);
  assert.equal(a.models['gpt-test-a'].tiers.fast.rates.input, 4);
  assert.equal(a.models['gpt-test-a'].longContext.output, 15);
  assert.equal(a.models['gpt-test-a'].rates.cacheWrite12h, 2.5);
  assert.equal(a.models['gpt-test-a'].threshold, 272000);
  assert.equal(a.checkedAt, at);
  const b = parseOfficialPrices('anthropic', anthropic, at);
  assert.equal(b.models['claude-opus-5-5'].rates.cacheWrite, 5);
  assert.equal(b.models['claude-opus-5-5'].rates.cacheWrite1h, 8);
  assert.equal(b.models['claude-opus-5-5'].tiers.fast.rates.cacheRead, 0.4);
  assert.equal(b.models['claude-opus-4-8'].tiers.fast.rates.cacheWrite1h, 20);
  assert.equal(b.models['claude-opus-5-5'].tiers.batch.rates.cacheRead, 0.1);
});

test('changed or ambiguous official layouts fail closed', () => {
  assert.throws(() => parseOfficialPrices('openai', openai.replaceAll('Short context cached input', 'Unrecognized column'), at));
  assert.throws(() => parseOfficialPrices('openai', openai.replace('≤272K', '≤300K'), at));
  assert.throws(() => parseOfficialPrices('anthropic', anthropic.replace('$4 / MTok', '$-4 / MTok'), at));
  assert.throws(() => parseOfficialPrices('anthropic', 'offline', at));
});

test('official request rates use full input length and preserve exact model matching', () => {
  const rate = (model, input, serviceTier) => officialPrice({ model, input, serviceTier }, BUNDLED_PRICES);
  assert.equal(rate('gpt-6.1-sol', 272000).rates.output, 10);
  assert.equal(rate('gpt-6.1-sol', 272001).rates.output, 15);
  assert.equal(rate('gpt-6.1-sol', 272001, 'priority').rates.cacheRead, 0.4);
  assert.equal(rate('claude-opus-5-5-20260922', 900000).rates.output, 20);
  assert.equal(rate('claude-opus-5-50', 100), undefined);
  assert.equal(rate('proxy/claude-opus-5-5', 100), undefined);
  assert.equal(rate('gpt-6.1-sol', 100, 'unrecognized'), undefined);
  assert.equal(rate('claude-opus-5-5', 100, 'priority'), undefined);
  assert.equal(rate('__proto__', 100), undefined);
});

test('default official billing separates cached reads, TTL writes and output without double counting', () => {
  const a = normalizeUsage('claude', { input_tokens: 100000, output_tokens: 30000, cache_read_input_tokens: 400000,
    cache_creation_input_tokens: 100000, cache_creation: { ephemeral_5m_input_tokens: 60000, ephemeral_1h_input_tokens: 40000 } }, 'a', 'claude-opus-5-5', at);
  const b = normalizeUsage('codex', { input_tokens: 400000, output_tokens: 50000, cached_input_tokens: 200000,
    cache_write_input_tokens: 50000, reasoning_output_tokens: 30000 }, 'b', 'gpt-6.1-sol', at);
  const cfg = { currency: 'USD', prices: {} };
  assert.ok(Math.abs(estimateCost([a, a], cfg).amount - 1.7) < 1e-10);
  assert.ok(Math.abs(estimateCost([b], cfg).amount - 1.64) < 1e-10);
  const cost = estimateCost([a, b], cfg);
  assert.equal(cost.complete, false);
  assert.equal(cost.pricing[0].source, PRICE_SOURCES.anthropic);
  assert.ok(cost.pricing[0].checkedAt);
  assert.equal(estimateCost([a], { currency: 'CNY', prices: {} }).amount, null);
  assert.equal(estimateCost([a], { currency: 'USD', prices: { '*': { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } }).amount, 0);
  assert.equal(estimateCost([a], { currency: 'USD', prices: { 'claude-opus-5-5': { input: 1 } } }).complete, false);
  const unknown = { ...a, id: 'unknown', model: 'unknown-model' };
  assert.deepEqual(estimateCost([a, unknown], cfg).unpricedModels, ['unknown-model']);
});

test('reported fast mode survives streaming merges and selects its official cache rates', () => {
  const a = normalizeUsage('claude', { input_tokens: 1000000, output_tokens: 0, cache_read_input_tokens: 0, speed: 'fast', service_tier: 'standard' }, 'a', 'claude-opus-5-5', at);
  assert.equal(a.serviceTier, 'fast');
  assert.equal(estimateCost([a], { currency: 'USD', prices: {} }).amount, 8);
  const b = { ...a }; delete b.serviceTier;
  assert.equal(mergeRequests([a, b])[0].serviceTier, 'fast');
});

test('official refresh is deduplicated, cached, bounded and preserves valid data on failure', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'lens-pricing-'));
  let calls = 0;
  const fetch = async url => { calls++; return new Response(url.includes('openai.com') ? openai : anthropic); };
  try {
    const customPath = path.join(home, 'config.json');
    const customPrices = JSON.stringify({ currency: 'USD', prices: { 'claude-opus-5-5': { input: 1.25, output: 6 } } });
    writeFileSync(customPath, customPrices);
    const options = { home, now: Date.parse('2026-11-20T00:00:00.000Z'), fetch, force: true };
    await Promise.all([refreshOfficialPrices(options), refreshOfficialPrices(options)]);
    assert.equal(calls, Object.keys(PRICE_SOURCES).length);
    assert.equal(readFileSync(customPath, 'utf8'), customPrices, 'synchronization must preserve custom prices byte for byte');
    const cache = path.join(home, 'official-prices-anthropic.json');
    const before = readFileSync(cache, 'utf8');
    assert.equal(readOfficialPrices(home).openai.models['gpt-test-a'].rates.input, 1);
    await refreshOfficialPrices({ home, now: options.now + 7200000, fetch });
    assert.equal(calls, Object.keys(PRICE_SOURCES).length);
    await refreshOfficialPrices({ ...options, fetch: async () => new Response('changed page') });
    assert.equal(readFileSync(cache, 'utf8'), before);
    await refreshOfficialPrices({ ...options, fetch: async () => new Response('x'.repeat(600000)) });
    assert.equal(readFileSync(cache, 'utf8'), before);
    await refreshOfficialPrices({ ...options, fetch: async () => { throw new Error('offline'); } });
    assert.equal(readFileSync(cache, 'utf8'), before);
    writeFileSync(cache, JSON.stringify({ source: 'https://untrusted.invalid', checkedAt: at, models: {} }));
    assert.equal(readOfficialPrices(home).anthropic.source, PRICE_SOURCES.anthropic);
    assert.equal(readOfficialPrices(home).anthropic.models['claude-opus-5-5'].rates.input, 4);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Google Markdown 价目读取已核验的文本模型和调价日期', () => {
  const parsed = parseOfficialPrices('google', google, at);
  assert.deepEqual(Object.keys(parsed.models), ['gemini-4-carbon', 'gemini-4-argon', 'gemini-4-neon', 'gemini-4-hydrogen']);
  assert.equal(parsed.models['gemini-4-hydrogen'].rates.cacheRead, .075);
  const price = parsed.models['gemini-4-argon'];
  assert.deepEqual(price.rates, { input: 2, output: 10, cacheRead: .1 });
  assert.deepEqual(price.dateChange, { at: '2026-12-01T00:00:00.000Z', rates: { input: 4, output: 20, cacheRead: .2 } });
  assert.equal(Object.hasOwn(price.rates, 'cacheWrite'), false);
  for (const changed of [google.replace('per 1M tokens in USD', 'per 1K tokens in EUR'),
    google.replace('Implicit caching only (explicit caching is not supported).', 'Explicit cache writes are charged.'),
    google.replace('November 30, 2026', 'November 29, 2026'), google.replace('id="gemini-4-argon"', 'id="other"')]) {
    assert.throws(() => parseOfficialPrices('google', changed, at));
  }
});

test('Gemini Standard prices follow request timestamps with the internal UTC boundary and exact identity', () => {
  const rate = (at, extra = {}) => officialPrice({ model: 'gemini-4-argon', input: 170461, at, ...extra }, BUNDLED_PRICES);
  assert.equal(rate('2026-11-30T23:59:59.999Z').rates.input, 2);
  assert.equal(rate('2026-12-01T00:00:00.000Z').rates.input, 4);
  assert.equal(rate('2026-12-01T07:59:59.999+08:00').rates.output, 10);
  assert.equal(rate('2026-12-01T08:00:00.000+08:00').rates.output, 20);
  for (const model of ['gemini-4-argon', 'models/gemini-4-argon', 'Google/gemini-4-argon', 'google/models/GEMINI-4-ARGON']) {
    assert.equal(rate(at, { model }).rates.input, 2);
  }
  for (const model of ['gemini4', 'gemini-4-argon-20261018', 'proxy/gemini-4-argon', 'gemini-4-argon-extra']) assert.equal(rate(at, { model }), undefined);
  assert.equal(rate(at, { serviceTier: 'batch' }).rates.input, 1);
  assert.equal(rate(at, { serviceTier: 'flex' }).rates.input, 1);
  assert.equal(rate(at, { serviceTier: 'priority' }).rates.input, 3.6);
  for (const serviceTier of ['fast', 'unknown']) assert.equal(rate(at, { serviceTier }), undefined);
  assert.equal(rate(undefined), undefined);
  assert.equal(rate('not-a-date'), undefined);
  assert.equal(rate(at, { timestampKnown: false }), undefined);
});

test('Gemini input, implicit cache and inclusive thinking output are charged once and empty overrides do not mask them', () => {
  const row = normalizeUsage('claude', { input_tokens: 2711, cache_read_input_tokens: 167750, cache_creation_input_tokens: 0,
    output_tokens: 182, output_tokens_details: { thinking_tokens: 100 } }, 'gemini-response', 'gemini-4-argon', '2026-10-18T00:00:00Z');
  const cost = prices => estimateCost([row, row], { currency: 'USD', prices }, true, BUNDLED_PRICES);
  for (const prices of [{}, { 'gemini-4-argon': {} }, { '*': {} }, { 'gemini-4-argon': {}, '*': {} }]) {
    assert.ok(Math.abs(cost(prices).amount - .024017) < 1e-12);
    assert.equal(cost(prices).complete, true);
  }
  assert.ok(Math.abs(estimateCost([{ ...row, at: '2026-12-01T00:00:00Z' }], { currency: 'USD', prices: {} }, true, BUNDLED_PRICES).amount - .048034) < 1e-12);
  const custom = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 };
  assert.equal(cost({ 'gemini-4-argon': {}, '*': custom }).pricing[0].tier, 'custom');
  assert.ok(Math.abs(cost({ 'gemini-4-argon': {}, '*': custom }).amount - .170643) < 1e-12);
  assert.equal(cost({ 'gemini-4-argon': { input: 0, output: 0, cacheRead: 0 } }).amount, 0);
  const partial = cost({ 'gemini-4-argon': { input: 1 }, '*': custom });
  assert.equal(partial.complete, false); assert.equal(partial.amount, .002711);
  const raw = { ...row, model: 'Google/gemini-4-argon' };
  assert.equal(estimateCost([raw], { currency: 'USD', prices: { [raw.model]: custom } }, true, BUNDLED_PRICES).pricing[0].model, raw.model);
  assert.equal(estimateCost([{ ...row, timestampKnown: false }], { currency: 'USD', prices: {} }, true, BUNDLED_PRICES).amount, null);
  assert.equal(estimateCost([{ ...row, input: row.input + 1, cacheWrite: 1 }], { currency: 'USD', prices: {} }, true, BUNDLED_PRICES).complete, false);
});

test('从新官网 Markdown 刷新 Google 价目，失败时保留已核验数据', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'lens-google-pricing-'));
  const now = Date.parse('2026-11-20T00:00:00Z'), urls = [];
  const fetch = async url => {
    urls.push(url);
    if (url === PRICE_SOURCES.google + '.md') return new Response(google);
    throw new Error('offline');
  };
  try {
    await refreshOfficialPrices({ home, now, force: true, fetch });
    assert.ok(urls.includes(PRICE_SOURCES.google + '.md'));
    assert.equal(urls.some(url => url.includes('ai.google.dev')), false);
    const cache = path.join(home, 'official-prices-google.json');
    const before = readFileSync(cache, 'utf8');
    assert.equal(readOfficialPrices(home).google.checkedAt, new Date(now).toISOString());
    await refreshOfficialPrices({ home, now: now + 1, force: true, fetch: async () => new Response('价格表结构已变化') });
    assert.equal(readFileSync(cache, 'utf8'), before);
    const failure = JSON.parse(readFileSync(path.join(home, 'official-prices-google-status.json'), 'utf8'));
    assert.equal(failure.status, 'failed'); assert.equal(failure.source, PRICE_SOURCES.google);
    const invalid = JSON.parse(before); invalid.models['gemini-4-argon'].dateChange.at = 'invalid-date';
    writeFileSync(cache, JSON.stringify(invalid));
    assert.deepEqual(readOfficialPrices(home).google, BUNDLED_PRICES.google);
    const incomplete = JSON.parse(before); delete incomplete.models['gemini-4-argon'].dateChange.rates.output;
    writeFileSync(cache, JSON.stringify(incomplete));
    assert.deepEqual(readOfficialPrices(home).google, BUNDLED_PRICES.google);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
