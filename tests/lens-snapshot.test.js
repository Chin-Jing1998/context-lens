import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionCollector } from '../dist/lens/snapshot.js';
import { checkpoint, discoverSessions } from '../dist/lens/sessions.js';

const assistant = (id, cacheRead) => ({ type: 'assistant', cwd: '/project', message: { id, model: 'm', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: cacheRead } } });
test('Claude live zero placeholders stay unknown, cached input remains valid, and child prompts do not enter the parent context', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-live-context-'));
  const previous = process.env.CONTEXT_LENS_HOME; process.env.CONTEXT_LENS_HOME = path.join(dir, 'state');
  try {
    const root = path.join(dir, 'claude'), sub = path.join(root, 'main/subagents'); mkdirSync(sub, { recursive: true });
    const at = '2026-10-07T00:00:00Z';
    writeFileSync(path.join(root, 'main.jsonl'), [
      { type: 'user', uuid: 'u', cwd: '/project', timestamp: at, message: { content: 'hello' } },
      { ...assistant('main-response', 0), timestamp: at },
    ].map(JSON.stringify).join('\n'));
    writeFileSync(path.join(sub, 'agent-child.jsonl'), [
      { type: 'user', uuid: 'child-u', cwd: '/project', timestamp: at, message: { content: 'child '.repeat(100) } },
      { ...assistant('child-response', 0), timestamp: at },
    ].map(JSON.stringify).join('\n'));
    const collector = new SessionCollector({ claude: root, codex: path.join(dir, 'codex') });
    const file = collector.list().find(s => s.id === 'main');
    const live = cache => ({ at: '2026-10-07T01:00:00Z', environment: {}, stdin: { session_id: 'main', model: { id: 'm' },
      context_window: { context_window_size: 10000, current_usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: cache, cache_creation_input_tokens: 0 } } } });
    const empty = await collector.snapshot(file, { live: live(0), view: 'model' });
    assert.equal(empty.context.usedTokens, null); assert.equal(empty.context.percent, null);
    const cached = await collector.snapshot(file, { live: live(100), view: 'model' });
    assert.equal(cached.context.usedTokens, 100);
    assert.equal(cached.context.segments.find(s => s.id === 'messages').tokens, 1);
    assert.equal(cached.totals.agentCount, 1); assert.equal(cached.totals.all.requests, 2);
  } finally { if (previous === undefined) delete process.env.CONTEXT_LENS_HOME; else process.env.CONTEXT_LENS_HOME = previous; rmSync(dir, { recursive: true, force: true }); }
});
test('session discovery binds children by explicit layout and totals survive replay, restart, and truncated logs', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-session-'));
  const prev = process.env.CONTEXT_LENS_HOME; process.env.CONTEXT_LENS_HOME = path.join(dir, 'state');
  try {
    const root = path.join(dir, 'claude'); const project = path.join(root, 'project');
    const sub = path.join(project, 'main-session/subagents'); mkdirSync(sub, { recursive: true });
    const file = path.join(project, 'main-session.jsonl');
    writeFileSync(file, JSON.stringify(assistant('r1', 900)) + '\n');
    writeFileSync(path.join(sub, 'agent-child.jsonl'), [assistant('r1', 900), assistant('r2', 0)].map(JSON.stringify).join('\n'));
    const roots = { claude: root, codex: path.join(dir, 'codex') };
    const collector = new SessionCollector(roots);
    assert.equal(discoverSessions(roots).length, 2);
    const x = await collector.get('claude:main-session');
    assert.equal(x.totals.main.input, 1000);
    assert.equal(x.totals.agents.input, 100);
    assert.equal(x.totals.all.input, 1100);
    assert.equal(x.totals.all.cacheReadRequests, 1);
    assert.equal(x.totals.agentCount, 1);
    const ledgerPath = path.join(dir, 'state/ledger/claude-main-session.json');
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    ledger.requests.push({ ...ledger.requests[0], id: 'claude:old-error', model: '<synthetic>', input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    assert.equal((await new SessionCollector(roots).get('claude:main-session')).totals.main.requests, 1, 'legacy synthetic ledger rows are excluded');
    writeFileSync(file, JSON.stringify(assistant('r3', 0)) + '\n');
    const y = await new SessionCollector(roots).get('claude:main-session');
    assert.equal(y.totals.main.input, 1100);
    assert.equal(y.totals.main.requests, 2);
    assert.equal((await new SessionCollector(roots).get('claude:main-session')).totals.main.requests, 2);
    const saved = readFileSync(path.join(dir, 'state/ledger/claude-main-session.json'), 'utf8');
    assert.equal(saved.includes('message'), false);
    assert.equal(saved.includes('cwd'), false);
  } finally { if (prev === undefined) delete process.env.CONTEXT_LENS_HOME; else process.env.CONTEXT_LENS_HOME = prev; rmSync(dir, { recursive: true, force: true }); }
});

test('conversation titles come from client records, survive cache hits and never fall back to project names', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-titles-'));
  const prev = process.env.CONTEXT_LENS_HOME; process.env.CONTEXT_LENS_HOME = path.join(dir, 'state');
  try {
    const roots = { claude: path.join(dir, 'claude'), codex: path.join(dir, 'codex/sessions') };
    mkdirSync(roots.claude, { recursive: true }); mkdirSync(roots.codex, { recursive: true });
    const index = path.join(dir, 'codex/session_index.jsonl');
    writeFileSync(index, JSON.stringify({ id: 'conversation-a', thread_name: '检查组件状态' }) + '\n');
    writeFileSync(path.join(roots.codex, 'conversation-a.jsonl'), JSON.stringify({ type: 'session_meta', payload: { id: 'conversation-a', cwd: '/project-name' } }) + '\n');
    writeFileSync(path.join(roots.claude, 'conversation-b.jsonl'), [
      { type: 'user', sessionId: 'conversation-b', cwd: '/same-project', timestamp: '2026-10-01T10:00:00Z', message: { content: 'Input' } },
      { type: 'custom-title', sessionId: 'another-conversation', customTitle: 'Wrong title' },
      { type: 'custom-title', sessionId: 'conversation-b', customTitle: '修复上下文统计' },
    ].map(JSON.stringify).join('\n'));
    const collector = new SessionCollector(roots);
    assert.equal(collector.list().find(f => f.client === 'claude').title, '修复上下文统计');
    assert.equal((await collector.get('codex:conversation-a')).session.title, '检查组件状态');
    writeFileSync(index, JSON.stringify({ id: 'conversation-a', thread_name: '组件状态已更新' }) + '\n');
    collector.list(true);
    assert.equal((await collector.get('codex:conversation-a')).session.title, '组件状态已更新');
    writeFileSync(index, ''); collector.list(true);
    assert.equal((await collector.get('codex:conversation-a')).session.title, '未命名对话');
  } finally { if (prev === undefined) delete process.env.CONTEXT_LENS_HOME; else process.env.CONTEXT_LENS_HOME = prev; rmSync(dir, { recursive: true, force: true }); }
});
