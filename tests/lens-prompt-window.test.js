import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvents } from '../dist/lens/reader.js';
import { buildContext } from '../dist/lens/context.js';

const at = '2026-10-07T00:00:00Z';
const info = { id: 'prompt-test', client: 'codex', model: 'model', cwd: '/project', updatedAt: at };
const message = (id, role, texts, kinds) => ({ type: 'response_item', timestamp: at, payload: {
  type: 'message', id, role, content: texts.map(text => ({ type: 'input_text', text })),
  ...(kinds ? { internal_chat_message_metadata_passthrough: { content_item_kinds: kinds } } : {}),
} });
const usage = id => ({ type: 'token_usage_record', timestamp: at, payload: { thread_id: info.id, response_id: id, usage: { input_tokens: 1000, output_tokens: 10 } } });
const assistant = (id, text, uuid = id) => ({ type: 'assistant', uuid, timestamp: at, message: { id, model: 'model', content: [{ type: 'text', text }], usage: { input_tokens: 1000, output_tokens: 10 } } });
const user = (uuid, text) => ({ type: 'user', uuid, timestamp: at, message: { content: text } });

test('Codex messages, tool calls and array outputs are classified as conversation, without images or encrypted bytes', async () => {
  const entries = [message('u', 'user', ['hello']), message('a', 'assistant', ['world']),
    { type: 'response_item', payload: { type: 'function_call', id: 'call', call_id: 'c', name: 'tool', arguments: '{"x":1}' } },
    { type: 'response_item', payload: { type: 'function_call_output', id: 'output', call_id: 'c', output: [{ type: 'input_text', text: 'result' }] } }, usage('r')];
  const parsed = await parseEvents(info, entries);
  assert.ok(parsed.categories.messages.tokens > 2);
  assert.equal(parsed.categories.messages.accuracy, 'estimated');
  assert.equal(parsed.used, 1010); assert.equal(parsed.requests.length, 1);
  const duplicate = await parseEvents(info, [...entries.slice(0, -1), ...entries,
    { type: 'response_item', payload: { type: 'reasoning', id: 'secret', encrypted_content: 'opaque'.repeat(10000), summary: [] } },
    { type: 'response_item', payload: { type: 'message', id: 'image', role: 'user', content: [{ type: 'input_image', image_url: 'data:opaque'.repeat(10000) }] } }, usage('r2')]);
  assert.equal(duplicate.categories.messages.tokens, parsed.categories.messages.tokens);
  const context = buildContext({ used: parsed.used, capacity: 2000, budget: { tokens: 2000, scope: 'total', accuracy: 'reported', source: 'test' }, categories: parsed.categories });
  assert.equal(context.segments.find(s => s.id === 'unclassified').tokens, parsed.used - parsed.categories.messages.tokens);
});

test('loaded instruction kinds have separate categories and world snapshots replace duplicated skill and AGENTS text', async () => {
  const entries = [message('prefix', 'developer', ['system rule', 'hello', 'world'], ['generic.developer_instructions', 'memories.instructions', 'host_skills.instructions']),
    message('agents', 'user', ['hello', 'environment'], ['agents_md.instructions', 'environments.environment_context']),
    { type: 'world_state', payload: { full: true, state: { agents_md: { text: 'hello' }, host_skills: { body: 'world', includeInstructions: true }, installed_tools: ['mcp__unused__tool'] } } },
    message('human', 'user', ['hi']), usage('r')];
  const parsed = await parseEvents(info, entries);
  assert.ok(parsed.categories.systemPrompt.tokens > 1); assert.equal(parsed.categories.memoryFiles.tokens, 2);
  assert.equal(parsed.categories.skills.tokens, 1); assert.equal(parsed.categories.messages.tokens, 1);
  assert.equal(parsed.categories.mcpTools, undefined); assert.equal(parsed.categories.systemTools, undefined);
  assert.deepEqual((await parseEvents(info, [...entries.slice(0, -1), ...entries])).categories, parsed.categories);
  const added = await parseEvents(info, [...entries.slice(0, -1), message('second-prefix', 'developer', ['hello'], ['generic.developer_instructions']), usage('extra')]);
  assert.equal(added.categories.systemPrompt.tokens, parsed.categories.systemPrompt.tokens + 1, 'separate retained developer instructions coexist');
});

test('Codex compaction rebuilds only explicit replacement history; old history and replays cannot inflate the current window', async () => {
  const old = message('old', 'user', ['discard '.repeat(1000)]), prefix = message('prefix', 'developer', ['old rule'], ['generic.developer_instructions']);
  const legacyPrefix = message('legacy-prefix', 'user', ['# AGENTS.md instructions for /project\nold rules']);
  const keep = message('keep', 'user', ['hello']);
  const compact = { type: 'compacted', timestamp: at, payload: { message: '', replacement_history: [keep.payload, { type: 'compaction', encrypted_content: 'opaque' }] } };
  const entries = [old, prefix, legacyPrefix, keep, usage('before'), compact, message('new', 'assistant', ['world']), usage('after')];
  const parsed = await parseEvents(info, entries);
  assert.equal(parsed.categories.messages.tokens, 2); assert.equal(parsed.categories.systemPrompt, undefined);
  const replay = await parseEvents(info, [...entries, old, prefix, legacyPrefix, usage('final')]);
  assert.equal(replay.categories.messages.tokens, 2); assert.equal(replay.categories.systemPrompt, undefined); assert.equal(replay.categories.memoryFiles, undefined);
  const summary = message('summary', 'assistant', ['summary']);
  const summaryOnce = await parseEvents(info, [{ type: 'compacted', payload: { message: 'summary', replacement_history: [summary.payload] } }, usage('summary-request')]);
  assert.equal(summaryOnce.categories.messages.tokens, 1);
  assert.deepEqual((await parseEvents(info, [...entries, { type: 'compacted', payload: {} }])).categories, {});
});

test('pending contents after the last reported context size do not advance the measured category snapshot', async () => {
  const entries = [message('u', 'user', ['hello']), usage('r')];
  const first = await parseEvents(info, entries);
  const pending = await parseEvents(info, [...entries, message('pending', 'user', ['not sent '.repeat(1000)])]);
  assert.equal(pending.categories.messages.tokens, first.categories.messages.tokens);
  assert.equal(pending.used, first.used); assert.equal(pending.categories.messages.at, first.at);
});

test('Codex model changes keep the replacement history and fresh instructions emitted before turn_context', async () => {
  const keep = message('retained', 'user', ['hello']);
  const entries = [
    { type: 'turn_context', payload: { model: 'old-model' } },
    message('discarded', 'user', ['old conversation '.repeat(100)]), usage('before'),
    { type: 'compacted', payload: { replacement_history: [keep.payload, { type: 'compaction', encrypted_content: 'opaque' }] } },
    message('new-prefix', 'developer', ['rule', 'memory', 'skill'], ['model_switch.instructions', 'memories.instructions', 'host_skills.instructions']),
    { type: 'world_state', payload: { full: true, state: { agents_md: { text: 'agents' }, host_skills: { body: 'skill', includeInstructions: true } } } },
    { type: 'turn_context', payload: { model: 'new-model' } }, usage('after'),
  ];
  const parsed = await parseEvents(info, entries);
  assert.equal(parsed.categories.systemPrompt?.tokens, 1);
  assert.equal(parsed.categories.memoryFiles?.tokens, 2);
  assert.equal(parsed.categories.skills?.tokens, 1);
  assert.equal(parsed.categories.messages?.tokens, 1, 'only the explicitly retained conversation survives compaction');
  assert.equal(parsed.used, 1010);
  assert.deepEqual(parsed.requests.map(row => row.model), ['old-model', 'new-model']);
  assert.equal(parsed.categories.mcpTools, undefined, 'opaque compaction content is not a tool definition');
});

test('Codex model changes without compaction preserve the measured window and carried conversation', async () => {
  const entries = [{ type: 'turn_context', payload: { model: 'old-model' } },
    message('u', 'user', ['hello']), message('a', 'assistant', ['world']), usage('before')];
  const before = await parseEvents(info, entries);
  const change = { type: 'turn_context', payload: { model: 'new-model' } };
  const pending = await parseEvents(info, [...entries, change, message('unsent', 'user', ['pending '.repeat(100)])]);
  assert.deepEqual(pending.categories, before.categories, 'changing models does not erase the last measured categories');
  assert.equal(pending.used, before.used);
  const after = await parseEvents(info, [...entries, change, message('next', 'user', ['result']), usage('after')]);
  assert.equal(after.categories.messages?.tokens, 3);
});

test('Claude input classification excludes the response currently being generated, and replayed response blocks are deduplicated', async () => {
  const claude = { ...info, client: 'claude' };
  const first = await parseEvents(claude, [user('u', 'hello'), assistant('a', 'long output '.repeat(100))]);
  assert.equal(first.categories.messages.tokens, 1);
  const entries = [user('u', 'hello'), assistant('a', 'world'), assistant('a', 'world', 'a-mirror'),
    { type: 'user', uuid: 'result', message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: [{ type: 'text', text: 'result' }] }] } }, assistant('b', 'current output')];
  const second = await parseEvents(claude, entries);
  assert.equal(second.categories.messages.tokens, 3); assert.equal(second.requests.length, 2);
  assert.equal((await parseEvents(claude, [...entries, ...entries])).categories.messages.tokens, 3);
});

test('Claude diagnostics remain authoritative; compaction retains only explicitly preserved messages and the new summary', async () => {
  const claude = { ...info, client: 'claude' };
  const diagnostic = { type: 'system', subtype: 'local_command', commandRun: { command: 'context' }, contextUsage: { model: 'model', total_tokens: 1000, categories: [{ name: 'Conversation', tokens: 800 }] } };
  const before = [user('u', 'hello'), assistant('a', 'world')];
  const exact = await parseEvents(claude, [...before, diagnostic, ...before]);
  assert.equal(exact.categories.messages.tokens, 800); assert.equal(exact.categories.messages.accuracy, 'reported');
  const after = await parseEvents(claude, [...before, { type: 'system', subtype: 'compact_boundary', compactMetadata: { preservedMessages: { uuids: ['u'] } } },
    { ...user('summary', 'summary'), isCompactSummary: true }, assistant('b', 'reply')]);
  assert.equal(after.categories.messages.tokens, 2); assert.equal(after.used, 1000);
});

test('foreign threads, child inherited history and usage-only scans cannot manufacture classified prompt contents', async () => {
  const foreign = { ...message('foreign', 'user', ['other '.repeat(1000)]), payload: { ...message('foreign', 'user', ['other '.repeat(1000)]).payload, thread_id: 'other' } };
  const child = { ...info, parentId: 'parent' };
  const parsed = await parseEvents(child, [message('inherited', 'user', ['copied '.repeat(1000)]),
    { type: 'session_meta', timestamp: at, payload: { id: info.id, timestamp: at } }, { type: 'turn_context', payload: { model: 'model' } }, foreign,
    message('own', 'user', ['hello']), usage('r')]);
  assert.equal(parsed.categories.messages.tokens, 1);
  assert.deepEqual((await parseEvents(info, [message('u', 'user', ['hello']), usage('r')], { usageOnly: true })).categories, {});
});
