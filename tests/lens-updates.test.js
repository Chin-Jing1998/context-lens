import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUpdates, currentVersion, newerVersion, updateInfo, updateSource } from '../dist/lens/updates.js';

test('updates compare numeric release versions and never treat malformed or preview tags as stable updates', () => {
  assert.equal(newerVersion('v0.12.0', '0.11.0'), true);
  assert.equal(newerVersion('1.0.0', '0.11.9'), true);
  assert.equal(newerVersion('0.9.99', '0.11.0'), false);
  assert.equal(newerVersion('v0.11.0', '0.11.0'), false);
  assert.equal(newerVersion('v0.12.0-beta', '0.11.0'), false);
  assert.equal(updateInfo().state, 'idle');
  assert.equal(updateInfo().current, currentVersion);
});
test('release checks are pinned to the project GitHub repository and contain no session information', async () => {
  const info = await checkUpdates(async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/Chin-Jing1998/context-lens/releases/latest');
    assert.equal(options.redirect, 'error'); assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ tag_name: 'v1.0.0', html_url: updateSource + '/releases/tag/v1.0.0', published_at: '2026-10-08T00:00:00Z' });
  });
  assert.equal(info.state, 'available'); assert.equal(info.available, true); assert.equal(info.latest, '1.0.0');
});
test('absent releases, rate limits and foreign release links cannot claim an update succeeded', async () => {
  assert.equal((await checkUpdates(async () => new Response('', { status: 404 }))).state, 'unpublished');
  await assert.rejects(checkUpdates(async () => new Response('', { status: 429 })), /GitHub/);
  await assert.rejects(checkUpdates(async () => Response.json({ tag_name: 'v1.0.0', html_url: 'https://example.com/download' })), /版本记录无效/);
  await assert.rejects(checkUpdates(async () => Response.json({ tag_name: 'v1.0.0', html_url: updateSource + '/releases/tag/v1.0.0', prerelease: true })), /版本记录无效/);
  await assert.rejects(checkUpdates(async () => { throw new Error('offline'); }), /offline/);
});
