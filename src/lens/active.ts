import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getClaudeConfigDir } from '../claude-config-dir.js';
import { readDocument } from './settings.js';
import { sessionKey, validId, type SessionFile } from './sessions.js';

interface Running { key: string; pid: number; evidence: string }
export interface ActiveResult { selected: string | null; reason: string; candidates: Running[] }
export interface VisibleSessionHint { id?: string; title?: string; cwd?: string; tty?: string }
export interface ActiveSessionInfo { id: string; client: string; parentId?: string; title?: string; cwd: string; lastUserAt?: number }
export interface WindowsProcess { ProcessId: number; ParentProcessId: number; Name: string; CommandLine?: string | null }
export function isClaudeProcess(command: string): boolean {
  return /(?:^|\/|\s)claude(?:\.exe)?(?:$|\s)|@anthropic-ai\/claude-code(?:\/|$)/i.test(command.replaceAll('\\', '/'));
}
export function windowsResumeCandidates(files: ActiveSessionInfo[], processes: WindowsProcess[]): Running[] {
  const available = new Set(files.filter(file => !file.parentId).map(sessionKey));
  return processes.flatMap(process => {
    const client = /^codex(?:\.exe)?$/i.test(process.Name) ? 'codex' : /^claude(?:\.exe)?$/i.test(process.Name) ? 'claude' : null;
    const id = /(?:^|\s)(?:resume|--resume|--session-id)(?:\s+|=)["']?([a-zA-Z0-9_-]{1,100})(?:["']?(?:\s|$))/.exec(process.CommandLine || '')?.[1];
    return client && id && available.has(`${client}:${id}`) && Number.isSafeInteger(process.ProcessId) && process.ProcessId > 1
      ? [{ key: `${client}:${id}`, pid: process.ProcessId, evidence: 'Windows 进程显式会话参数' }] : [];
  });
}
export function visibleSession(files: ActiveSessionInfo[], client?: string, hint?: VisibleSessionHint): string | null | undefined {
  if (!hint?.id && !hint?.title) return undefined;
  const eligible = files.filter(f => (!client || f.client === client) && !f.parentId);
  if (hint.id) { const matches = eligible.filter(f => f.id === hint.id); return matches.length === 1 ? sessionKey(matches[0]) : null; }
  if (!client) return undefined;
  const title = hint.title!.replace(/\s+/g, ' ').trim();
  const matches = eligible.filter(f => f.title?.replace(/\s+/g, ' ').trim() === title);
  return matches.length === 1 ? sessionKey(matches[0]) : null;
}

export function chooseActive(candidates: Running[], parents: Map<number, number>, targetPid?: number, activity = new Map<string, number>()): ActiveResult {
  const matching = candidates.filter(candidate => {
    if (!targetPid) return true;
    let pid = candidate.pid;
    for (let i = 0; i < 30 && pid > 1; i++) {
      if (pid === targetPid) return true;
      pid = parents.get(pid) ?? 0;
    }
    return false;
  });
  const unique = [...new Map(matching.map(c => [c.key, c])).values()];
  const recent = unique.filter(c => (activity.get(c.key) ?? 0) > 0).sort((a, b) => activity.get(b.key)! - activity.get(a.key)!);
  const latest = recent.length && (recent.length === 1 || activity.get(recent[0].key)! > activity.get(recent[1].key)!) ? recent[0] : undefined;
  return { selected: unique.length === 1 ? unique[0].key : latest?.key ?? null, candidates: unique,
    reason: unique.length === 1 ? `已定位运行中的会话 · ${unique[0].evidence}`
      : latest ? '已跟随最近交互的活跃对话'
      : unique.length ? '正在等待当前对话的活动记录'
        : '等待 Claude / Codex 本机会话；不会绑定历史日志' };
}

/** Read live ownership evidence, never infer the active session from the newest historical log. */
export class ActiveSessions {
  private at = 0;
  private running: Running[] = [];
  private parents = new Map<number, number>();
  private error = '';
  private lastInteraction = new Map<string, number>();

  get(files: ActiveSessionInfo[], client?: string, targetPid?: number, hint?: VisibleSessionHint): ActiveResult {
    const visible = visibleSession(files, client, hint);
    if (visible !== undefined) return { selected: visible, candidates: [], reason: visible ? '已跟随前台显示的对话' : '当前可见对话尚无本地记录，或标题无法唯一对应' };
    if (Date.now() - this.at > 2000) this.scan(files);
    const activity = new Map(files.filter(f => !f.parentId && f.lastUserAt).map(f => [sessionKey(f), f.lastUserAt!]));
    try {
      const state = readDocument(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), '.codex-global-state.json'));
      const times = state['electron-persisted-atom-state']?.['thread-user-activity-times-v1'];
      for (const [key, at] of Object.entries(times || {})) {
        const identity = JSON.parse(key);
        if (identity?.[0] !== 'local' || !validId(identity?.[1]) || typeof at !== 'number' || !Number.isFinite(at) || at > Date.now() + 60000) continue;
        const session = `codex:${identity[1]}`;
        activity.set(session, Math.max(activity.get(session) ?? 0, at));
      }
    } catch { /* Live process ownership and explicit log activity remain available. */ }
    const available = new Set(files.filter(f => !f.parentId).map(sessionKey));
    for (const candidate of this.running) if (available.has(candidate.key)) {
      const at = Math.max(activity.get(candidate.key) ?? 0, this.lastInteraction.get(candidate.key) ?? 0);
      if (at) { activity.set(candidate.key, at); this.lastInteraction.set(candidate.key, at); }
    }
    for (const key of this.lastInteraction.keys()) if (!this.running.some(c => c.key === key)) this.lastInteraction.delete(key);
    let running = this.running.filter(c => available.has(c.key) && (!client || c.key.startsWith(`${client}:`)));
    if (hint?.cwd) {
      const matches = running.filter(c => files.find(f => sessionKey(f) === c.key)?.cwd === hint.cwd);
      if (matches.length) running = matches;
    }
    if (hint?.tty) {
      try {
        const rows = execFileSync('/bin/ps', ['-axo', 'pid=,tty='], { encoding: 'utf8', timeout: 1000, maxBuffer: 1024 * 1024 });
        const pids = new Set(rows.split('\n').flatMap(line => { const m = /^\s*(\d+)\s+(\S+)/.exec(line); return m && m[2] === hint.tty ? [Number(m[1])] : []; }));
        running = running.filter(c => pids.has(c.pid));
      } catch { running = []; }
    }
    const result = chooseActive(running, this.parents, targetPid, activity);
    if (!result.candidates.length && this.error) result.reason = this.error;
    return result;
  }

  private scan(files: ActiveSessionInfo[]): void {
    this.at = Date.now(); this.running = []; this.parents.clear(); this.error = '';
    if (!['darwin', 'win32'].includes(process.platform)) { this.error = '自动定位目前支持 macOS 和 Windows'; return; }
    const keys = new Set(files.filter(f => !f.parentId).map(sessionKey));
    const commands = new Map<number, string>();
    try {
      if (process.platform === 'win32') {
        const command = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine) | ConvertTo-Json -Compress";
        const ps = execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
          { encoding: 'utf8', timeout: 3500, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
        const rows: WindowsProcess[] = JSON.parse(ps.replace(/^\uFEFF/, ''));
        for (const row of rows) {
          if (!Number.isSafeInteger(row.ProcessId) || row.ProcessId < 2) continue;
          this.parents.set(row.ProcessId, row.ParentProcessId); commands.set(row.ProcessId, row.Name + ' ' + (row.CommandLine || ''));
        }
        this.running.push(...windowsResumeCandidates(files, rows));
      } else {
        const ps = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 1500, maxBuffer: 2 * 1024 * 1024 });
        for (const line of ps.split('\n')) {
          const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
          if (m) { this.parents.set(Number(m[1]), Number(m[2])); commands.set(Number(m[1]), m[3]); }
        }
      }
    } catch { this.error = '无法读取本机进程归属'; return; }
    const claudeRoot = path.join(getClaudeConfigDir(os.homedir()), 'sessions');
    try {
      for (const file of fs.readdirSync(claudeRoot)) {
        if (!/^\d+\.json$/.test(file)) continue;
        try {
          const data = readDocument(path.join(claudeRoot, file));
          const key = `claude:${data.sessionId}`;
          if (validId(data.sessionId) && keys.has(key) && Number.isSafeInteger(data.pid)
            && isClaudeProcess(commands.get(data.pid) || ''))
            this.running.push({ key, pid: data.pid, evidence: 'Claude 进程会话登记' });
        } catch { /* Registry entry is being replaced or belongs to an older client. */ }
      }
    } catch { /* Claude does not expose a registry in every version. */ }
    if (process.platform === 'win32') return;
    const locks = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'thread-writer-locks');
    try {
      const paths = fs.readdirSync(locks).filter(f => f.endsWith('.lock') && validId(f.slice(0, -5)) && keys.has(`codex:${f.slice(0, -5)}`)).map(f => path.join(locks, f));
      if (!paths.length) return;
      // ponytail: one bounded lsof scan; batch if more than 200 simultaneously loaded threads become common.
      const output = execFileSync('/usr/sbin/lsof', ['-Fpcn', '--', ...paths.slice(0, 200)], { encoding: 'utf8', timeout: 1500, maxBuffer: 1024 * 1024 });
      let pid = 0; let codex = false;
      for (const line of output.split('\n')) {
        if (line.startsWith('p')) { pid = Number(line.slice(1)); codex = false; }
        if (line.startsWith('c')) codex = /codex/i.test(line.slice(1));
        if (line.startsWith('n') && codex && this.parents.has(pid) && paths.includes(line.slice(1))) {
          const key = `codex:${path.basename(line.slice(1), '.lock')}`;
          this.running.push({ key, pid, evidence: 'Codex 进程持有会话文件' });
        }
      }
    } catch { /* Unheld stale files are deliberately not candidates. */ }
  }
}
