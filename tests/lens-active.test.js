import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseActive } from '../dist/lens/active.js';
import { lastUserActivity } from '../dist/lens/sessions.js';

test('automatic selection follows the foreground app process and refuses ambiguous or historical sessions', () => {
  const running = [{ key: 'codex:a', pid: 30, evidence: 'writer' }, { key: 'claude:b', pid: 40, evidence: 'registry' }];
  const parents = new Map([[30, 20], [20, 10], [40, 11]]);
  assert.equal(chooseActive(running, parents, 10).selected, 'codex:a');
  assert.equal(chooseActive(running, parents, 11).selected, 'claude:b');
  assert.equal(chooseActive(running, parents).selected, null);
  assert.equal(chooseActive(running, parents, 99).selected, null);
  assert.equal(chooseActive([], parents, 10).candidates.length, 0);
  assert.equal(chooseActive([...running, running[0]], parents, 10).candidates.length, 1);
});

test('multiple loaded sessions follow explicit interaction within the foreground process tree', () => {
  const candidates = [{ key: 'codex:a', pid: 30 }, { key: 'codex:b', pid: 30 }, { key: 'claude:c', pid: 40 }];
  const parents = new Map([[30, 10], [40, 20]]);
  const activity = new Map([['codex:a', 100], ['codex:b', 200], ['claude:c', 300], ['codex:closed', 999]]);
  assert.equal(chooseActive(candidates, parents, 10, activity).selected, 'codex:b');
  assert.equal(chooseActive(candidates, parents, 20, activity).selected, 'claude:c');
  activity.set('codex:a', 400);
  assert.equal(chooseActive(candidates, parents, 10, activity).selected, 'codex:a');
  activity.set('codex:b', 400);
  assert.equal(chooseActive(candidates, parents, 10, activity).selected, null, 'ties must not silently choose a session');
  assert.equal(chooseActive([], parents, 10, activity).selected, null, 'history without live ownership is absent');
});

test('background output, tool results and synthetic inputs cannot move the active conversation', () => {
  const userAt = '2026-10-01T10:00:00Z', outputAt = '2026-10-01T11:00:00Z';
  assert.equal(lastUserActivity([
    { type: 'event_msg', timestamp: userAt, payload: { type: 'user_message' } },
    { type: 'event_msg', timestamp: outputAt, payload: { type: 'agent_message' } },
    { type: 'event_msg', timestamp: outputAt, payload: { type: 'token_count' } },
  ], 'codex'), Date.parse(userAt));
  assert.equal(lastUserActivity([
    { type: 'user', timestamp: userAt, message: { content: [{ type: 'text', text: 'Run the checks.' }] } },
    { type: 'user', timestamp: outputAt, message: { content: [{ type: 'tool_result', content: 'done' }] } },
    { type: 'user', timestamp: outputAt, isMeta: true, message: { content: 'Metadata' } },
    { type: 'user', timestamp: outputAt, isSidechain: true, message: { content: 'Agent input' } },
  ], 'claude'), Date.parse(userAt));
  assert.equal(lastUserActivity([{ type: 'user', timestamp: 'invalid', message: { content: 'Input' } }], 'claude'), undefined);
});
