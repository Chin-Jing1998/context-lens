import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActiveSessions } from '../dist/lens/active.js';
import { ClaudeDesktopSessions } from '../dist/lens/claude-desktop.js';

// Every active lookup supplies visible identity so these tests never scan live
// processes, the user's Claude directories or the user's Codex state.
function fixture(t, rootCount = 2) {
  const directory = mkdtempSync(path.join(tmpdir(), 'lens-session-follow-independent-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const roots = Array.from({ length: rootCount }, (_, i) => path.join(directory, `profile-${i}`, 'claude-code-sessions'));
  let time = 10000;
  const active = new ActiveSessions({ claudeDesktopRoots: roots, now: () => time });
  const sessions = [
    { id: 'follow_cli_a', client: 'claude', title: 'Log title A', cwd: '/synthetic-project', lastUserAt: 100 },
    { id: 'follow_cli_b', client: 'claude', title: 'Log title B', cwd: '/synthetic-project', lastUserAt: 900000 },
    { id: 'follow_cli_child', client: 'claude', parentId: 'follow_cli_a', title: 'Child title', cwd: '/synthetic-project' },
    { id: 'follow_other', client: 'codex', title: 'Other client title', cwd: '/synthetic-project' },
  ];
  function record(slot, id, value) {
    const folder = path.join(roots[slot], 'synthetic-account', 'synthetic-org');
    mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `${id}.json`);
    writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
    return file;
  }
  return {
    directory, roots, sessions, active, record,
    put(slot, id, cliSessionId, title = '') { return record(slot, id, { sessionId: id, cliSessionId, title }); },
    advance() { time += 2000; },
    select(hint, files = sessions) {
      assert.ok(hint?.id || hint?.title, 'An explicit visible hint is required by the isolated fixture');
      return active.get(files, 'claude', 4242, hint);
    },
  };
}

function sizedRecord(id, cliSessionId, size) {
  const value = { sessionId: id, cliSessionId, padding: '' };
  value.padding = 'x'.repeat(size - Buffer.byteLength(JSON.stringify(value)));
  const text = JSON.stringify(value);
  assert.equal(Buffer.byteLength(text), size);
  return text;
}

test('independent follow: one foreground PID follows desktop A/B/A rather than newer background activity', t => {
  const f = fixture(t);
  f.put(0, 'local_desktop_a', 'follow_cli_a', 'Desktop title A');
  f.put(1, 'local_desktop_b', 'follow_cli_b', 'Desktop title B');
  for (const [id, expected] of [
    ['local_desktop_a', 'claude:follow_cli_a'],
    ['local_desktop_b', 'claude:follow_cli_b'],
    ['local_desktop_a', 'claude:follow_cli_a'],
  ]) {
    const result = f.select({ id, title: 'Log title B' });
    assert.equal(result.selected, expected);
    assert.deepEqual(result.candidates, []);
  }
});

test('independent follow: a visible CLI ID overrides a conflicting desktop title', t => {
  const f = fixture(t);
  f.put(0, 'local_desktop_b', 'follow_cli_b', 'Shared current title');
  assert.equal(f.select({ id: 'follow_cli_a', title: 'Shared current title' }).selected, 'claude:follow_cli_a');
});

test('independent follow: CLI-title and desktop-title conflicts remain unknown without a visible ID', t => {
  const f = fixture(t);
  const files = f.sessions.map(file => file.id === 'follow_cli_a' ? { ...file, title: 'Shared current title' } : file);
  f.put(0, 'local_desktop_b', 'follow_cli_b', 'Shared current title');
  assert.equal(f.select({ title: 'Shared current title' }, files).selected, null);
  assert.equal(f.select({ id: 'follow_cli_a', title: 'Shared current title' }, files).selected, 'claude:follow_cli_a');
  assert.equal(f.select({ id: 'local_desktop_b', title: 'Shared current title' }, files).selected, 'claude:follow_cli_b');
});

test('independent follow: failed explicit desktop identity clears the previous selection and cannot fall back to a title', t => {
  const f = fixture(t);
  f.put(0, 'local_desktop_a', 'follow_cli_a', 'Desktop title A');
  assert.equal(f.select({ id: 'local_desktop_a' }).selected, 'claude:follow_cli_a');
  for (const id of ['local_missing', '../follow_cli_b', 'not-a-desktop-id', `local_${'x'.repeat(95)}`]) {
    assert.equal(f.select({ id, title: 'Log title B' }).selected, null);
  }
});

test('independent follow: metadata cannot select a CLI transcript absent from the current collector', t => {
  const f = fixture(t);
  f.put(0, 'local_absent', 'follow_cli_not_collected', 'Log title B');
  assert.equal(f.select({ id: 'local_absent', title: 'Log title B' }).selected, null);
});

test('independent follow: child, other-client and duplicate collector identities are not eligible desktop targets', t => {
  const f = fixture(t);
  f.put(0, 'local_child', 'follow_cli_child');
  f.put(0, 'local_other', 'follow_other');
  f.put(0, 'local_duplicate', 'follow_cli_a');
  assert.equal(f.select({ id: 'local_child' }).selected, null);
  assert.equal(f.select({ id: 'local_other' }).selected, null);
  assert.equal(f.select({ id: 'local_duplicate' }, [...f.sessions, { ...f.sessions[0] }]).selected, null);
  assert.equal(f.select({ id: 'follow_cli_a' }, [...f.sessions, { ...f.sessions[0] }]).selected, null);
});

test('independent follow: equal desktop IDs across profiles deduplicate only when their CLI identities agree', t => {
  const f = fixture(t);
  f.put(0, 'local_shared', 'follow_cli_a', 'Desktop title');
  f.put(1, 'local_shared', 'follow_cli_a', 'Desktop title');
  assert.equal(f.select({ id: 'local_shared' }).selected, 'claude:follow_cli_a');
  f.put(1, 'local_shared', 'follow_cli_b', 'Desktop title');
  f.advance();
  assert.equal(f.select({ id: 'local_shared' }).selected, null);
  assert.equal(f.select({ title: 'Desktop title' }).selected, null);
});

test('independent follow: equal titles do not erase distinct desktop IDs', t => {
  const f = fixture(t);
  f.put(0, 'local_title_a', 'follow_cli_a', 'Same visible title');
  f.put(1, 'local_title_b', 'follow_cli_b', 'Same visible title');
  assert.equal(f.select({ title: 'Same visible title' }).selected, null);
  assert.equal(f.select({ id: 'local_title_a' }).selected, 'claude:follow_cli_a');
  assert.equal(f.select({ id: 'local_title_b' }).selected, 'claude:follow_cli_b');
});

test('independent follow: a unique normalized desktop title connects to a differently named CLI session', t => {
  const f = fixture(t);
  f.put(0, 'local_whitespace', 'follow_cli_a', '  Fix\n desktop\t follow  ');
  assert.equal(f.select({ title: 'Fix desktop follow' }).selected, 'claude:follow_cli_a');
});

test('independent follow: generic desktop titles remain unknown even when metadata makes them unique', t => {
  const f = fixture(t);
  for (const title of ['Claude', 'Claude Code', 'Code', 'New conversation', 'Untitled', '新建会话']) {
    f.put(0, 'local_generic', 'follow_cli_a', title);
    f.advance();
    assert.equal(f.select({ title }).selected, null);
  }
});

test('independent follow: replacing cliSessionId invalidates a cached mapping after the refresh interval', t => {
  const f = fixture(t);
  f.put(0, 'local_rebound', 'follow_cli_a', 'Current desktop title');
  assert.equal(f.select({ id: 'local_rebound' }).selected, 'claude:follow_cli_a');
  f.record(0, 'local_rebound', { sessionId: 'local_rebound', cliSessionId: 'follow_cli_b',
    priorCliSessionIds: ['follow_cli_a'], title: 'Current desktop title' });
  f.advance();
  assert.equal(f.select({ id: 'local_rebound' }).selected, 'claude:follow_cli_b');
  assert.equal(f.select({ title: 'Current desktop title' }).selected, 'claude:follow_cli_b');
});

test('independent follow: renaming metadata removes the old title rather than preserving an alias', t => {
  const f = fixture(t);
  f.put(0, 'local_renamed', 'follow_cli_a', 'Previous desktop title');
  assert.equal(f.select({ title: 'Previous desktop title' }).selected, 'claude:follow_cli_a');
  f.put(0, 'local_renamed', 'follow_cli_a', 'Current desktop title');
  f.advance();
  assert.equal(f.select({ title: 'Previous desktop title' }).selected, null);
  assert.equal(f.select({ title: 'Current desktop title' }).selected, 'claude:follow_cli_a');
});

test('independent follow: deletion, partial JSON and recovery do not retain the previous selection', t => {
  const f = fixture(t);
  const file = f.put(0, 'local_recovered', 'follow_cli_a', 'Recoverable title');
  assert.equal(f.select({ id: 'local_recovered' }).selected, 'claude:follow_cli_a');
  rmSync(file);
  f.advance();
  assert.equal(f.select({ id: 'local_recovered', title: 'Log title B' }).selected, null);
  f.record(0, 'local_recovered', '{"sessionId":');
  f.advance();
  assert.equal(f.select({ id: 'local_recovered' }).selected, null);
  f.put(0, 'local_recovered', 'follow_cli_b', 'Recoverable title');
  f.advance();
  assert.equal(f.select({ id: 'local_recovered' }).selected, 'claude:follow_cli_b');
});

test('independent follow: collector removal is respected even while desktop metadata remains cached', t => {
  const f = fixture(t);
  f.put(0, 'local_collected', 'follow_cli_a');
  assert.equal(f.select({ id: 'local_collected' }).selected, 'claude:follow_cli_a');
  assert.equal(f.select({ id: 'local_collected' }, f.sessions.filter(file => file.id !== 'follow_cli_a')).selected, null);
  assert.equal(f.select({ id: 'local_collected' }).selected, 'claude:follow_cli_a');
});

const invalidRecords = [
  ['filename/sessionId mismatch', { sessionId: 'local_different', cliSessionId: 'follow_cli_a' }],
  ['CLI path traversal', { sessionId: 'local_invalid', cliSessionId: '../follow_cli_a' }],
  ['overlong CLI identity', { sessionId: 'local_invalid', cliSessionId: 'x'.repeat(101) }],
  ['prior CLI identities without a current CLI identity', { sessionId: 'local_invalid', priorCliSessionIds: ['follow_cli_a'] }],
  ['non-object JSON', 'null'],
  ['invalid UTF-8', Buffer.from([0xff, 0xfe, 0x7b, 0x7d])],
];
for (const [name, value] of invalidRecords) {
  test(`independent follow: reject ${name} without title fallback`, t => {
    const f = fixture(t);
    f.record(0, 'local_invalid', value);
    assert.equal(f.select({ id: 'local_invalid', title: 'Log title B' }).selected, null);
  });
}

test('independent follow: a malformed duplicate record cannot leave another profile uniquely selected', t => {
  const f = fixture(t);
  f.put(0, 'local_conflict', 'follow_cli_a', 'Unique-looking title');
  f.record(1, 'local_conflict', '{');
  assert.equal(f.select({ id: 'local_conflict' }).selected, null);
  assert.equal(f.select({ title: 'Unique-looking title' }).selected, null);
});

test('independent follow: an oversized title cannot be used, while its valid visible ID still resolves', t => {
  const f = fixture(t);
  const title = 'T'.repeat(201);
  f.put(0, 'local_long_title', 'follow_cli_a', title);
  assert.equal(f.select({ title }).selected, null);
  assert.equal(f.select({ id: 'local_long_title', title }).selected, 'claude:follow_cli_a');
});

test('independent follow: root, account, organization and record symlinks cannot supply a mapping', t => {
  const f = fixture(t);
  const outside = path.join(f.directory, 'outside');
  const outsideOrg = path.join(outside, 'account', 'org');
  mkdirSync(outsideOrg, { recursive: true });
  const record = path.join(outsideOrg, 'local_link.json');
  writeFileSync(record, JSON.stringify({ sessionId: 'local_link', cliSessionId: 'follow_cli_a' }));
  mkdirSync(path.dirname(f.roots[0]), { recursive: true });
  symlinkSync(outside, f.roots[0], 'dir');
  const account = path.join(f.roots[1], 'account');
  const org = path.join(account, 'org');
  mkdirSync(org, { recursive: true });
  symlinkSync(path.join(outside, 'account'), path.join(f.roots[1], 'linked-account'), 'dir');
  symlinkSync(outsideOrg, path.join(account, 'linked-org'), 'dir');
  symlinkSync(record, path.join(org, 'local_link.json'), 'file');
  assert.equal(f.select({ id: 'local_link' }).selected, null);
});

test('independent follow: metadata at an extra directory level is outside the supported identity layout', t => {
  const f = fixture(t);
  const extra = path.join(f.roots[0], 'account', 'org', 'extra');
  mkdirSync(extra, { recursive: true });
  writeFileSync(path.join(extra, 'local_deep.json'), JSON.stringify({ sessionId: 'local_deep', cliSessionId: 'follow_cli_a' }));
  assert.equal(f.select({ id: 'local_deep' }).selected, null);
});

test('independent follow: exactly 256 KiB is readable and one additional byte invalidates that record', t => {
  const f = fixture(t);
  f.record(0, 'local_sized', sizedRecord('local_sized', 'follow_cli_a', 256 * 1024));
  assert.equal(f.select({ id: 'local_sized' }).selected, 'claude:follow_cli_a');
  f.record(0, 'local_sized', sizedRecord('local_sized', 'follow_cli_a', 256 * 1024 + 1));
  f.advance();
  assert.equal(f.select({ id: 'local_sized' }).selected, null);
});

test('independent follow: a scan exceeding the aggregate byte budget cannot return a partial unique mapping', t => {
  const f = fixture(t);
  for (let i = 0; i < 16; i++) {
    const id = `local_bytes_${i}`;
    f.record(0, id, sizedRecord(id, i === 0 ? 'follow_cli_a' : 'follow_cli_b', 256 * 1024));
  }
  assert.equal(f.select({ id: 'local_bytes_0' }).selected, 'claude:follow_cli_a');
  f.put(1, 'local_over_budget', 'follow_cli_b');
  f.advance();
  assert.equal(f.select({ id: 'local_bytes_0' }).selected, null);
});

test('independent follow: the 1025th metadata record invalidates a previously complete scan', t => {
  const f = fixture(t);
  f.put(0, 'local_count_target', 'follow_cli_a');
  for (let i = 0; i < 1023; i++) f.put(0, `local_count_${i}`, 'follow_cli_b');
  assert.equal(f.select({ id: 'local_count_target' }).selected, 'claude:follow_cli_a');
  f.put(1, 'local_count_over', 'follow_cli_b');
  f.advance();
  assert.equal(f.select({ id: 'local_count_target' }).selected, null);
});

test('independent follow: directory-budget exhaustion does not hide an unseen conflicting mapping', t => {
  const f = fixture(t);
  f.put(0, 'local_directory_target', 'follow_cli_a');
  for (let i = 0; i < 130; i++) mkdirSync(path.join(f.roots[0], `extra-account-${i}`));
  assert.equal(f.select({ id: 'local_directory_target' }).selected, null);
});

test('independent follow: unrelated directory entries still count toward a bounded complete scan', t => {
  const f = fixture(t);
  const file = f.put(0, 'local_entry_target', 'follow_cli_a');
  for (let i = 0; i < 4100; i++) writeFileSync(path.join(path.dirname(file), `unrelated-${i}`), '');
  assert.equal(f.select({ id: 'local_entry_target' }).selected, null);
});

test('independent follow: unsupported root expansion cannot silently omit profiles', t => {
  const f = fixture(t, 3);
  f.put(0, 'local_root_target', 'follow_cli_a');
  assert.equal(f.select({ id: 'local_root_target' }).selected, null);
  assert.equal(f.select({ id: 'follow_cli_a' }).selected, 'claude:follow_cli_a');
});

test('independent follow: resolution leaves metadata bytes intact and does not expose unrelated private fields', t => {
  const f = fixture(t);
  const marker = 'SYNTHETIC_PRIVATE_FIELD_MUST_NOT_LEAVE_METADATA';
  const file = f.record(0, 'local_private', { sessionId: 'local_private', cliSessionId: 'follow_cli_a',
    title: 'Public fixture title', privatePayload: marker, arbitraryTranscriptPath: '/outside/not-a-transcript' });
  const before = readFileSync(file);
  const names = readdirSync(path.dirname(file)).sort();
  const result = f.select({ id: 'local_private' });
  assert.equal(result.selected, 'claude:follow_cli_a');
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.deepEqual(readFileSync(file), before);
  assert.deepEqual(readdirSync(path.dirname(file)).sort(), names);
});

test('independent follow: absent visible identity remains distinct from an invalid visible identity', t => {
  const f = fixture(t);
  const desktop = new ClaudeDesktopSessions(f.roots);
  assert.equal(desktop.resolve(f.sessions), undefined);
  assert.equal(desktop.resolve(f.sessions, {}), undefined);
  assert.equal(desktop.resolve(f.sessions, { title: 'Claude' }), null);
  assert.equal(desktop.resolve(f.sessions, { id: 'local_missing' }), null);
});

test('independent follow: Claude desktop metadata cannot select a Codex foreground session', t => {
  const f = fixture(t);
  f.put(0, 'local_claude_only', 'follow_cli_a', 'Desktop title A');
  assert.equal(f.active.get(f.sessions, 'codex', 4242, { id: 'local_claude_only' }).selected, null);
});
