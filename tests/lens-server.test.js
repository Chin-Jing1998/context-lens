import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { request } from 'node:http';
import { startServer } from '../dist/lens/server.js';
import { SessionCollector } from '../dist/lens/snapshot.js';

test('local HTTP service enforces origin/host, validates prices, serves assets and never accepts file paths as sessions', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lens-http-'));
  const before = process.env.CONTEXT_LENS_HOME; process.env.CONTEXT_LENS_HOME = dir;
  const { server, url } = await startServer({ port: 0, collector: new SessionCollector({ claude: path.join(dir, 'empty'), codex: path.join(dir, 'empty') }) });
  try {
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(`${url}/app.js`)).status, 200);
    assert.deepEqual(await (await fetch(`${url}/api/sessions`)).json(), []);
    assert.deepEqual(await (await fetch(`${url}/api/health`)).json(), { app: 'context-lens', protocol: 1 });
    assert.equal((await fetch(`${url}/api/active?pid=-1`)).status, 400);
    assert.equal((await fetch(`${url}/api/config`, { headers: { Origin: 'https://evil.example' } })).status, 403);
    const rebound = await new Promise((resolve, reject) => {
      const req = request(`${url}/api/config`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(rebound, 403);
    assert.equal((await fetch(`${url}/api/snapshot?session=../../secrets`)).status, 400);
    assert.equal((await fetch(`${url}/api/snapshot?session=claude:absent`)).status, 404);
    const put = body => fetch(`${url}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify(body) });
    assert.equal((await put({ currency: 'USD', prices: { m: { input: -1 } } })).status, 400);
    const prices = { currency: 'CNY', prices: { m: { input: 0, output: 30 } } };
    assert.equal((await put(prices)).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8')), prices);
    assert.equal((await fetch(`${url}/api/config`, { method: 'PUT', body: '{}' })).status, 415);
  } finally { await new Promise(resolve => server.close(resolve)); if (before === undefined) delete process.env.CONTEXT_LENS_HOME; else process.env.CONTEXT_LENS_HOME = before; rmSync(dir, { recursive: true, force: true }); }
});
