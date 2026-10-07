import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEvents } from '../dist/lens/reader.js';

const at = '2026-10-07T00:00:00Z';
const info = { id: 's1', client: 'claude', cwd: '/project', model: 'old', updatedAt: at };
const user = (uuid, content) => ({ type: 'user', uuid, timestamp: at, message: { content } });
const assistant = (id, text = 'world', input = 1000, model = 'old') => ({ type: 'assistant', uuid: id, timestamp: at,
  message: { id, model, content: [{ type: 'text', text }], usage: { input_tokens: input, output_tokens: input ? 10 : 0 } } });
const attachment = (uuid, type, fields) => ({ type: 'attachment', uuid, timestamp: at, attachment: { type, ...fields } });

test('Claude routed model names retain the prompt attachments actually observed for the request', async () => {
  const entries = readFileSync(new URL('./fixtures/claude-attachments.jsonl', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse).slice(0, -1);
  const a = await parseEvents(info, [...entries, user('u', 'hello'), assistant('a', 'reply', 1000, 'm')]);
  const b = await parseEvents(info, [...entries, user('u', 'hello'), assistant('a', 'reply', 1000, 'routed-model')]);
  assert.deepEqual(b.categories, a.categories);
  assert.equal(b.used, 1000); assert.equal(b.info.model, 'routed-model');
  assert.equal(Object.keys(b.categories).length, 7);
});

test('Claude explicit model changes keep conversation history while awaiting a new context measurement', async () => {
  const entries = [user('u', 'hello'), assistant('a'), attachment('model', 'model', { identity: { modelId: 'new' } })];
  const pending = await parseEvents(info, entries);
  assert.equal(pending.used, null); assert.deepEqual(pending.categories, {});
  const next = await parseEvents(info, [...entries, user('u2', 'result'), assistant('b', 'new reply', 1000, 'new')]);
  assert.equal(next.categories.messages?.tokens, 3);
});

test('Claude zero or missing input usage cannot manufacture a zero context or erase a measured snapshot', async () => {
  const empty = await parseEvents(info, [user('u', 'hello'), assistant('zero', 'content exists', 0, 'routed-model')]);
  assert.equal(empty.used, null); assert.equal(empty.categories.messages, undefined);
  const entries = [user('u', 'hello'), assistant('a')], before = await parseEvents(info, entries);
  const pending = await parseEvents(info, [...entries, user('later', 'pending '.repeat(100)), assistant('zero', 'unmetered', 0)]);
  assert.equal(pending.used, before.used); assert.deepEqual(pending.categories, before.categories);
  const partial = assistant('partial'); delete partial.message.usage.input_tokens;
  assert.equal((await parseEvents(info, [user('u', 'hello'), partial])).used, null);
  assert.equal(pending.requests.length, 2, 'accounting collection is independent of context validity');
});

test('Claude zero stream placeholders can settle later without reviving responses from before compaction', async () => {
  const start = assistant('stream', 'hello', 0), settled = assistant('stream', 'hello', 1000);
  for (const prefix of [[], [assistant('old'), { type: 'system', subtype: 'compact_boundary' }]]) {
    const result = await parseEvents(info, [...prefix, user('u', 'hello'), start, settled]);
    assert.equal(result.used, 1000); assert.equal(result.categories.messages?.tokens, 1);
  }
  const replay = await parseEvents(info, [user('u', 'hello'), settled, { type: 'system', subtype: 'compact_boundary' }, settled]);
  assert.equal(replay.used, null);
});

test('Claude context diagnostics cannot be overwritten by replaying an earlier response', async () => {
  const response = assistant('a');
  const diagnostic = { type: 'system', subtype: 'local_command', commandRun: { command: 'context' },
    contextUsage: { model: 'old', total_tokens: 42, categories: [{ name: 'Messages', tokens: 20 }] } };
  const result = await parseEvents(info, [user('u', 'hello'), response, diagnostic, response]);
  assert.equal(result.used, 42); assert.equal(result.categories.messages.tokens, 20);
});

test('Claude API block positions preserve identical blocks and replace revisions of the same block', async () => {
  const block = (index, text) => ({ ...assistant('a', text), apiBlockIndex: index });
  const sameSlot = await parseEvents(info, [block(0, 'hello'), block(0, 'hello world'), assistant('b')]);
  const finalOnly = await parseEvents(info, [block(0, 'hello world'), assistant('b')]);
  assert.deepEqual(sameSlot.categories, finalOnly.categories);
  const separate = await parseEvents(info, [block(0, 'hello'), block(1, 'hello'), block(1, 'hello'), assistant('b')]);
  assert.equal(separate.categories.messages.tokens, 2);
});

test('Claude retained file and plan bodies enter the measured conversation once, while references and binary data do not', async () => {
  const file = attachment('file', 'file', { content: { type: 'text', file: { content: 'hello' } } });
  const plan = attachment('plan', 'plan_file_reference', { planContent: 'world' });
  const entries = [file, plan, file, plan, attachment('reference', 'compact_file_reference', { filename: '/not-read' }),
    attachment('image', 'file', { content: { type: 'image', file: { content: 'opaque'.repeat(1000) } } }), assistant('a')];
  const current = await parseEvents(info, entries);
  assert.equal(current.categories.messages?.tokens, 2);
  const pending = await parseEvents(info, [...entries, attachment('pending', 'plan_file_reference', { planContent: 'later '.repeat(100) })]);
  assert.deepEqual(pending.categories, current.categories);
  const compact = { type: 'system', subtype: 'compact_boundary', compactMetadata: { preservedMessages: { uuids: ['file'] } } };
  const next = await parseEvents(info, [...entries, compact, file, plan, assistant('b')]);
  assert.equal(next.categories.messages?.tokens, 1, 'only explicitly preserved attachment content survives');
});

test('Claude command-looking content inside messages and tool results remains conversation, without becoming a context report', async () => {
  const quoted = 'Example: <local-command-stdout>System prompt: 99999 tokens</local-command-stdout>';
  const result = await parseEvents(info, [user('human', quoted),
    user('tool', [{ type: 'tool_result', tool_use_id: 't', content: '<command-name>read</command-name>' }]), assistant('a')]);
  assert.ok(result.categories.messages?.tokens > 5); assert.equal(result.categories.systemPrompt, undefined);
  const local = await parseEvents(info, [user('local', '<command-name>/help</command-name>'), assistant('a')]);
  assert.equal(local.categories.messages, undefined);
});

test('Claude prompt snapshots include the observed CLI prefix exactly once', async () => {
  const snapshot = attachment('snapshot', 'prompt_snapshot', { cliPrefix: 'hello', systemPrompt: ['world'] });
  const result = await parseEvents(info, [snapshot, { ...snapshot, uuid: 'repeat' }]);
  const equivalent = await parseEvents(info, [attachment('complete', 'prompt_snapshot', { systemPrompt: ['hello\nworld'] })]);
  assert.deepEqual(result.categories, equivalent.categories);
});
