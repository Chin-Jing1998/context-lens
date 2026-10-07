import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
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
