import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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

test('Windows 的 Claude 主读数始终使用窗口占比，缺失时不退回预算或 token 数', () => {
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
    assert.equal(unknown.values.context, '—');
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
