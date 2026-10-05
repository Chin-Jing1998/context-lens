import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveClaudeSettings, resolveCodexSettings, validatePrices, launchSettings } from '../dist/lens/settings.js';

test('Claude setting scopes override model settings within lower scopes; flags and environment take precedence', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-settings-'));
  try {
    const files = ['user', 'project', 'managed'].map(x => path.join(dir, x + '.json'));
    writeFileSync(files[0], JSON.stringify({ autoCompactWindow: 200000, modelSettings: { 'claude-opus-4-6': { autoCompactWindow: 300000 } } }));
    writeFileSync(files[1], '{}'); writeFileSync(files[2], '{}');
    const args = { cwd: dir, model: 'claude-opus-4-6', capacity: 1000000, files, globalFile: path.join(dir, 'absent'), env: {} };
    assert.equal(resolveClaudeSettings(args).budget.tokens, 300000);
    writeFileSync(files[2], '{"autoCompactWindow":400000}');
    assert.equal(resolveClaudeSettings(args).budget.tokens, 400000);
    assert.equal(resolveClaudeSettings({ ...args, launch: { autoCompact: 500000 } }).budget.tokens, 500000);
    assert.equal(resolveClaudeSettings({ ...args, launch: { autoCompact: 500000 }, env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '600000' } }).budget.tokens, 600000);
    assert.equal(resolveClaudeSettings({ ...args, env: { DISABLE_AUTO_COMPACT: '1' } }).budget.tokens, 1000000);
    assert.equal(launchSettings('claude', ['--autocompact', '200']).autoCompact, 200000);
    assert.equal(launchSettings('claude', ['--autocompact=auto']).autoCompact, 'auto');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('Codex TOML, selected profiles, trusted project settings and launch overrides are resolved in order', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-codex-'));
  try {
    writeFileSync(path.join(dir, 'config.toml'), 'model_auto_compact_token_limit=200000\n[profiles.small]\nmodel_auto_compact_token_limit=100000\n');
    assert.equal(resolveCodexSettings({ cwd: dir, home: dir, capacity: 256000 }).budget.tokens, 200000);
    const launch = launchSettings('codex', ['-p', 'small', '-c', 'model_auto_compact_token_limit=80000', '-c', 'model_auto_compact_token_limit_scope="body_after_prefix"']);
    const x = resolveCodexSettings({ cwd: dir, home: dir, capacity: 256000, launch });
    assert.equal(x.budget.tokens, 80000);
    assert.equal(x.budget.scope, 'body_after_prefix');
    assert.equal(resolveCodexSettings({ cwd: dir, home: dir, capacity: 256000, launch: { profile: 'small' } }).budget.tokens, 100000);
    mkdirSync(path.join(dir, '.codex')); writeFileSync(path.join(dir, '.codex/config.toml'), 'model_auto_compact_token_limit=42000');
    assert.equal(resolveCodexSettings({ cwd: dir, home: dir, capacity: 256000 }).budget.tokens, 200000, 'untrusted project override is ignored');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('price validation rejects unknown fields, non-finite values, negative prices and prototype keys', () => {
  assert.equal(validatePrices({ currency: 'CNY', prices: { m: { input: 0 } } }).prices.m.input, 0);
  for (const value of [{ currency: 'usd', prices: {} }, { currency: 'USD', prices: { m: { input: -1 } } },
    { currency: 'USD', prices: { m: { input: Infinity } } }, { currency: 'USD', prices: { m: { other: 1 } } },
    JSON.parse('{"currency":"USD","prices":{"__proto__":{"input":1}}}')]) assert.throws(() => validatePrices(value));
});
