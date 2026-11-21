const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
(async () => {
  const { startServer } = await import(pathToFileURL(path.join(root, 'dist/lens/server.js')).href);
  const smoke = process.env.CONTEXT_LENS_DESKTOP_SMOKE === '1';
  const service = await startServer({ port: 0, pricingRefresh: !smoke, orcaRoot: smoke ? process.env.CONTEXT_LENS_SMOKE_ORCA_ROOT : undefined });
  process.parentPort.postMessage({ app: 'context-lens', url: service.url });
  process.on('SIGTERM', () => service.server.close(() => process.exit(0)));
})().catch(error => { process.parentPort.postMessage({ error: error.message }); process.exit(1); });
