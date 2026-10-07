import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { getClaudeConfigDir } from '../claude-config-dir.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { atomicJson, lensHome, record, launchSettings, type LaunchSettings } from './settings.js';
import { mergeRequests, TOKEN_KEYS } from './usage.js';
import { tokenNumber } from './context.js';
import type { SessionInfo, RequestUsage } from './types.js';
import type { StdinData } from '../types.js';

export interface SessionFile extends SessionInfo { file: string; size: number; mtimeMs: number; lastUserAt?: number }
export const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
export const sessionKey = (s: { client: string; id: string }): string => `${s.client}:${s.id}`;
export const dataPath = (kind: string, s: Pick<SessionInfo, 'client' | 'id'>): string => {
  if (!validId(s.id) || !['claude', 'codex'].includes(s.client)) throw new Error('Invalid session identifier');
  return path.join(lensHome(), kind, `${s.client}-${s.id}.json`);
};

function* logFiles(dir: string, depth = 0): Generator<string> {
  if (depth > 6) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* logFiles(file, depth + 1);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) yield file;
  }
}

const records = (text: string): any[] => text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
const titleText = (value: unknown): string => typeof value === 'string' ? sanitizeDisplayText(value).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
const discoveryCache = new Map<string, { stamp: string; value: SessionFile; fallbackTitle: string }>();

/** Read only explicit user activity; file modification times also include background output. */
export function lastUserActivity(entries: any[], client: 'claude' | 'codex'): number | undefined {
  let latest = 0;
  for (const event of entries) {
    const content = event?.message?.content;
    const human = client === 'codex' ? event?.type === 'event_msg' && event.payload?.type === 'user_message'
      : event?.type === 'user' && !event.isMeta && !event.isSidechain && (typeof content === 'string'
        || Array.isArray(content) && content.some(part => part?.type === 'text'));
    if (!human) continue;
    const at = Date.parse(event.timestamp);
    if (Number.isFinite(at) && at > 0 && at <= Date.now() + 60000) latest = Math.max(latest, at);
  }
  return latest || undefined;
}

function codexTitles(root: string): Map<string, string> {
  const titles = new Map<string, string>();
  try {
    const file = path.join(path.dirname(root), 'session_index.jsonl');
    if (fs.statSync(file).size > 8 * 1024 * 1024) return titles;
    for (const entry of records(fs.readFileSync(file, 'utf8'))) {
      const title = titleText(entry?.thread_name);
      if (validId(entry?.id) && title) titles.set(entry.id, title);
    }
  } catch { /* Older clients can omit the title index. */ }
  return titles;
}

export function discoverSessions(roots: { claude?: string; codex?: string } = {}): SessionFile[] {
  const files: SessionFile[] = [];
  const claude = roots.claude ?? path.join(getClaudeConfigDir(os.homedir()), 'projects');
  const codex = roots.codex ?? path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
  const titles = codexTitles(codex);
  for (const [client, root] of [['claude', claude], ['codex', codex]] as const) {
    for (const file of logFiles(root)) {
      try {
        const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
        let stat: fs.Stats; let prefix: string; let tail = ''; let stamp = '';
        try {
          stat = fs.fstatSync(fd);
          if (!stat.isFile()) continue;
          stamp = `${client}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
          const cached = discoveryCache.get(file);
          if (cached?.stamp === stamp) {
            files.push({ ...cached.value, title: client === 'codex' ? titles.get(cached.value.id) || cached.fallbackTitle || '未命名对话' : cached.value.title });
            continue;
          }
          const buf = Buffer.alloc(Math.min(stat.size, 128 * 1024));
          const bytes = fs.readSync(fd, buf, 0, buf.length, 0); prefix = buf.subarray(0, bytes).toString('utf8');
          if (stat.size > buf.length) {
            const end = Buffer.alloc(Math.min(stat.size - buf.length, 512 * 1024));
            const start = stat.size - end.length;
            const read = fs.readSync(fd, end, 0, end.length, start);
            tail = end.subarray(0, read).toString('utf8');
            if (start > buf.length) tail = tail.slice(tail.indexOf('\n') + 1);
          }
        } finally { fs.closeSync(fd); }
        const entries = records(prefix + '\n' + tail);
        const meta = client === 'codex' ? record(entries.find(e => e?.type === 'session_meta')?.payload)
          : record(entries.find(e => typeof e?.cwd === 'string') ?? entries.find(e => e?.sessionId));
        const base = path.basename(file, '.jsonl');
        const id = client === 'codex' ? meta.id || /([0-9a-f]{8}-[0-9a-f-]{27})$/i.exec(base)?.[1] : base;
        if (!validId(id)) continue;
        const parentId = client === 'claude' && path.basename(path.dirname(file)) === 'subagents'
          ? path.basename(path.dirname(path.dirname(file)))
          : record(record(record(meta.source).subagent).thread_spawn).parent_thread_id;
        const uniqueId = client === 'claude' && validId(parentId) ? `${parentId}_${id}` : id;
        if (!validId(uniqueId)) continue;
        const title = client === 'codex' ? titles.get(id) || titleText(meta.title)
          : titleText(entries.filter(e => e?.type === 'custom-title' && (!e.sessionId || e.sessionId === id)).at(-1)?.customTitle);
        const value: SessionFile = { id: uniqueId, client, file, cwd: typeof meta.cwd === 'string' ? sanitizeDisplayText(meta.cwd) : '',
          model: '', updatedAt: stat.mtime.toISOString(), size: stat.size, mtimeMs: stat.mtimeMs,
          title: title || '未命名对话', lastUserAt: lastUserActivity(entries, client),
          ...(validId(parentId) ? { parentId } : {}) };
        if (discoveryCache.size >= 1000) discoveryCache.delete(discoveryCache.keys().next().value!);
        discoveryCache.set(file, { stamp, value, fallbackTitle: titleText(meta.title) });
        files.push(value);
      } catch { /* A session being rotated or removed is absent from this scan. */ }
    }
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export interface LiveClaude { stdin: StdinData; at: string; launch?: LaunchSettings; hudWindow?: number; environment: Record<string, string> }
const envKeys = ['CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'DISABLE_AUTO_COMPACT', 'DISABLE_COMPACT'];
export function captureClaude(stdin: StdinData, launch?: LaunchSettings, hudWindow?: number): void {
  if (!validId(stdin.session_id)) return;
  // Persist only counters and identifiers; never prompts, tool schemas, or credentials.
  const c = record(stdin.context_window); const u = record(c.current_usage); const pc = record(stdin.prompt_cache);
  const clean: StdinData = {
    session_id: stdin.session_id, cwd: typeof stdin.cwd === 'string' ? stdin.cwd : undefined,
    model: { id: typeof stdin.model?.id === 'string' ? stdin.model.id : undefined },
    context_window: { context_window_size: tokenNumber(c.context_window_size) ?? undefined,
      current_usage: c.current_usage === null ? null : {
        input_tokens: tokenNumber(u.input_tokens) ?? undefined, output_tokens: tokenNumber(u.output_tokens) ?? undefined,
        cache_creation_input_tokens: tokenNumber(u.cache_creation_input_tokens) ?? undefined, cache_read_input_tokens: tokenNumber(u.cache_read_input_tokens) ?? undefined,
      } },
    cost: { total_cost_usd: typeof stdin.cost?.total_cost_usd === 'number' && Number.isFinite(stdin.cost.total_cost_usd) ? stdin.cost.total_cost_usd : null },
    prompt_cache: { warm: typeof pc.warm === 'boolean' ? pc.warm : undefined, caching_observed: typeof pc.caching_observed === 'boolean' ? pc.caching_observed : undefined,
      expires_at: typeof pc.expires_at === 'number' && Number.isFinite(pc.expires_at) ? pc.expires_at : null },
  };
  const environment: Record<string, string> = {};
  for (const key of envKeys) if (process.env[key] !== undefined) environment[key] = process.env[key]!;
  atomicJson(dataPath('live', { client: 'claude', id: stdin.session_id }), { stdin: clean, at: new Date().toISOString(), launch, environment,
    ...(typeof hudWindow === 'number' && tokenNumber(hudWindow) && hudWindow > 0 ? { hudWindow } : {}) });
}

export function readLiveClaude(session: SessionInfo): LiveClaude | null {
  try {
    const file = dataPath('live', session);
    if (fs.statSync(file).size > 64000) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data.stdin?.session_id === session.id && Number.isFinite(Date.parse(data.at)) ? data : null;
  } catch { return null; }
}

/** ps exposes launch flags on macOS; values are never logged or persisted as command text. */
export function claudeLaunchSettings(): LaunchSettings | undefined {
  if (process.platform === 'win32') return undefined;
  let pid = process.ppid;
  for (let i = 0; i < 5 && pid > 1; i++) {
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'ppid=', '-o', 'args='], { encoding: 'utf8', timeout: 300, maxBuffer: 128 * 1024 });
    const m = /^\s*(\d+)\s+(.+)$/s.exec(result.stdout || '');
    if (!m) break;
    pid = Number(m[1]);
    if (!/(?:^|[\/\s])claude(?:\s|$)/.test(m[2])) continue;
    const value = /(?:^|\s)--autocompact(?:=|\s+)["']?([\d.kKmM]+|auto)\b/.exec(m[2]);
    return value ? launchSettings('claude', ['--autocompact', value[1]]) : {};
  }
  return undefined;
}

export function checkpoint(session: SessionInfo, rows: RequestUsage[], cumulative?: RequestUsage): { requests: RequestUsage[]; cumulative?: RequestUsage } {
  const file = dataPath('ledger', session);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let lock: number | undefined;
  try { lock = fs.openSync(`${file}.lock`, 'wx', 0o600); } catch { /* Another reader may be persisting this session. */ }
  try {
    let prior: RequestUsage[] = [];
    let previousTotal: RequestUsage | undefined;
    try {
      if (fs.statSync(file).size < 32 * 1024 * 1024) {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(value.requests)) prior = value.requests.filter((r: any) => r && typeof r.id === 'string' && typeof r.model === 'string'
          && (session.client !== 'claude' || r.model !== '<synthetic>')
          && TOKEN_KEYS.every(key => tokenNumber(r[key]) !== null));
        if (value.cumulative && TOKEN_KEYS.every(key => tokenNumber(value.cumulative[key]) !== null)) previousTotal = value.cumulative;
      }
    } catch { /* First scan or interrupted checkpoint: the append-only log remains the source. */ }
    const requests = mergeRequests([...prior, ...rows]);
    const total = cumulative ? mergeRequests([...(previousTotal ? [previousTotal] : []), cumulative])[0] : previousTotal;
    const merged = { requests, cumulative: total };
    if (lock !== undefined && JSON.stringify({ requests: prior, cumulative: previousTotal }) !== JSON.stringify(merged)) atomicJson(file, merged);
    return merged;
  } finally { if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(`${file}.lock`); } }
}
