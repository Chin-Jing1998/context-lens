import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { getClaudeConfigDir } from '../claude-config-dir.js';
import { readDocument } from './settings.js';
import { sessionKey, validId, type SessionFile } from './sessions.js';
import { ClaudeDesktopSessions, claudeDesktopSessions } from './claude-desktop.js';
import { agyId, agyRoots } from './agy.js';
import { isOrcaApp, isOrcaTerminalHost, useWindowsOrcaInstall, orcaPaneAgent, orcaForegroundSelection, orcaPanePid, orcaWorkspace, withinWorkspace } from './orca.js';

import { readOrcaSession, orcaLocalPath, orcaAccountRoots, type OrcaSession } from './orca-session.js';

interface Running { key: string; pid: number; evidence: string }
export interface ActiveResult { orcaSession?: string; selected: string | null; reason: string; candidates: Running[] }
export interface VisibleSessionHint { id?: string; title?: string; cwd?: string; tty?: string }
export interface ActiveSessionInfo { id: string; client: string; surface?: 'desktop' | 'cli'; parentId?: string; title?: string; cwd: string; lastUserAt?: number }
export interface WindowsProcess { ProcessId: number; ParentProcessId: number; Name: string; CommandLine?: string | null; ExecutablePath?: string }
export function isClaudeProcess(command: string): boolean {
  return /(?:^|\/|\s)claude(?:\.exe)?(?:$|\s)|@anthropic-ai\/claude-code(?:\/|$)/i.test(command.replaceAll('\\', '/'));
}
export function windowsResumeCandidates(files: ActiveSessionInfo[], processes: WindowsProcess[]): Running[] {
  const available = new Set(files.filter(file => !file.parentId).map(sessionKey));
  return processes.flatMap(process => {
    const agent = /^(codex|claude|agy)(?:\.exe)?$/i.exec(process.Name);
    const client = agent?.[1].toLowerCase();
    const id = /(?:^|\s)(?:resume|--resume|--session-id|--conversation-id)(?:\s+|=)["']?([a-zA-Z0-9_-]{1,100})(?:["']?(?:\s|$))/.exec(process.CommandLine || '')?.[1];
    return client && id && (client !== 'agy' || agyId.test(id)) && available.has(`${client}:${id}`) && Number.isSafeInteger(process.ProcessId) && process.ProcessId > 1
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

export function inProcessTree(pid: number, targetPid: number, parents: Map<number, number>): boolean {
  for (let i = 0; i < 30 && pid > 1; i++) {
    if (pid === targetPid) return true;
    pid = parents.get(pid) ?? 0;
  }
  return false;
}

export function chooseActive(candidates: Running[], parents: Map<number, number>, targetPid?: number, activity = new Map<string, number>()): ActiveResult {
  const matching = targetPid ? candidates.filter(candidate => inProcessTree(candidate.pid, targetPid, parents)) : candidates;
  const unique = [...new Map(matching.map(c => [c.key, c])).values()];
  const recent = unique.filter(c => (activity.get(c.key) ?? 0) > 0).sort((a, b) => activity.get(b.key)! - activity.get(a.key)!);
  const latest = recent.length && (recent.length === 1 || activity.get(recent[0].key)! > activity.get(recent[1].key)!) ? recent[0] : undefined;
  return { selected: unique.length === 1 ? unique[0].key : latest?.key ?? null, candidates: unique,
    reason: unique.length === 1 ? `已定位运行中的会话 · ${unique[0].evidence}`
      : latest ? '已跟随最近交互的活跃对话'
      : unique.length ? '正在等待当前对话的活动记录'
        : '等待本机活跃会话' };
}

export function agyLockCandidates(output: string, directory: string, commands: Map<number, string>): Running[] {
  let pid = 0;
  const result: Running[] = [];
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    if (!line.startsWith('n') || !pid || path.basename(commands.get(pid) ?? '') !== 'agy') continue;
    const file = line.slice(1), id = path.basename(file, '.lock');
    if (path.dirname(file) === directory && file.endsWith('.lock') && agyId.test(id)) {
      result.push({ key: `agy:${id}`, pid, evidence: 'Antigravity CLI 进程持有会话锁' });
    }
  }
  return result;
}

export function codexResumeCandidates(output: string, files: ActiveSessionInfo[], pids: ReadonlySet<number>): Running[] {
  const ids = new Set(files.filter(file => file.client === 'codex' && !file.parentId).map(file => file.id));
  return output.split('\n').flatMap(line => {
    const row = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!row || !pids.has(Number(row[1]))) return [];
    // Orca 在子命令之前注入守护进程开关和 TOML 配置，配置里的 UUID 不是会话 ID。
    const resume = /^(?:\/[^"\r\n]*\/)?codex(?:\s+--no-daemon|\s+(?:-c|--config)\s+[a-z0-9_.-]+=(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s"']+))*\s+resume\s+(.+)$/i.exec(row[2])?.[1] ?? '';
    if (/(?:^|\s)--last(?=\s|=|$)/.test(resume)) return [];
    // macOS 的 ps 将参数合并为文本。只接受末尾唯一的显式 UUID。
    const matches = [...resume.matchAll(/(?:^|\s)([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?=\s|$)/gi)];
    const id = matches.length === 1 && resume.trimEnd().endsWith(matches[0][1]) ? matches[0][1] : '';
    return ids.has(id) ? [{ key: `codex:${id}`, pid: Number(row[1]), evidence: 'Codex 显式恢复会话' }] : [];
  });
}

export function orcaChatActive(host: OrcaSession | undefined, available: ReadonlySet<string>, client?: string): ActiveResult {
  const native = orcaAgentSessionResult(host?.nativeKey ?? null, available, client);
  if (!host) return native;
  if (native.selected) return { ...native, orcaSession: host.id };
  return { ...native, selected: client ? null : 'orca:' + host.id, reason: '已跟随 Orca 前台代理对话' };
}

export function orcaAgentSessionResult(key: string | null, available: ReadonlySet<string>, client?: string): ActiveResult {
  const selected = key && available.has(key) && (!client || key.startsWith(`${client}:`)) ? key : null;
  return { selected, candidates: [], reason: selected ? '已跟随 Orca 前台代理对话' : '等待 Orca 前台唯一会话' };
}

/** Read live ownership evidence, never infer the active session from the newest historical log. */
export class ActiveSessions {
  private paneAgent?: OrcaSession;
  private windowsOrca = new Map<number, string>();
  private windowsOwners: Running[] = [];
  private ownersPending = false;
  terminalSession(id: string): OrcaSession | undefined { return this.paneAgent?.id === id ? this.paneAgent : undefined; }

  private at = 0;
  private running: Running[] = [];
  private parents = new Map<number, number>();
  private commands = new Map<number, string>();
  private error = '';
  private lastInteraction = new Map<string, number>();
  private desktop: ClaudeDesktopSessions;
  constructor(options: { claudeDesktopRoots?: string[]; now?: () => number } = {}) {
    this.desktop = options.claudeDesktopRoots || options.now ? new ClaudeDesktopSessions(options.claudeDesktopRoots, options.now) : claudeDesktopSessions;
  }

  get(files: ActiveSessionInfo[], client?: string, targetPid?: number, hint?: VisibleSessionHint): ActiveResult {
    if (client === 'agy') {
      const desktop = files.filter(file => file.client === 'agy' && file.surface === 'desktop' && !file.parentId);
      const selected = hint?.id && agyId.test(hint.id) ? visibleSession(desktop, client, { id: hint.id }) ?? null : null;
      return { selected, candidates: [], reason: selected ? '已跟随 Antigravity 桌面对话' : '等待 Antigravity 桌面对话' };
    }
    const visible = client === 'claude' ? this.desktop.resolve(files, hint) : visibleSession(files, client, hint);
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
    if (targetPid && isOrcaApp(this.commands.get(targetPid) ?? '')) {
      useWindowsOrcaInstall(this.windowsOrca.get(targetPid));
      const workspace = orcaWorkspace();
      const selection = workspace ? orcaForegroundSelection(workspace) : undefined;
      if (!workspace || !selection) return orcaAgentSessionResult(null, available, client);
      if (selection.kind === 'agent-session') {
        const host = selection.sessionId ? readOrcaSession(selection.sessionId, workspace.id, undefined, false) : undefined;
        return orcaChatActive(host, available, client);
      }
      if (selection.kind === 'other') {
        return { selected: null, candidates: [], reason: '等待 Orca 前台唯一会话' };
      }
      const tab = selection.tabId;
      this.paneAgent = orcaPaneAgent(workspace, tab);
      if (this.paneAgent?.nativeKey && available.has(this.paneAgent.nativeKey)) {
        return { selected: this.paneAgent.nativeKey, orcaSession: this.paneAgent.id, candidates: [], reason: '已跟随 Orca 当前终端会话' };
      }
      const owners = [...this.commands].filter(([, command]) => isOrcaTerminalHost(command)).map(([pid]) => pid);
      const scoped = running.filter(candidate => {
        const local = inProcessTree(candidate.pid, targetPid, this.parents);
        const file = files.find(file => sessionKey(file) === candidate.key);
        return !!file && withinWorkspace(orcaLocalPath(file.cwd, workspace.wslDistro) ?? '', workspace.cwd)
          && (local || owners.some(pid => inProcessTree(candidate.pid, pid, this.parents)));
      });
      const pane = orcaPanePid(workspace, undefined, tab);
      let result = chooseActive(pane ? scoped : [], this.parents, pane);
      if (pane && !result.candidates.length && process.platform === 'darwin'
        && (inProcessTree(pane, targetPid, this.parents) || owners.some(pid => inProcessTree(pane, pid, this.parents)))) {
        result = chooseActive(this.resumedCodex(files, pane, workspace.cwd), this.parents);
      }
      if (!result.selected && this.paneAgent && !client && !result.candidates.length) {
        return { selected: 'orca:' + this.paneAgent.id, candidates: [], reason: '已跟随 Orca 前台终端代理' };
      }
      if (!result.selected) result.reason = '等待 Orca 前台唯一会话';
      return result;
    }
    const result = chooseActive(running, this.parents, targetPid, activity);
    if (result.candidates.length > 1 && result.candidates.some(candidate => candidate.key.startsWith('agy:'))) {
      result.selected = null; result.reason = '等待唯一的前台终端会话';
    }
    if (!result.candidates.length && this.error) result.reason = this.error;
    return result;
  }

  private resumedCodex(files: ActiveSessionInfo[], pane: number, cwd: string): Running[] {
    const pids = [...this.commands].filter(([pid, command]) => path.basename(command) === 'codex'
      && inProcessTree(pid, pane, this.parents)).map(([pid]) => pid).slice(0, 24);
    if (!pids.length) return [];
    try {
      const output = execFileSync('/bin/ps', ['-ww', '-p', pids.join(','), '-o', 'pid=,command='],
        { encoding: 'utf8', timeout: 700, maxBuffer: 256 * 1024 });
      return codexResumeCandidates(output, files.filter(file => withinWorkspace(file.cwd, cwd)), new Set(pids));
    } catch { return []; }
  }

  private scanWindowsAgy(files: ActiveSessionInfo[], rows: WindowsProcess[]): void {
    const pids = rows.filter(row => /^agy\.exe$/i.test(row.Name)).map(row => row.ProcessId);
    const keys = new Set(files.filter(f => f.client === 'agy' && f.surface === 'cli' && !f.parentId).map(sessionKey));
    this.running.push(...this.windowsOwners.filter(r => pids.includes(r.pid) && keys.has(r.key)));
    if (this.ownersPending || !pids.length || !keys.size) return;
    const locks = new Map<string, string>();
    for (const root of new Set([agyRoots().cli, ...orcaAccountRoots().agy])) {
      // WSL 的锁属于 Linux 内核，使用 Orca 提供的窗格与原生会话关联。
      if (root.startsWith('\\\\')) continue;
      const dir = path.join(root, 'presence');
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const id = entry.name.slice(0, -5), key = 'agy:' + id;
          if (entry.isFile() && entry.name.endsWith('.lock') && keys.has(key) && agyId.test(id)) locks.set(path.join(dir, entry.name), key);
        }
      } catch { /* 这个账户当前没有进程会话锁。 */ }
    }
    if (!locks.size) { this.windowsOwners = []; return; }
    const script = fs.readFileSync(new URL('../../desktop/windows/agy-presence.ps1', import.meta.url), 'utf8');
    this.ownersPending = true;
    const child = execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      { timeout: 12000, maxBuffer: 262144, windowsHide: true }, (error, output) => {
        this.ownersPending = false;
        this.windowsOwners = [];
        if (error) return;
        try {
          const owners = JSON.parse(output.replace(/^\uFEFF/, ''));
          for (const row of owners) {
            const key = locks.get(row.file);
            if (key && pids.includes(row.pid)) this.windowsOwners.push({ key, pid: row.pid, evidence: 'AGY 进程持有会话锁' });
          }
        } catch { /* 进程可能已经退出。 */ }
      });
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify({ pids, files: [...locks.keys()] }));
  }

  private scan(files: ActiveSessionInfo[]): void {
    this.at = Date.now(); this.running = []; this.parents.clear(); this.error = '';
    if (!['darwin', 'win32'].includes(process.platform)) { this.error = '自动定位目前支持 macOS 和 Windows'; return; }
    const keys = new Set(files.filter(f => !f.parentId).map(sessionKey));
    const commands = this.commands;
    commands.clear();
    try {
      if (process.platform === 'win32') {
        const command = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,ExecutablePath) | ConvertTo-Json -Compress";
        const ps = execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
          { encoding: 'utf8', timeout: 3500, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
        const rows: WindowsProcess[] = JSON.parse(ps.replace(/^\uFEFF/, ''));
        this.windowsOrca.clear();
        for (const row of rows) {
          if (/^orca\.exe$/i.test(row.Name) && row.ExecutablePath) this.windowsOrca.set(row.ProcessId, row.ExecutablePath);
          if (!Number.isSafeInteger(row.ProcessId) || row.ProcessId < 2) continue;
          this.parents.set(row.ProcessId, row.ParentProcessId); commands.set(row.ProcessId, row.Name + ' ' + (row.CommandLine || ''));
        }
        this.running.push(...windowsResumeCandidates(files, rows));
        this.scanWindowsAgy(files, rows);
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
    const agyPids = [...commands].filter(([, command]) => path.basename(command) === 'agy').map(([pid]) => pid);
    if (agyPids.length && files.some(file => file.client === 'agy' && file.surface === 'cli')) {
      try {
        const directory = fs.realpathSync(path.join(agyRoots().cli, 'presence'));
        const output = execFileSync('/usr/sbin/lsof', ['-p', agyPids.join(','), '-Fpn'],
          { encoding: 'utf8', timeout: 1200, maxBuffer: 1024 * 1024 });
        this.running.push(...agyLockCandidates(output, directory, commands));
      } catch { /* 会话锁已释放或进程已退出。 */ }
    }
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
