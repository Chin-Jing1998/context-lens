import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseActive } from '../dist/lens/active.js';

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
