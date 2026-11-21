import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { displayLabel } from '../utils/sanitize.js';
import { validId } from './sessions.js';
import { record } from './settings.js';
import { tokenNumber } from './context.js';
const require = createRequire(import.meta.url);
export function defaultOrcaRoot(platform = process.platform, home = os.homedir(), appData = process.env.APPDATA) {
    if (platform === 'win32')
        return path.win32.join(appData || path.win32.join(home, 'AppData', 'Roaming'), 'orca');
    if (platform === 'darwin')
        return path.join(home, 'Library/Application Support/orca');
}
export function openReadOnlyDb(file) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true, timeout: 100, allowExtension: false });
    try {
        db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF');
        return db;
    }
    catch (error) {
        db.close();
        throw error;
    }
}
function nativeKey(agent, chain, proven) {
    if (!Array.isArray(chain))
        return null;
    const link = proven ? chain.find(item => item?.linkId === proven) : chain.at(-1);
    const h = record(link?.handle);
    let client = agent;
    let id;
    if (agent === 'claude' && h.provider === agent)
        id = h.sessionId;
    else if (agent === 'codex' && h.provider === agent)
        id = h.threadId;
    else if (h.agent === agent || ['opencode', 'opencode2'].includes(agent) && ['opencode', 'opencode2'].includes(h.agent)) {
        id = h.nativeId;
        if (agent === 'antigravity') {
            if (typeof id !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))
                return null;
            client = 'agy';
        }
        if (agent === 'opencode2')
            client = 'opencode';
    }
    return validId(id) && ['claude', 'codex', 'agy', 'opencode', 'mimocode', 'deepseek', 'zcode'].includes(client) ? client + ':' + id : null;
}
function millis(value) {
    const n = tokenNumber(value);
    return n && n <= Date.now() + 60_000 ? n : null;
}
function contextFacts(db, id) {
    const epoch = db.prepare('SELECT epoch FROM journal_chat_state WHERE session_id=?').get(id)?.epoch;
    if (typeof epoch !== 'string')
        return undefined;
    const clear = db.prepare(`SELECT sequence, json_extract(payload_json,'$.observedAt') at FROM journal_items
    WHERE session_id=? AND epoch=? AND root=1 AND hidden=0 AND context_clear=1 ORDER BY sequence DESC LIMIT 1`).get(id, epoch);
    // 窗口容量与用量可由不同回合更新。分别取本代次清空后的最后一项。
    const latest = (part) => {
        const row = db.prepare(`SELECT json_extract(payload_json,'$.body.contextUsage.${part}') fact
      FROM journal_items WHERE session_id=? AND epoch=? AND sequence>? AND root=1 AND hidden=0
      AND kind='turn' AND context_window=1 AND json_type(payload_json,'$.body.contextUsage.${part}')='object'
      ORDER BY sequence DESC,sequence_index DESC LIMIT 1`).get(id, epoch, clear?.sequence ?? -1);
        return typeof row?.fact === 'string' && row.fact.length <= 262144 ? record(JSON.parse(row.fact)) : {};
    };
    const used = latest('used'), at = millis(used.capturedAt) ?? millis(clear?.at);
    if (!at)
        return undefined;
    const empty = { kind: 'unknown', at, used: null, window: null };
    if (used.kind === 'report') {
        const window = tokenNumber(used.windowTokens), tokens = tokenNumber(used.usedTokens);
        if (!window || tokens === null)
            return empty;
        const percent = typeof used.percentage === 'number' && Number.isFinite(used.percentage) && used.percentage >= 0 ? used.percentage : undefined;
        const threshold = tokenNumber(used.autoCompactAtTokens);
        const categories = (Array.isArray(used.categories) ? used.categories.slice(0, 64) : []).flatMap(row => {
            const name = displayLabel(row?.name, 80), count = tokenNumber(row?.tokens);
            return name && count !== null && !row.deferred ? [{ name, tokens: count }] : [];
        });
        return { kind: 'report', at, used: tokens, window, percent, model: displayLabel(used.model, 256),
            threshold: threshold && threshold <= window ? threshold : undefined, categories };
    }
    if (used.kind !== 'estimate')
        return empty;
    const usage = record(used.usage), fields = [usage.inputTokens, usage.cacheReadInputTokens, usage.cacheCreationInputTokens].map(tokenNumber);
    if (fields.some(n => n === null))
        return empty;
    const tokens = tokenNumber(fields.reduce((sum, n) => sum + n, 0));
    const window = latest('window');
    return tokens ? { kind: 'estimate', at, used: tokens, window: millis(window.capturedAt) ? tokenNumber(window.tokens) || null : null } : empty;
}
/** 仅将 Orca 当前记录所属发行版的本地路径映射到 Windows。 */
export function orcaLocalPath(value, distro, platform = process.platform) {
    if (typeof value !== 'string' || !value || value.includes('\0'))
        return undefined;
    if (platform !== 'win32')
        return path.posix.isAbsolute(value) ? value : undefined;
    if (/^[a-z]:[\\/]/i.test(value))
        return path.win32.normalize(value);
    const unc = /^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)\\(.*)$/i.exec(value);
    distro ??= unc?.[1];
    if (typeof distro !== 'string' || !/^[\w][\w. -]{0,79}$/.test(distro))
        return undefined;
    if (unc && unc[1].toLowerCase() !== distro.toLowerCase())
        return undefined;
    const linux = unc ? '/' + unc[2].replaceAll('\\', '/') : value;
    if (!linux.startsWith('/') || linux.startsWith('//') || linux.includes('\\') || linux.split('/').includes('..'))
        return undefined;
    return path.win32.join('\\\\wsl.localhost\\' + distro + '\\', ...linux.split('/'));
}
const activeWslHomes = new Map();
export function registerWslHome(distro) {
    if (process.platform !== 'win32' || activeWslHomes.has(distro) || !/^[\w][\w. -]{0,79}$/.test(distro))
        return;
    try {
        const launcher = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe');
        const output = execFileSync(launcher, ['--distribution', distro, '--exec', '/usr/bin/printenv', 'HOME'], { encoding: 'utf8', timeout: 900, maxBuffer: 8192, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const home = orcaLocalPath(output.trim(), distro);
        if (home)
            activeWslHomes.set(distro, home);
    }
    catch { /* 发行版暂不可用。 */ }
}
export function terminalNativeKey(root, id, agent, distro) {
    if (!root || !validId(id))
        return null;
    let db;
    try {
        db = openReadOnlyDb(path.join(root, 'agent-hooks', 'agent-identities.db'));
        const links = db.prepare(`SELECT DISTINCT provider_session_id id, wsl_distro distro FROM provider_links
      WHERE orca_session_id=? AND execution_host='local' AND agent=? LIMIT 2`).all(id, agent);
        if (links.length !== 1 || !validId(links[0].id) || distro && links[0].distro !== distro)
            return null;
        if (typeof links[0].distro === 'string' && links[0].distro)
            registerWslHome(links[0].distro);
        return nativeKey(agent, [{ handle: { agent, nativeId: links[0].id } }], null);
    }
    catch {
        return null;
    }
    finally {
        db?.close();
    }
}
export function orcaAccountRoots(root = defaultOrcaRoot()) {
    const result = { claude: [], codex: [], agy: [] };
    for (const home of activeWslHomes.values()) {
        result.claude.push(path.win32.join(home, '.claude', 'projects'));
        result.codex.push(path.win32.join(home, '.codex', 'sessions'));
        result.agy.push(path.win32.join(home, '.gemini', 'antigravity-cli'));
    }
    if (!root)
        return result;
    let db;
    try {
        db = openReadOnlyDb(path.join(root, 'agent-session-domain.db'));
        const rows = db.prepare(`SELECT DISTINCT json_extract(record_json,'$.accountHome.variable') variable,
      json_extract(record_json,'$.accountHome.path') home, json_extract(record_json,'$.location.wslDistro') distro
      FROM agent_session_records WHERE json_extract(record_json,'$.location.executionHostId')='local'`).all();
        for (const row of rows) {
            const home = orcaLocalPath(row.home, row.distro);
            if (!home)
                continue;
            if (row.variable === 'CLAUDE_CONFIG_DIR')
                result.claude.push(path.join(home, 'projects'));
            if (row.variable === 'CODEX_HOME')
                result.codex.push(path.join(home, 'sessions'));
            if (row.variable === 'GEMINI_HOME')
                result.agy.push(existsSync(path.join(home, 'conversation_summaries.db')) ? home : path.join(home, 'antigravity-cli'));
        }
    }
    catch { /* Orca 未安装或此版本没有账户登记。 */ }
    finally {
        db?.close();
    }
    return result;
}
export function readOrcaSession(id, workspaceId, root = defaultOrcaRoot(), withFacts = true) {
    if (!root || !validId(id))
        return undefined;
    const file = path.join(root, 'agent-session-domain.db');
    if (!existsSync(file))
        return undefined;
    let db;
    try {
        db = openReadOnlyDb(file);
        db.exec('BEGIN');
        const row = db.prepare(`SELECT session_id, json_extract(record_json,'$.sessionId') id,
      json_extract(record_json,'$.provider') agent, json_extract(record_json,'$.location.workspaceId') AS workspace_id,
      CASE WHEN length(json_extract(record_json,'$.providerHandleChain')) <= 262144 THEN json_extract(record_json,'$.providerHandleChain') END handles, json_extract(record_json,'$.lease.provenHandleLinkId') proven,
      json_extract(record_json,'$.options.model') model, json_extract(record_json,'$.options.effort') effort,
      json_extract(record_json,'$.conversationName') title, json_extract(record_json,'$.lastTurn.state') state,
      json_extract(record_json,'$.lastTurn.outcome') outcome, json_extract(record_json,'$.createdAt') created,
      json_extract(record_json,'$.updatedAt') updated FROM agent_session_records WHERE session_id=?
      AND json_extract(record_json,'$.location.executionHostId')='local'`).get(id);
        if (!row || row.id !== id || typeof row.workspace_id !== 'string' || workspaceId !== undefined && workspaceId !== row.workspace_id)
            return undefined;
        const agent = displayLabel(row.agent, 80);
        if (!agent)
            return undefined;
        const result = { id, workspaceId: row.workspace_id, agent, nativeKey: nativeKey(agent, JSON.parse(String(row.handles ?? '[]')), row.proven), title: displayLabel(row.title, 200), model: displayLabel(row.model, 256),
            effort: displayLabel(row.effort, 32), state: displayLabel(row.outcome === 'failure' || row.outcome === 'cancellation' ? 'interrupted' : row.state, 32),
            createdAt: millis(row.created), updatedAt: millis(row.updated) };
        if (withFacts) {
            try {
                result.facts = contextFacts(db, id);
            }
            catch { /* 较早的 Orca 可能只有会话登记。 */ }
        }
        return result;
    }
    catch {
        return undefined;
    }
    finally {
        db?.close();
    }
}
//# sourceMappingURL=orca-session.js.map