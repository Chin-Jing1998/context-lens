import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('the Codex launcher preserves literal native arguments and exit status without inserting a pane', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-cli-'));
  try {
    writeFileSync(path.join(dir, 'codex'), `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- "$@"\n`, { mode: 0o700 });
    const args = ['--model', 'model with spaces', '-c', 'name="$(do-not-execute)"', "literal'quote"];
    const output = execFileSync(process.execPath, ['scripts/context-lens.mjs', 'codex', '--', ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` } });
    assert.deepEqual(JSON.parse(output), args);
    writeFileSync(path.join(dir, 'codex'), '#!/bin/sh\nexit 7\n', { mode: 0o700 });
    assert.throws(() => execFileSync(process.execPath, ['scripts/context-lens.mjs', 'codex'], { env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` }, stdio: 'pipe' }), error => error.status === 7);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('standalone Claude setup preserves other settings, backs them up, and enables the complete HUD', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-setup-'));
  try {
    writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ autoCompactWindow: 120000, statusLine: { type: 'command', command: 'old-hud' } }));
    const entry = path.resolve('dist/index.js');
    const report = JSON.parse(execFileSync(process.execPath, ['scripts/setup.mjs', 'install', '--shell', 'posix', '--entry', entry, '--lens'], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir } }));
    const settings = JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    assert.equal(settings.autoCompactWindow, 120000); assert.ok(settings.statusLine.command.includes(entry));
    assert.equal(JSON.parse(readFileSync(report.backupPath, 'utf8')).statusLine.command, 'old-hud');
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'context-lens.json'), 'utf8')).display.showLens, true);
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'context-lens.json'), 'utf8')).display.showTerminal, true);
    execFileSync(process.execPath, ['scripts/setup.mjs', 'install', '--shell', 'posix', '--entry', entry], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir } });
    const silent = JSON.parse(readFileSync(path.join(dir, 'context-lens.json'), 'utf8'));
    assert.equal(silent.display.showTerminal, false); assert.equal(silent.display.showLens, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
