import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sessionKey, validId } from './sessions.js';
import type { ActiveSessionInfo, VisibleSessionHint } from './active.js';

interface DesktopSession { sessionId: string; cliSessionId: string; title: string }
const fileName = /^(local_[a-zA-Z0-9_-]{1,94})\.json$/;
const normalizeTitle = (value: string) => value.replace(/\s+/g, ' ').trim();
const genericTitle = /^(?:Claude(?: Code)?|Code|New (?:chat|conversation|session)|Untitled(?: (?:chat|conversation|session))?|新(?:建)?(?:对话|会话)|未命名(?:对话|会话)?)$/i;
const MAX_BYTES = 256 * 1024;
const defaultRoots = () => process.platform === 'darwin' ? ['Claude', 'Claude-3p']
  .map(name => path.join(os.homedir(), 'Library/Application Support', name, 'claude-code-sessions')) : [];

/** A bounded, read-only index. Metadata never supplies a path to a transcript. */
export class ClaudeDesktopSessions {
  private at = -Infinity;
  private rows: DesktopSession[] = [];
  private blocked = new Set<string>();
  private complete = true;
  constructor(private roots = defaultRoots(), private now = Date.now) {}

  resolve(files: ActiveSessionInfo[], hint?: VisibleSessionHint): string | null | undefined {
    if (!hint?.id && !hint?.title) return undefined;
    const eligible = files.filter(file => file.client === 'claude' && !file.parentId);
    if (hint.id) {
      const direct = eligible.filter(file => file.id === hint.id);
      if (direct.length) return direct.length === 1 ? sessionKey(direct[0]) : null;
      if (!/^local_[a-zA-Z0-9_-]{1,94}$/.test(hint.id)) return null;
    }
    const title = normalizeTitle(hint.title ?? '');
    if (!hint.id && (!title || title.length > 200 || genericTitle.test(title))) return null;
    this.refresh();
    if (!this.complete || hint.id && this.blocked.has(hint.id) || !hint.id && this.blocked.size) return null;
    const rows = this.rows.filter(row => hint.id ? row.sessionId === hint.id : row.title === title);
    if (rows.some(row => this.blocked.has(row.sessionId))) return null;
    const ids = new Set(rows.map(row => row.cliSessionId));
    if (!hint.id) for (const file of eligible) if (normalizeTitle(file.title ?? '') === title) ids.add(file.id);
    if (ids.size !== 1) return null;
    const matches = eligible.filter(file => ids.has(file.id));
    return matches.length === 1 ? sessionKey(matches[0]) : null;
  }

  private refresh(): void {
    const now = this.now();
    if (now >= this.at && now - this.at < 1000) return;
    this.at = now; this.rows = []; this.blocked.clear(); this.complete = true;
    let entries = 0, directories = 0, records = 0, bytes = 0;
    try {
      if (this.roots.length > 2) throw new Error('Too many desktop roots');
      const children = (directory: string): fs.Dirent[] => {
        let stat: fs.Stats;
        try { stat = fs.lstatSync(directory); } catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
        if (!stat.isDirectory() || stat.isSymbolicLink()) return [];
        if (++directories > 128) throw new Error('Desktop directory limit');
        const result: fs.Dirent[] = [], handle = fs.opendirSync(directory);
        try {
          for (let entry; (entry = handle.readSync());) {
            if (++entries > 4096) throw new Error('Desktop entry limit');
            result.push(entry);
          }
        } finally { handle.closeSync(); }
        return result;
      };
      for (const root of this.roots) {
        const accounts = children(root);
        if (!accounts.length) continue;
        const realRoot = fs.realpathSync(root) + path.sep;
        for (const account of accounts.filter(entry => entry.isDirectory() && !entry.isSymbolicLink())) {
          const accountPath = path.join(root, account.name);
          for (const org of children(accountPath).filter(entry => entry.isDirectory() && !entry.isSymbolicLink())) {
            const orgPath = path.join(accountPath, org.name);
            for (const entry of children(orgPath)) {
              const id = fileName.exec(entry.name)?.[1]; if (!id) continue;
              if (++records > 1024) throw new Error('Desktop record limit');
              let row: DesktopSession | undefined, descriptor: number | undefined;
              try {
                const file = path.join(orgPath, entry.name);
                if (!entry.isFile() || entry.isSymbolicLink() || !fs.realpathSync(file).startsWith(realRoot)) throw new Error('Unsafe desktop record');
                descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
                const before = fs.fstatSync(descriptor);
                if (!before.isFile() || before.size > MAX_BYTES) throw new Error('Invalid desktop record size');
                bytes += before.size; if (bytes > 4 * 1024 * 1024) throw new Error('Desktop byte limit');
                const buffer = Buffer.alloc(before.size + 1);
                const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0), after = fs.fstatSync(descriptor);
                if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('Desktop record changed');
                const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
                if (data.sessionId !== id || !validId(data.cliSessionId)) throw new Error('Invalid desktop identity');
                row = { sessionId: id, cliSessionId: data.cliSessionId,
                  title: typeof data.title === 'string' && data.title.length <= 200 ? normalizeTitle(data.title) : '' };
              } catch { this.blocked.add(id); }
              finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
              if (bytes > 4 * 1024 * 1024) throw new Error('Desktop byte limit');
              if (row) this.rows.push(row);
            }
          }
        }
      }
      const identities = new Map<string, string>();
      for (const row of this.rows) {
        const previous = identities.get(row.sessionId);
        if (previous && previous !== row.cliSessionId) this.blocked.add(row.sessionId);
        identities.set(row.sessionId, row.cliSessionId);
      }
    } catch { this.rows = []; this.blocked.clear(); this.complete = false; }
  }
}
