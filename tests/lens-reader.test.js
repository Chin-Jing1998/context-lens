import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEvents } from '../dist/lens/reader.js';

const info = { id: 's1', client: 'claude', cwd: '/project', model: 'm', updatedAt: '2026-10-05T00:00:00Z' };
const assistant = (id, input = 100) => ({ type: 'assistant', message: { id, model: 'm', usage: { input_tokens: input, output_tokens: 10, cache_read_input_tokens: 0 } } });
const attachments = readFileSync(new URL('./fixtures/claude-attachments.jsonl', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
const attachment = (type, data, uuid) => ({ type: 'attachment', ...(uuid ? { uuid } : {}), attachment: { type, ...data } });
const diagnostic = () => ({ type: 'system', subtype: 'local_command', commandRun: { command: 'context' }, contextUsage: {
  model: 'm', total_tokens: 1000, raw_max_tokens: 200000,
  categories: [{ name: 'System prompt', tokens: 200 }, { name: 'Skills', tokens: 100 }, { name: 'MCP tools', tokens: 300 }],
} });

test('Claude loaded attachments identify six categories without changing the reported input total', async () => {
  const parsed = await parseEvents(info, attachments);
  assert.equal(parsed.used, 420); assert.equal(parsed.requests.length, 1);
  assert.deepEqual(Object.keys(parsed.categories).sort(), ['systemPrompt', 'systemTools', 'mcpTools', 'mcpInstructions', 'memoryFiles', 'skills'].sort());
  for (const value of Object.values(parsed.categories)) { assert.equal(value.accuracy, 'estimated'); assert.ok(value.tokens > 0); assert.ok(value.at); }
  for (const key of ['systemPrompt', 'memoryFiles', 'skills', 'mcpInstructions']) assert.equal(parsed.categories[key].tokens, 1);
  const duplicated = await parseEvents(info, [...attachments, ...attachments]);
  assert.deepEqual(duplicated.categories, parsed.categories); assert.equal(duplicated.requests.length, 1);
  assert.equal((await parseEvents(info, attachments.slice(0, -1))).used, null, 'prompt state cannot manufacture a usage measurement');
});

test('snapshots replace loaded files and tools; deltas deduplicate and remove definitions', async () => {
  const before = await parseEvents(info, attachments);
  const same = await parseEvents(info, [...attachments, attachment('instructions', { files: [{ path: '/fixture/CLAUDE.md', content: 'hello' }, { path: '/fixture/CLAUDE.md', content: 'hello' }] }),
    attachment('deferred_tools_record', { entries: attachments[5].attachment.entries })]);
  assert.deepEqual(same.categories, before.categories);
  const removed = await parseEvents(info, [...attachments,
    attachment('prompt_snapshot', { tools: [] }), attachment('instructions', { files: [] }), attachment('skill_listing', { content: '' }),
    attachment('mcp_instructions_delta', { removedNames: ['fixture'] }), attachment('deferred_tools_delta', { removedNames: ['mcp__fixture__lookup'] })]);
  for (const key of ['systemTools', 'memoryFiles', 'skills', 'mcpInstructions', 'mcpTools']) assert.equal(removed.categories[key].tokens, 0, key);
  assert.equal(removed.categories.systemPrompt.tokens, 1);
  const namesOnly = await parseEvents(info, [attachment('deferred_tools_delta', { addedNames: ['mcp__not_loaded__tool'], addedLines: ['available tool'] })]);
  assert.deepEqual(namesOnly.categories, {});
});

test('a /context report supersedes estimates until the corresponding observed content changes', async () => {
  const exact = await parseEvents(info, [...attachments, diagnostic(), { ...attachments[1], uuid: 'same-prompt' }]);
  assert.equal(exact.categories.systemPrompt.tokens, 200); assert.equal(exact.categories.systemPrompt.accuracy, 'reported');
  assert.equal(exact.categories.mcpTools.tokens, 300);
  const changed = await parseEvents(info, [...attachments, diagnostic(), attachment('skill_listing', { content: 'updated test skill instructions' })]);
  assert.equal(changed.categories.skills.accuracy, 'estimated');
  assert.equal(changed.categories.systemPrompt.tokens, 200); assert.equal(changed.categories.mcpTools.tokens, 300);
  assert.equal(changed.used, 1000);
});

test('compaction discards old loaded state and replays only explicitly preserved attachments', async () => {
  const boundary = { type: 'system', subtype: 'compact_boundary', uuid: 'compact-a' };
  const empty = await parseEvents(info, [...attachments, boundary, ...attachments]);
  assert.deepEqual(empty.categories, {}); assert.equal(empty.used, null);
  const kept = await parseEvents(info, [...attachments, { ...boundary, compactMetadata: { preservedMessages: { uuids: ['skills-a'] } } }]);
  assert.deepEqual(Object.keys(kept.categories), ['skills']); assert.equal(kept.categories.skills.tokens, 1);
  const rebuilt = await parseEvents(info, [...attachments, boundary, { ...attachments[1], uuid: 'prompt-b' }, assistant('new-response')]);
  assert.ok(rebuilt.categories.systemPrompt); assert.equal(rebuilt.categories.skills, undefined); assert.equal(rebuilt.used, 100);
});

test('real model changes invalidate old categories and accept newly observed prompt state', async () => {
  const changed = await parseEvents(info, [...attachments, attachment('model', { identity: { modelId: 'new-model' } })]);
  assert.deepEqual(changed.categories, {}); assert.equal(changed.used, null);
  const rebuilt = await parseEvents(info, [...attachments, attachment('model', { identity: { modelId: 'new-model' } }),
    { ...attachments[1], uuid: 'new-prompt' }, { type: 'assistant', message: { ...assistant('new').message, model: 'new-model' } }]);
  assert.equal(rebuilt.info.model, 'new-model'); assert.ok(rebuilt.categories.systemPrompt); assert.equal(rebuilt.categories.skills, undefined);
});

test('synthetic/API error responses and sidechains cannot erase context or inflate request counts', async () => {
  const synthetic = { ...assistant('error', 0), isApiErrorMessage: true, error: 'api_error', message: { ...assistant('error', 0).message, model: '<synthetic>' } };
  const before = await parseEvents(info, attachments);
  const after = await parseEvents(info, [...attachments, synthetic, { ...assistant('error-with-real-model', 0), isApiErrorMessage: true },
    { ...attachment('prompt_snapshot', { systemPrompt: ['wrong branch'] }), isSidechain: true },
    { ...attachment('prompt_snapshot', { systemPrompt: ['another session'] }), sessionId: 'foreign' }]);
  assert.deepEqual(after, before);
  const fresh = await parseEvents({ ...info, model: '' }, [synthetic]);
  assert.equal(fresh.used, null); assert.equal(fresh.info.model, 'unknown'); assert.equal(fresh.requests.length, 0);
});
test('Claude replay is deduplicated and a compaction clears stale context and categories', async () => {
  const events = [assistant('a'), assistant('a'), { type: 'user', message: { content: '<local-command-stdout>System prompt: 2k tokens (1%)\nMCP tools: 3k tokens (2%)</local-command-stdout>' } }];
  const before = await parseEvents(info, events);
  assert.equal(before.requests.length, 1);
  assert.equal(before.categories.mcpTools.tokens, 3000);
  const after = await parseEvents(info, [...events, { type: 'system', subtype: 'compact_boundary' }]);
  assert.equal(after.used, null);
  assert.deepEqual(after.categories, {});
  assert.equal(after.requests.length, 1);
  assert.equal((await parseEvents(info, [...events, { type: 'system', subtype: 'compact_boundary' }, assistant('a')])).used, null);
});
test('Claude desktop structured /context data supplies exact categories, capacity and inside reserve without reading tool definitions', async () => {
  const x = await parseEvents(info, [{ type: 'system', subtype: 'local_command', commandRun: { command: 'context' }, contextUsage: {
    model: 'claude-opus-5-5', total_tokens: 80591, raw_max_tokens: 256000,
    categories: [{ name: 'MCP tools', tokens: 44808, kind: 'used' }, { name: 'MCP server instructions', tokens: 621, kind: 'used' },
      { name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' }, { name: 'Free space', tokens: 142409, kind: 'free' }],
  } }]);
  assert.equal(x.used, 80591); assert.equal(x.capacity, 256000); assert.equal(x.info.model, 'claude-opus-5-5');
  assert.equal(x.categories.mcpTools.tokens, 44808); assert.equal(x.categories.mcpInstructions.tokens, 621);
  assert.equal(x.categories.free, undefined); assert.equal(x.buffer.placement, 'inside'); assert.equal(x.buffer.tokens, 33000);
  assert.equal(x.requests.length, 0, '/context diagnostics are not billable requests');
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
  const compacted = await parseEvents({ ...info, client: 'codex' }, [record, { type: 'compacted', payload: {} }, record]);
  assert.equal(compacted.used, null, 'replayed old response cannot restore pre-compaction context');
  assert.equal(compacted.requests.length, 1);
});
test('only explicitly loaded Codex text is estimated, tool/skill installation inventories are ignored', async () => {
  const x = await parseEvents({ ...info, client: 'codex' }, [
    { type: 'world_state', payload: { full: true, state: { agents_md: { text: 'project instructions' }, host_skills: { body: 'loaded skills', includeInstructions: true } } } },
  ]);
  assert.equal(x.categories.memoryFiles.accuracy, 'estimated');
  assert.ok(x.categories.skills.tokens > 0);
  assert.equal(x.categories.mcpTools, undefined);
});
