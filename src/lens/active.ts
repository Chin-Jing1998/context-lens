import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getClaudeConfigDir } from '../claude-config-dir.js';
import { readDocument } from './settings.js';
import { sessionKey, validId, type SessionFile } from './sessions.js';

interface Running { key: string; pid: number; evidence: string }
export interface ActiveResult { selected: string | null; reason: string; candidates: Running[] }

export function chooseActive(candidates: Running[], parents: Map<number, number>, targetPid?: number): ActiveResult {
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
  return { selected: unique.length === 1 ? unique[0].key : null, candidates: unique,
    reason: unique.length === 1 ? `已定位运行中的会话 · ${unique[0].evidence}`
      : unique.length ? `检测到 ${unique.length} 个运行中的会话，请在列表中明确选择`
        : '等待 Claude / Codex 本机会话；不会绑定历史日志' };
}

/** Read live ownership evidence, never infer the active session from the newest historical log. */
export class ActiveSessions {
  private at = 0;
  private running: Running[] = [];
  private parents = new Map<number, number>();
  private error = '';

  get(files: SessionFile[], client?: string, targetPid?: number): ActiveResult {
    if (Date.now() - this.at > 2000) this.scan(files);
    const result = chooseActive(this.running.filter(c => !client || c.key.startsWith(`${client}:`)), this.parents, targetPid);
    if (!result.candidates.length && this.error) result.reason = this.error;
    return result;
  }

  private scan(files: SessionFile[]): void {
    this.at = Date.now(); this.running = []; this.parents.clear(); this.error = '';
    if (process.platform !== 'darwin') { this.error = '自动定位目前支持 macOS；请在列表中选择会话'; return; }
    const keys = new Set(files.filter(f => !f.parentId).map(sessionKey));
    const commands = new Map<number, string>();
    try {
      const ps = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 1500, maxBuffer: 2 * 1024 * 1024 });
      for (const line of ps.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
        if (m) { this.parents.set(Number(m[1]), Number(m[2])); commands.set(Number(m[1]), m[3]); }
      }
    } catch { this.error = '无法读取本机进程归属；请手动选择会话'; return; }
    const claudeRoot = path.join(getClaudeConfigDir(os.homedir()), 'sessions');
    try {
      for (const file of fs.readdirSync(claudeRoot)) {
        if (!/^\d+\.json$/.test(file)) continue;
        try {
          const data = readDocument(path.join(claudeRoot, file));
          const key = `claude:${data.sessionId}`;
          if (validId(data.sessionId) && keys.has(key) && Number.isSafeInteger(data.pid)
            && /(?:^|[\/])claude(?:$|\s)/i.test(commands.get(data.pid) || ''))
            this.running.push({ key, pid: data.pid, evidence: 'Claude 进程会话登记' });
        } catch { /* Registry entry is being replaced or belongs to an older client. */ }
      }
    } catch { /* Claude does not expose a registry in every version. */ }
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
