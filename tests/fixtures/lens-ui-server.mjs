// Isolated, synthetic UI acceptance server. Never reads personal sessions or prices.
// Run after npm run build: node tests/fixtures/lens-ui-server.mjs [port]
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../../dist/lens/server.js';
import { estimateCost } from '../../dist/lens/usage.js';
import { readPrices } from '../../dist/lens/settings.js';
import { CostHistory } from '../../dist/lens/cost-history.js';
import { ZERO_TOKENS } from '../../dist/lens/usage.js';

const home = mkdtempSync(path.join(tmpdir(), 'context-lens-ui-'));
process.env.CONTEXT_LENS_HOME = home;
const state = { active: 'codex', scenario: 'normal', saveFailure: false, delayed: false };
const totals = { input: 1200000, output: 24000, cacheRead: 960000, cacheWrite: 10000, cacheWrite5m: 8000, cacheWrite1h: 2000, reasoning: 8000, requests: 24, cacheReadRequests: 20, hitRate: .8, complete: true };
const sessions = ['codex', 'claude'].map((client, i) => ({ id: 'ui-demo-' + i, client, cwd: '/UI验收/合成数据_非实测', title: client === 'codex' ? '检查组件状态' : '修复上下文统计', model: client === 'codex' ? 'gpt-6.1-sol' : 'claude-opus-5-5', updatedAt: new Date().toISOString() }));
const collector = {
  list() { return state.scenario === 'empty' ? [] : sessions; },
  async get(key, { view = 'budget' } = {}) {
    if (state.delayed) await new Promise(resolve => setTimeout(resolve, 1500));
    const unknown = state.scenario === 'unknown';
    const used = state.scenario === 'over' ? 220000 : state.scenario === 'zero' ? 0 : 80000;
    const denominator = view === 'model' ? 256000 : 200000;
    const at = new Date().toISOString();
    const row = (id, label, tokens, color) => ({ id, label, tokens, color, percent: tokens === null ? null : tokens / denominator * 100, source: 'UI 验收合成数据，非实测', accuracy: unknown ? 'unknown' : 'reported', at });
    const rows = [
      { ...row('mcpTools', 'MCP tools', unknown ? null : state.scenario === 'removed' ? 0 : 20000, '#007aff'), accuracy: 'estimated' },
      row('systemTools', 'System tools', 0, '#ef6834'), row('skills', 'Skills', null, '#11ae79'),
      row('systemPrompt', 'System prompt', 1.5, '#e4a000'), row('memoryFiles', 'Memory files', -1, '#83817b'),
      row('messages', 'Conversation', unknown ? null : used - 21000, '#30a46c'),
      row('unclassified', 'Unclassified', unknown ? null : 1000, '#64748b'),
      row('free', 'Free space', unknown ? null : Math.max(denominator - used, 0), '#aaaaaf'),
    ];
    if (unknown || state.scenario === 'zero') for (const r of rows) { r.tokens = unknown ? null : 0; r.percent = unknown ? null : 0; }
    const session = sessions.find(s => s.client + ':' + s.id === key) || sessions[0];
    const cost = estimateCost([{ ...totals, id: 'synthetic-request', model: session.model, at, complete: !unknown }], readPrices());
    return {
      session,
      context: { usedTokens: unknown ? null : used, modelTokens: 256000, denominator: unknown ? null : denominator, percent: unknown ? null : used / denominator * 100, view, budget: { tokens: 200000, source: 'UI 验收合成预算', accuracy: unknown ? 'estimated' : 'configured', scope: 'total' }, segments: rows, updatedAt: at, warnings: unknown ? ['缓冲未知，无法确定分类占比'] : [] },
      totals: { main: totals, agents: { ...totals, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0, reasoning: 0, requests: 0, cacheReadRequests: 0, hitRate: null }, all: { ...totals, complete: !unknown }, agentCount: 0 },
      cache: { state: unknown ? 'unknown' : 'warm', accuracy: 'reported', source: 'UI 验收合成缓存状态', expiresAt: unknown ? null : new Date(Date.now() + 120000).toISOString() },
      cost: unknown ? { ...cost, amount: null } : cost, nativeCostUsd: null,
      warnings: unknown ? ['合成场景：分类和累计数据不完整'] : [], capturedAt: at,
    };
  },
};
const costHistory = new CostHistory({ home, native: () => [], sources: [] });
costHistory.import({ version: 1, sessions: ['codex', 'claude', 'opencode', 'mimocode', 'deepseek', 'zcode'].map((tool, i) => ({
  tool, toolName: ['Codex', 'Claude Code', 'OpenCode', 'MiMo Code', 'DeepSeek Harness', 'ZCode'][i], id: 'cost-ui-' + i,
  title: ['检查组件状态', '核对缓存用量', '整理查询结果', '检查费用汇总', '核对工具调用', '验证切换状态'][i], complete: true,
  requests: [0, 2, 10, 35].map((days, index) => ({ ...ZERO_TOKENS, id: tool + ':cost-' + index,
    model: ['gpt-6.1-sol', 'claude-opus-5-5', 'deepseek-flash', 'mimo-v2.6-pro', 'deepseek-v4-pro', 'glm-5.3'][i],
    at: new Date(Date.now() - days * 86400000 - 60000).toISOString(), timestampKnown: true, input: 800000 + i * 40000,
    output: 100000, cacheRead: 600000, complete: true })),
})) });
costHistory.import({ version: 1, sessions: [{ tool: 'opencode', toolName: 'OpenCode', id: 'cost-ui-switch', title: '核对会话切换', complete: true,
  requests: [{ ...ZERO_TOKENS, id: 'opencode:switch', model: 'mimo-v2.6-pro', at: new Date(Date.now() - 60000).toISOString(), timestampKnown: true, input: 1000000, output: 10000, complete: true }] }] });
const backend = await startServer({ port: 0, collector, costHistory, pricingRefresh: false });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/__test/state') {
    // Test controls are loopback-only and cannot be changed by a browser request.
    if (req.headers.origin || req.headers['sec-fetch-site']) { res.writeHead(403); res.end(); return; }
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      Object.assign(state, JSON.parse(Buffer.concat(chunks).toString()));
    }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(state)); return;
  }
  if ((state.scenario === 'offline' && url.pathname.startsWith('/api/')) || (state.saveFailure && req.method === 'PUT')) {
    res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Synthetic acceptance failure' })); return;
  }
  if (url.pathname === '/api/active' && !url.searchParams.has('visibleId') && !url.searchParams.has('visibleTitle') && !url.searchParams.has('client')) {
    const multiple = state.scenario === 'multiple', empty = state.scenario === 'empty';
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ selected: multiple || empty ? null : state.active === 'claude' ? 'claude:ui-demo-1' : 'codex:ui-demo-0', reason: multiple ? '正在等待当前对话的活动记录' : empty ? '未发现运行中的会话' : 'UI 验收合成会话，非实际进程定位' })); return;
  }
  const headers = { ...req.headers, host: new URL(backend.url).host };
  if (headers.origin) headers.origin = backend.url;
  const proxy = http.request(backend.url + req.url, { method: req.method, headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
  proxy.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(proxy);
});
const port = Number(process.argv[2] || 47932);
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
console.log(JSON.stringify({ url: 'http://127.0.0.1:' + port + '/', home, synthetic: true }));
function stop() { server.close(); backend.server.close(); rmSync(home, { recursive: true, force: true }); process.exit(0); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
