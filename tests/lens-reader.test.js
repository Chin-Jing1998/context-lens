import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvents } from '../dist/lens/reader.js';

const info = { id: 's1', client: 'claude', cwd: '/project', model: 'm', updatedAt: '2026-10-05T00:00:00Z' };
const assistant = (id, input = 100) => ({ type: 'assistant', message: { id, model: 'm', usage: { input_tokens: input, output_tokens: 10, cache_read_input_tokens: 0 } } });
test('Claude replay is deduplicated and a compaction clears stale context and categories', async () => {
  const events = [assistant('a'), assistant('a'), { type: 'user', message: { content: '<local-command-stdout>System prompt: 2k tokens (1%)\nMCP tools: 3k tokens (2%)</local-command-stdout>' } }];
  const before = await parseEvents(info, events);
  assert.equal(before.requests.length, 1);
  assert.equal(before.categories.mcpTools.tokens, 3000);
  const after = await parseEvents(info, [...events, { type: 'system', subtype: 'compact_boundary' }]);
  assert.equal(after.used, null);
  assert.deepEqual(after.categories, {});
  assert.equal(after.requests.length, 1);
});
test('Codex request IDs exclude another thread, ignore legacy totals when modern totals exist, and do not recount reasoning', async () => {
  const u = { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 100, reasoning_output_tokens: 70 };
  const record = { type: 'token_usage_record', payload: { thread_id: 's1', response_id: 'r1', usage: u, thread_token_usage: u } };
  const x = await parseEvents({ ...info, client: 'codex' }, [
    { type: 'turn_context', payload: { model: 'gpt' } }, record, record,
    { type: 'token_usage_record', payload: { ...record.payload, thread_id: 'other', response_id: 'r2' } },
    { type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: u, total_token_usage: { ...u, input_tokens: 9000 }, model_context_window: 200000 } } },
  ]);
  assert.equal(x.requests.length, 1);
  assert.equal(x.requests[0].model, 'gpt');
  assert.equal(x.used, 1100);
  assert.equal(x.cumulative.input, 1000);
  assert.equal(x.capacity, 200000);
});
test('only explicitly loaded Codex text is estimated, tool/skill installation inventories are ignored', async () => {
  const x = await parseEvents({ ...info, client: 'codex' }, [
    { type: 'world_state', payload: { full: true, state: { agents_md: { text: 'project instructions' }, host_skills: { body: 'loaded skills', includeInstructions: true } } } },
  ]);
  assert.equal(x.categories.memoryFiles.accuracy, 'estimated');
  assert.ok(x.categories.skills.tokens > 0);
  assert.equal(x.categories.mcpTools, undefined);
});
