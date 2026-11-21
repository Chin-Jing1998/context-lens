import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chooseActive, codexResumeCandidates, orcaAgentSessionResult } from '../dist/lens/active.js';
import { lastUserActivity } from '../dist/lens/sessions.js';
import {
  isOrcaApp, isOrcaTerminalHost, orcaAgentSessionKey, orcaForegroundSelection,
  orcaPanePid, orcaSelectedTab, orcaWorkspace, withinWorkspace,
} from '../dist/lens/orca.js';

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

test('Orca 前台结构化代理会话与选项卡识别只采信本机工作区的唯一选中项', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-lens-orca-'));
  try {
    const profileDir = path.join(root, 'profiles', 'default');
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'orca-profile-index.json'), JSON.stringify({ activeProfileId: 'default' }));

    const profileDb = new DatabaseSync(path.join(profileDir, 'profile-state.db'));
    profileDb.exec('CREATE TABLE profile_state_document_parts (domain TEXT NOT NULL, part_key TEXT NOT NULL, payload TEXT NOT NULL)');
    const setPart = (key, value) => {
      const partKey = JSON.stringify(key);
      profileDb.prepare("DELETE FROM profile_state_document_parts WHERE domain='workspaceSession' AND part_key=?").run(partKey);
      profileDb.prepare("INSERT INTO profile_state_document_parts (domain, part_key, payload) VALUES ('workspaceSession', ?, ?)").run(partKey, JSON.stringify(value));
    };

    const domainDb = new DatabaseSync(path.join(root, 'agent-session-domain.db'));
    domainDb.exec('CREATE TABLE agent_session_records (session_id TEXT PRIMARY KEY, record_json TEXT NOT NULL)');
    const setRecord = (sessionId, rec) => {
      domainDb.prepare('INSERT OR REPLACE INTO agent_session_records (session_id, record_json) VALUES (?, ?)').run(sessionId, JSON.stringify(rec));
    };

    const wtId = 'repo::/tmp/project::workspace:1';
    const workspace = { id: wtId, cwd: '/tmp/project', terminals: 0 };
    const agyUuidOld = '11111111-1111-4111-8111-111111111111';
    const agyUuidNew = '22222222-2222-4222-8222-222222222222';
    const claudeUuid = '33333333-3333-4333-8333-333333333333';
    const codexUuid = '44444444-4444-4444-8444-444444444444';

    // 1. Antigravity structured agent-session with multi-link chain and provenHandleLinkId
    setPart(['activeWorktreeId'], wtId);
    setPart(['activeWorkspaceExecutionHostId'], 'local');
    setPart(['activeTabId'], null);
    setPart(['activeTabIdByWorktree', wtId], null);
    setPart(['activeTabTypeByWorktree', wtId], 'agent-session');
    setPart(['activeGroupIdByWorktree', wtId], 'group-1');
    setPart(['tabGroupLayouts', wtId], { type: 'leaf', groupId: 'group-1' });
    setPart(['tabGroups', wtId], [{ id: 'group-1', worktreeId: wtId, activeTabId: 'structured-agent-session-orca-agy' }]);
    setPart(['unifiedTabs', wtId], [{
      id: 'structured-agent-session-orca-agy', entityId: 'orca-agy', groupId: 'group-1',
      worktreeId: wtId, executionHostId: 'local', contentType: 'agent-session', agentSessionAgent: 'antigravity',
    }]);
    setRecord('orca-agy', {
      sessionId: 'orca-agy', provider: 'antigravity',
      location: { executionHostId: 'local', workspaceId: wtId },
      lease: { provenHandleLinkId: 'antigravity-2' },
      providerHandleChain: [
        { linkId: 'antigravity-1', handle: { transport: 'acp', agent: 'antigravity', nativeId: agyUuidOld } },
        { linkId: 'antigravity-2', handle: { transport: 'acp', agent: 'antigravity', nativeId: agyUuidNew } },
      ],
    });
    assert.deepEqual(orcaForegroundSelection(workspace, root), { kind: 'agent-session', sessionId: 'orca-agy' });
    assert.equal(orcaSelectedTab(workspace, root), null);
    assert.equal(orcaAgentSessionKey(workspace, 'orca-agy', root), `agy:${agyUuidNew}`);

    // 2. Claude, Codex, OpenCode and empty draft chat records
    setRecord('orca-claude', {
      sessionId: 'orca-claude', provider: 'claude',
      location: { executionHostId: 'local', workspaceId: wtId },
      lease: { provenHandleLinkId: null },
      providerHandleChain: [{ linkId: 'claude-1', handle: { provider: 'claude', sessionId: claudeUuid, leafUuid: null } }],
    });
    setRecord('orca-codex', {
      sessionId: 'orca-codex', provider: 'codex',
      location: { executionHostId: 'local', workspaceId: wtId },
      lease: { provenHandleLinkId: 'codex-1' },
      providerHandleChain: [{ linkId: 'codex-1', handle: { provider: 'codex', threadId: codexUuid } }],
    });
    setRecord('orca-opencode', {
      sessionId: 'orca-opencode', provider: 'opencode',
      location: { executionHostId: 'local', workspaceId: wtId },
      lease: { provenHandleLinkId: null },
      providerHandleChain: [{ linkId: 'oc-1', handle: { transport: 'acp', agent: 'opencode', nativeId: 'ses_abc123' } }],
    });
    setRecord('orca-draft', {
      sessionId: 'orca-draft', provider: 'antigravity',
      location: { executionHostId: 'local', workspaceId: wtId },
      lease: { provenHandleLinkId: null },
      providerHandleChain: [],
    });
    setRecord('orca-remote', {
      sessionId: 'orca-remote', provider: 'claude',
      location: { executionHostId: 'ssh:box', workspaceId: wtId },
      lease: { provenHandleLinkId: null },
      providerHandleChain: [{ linkId: 'claude-1', handle: { provider: 'claude', sessionId: claudeUuid, leafUuid: null } }],
    });
    setRecord('orca-other-wt', {
      sessionId: 'orca-other-wt', provider: 'claude',
      location: { executionHostId: 'local', workspaceId: 'other-worktree' },
      lease: { provenHandleLinkId: null },
      providerHandleChain: [{ linkId: 'claude-1', handle: { provider: 'claude', sessionId: claudeUuid, leafUuid: null } }],
    });
    assert.equal(orcaAgentSessionKey(workspace, 'orca-claude', root), `claude:${claudeUuid}`);
    assert.equal(orcaAgentSessionKey(workspace, 'orca-codex', root), `codex:${codexUuid}`);
    assert.equal(orcaAgentSessionKey(workspace, 'orca-opencode', root), 'opencode:ses_abc123');
    assert.equal(orcaAgentSessionKey(workspace, 'orca-draft', root), null);
    assert.equal(orcaAgentSessionKey(workspace, 'orca-remote', root), null);
    assert.equal(orcaAgentSessionKey(workspace, 'orca-other-wt', root), null);

    // 3. Split groups: active group selects uniquely; missing activeGroupId refuses to guess
    setPart(['tabGroupLayouts', wtId], { type: 'split', first: { type: 'leaf', groupId: 'group-1' }, second: { type: 'leaf', groupId: 'group-2' } });
    setPart(['tabGroups', wtId], [
      { id: 'group-1', worktreeId: wtId, activeTabId: 'structured-agent-session-orca-agy' },
      { id: 'group-2', worktreeId: wtId, activeTabId: 'structured-agent-session-orca-claude' },
    ]);
    setPart(['unifiedTabs', wtId], [
      { id: 'structured-agent-session-orca-agy', entityId: 'orca-agy', groupId: 'group-1', worktreeId: wtId, executionHostId: 'local', contentType: 'agent-session' },
      { id: 'structured-agent-session-orca-claude', entityId: 'orca-claude', groupId: 'group-2', worktreeId: wtId, executionHostId: 'local', contentType: 'agent-session' },
    ]);
    setPart(['activeGroupIdByWorktree', wtId], 'group-2');
    assert.deepEqual(orcaForegroundSelection(workspace, root), { kind: 'agent-session', sessionId: 'orca-claude' });
    setPart(['activeGroupIdByWorktree', wtId], null);
    assert.deepEqual(orcaForegroundSelection(workspace, root), { kind: 'agent-session', sessionId: null });

    // 4. Remote tab inside local worktree is rejected
    setPart(['activeGroupIdByWorktree', wtId], 'group-2');
    setPart(['unifiedTabs', wtId], [
      { id: 'structured-agent-session-orca-claude', entityId: 'orca-claude', groupId: 'group-2', worktreeId: wtId, executionHostId: 'ssh:box', contentType: 'agent-session' },
    ]);
    assert.deepEqual(orcaForegroundSelection(workspace, root), { kind: 'agent-session', sessionId: null });

    // 5. Terminal tab compatibility (legacy & unifiedTabs) and non-agent browser tab
    setPart(['activeTabTypeByWorktree', wtId], 'terminal');
    setPart(['activeTabId'], 'term-tab-1');
    setPart(['activeTabIdByWorktree', wtId], 'term-tab-1');
    assert.deepEqual(orcaForegroundSelection(workspace, root), { kind: 'terminal', tabId: 'term-tab-1' });
    assert.equal(orcaSelectedTab(workspace, root), 'term-tab-1');

    setPart(['activeTabTypeByWorktree', wtId], 'browser');
    assert.deepEqual(orcaForegroundSelection(workspace, root), { kind: 'other' });
    assert.equal(orcaSelectedTab(workspace, root), null);

    // 6. Active result contract respects available sessions and client filter
    const available = new Set([`agy:${agyUuidNew}`, `claude:${claudeUuid}`]);
    assert.deepEqual(orcaAgentSessionResult(`agy:${agyUuidNew}`, available), {
      selected: `agy:${agyUuidNew}`, candidates: [], reason: '已跟随 Orca 前台代理对话',
    });
    assert.equal(orcaAgentSessionResult(`agy:${agyUuidNew}`, available, 'claude').selected, null);
    assert.equal(orcaAgentSessionResult(`codex:${codexUuid}`, available).selected, null);
    assert.equal(orcaAgentSessionResult(null, available).reason, '等待 Orca 前台唯一会话');

    profileDb.close();
    domainDb.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
