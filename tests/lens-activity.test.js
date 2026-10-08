import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseEvents, readSession } from '../dist/lens/reader.js';
import { summarizeActivity } from '../dist/lens/activity.js';
import { SessionCollector } from '../dist/lens/snapshot.js';
import { mkdirSync } from 'node:fs';

const info = { id: 'activity-session', client: 'codex', cwd: '/project', model: 'm', updatedAt: '2026-10-07T00:00:00Z' };
const native = (item, extra = {}) => ({ timestamp: info.updatedAt, type: 'event_msg', payload: { type: 'item_completed', thread_id: info.id, item, ...extra } });
const command = (id, extra = {}) => native({ type: 'CommandExecution', id, command: ['/bin/zsh', '-lc', 'node check.js'], status: 'completed', exit_code: 0, duration: { secs: 1, nanos: 250000000 }, ...extra });
const mcp = (id, extra = {}) => native({ type: 'McpToolCall', id, server: 'hub', tool: 'call_tool', arguments: { server: 'codegraph', tool: 'codegraph_explore', args: {} }, status: 'completed', result: { content: [] }, duration: { secs: 0, nanos: 500000000 }, ...extra });
const response = payload => ({ timestamp: info.updatedAt, type: 'response_item', payload });
const fn = (call_id, name, args = {}) => response({ type: 'function_call', call_id, name, arguments: JSON.stringify(args) });
const output = (call_id, output) => response({ type: 'function_call_output', call_id, output });
async function stats(events, session = info) { return summarizeActivity((await parseEvents(session, events)).activity); }

test('native commands and nested MCP execution are counted once, independently of source code and replay', async () => {
  const entries = [response({ type: 'custom_tool_call', name: 'exec', call_id: 'wrapper', input: 'await tools.exec_command({cmd:"never infer this"});' }),
    command('a'), command('b', { command: ['/bin/zsh', '-lc', 'npm test'], exit_code: 1, status: 'failed' }), mcp('c')];
  const actual = await stats([...entries, ...entries]);
  assert.equal(actual.commands.total, 2); assert.equal(actual.commands.succeeded, 1); assert.equal(actual.commands.failed, 1);
  assert.equal(actual.commands.durationMs, 2500); assert.equal(actual.commands.durationComplete, true);
  assert.equal(actual.mcp.total, 1); assert.equal(actual.mcp.groups[0].name, 'codegraph'); assert.equal(actual.mcp.groups[0].detail, 'codegraph_explore');
  assert.equal(actual.complete, true);
});
test('native results supersede response mirrors; rejected and structured MCP failures remain failures', async () => {
  const actual = await stats([fn('cmd', 'exec_command', { cmd: 'node check.js' }), command('cmd'), output('cmd', 'unstructured text'),
    mcp('bad', { result: { content: [{ type: 'text', text: '{"ok":false,"error":{"code":"unavailable"}}' }] } }),
    mcp('reject', { status: 'failed' }), mcp('running', { status: 'inProgress', duration: undefined })]);
  assert.equal(actual.commands.total, 1); assert.equal(actual.commands.succeeded, 1); assert.equal(actual.commands.durationMs, 1250);
  assert.equal(actual.mcp.failed, 2); assert.equal(actual.mcp.running, 1); assert.equal(actual.mcp.durationComplete, false);
});
test('only successful structured SKILL.md reads count as reads; tool catalogs, searches and prose do not', async () => {
  const parsed_cmd = [{ type: 'read', path: '/project/.agents/skills/oil-ui/SKILL.md' }, { type: 'read', path: '/project/.agents/skills/oil-ui/SKILL.md' },
    { type: 'search', path: '/project/.agents/skills/unused/SKILL.md' }];
  const actual = await stats([command('read', { parsed_cmd }), command('failed-read', { exit_code: 1, parsed_cmd }),
    response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Using Skill demo and MCP search' }] }),
    { type: 'world_state', payload: { state: { host_skills: { includeInstructions: false, body: 'Installed skill catalog' } } } }]);
  assert.equal(actual.skills.total, 1); assert.equal(actual.skills.reads, 1); assert.equal(actual.skills.invoked, 0);
  assert.equal(actual.skills.groups[0].name, 'oil-ui'); assert.equal(actual.skills.durationMs, null);
});
test('Claude Skill, Read, Bash and MCP blocks retain separate actions and statuses', async () => {
  const assistant = content => ({ type: 'assistant', message: { content } });
  const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const result = (id, is_error = false, content = 'done') => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content }] } });
  const entries = [assistant([tool('skill', 'Skill', { skill: 'oil-ui' }), tool('read', 'Read', { file_path: '/skills/oil-ui/SKILL.md' }),
    tool('bash', 'Bash', { command: 'npm test' }), tool('mcp', 'mcp__hub__call_tool', { server: 'serena', tool: 'find_symbol' })]),
    result('skill'), result('read'), result('bash'), result('mcp', true)];
  const actual = await stats([...entries, ...entries], { ...info, client: 'claude' });
  assert.equal(actual.skills.total, 2); assert.equal(actual.skills.invoked, 1); assert.equal(actual.skills.reads, 1);
  assert.equal(actual.commands.succeeded, 1); assert.equal(actual.mcp.failed, 1); assert.equal(actual.mcp.groups[0].name, 'serena');
});
test('long command polling updates the original execution instead of incrementing totals', async () => {
  const actual = await stats([fn('start', 'exec_command', { cmd: 'node long.js' }), output('start', JSON.stringify({ session_id: 123 })),
    fn('poll', 'write_stdin', { session_id: 123 }), output('poll', JSON.stringify({ exit_code: 2, wall_time_seconds: 2 })),
    fn('pending', 'shell_command', { command: 'python task.py' })]);
  assert.equal(actual.commands.total, 2); assert.equal(actual.commands.failed, 1); assert.equal(actual.commands.running, 1);
  assert.equal(actual.commands.recent.find(c => c.name === 'node').exitCode, 2);
  assert.equal(actual.commands.recent.find(c => c.name === 'node').durationMs, null, 'poll wait time is not execution runtime');
});
test('thread ownership and inherited records cannot inflate parent/agent totals', async () => {
  const main = (await parseEvents(info, [command('shared'), mcp('foreign', {}, { thread_id: 'other' })])).activity;
  const child = (await parseEvents({ ...info, id: 'child', parentId: info.id }, [
    fn('inherited', 'exec_command', { cmd: 'node inherited.js' }), command('shared'),
    { type: 'turn_context', payload: { model: 'm' } }, native({ type: 'CommandExecution', id: 'child-own', command: ['rg', 'hello'], exit_code: 0, status: 'completed' }, { thread_id: 'child' }),
  ])).activity;
  const actual = summarizeActivity(main, [child]);
  assert.equal(actual.commands.total, 2); assert.equal(actual.commands.main, 1); assert.equal(actual.commands.agents, 1);
  const wrong = await stats([native({ type: 'McpToolCall', id: 'foreign', server: 'remote', tool: 'get', status: 'completed' }, { thread_id: 'other' })]);
  assert.equal(wrong.mcp.total, 0);
});
test('history counters retain all calls while the recent list is bounded; compaction does not reset execution history', async () => {
  const entries = Array.from({ length: 85 }, (_, i) => command('cmd-' + i));
  const actual = await stats([...entries, { type: 'compacted', payload: {} }]);
  assert.equal(actual.commands.total, 85); assert.equal(actual.commands.recent.length, 60); assert.equal(actual.commands.groups[0].total, 85);
  const wrapped = await stats([response({ type: 'custom_tool_call', name: 'exec', input: 'text("tools.exec_command({})")' })]);
  assert.equal(wrapped.commands.total, 0); assert.equal(wrapped.complete, false);
});
test('malformed logs mark activity incomplete and usage-only scans omit activity work', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'lens-activity-test-'));
  try {
    const file = path.join(home, 'log.jsonl'); writeFileSync(file, JSON.stringify(command('a')) + '\n{broken\n');
    const parsed = await readSession(file, info); assert.equal(parsed.activity.complete, false);
    assert.equal((await parseEvents(info, [command('a')], { usageOnly: true })).activity, undefined);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('snapshot collector exposes parent/agent execution totals and marks an observed truncation incomplete', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-activity-snapshot-'));
  const previous = process.env.CONTEXT_LENS_HOME; process.env.CONTEXT_LENS_HOME = path.join(dir, 'state');
  try {
    const root = path.join(dir, 'claude'), sub = path.join(root, 'project/main/subagents'); mkdirSync(sub, { recursive: true });
    const file = path.join(root, 'project/main.jsonl');
    const event = id => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'node check.js' } }] } });
    const result = id => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: false }] } });
    writeFileSync(file, [event('shared'), result('shared'), event('main-second'), result('main-second')].map(JSON.stringify).join('\n'));
    writeFileSync(path.join(sub, 'agent-child.jsonl'), [event('shared'), result('shared'), event('child'), result('child')].map(JSON.stringify).join('\n'));
    const collector = new SessionCollector({ claude: root, codex: path.join(dir, 'codex') });
    const value = await collector.get('claude:main');
    assert.equal(value.activity.commands.total, 3); assert.equal(value.activity.commands.main, 2); assert.equal(value.activity.commands.agents, 1);
    assert.equal(value.activity.commands.succeeded, 3);
    writeFileSync(file, JSON.stringify(event('third')));
    const truncated = await collector.get('claude:main'); assert.equal(truncated.activity.complete, false);
  } finally {
    if (previous === undefined) delete process.env.CONTEXT_LENS_HOME; else process.env.CONTEXT_LENS_HOME = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
