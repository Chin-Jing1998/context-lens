import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureClaude, readLiveClaude } from '../dist/lens/sessions.js';
import { SessionCollector } from '../dist/lens/snapshot.js';
import { buildContext } from '../dist/lens/context.js';

const temporary = mkdtempSync(path.join(tmpdir(), 'lens-context-percentage-'));
const previous = { CONTEXT_LENS_HOME: process.env.CONTEXT_LENS_HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
process.env.CONTEXT_LENS_HOME = path.join(temporary, 'state');
process.env.CLAUDE_CONFIG_DIR = path.join(temporary, 'config');
mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
after(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(temporary, { recursive: true, force: true });
});
const at = '2026-10-20T10:00:00Z';
const model = 'claude-fable-5';
const usage = { input_tokens: 2000, cache_read_input_tokens: 96000, cache_creation_input_tokens: 2000, output_tokens: 10000 };
const assistant = (id = 'response', servedModel = model) => ({ type: 'assistant', timestamp: at,
  message: { id, model: servedModel, usage: { ...usage } } });
const live = id => ({ at: '2026-10-20T10:01:00Z', environment: {}, stdin: { session_id: id, model: { id: model },
  context_window: { context_window_size: 1000000, used_percentage: 10, current_usage: { ...usage } } } });
let sequence = 0;
async function snapshot({ events = [assistant()], options = {}, prepare } = {}) {
  const id = `percentage-${++sequence}`, root = path.join(temporary, id);
  mkdirSync(root);
  writeFileSync(path.join(root, `${id}.jsonl`), events.map(event => JSON.stringify({ cwd: root, sessionId: id, ...event })).join('\n') + '\n');
  const collector = new SessionCollector({ claude: root, codex: path.join(root, 'codex') });
  const file = collector.list()[0];
  prepare?.(id);
  return collector.snapshot(file, { ...options, ...(options.live ? { live: options.live(id) } : {}) });
}
const near = (actual, expected) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('采集器保存有限的原生百分比，拒绝非法值，不保存提示词', () => {
  const id = 'capture-percentage';
  for (const percent of [0, 12.5, 100]) {
    const data = live(id).stdin;
    data.context_window.used_percentage = percent;
    data.prompt = '不得写入计数文件';
    captureClaude(data);
    const saved = readLiveClaude({ client: 'claude', id });
    assert.equal(saved.stdin.context_window.used_percentage, percent);
    assert.equal(Object.hasOwn(saved.stdin, 'prompt'), false);
  }
  for (const percent of [-1, 100.1, NaN, Infinity, '12.5', null]) {
    const data = live(id).stdin;
    data.context_window.used_percentage = percent;
    captureClaude(data);
    assert.equal(Object.hasOwn(readLiveClaude({ client: 'claude', id }).stdin.context_window, 'used_percentage'), false);
  }
});

test('当前窗口占比不随压缩预算或分类视图改变', () => {
  for (const view of ['budget', 'model']) {
    const c = buildContext({ used: 100000, capacity: 1000000, view,
      budget: { tokens: 180000, source: 'fixture', accuracy: 'configured', scope: 'total' } });
    assert.equal(c.windowPercent, 10);
    near(c.percent, view === 'model' ? 10 : 100000 / 180000 * 100);
  }
  const body = buildContext({ used: 100000, capacity: 1000000,
    budget: { tokens: 180000, prefixTokens: 20000, source: 'fixture', accuracy: 'configured', scope: 'body_after_prefix' } });
  assert.equal(body.usedTokens, 80000);
  assert.equal(body.windowPercent, 10);
});

test('采集到快照的完整链路优先采用本会话原生占比', async () => {
  for (const view of ['budget', 'model']) {
    const value = await snapshot({ options: { view }, prepare: id => {
      const data = live(id).stdin; data.context_window.used_percentage = 12.5; captureClaude(data);
    } });
    assert.equal(value.context.windowPercent, 12.5);
    assert.equal(value.context.usedTokens, 100000);
    assert.equal(value.context.modelTokens, 1000000);
    assert.equal(value.context.budget.tokens, 967000);
    near(value.context.percent, view === 'model' ? 12.5 : 100000 / 967000 * 100);
  }
});

test('仅有可靠原生占比时保留百分比，不反推 token 数或窗口容量', async () => {
  const value = await snapshot({ options: { live: id => {
    const data = live(id); data.stdin.context_window = { used_percentage: 12.5, current_usage: null }; return data;
  } } });
  assert.equal(value.context.windowPercent, 12.5);
  assert.equal(value.context.usedTokens, null);
  assert.equal(value.context.modelTokens, null);
  assert.equal(value.context.budget.tokens, null);
});

test('无原生占比时以完整输入除以实际窗口，不累计历史、输出或压缩预算', async () => {
  const first = assistant('older'); first.message.usage.input_tokens = 500000;
  const value = await snapshot({ events: [first, assistant('latest')], options: { launch: { autoCompact: 180000 }, live: id => {
    const data = live(id); delete data.stdin.context_window.used_percentage; return data;
  } } });
  assert.equal(value.context.windowPercent, 10);
  assert.equal(value.context.usedTokens, 100000);
  assert.equal(value.context.modelTokens, 1000000);
  assert.ok(value.totals.main.input > value.context.usedTokens);
  near(value.context.percent, 100000 / 180000 * 100);
});

test('缺少当前窗口时即使存在已验证模型上限或手动预算也不猜测百分比', async () => {
  for (const servedModel of ['gemini-4-argon', 'gpt-6-astra', model]) {
    const value = await snapshot({ events: [assistant('mapped', servedModel)], options: { launch: { autoCompact: 180000 } } });
    assert.equal(value.session.model, servedModel);
    assert.equal(value.context.usedTokens, 100000);
    assert.equal(value.context.modelTokens, null);
    assert.equal(value.context.windowPercent, null);
    assert.equal(value.context.budget.tokens, 180000);
  }
});

test('过期或其他会话的原生百分比不能覆盖新请求', async () => {
  const stale = await snapshot({ options: { live: id => ({ ...live(id), at: '2026-10-20T09:00:00Z',
    stdin: { ...live(id).stdin, context_window: { ...live(id).stdin.context_window, used_percentage: 90 } } }) } });
  assert.equal(stale.context.windowPercent, 10);
  const foreign = await snapshot({ options: { live: () => live('another-session') } });
  assert.equal(foreign.context.windowPercent, null);
  assert.equal(foreign.context.modelTokens, null);
});

test('较旧实时记录不能覆盖更新的结构化上下文窗口', async () => {
  const value = await snapshot({ events: [assistant(), { type: 'system', subtype: 'local_command',
    timestamp: '2026-10-20T10:02:00Z', commandRun: { command: 'context' },
    contextUsage: { model, total_tokens: 100000, raw_max_tokens: 2000000, categories: [] } }], options: { live } });
  assert.equal(value.context.modelTokens, 2000000);
  assert.equal(value.context.windowPercent, 5);
});

test('零占位及非法原生百分比不能制造 0% 或覆盖有效输入', async () => {
  for (const percent of [0, -1, 100.1, NaN, Infinity, '20']) {
    const value = await snapshot({ options: { live: id => {
      const data = live(id); data.stdin.context_window.used_percentage = percent; return data;
    } } });
    assert.equal(value.context.windowPercent, 10);
  }
  for (const current_usage of [null, { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 }]) {
    const value = await snapshot({ options: { live: id => {
      const data = live(id); data.stdin.context_window.used_percentage = 0; data.stdin.context_window.current_usage = current_usage; return data;
    } } });
    assert.equal(value.context.windowPercent, null);
  }
});

test('压缩后的过期占比不会复活，下一次有效采样才更新读数', async () => {
  const value = await snapshot({ events: [assistant(), { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-20T10:02:00Z' }],
    options: { live } });
  assert.equal(value.context.usedTokens, null);
  assert.equal(value.context.windowPercent, null);
});
