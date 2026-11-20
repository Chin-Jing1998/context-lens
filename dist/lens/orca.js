import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { readDocument, record } from './settings.js';
const require = createRequire(import.meta.url);
export function isOrcaApp(command) {
    return /\/Orca\.app\/Contents\/MacOS\/Orca$|^Orca(?:\.exe)?(?:\s|$)/i.test(command.replaceAll('\\', '/'));
}
export function isOrcaTerminalHost(command) {
    return /\/Orca Agents\.app\/Contents\/MacOS\/Orca Agents$/.test(command);
}
export function withinWorkspace(cwd, workspace) {
    if (!path.isAbsolute(cwd) || !path.isAbsolute(workspace))
        return false;
    const resolved = (value) => { try {
        return realpathSync(value);
    }
    catch {
        return path.resolve(value);
    } };
    const relative = path.relative(resolved(workspace), resolved(cwd));
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function orcaResult(args) {
    const candidates = process.platform === 'darwin'
        ? [path.join(os.homedir(), 'Applications/Orca.app/Contents/Resources/bin/orca'), '/Applications/Orca.app/Contents/Resources/bin/orca']
        : [path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'Programs/Orca/resources/bin/orca.exe')];
    const executable = candidates.find(existsSync);
    if (!executable)
        return {};
    try {
        const stdout = execFileSync(executable, [...args, '--environment', 'local', '--json'], { encoding: 'utf8', timeout: 900, maxBuffer: 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const envelope = record(JSON.parse(stdout));
        return envelope.ok === true ? record(envelope.result) : {};
    }
    catch {
        return {};
    }
}
export function orcaWorkspace(data = orcaResult(['worktree', 'ps', '--limit', '100'])) {
    const worktrees = Array.isArray(data.worktrees) ? data.worktrees.map(record).filter(row => row.isActive === true) : [];
    const [active] = worktrees;
    if (worktrees.length !== 1 || active.hostId !== 'local' || active.environment?.id !== 'local'
        || typeof active.worktreeId !== 'string' || typeof active.path !== 'string' || !path.isAbsolute(active.path))
        return undefined;
    return { id: active.worktreeId, cwd: active.path, terminals: Number.isSafeInteger(active.liveTerminalCount) ? active.liveTerminalCount : 0 };
}
/** 终端布局只记录终端选项卡。当前 Orca 配置可进一步确认用户选中的选项卡。 */
export function orcaSelectedTab(workspace) {
    if (process.platform !== 'darwin')
        return undefined;
    const root = path.join(os.homedir(), 'Library/Application Support/Orca');
    try {
        const profile = readDocument(path.join(root, 'orca-profile-index.json')).activeProfileId;
        if (typeof profile !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(profile))
            return undefined;
        const file = path.join(root, 'profiles', profile, 'profile-state.db');
        if (!existsSync(file))
            return undefined;
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(file, { readOnly: true, timeout: 100, allowExtension: false });
        try {
            db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF');
            const keys = [['activeWorktreeId'], ['activeWorkspaceExecutionHostId'], ['activeTabId'],
                ['activeTabIdByWorktree', workspace.id], ['activeTabTypeByWorktree', workspace.id]].map(key => JSON.stringify(key));
            const rows = db.prepare(`SELECT part_key, payload FROM profile_state_document_parts
        WHERE domain='workspaceSession' AND part_key IN (?,?,?,?,?) AND length(payload)<=4096`).all(...keys);
            const parts = new Map(rows.map(row => [row.part_key, JSON.parse(String(row.payload))]));
            if (parts.size < 3)
                return undefined;
            if (parts.get(keys[0]) !== workspace.id || parts.get(keys[1]) !== 'local')
                return null;
            const tab = parts.get(keys[2]);
            // 切换到聊天或文件时，全局终端标识可能仍保留上一次的值。
            if (parts.get(keys[4]) !== 'terminal' || parts.get(keys[3]) !== tab)
                return null;
            return typeof tab === 'string' && /^[\w.:-]{1,200}$/.test(tab) ? tab : null;
        }
        finally {
            db.close();
        }
    }
    catch {
        return undefined;
    }
}
function selectedPanes(node, selectedTab, depth = 0) {
    if (depth > 16)
        return [];
    const entry = record(node);
    if (entry.type === 'split')
        return [...selectedPanes(entry.first, selectedTab, depth + 1), ...selectedPanes(entry.second, selectedTab, depth + 1)];
    if (selectedTab !== undefined && selectedTab !== entry.activeTabId)
        return [];
    const tab = Array.isArray(entry.tabs) ? entry.tabs.find(tab => tab?.tabId === entry.activeTabId) : undefined;
    return typeof tab?.tabId === 'string' && typeof tab?.activeLeafId === 'string' ? [tab.tabId + ':' + tab.activeLeafId] : [];
}
export function orcaPanePid(workspace, read = orcaResult, selectedTab) {
    const layout = read(['terminal', 'list', '--include-visual-layouts', '--limit', '100']);
    if (!Array.isArray(layout.visualLayouts) || !Array.isArray(layout.terminals))
        return undefined;
    const panes = layout.visualLayouts.filter(row => row?.worktreeId === workspace.id).flatMap(row => selectedPanes(row.root, selectedTab));
    if (panes.length !== 1 || !layout.terminals.some(terminal => terminal?.executionHostId === 'local'
        && terminal.connected === true && terminal.worktreeId === workspace.id && terminal.tabId + ':' + terminal.leafId === panes[0]))
        return undefined;
    const memory = read(['diagnostics', 'memory']);
    const row = Array.isArray(memory.worktrees) ? memory.worktrees.find(row => row?.worktreeId === workspace.id) : undefined;
    // 终端 PID 按窗格标识关联，兼容 Orca 对诊断分组字段的版本差异。
    const pids = new Set(Object.values(record(row)).filter(Array.isArray).flatMap(entries => entries.filter(entry => entry?.paneKey === panes[0] && Number.isSafeInteger(entry.pid) && entry.pid > 1).map(entry => Number(entry.pid))));
    return pids.size === 1 ? pids.values().next().value : undefined;
}
//# sourceMappingURL=orca.js.map