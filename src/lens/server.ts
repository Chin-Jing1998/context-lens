import * as http from 'node:http';
import { readFile } from 'node:fs/promises';
import { SessionCollector } from './snapshot.js';
import { atomicJson, configPath, readPrices, validatePrices } from './settings.js';
import { nativeClients, sessionKey, validId } from './sessions.js';
import { readOrcaSession } from './orca-session.js';
import { orcaSnapshot } from './orca-context.js';
import { ActiveSessions } from './active.js';
import { readOfficialPrices, referenceRates, refreshOfficialPrices } from './pricing.js';
import { CostHistory } from './cost-history.js';
import { costRange, type CostQuery } from './cost-report.js';
import { validateDetailQuery, type DetailQuery } from './session-details.js';
import { checkUpdates, updateInfo } from './updates.js';

const costClients = ['opencode', 'mimocode', 'deepseek', 'zcode'];
const nativeKey = (key: string) => {
  const [client, id, extra] = key.split(':');
  return extra === undefined && nativeClients.some(value => value === client) && validId(id);
};
const costKey = (key: string) => {
  const [client, id, extra] = key.split(':');
  return extra === undefined && costClients.includes(client) && validId(id);
};

export async function startServer(options: { port?: number; orcaRoot?: string; collector?: SessionCollector; pricingRefresh?: boolean; costHistory?: CostHistory } = {}): Promise<{ server: http.Server; url: string }> {
  const collector = options.collector ?? new SessionCollector();
  const costs = options.costHistory ?? new CostHistory(options.collector ? { native: () => collector.list(), sources: [] } : {});
  const active = new ActiveSessions();
  const hostSession = (id: string) => readOrcaSession(id, undefined, options.orcaRoot) ?? active.terminalSession(id);
  const isHostKey = (key: string) => key.startsWith('orca:') && validId(key.slice(5));
  const assets: Record<string, [string, string]> = {
    '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'],
    '/desktop-details.js': ['desktop-details.js', 'text/javascript; charset=utf-8'],
    '/model-metadata.js': ['model-metadata.js', 'text/javascript; charset=utf-8'],
    '/app-icon.svg': ['app-icon.svg', 'image/svg+xml'],
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
      } else if (req.method === 'GET' && url.pathname === '/api/updates') {
        if (url.searchParams.get('check') !== '1') json(200, updateInfo());
        else {
          try { json(200, await checkUpdates()); }
          catch (error) { json(502, { error: error instanceof Error ? error.message : '暂时无法连接 GitHub，请重试' }); }
        }
      } else if (req.method === 'GET' && url.pathname === '/api/active') {
        const client = url.searchParams.get('client') || undefined;
        const rawPid = url.searchParams.get('pid'); const pid = rawPid === null ? undefined : Number(rawPid);
        if ((client && ![...nativeClients, ...costClients].includes(client)) || (pid !== undefined && (!Number.isSafeInteger(pid) || pid < 2 || pid > 2147483647))) {
          json(400, { error: 'Invalid active-session target' }); return;
        }
        const id = url.searchParams.get('visibleId') || undefined, title = url.searchParams.get('visibleTitle') || undefined;
        const cwd = url.searchParams.get('cwd') || undefined, tty = url.searchParams.get('tty') || undefined;
        if (id && !/^[a-zA-Z0-9_-]{1,100}$/.test(id) || title && (title.length > 200 || /[\x00-\x1f]/.test(title)) || cwd && cwd.length > 4096 || tty && !/^ttys?\d{1,6}$/.test(tty)) { json(400, { error: 'Invalid visible-session hint' }); return; }
        json(200, active.get([...collector.list(), ...costs.activeFiles()], client, pid, { id, title, cwd, tty }));
      } else if (req.method === 'GET' && url.pathname === '/api/sessions') {
        json(200, collector.list(true).map(({ id, client, cwd, model, updatedAt, parentId, title, surface }) => ({ id, key: sessionKey({ client, id }), client, cwd, model, updatedAt, parentId, title, surface })));
      } else if (req.method === 'GET' && url.pathname === '/api/snapshot') {
        const key = url.searchParams.get('session') || '';
        if (!nativeKey(key) && !costKey(key) && !isHostKey(key)) { json(400, { error: 'Select a valid session' }); return; }
        const view = url.searchParams.get('view') === 'model' ? 'model' : 'budget';
        const hostId = isHostKey(key) ? key.slice(5) : url.searchParams.get('orcaSession');
        const host = hostId ? hostSession(hostId) : undefined;
        if (hostId && (!host || !isHostKey(key) && host.nativeKey !== key)) {
          json(404, { error: 'Orca 会话归属已变化' }); return;
        }
        const source = isHostKey(key) ? host?.nativeKey : key;
        let snapshot;
        if (source && costKey(source)) snapshot = costs.snapshot(source, view);
        else if (source && collector.list().some(s => sessionKey(s) === source)) {
          try { snapshot = await collector.get(source, { view, git: url.searchParams.get('git') !== '0' }); }
          catch (error) { if (!host) throw error; }
        }
        if (host) {
          snapshot = orcaSnapshot(host, view, snapshot);
          if (isHostKey(key)) snapshot.session = { ...snapshot.session, client: 'orca', id: host.id, agent: host.agent };
          else if (!source || snapshot.session.client === 'orca') {
            const [client, id] = key.split(':');
            snapshot.session = { ...snapshot.session, client, id, agent: host.agent };
          }
        }
        json(snapshot ? 200 : 404, snapshot ?? { error: 'Session is no longer available' });
      } else if (req.method === 'GET' && url.pathname === '/api/details') {
        const key = url.searchParams.get('session') || '';
        if (!nativeKey(key) && !isHostKey(key)) { json(400, { error: '请选择有本地日志的会话' }); return; }
        const query: DetailQuery = Object.fromEntries(['section', 'scope', 'status', 'kind', 'sort'].flatMap(name => url.searchParams.has(name) ? [[name, url.searchParams.get(name)!]] : []));
        for (const name of ['page', 'pageSize'] as const) if (url.searchParams.has(name)) query[name] = Number(url.searchParams.get(name));
        try { validateDetailQuery(query); } catch { json(400, { error: 'Invalid detail section, filter, sort or page' }); return; }
        if (isHostKey(key)) {
          const host = hostSession(key.slice(5));
          if (!host) { json(404, { error: 'Orca 会话已关闭' }); return; }
          if (host.nativeKey && collector.list().some(s => sessionKey(s) === host.nativeKey)) {
            json(200, { ...await collector.details(host.nativeKey, query), session: key }); return;
          }
          const { section, scope, pageSize } = validateDetailQuery(query);
          json(200, { session: key, section, scope, pageSize, page: 1, pages: 1, total: 0, items: [],
            supported: false, complete: false, unavailable: [], capturedAt: new Date().toISOString() }); return;
        }
        if (!collector.list().some(s => sessionKey(s) === key)) { json(404, { error: 'Session is no longer available' }); return; }
        json(200, await collector.details(key, query));
      } else if (req.method === 'GET' && url.pathname === '/api/config') {
        json(200, readPrices());
      } else if (req.method === 'GET' && url.pathname === '/api/costs') {
        const query: CostQuery = { period: url.searchParams.get('period') || undefined, start: url.searchParams.get('start') || undefined,
          end: url.searchParams.get('end') || undefined, timeZone: url.searchParams.get('timeZone') || undefined,
          tool: url.searchParams.get('tool') || undefined, page: url.searchParams.has('page') ? Number(url.searchParams.get('page')) : undefined,
          sessionScope: url.searchParams.get('sessionScope') ?? undefined };
        try { costRange(query); } catch { json(400, { error: 'Invalid period, dates, timezone, tool or page' }); return; }
        json(200, costs.report(query));
      } else if (req.method === 'POST' && url.pathname === '/api/costs/import') {
        if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { json(415, { error: 'Expected application/json' }); return; }
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of req) {
          const bytes = Buffer.from(chunk); size += bytes.length;
          if (size > 4 * 1024 * 1024) { json(413, { error: 'Accounting document is too large' }); return; }
          chunks.push(bytes);
        }
        try { json(200, { requests: costs.import(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }); }
        catch { json(400, { error: 'Invalid accounting document' }); }
      } else if (req.method === 'GET' && url.pathname === '/api/pricing') {
        const catalog = readOfficialPrices();
        json(200, { currency: 'USD', prices: referenceRates(catalog), catalog });
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
        const data = await readFile(new URL(file === 'app.js' ? './browser.js' : file.endsWith('.js') ? `./${file}` : `../../web/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type }); res.end(data);
      } else json(req.method === 'GET' ? 404 : 405, { error: 'Not found' });
    } catch { if (!res.headersSent) json(500, { error: 'Unable to read local session or configuration. Check file access and JSON syntax.' }); else res.end(); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 47831, '127.0.0.1', resolve); });
  void costs.refresh();
  const costTimer = setInterval(() => { void costs.refresh(); }, 10000); costTimer.unref();
  server.once('close', () => clearInterval(costTimer));
  if (options.pricingRefresh !== false) {
    void refreshOfficialPrices();
    const timer = setInterval(() => { void refreshOfficialPrices(); }, 60 * 60 * 1000); timer.unref();
    server.once('close', () => clearInterval(timer));
  }
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}
