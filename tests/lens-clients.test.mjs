import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ActiveSessions, agyLockCandidates } from '../dist/lens/active.js';
import { ClaudeDesktopSessions } from '../dist/lens/claude-desktop.js';
import { validateCostSession } from '../dist/lens/cost-adapters.js';
import { officialPrice, readOfficialPrices, referenceRates } from '../dist/lens/pricing.js';
import { parseEvents } from '../dist/lens/reader.js';
import { SessionCollector } from '../dist/lens/snapshot.js';
import { CostHistory } from '../dist/lens/cost-history.js';
import { currentQuota } from '../dist/lens/quota.js';
import { estimateCost, mergeRequests, normalizeUsage, sumRequests } from '../dist/lens/usage.js';

const one = '20000000-0000-0000-0000-000000000001';
const two = '20000000-0000-0000-0000-000000000002';
const at = second => `2026-01-02T03:04:${String(second).padStart(2, '0')}Z`;
const info = (client, id = one) => ({ id, client, cwd: '', model: '', updatedAt: at(0) });

function temp(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'context-lens-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function integer(value) {
  const out = [];
  while (value >= 128) { out.push(value % 128 + 128); value = Math.floor(value / 128); }
  return Buffer.from([...out, value]);
}
function field(id, value) {
  if (typeof value === 'number') return Buffer.concat([integer(id * 8), integer(value)]);
  const bytes = Buffer.from(value);
  return Buffer.concat([integer(id * 8 + 2), integer(bytes.length), bytes]);
}
const message = (...fields) => Buffer.concat(fields);

function agyGeneration(response, uncached, read, output, used, breakdown) {
  const usage = message(field(2, uncached), field(3, output), field(5, read), field(9, 5), field(11, response));
  const window = message(field(1, used), field(4, 512000), ...(breakdown ? [field(3, breakdown)] : []));
  const start = message(field(4, field(1, 1767323040)), field(10, window));
  return field(1, message(field(4, usage), field(9, start), field(19, 'gemini-4-neon'), field(21, 'Gemini 4 Neon')));
}

test('Antigravity 从两个数据根定位会话、读取活动 WAL 并按响应去重', async t => {
  const sqlite = await import('node:sqlite').catch(() => null);
  if (!sqlite) { t.skip('当前 Node 未提供 SQLite'); return; }
  const openDatabases = [];
  t.after(() => { for (const database of openDatabases) database.close(); });
  const root = temp(t);
  const desktop = path.join(root, 'desktop'), cli = path.join(root, 'cli');
  const summary = `CREATE TABLE conversation_summaries (conversation_id TEXT, title TEXT, workspace_uris TEXT,
    last_modified_time TEXT, last_user_input_time TEXT, parent_conversation_id TEXT)`;
  for (const directory of [desktop, cli]) {
    mkdirSync(path.join(directory, 'conversations'), { recursive: true });
    const db = new sqlite.DatabaseSync(path.join(directory, 'conversation_summaries.db'));
    db.exec(summary);
    // 两个索引互相列出对方的会话，由实际数据库判断归属。
    for (const id of [one, two]) db.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, NULL)')
      .run(id, '同名会话', '["file:///tmp/project"]', at(1), at(1));
    db.close();
  }
  const session = (directory, id) => {
    const db = new sqlite.DatabaseSync(path.join(directory, 'conversations', id + '.db'));
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE trajectory_meta (cascade_id TEXT); CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB); CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER, metadata BLOB, status INTEGER, step_payload BLOB)');
    db.prepare('INSERT INTO trajectory_meta VALUES (?)').run(id); openDatabases.push(db);
    return db;
  };
  const desktopDb = session(desktop, one), cliDb = session(cli, two);
  const desktopInsert = desktopDb.prepare('INSERT INTO gen_metadata VALUES (?, ?)'), cliInsert = cliDb.prepare('INSERT INTO gen_metadata VALUES (?, ?)');
  const group = (type, tokens, children = []) => field(1, message(field(2, type), field(4, tokens), ...children.map(([label, count]) => field(5, message(field(1, label), field(3, count))))));
  const breakdown = message(group(1, 500), group(2, 200), group(4, 100), group(5, 1100), group(3, 200),
    group(7, 8800, [['1: USER_INPUT', 1500], ['2: PLANNER_RESPONSE', 4000], ['3: GENERIC', 3300]]), field(2, 11000));
  desktopInsert.run(0, agyGeneration('first', 34, 500, 21, 11000));
  desktopInsert.run(1, agyGeneration('first', 34, 500, 27, 11000, breakdown));
  const insertActivity = desktopDb.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, 132, ?, ?, ?)');
  const runResult = field(140, field(2, field(6, message(field(1, 'type.googleapis.com/exa.cortex.core.tools.RunCommand'), field(2, field(1, 2))))));
  const activity = (idx, id, name, args, status, payload = null) => insertActivity.run(idx, status,
    message(field(4, message(field(1, id), field(2, name), field(3, JSON.stringify(args)))),
      field(32, field(1, 1767323045)), field(8, field(1, 1767323047))), payload);
  activity(1, 'command', 'run_command', { CommandLine: 'printf "%s" private-argument' }, 3, runResult);
  activity(2, 'mcp', 'call_mcp_tool', { ServerName: 'test-server', ToolName: 'lookup', Arguments: '{"private":true}' }, 2);
  activity(3, 'mcp', 'call_mcp_tool', { ServerName: 'test-server', ToolName: 'lookup' }, 3);
  activity(4, 'skill', 'read_file', { Path: '/local/example-skill/SKILL.md' }, 3);
  activity(5, 'ordinary-file', 'read_file', { Path: '/local/project/README.md' }, 3);
  activity(6, 'proposal', 'run_command', { CommandLine: 'printf ignored' }, 5);
  cliInsert.run(0, agyGeneration('second', 28, 100, 14, 22000));
  cliDb.prepare('INSERT INTO steps (idx, step_type, metadata) VALUES (7, 23, ?)').run(message(field(1, field(1, 1767323050)),
    field(9, message(field(2, 10), field(3, 15), field(5, 20), field(11, 'compacted')))));
  const collector = new SessionCollector({ claude: path.join(root, 'none'), codex: path.join(root, 'none'), agy: { desktop, cli } });
  const active = new ActiveSessions();
  assert.deepEqual(collector.list().map(({ id, surface }) => [id, surface]), [[one, 'desktop'], [two, 'cli']]);
  assert.equal(active.get(collector.list(), 'agy', 42, { id: one }).selected, `agy:${one}`);
  assert.equal(active.get(collector.list(), 'agy', 42, { id: two }).selected, null);
  assert.equal(active.get(collector.list(), 'agy', 42, { title: '同名会话' }).selected, null);
  const first = await collector.get(`agy:${one}`), second = await collector.get(`agy:${two}`);
  assert.equal(first.context.percent, 11000 / 512000 * 100);
  assert.equal(first.context.modelTokens, null);
  assert.equal(first.context.windowEstimated, true);
  assert.deepEqual([first.totals.all.input, first.totals.all.uncachedInput, first.totals.all.cacheRead, first.totals.all.output, first.totals.all.requests], [534, 34, 500, 27, 1]);
  assert.deepEqual([second.totals.all.input, second.totals.all.output, second.totals.all.cacheRead, second.totals.all.requests], [158, 29, 120, 2]);
  const segment = id => first.context.segments.find(item => item.id === id)?.tokens;
  assert.deepEqual(['systemPrompt', 'systemTools', 'mcpTools', 'skills', 'rules', 'messages', 'unclassified', 'free'].map(segment),
    [500, 200, 100, 1100, 200, 8800, 100, 501000]);
  assert.deepEqual(first.context.messageBreakdown.map(({ id, tokens }) => [id, tokens]), [['user', 1500], ['assistant', 4000], ['tools', 3300]]);
  assert.deepEqual([first.activity.commands.total, first.activity.commands.failed, first.activity.mcp.succeeded, first.activity.skills.reads], [1, 1, 1, 1]);
  const commandHistory = await collector.details(`agy:${one}`, { section: 'activity', kind: 'commands', status: 'failed' });
  assert.equal(commandHistory.total, 1);
  assert.deepEqual(commandHistory.items.map(row => [row.name, row.exitCode, row.durationMs]), [['printf', 2, 2000]]);
  assert.ok(!JSON.stringify(commandHistory).includes('private-argument'));
  const previousHome = process.env.CONTEXT_LENS_HOME;
  process.env.CONTEXT_LENS_HOME = root;
  t.after(() => { if (previousHome === undefined) delete process.env.CONTEXT_LENS_HOME; else process.env.CONTEXT_LENS_HOME = previousHome; });
  mkdirSync(path.join(root, 'live'));
  writeFileSync(path.join(root, 'live', `agy-cli-${two}.json`), JSON.stringify({ id: two, at: at(31), model: 'Gemini 4 Neon', size: 1048576, percent: 2.1 }));
  const sampled = await collector.get(`agy:${two}`);
  assert.deepEqual([sampled.context.view, sampled.context.modelTokens, sampled.context.budget.tokens, sampled.context.percent, sampled.totals.all.output],
    ['model', 1048576, 512000, 2.1, 29]);
  const reset = new Date(Date.now() + 60_000).toISOString();
  const capture = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/context-lens.mjs', import.meta.url)), 'agy-statusline'], {
    input: JSON.stringify({ product: 'antigravity', conversation_id: two, model: { id: 'gemini-4-neon', effort: 'high' },
      quota: { 'gemini-5h': { remaining_fraction: 0, reset_time: reset }, '3p-weekly': { remaining_fraction: 0.6, reset_time: reset },
        'disabled': { remaining_fraction: 1, disabled: true }, 'invalid': { remaining_fraction: 1.2 } } }),
    encoding: 'utf8',
  });
  assert.equal(capture.status, 0, capture.stderr);
  const quotaSnapshot = await collector.get(`agy:${two}`);
  assert.deepEqual(quotaSnapshot.quota.map(row => [row.name, row.windowMinutes, row.remainingPercent]),
    [['Claude / GPT', 10080, 60], ['Gemini', 300, 0]]);
  assert.equal((await collector.get(`agy:${one}`)).quota, undefined);
  assert.equal(currentQuota(quotaSnapshot.quota, Date.parse(reset)), undefined);
  assert.equal(quotaSnapshot.telemetry.effort, 'high');
  const historyCosts = new CostHistory({ home: path.join(root, 'history-costs'), native: () => collector.list(), sources: [] });
  await historyCosts.refresh(true);
  const report = historyCosts.report({ period: 'custom', start: '2026-01-02', end: '2026-01-02', tool: 'agy', timeZone: 'UTC' });
  assert.equal(report.totals.period.requests, 3);
  assert.ok(report.sessions.every(row => row.toolName === 'Antigravity' && row.title === '同名会话'));
  desktopInsert.run(2, agyGeneration('third', 49, 900, 31, 22500));
  const changed = await collector.get(`agy:${one}`);
  assert.deepEqual([changed.context.usedTokens, changed.totals.all.input, changed.totals.all.output, changed.totals.all.cacheRead], [22500, 1483, 58, 1400]);
  assert.equal(changed.context.segments.find(item => item.id === 'mcpTools').tokens, null);
  assert.equal(changed.context.messageBreakdown, undefined);
  assert.equal((await collector.details(`agy:${one}`)).total, 2);
  const locks = path.join(cli, 'presence');
  const candidates = agyLockCandidates(`p22\nn${locks}/${two}.lock\np99\nn${locks}/${one}.lock\n`, locks, new Map([[22, '/opt/bin/agy'], [99, '/bin/other']]));
  assert.deepEqual(candidates.map(({ key, pid }) => ({ key, pid })), [{ key: `agy:${two}`, pid: 22 }]);
  const oldId = '20000000-0000-0000-0000-000000000003';
  const index = new sqlite.DatabaseSync(path.join(cli, 'conversation_summaries.db'));
  index.prepare('INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, NULL)').run(oldId, '较早会话', '[]', at(1), at(1));
  index.close();
  // 迁移后的布局只保留索引和同一会话目录中的转录。
  const history = path.join(cli, 'brain', oldId, '.system_generated', 'logs');
  mkdirSync(history, { recursive: true });
  const transcript = [{ type: 'PLANNER_RESPONSE', step_index: 3, model: 'gemini', input_tokens: 17, cache_read_tokens: 90,
    output_tokens: 5, created_at: at(2), tool_calls: [{ name: 'read_file', args: { Path: '/local/legacy-skill/SKILL.md' } }] },
  { type: 'GENERIC', step_index: 4, status: 'DONE', created_at: at(3) },
  { type: 'PLANNER_RESPONSE', step_index: 5, tool_calls: [{ name: 'run_command', args: { CommandLine: 'printf proposal' } }] }];
  writeFileSync(path.join(history, 'transcript.jsonl'), transcript.map(row => JSON.stringify(row)).join('\n') + '\n');
  collector.list(true);
  const old = await collector.get(`agy:${oldId}`);
  assert.deepEqual([old.totals.all.uncachedInput, old.totals.all.cacheRead, old.totals.all.output], [17, 90, 5]);
  assert.ok(old.totals.all.missingTokens.includes('cacheWrite'));
  assert.deepEqual([old.activity.skills.reads, old.activity.commands.total, old.activity.complete], [1, 0, false]);
  const migrated = session(cli, oldId);
  collector.list(true);
  assert.equal((await collector.get('agy:' + oldId)).totals.all.input, 107);
  await historyCosts.refresh(true);
  migrated.prepare('INSERT INTO gen_metadata VALUES (?,?)').run(0, agyGeneration('migrated-request',17,90,5,12100));
  assert.equal((await collector.get('agy:' + oldId)).totals.all.requests, 1);
  await historyCosts.refresh(true);
  const migratedReport = historyCosts.report({ period:'custom', start:'2026-01-02', end:'2026-01-02', timeZone:'UTC' });
  assert.equal(migratedReport.sessions.find(s => s.id === oldId).cumulative.requests, 1);
});

test('Codex 仅采用自己会话中各额度窗口的最新有效记录', async () => {
  const reset = Date.parse(at(59)) / 1000;
  const quotaEvent = (second, by, limits) => ({ type: 'event_msg', timestamp: at(second), payload: {
    type: 'token_count', thread_id: by, info: null, rate_limits: limits,
  } });
  const limits = used_percent => ({ limit_id: 'codex', primary: { used_percent, window_minutes: 300, resets_at: reset },
    secondary: { used_percent: 100, window_minutes: 10080, resets_at: reset } });
  const events = [quotaEvent(12, one, limits(21.5)), quotaEvent(13, two, limits(67)), quotaEvent(11, one, limits(1))];
  const data = await parseEvents(info('codex'), events);
  assert.deepEqual(data.quota?.map(row => [row.windowMinutes, row.remainingPercent]), [[300, 78.5], [10080, 0]]);
  assert.equal(currentQuota(data.quota, Date.parse(at(59))), undefined);
  const cleared = await parseEvents(info('codex'), [...events, quotaEvent(14, one, { limit_id: 'codex', primary: null, secondary: null })]);
  assert.equal(currentQuota(cleared.quota, Date.parse(at(14))), undefined);
});

test('Claude 桌面第三方元数据补足身份与模型，空采样保留日志中的当前用量', async t => {
  const root = temp(t), meta = path.join(root, 'Claude-3p', 'account', 'org');
  mkdirSync(meta, { recursive: true });
  writeFileSync(path.join(meta, 'local_fixture.json'), JSON.stringify({ sessionId: 'local_fixture', cliSessionId: one, title: '第三方会话', model: 'third-party-model' }));
  const log = path.join(root, `${one}.jsonl`), file = { ...info('claude'), file: log, size: 0, mtimeMs: 0 };
  const desktop = new ClaudeDesktopSessions([path.join(root, 'Claude-3p')]);
  const [described] = desktop.describe([file]);
  assert.equal(desktop.resolve([described], { id: 'local_fixture' }), `claude:${one}`);
  assert.equal(described.title, '第三方会话');
  assert.equal(described.model, 'third-party-model');
  const usage = { input_tokens: 75, output_tokens: 20, cache_read_input_tokens: 900, cache_creation_input_tokens: 25 };
  const event = { type: 'assistant', sessionId: one, timestamp: at(2), message: { id: 'claude-response', model: described.model, usage } };
  writeFileSync(log, JSON.stringify(event) + '\n');
  const previousHome = process.env.CONTEXT_LENS_HOME;
  process.env.CONTEXT_LENS_HOME = root;
  t.after(() => { if (previousHome === undefined) delete process.env.CONTEXT_LENS_HOME; else process.env.CONTEXT_LENS_HOME = previousHome; });
  const data = await new SessionCollector({ claude: root, codex: path.join(root, 'none') }).snapshot(described, { live: {
    at: at(3), environment: {}, stdin: { session_id: one, model: { id: described.model }, context_window: { current_usage: null, used_percentage: 0 } },
  } });
  assert.deepEqual([data.context.usedTokens, data.context.windowPercent, data.totals.all.uncachedInput, data.totals.all.input, data.totals.all.cacheRead, data.totals.all.cacheWrite], [1000, null, 75, 1000, 900, 25]);
});

test('Codex 切换路由或压缩后忽略重复的旧统计，首轮仍返回已选模型', async () => {
  const turn = (second, model) => ({ type: 'turn_context', timestamp: at(second), payload: { model } });
  const usage = { input_tokens: 1000, cached_input_tokens: 700, cache_write_input_tokens: 0, output_tokens: 30, reasoning_output_tokens: 10 };
  const counter = (second, last, total = last, capacity = 250000) => ({ type: 'event_msg', timestamp: at(second), payload: { type: 'token_count', info: {
    last_token_usage: last, total_token_usage: total, model_context_window: capacity,
  } } });
  const before = [turn(1, 'gpt-6.2-sol'), counter(2, usage), turn(3, 'antigravity/gemini-4-argon'), counter(4, usage)];
  let parsed = await parseEvents(info('codex'), before);
  assert.deepEqual([parsed.info.model, parsed.used, parsed.capacity], ['antigravity/gemini-4-argon', null, null]);
  const current = { ...usage, input_tokens: 88, cached_input_tokens: 30, output_tokens: 12 };
  const lifetime = { ...usage, input_tokens: 1088, cached_input_tokens: 730, output_tokens: 42 };
  const resumed = [...before, { type: 'token_usage_record', timestamp: at(5), payload: { response_id: 'new-response', usage: current } }, counter(6, current, lifetime, 100000)];
  parsed = await parseEvents(info('codex'), resumed);
  assert.deepEqual([parsed.used, parsed.capacity, parsed.requests[0].model, parsed.requests[0].uncachedInput], [100, 100000, 'antigravity/gemini-4-argon', 58]);
  parsed = await parseEvents(info('codex'), [...resumed, { type: 'compacted', timestamp: at(7) }, counter(8, current, lifetime, 100000)]);
  assert.equal(parsed.used, null);
  assert.equal(parsed.compacted, true);
});

test('已知输入与输出独立计量，缺失的缓存字段不会进入命中率或计价', () => {
  const codex = normalizeUsage('codex', { input_tokens: 80, output_tokens: 17, reasoning_output_tokens: 6 }, 'missing', 'test', at(1));
  const metrics = sumRequests([codex]);
  assert.equal(metrics.input, 80);
  assert.equal(metrics.output, 17);
  assert.equal(metrics.reasoning, 6);
  assert.equal(metrics.hitRate, null);
  assert.equal(metrics.uncachedInput, undefined);
  assert.ok(metrics.missingTokens.includes('cacheRead'));
  assert.equal(estimateCost([codex], { currency: 'USD', prices: { test: { input: 1, output: 2 } } }, true, {}).amount, 34 / 1_000_000);
});

test('同一请求只算一次，输入总量与缓存快照使用同一拆分', () => {
  const config = { currency: 'USD', prices: { test: { input: 10, cacheRead: 1, cacheWrite: 2, output: 4 } } };
  for (const client of ['claude', 'codex', 'agy']) {
    const row = (input, read, write, output, second) => normalizeUsage(client, {
      input_tokens: client === 'codex' ? input : input - read - write, cached_input_tokens: read, cache_write_input_tokens: write, output_tokens: output,
    }, 'response', 'test', at(second));
    const rows = [row(1000, 700, 200, 20, 1), row(1000, 600, 100, 25, 2), normalizeUsage(client, { output_tokens: 30 }, 'response', 'test', at(3))];
    const totals = sumRequests(rows);
    assert.deepEqual([totals.input, totals.uncachedInput, totals.cacheRead, totals.cacheWrite, totals.output, totals.requests, totals.hitRate],
      [1000, 300, 600, 100, 30, 1, 0.6], client);
    const cost = estimateCost(rows, config, true, {});
    assert.equal(cost.complete, true, client);
    assert.ok(Math.abs(cost.amount - (300 * 10 + 600 + 100 * 2 + 30 * 4) / 1e6) < 1e-12, client);
  }
});

test('费用记录重新加载后保留缺失字段和已知未缓存输入', () => {
  const request = normalizeUsage('claude', { input_tokens: 100, output_tokens: 5 }, 'partial', 'test', at(1));
  const { requests } = validateCostSession({ tool: 'claude', toolName: 'Claude Code', id: one, complete: false, requests: [request] });
  assert.deepEqual(requests[0].missingTokens, request.missingTokens);
  assert.equal(requests[0].uncachedInput, 100);
  const cachedOnly = normalizeUsage('claude', { cache_read_input_tokens: 15, output_tokens: 7 }, 'partial', 'test', at(2));
  const [merged] = mergeRequests([cachedOnly, requests[0]]);
  assert.equal(merged.cacheRead, 0);
  assert.ok(merged.missingTokens.includes('cacheRead'));
});

test('Codex 的累计计数补足缺失历史时保留同一份输入拆分', async t => {
  const root = temp(t), file = path.join(root, `${one}.jsonl`);
  const previousHome = process.env.CONTEXT_LENS_HOME;
  process.env.CONTEXT_LENS_HOME = root;
  t.after(() => { if (previousHome === undefined) delete process.env.CONTEXT_LENS_HOME; else process.env.CONTEXT_LENS_HOME = previousHome; });
  const usage = { input_tokens: 1000, cached_input_tokens: 700, cache_write_input_tokens: 200, output_tokens: 30 };
  const cumulative = { input_tokens: 1500, cached_input_tokens: 550, cache_write_input_tokens: 200, output_tokens: 44 };
  const events = [{ type: 'turn_context', timestamp: at(1), payload: { model: 'gpt-6.2-sol' } }, {
    type: 'token_usage_record', timestamp: at(2), payload: { response_id: 'response', usage, thread_token_usage: cumulative },
  }, {
    type: 'token_usage_record', timestamp: at(3), payload: { response_id: 'response', usage, thread_token_usage: usage },
  }];
  writeFileSync(file, events.map(value => JSON.stringify(value)).join('\n') + '\n');
  const collector = new SessionCollector({ claude: root, codex: root });
  const { totals } = await collector.snapshot({ ...info('codex'), file, size: 0, mtimeMs: 0 });
  assert.deepEqual([totals.all.input, totals.all.uncachedInput, totals.all.cacheRead, totals.all.cacheWrite, totals.all.output, totals.all.requests],
    [1500, 750, 550, 200, 44, null]);
});

test('官方单价按请求时间、档位及完整输入量选择，路由别名仍需可核验', t => {
  const catalog = readOfficialPrices(temp(t));
  const quote = (model, input = 1000, serviceTier, at = '2026-11-19T12:00:00.000Z') => officialPrice({ model, input, serviceTier, at }, catalog)?.rates;
  assert.deepEqual(quote('gpt-6.2-astra'), { input: 8, output: 40, cacheRead: 0.4, cacheWrite: 10, cacheWrite12h: 20 });
  assert.equal(quote('gpt-6.2-sol', 272001, 'ultrafast', '2027-03-01T07:59:59.999Z').output, 45);
  assert.equal(quote('gpt-6.2-sol', 272001, 'ultrafast', '2027-03-01T08:00:00.000Z').output, 90);
  assert.equal(quote('gpt-5.6-sol', 1000, 'standard', '2026-12-01T00:00:00.000Z'), undefined);
  assert.equal(quote('anthropic/claude-opus-5.5').cacheRead, 0.2);
  assert.equal(quote('claude-fable-5-2', 1000, 'fast').output, 80);
  assert.equal(quote('claude-haiku-5-5', 100000, 'batch').input, 0.05);
  assert.equal(quote('claude-haiku-5-5', 100001, 'batch').input, 0.25);
  assert.equal(quote('google/models/gemini-4-carbon').input, 2);
  assert.equal(quote('Gemini 4 Hydrogen').cacheRead, 0.075);
  assert.equal(quote('gemini-4-argon', 1000, 'batch', '2026-12-01T00:00:00.000Z').input, 2);
  assert.equal(referenceRates(catalog, Date.parse('2026-12-01T00:00:00.000Z'))['gemini-4-carbon'].output, 20);
  assert.equal(quote('auto/gemini-4-argon'), undefined);
});

test('OpenAI 输入明细按非重叠分项计费，写入时长缺失时保留费用下限', t => {
  const model = 'gpt-6.2-sol';
  const request = normalizeUsage('codex', { input_tokens: 1000, output_tokens: 30, input_tokens_details: {
    cached_tokens: 700, cache_write_tokens: 100,
  } }, 'response', model, '2026-11-19T12:00:00.000Z');
  const catalog = readOfficialPrices(temp(t));
  const config = { currency: 'USD', prices: {} };
  const price = estimateCost([request], config, true, catalog);
  assert.deepEqual([request.input, request.uncachedInput, request.cacheRead, request.cacheWrite], [1000, 200, 700, 100]);
  assert.ok(Math.abs(price.amount - (200 * 2 + 700 * 0.10 + 100 * 2.50 + 30 * 10) / 1e6) < 1e-12);
  assert.equal(price.complete, false);
  const custom = estimateCost([request], { ...config, prices: { [model]: { input: 1, cacheRead: 0, cacheWrite: 0, output: 1 } } }, true, catalog);
  assert.equal(custom.complete, true);
  assert.ok(Math.abs(custom.amount - (200 + 30) / 1e6) < 1e-12);
});
