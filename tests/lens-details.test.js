import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseEvents, readSession } from '../dist/lens/reader.js';
import { SessionCollector } from '../dist/lens/snapshot.js';
import { startServer } from '../dist/lens/server.js';
import { summarizeDetails } from '../dist/lens/claude-details.js';
import { buildSessionDetails, validateDetailQuery } from '../dist/lens/session-details.js';

const at = '2026-10-07T01:00:00.000Z';
const info = { id: 'main', client: 'claude', cwd: '/project', model: 'm', updatedAt: at };
const usage = { input_tokens: 50000, output_tokens: 10, cache_read_input_tokens: 0 };
const assistant = (id, content = [{ type: 'text', text: 'reply' }]) => ({ type: 'assistant', uuid: id, cwd: '/project', timestamp: at, message: { id, model: 'm', usage, content } });
const tool = (id, name, input) => assistant(id, [{ type: 'tool_use', id, name, input }]);
const result = (id, data = {}, failed = false) => ({ type: 'user', uuid: 'result-' + id, cwd: '/project', timestamp: at,
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: failed, content: 'result text' }] }, toolUseResult: data });
const attachment = (id, type, data = {}) => ({ type: 'attachment', uuid: id, cwd: '/project', timestamp: at, attachment: { type, ...data } });

test('message details partition the measured window exactly and follow replay, compaction and diagnostics', async () => {
  const user = { type: 'user', uuid: 'u', timestamp: at, message: { content: 'question' } };
  const file = attachment('file', 'file', { content: { type: 'text', file: { content: 'file text' } } });
  const events = [user, file, attachment('plan', 'plan_file_reference', { planContent: 'plan text' }),
    assistant('a', [{ type: 'text', text: 'answer' }, { type: 'thinking', thinking: 'visible reasoning' },
      { type: 'redacted_thinking', data: 'encrypted data' }, { type: 'tool_use', id: 't', name: 'Read', input: { file_path: '/f' } }]),
    result('t'), assistant('measure')];
  const parsed = await parseEvents(info, [...events, events[3]]);
  assert.deepEqual(new Set(parsed.messageBreakdown.map(v => v.id)), new Set(['user', 'file', 'plan', 'assistant', 'thinking', 'toolCall', 'toolResult']));
  assert.equal(parsed.messageBreakdown.reduce((sum, value) => sum + value.tokens, 0), parsed.categories.messages.tokens);
  const compact = { type: 'system', uuid: 'compact', subtype: 'compact_boundary', timestamp: at,
    compactMetadata: { preservedMessages: { uuids: ['file'] } } };
  const after = await parseEvents(info, [...events, compact, file, assistant('next')]);
  assert.deepEqual(after.messageBreakdown.map(v => v.id), ['file']);
  assert.equal(after.messageBreakdown[0].tokens, after.categories.messages.tokens);
  const diagnostic = { type: 'system', subtype: 'local_command', commandRun: { command: 'context' },
    contextUsage: { total_tokens: 50, categories: [{ name: 'Messages', tokens: 25 }] } };
  const exact = await parseEvents(info, [...events, diagnostic]);
  assert.equal(exact.categories.messages.tokens, 25); assert.deepEqual(exact.messageBreakdown, []);
});

test('compactions retain actual before/after counters, preserve unknowns and do not count replay twice', async () => {
  const entry = { type: 'system', subtype: 'compact_boundary', uuid: 'c', timestamp: at,
    compactMetadata: { trigger: 'manual', preTokens: 100, postTokens: 30, durationMs: 0, cumulativeDroppedTokens: 70,
      preservedMessages: { uuids: ['short'], allUuids: ['a', 'b', 'a'] } } };
  const parsed = await parseEvents(info, [entry, entry, { type: 'system', subtype: 'compact_boundary', uuid: 'unknown' }]);
  assert.equal(parsed.details.compactions.length, 2);
  assert.equal(parsed.details.compactions[0].releasedTokens, 70);
  assert.equal(parsed.details.compactions[0].retainedMessages, 2);
  assert.equal(parsed.details.compactions[0].durationMs, 0);
  assert.equal(parsed.details.compactions[1].at, null);
  assert.equal(parsed.details.compactions[1].releasedTokens, null);
});

test('hook calls and stop summaries are separate, deduplicated, and exclude command/output bodies', async () => {
  const success = attachment('h', 'hook_success', { hookName: 'check', hookEvent: 'PreToolUse', toolUseID: 't', exitCode: 0, durationMs: 0,
    command: 'SECRET_COMMAND', stdout: 'SECRET_OUTPUT', stderr: 'SECRET_ERROR', content: 'SECRET_CONTENT' });
  const error = attachment('err', 'hook_non_blocking_error', { hookName: 'check', hookEvent: 'PostToolUse', exitCode: 2, durationMs: 12 });
  const parsed = await parseEvents(info, [success, success, error,
    { type: 'system', uuid: 'stop', timestamp: at, subtype: 'stop_hook_summary', hookCount: 2, hookErrors: ['SECRET_ERROR'], preventedContinuation: true }]);
  assert.equal(parsed.details.hooks.length, 2); assert.equal(parsed.details.hookStops.length, 1);
  assert.equal(JSON.stringify(parsed.details).includes('SECRET_'), false);
  assert.deepEqual(summarizeDetails(parsed.details).hooks, { total: 2, failed: 1, durationMs: 12, durationComplete: true, blockedStops: 1 });
});

test('file statistics come from confirmed patches, not requested edits or failed results', async () => {
  const patch = [{ lines: [' keep', '-old', '+new', '+extra'] }];
  const events = [tool('read', 'Read', { file_path: '/a' }), result('read'),
    tool('edit', 'Edit', { file_path: '/a', old_string: 'SECRET_OLD', new_string: 'SECRET_NEW' }), result('edit', { structuredPatch: patch }),
    tool('write', 'Write', { file_path: '/new' }), result('write', { type: 'create', content: 'first\nsecond\n' }),
    tool('bad', 'Edit', { file_path: '/a' }), result('bad', { structuredPatch: patch }, true),
    tool('pending', 'Write', { file_path: '/pending', content: 'not written' })];
  const { details } = await parseEvents(info, [...events, events[2], events[3]]);
  assert.equal(details.files.length, 5);
  assert.deepEqual(details.files.map(f => [f.id, f.status, f.addedLines, f.removedLines]), [
    ['read', 'succeeded', null, null], ['edit', 'succeeded', 2, 1], ['write', 'succeeded', 2, 0],
    ['bad', 'failed', null, null], ['pending', 'running', null, null],
  ]);
  assert.equal(JSON.stringify(details).includes('SECRET_'), false);
});

test('a batch result never assigns its one top-level patch to several files', async () => {
  const batch = { type: 'user', timestamp: at, toolUseResult: { structuredPatch: [{ lines: ['+line'] }] },
    message: { content: ['a', 'b'].map(id => ({ type: 'tool_result', tool_use_id: id, content: 'done' })) } };
  const parsed = await parseEvents(info, [tool('a', 'Edit', { file_path: '/a' }), tool('b', 'Edit', { file_path: '/b' }), batch]);
  assert.deepEqual(parsed.details.files.map(f => f.addedLines), [null, null]);
});

test('task state changes require successful results, failed and repeated updates cannot change completed work', async () => {
  const create = tool('create', 'TaskCreate', { subject: 'Check code' }), created = result('create', { task: { id: '7', subject: 'Check code', status: 'pending' } });
  const update = tool('update', 'TaskUpdate', { taskId: '7', status: 'completed' }), updated = result('update');
  const { details } = await parseEvents(info, [create, created, update, updated, update, updated,
    tool('bad', 'TaskUpdate', { taskId: '7', status: 'pending' }), result('bad', {}, true),
    tool('unconfirmed', 'TaskCreate', { subject: 'No result' })]);
  assert.equal(details.tasks.length, 1); assert.equal(details.tasks[0].id, '7'); assert.equal(details.tasks[0].status, 'completed');
  const todo = await parseEvents(info, [tool('todos', 'TodoWrite', { todos: [{ content: 'One', status: 'in_progress' }, { content: 'Two', status: 'completed' }] }), result('todos')]);
  assert.equal(summarizeDetails(todo.details).tasks.inProgress, 1);
});

test('async agent launch stays running until an explicit completion and uses the resolved model', async () => {
  const call = tool('agent', 'Agent', { description: 'Inspect tests', model: 'alias', run_in_background: true });
  const launch = result('agent', { agentId: 'child', isAsync: true, status: 'async_launched', resolvedModel: 'actual' });
  const initial = await parseEvents(info, [call, launch, call, launch]);
  assert.equal(initial.details.agents.length, 1); assert.equal(initial.details.agents[0].status, 'running');
  const done = { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-07T02:00:00Z',
    content: '<task-id>child</task-id><tool-use-id>agent</tool-use-id><status>completed</status>' };
  const parsed = await parseEvents(info, [call, launch, done, launch,
    attachment('old-status', 'task_status', { taskId: 'child', taskType: 'local_agent', status: 'running' })]);
  assert.equal(parsed.details.agents[0].status, 'succeeded'); assert.equal(parsed.details.agents[0].model, 'actual');
});

test('sidechain and other-session events do not enter parent details; absent categories remain absent', async () => {
  const hook = attachment('h', 'hook_success', { hookName: 'x' });
  const parsed = await parseEvents(info, [{ ...hook, isSidechain: true }, { ...hook, sessionId: 'another' }]);
  assert.deepEqual(summarizeDetails(parsed.details), { scope: 'main', complete: true });
  const only = await parseEvents(info, [hook], { usageOnly: true }); assert.equal(only.details, undefined);
});

test('detail query rejects invalid filters and pagination', () => {
  for (const query of [{ section: 'x' }, { page: 0 }, { page: 1.1 }, { pageSize: 101 }, { scope: 'unknown' },
    { sort: 'cost', section: 'hooks' }, { sort: 'duration', section: 'files' }, { kind: 'shell' }, { status: 'failed', section: 'requests' }]) assert.throws(() => validateDetailQuery(query));
});

test('legacy cumulative counters cannot be presented as a complete empty request history', async () => {
  const file = { ...info, client: 'codex', file: '/unused.jsonl' };
  const parsed = await parseEvents(file, [{ type: 'turn_context', payload: { model: 'm' } },
    { type: 'event_msg', timestamp: at, payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 0 },
      last_token_usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 0 },
    } } }]);
  const requests = buildSessionDetails('codex:main', [{ file, parsed }], { currency: 'USD', prices: {} });
  assert.equal(requests.total, 0); assert.equal(requests.complete, false);
  const hooks = buildSessionDetails('codex:main', [{ file, parsed }], { currency: 'USD', prices: {} }, { section: 'hooks' });
  assert.equal(hooks.supported, false); assert.equal(hooks.complete, false);
});

test('unknown request timestamps and task statuses are not replaced with invented values', async () => {
  const noDate = assistant('a'); delete noDate.timestamp;
  const parsed = await parseEvents(info, [noDate, tool('new-task', 'TaskCreate', { subject: 'Unreported status' }), result('new-task', { taskId: '9' })]);
  assert.equal(parsed.details.tasks[0].status, 'unknown');
  const data = buildSessionDetails('claude:main', [{ file: { ...info, file: '/unused.jsonl' }, parsed }], { currency: 'USD', prices: {} });
  assert.equal(data.items.find(row => row.id === 'claude:a').at, null);
});

test('malformed and truncated logs mark execution details incomplete', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-detail-partial-')), old = process.env.CONTEXT_LENS_HOME;
  process.env.CONTEXT_LENS_HOME = path.join(dir, 'state');
  try {
    const file = path.join(dir, 'main.jsonl');
    writeFileSync(file, JSON.stringify(tool('t', 'Read', { file_path: '/a' })) + '\n{broken\n');
    assert.equal((await readSession(file, info)).details.complete, false);
    writeFileSync(file, [tool('t', 'Read', { file_path: '/a' }), result('t')].map(JSON.stringify).join('\n'));
    const collector = new SessionCollector({ claude: dir, codex: path.join(dir, 'none') });
    assert.equal((await collector.get('claude:main')).insights.complete, true);
    writeFileSync(file, JSON.stringify(attachment('h', 'hook_success', { hookName: 'x' })));
    assert.equal((await collector.get('claude:main')).insights.complete, false);
    const restarted = new SessionCollector({ claude: dir, codex: path.join(dir, 'none') });
    const snapshot = await restarted.get('claude:main');
    assert.equal(snapshot.insights.complete, false, 'restored request counters do not restore lost execution records');
    assert.equal(snapshot.activity.complete, false); assert.equal(snapshot.totals.main.requests, 1);
  } finally { if (old === undefined) delete process.env.CONTEXT_LENS_HOME; else process.env.CONTEXT_LENS_HOME = old; rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP details expose full paged history and deduplicated request costs with explicit agent linkage', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-detail-http-')), old = process.env.CONTEXT_LENS_HOME;
  process.env.CONTEXT_LENS_HOME = path.join(dir, 'state');
  const root = path.join(dir, 'logs'), sub = path.join(root, 'main/subagents'); mkdirSync(sub, { recursive: true });
  const events = [];
  for (let i = 0; i < 65; i++) { events.push(tool('t' + i, 'Bash', { command: 'pwd' }), result('t' + i)); }
  events.push(tool('a', 'Agent', { description: 'Inspect', run_in_background: true }), result('a', { agentId: 'child', isAsync: true, resolvedModel: 'm' }));
  writeFileSync(path.join(root, 'main.jsonl'), events.map(JSON.stringify).join('\n'));
  writeFileSync(path.join(sub, 'agent-child.jsonl'), [events[0], assistant('child-own')].map(JSON.stringify).join('\n'));
  mkdirSync(path.join(dir, 'state')); writeFileSync(path.join(dir, 'state/config.json'), JSON.stringify({ currency: 'USD', prices: { m: { input: 1, output: 2 } } }));
  const collector = new SessionCollector({ claude: root, codex: path.join(dir, 'none') });
  const { server, url } = await startServer({ port: 0, pricingRefresh: false, collector });
  const get = async query => { const response = await fetch(`${url}/api/details?session=claude%3Amain&${query}`); assert.equal(response.status, 200); return response.json(); };
  try {
    const snapshot = await collector.get('claude:main');
    const calls = await get('section=activity&kind=commands&scope=main&pageSize=50');
    assert.equal(calls.total, 65); assert.equal(calls.items.length, 50); assert.equal(calls.pages, 2);
    const next = await get('section=activity&kind=commands&scope=main&pageSize=50&page=2');
    assert.equal(next.items.length, 15); assert.equal(new Set([...calls.items, ...next.items].map(v => v.id)).size, 65);
    const requests = await get('section=requests&pageSize=100');
    assert.equal(requests.total, snapshot.totals.all.requests); assert.equal(requests.total, 67);
    assert.ok(Math.abs(requests.items.reduce((sum, item) => sum + item.cost.amount, 0) - snapshot.cost.amount) < 1e-9);
    const child = await get('section=requests&scope=agents'); assert.equal(child.total, 1); assert.equal(child.items[0].id, 'claude:child-own');
    const agents = await get('section=agents&scope=main'); assert.equal(agents.total, 1);
    assert.equal(agents.items[0].childSessionKey, 'claude:main_agent-child'); assert.equal(agents.items[0].totals.requests, 1);
    assert.equal((await fetch(`${url}/api/details?session=../../secret`)).status, 400);
    assert.equal((await fetch(`${url}/api/details?session=claude:missing`)).status, 404);
    assert.equal((await fetch(`${url}/api/details?session=claude:main&pageSize=10000`)).status, 400);
    assert.equal((await fetch(`${url}/api/details?session=claude:main`, { headers: { Origin: 'https://other.example' } })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); if (old === undefined) delete process.env.CONTEXT_LENS_HOME; else process.env.CONTEXT_LENS_HOME = old; rmSync(dir, { recursive: true, force: true }); }
});
