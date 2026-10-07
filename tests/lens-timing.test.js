import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimingReader, sessionTiming } from '../dist/lens/timing.js';
import { parseEvents, readSession } from '../dist/lens/reader.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const base = Date.parse('2026-10-07T00:00:00Z');
const stamp = s => new Date(base + s * 1000).toISOString();
const info = { id: 'clock-session', client: 'codex', cwd: '/project', model: 'm', updatedAt: stamp(999) };
const meta = { type: 'session_meta', timestamp: stamp(1), payload: { id: info.id, timestamp: stamp(0) } };
const event = (type, seconds, payload) => ({ type: 'event_msg', timestamp: stamp(seconds), payload: { type, ...payload } });
const started = (id, seconds) => event('task_started', seconds, { turn_id: id, started_at: (base + seconds * 1000) / 1000 });
const ended = (id, seconds, start) => event('task_complete', seconds, { turn_id: id, started_at: (base + start * 1000) / 1000, completed_at: (base + seconds * 1000) / 1000, duration_ms: (seconds - start) * 1000 });
function timing(events, seconds, session = info) { const reader = new TimingReader(session); for (const e of events) reader.accept(e, !session.parentId); return sessionTiming(reader.finish(), base + seconds * 1000); }

test('session age includes idle gaps; active runtime and the current turn do not include them', () => {
  const entries = [meta, started('a', 10), ended('a', 70, 10), started('b', 200)];
  const value = timing([...entries, ...entries], 230);
  assert.equal(value.elapsedMs, 230000); assert.equal(value.activeMs, 90000); assert.equal(value.currentTurnMs, 30000);
  assert.equal(value.completedTurns, 1); assert.equal(value.status, 'running'); assert.equal(value.startAccuracy, 'reported');
  const stopped = timing(entries.slice(0, 3), 230);
  assert.equal(stopped.activeMs, 60000); assert.equal(stopped.currentTurnMs, null); assert.equal(stopped.status, 'waiting');
});
test('a cached timing log produces advancing clocks without reading another log line', () => {
  const reader = new TimingReader(info); reader.accept(meta, true); reader.accept(started('a', 10), true);
  const log = reader.finish(), first = sessionTiming(log, base + 20000), second = sessionTiming(log, base + 25000);
  assert.equal(second.elapsedMs - first.elapsedMs, 5000); assert.equal(second.activeMs - first.activeMs, 5000);
  assert.equal(second.lastActivityAt, first.lastActivityAt);
});
test('aborted turns stop the runtime clock and are not completed turns', () => {
  const value = timing([meta, started('a', 10), event('task_aborted', 30, { turn_id: 'a' })], 200);
  assert.equal(value.activeMs, 20000); assert.equal(value.completedTurns, 0); assert.equal(value.currentTurnMs, null); assert.equal(value.status, 'interrupted');
});
test('an unclosed older turn is bounded at a new start, flagged incomplete and never double counts an open interval', () => {
  const value = timing([meta, started('a', 10), started('b', 20)], 30);
  assert.equal(value.activeMs, 20000); assert.equal(value.currentTurnMs, 10000); assert.equal(value.complete, false);
});
test('fork metadata, inherited history and unrelated thread events cannot age the child session', () => {
  const child = { ...info, id: 'child', parentId: info.id };
  const value = timing([{ ...meta, payload: { id: info.id, timestamp: stamp(0) } },
    { ...meta, timestamp: stamp(100), payload: { id: 'child', timestamp: stamp(100) } }, started('parent', 10), ended('parent', 60, 10),
    event('task_started', 110, { thread_id: 'other', turn_id: 'foreign' }), started('own', 120)], 130, child);
  assert.equal(value.elapsedMs, 30000); assert.equal(value.activeMs, 10000); assert.equal(value.completedTurns, 0);
});
test('unknown and future timestamps stay unknown; metadata, inventory and mtime do not manufacture activity', async () => {
  const parsed = await parseEvents(info, [{ type: 'world_state', timestamp: stamp(1), payload: {} }, { type: 'turn_context', timestamp: stamp(2), payload: { model: 'm' } }]);
  const value = sessionTiming(parsed.timing, base + 10000);
  assert.equal(value.startedAt, null); assert.equal(value.elapsedMs, null); assert.equal(value.lastActivityAt, null);
  const future = timing([meta, started('a', 100)], 10); assert.equal(future.activeMs, null); assert.equal(future.complete, false);
});
test('a completion without an end timestamp cannot produce a negative or unbounded runtime', () => {
  const value = timing([meta, started('a', 10), { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'a' } }], 100);
  assert.equal(value.activeMs, null); assert.equal(value.currentTurnMs, null); assert.equal(value.complete, false);
  assert.equal(value.elapsedMs, 100000);
});
test('Claude user prompts, end_turn and reported turn_duration are distinct from tool results and installed skills', () => {
  const prompt = { type: 'user', uuid: 'u', timestamp: stamp(10), message: { content: 'Continue' } };
  const entries = [prompt, { type: 'user', timestamp: stamp(15), message: { content: [{ type: 'tool_result', tool_use_id: 'x' }] } },
    { type: 'assistant', uuid: 'a', timestamp: stamp(20), message: { stop_reason: 'end_turn' } },
    { type: 'system', uuid: 'duration', subtype: 'turn_duration', timestamp: stamp(21), durationMs: 9000 }];
  const value = timing([...entries, ...entries], 100, { ...info, client: 'claude' });
  assert.equal(value.startedAt, stamp(10)); assert.equal(value.startAccuracy, 'observed'); assert.equal(value.activeMs, 9000);
  assert.equal(value.completedTurns, 1); assert.equal(value.status, 'waiting'); assert.equal(value.activeAccuracy, 'reported');
});
test('broken logs flag clock completeness; cost scans do not parse session timing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-timing-'));
  try {
    const file = path.join(dir, 'session.jsonl'); writeFileSync(file, JSON.stringify(meta) + '\n{broken\n');
    assert.equal((await readSession(file, info)).timing.complete, false);
    assert.equal((await parseEvents(info, [meta], { usageOnly: true })).timing, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
