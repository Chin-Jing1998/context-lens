import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActiveSessions } from '../dist/lens/active.js';

const files = [
  { id: 'cli-a', client: 'claude', title: 'CLI A', cwd: '/fixture' },
  { id: 'cli-b', client: 'claude', title: 'CLI B', cwd: '/fixture' },
  { id: 'cli-child', client: 'claude', parentId: 'cli-a', title: 'Child', cwd: '/fixture' },
  { id: 'cli-other', client: 'codex', title: 'Other client', cwd: '/fixture' },
];
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-claude-desktop-'));
  const roots = ['Claude', 'Claude-3p'].map(name => path.join(dir, name, 'claude-code-sessions'));
  let now = 10000;
  const active = new ActiveSessions({ claudeDesktopRoots: roots, now: () => now });
  const save = (root, name, value) => {
    const folder = path.join(roots[root], 'account', 'org'); mkdirSync(folder, { recursive: true });
    const file = path.join(folder, name + '.json'); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return file;
  };
  return { dir, roots, active, save, tick() { now += 1000; }, close() { rmSync(dir, { recursive: true, force: true }); } };
}

test('Claude desktop IDs map A to B to A within one PID and keep explicit CLI identity first', () => {
  const f = fixture();
  try {
    f.save(0, 'local_a', { sessionId: 'local_a', cliSessionId: 'cli-a', title: 'Desktop A' });
    f.save(1, 'local_b', { sessionId: 'local_b', cliSessionId: 'cli-b', title: 'Desktop B' });
    for (const [id, expected] of [['local_a', 'claude:cli-a'], ['local_b', 'claude:cli-b'], ['local_a', 'claude:cli-a']]) {
      assert.equal(f.active.get(files, 'claude', 1234, { id }).selected, expected);
    }
    assert.equal(f.active.get(files, 'claude', 1234, { id: 'cli-a' }).selected, 'claude:cli-a');
    assert.equal(f.active.get(files, 'claude', 1234, { id: 'local_missing', title: 'CLI B' }).selected, null);
    assert.equal(f.active.get(files, 'codex', 1234, { id: 'local_a' }).selected, null);
  } finally { f.close(); }
});

test('unique desktop titles connect different CLI titles and duplicate or generic titles stay unresolved', () => {
  const f = fixture();
  try {
    f.save(0, 'local_a', { sessionId: 'local_a', cliSessionId: 'cli-a', title: ' Desktop  A ' });
    assert.equal(f.active.get(files, 'claude', 1234, { title: 'Desktop A' }).selected, 'claude:cli-a');
    f.save(1, 'local_b', { sessionId: 'local_b', cliSessionId: 'cli-b', title: 'Desktop A' }); f.tick();
    assert.equal(f.active.get(files, 'claude', 1234, { title: 'Desktop A' }).selected, null);
    f.save(1, 'local_b', { sessionId: 'local_b', cliSessionId: 'cli-b', title: 'CLI A' }); f.tick();
    assert.equal(f.active.get(files, 'claude', 1234, { title: 'CLI A' }).selected, null, 'metadata and direct title must not disagree');
    f.save(0, 'local_a', { sessionId: 'local_a', cliSessionId: 'cli-a', title: 'Claude' }); f.tick();
    assert.equal(f.active.get(files, 'claude', 1234, { title: 'Claude' }).selected, null);
  } finally { f.close(); }
});

test('cross-root conflicting IDs fail closed while identical mappings deduplicate', () => {
  const f = fixture();
  try {
    f.save(0, 'local_a', { sessionId: 'local_a', cliSessionId: 'cli-a', title: 'Desktop A' });
    f.save(1, 'local_a', { sessionId: 'local_a', cliSessionId: 'cli-a', title: 'Desktop A' });
    assert.equal(f.active.get(files, 'claude', 1234, { id: 'local_a' }).selected, 'claude:cli-a');
    f.save(1, 'local_a', { sessionId: 'local_a', cliSessionId: 'cli-b', title: 'Desktop B' }); f.tick();
    assert.equal(f.active.get(files, 'claude', 1234, { id: 'local_a' }).selected, null);
    assert.equal(f.active.get(files, 'claude', 1234, { title: 'Desktop A' }).selected, null);
    assert.equal(f.active.get(files, 'claude', 1234, { id: 'cli-a' }).selected, 'claude:cli-a');
  } finally { f.close(); }
});

test('unsafe, absent, oversized, prior-only and child records cannot select a desktop session', () => {
  const f = fixture();
  try {
    for (const value of [
      { sessionId: 'local_other', cliSessionId: 'cli-a' },
      { sessionId: 'local_bad', cliSessionId: '../../cli-a' },
      { sessionId: 'local_bad', cliSessionId: 'cli-missing' },
      { sessionId: 'local_bad', priorCliSessionIds: ['cli-a'] },
      { sessionId: 'local_bad', cliSessionId: 'cli-child' },
      { sessionId: 'local_bad', cliSessionId: 'cli-other' },
      '{',
      { sessionId: 'local_bad', cliSessionId: 'cli-a', ignored: 'x'.repeat(262144) },
    ]) {
      f.save(0, 'local_bad', value); f.tick();
      assert.equal(f.active.get(files, 'claude', 1234, { id: 'local_bad', title: 'CLI B' }).selected, null);
    }
  } finally { f.close(); }
});

test('symbolic links and extra directory levels are never followed', () => {
  const f = fixture();
  try {
    const outside = path.join(f.dir, 'outside'), outsideOrg = path.join(outside, 'org'); mkdirSync(outsideOrg, { recursive: true });
    const record = path.join(outsideOrg, 'local_link.json');
    writeFileSync(record, JSON.stringify({ sessionId: 'local_link', cliSessionId: 'cli-a' }));
    const org = path.join(f.roots[0], 'account', 'org'); mkdirSync(org, { recursive: true });
    symlinkSync(record, path.join(org, 'local_link.json'));
    symlinkSync(outside, path.join(f.roots[0], 'linked-account'));
    symlinkSync(outsideOrg, path.join(f.roots[0], 'account', 'linked-org'));
    const deep = path.join(org, 'extra'); mkdirSync(deep);
    writeFileSync(path.join(deep, 'local_deep.json'), JSON.stringify({ sessionId: 'local_deep', cliSessionId: 'cli-a' }));
    assert.equal(f.active.get(files, 'claude', 1234, { id: 'local_link' }).selected, null);
    assert.equal(f.active.get(files, 'claude', 1234, { id: 'local_deep' }).selected, null);
  } finally { f.close(); }
});

test('a metadata record budget overrun cannot turn a partial scan into a unique selection', () => {
  const f = fixture();
  try {
    f.save(0, 'local_target', { sessionId: 'local_target', cliSessionId: 'cli-a' });
    for (let i = 0; i < 1024; i++) f.save(0, 'local_' + i, { sessionId: 'local_' + i, cliSessionId: 'cli-b' });
    assert.equal(f.active.get(files, 'claude', 1234, { id: 'local_target' }).selected, null);
    assert.equal(f.active.get(files, 'claude', 1234, { id: 'cli-a' }).selected, 'claude:cli-a');
  } finally { f.close(); }
});

test('short cache refreshes renamed, removed and incomplete metadata without retaining old selections', () => {
  const f = fixture();
  try {
    const file = f.save(0, 'local_a', { sessionId: 'local_a', cliSessionId: 'cli-a', title: 'Old title' });
    assert.equal(f.active.get(files, 'claude', 1234, { title: 'Old title' }).selected, 'claude:cli-a');
    f.save(0, 'local_a', { sessionId: 'local_a', cliSessionId: 'cli-a', title: 'New title' }); f.tick();
    assert.equal(f.active.get(files, 'claude', 1234, { title: 'New title' }).selected, 'claude:cli-a');
    assert.equal(f.active.get(files, 'claude', 1234, { title: 'Old title' }).selected, null);
    writeFileSync(file, '{'); f.tick();
    assert.equal(f.active.get(files, 'claude', 1234, { id: 'local_a' }).selected, null);
    f.save(0, 'local_a', { sessionId: 'local_a', cliSessionId: 'cli-a' }); f.tick();
    assert.equal(f.active.get(files, 'claude', 1234, { id: 'local_a' }).selected, 'claude:cli-a');
    rmSync(file); f.tick();
    assert.equal(f.active.get(files, 'claude', 1234, { id: 'local_a' }).selected, null);
  } finally { f.close(); }
});
