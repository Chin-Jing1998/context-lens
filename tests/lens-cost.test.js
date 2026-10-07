import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import * as zlib from 'node:zlib';
import { costRange, buildCostReport } from '../dist/lens/cost-report.js';
import { CostHistory } from '../dist/lens/cost-history.js';
import { readSqliteCosts, validateCostSession } from '../dist/lens/cost-adapters.js';
import { currentDeepSeekLogs, readDeepSeekCosts } from '../dist/lens/cost-deepseek.js';
import { visibleSession, ActiveSessions } from '../dist/lens/active.js';
import { parseEvents } from '../dist/lens/reader.js';
import { ZERO_TOKENS, mergeRequests } from '../dist/lens/usage.js';
import { parseOfficialPrices, officialPrice } from '../dist/lens/pricing.js';
import { BUNDLED_PRICES } from '../dist/lens/pricing-data.js';
import { startServer } from '../dist/lens/server.js';

const home = fs.mkdtempSync(path.join(tmpdir(), 'lens-cost-'));
const previous = process.env.CONTEXT_LENS_HOME; process.env.CONTEXT_LENS_HOME = home;
after(() => { if (previous === undefined) delete process.env.CONTEXT_LENS_HOME; else process.env.CONTEXT_LENS_HOME = previous; fs.rmSync(home, { recursive: true, force: true }); });
const cfg = { currency: 'USD', prices: { alpha: { input: 1, output: 2, cacheRead: .1, cacheWrite: 1.25 }, beta: { input: 3, output: 6 } } };
const now = new Date('2026-10-07T12:00:00Z');
const query = { period: '7d', timeZone: 'Asia/Shanghai' };
const request = (id, at, model = 'alpha', input = 1000000) => ({ ...ZERO_TOKENS, id, at, timestampKnown: true, model, input, complete: true });
const session = (tool, id, requests, extra = {}) => ({ tool, toolName: tool, id, requests, complete: true, ...extra });

test('calendar periods use inclusive local dates, calendar month/quarter/year and leap days', () => {
  const expected = { today: '2026-10-07', '7d': '2026-10-01', '14d': '2026-09-24', month: '2026-10-01', quarter: '2026-10-01', year: '2026-01-01' };
  for (const [period, start] of Object.entries(expected)) assert.equal(costRange({ period, timeZone: 'Asia/Shanghai' }, now).start, start);
  assert.equal(costRange({ period: 'quarter', timeZone: 'UTC' }, new Date('2026-09-30')).start, '2026-07-01');
  assert.equal(costRange({ period: '7d', timeZone: 'UTC' }, new Date('2024-03-01')).start, '2024-02-24');
  assert.equal(costRange({ period: 'today', timeZone: 'America/Los_Angeles' }, new Date('2026-10-07T02:00:00Z')).end, '2026-10-06');
});
test('custom dates and timezones reject invalid, reversed, future and malformed queries', () => {
  for (const input of [{ period: 'other' }, { period: 'custom', start: '2026-02-30', end: '2026-03-01' },
    { period: 'custom', start: '2026-10-08', end: '2026-10-08' }, { period: 'custom', start: '2026-10-02', end: '2026-10-01' },
    { timeZone: '../UTC' }, { page: 0 }, { page: 1.5 }, { tool: 'x\n' }]) assert.throws(() => costRange(input, now));
});
test('period and cumulative costs use the end-date cutoff and exclude future events', () => {
  const rows = [request('old', '2026-09-01T00:00:00Z'), request('start', '2026-09-30T16:00:00Z'),
    request('end', '2026-10-02T15:59:59Z'), request('after', '2026-10-02T16:00:00Z'), request('future', '2026-10-08T00:00:00Z')];
  const report = buildCostReport([session('claude', 'a', rows)], cfg, { period: 'custom', start: '2026-10-01', end: '2026-10-02', timeZone: 'Asia/Shanghai' }, { now });
  assert.equal(report.totals.period.amount, 2); assert.equal(report.totals.cumulative.amount, 3);
  assert.equal(report.models[0].cumulative.requests, 3); assert.equal(report.sessions[0].cumulative.amount, 3);
});
test('DST days use actual local calendar boundaries rather than 24-hour windows', () => {
  const rows = [request('a', '2026-03-08T07:59:59Z'), request('b', '2026-03-08T08:00:00Z'), request('c', '2026-03-09T06:59:59Z'), request('d', '2026-03-09T07:00:00Z')];
  const r = buildCostReport([session('a', 's', rows)], cfg, { period: 'custom', start: '2026-03-08', end: '2026-03-08', timeZone: 'America/Los_Angeles' }, { now });
  assert.equal(r.totals.period.amount, 2); assert.equal(r.totals.cumulative.amount, 3);
});
test('deduplication spans parent and child logs; model switches and tool namespaces remain distinct', () => {
  const a = request('shared', '2026-10-01T00:00:00Z'), b = request('second', '2026-10-02T00:00:00Z', 'beta');
  const data = [session('codex', 'child', [a, b], { parentId: 'main' }), session('codex', 'main', [a], { title: '核对组件' }), session('mimocode', 'other', [a])];
  const r = buildCostReport(data, cfg, query, { now });
  assert.equal(r.totals.period.amount, 5); assert.equal(r.totals.period.requests, 3);
  assert.equal(r.sessions.length, 2); assert.equal(r.sessions.find(s => s.id === 'main').period.amount, 4);
  assert.deepEqual(r.models.map(m => [m.model, m.period.amount]), [['beta', 3], ['alpha', 2]]);
  const filtered = buildCostReport(data, cfg, { ...query, tool: 'mimocode' }, { now });
  assert.equal(filtered.totals.period.amount, 1); assert.equal(filtered.models.length, 1); assert.equal(filtered.tools.length, 2);
});
test('unknown prices and dates stay unknown; an empty valid period is zero', () => {
  const unknown = session('a', 's', [request('u', '2026-10-01T00:00:00Z', 'unknown')]);
  const r = buildCostReport([unknown], cfg, query, { now });
  assert.equal(r.totals.period.amount, null); assert.equal(r.totals.period.complete, false);
  const mixed = buildCostReport([session('a', 's', [request('k', '2026-10-01T00:00:00Z'), ...unknown.requests, { ...request('no-date', '2026-10-02T00:00:00Z'), timestampKnown: false }])], cfg, query, { now });
  assert.equal(mixed.totals.period.amount, 1); assert.equal(mixed.totals.period.complete, false); assert.equal(mixed.diagnostics.undatedRequests, 1);
  assert.equal(mixed.models.find(m => m.model === 'alpha').period.complete, false);
  assert.equal(mixed.sessions[0].cumulative.complete, false);
  const undatedOnly = buildCostReport([session('a', 's', [{ ...request('no-date', ''), timestampKnown: false }])], cfg, query, { now });
  assert.equal(undatedOnly.totals.period.amount, null);
  assert.equal(buildCostReport([], cfg, query, { now }).totals.period.amount, 0);
});
test('streamed duplicates preserve the original known request date across midnight', () => {
  const early = request('a', '2026-10-01T23:59:59Z'), late = { ...early, at: '2026-10-02T00:00:01Z', output: 10 };
  assert.equal(mergeRequests([early, late])[0].at, early.at);
  assert.equal(mergeRequests([{ ...late, timestampKnown: false }, early])[0].timestampKnown, true);
});
test('native cost parsing preserves timestamp uncertainty and skips placeholder responses', async () => {
  const info = { client: 'claude', id: 'main', model: 'alpha', cwd: '', updatedAt: '2026-10-07T00:00:00Z' };
  const events = [{ type: 'assistant', message: { id: 'real', model: 'alpha', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0 } } },
    { type: 'assistant', timestamp: info.updatedAt, isApiErrorMessage: true, message: { id: 'error', model: '<synthetic>', usage: {} } }];
  const parsed = await parseEvents(info, events, { usageOnly: true });
  assert.equal(parsed.requests.length, 1); assert.equal(parsed.requests[0].timestampKnown, false);
});
test('session pagination is stable and does not change totals', () => {
  const sessions = Array.from({ length: 45 }, (_, i) => session('custom-harness', String(i), [request(String(i), '2026-10-02T00:00:00Z')]));
  const r = buildCostReport(sessions, cfg, { ...query, page: 2 }, { now });
  assert.equal(r.sessions.length, 20); assert.equal(r.pages, 3); assert.equal(r.totals.period.amount, 45); assert.equal(r.sessionCount, 45);
});
function sql(file, command) { execFileSync('sqlite3', [file], { input: command }); }
let hasSqlite = false; try { execFileSync('sqlite3', ['-version'], { stdio: 'ignore' }); hasSqlite = true; } catch { /* Optional reader dependency outside macOS. */ }
const sqliteTest = { skip: hasSqlite ? false : 'sqlite3 is not installed' };
test('OpenCode and MiMo SQLite adapters read only usage and include disjoint reasoning output', sqliteTest, async () => {
  const file = path.join(home, 'opencode.db');
  sql(file, `CREATE TABLE session(id,title,parent_id,time_created); CREATE TABLE message(id,session_id,time_created,data);
    INSERT INTO session VALUES('s','核对缓存',NULL,1790834390000);
    INSERT INTO message VALUES('m','s',1790834400000,'{"role":"assistant","modelID":"alpha","tokens":{"input":100,"output":20,"reasoning":10,"cache":{"read":40,"write":30}},"private_text":"must-not-be-retained"}');
    INSERT INTO message VALUES('bad','s',1790834400000,'{"role":"assistant","error":{},"tokens":{"input":0,"output":0,"cache":{"read":0,"write":0}}}');`);
  for (const tool of ['opencode', 'mimocode']) {
    const s = (await readSqliteCosts({ tool, toolName: tool, path: file, format: 'opencode' }))[0];
    assert.equal(s.requests.length, 1); assert.equal(s.requests[0].input, 170); assert.equal(s.requests[0].output, 30);
    assert.ok(!JSON.stringify(s).includes('must-not-be-retained')); assert.ok(s.requests[0].timestampKnown);
  }
});
test('OpenCode forks exclude inherited usage and remove previously saved duplicate charges durably', sqliteTest, async () => {
  const dir=path.join(home,'fork-accounting');fs.mkdirSync(dir);
  const file=path.join(dir,'opencode.db');
  sql(file, `CREATE TABLE session(id,title,parent_id,time_created); CREATE TABLE message(id,session_id,time_created,data);
    INSERT INTO session VALUES('main','核对原记录',NULL,1790834390000);
    INSERT INTO session VALUES('fork','核对分叉记录',NULL,1790920790000);
    INSERT INTO message VALUES('original','main',1790834400000,'{"role":"assistant","modelID":"alpha","time":{"created":1790834400000},"tokens":{"input":100,"output":20,"reasoning":0,"cache":{"read":0,"write":0}}}');
    INSERT INTO message VALUES('copied','fork',1790920800000,'{"role":"assistant","modelID":"alpha","time":{"created":1790834400000},"tokens":{"input":100,"output":20,"reasoning":0,"cache":{"read":0,"write":0}}}');
    INSERT INTO message VALUES('new','fork',1790920801000,'{"role":"assistant","modelID":"alpha","time":{"created":1790920801000},"tokens":{"input":50,"output":10,"reasoning":0,"cache":{"read":0,"write":0}}}');`);
  const source={tool:'opencode',toolName:'OpenCode',format:'opencode',path:file};
  const parsed=await readSqliteCosts(source),fork=parsed.find(s=>s.id==='fork');
  assert.deepEqual(fork.requests.map(r=>r.id),['opencode:new']);assert.deepEqual(fork.excludedRequestIds,['opencode:copied']);
  const history=new CostHistory({home:dir,native:()=>[],sources:[source]});
  history.import({version:1,sessions:[session('opencode','fork',[request('opencode:copied','2026-10-01T00:00:00Z')])]});
  await history.refresh(true);
  assert.equal(history.report({period:'year'}).totals.cumulative.requests,2);
  fs.unlinkSync(file);
  const restarted=new CostHistory({home:dir,native:()=>[],sources:[]});await restarted.refresh(true);
  assert.equal(restarted.report({period:'year'}).totals.cumulative.requests,2);
});
test('ZCode request accounting uses individual attempts, not aggregated turn counters', sqliteTest, async () => {
  const file = path.join(home, 'zcode.db');
  sql(file, `CREATE TABLE session(id,title,parent_id); INSERT INTO session VALUES('z','核对查询',NULL);
    CREATE TABLE model_usage(id,session_id,model_id,started_at,input_tokens,output_tokens,reasoning_tokens,cache_creation_input_tokens,cache_read_input_tokens);
    INSERT INTO model_usage VALUES('r1','z','alpha',1790834400000,100,20,5,30,40);
    INSERT INTO model_usage VALUES('r2','z','beta',1790834401000,10,2,0,0,0);`);
  const s = (await readSqliteCosts({ tool: 'zcode', toolName: 'ZCode', format: 'zcode', path: file }))[0];
  assert.equal(s.requests.length, 2); assert.equal(s.requests[0].input, 170); assert.equal(s.requests[0].output, 20);
});
const dshEvents = [
  { type: 'session', version: 4, id: 'dsh-child', parentSession: 'dsh-parent', isSeeded: true, delegationDepth: 1, createdAt: 1790834400000 },
  { type: 'assistant/message', seq: 0, time: 1790834400000, data: { turn: 0, step: 0, usage: { inputTokens: 999999, outputTokens: 999999 }, message: { source: { model: 'alpha' } } } },
  { type: 'session/end-seed', seq: 1, time: 1790834400000, data: { inherited: true } },
  { type: 'request/context', seq: 2, time: 1790834400000, data: { model: 'alpha' } },
  { type: 'assistant/attempt', seq: 3, time: 1790834401000, data: { turn: 1, step: 0, stream: [{ type: 'chunk', time: 1790834400000, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10 } } }] } },
  { type: 'assistant/message', seq: 4, time: 1790834401000, data: { turn: 1, step: 0, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 10 }, message: { source: { model: 'alpha' } } } },
  { type: 'llm/retry-started', seq: 5, time: 1790834402000, data: { turn: 1, step: 0 } },
  { type: 'assistant/message', seq: 6, time: 1790834403000, data: { turn: 1, step: 0, usage: { inputTokens: 100, outputTokens: 30 }, message: { source: { model: 'beta' } } } },
  { type: 'session/title', seq: 7, time: 1790834403000, data: { title: '核对 Harness' } },
];
test('DeepSeek Harness ignores inherited seeds, replaces settlements and counts retries separately', async () => {
  const file = path.join(home, 'session.v4.jsonl'); fs.writeFileSync(file, dshEvents.map(e => JSON.stringify(e)).join('\n'));
  const s = (await readDeepSeekCosts(file, { tool: 'deepseek', toolName: 'DeepSeek Harness' }))[0];
  assert.equal(s.requests.length, 2); assert.equal(s.requests[0].input, 110); assert.equal(s.requests[0].output, 20);
  assert.equal(s.requests[1].model, 'beta'); assert.equal(s.title, '核对 Harness'); assert.equal(s.complete, true);
  assert.equal(s.requests[0].at, new Date(dshEvents[4].data.stream[0].time).toISOString());
  if (zlib.zstdCompressSync) {
    const compressed = file + '.zstd'; fs.writeFileSync(compressed, zlib.zstdCompressSync(fs.readFileSync(file)));
    assert.deepEqual((await readDeepSeekCosts(compressed, { tool: 'deepseek', toolName: 'DeepSeek Harness' }))[0], s);
  }
});
test('Harness migrations choose the latest generation and final settlements replace provisional counters across scans', async () => {
  const dir = path.join(home, 'dsh'); fs.mkdirSync(dir);
  const old = path.join(dir, 'session.v2.jsonl'), live = path.join(dir, 'session.v4.jsonl');
  const events = [ { type: 'session', version: 4, id: 'dsh-main' },
    { type: 'assistant/attempt', time: Date.parse('2026-10-01T23:59:59Z'), data: { turn: 0, step: 0, message: { source: { model: 'alpha' } }, usage: { inputTokens: 100, outputTokens: 30 } } } ];
  fs.writeFileSync(old, JSON.stringify({ ...events[0], version: 2 }) + '\n' + JSON.stringify(events[1]));
  fs.writeFileSync(live, events.map(e => JSON.stringify(e)).join('\n'));
  assert.deepEqual(currentDeepSeekLogs([old, live, live + '.zstd']), [live]);
  const history = new CostHistory({ home: path.join(dir, 'history'), native: () => [], sources: [{ tool: 'deepseek', toolName: 'DeepSeek Harness', format: 'deepseek', path: dir }] });
  await history.refresh(true);
  assert.equal(history.snapshot('deepseek:dsh-main', 'budget').totals.all.output, 30);
  fs.appendFileSync(live, '\n' + JSON.stringify({ ...events[1], type: 'assistant/message', time: Date.parse('2026-10-02T00:00:01Z'), data: { ...events[1].data, usage: { inputTokens: 100, outputTokens: 20 } } }));
  await history.refresh(true);
  assert.equal(history.snapshot('deepseek:dsh-main', 'budget').totals.all.output, 20);
  const r = history.report({ period: 'custom', start: '2026-10-01', end: '2026-10-01', timeZone: 'UTC' });
  assert.equal(r.totals.period.requests, 1, 'settlement across midnight belongs to the original attempt date');
});
test('durable costs survive log removal/restart, import arbitrary tools idempotently and reject an invalid batch atomically', sqliteTest, async () => {
  const dir = path.join(home, 'persistent'), source = path.join(dir, 'source.db'); fs.mkdirSync(dir);
  fs.copyFileSync(path.join(home, 'opencode.db'), source);
  const history = new CostHistory({ home: dir, native: () => [], sources: [{ tool: 'opencode', toolName: 'OpenCode', format: 'opencode', path: source }] });
  await Promise.all([history.refresh(true), history.refresh(true)]);
  const before = history.report({ period: 'year', timeZone: 'UTC' }); assert.equal(before.totals.cumulative.requests, 1);
  fs.unlinkSync(source);
  const restarted = new CostHistory({ home: dir, native: () => [], sources: [] }); await restarted.refresh(true);
  assert.equal(restarted.report({ period: 'year', timeZone: 'UTC' }).totals.cumulative.requests, 1);
  const custom = session('new-agent', 's', [request('r', '2026-10-01T00:00:00Z')]);
  restarted.import({ version: 1, sessions: [custom] }); restarted.import({ version: 1, sessions: [custom] });
  assert.equal(restarted.report({ tool: 'new-agent', period: 'year' }).totals.cumulative.requests, 1);
  assert.throws(() => restarted.import({ version: 1, sessions: [session('not-written', 'x', []), { ...custom, requests: [{ ...custom.requests[0], input: -1 }] }] }));
  assert.ok(!restarted.report({}).tools.some(t => t.id === 'not-written'));
  assert.throws(() => validateCostSession({ ...custom, requests: [{ ...custom.requests[0], cacheRead: 2000000 }] }));
});
test('foreground identity overrides background activity and changes within the same app without sending a prompt', () => {
  const files = [{ client: 'codex', id: 'a', title: '核对界面', cwd: '/a' }, { client: 'codex', id: 'b', title: '核对费用', cwd: '/b' }, { client: 'claude', id: 'c', title: '核对费用', cwd: '/c' }];
  const active = new ActiveSessions();
  assert.equal(active.get(files, 'codex', 100, { id: 'a' }).selected, 'codex:a');
  assert.equal(active.get(files, 'codex', 100, { title: '核对费用' }).selected, 'codex:b');
  assert.equal(active.get(files, 'claude', 101, { id: 'c' }).selected, 'claude:c');
  assert.equal(visibleSession([...files, { ...files[0], id: 'd' }], 'codex', { title: '核对界面' }), null);
  assert.equal(visibleSession(files, 'codex', { id: 'c' }), null);
  assert.equal(visibleSession(files, undefined, { id: 'a' }), 'codex:a');
});
test('cost API validates filters and import size/type and exposes external active snapshots without a selector', async () => {
  const history = new CostHistory({ home: path.join(home, 'http'), native: () => [], sources: [] });
  history.import({ version: 1, sessions: [session('mimocode', 'main', [request('a', '2026-10-01T00:00:00Z')], { title: '核对界面' })] });
  const collector = { list: () => [] };
  const { server, url } = await startServer({ port: 0, collector, costHistory: history, pricingRefresh: false });
  try {
    await history.refresh(true);
    assert.equal((await fetch(url + '/api/costs?period=invalid')).status, 400);
    assert.equal((await fetch(url + '/api/costs?period=custom&start=2026-02-30&end=2026-03-01')).status, 400);
    const active = await (await fetch(url + '/api/active?client=mimocode&visibleId=main')).json(); assert.equal(active.selected, 'mimocode:main');
    const snapshot = await (await fetch(url + '/api/snapshot?session=mimocode:main')).json(); assert.equal(snapshot.session.title, '核对界面'); assert.equal(snapshot.context.percent, null);
    assert.equal((await fetch(url + '/api/costs/import', { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await fetch(url + '/api/costs/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"version":1,"sessions":[{}]}' })).status, 400);
    assert.equal((await fetch(url + '/api/costs', { headers: { Origin: 'https://outside.invalid' } })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('automatic API prices cover MiMo and GLM, preserve free tiers and respect DeepSeek peak/holiday schedules', () => {
  assert.equal(officialPrice({ model: 'mimo-v2.6-pro', input: 100 }, BUNDLED_PRICES).rates.input, .435);
  assert.equal(officialPrice({ model: 'mimo-v2.6-pro', input: 100, serviceTier: 'batch' }, BUNDLED_PRICES).rates.output, .435);
  assert.equal(officialPrice({ model: 'glm-4.7-flash', input: 100 }, BUNDLED_PRICES).rates.output, 0);
  assert.equal(officialPrice({ model: 'glm-5.3', input: 100 }, BUNDLED_PRICES).rates.input, 1.4);
  const price = at => officialPrice({ model: 'deepseek-flash', input: 100, at }, BUNDLED_PRICES);
  assert.equal(price('2026-09-24T01:00:00Z').rates.input, .3);
  assert.equal(price('2026-09-24T04:00:00Z').rates.input, .15);
  assert.equal(price('2026-10-07T01:00:00Z').rates.input, .15);
  assert.equal(price('2026-10-10T01:00:00Z').rates.input, .15, 'weekends stay off-peak even on makeup workdays');
  assert.equal(price('invalid'), undefined); assert.equal(price('2027-01-05T01:00:00Z'), undefined);
  assert.throws(() => parseOfficialPrices('zai', '| GLM-5.3 | $1 | $0.1 | Free | $4 |', now.toISOString()));
});
