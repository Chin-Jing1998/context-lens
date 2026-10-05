import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionCollector } from '../dist/lens/snapshot.js';
import { checkpoint, discoverSessions } from '../dist/lens/sessions.js';

const assistant = (id, cacheRead) => ({ type: 'assistant', cwd: '/project', message: { id, model: 'm', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: cacheRead } } });
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
