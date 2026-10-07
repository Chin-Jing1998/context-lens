import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEvents } from '../dist/lens/reader.js';
import { buildContext } from '../dist/lens/context.js';

test('all seven observed Claude categories remain separate while their remainder and percentages reconcile with the context total', async () => {
  const events = readFileSync(new URL('./fixtures/claude-attachments.jsonl', import.meta.url), 'utf8').trim().split('\n').map(JSON.parse);
  const info = { id: 's1', client: 'claude', cwd: '/project', model: 'm', updatedAt: '2026-10-05T00:00:00Z' };
  events.splice(events.length - 1, 0, { type: 'user', uuid: 'classification-user', message: { content: 'hello' } });
  const parsed = await parseEvents(info, events);
  const ids = ['systemPrompt', 'systemTools', 'mcpTools', 'mcpInstructions', 'memoryFiles', 'skills', 'messages'];
  for (const id of ids) { assert.ok(parsed.categories[id].tokens > 0, id); assert.equal(parsed.categories[id].accuracy, 'estimated', id); }
  const context = buildContext({ used: parsed.used, capacity: 1000, budget: { tokens: 1000, scope: 'total', accuracy: 'reported', source: 'test' }, categories: parsed.categories });
  assert.equal(context.segments.reduce((sum, row) => sum + (row.tokens ?? 0), 0), 1000);
  assert.equal(context.warnings.length, 0);
  assert.equal(context.segments.find(row => row.id === 'messages').tokens, 1);
});

test('desktop wrapped wire tools and direct API definitions produce identical category sizes without counting descriptions twice', async () => {
  const info = { id: 's1', client: 'claude', cwd: '/project', model: 'm', updatedAt: '2026-10-05T00:00:00Z' };
  const tools = [
    { name: 'Bash', description: 'Run a local command. '.repeat(100), input_schema: { type: 'object', properties: { command: { type: 'string' } } } },
    { name: 'mcp__hub__call_tool', description: 'Call one hub tool. '.repeat(100), input_schema: { type: 'object', properties: { server: { type: 'string' } } } },
  ];
  const parse = tools => parseEvents(info, [{ type: 'attachment', attachment: { type: 'prompt_snapshot', tools } }]);
  const direct = await parse(tools);
  const wrapped = await parse(tools.map(tool => ({ name: tool.name, description: tool.description, schema: tool })));
  assert.deepEqual(wrapped.categories, direct.categories);
  assert.equal((await parse([{ name: 'wrong', schema: tools[0] }])).categories.systemTools.tokens, 0);
});
