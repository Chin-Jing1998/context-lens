import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHudDisabled } from '../hud.mjs';
import { formatSessionDuration } from '../src/utils/format.ts';

const entry = fileURLToPath(new URL('../hud.mjs', import.meta.url));

async function runCli(input, env = {}, config = {}) {
  const home = await mkdtemp(path.join(tmpdir(), 'hud-index-'));
  try {
    await mkdir(path.join(home, '.claude'), { recursive: true });
    await writeFile(path.join(home, '.claude/context-lens.json'), JSON.stringify(config));
    const result = spawnSync(process.execPath, [entry], {
      input,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CONTEXT_LENS_HOME: path.join(home, 'lens'), ...env },
    });
    try { result.live = JSON.parse(await readFile(path.join(home, 'lens/live/claude-silent-test.json'), 'utf8')); } catch { /* No capture expected. */ }
    try { result.heartbeat = JSON.parse(await readFile(path.join(home, '.claude/plugins/context-lens/heartbeat.json'), 'utf8')); } catch { /* No heartbeat expected. */ }
    return result;
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test('isHudDisabled treats any value but an explicit negative as disabled', () => {
  for (const value of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) {
    assert.equal(isHudDisabled({ CONTEXT_LENS_DISABLE: value }), true, value);
  }
  for (const value of [undefined, '', ' ', '0', 'false', 'OFF', 'no']) {
    assert.equal(isHudDisabled({ CONTEXT_LENS_DISABLE: value }), false, String(value));
  }
});

test('the CLI renders only when explicitly enabled and stays silent when disabled', async () => {
  const stdin = JSON.stringify({ model: { display_name: 'Opus' }, context_window: { used_percentage: 12, context_window_size: 200_000 } });

  const rendered = await runCli(stdin, {}, { display: { showTerminal: true } });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /\[Opus\]/);
  assert.match(rendered.stdout, /12%/);

  const disabled = await runCli(stdin, { CONTEXT_LENS_DISABLE: '1' }, { display: { showTerminal: true } });
  assert.equal(disabled.stdout, '');

  // No input is how setup checks that the command starts.
  const empty = await runCli('', {}, { display: { showTerminal: true } });
  assert.match(empty.stdout, /\[context-lens\] Initializing/);
});

test('silent statusline captures live counters even with legacy showLens and no readable transcript', async () => {
  const input = JSON.stringify({ session_id: 'silent-test', transcript_path: '/missing/log.jsonl',
    model: { id: 'claude-test' }, context_window: { context_window_size: 200000, current_usage: { input_tokens: 100, cache_read_input_tokens: 300 } },
    prompt_cache: { warm: true, expires_at: 2000000000 }, prompt: 'private content must not be persisted' });
  for (const display of [{}, { showLens: true }, { showTerminal: false, showLens: true }]) {
    const result = await runCli(input, {}, { display });
    assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    assert.equal(result.live.stdin.context_window.current_usage.input_tokens, 100);
    assert.equal(result.live.stdin.prompt_cache.warm, true);
    assert.equal(JSON.stringify(result.live).includes('private content'), false);
    assert.equal(result.heartbeat.stdin.context_window.current_usage.cache_read_input_tokens, 300);
    assert.equal(Object.hasOwn(result.heartbeat.stdin, 'prompt'), false);
  }
  for (const input of ['', '{broken', 'null']) {
    const result = await runCli(input);
    assert.equal(result.stdout, ''); assert.equal(result.stderr, ''); assert.equal(result.status, 0);
  }
  const failed = await runCli(input, { CONTEXT_LENS_HOME: entry });
  assert.equal(failed.stdout, ''); assert.equal(failed.stderr, ''); assert.equal(failed.status, 0);
});

// #857: a rule linked from outside the read grants can't be stat'ed in the cage.
test('a rule linked from outside the grants skips only itself', {
  skip: process.platform === 'win32' ? 'symlinks need privileges on Windows' : false,
}, async () => {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'hud-rules-')));
  try {
    const cfg = path.join(base, 'cfg');
    await mkdir(path.join(cfg, 'plugins', 'context-lens'), { recursive: true });
    await mkdir(path.join(cfg, 'rules'));
    await mkdir(path.join(base, 'elsewhere'));
    await mkdir(path.join(base, 'proj'));
    await writeFile(path.join(cfg, 'plugins', 'context-lens', 'config.json'), '{"display":{"showTerminal":true,"showConfigCounts":true}}');
    await writeFile(path.join(base, 'elsewhere', 'a.md'), 'pack\n');
    // Named to sort first, so a denied link used to end the count before the plain files.
    await symlink(path.join(base, 'elsewhere', 'a.md'), path.join(cfg, 'rules', 'a.md'));
    for (const name of ['b', 'c', 'd']) await writeFile(path.join(cfg, 'rules', `${name}.md`), `${name}\n`);

    const result = spawnSync(process.execPath, [entry], {
      input: JSON.stringify({ cwd: path.join(base, 'proj'), model: { display_name: 'Opus' } }),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: base, CLAUDE_CONFIG_DIR: cfg, COLUMNS: '120' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout.replace(/\x1b\[[0-9;]*m/g, ''), /\b3 rules\b/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('formatSessionDuration formats Claude Code session time', () => {
  assert.equal(formatSessionDuration(undefined), '');
  assert.equal(formatSessionDuration(-1), '');
  assert.equal(formatSessionDuration(30_000), '<1m');
  assert.equal(formatSessionDuration(5 * 60_000), '5m');
  assert.equal(formatSessionDuration(125 * 60_000), '2h 5m');
});
