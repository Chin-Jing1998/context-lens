import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import { windowsResumeCandidates, chooseActive, isClaudeProcess } from '../dist/lens/active.js';
const require = createRequire(import.meta.url), { canOpenGithub, fit } = require('../desktop/windows/guards.cjs');

test('Claude live registries accept Windows native and npm executables without accepting unrelated filenames', () => {
  assert.equal(isClaudeProcess('claude.exe C:\\bin\\claude.exe'), true);
  assert.equal(isClaudeProcess('node.exe C:\\tools\\node_modules\\@anthropic-ai\\claude-code\\cli.js'), true);
  assert.equal(isClaudeProcess('/usr/local/bin/claude'), true);
  assert.equal(isClaudeProcess('notclaude.exe --resume x'), false);
});

test('Windows foreground evidence selects resumed live roots and refuses unrelated processes, unknown IDs and agents', () => {
  const files = [{ client: 'codex', id: 'root-a', cwd: '' }, { client: 'claude', id: 'root-b', cwd: '' }, { client: 'codex', id: 'child', cwd: '', parentId: 'root-a' }];
  const rows = [
    { ProcessId: 30, ParentProcessId: 20, Name: 'codex.exe', CommandLine: 'codex.exe resume "root-a"' },
    { ProcessId: 40, ParentProcessId: 10, Name: 'claude.exe', CommandLine: 'claude.exe --resume=root-b' },
    { ProcessId: 50, ParentProcessId: 20, Name: 'codex.exe', CommandLine: 'codex.exe resume child' },
    { ProcessId: 60, ParentProcessId: 20, Name: 'codex.exe', CommandLine: 'codex.exe resume unknown' },
    { ProcessId: 70, ParentProcessId: 20, Name: 'unrelated.exe', CommandLine: 'codex.exe resume root-a' },
  ];
  const candidates = windowsResumeCandidates(files, rows);
  assert.deepEqual(candidates.map(row => row.key), ['codex:root-a', 'claude:root-b']);
  const parents = new Map(rows.map(row => [row.ProcessId, row.ParentProcessId]));
  assert.equal(chooseActive(candidates, parents, 20).selected, 'codex:root-a');
  assert.equal(chooseActive(candidates, parents, 10).selected, 'claude:root-b');
  assert.equal(chooseActive(candidates, parents, 999).selected, null);
});
test('frameless windows fit small and negative-coordinate monitor work areas', () => {
  assert.deepEqual(fit({ x: -2000, y: 700, width: 476, height: 640 }, { x: -1920, y: 0, width: 1920, height: 1080 }), { x: -1920, y: 440, width: 476, height: 640 });
  assert.deepEqual(fit({ x: 20, y: 0, width: 476, height: 640 }, { x: 0, y: 40, width: 320, height: 480 }), { x: 0, y: 40, width: 320, height: 480 });
});
test('desktop external navigation remains inside the selected GitHub source', () => {
  assert.equal(canOpenGithub('https://github.com/Chin-Jing1998/context-lens/releases/tag/v0.11.0'), true);
  for (const url of ['http://github.com/Chin-Jing1998/context-lens', 'https://github.com/Chin-Jing1998/context-lens-evil', 'https://github.com/Chin-Jing1998/context-lens/../../other', 'https://github.com.example.org/Chin-Jing1998/context-lens', 'file:///tmp/context-lens', 'https://token@github.com/Chin-Jing1998/context-lens']) assert.equal(canOpenGithub(url), false);
});
test('Windows icon contains full PNG images from 16 through 256 pixels', () => {
  const ico = readFileSync(new URL('../desktop/assets/ContextLens.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(2), 1); const count = ico.readUInt16LE(4); assert.equal(count, 7);
  for (let i = 0; i < count; i++) { const offset = ico.readUInt32LE(6 + i * 16 + 12); assert.equal(ico.subarray(offset, offset + 8).toString('hex'), '89504e470d0a1a0a'); }
});

test('Windows 的 Claude 主读数优先使用窗口占比，缺少分母时显示已用 token', () => {
  const source = readFileSync(new URL('../desktop/windows/main.cjs', import.meta.url), 'utf8');
  const start = source.indexOf('function surface() {');
  const code = source.slice(start, source.indexOf('function collapse()', start));
  const render = (client, context) => {
    const messages = [];
    runInNewContext(code + '\nsurface();', {
      snapshot: { session: { client }, context }, surfaceStyle: () => ({}), preferences: {}, nativeTheme: {},
      count: value => String(value), island: 'context', ball: {}, orbit: {}, emit: (_, name, data) => messages.push(data),
    });
    assert.equal(messages.length, 2);
    return messages[0];
  };
  const context = { usedTokens: 170461, percent: 85.2305, windowPercent: 17.0461 };
  const claude = render('claude', context);
  assert.equal(claude.percent, 17.0461);
  assert.equal(claude.values.context, '17.0%');
  for (const windowPercent of [null, undefined, NaN, -1]) {
    const unknown = render('claude', { ...context, windowPercent });
    assert.equal(unknown.percent, null);
    assert.equal(unknown.values.context, '170461');
  }
  const codex = render('codex', context);
  assert.equal(codex.percent, context.percent);
  assert.equal(codex.values.context, '85.2%');
  assert.equal(render('codex', { ...context, percent: null }).values.context, '170461');
});

test('actual Windows ball and orbit centers render token fallbacks and clear them on unknown sessions', () => {
  const element = () => ({ children: [], attributes: {}, dataset: {}, style: {}, textContent: '',
    append(...children) { this.children.push(...children); },
    setAttribute(key, value) { this.attributes[key] = value; }, focus() {}, setPointerCapture() {},
  });
  const nodes = new Map(['orbit', 'ball', 'ball-value', 'ball-progress'].map(id => [id, element()]));
  let surface;
  const document = { documentElement: element(), body: element(), getElementById: id => nodes.get(id),
    createElementNS: element, addEventListener() {},
  };
  runInNewContext(readFileSync(new URL('../desktop/windows/orbit.js', import.meta.url), 'utf8'), {
    document, window: { contextLensHost: { onEvent(callback) { surface = callback; }, postMessage() {} } },
  });
  const render = (percent, context) => {
    surface('surface', { percent, values: context === undefined ? {} : { context }, surface: 'ball', island: 'context' });
    return { ball: nodes.get('ball-value').textContent, center: nodes.get('orbit').children.at(-1).children[1].textContent };
  };
  assert.deepEqual(render(null, '170.5k'), { ball: '170.5k', center: '170.5k' });
  assert.equal(nodes.get('ball-value').style.fontSize, '12px');
  assert.equal(nodes.get('ball-progress').style.strokeDasharray.split(' ')[0], '0');
  assert.deepEqual(render(16.26, '170.5k'), { ball: '16%', center: '16%' });
  assert.equal(nodes.get('ball-value').style.fontSize, '');
  assert.deepEqual(render(null, '—'), { ball: '—', center: '—' });
  assert.deepEqual(render(null, '170.5k'), { ball: '170.5k', center: '170.5k' });
  assert.deepEqual(render(null, undefined), { ball: '—', center: '—' });
  assert.deepEqual(render(null, '0'), { ball: '0', center: '0' });
});

test('Windows 切换 A/B/A 后丢弃上一代尚未完成的快照', async () => {
  const source = readFileSync(new URL('../desktop/windows/main.cjs', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('async function readSnapshot('),source.indexOf('function startWatcher()'));
  const pending = [], paints = [];
  const context = { revision:1, selection:'claude:a', preferences:{view:'model'}, snapshot:null, snapshotRequest:undefined,
    URLSearchParams, read:() => new Promise(resolve => pending.push(resolve)), surface:() => paints.push(context.snapshot.marker) };
  const fetch = runInNewContext(code + '\nreadSnapshot',context);
  const first = fetch('claude:a',1,'model','h1');
  context.revision=2;context.selection='orca:b';const second = fetch('orca:b',2,'model','');
  context.revision=3;context.selection='claude:a';const last = fetch('claude:a',3,'model','h2');
  pending[2]({session:{client:'claude',id:'a'},marker:'新 A'});await last;
  pending[0]({session:{client:'claude',id:'a'},marker:'旧 A'});await first;
  pending[1]({session:{client:'orca',id:'b'},marker:'B'});await second;
  assert.deepEqual(paints,['新 A']);
});

test('Windows 按实际文件占用定位 AGY 锁并过滤非本地对话路由', {skip:process.platform!=='win32'}, async t => {
  const dir=mkdtempSync(join(tmpdir(),'lens-owners-'));
  const held=join(dir,'a.lock'), idle=join(dir,'b.lock');writeFileSync(held,'');writeFileSync(idle,'');
  const ps=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const args=command=>['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')];
  const holder=spawn(ps,args("$file=[IO.File]::OpenRead($env:LENS_TEST_LOCK);[Console]::WriteLine('ready');[Console]::ReadLine();$file.Close()"),
    {env:{...process.env,LENS_TEST_LOCK:held},windowsHide:true});
  t.after(async()=>{if(holder.exitCode===null){const exit=once(holder,'exit'); holder.stdin.end('\n'); await exit;} rmSync(dir,{recursive:true,force:true});});
  await once(holder.stdout,'data');
  const script=readFileSync(new URL('../desktop/windows/agy-presence.ps1',import.meta.url),'utf8');
  const result=spawnSync(ps,args(script),{input:JSON.stringify({pids:[holder.pid],files:[held,idle]}),encoding:'utf8',timeout:15000});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),[{pid:holder.pid,file:held}]);
  const watcher=readFileSync(new URL('../desktop/windows/foreground.ps1',import.meta.url),'utf8').split('[Console]::OutputEncoding')[0];
  const uuid='38380000-2222-4333-8444-555555555555';
  const check=spawnSync(ps,args(watcher+"\nGet-AgyRouteId 'http://127.0.0.1:7000/c/"+uuid+"'; Get-AgyRouteId 'https://example.com/c/"+uuid+"'"),{encoding:'utf8',timeout:10000});
  assert.equal(check.status,0,check.stderr);assert.equal(check.stdout.trim(),uuid);
});
