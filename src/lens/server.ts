import * as http from 'node:http';
import { readFile } from 'node:fs/promises';
import { SessionCollector } from './snapshot.js';
import { atomicJson, configPath, readPrices, validatePrices } from './settings.js';
import { sessionKey } from './sessions.js';
import { ActiveSessions } from './active.js';

export async function startServer(options: { port?: number; collector?: SessionCollector } = {}): Promise<{ server: http.Server; url: string }> {
  const collector = options.collector ?? new SessionCollector();
  const active = new ActiveSessions();
  const assets: Record<string, [string, string]> = {
    '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'],
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'");
    const json = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const port = (server.address() as { port: number }).port;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes(req.headers.host || '') || (req.headers.origin && !hosts.map(h => `http://${h}`).includes(req.headers.origin))
        || req.headers['sec-fetch-site'] === 'cross-site') { json(403, { error: 'Only same-origin loopback requests are allowed' }); return; }
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(200, { app: 'context-lens', protocol: 1 });
      } else if (req.method === 'GET' && url.pathname === '/api/active') {
        const client = url.searchParams.get('client') || undefined;
        const rawPid = url.searchParams.get('pid'); const pid = rawPid === null ? undefined : Number(rawPid);
        if ((client && !['claude', 'codex'].includes(client)) || (pid !== undefined && (!Number.isSafeInteger(pid) || pid < 2 || pid > 2147483647))) {
          json(400, { error: 'Invalid active-session target' }); return;
        }
        json(200, active.get(collector.list(), client, pid));
      } else if (req.method === 'GET' && url.pathname === '/api/sessions') {
        json(200, collector.list(true).map(({ id, client, cwd, model, updatedAt, parentId }) => ({ id, key: sessionKey({ client, id }), client, cwd, model, updatedAt, parentId })));
      } else if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        const key = url.searchParams.get('session') || '';
        if (!/^(claude|codex):[a-zA-Z0-9_-]{1,100}$/.test(key)) { json(400, { error: 'Select a valid session' }); return; }
        if (!collector.list().some(s => sessionKey(s) === key)) { json(404, { error: 'Session is no longer available' }); return; }
        const view = url.searchParams.get('view') === 'model' ? 'model' : 'budget';
        json(200, await collector.get(key, { view }));
      } else if (req.method === 'GET' && url.pathname === '/api/config') {
        json(200, readPrices());
      } else if (req.method === 'PUT' && url.pathname === '/api/config') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { json(415, { error: 'Expected application/json' }); return; }
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk); size += bytes.length;
          if (size > 64 * 1024) { json(413, { error: 'Price configuration is too large' }); return; }
          chunks.push(bytes);
        }
        let config;
        try { config = validatePrices(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { json(400, { error: 'Invalid currency, model, or price. Prices must be nonnegative numbers per million tokens.' }); return; }
        atomicJson(configPath(), config);
        json(200, config);
      } else if (req.method === 'GET' && Object.hasOwn(assets, url.pathname)) {
        const [file, type] = assets[url.pathname];
        const data = await readFile(new URL(file === 'app.js' ? './browser.js' : `../../web/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type }); res.end(data);
      } else json(req.method === 'GET' ? 404 : 405, { error: 'Not found' });
    } catch { if (!res.headersSent) json(500, { error: 'Unable to read local session or configuration. Check file access and JSON syntax.' }); else res.end(); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 47831, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
