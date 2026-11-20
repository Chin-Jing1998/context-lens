import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseActive, codexResumeCandidates } from '../dist/lens/active.js';
import { lastUserActivity } from '../dist/lens/sessions.js';
import { isOrcaApp, isOrcaTerminalHost, orcaPanePid, orcaWorkspace, withinWorkspace } from '../dist/lens/orca.js';

test('Orca 前台识别只使用本机工作区和已连接的选中窗格', () => {
  const cwd = process.cwd(), id = 'local-worktree';
  const local = { isActive: true, hostId: 'local', environment: { id: 'local' }, worktreeId: id, path: cwd, liveTerminalCount: 2 };
  const workspace = orcaWorkspace({ worktrees: [local, { ...local, isActive: false, worktreeId: 'other' }] });
  assert.deepEqual(workspace, { id, cwd, terminals: 2 });
  assert.equal(orcaWorkspace({ worktrees: [local, { ...local, hostId: 'remote' }] }), undefined);
  assert.equal(orcaWorkspace({ worktrees: [{ ...local, environment: { id: 'remote' } }] }), undefined);
  assert.equal(withinWorkspace(cwd + '/child', cwd), true);
  assert.equal(withinWorkspace(cwd + '-other', cwd), false);
  assert.equal(isOrcaApp('/Applications/Orca.app/Contents/MacOS/Orca'), true);
  assert.equal(isOrcaTerminalHost('/Applications/Orca.app/Contents/Helpers/Orca Agents.app/Contents/MacOS/Orca Agents'), true);
  const visible = { tabId: 'tab-a', activeLeafId: 'leaf-2' }, background = { tabId: 'tab-b', activeLeafId: 'leaf-3' };
  const layout = { visualLayouts: [{ worktreeId: id, root: { type: 'group', activeTabId: visible.tabId, tabs: [background, visible] } }],
    terminals: [{ executionHostId: 'local', connected: true, worktreeId: id, tabId: visible.tabId, leafId: visible.activeLeafId }] };
  const memory = { worktrees: [{ worktreeId: id, allocations: [{ paneKey: 'tab-a:leaf-1', pid: 40 }, { paneKey: 'tab-a:leaf-2', pid: 20 }] }] };
  const read = args => args[0] === 'terminal' ? layout : memory;
  const pane = orcaPanePid(workspace, read);
  assert.equal(orcaPanePid(workspace, read, visible.tabId), pane);
  assert.equal(orcaPanePid(workspace, read, background.tabId), undefined);
  assert.equal(orcaPanePid(workspace, read, 'file-tab'), undefined);
  const running = [{ key: 'claude:visible', pid: 21 }, { key: 'codex:background', pid: 41 }];
  assert.equal(chooseActive(running, new Map([[21, 20], [41, 40]]), pane).selected, 'claude:visible');
  layout.terminals[0].connected = false;
  assert.equal(orcaPanePid(workspace, read), undefined);
});

test('automatic selection follows the foreground app process and refuses ambiguous or historical sessions', () => {
  const running = [{ key: 'codex:a', pid: 30, evidence: 'writer' }, { key: 'claude:b', pid: 40, evidence: 'registry' }];
  const parents = new Map([[30, 20], [20, 10], [40, 11]]);
  assert.equal(chooseActive(running, parents, 10).selected, 'codex:a');
  assert.equal(chooseActive(running, parents, 11).selected, 'claude:b');
  assert.equal(chooseActive(running, parents).selected, null);
  assert.equal(chooseActive(running, parents, 99).selected, null);
  assert.equal(chooseActive([], parents, 10).candidates.length, 0);
  assert.equal(chooseActive([...running, running[0]], parents, 10).candidates.length, 1);
});

test('Orca 空闲 Codex 以窗格所属进程的唯一显式恢复标识定位本机会话', () => {
  const real = '5a25f191-5af3-4b03-b7a6-e9a6f4932401';
  const other = '5a25f191-5af3-4b03-b7a6-e9a6f4932402';
  const child = '5a25f191-5af3-4b03-b7a6-e9a6f4932403';
  const files = [{ id: real, client: 'codex' }, { id: other, client: 'codex' }, { id: child, client: 'codex', parentId: real }];
  const output = [
    '201 /home/user/.local/bin/codex resume --cd /home/user/Project With Spaces --no-alt-screen ' + real,
    '202 /home/user/.local/bin/codex resume ' + other,
    '203 /home/user/.local/bin/codex resume --last ' + real,
    '204 /home/user/.local/bin/codex resume ' + real + ' ' + other,
    '205 /home/user/.local/bin/codex resume ' + child,
    '206 /home/user/.local/bin/codex resume ' + real + ' 后续输入',
    '207 /home/user/.local/bin/codex --cd /a gen-id=' + real,
    `208 codex --no-daemon -c shell_environment_policy.set.ORCA_CLI_COMMAND="/Applications/Orca Agents.app/bin/orca" -c shell_environment_policy.set.ORCA_SESSION_ID="${real}" resume --no-alt-screen ${other}`,
    `209 codex --no-daemon -c shell_environment_policy.set.ORCA_SESSION_ID="resume ${real}" exec ${other}`,
    `210 codex --no-daemon -c shell_environment_policy.set.ORCA_SESSION_ID="${real}" resume --last ${other}`,
  ].join('\n');
  assert.deepEqual(codexResumeCandidates(output, files, new Set([201, 203, 204, 205, 206, 207, 208, 209, 210]))
    .map(row => [row.key, row.pid]), [['codex:' + real, 201], ['codex:' + other, 208]]);
});

test('multiple loaded sessions follow explicit interaction within the foreground process tree', () => {
  const candidates = [{ key: 'codex:a', pid: 30 }, { key: 'codex:b', pid: 30 }, { key: 'claude:c', pid: 40 }];
  const parents = new Map([[30, 10], [40, 20]]);
  const activity = new Map([['codex:a', 100], ['codex:b', 200], ['claude:c', 300], ['codex:closed', 999]]);
  assert.equal(chooseActive(candidates, parents, 10, activity).selected, 'codex:b');
  assert.equal(chooseActive(candidates, parents, 20, activity).selected, 'claude:c');
  activity.set('codex:a', 400);
  assert.equal(chooseActive(candidates, parents, 10, activity).selected, 'codex:a');
  activity.set('codex:b', 400);
  assert.equal(chooseActive(candidates, parents, 10, activity).selected, null, 'ties must not silently choose a session');
  assert.equal(chooseActive([], parents, 10, activity).selected, null, 'history without live ownership is absent');
});

test('background output, tool results and synthetic inputs cannot move the active conversation', () => {
  const userAt = '2026-10-01T10:00:00Z', outputAt = '2026-10-01T11:00:00Z';
  assert.equal(lastUserActivity([
    { type: 'event_msg', timestamp: userAt, payload: { type: 'user_message' } },
    { type: 'event_msg', timestamp: outputAt, payload: { type: 'agent_message' } },
    { type: 'event_msg', timestamp: outputAt, payload: { type: 'token_count' } },
  ], 'codex'), Date.parse(userAt));
  assert.equal(lastUserActivity([
    { type: 'user', timestamp: userAt, message: { content: [{ type: 'text', text: 'Run the checks.' }] } },
    { type: 'user', timestamp: outputAt, message: { content: [{ type: 'tool_result', content: 'done' }] } },
    { type: 'user', timestamp: outputAt, isMeta: true, message: { content: 'Metadata' } },
    { type: 'user', timestamp: outputAt, isSidechain: true, message: { content: 'Agent input' } },
  ], 'claude'), Date.parse(userAt));
  assert.equal(lastUserActivity([{ type: 'user', timestamp: 'invalid', message: { content: 'Input' } }], 'claude'), undefined);
});
