import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sessionKey, validId } from './sessions.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
const fileName = /^(local_[a-zA-Z0-9_-]{1,94})\.json$/;
const normalizeTitle = (value) => value.replace(/\s+/g, ' ').trim();
const genericTitle = /^(?:Claude(?: Code)?|Code|New (?:chat|conversation|session)|Untitled(?: (?:chat|conversation|session))?|新(?:建)?(?:对话|会话)|未命名(?:对话|会话)?)$/i;
const MAX_BYTES = 256 * 1024;
const defaultRoots = () => process.platform === 'darwin' ? ['Claude', 'Claude-3p']
    .map(name => path.join(os.homedir(), 'Library/Application Support', name, 'claude-code-sessions')) : [];
/** A bounded, read-only index. Metadata never supplies a path to a transcript. */
export class ClaudeDesktopSessions {
    roots;
    now;
    at = -Infinity;
    rows = [];
    blocked = new Set();
    complete = true;
    constructor(roots = defaultRoots(), now = Date.now) {
        this.roots = roots;
        this.now = now;
    }
    describe(files) {
        if (!files.some(file => file.client === 'claude' && !file.parentId))
            return files;
        this.refresh();
        if (!this.complete)
            return files;
        const byCli = new Map();
        for (const row of this.rows) {
            if (this.blocked.has(row.sessionId))
                continue;
            const matches = byCli.get(row.cliSessionId) ?? [];
            matches.push(row);
            byCli.set(row.cliSessionId, matches);
        }
        return files.map(file => {
            const matches = file.client === 'claude' && !file.parentId ? byCli.get(file.id) : undefined;
            if (!matches?.length || new Set(matches.map(row => row.sessionId)).size !== 1)
                return file;
            const titles = new Set(matches.map(row => row.title).filter(Boolean));
            const models = new Set(matches.map(row => row.model).filter(Boolean));
            return { ...file, surface: 'desktop', title: (!file.title || file.title === '未命名对话') && titles.size === 1 ? [...titles][0] : file.title,
                model: file.model || (models.size === 1 ? [...models][0] : '') };
        });
    }
    resolve(files, hint) {
        if (!hint?.id && !hint?.title)
            return undefined;
        const eligible = files.filter(file => file.client === 'claude' && !file.parentId);
        if (hint.id) {
            const direct = eligible.filter(file => file.id === hint.id);
            if (direct.length)
                return direct.length === 1 ? sessionKey(direct[0]) : null;
            if (!/^local_[a-zA-Z0-9_-]{1,94}$/.test(hint.id))
                return null;
        }
        const title = normalizeTitle(hint.title ?? '');
        if (!hint.id && (!title || title.length > 200 || genericTitle.test(title)))
            return null;
        this.refresh();
        if (!this.complete || hint.id && this.blocked.has(hint.id) || !hint.id && this.blocked.size)
            return null;
        const rows = this.rows.filter(row => hint.id ? row.sessionId === hint.id : row.title === title);
        if (rows.some(row => this.blocked.has(row.sessionId)))
            return null;
        const ids = new Set(rows.map(row => row.cliSessionId));
        if (!hint.id)
            for (const file of eligible)
                if (normalizeTitle(file.title ?? '') === title)
                    ids.add(file.id);
        if (ids.size !== 1)
            return null;
        const matches = eligible.filter(file => ids.has(file.id));
        return matches.length === 1 ? sessionKey(matches[0]) : null;
    }
    refresh() {
        const now = this.now();
        if (now >= this.at && now - this.at < 1000)
            return;
        this.at = now;
        this.rows = [];
        this.blocked.clear();
        this.complete = true;
        let entries = 0, directories = 0, records = 0, bytes = 0;
        try {
            if (this.roots.length > 2)
                throw new Error('Too many desktop roots');
            const children = (directory) => {
                let stat;
                try {
                    stat = fs.lstatSync(directory);
                }
                catch (error) {
                    if (error.code === 'ENOENT')
                        return [];
                    throw error;
                }
                if (!stat.isDirectory() || stat.isSymbolicLink())
                    return [];
                if (++directories > 128)
                    throw new Error('Desktop directory limit');
                const result = [], handle = fs.opendirSync(directory);
                try {
                    for (let entry; (entry = handle.readSync());) {
                        if (++entries > 4096)
                            throw new Error('Desktop entry limit');
                        result.push(entry);
                    }
                }
                finally {
                    handle.closeSync();
                }
                return result;
            };
            for (const root of this.roots) {
                const accounts = children(root);
                if (!accounts.length)
                    continue;
                const realRoot = fs.realpathSync(root) + path.sep;
                for (const account of accounts.filter(entry => entry.isDirectory() && !entry.isSymbolicLink())) {
                    const accountPath = path.join(root, account.name);
                    for (const org of children(accountPath).filter(entry => entry.isDirectory() && !entry.isSymbolicLink())) {
                        const orgPath = path.join(accountPath, org.name);
                        for (const entry of children(orgPath)) {
                            const id = fileName.exec(entry.name)?.[1];
                            if (!id)
                                continue;
                            if (++records > 1024)
                                throw new Error('Desktop record limit');
                            let row, descriptor;
                            try {
                                const file = path.join(orgPath, entry.name);
                                if (!entry.isFile() || entry.isSymbolicLink() || !fs.realpathSync(file).startsWith(realRoot))
                                    throw new Error('Unsafe desktop record');
                                descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
                                const before = fs.fstatSync(descriptor);
                                if (!before.isFile() || before.size > MAX_BYTES)
                                    throw new Error('Invalid desktop record size');
                                bytes += before.size;
                                if (bytes > 4 * 1024 * 1024)
                                    throw new Error('Desktop byte limit');
                                const buffer = Buffer.alloc(before.size + 1);
                                const length = fs.readSync(descriptor, buffer, 0, buffer.length, 0), after = fs.fstatSync(descriptor);
                                if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
                                    throw new Error('Desktop record changed');
                                const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
                                if (data.sessionId !== id || !validId(data.cliSessionId))
                                    throw new Error('Invalid desktop identity');
                                row = { sessionId: id, cliSessionId: data.cliSessionId,
                                    title: typeof data.title === 'string' && data.title.length <= 200 ? normalizeTitle(sanitizeDisplayText(data.title)) : '',
                                    model: typeof data.model === 'string' && data.model.length <= 160 ? sanitizeDisplayText(data.model) : '' };
                            }
                            catch {
                                this.blocked.add(id);
                            }
                            finally {
                                if (descriptor !== undefined)
                                    fs.closeSync(descriptor);
                            }
                            if (bytes > 4 * 1024 * 1024)
                                throw new Error('Desktop byte limit');
                            if (row)
                                this.rows.push(row);
                        }
                    }
                }
            }
            const identities = new Map();
            for (const row of this.rows) {
                const previous = identities.get(row.sessionId);
                if (previous && previous !== row.cliSessionId)
                    this.blocked.add(row.sessionId);
                identities.set(row.sessionId, row.cliSessionId);
            }
        }
        catch {
            this.rows = [];
            this.blocked.clear();
            this.complete = false;
        }
    }
}
export const claudeDesktopSessions = new ClaudeDesktopSessions();
//# sourceMappingURL=claude-desktop.js.map