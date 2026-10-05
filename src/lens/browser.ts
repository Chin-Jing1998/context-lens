import type { HudSnapshot, LensConfig, Rate, SessionInfo, Totals } from './types.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const count = (n: number | null): string => n === null ? '—' : n >= 1000000 ? `${(n / 1000000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('zh-CN');
const pct = (n: number | null): string => n === null ? '—' : `${n.toFixed(1)}%`;
const accuracy = { reported: '客户端报告', configured: '用户设置', estimated: '估算', derived: '计算值', unknown: '未知' };
const fields: (keyof Rate)[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h'];
const fieldNames = ['输入', '输出', '缓存读取', '缓存写入', '写入 5 分钟', '写入 1 小时'];
let version = 0;
let priceReady = false;
let latest: HudSnapshot | null = null;
const params = new URLSearchParams(location.search);
let preferredSession = params.get('session') ?? '';
const automatic = $<HTMLInputElement>('automatic');
automatic.checked = params.get('automatic') === '1';
$<HTMLSelectElement>('view').value = params.get('view') === 'model' ? 'model' : 'budget';
function notifyDesktop(): void {
  const bridge = (window as unknown as { webkit?: { messageHandlers?: { lens?: { postMessage(value: unknown): void } } } }).webkit?.messageHandlers?.lens;
  bridge?.postMessage({ session: $<HTMLSelectElement>('session').value, view: $<HTMLSelectElement>('view').value, automatic: automatic.checked ? '1' : '0' });
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data;
  } finally { clearTimeout(timer); }
}

function render(snapshot: HudSnapshot): void {
  latest = snapshot;
  $('dashboard').hidden = false; $('empty').hidden = true;
  $('session-meta').textContent = `${snapshot.session.client.toUpperCase()} · ${snapshot.session.model} · ${snapshot.session.cwd}`;
  const c = snapshot.context;
  $('context-total').textContent = `${count(c.usedTokens)} / ${count(c.denominator)} (${pct(c.percent)})`;
  $('budget-source').textContent = `${accuracy[c.budget.accuracy]} · ${c.budget.source}${c.budget.scope === 'body_after_prefix' ? ' · 压缩前缀之后的新增内容' : ''}`;
  const open = new Set([...$('category-rows').querySelectorAll('details[open]')].map(node => node.getAttribute('data-category')));
  const focusedCategory = document.activeElement?.closest('details[data-category]')?.getAttribute('data-category');
  const rows = document.createDocumentFragment(); const bars = document.createDocumentFragment();
  for (const s of c.segments) {
    const bar = el('span'); bar.style.backgroundColor = s.color; bar.style.width = `${Math.max(0, s.percent ?? 0)}%`; bar.title = `${s.label}: ${count(s.tokens)} (${pct(s.percent)})`; bars.append(bar);
    const tr = el('tr'); const th = el('th'); th.scope = 'row';
    const details = el('details'); details.dataset.category = s.id; details.open = open.has(s.id);
    const summary = el('summary'); summary.className = 'label-row';
    const swatch = el('span'); swatch.className = 'swatch'; swatch.style.backgroundColor = s.color; swatch.setAttribute('aria-hidden', 'true');
    summary.append(swatch, document.createTextNode(s.label));
    const source = el('p', `${accuracy[s.accuracy]} · ${s.source}${s.at ? ' · ' + new Date(s.at).toLocaleString('zh-CN') : ''}`); source.className = 'detail-source';
    details.append(summary, source); th.append(details);
    const tokens = el('td', `${s.accuracy === 'estimated' && s.tokens !== null ? '≈' : ''}${count(s.tokens)}`); tokens.title = s.tokens?.toLocaleString('zh-CN') ?? '客户端未报告';
    tr.append(th, tokens, el('td', pct(s.percent))); rows.append(tr);
  }
  $('segments').replaceChildren(bars);
  $('segments').setAttribute('aria-label', c.segments.map(s => `${s.label} ${count(s.tokens)} tokens ${pct(s.percent)}`).join('；'));
  $('category-rows').replaceChildren(rows);
  if (focusedCategory) $('category-rows').querySelector<HTMLElement>(`details[data-category="${focusedCategory}"] summary`)?.focus({ preventScroll: true });
  const usage = document.createDocumentFragment();
  for (const [label, t] of [['主会话', snapshot.totals.main], [`子代理 (${snapshot.totals.agentCount})`, snapshot.totals.agents], ['合计', snapshot.totals.all]] as [string, Totals][]) {
    const tr = el('tr'); tr.append(el('td', label + (t.complete ? '' : ' · 不完整')));
    for (const value of [t.input, t.output, t.cacheWrite, t.cacheRead, t.cacheReadRequests]) { const td = el('td', count(value)); td.title = value?.toLocaleString('zh-CN') ?? '无法确定'; tr.append(td); }
    tr.append(el('td', pct(t.hitRate === null ? null : t.hitRate * 100))); usage.append(tr);
  }
  $('usage-rows').replaceChildren(usage);
  const states = { warm: '有效', cold: '未建立 / 冷缓存', expired: '已过期', unknown: '未知' };
  $('cache-status').textContent = `主会话缓存：${states[snapshot.cache.state]}`;
  $('cache-detail').textContent = snapshot.cache.expiresAt ? `客户端报告有效期至 ${new Date(snapshot.cache.expiresAt).toLocaleString('zh-CN')}；历史命中不代表缓存现在有效。` : '客户端未提供有效期时保留未知状态。读取次数按缓存读取 tokens > 0 的独立请求计数。';
  $('cost').textContent = snapshot.cost.amount === null ? '未配置' : `${snapshot.cost.currency} ${snapshot.cost.amount.toFixed(6)}`;
  $('cost-note').textContent = snapshot.cost.amount === null ? '请在下方配置实际模型的价格。' : `${snapshot.cost.complete ? '自定义估算，主会话与子代理合计。' : '部分估算：存在未配置价格或未完整记录的历史。'}${snapshot.cost.unpricedModels.length ? ' 缺少价格：' + snapshot.cost.unpricedModels.join('、') : ''}`;
  $('native-cost').textContent = snapshot.nativeCostUsd === null ? '未报告' : `USD ${snapshot.nativeCostUsd.toFixed(4)}`;
  $('warning-count').textContent = `(${snapshot.warnings.length})`; $('warnings').hidden = snapshot.warnings.length === 0;
  $('warning-list').replaceChildren(...snapshot.warnings.map(text => el('li', text)));
  $('updated').textContent = `快照 ${new Date(snapshot.capturedAt).toLocaleTimeString('zh-CN')} · 上下文数据 ${c.updatedAt ? new Date(c.updatedAt).toLocaleString('zh-CN') : '等待有效数据'}`;
}

async function refreshSnapshot(): Promise<void> {
  const key = $<HTMLSelectElement>('session').value; const request = ++version;
  if (!key) { $('dashboard').hidden = true; $('empty').textContent = '选择一个会话以查看本机统计。新会话创建后可刷新列表。'; $('empty').hidden = false; return; }
  try {
    const data = await api<HudSnapshot>(`/api/snapshot?session=${encodeURIComponent(key)}&view=${$<HTMLSelectElement>('view').value}`);
    if (request !== version) return;
    render(data); $('connection').textContent = '已连接 · 本机';
  } catch (error) { if (request === version) {
    $('connection').textContent = latest ? '连接中断 · 保留上次结果' : `读取失败：${(error as Error).message}`;
    if (!latest) $('empty').textContent = '所选会话暂不可读，请刷新列表。';
  } }
}

async function refreshSessions(): Promise<void> {
  try {
    const sessions = await api<(SessionInfo & { key: string })[]>('/api/sessions');
    const select = $<HTMLSelectElement>('session'); const previous = preferredSession || select.value || (!automatic.checked ? localStorage.getItem('context-lens-session') : '') || '';
    const nodes = [new Option(sessions.length ? '选择 Claude / Codex 会话' : '尚未发现本机会话', '')];
    for (const session of sessions) nodes.push(new Option(`${session.client.toUpperCase()}${session.parentId ? ' · 子代理' : ''} · ${session.cwd.split(/[\\/]/).pop() || '未知项目'} · ${session.id.slice(0, 12)}`, session.key));
    select.replaceChildren(...nodes); if (sessions.some(s => s.key === previous)) select.value = previous;
    $('connection').textContent = '已连接 · 本机'; await refreshSnapshot();
  } catch { $('connection').textContent = '连接中断 · 无法获取会话列表'; }
}

function addPrice(model = '', rates: Rate = {}): void {
  const tr = el('tr'); const nameCell = el('td'); const name = el('input');
  name.value = model; name.placeholder = '实际模型 ID 或 *'; name.maxLength = 160; name.setAttribute('aria-label', '模型 ID'); name.dataset.field = 'model'; nameCell.append(name); tr.append(nameCell);
  for (const [i, field] of fields.entries()) {
    const td = el('td'); const input = el('input'); input.type = 'number'; input.min = '0'; input.max = '1000000000'; input.step = 'any'; input.placeholder = '未配置'; input.value = rates[field]?.toString() ?? ''; input.dataset.field = field; input.setAttribute('aria-label', `${model || '新模型'} ${fieldNames[i]}单价`); td.append(input); tr.append(td);
  }
  const td = el('td'); const remove = el('button', '移除'); remove.type = 'button'; remove.setAttribute('aria-label', `移除 ${model || '新模型'} 价格`); remove.onclick = () => tr.remove(); td.append(remove); tr.append(td);
  $('price-rows').append(tr);
}

async function loadPrices(): Promise<void> {
  try {
    const config = await api<LensConfig>('/api/config'); $<HTMLInputElement>('currency').value = config.currency;
    $('price-rows').replaceChildren(); for (const [model, rates] of Object.entries(config.prices)) addPrice(model, rates);
    if (!Object.keys(config.prices).length) addPrice(); priceReady = true;
  } catch { $('save-status').textContent = '价格配置无法读取；请检查本地 config.json，修复后重新加载页面。'; }
}
$<HTMLFormElement>('prices').onsubmit = async event => {
  event.preventDefault(); if (!priceReady) return;
  const button = $('prices').querySelector<HTMLButtonElement>('button[type=submit]')!;
  try {
    const prices: Record<string, Rate> = Object.create(null);
    for (const row of $('price-rows').querySelectorAll('tr')) {
      const model = row.querySelector<HTMLInputElement>('input[data-field=model]')!.value.trim(); if (!model) continue;
      if (Object.hasOwn(prices, model)) throw new Error('模型 ID 重复'); const rate: Rate = {};
      for (const field of fields) { const value = row.querySelector<HTMLInputElement>(`input[data-field=${field}]`)!.value; if (value !== '') rate[field] = Number(value); }
      prices[model] = rate;
    }
    button.disabled = true; $('save-status').textContent = '保存中';
    await api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currency: $<HTMLInputElement>('currency').value.toUpperCase(), prices }) });
    $('save-status').textContent = '已保存，费用已按新单价重算'; await refreshSnapshot();
  } catch (error) { $('save-status').textContent = `未保存：${(error as Error).message}`; }
  finally { button.disabled = false; }
};
$('add-price').onclick = () => { addPrice(); $('price-rows').lastElementChild?.querySelector('input')?.focus(); };
$('refresh').onclick = () => { void refreshSessions(); };
function sessionChanged(): void {
  localStorage.setItem('context-lens-session', $<HTMLSelectElement>('session').value); latest = null;
  $('dashboard').hidden = true; $('empty').textContent = '正在读取所选会话…'; $('empty').hidden = false; void refreshSnapshot();
}
$('session').onchange = () => {
  automatic.checked = false; preferredSession = ''; $('active-status').textContent = '已手动固定会话';
  sessionChanged(); notifyDesktop();
};
automatic.onchange = () => { notifyDesktop(); $('active-status').textContent = automatic.checked ? '正在定位活跃会话…' : '已手动固定会话'; };
$('view').onchange = () => { notifyDesktop(); void refreshSnapshot(); };
window.addEventListener('context-lens-active', async event => {
  if (!automatic.checked) return;
  const data = (event as CustomEvent<{ session: string; reason: string }>).detail;
  $('active-status').textContent = data.reason;
  const select = $<HTMLSelectElement>('session');
  if (select.value === data.session) return;
  preferredSession = data.session;
  if (data.session && ![...select.options].some(o => o.value === data.session)) await refreshSessions();
  select.value = data.session; sessionChanged();
});
const theme = $<HTMLSelectElement>('theme'); theme.value = localStorage.getItem('context-lens-theme') || 'auto';
const applyTheme = () => { document.documentElement.dataset.theme = theme.value; localStorage.setItem('context-lens-theme', theme.value); };
theme.onchange = applyTheme; applyTheme();
void loadPrices(); void refreshSessions();
async function poll() {
  if (automatic.checked && !(window as unknown as { webkit?: unknown }).webkit) {
    try {
      const data = await api<{ selected: string | null; reason: string }>('/api/active');
      window.dispatchEvent(new CustomEvent('context-lens-active', { detail: { session: data.selected || '', reason: data.reason } }));
    } catch { $('active-status').textContent = '自动定位连接中断'; }
  }
  await refreshSnapshot(); setTimeout(poll, 2000);
}
setTimeout(poll, 2000);
