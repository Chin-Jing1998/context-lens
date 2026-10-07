import { record } from './settings.js';
import type { SessionInfo, SessionTiming } from './types.js';

interface Turn { id: string; start: number | null; end: number | null; duration: number | null; state: 'running' | 'completed' | 'interrupted' }
export interface TimingLog {
  startedAt: number | null; reportedStart: boolean; lastActivityAt: number | null;
  turns: Turn[]; complete: boolean;
}
const time = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Date.parse(v) : typeof v === 'number' ? v * (v < 1e12 ? 1000 : 1) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 8.64e15 ? n : null;
};
const ms = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const iso = (n: number | null): string | null => n === null ? null : new Date(n).toISOString();

/** Session clocks use log lifecycle records, never file mtime or HUD polling time. */
export class TimingReader {
  private startedAt: number | null = null;
  private reportedStart = false;
  private last: number | null = null;
  private turns = new Map<string, Turn>();
  private seen = new Set<string>();
  private current: string | null = null;
  private complete = true;
  constructor(private info: SessionInfo) {}

  private observe(at: number): void {
    if (!this.reportedStart) this.startedAt = this.startedAt === null ? at : Math.min(this.startedAt, at);
    this.last = this.last === null ? at : Math.max(this.last, at);
  }
  accept(entry: Record<string, any>, ownTurn: boolean): void {
    const at = time(entry.timestamp), p = record(entry.payload);
    if (this.info.client === 'codex') {
      if (p.thread_id && p.thread_id !== this.info.id) return;
      if (entry.type === 'session_meta') {
        if (p.id !== this.info.id) return;
        const start = time(p.timestamp) ?? at;
        if (start !== null) { this.startedAt = start; this.reportedStart = true; }
        return;
      }
      if (this.info.parentId && (!ownTurn && !this.reportedStart || at !== null && this.startedAt !== null && at < this.startedAt)) return;
      const lifecycle = entry.type === 'event_msg' && ['task_started', 'task_complete', 'task_aborted'].includes(p.type);
      const activity = entry.type === 'response_item' || entry.type === 'token_usage_record' || entry.type === 'event_msg' && p.type === 'item_completed';
      if (at !== null && (lifecycle || activity)) this.observe(at);
      if (!lifecycle) return;
      const id = typeof p.turn_id === 'string' ? p.turn_id : p.type === 'task_aborted' ? this.current : null;
      if (!id) { this.complete = false; return; }
      const old = this.turns.get(id);
      const start = time(p.started_at) ?? old?.start ?? (p.type === 'task_started' ? at : null);
      if (p.type === 'task_started' && old && old.state !== 'running') return;
      const end = p.type === 'task_started' ? null : time(p.completed_at ?? p.ended_at) ?? at;
      const state = p.type === 'task_started' ? 'running' : p.type === 'task_complete' ? 'completed' : 'interrupted';
      if (state === 'running' && this.current && this.current !== id && start !== null) {
        const previous = this.turns.get(this.current)!;
        previous.end = start; previous.state = 'interrupted'; this.complete = false;
      }
      this.turns.set(id, { id, start, end, state, duration: ms(p.duration_ms) ?? old?.duration ?? null });
      if (state === 'running') this.current = id; else if (this.current === id) this.current = null;
      return;
    }
    const owner = entry.sessionId ?? entry.session_id;
    if (owner && owner !== this.info.id || entry.isSidechain === true && !this.info.parentId) return;
    if (typeof entry.uuid === 'string') { if (this.seen.has(entry.uuid)) return; this.seen.add(entry.uuid); }
    const message = record(entry.message);
    if (entry.isApiErrorMessage === true || message.model === '<synthetic>' || entry.error) return;
    if (at !== null && ['user', 'assistant'].includes(entry.type)) this.observe(at);
    if (entry.type === 'user' && at !== null) {
      const content = message.content;
      const prompt = typeof content === 'string' ? !content.includes('<local-command-stdout>')
        : Array.isArray(content) && content.some(b => ['text', 'image', 'document'].includes(record(b).type)) && !content.some(b => record(b).type === 'tool_result');
      if (prompt) {
        const id = String(entry.uuid ?? 'user:' + at);
        if (!this.turns.has(id)) {
          if (this.current) { const old = this.turns.get(this.current)!; old.end = at; old.state = 'interrupted'; }
          this.turns.set(id, { id, start: at, end: null, duration: null, state: 'running' }); this.current = id;
        }
      }
    }
    if (entry.type === 'assistant' && at !== null && ['end_turn', 'stop_sequence'].includes(message.stop_reason) && this.current) {
      const turn = this.turns.get(this.current)!; turn.end = at; turn.state = 'completed'; this.current = null;
    }
    if (entry.type === 'system' && entry.subtype === 'turn_duration' && at !== null && ms(entry.durationMs) !== null) {
      this.observe(at);
      const recent = [...this.turns.values()].filter(t => t.end !== null && t.end <= at && at - t.end < 60000).sort((a, b) => b.end! - a.end!)[0];
      const turn = recent ?? (this.current ? this.turns.get(this.current) : undefined);
      if (turn) { turn.duration = entry.durationMs; turn.end ??= at; turn.state = 'completed'; if (this.current === turn.id) this.current = null; }
      else this.complete = false;
    }
  }
  finish(): TimingLog {
    return { startedAt: this.startedAt, reportedStart: this.reportedStart, lastActivityAt: this.last, turns: [...this.turns.values()], complete: this.complete };
  }
}

export function sessionTiming(log: TimingLog, now = Date.now()): SessionTiming {
  const valid = log.turns.filter(t => t.start !== null && t.start <= now
    && (t.end === null ? t.state === 'running' : t.end >= t.start && t.end <= now));
  const active = valid.filter(t => t.state === 'running').sort((a, b) => b.start! - a.start!)[0];
  const last = valid.slice().sort((a, b) => (b.end ?? b.start!) - (a.end ?? a.start!))[0];
  const knownStart = log.startedAt !== null && log.startedAt <= now ? log.startedAt : null;
  const reported = valid.filter(t => t.state !== 'running').every(t => t.duration !== null);
  const activeMs = valid.length ? valid.reduce((sum, t) => sum + (t.state === 'running' ? now - t.start! : t.duration ?? t.end! - t.start!), 0) : null;
  return { startedAt: iso(knownStart), startAccuracy: knownStart === null ? 'unknown' : log.reportedStart ? 'reported' : 'observed',
    lastActivityAt: log.lastActivityAt !== null && log.lastActivityAt <= now ? iso(log.lastActivityAt) : null,
    elapsedMs: knownStart === null ? null : now - knownStart,
    activeMs, activeAccuracy: activeMs === null ? 'unknown' : reported ? 'reported' : 'derived',
    currentTurnMs: active ? now - active.start! : null, currentTurnStartedAt: active ? iso(active.start) : null,
    completedTurns: valid.length ? valid.filter(t => t.state === 'completed').length : null,
    status: active ? 'running' : last?.state === 'completed' ? 'waiting' : last?.state === 'interrupted' ? 'interrupted' : 'unknown',
    complete: log.complete && valid.length === log.turns.length };
}
