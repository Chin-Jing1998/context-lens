import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { defaultOrcaRoot, openReadOnlyDb, readOrcaSession, orcaLocalPath, terminalNativeKey, registerWslHome, type OrcaSession } from './orca-session.js';
import os from 'node:os';
import path from 'node:path';
import { displayLabel } from '../utils/sanitize.js';
import { validId } from './sessions.js';
import { readDocument, record } from './settings.js';

const ORCA_ID = /^[\w.:-]{1,200}$/;
const MAX_STATE_BYTES = 262144;

export function isOrcaApp(command: string): boolean {
  return /\/Orca\.app\/Contents\/MacOS\/Orca$|^Orca(?:\.exe)?(?:\s|$)/i.test(command.replaceAll('\\', '/'));
}

export function isOrcaTerminalHost(command: string): boolean {
  return /\/Orca Agents\.app\/Contents\/MacOS\/Orca Agents$|^Orca Agents\.exe(?:\s|$)/i.test(command);
}

export function withinWorkspace(cwd: string, workspace: string): boolean {
  if (!path.isAbsolute(cwd) || !path.isAbsolute(workspace)) return false;
  const resolved = (value: string) => { try { return realpathSync(value); } catch { return path.resolve(value); } };
  const relative = path.relative(resolved(workspace), resolved(cwd));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

let foregroundCli: string | undefined;
export function useWindowsOrcaInstall(executable: string | undefined): void {
  if (process.platform !== 'win32') return;
  foregroundCli = executable && path.win32.isAbsolute(executable) && path.win32.basename(executable).toLowerCase() === 'orca.exe'
    ? path.win32.join(path.win32.dirname(executable), 'resources', 'bin', 'orca.exe') : undefined;
}

function orcaResult(args: string[]): Record<string, any> {
  const candidates = process.platform === 'darwin'
    ? [path.join(os.homedir(), 'Applications/Orca.app/Contents/Resources/bin/orca'), '/Applications/Orca.app/Contents/Resources/bin/orca']
    : [foregroundCli, path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'Programs/Orca/resources/bin/orca.exe'),
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Orca/resources/bin/orca.exe')].filter((p): p is string => !!p);
  const executable = candidates.find(existsSync);
  if (!executable) return {};
  try {
    const stdout = execFileSync(executable, [...args, '--environment', 'local', '--json'],
      { encoding: 'utf8', timeout: 900, maxBuffer: 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const envelope = record(JSON.parse(stdout));
    return envelope.ok === true ? record(envelope.result) : {};
  } catch { return {}; }
}

export interface OrcaWorkspace { id: string; cwd: string; terminals: number; wslDistro?: string }
export type OrcaSelection =
  | { kind: 'terminal'; tabId: string }
  | { kind: 'agent-session'; sessionId: string | null }
  | { kind: 'other' };

export function orcaWorkspace(data = orcaResult(['worktree', 'ps', '--limit', '100'])): OrcaWorkspace | undefined {
  const worktrees = Array.isArray(data.worktrees) ? data.worktrees.map(record).filter(row => row.isActive === true) : [];
  const [active] = worktrees;
  if (worktrees.length !== 1 || active.hostId !== 'local' || active.environment?.id !== 'local'
    || typeof active.worktreeId !== 'string') return undefined;
  const cwd = orcaLocalPath(active.path, active.wslDistro);
  if (!cwd) return undefined;
  if (typeof active.wslDistro === 'string') registerWslHome(active.wslDistro);
  return { id: active.worktreeId, cwd, ...(active.wslDistro && { wslDistro: active.wslDistro }),
    terminals: Number.isSafeInteger(active.liveTerminalCount) ? active.liveTerminalCount : 0 };
}

function visibleGroupIds(node: unknown, depth = 0): Set<string> {
  if (depth > 16) return new Set();
  const entry = record(node);
  if (entry.type === 'leaf' && typeof entry.groupId === 'string' && entry.groupId) return new Set([entry.groupId]);
  if (entry.type === 'split') return new Set([...visibleGroupIds(entry.first, depth + 1), ...visibleGroupIds(entry.second, depth + 1)]);
  return new Set();
}

/** 读取 Orca 当前活动工作区的前台选项卡类型与标识（终端或结构化代理对话）。 */
export function orcaForegroundSelection(workspace: OrcaWorkspace, root = defaultOrcaRoot()): OrcaSelection | undefined {
  if (!root) return undefined;
  try {
    const profile = readDocument(path.join(root, 'orca-profile-index.json')).activeProfileId;
    if (typeof profile !== 'string' || !/^[a-z0-9_-]{1,80}$/i.test(profile)) return undefined;
    const file = path.join(root, 'profiles', profile, 'profile-state.db');
    if (!existsSync(file)) return undefined;
    const db = openReadOnlyDb(file);
    try {
      const keys = [
        ['activeWorktreeId'],
        ['activeWorkspaceExecutionHostId'],
        ['activeTabId'],
        ['activeTabIdByWorktree', workspace.id],
        ['activeTabTypeByWorktree', workspace.id],
        ['activeGroupIdByWorktree', workspace.id],
        ['tabGroups', workspace.id],
        ['tabGroupLayouts', workspace.id],
        ['unifiedTabs', workspace.id],
      ].map(key => JSON.stringify(key));
      const rows = db.prepare(`SELECT part_key, payload FROM profile_state_document_parts
        WHERE domain='workspaceSession' AND part_key IN (?,?,?,?,?,?,?,?,?) AND length(payload)<=${MAX_STATE_BYTES}`).all(...keys);
      const parts = new Map(rows.map(row => [row.part_key, JSON.parse(String(row.payload)) as unknown]));
      if (parts.size < 3 || !parts.has(keys[0]) || !parts.has(keys[1])) return undefined;
      const workspaceHost = parts.get(keys[1]);
      if (parts.get(keys[0]) !== workspace.id || (workspaceHost !== 'local' && workspaceHost !== null)) return { kind: 'other' };

      const tabType = parts.get(keys[4]);
      const visible = visibleGroupIds(parts.get(keys[7]));
      const rawGroups = parts.get(keys[6]);
      const groups = Array.isArray(rawGroups)
        ? rawGroups.map(record).filter(g => typeof g.id === 'string' && (!visible.size || visible.has(g.id)))
        : [];
      const activeGroupId = parts.get(keys[5]);
      const matchedGroups = typeof activeGroupId === 'string' && activeGroupId
        ? groups.filter(g => g.id === activeGroupId)
        : groups.length === 1 ? groups : [];
      const group = matchedGroups.length === 1 ? matchedGroups[0] : undefined;
      const fallbackTabId = tabType === 'agent-session' && groups.length === 0 ? parts.get(keys[3]) : undefined;
      const tabId = typeof group?.activeTabId === 'string' ? group.activeTabId : fallbackTabId;
      const rawTabs = parts.get(keys[8]);
      const tabs = Array.isArray(rawTabs) ? rawTabs.map(record) : [];
      const matches = typeof tabId === 'string' && tabId ? tabs.filter(t => t.id === tabId
        && (!group || !t.groupId || t.groupId === group.id)
        && (!t.worktreeId || t.worktreeId === workspace.id)) : [];
      const tab = matches.length === 1 ? matches[0] : undefined;
      const entityId = tab?.executionHostId === 'local' && tab.contentType === tabType
        && typeof tab.entityId === 'string' && ORCA_ID.test(tab.entityId) ? tab.entityId : null;

      // worktree activate 会清空工作区主机，此时由选中组和本机标签共同确认会话归属。
      if (workspaceHost === null && (!entityId || group?.worktreeId !== workspace.id
        || tab?.worktreeId !== workspace.id || tab.groupId !== group.id)) return { kind: 'other' };
      if (tabType === 'agent-session') return { kind: 'agent-session', sessionId: entityId };

      if (tabType === 'terminal') {
        const legacyTab = parts.get(keys[2]);
        // 切换到聊天或文件时，全局终端标识可能仍保留上一次的值。
        if ((!tab || tab.contentType !== 'terminal') && parts.get(keys[3]) === legacyTab && typeof legacyTab === 'string' && ORCA_ID.test(legacyTab)) {
          return { kind: 'terminal', tabId: legacyTab };
        }
        const worktreeTab = parts.get(keys[3]);
        if (entityId && (worktreeTab == null || worktreeTab === entityId || worktreeTab === tab?.id)) {
          return { kind: 'terminal', tabId: entityId };
        }
        return { kind: 'other' };
      }

      return { kind: 'other' };
    } finally { db.close(); }
  } catch { return undefined; }
}

/** 终端布局只记录终端选项卡。当前 Orca 配置可进一步确认用户选中的选项卡。 */
export function orcaSelectedTab(workspace: OrcaWorkspace, root = defaultOrcaRoot()): string | null | undefined {
  const selection = orcaForegroundSelection(workspace, root);
  if (selection === undefined) return undefined;
  return selection.kind === 'terminal' ? selection.tabId : null;
}

/** 将 Orca 本机结构化代理会话标识映射为 Context Lens 会话键。 */
export function orcaAgentSessionKey(workspace: OrcaWorkspace, sessionId: string, root = defaultOrcaRoot()): string | null {
  return readOrcaSession(sessionId, workspace.id, root, false)?.nativeKey ?? null;
}

function selectedPanes(node: unknown, selectedTab: string | undefined, depth = 0): string[] {
  if (depth > 16) return [];
  const entry = record(node);
  if (entry.type === 'split') return [...selectedPanes(entry.first, selectedTab, depth + 1), ...selectedPanes(entry.second, selectedTab, depth + 1)];
  if (selectedTab !== undefined && selectedTab !== entry.activeTabId) return [];
  const tab = Array.isArray(entry.tabs) ? entry.tabs.find(tab => tab?.tabId === entry.activeTabId) : undefined;
  return typeof tab?.tabId === 'string' && typeof tab?.activeLeafId === 'string' ? [tab.tabId + ':' + tab.activeLeafId] : [];
}

function orcaPaneKey(workspace: OrcaWorkspace, read: typeof orcaResult, selectedTab?: string): string | undefined {
  const layout = read(['terminal', 'list', '--include-visual-layouts', '--limit', '100']);
  if (!Array.isArray(layout.visualLayouts) || !Array.isArray(layout.terminals)) return undefined;
  const panes = layout.visualLayouts.filter(row => row?.worktreeId === workspace.id).flatMap(row => selectedPanes(row.root, selectedTab));
  if (panes.length !== 1 || !layout.terminals.some(terminal => terminal?.executionHostId === 'local'
    && terminal.connected === true && terminal.worktreeId === workspace.id && terminal.tabId + ':' + terminal.leafId === panes[0])) return undefined;
  return panes[0];
}

export function orcaPaneAgent(workspace: OrcaWorkspace, tab: string, read = orcaResult): OrcaSession | undefined {
  const pane = orcaPaneKey(workspace, read, tab);
  if (!pane) return undefined;
  const rows = read(['agent','list']).agents;
  if (!Array.isArray(rows)) return undefined;
  const agents = rows.filter(r => r?.kind === 'terminal' && r.hostId === 'local' && r.worktreeId === workspace.id && r.paneKey === pane);
  if (agents.length !== 1) return undefined;
  const row = agents[0], id = row.orcaSessionId, agent = displayLabel(row.agent, 80);
  if (!validId(id) || !agent) return undefined;
  const at = typeof row.updatedAt === 'number' ? row.updatedAt : Date.parse(row.updatedAt);
  return { id, agent, workspaceId: workspace.id, nativeKey: terminalNativeKey(defaultOrcaRoot(), id, agent, workspace.wslDistro), title: displayLabel(row.title, 200), state: displayLabel(row.state,32),
    model: '', effort: '', updatedAt: Number.isFinite(at) ? at : null, createdAt: null };
}

export function orcaPanePid(workspace: OrcaWorkspace, read = orcaResult, selectedTab?: string): number | undefined {
  const pane = orcaPaneKey(workspace, read, selectedTab);
  if (!pane) return undefined;
  const memory = read(['diagnostics', 'memory']);
  const row = Array.isArray(memory.worktrees) ? memory.worktrees.find(row => row?.worktreeId === workspace.id) : undefined;
  // 终端 PID 按窗格标识关联，兼容 Orca 对诊断分组字段的版本差异。
  const pids = new Set(Object.values(record(row)).filter(Array.isArray).flatMap(entries =>
    entries.filter(entry => entry?.paneKey === pane && Number.isSafeInteger(entry.pid) && entry.pid > 1).map(entry => Number(entry.pid))));
  return pids.size === 1 ? pids.values().next().value : undefined;
}
