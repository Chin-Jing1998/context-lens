import type { ActivityKind, HudSnapshot, LensConfig, Rate, Totals } from './types.js';
import type { CostAmount, CostReport } from './cost-report.js';
import { createDetailsUI } from './desktop-details.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const node = document.createElement(tag); node.textContent = text; return node; };
const text = (node: HTMLElement, value: string) => { if (node.textContent !== value) node.textContent = value; };
const count = (n: number | null): string => n === null ? '—' : n >= 1000000 ? (n / 1000000).toFixed(2) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n.toLocaleString('zh-CN');
const pct = (n: number | null): string => n === null ? '—' : n.toFixed(1) + '%';
const fields: (keyof Rate)[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h'];
const fieldNames = ['输入', '输出', '缓存读取', '缓存写入', '写入 5 分钟', '写入 1 小时'];
const categoryNames: Record<string, string> = { mcpTools: 'MCP 工具', systemTools: '系统工具', skills: '技能', systemPrompt: '系统提示词', memoryFiles: '记忆文件', mcpInstructions: 'MCP 服务指令', messages: '对话内容', unclassified: '未分类占用', buffer: '压缩缓冲', free: '可用空间' };
const bridge = (window as unknown as { webkit?: { messageHandlers?: { lens?: { postMessage(value: unknown): void } } } }).webkit?.messageHandlers?.lens;
const desktopHost = (window as unknown as { contextLensHost?: { onEvent(callback: (name: string, detail: unknown) => void): void } }).contextLensHost;
desktopHost?.onEvent((name, detail) => window.dispatchEvent(new CustomEvent(name, { detail })));
const storage = {
  get(key: string): string | null { try { return localStorage.getItem('context-lens-' + key); } catch { return null; } },
  set(key: string, value: string): void { try { localStorage.setItem('context-lens-' + key, value); } catch { /* Private browsing can deny storage. */ } },
};
const params = new URLSearchParams(location.search);
let selected = '';
let view = params.get('view') === 'model' ? 'model' : 'budget';
let theme = storage.get('theme') || 'auto';
if (!['auto', 'light', 'dark'].includes(theme)) theme = 'auto';
let latest: HudSnapshot | null = null;
let version = 0;
let priceReady = false, priceDirty = false, editVersion = 0, priceId = 0;
let accessibilityTrusted = false;
let desktopPlatform = 'darwin';
let priceLoadVersion = 0;
let officialRates: Record<string, Rate> = {};
let layerTrigger: HTMLElement | null = null;
let costPeriod = 'all', costVersion = 0, costAt = 0;
let activeCostPage: 'current' | 'query' | 'requests' = 'current';
let modelCostSignature = '';
let costReport: CostReport | null = null;
const settingsDialog = $<HTMLDialogElement>('settings-dialog');

function icon(name = 'chevron'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', '#i-' + name); svg.append(use); return svg;
}
function notifyDesktop(action = 'state', values: Record<string, string> = {}): void {
  bridge?.postMessage({ action, view, theme, ...values });
}
type UIStyle = Record<string, string>;
const uiThemes = ['native', 'glass', 'graphite', 'porcelain', 'spectrum', 'contrast', 'ink', 'bronze', 'cobalt'];
const uiThemeNames = ['原生玻璃', '清透玻璃', '石墨仪表', '白瓷柔光', '光谱轨道', '墨芯玻璃', '水墨宋韵', '青铜书卷', '青蓝刻度'];
const uiThemePalettes = [
  ['#fafafc', '#202124', '#dedee3', '#007aff'], ['#f7fbff', '#193a58', '#c6d6e6', '#287ee3'],
  ['#252e3a', '#eaf3ff', '#48576b', '#74b8ff'], ['#fffef8', '#2d4c40', '#cad9ce', '#43876d'],
  ['#1d253f', '#f1f1ff', '#435071', '#aa9bff'], ['#f7fbff', '#193a58', '#c6d6e6', '#287ee3'],
  ['#fffff7', '#252b28', '#c4ccc3', '#424e41'], ['#fbf4e6', '#44321f', '#d1bea1', '#9c713e'],
  ['#0d3454', '#f0f4ff', '#3f6884', '#75dbf1'],
];
const uiThemePresets: Record<string, UIStyle> = Object.fromEntries([
  ['native', 'system', 'false', 'false', 'native'], ['glass', 'song', 'false', 'false', 'settle'],
  ['graphite', 'fangsong', 'true', 'false', 'magnetic'], ['porcelain', 'kai', 'false', 'false', 'settle'],
  ['spectrum', 'song', 'true', 'false', 'sequence'], ['contrast', 'song', 'false', 'true', 'magnetic'],
  ['ink', 'song', 'false', 'false', 'instant'], ['bronze', 'fangsong', 'true', 'true', 'settle'],
  ['cobalt', 'kai', 'true', 'false', 'sequence'],
].map(([uiTheme, uiChinese, uiBold, uiItalic, uiMotion]) => [uiTheme, { uiTheme, uiChinese, uiBold, uiItalic, uiMotion }]));
let uiStyle: UIStyle = { ...(uiThemePresets[storage.get('ui-theme') || 'native'] || uiThemePresets.native) };
const chineseFamilies: Record<string, string> = { system: '"PingFang SC","Microsoft YaHei",sans-serif', song: '"Songti SC",STSong,SimSun,serif', fangsong: 'STFangsong,FangSong,"仿宋",serif', kai: '"Kaiti SC",STKaiti,KaiTi,"楷体",serif' };
const themeTiles = uiThemes.map((name, index) => {
  const button = el('button'); button.type = 'button'; button.className = 'ui-theme-tile'; button.dataset.uiTheme = name;
  button.setAttribute('aria-pressed', 'false'); button.setAttribute('aria-label', uiThemeNames[index]);
  const swatch = el('span'); swatch.className = 'ui-theme-swatch'; swatch.setAttribute('aria-hidden', 'true');
  button.append(swatch, el('span', uiThemeNames[index]));
  ['paper', 'text', 'line', 'accent'].forEach((key, i) => button.style.setProperty('--tile-' + key, uiThemePalettes[index][i]));
  button.style.setProperty('--tile-font', chineseFamilies[uiThemePresets[name].uiChinese]);
  button.style.fontWeight = uiThemePresets[name].uiBold === 'true' ? '700' : '400';
  button.style.fontStyle = uiThemePresets[name].uiItalic === 'true' ? 'italic' : 'normal';
  button.onclick = () => {
    if (bridge) bridge.postMessage({ action: 'ui-style', uiTheme: name });
    else { uiStyle = { ...uiThemePresets[name] }; storage.set('ui-theme', name); renderUIStyle(); }
  };
  $('ui-theme-grid').append(button); return button;
});
$('ui-theme-grid').onkeydown = event => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const index = themeTiles.indexOf(document.activeElement as HTMLButtonElement); if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? 8 : (index + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -3 : 3) + 9) % 9;
  themeTiles[next].focus();
};
function renderUIStyle(): void {
  themeTiles.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.uiTheme === uiStyle.uiTheme)));
  text($('settings-preview-name'), uiThemeNames[uiThemes.indexOf(uiStyle.uiTheme)]);
  text($('settings-preview-font'), ({ system: '系统中文', song: '宋体', fangsong: '仿宋', kai: '楷体' } as Record<string, string>)[uiStyle.uiChinese] + ' · Times New Roman');
  $('appearance-settings').hidden = uiStyle.uiTheme !== 'native';
  const root = document.documentElement;
  root.dataset.uiTheme = uiStyle.uiTheme; root.dataset.chinese = uiStyle.uiChinese;
  root.dataset.typeBold = uiStyle.uiBold; root.dataset.typeItalic = uiStyle.uiItalic;
  root.dataset.uiMotion = uiStyle.uiMotion;
}
window.addEventListener('context-lens-ui-style', event => {
  const data = (event as CustomEvent<UIStyle>).detail;
  if (!data || !uiThemes.includes(data.uiTheme) || !['song', 'fangsong', 'kai', 'system'].includes(data.uiChinese)
      || !['true', 'false'].includes(data.uiBold) || !['true', 'false'].includes(data.uiItalic)) return;
  uiStyle = { ...uiThemePresets[data.uiTheme] }; storage.set('ui-theme', data.uiTheme); renderUIStyle();
  if (uiStyle.uiMotion === 'instant') { cardAnimation?.cancel(); costTabAnimation?.cancel(); settingsTabAnimation?.cancel(); for (const state of activityPanels.values()) state.animation?.cancel(); }
  fitDesktopDetail();
});
$('desktop-ui-style').hidden = false;
renderUIStyle();
function autoScrollbar(node: HTMLElement): void {
  node.classList.add('auto-scrollbar');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reveal = () => {
    node.dataset.scrollActive = 'true';
    clearTimeout(timer); timer = setTimeout(() => { delete node.dataset.scrollActive; }, 900);
  };
  const target = node === document.documentElement ? window : node;
  target.addEventListener('scroll', reveal, { passive: true });
  node.addEventListener('pointerenter', reveal, { passive: true });
  node.addEventListener('pointermove', event => {
    if (event.clientX >= node.getBoundingClientRect().right - 14) reveal();
  }, { passive: true });
}
const activityNames: Record<ActivityKind, string> = { commands: '命令行', skills: '技能', mcp: 'MCP' };
const activityStates = { succeeded: '成功', failed: '失败', running: '运行中', unknown: '结果未知' };
const activityPanels = new Map<ActivityKind, { panel: HTMLElement; page: 'groups' | 'recent'; signature: string; animation: Animation | null }>();
for (const kind of Object.keys(activityNames) as ActivityKind[]) {
  const panel = ($<HTMLTemplateElement>('activity-template').content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
  panel.classList.add(kind + '-panel'); panel.dataset.kind = kind;
  panel.querySelector('h2')!.id = kind + '-title'; panel.querySelector('h2')!.textContent = activityNames[kind];
  panel.setAttribute('aria-labelledby', kind + '-title');
  panel.querySelector('.activity-unit')!.textContent = kind === 'commands' ? '次执行' : kind === 'skills' ? '次调用 / 读取' : '次调用';
  panel.querySelector('.activity-secondary .caption')!.textContent = kind === 'skills' ? '技能数' : '累计耗时';
  const list = panel.querySelector<HTMLElement>('.activity-list')!; list.id = kind + '-list';
  const tabs = [...panel.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  const state = { panel, page: 'groups' as 'groups' | 'recent', signature: '', animation: null as Animation | null };
  for (const tab of tabs) {
    tab.id = kind + '-' + tab.dataset.page; tab.setAttribute('aria-controls', list.id);
    tab.onclick = () => {
      if (state.page === tab.dataset.page) return;
      state.page = tab.dataset.page as 'groups' | 'recent'; state.signature = '';
      tabs.forEach(button => { const active = button === tab; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
      list.setAttribute('aria-labelledby', tab.id); renderActivity(kind); list.scrollTop = 0;
      state.animation?.cancel();
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.reduceMotion !== 'true' && uiStyle.uiMotion !== 'instant')
        state.animation = list.animate([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
    };
  }
  list.setAttribute('aria-labelledby', tabs[0].id);
  panel.querySelector<HTMLElement>('[role=tablist]')!.setAttribute('aria-label', activityNames[kind] + '统计视图');
  panel.querySelector<HTMLElement>('[role=tablist]')!.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs.find(t => t.getAttribute('aria-selected') !== 'true')!;
    next.click(); next.focus();
  };
  activityPanels.set(kind, state); $('activity-panels').append(panel); autoScrollbar(list);
}
function elapsed(ms: number | null, complete = true): string {
  if (ms === null) return '—';
  return (complete ? '' : '≥') + (ms >= 3600000 ? (ms / 3600000).toFixed(1) + ' h' : ms >= 60000 ? (ms / 60000).toFixed(1) + ' min' : (ms / 1000).toFixed(ms < 10000 ? 2 : 1) + ' s');
}
function renderActivity(kind: ActivityKind): void {
  const state = activityPanels.get(kind)!, panel = state.panel, data = latest?.activity?.[kind];
  detailUI.activity(kind, state.page === 'recent');
  const find = (selector: string) => panel.querySelector<HTMLElement>(selector)!;
  text(find('.activity-total'), data && (data.total || latest?.activity?.complete) ? (latest?.activity?.complete ? '' : '≥') + count(data.total) : '—');
  text(find('.activity-secondary strong'), !data ? '—' : kind === 'skills' ? count(new Set(data.groups.map(g => g.name)).size) : elapsed(data.durationMs, data.durationComplete));
  text(find('.activity-main'), data ? count(data.main) : '—'); text(find('.activity-agents'), data ? count(data.agents) : '—');
  const metrics: [string, number | undefined, string][] = kind === 'skills'
    ? [['显式调用', data?.invoked, ''], ['技能读取', data?.reads, ''], ['失败', data?.failed, 'failed']]
    : [['成功', data?.succeeded, 'succeeded'], ['失败', data?.failed, 'failed'], ['运行中', data?.running, 'running']];
  if (kind !== 'skills' && data?.unknown) metrics.push(['结果未知', data.unknown, 'unknown']);
  const signature = JSON.stringify([data, state.page, Boolean(latest), latest?.activity?.complete]);
  if (signature === state.signature) return;
  state.signature = signature;
  find('.activity-metrics').replaceChildren(...metrics.map(([name, value, status]) => {
    const item = el('div'), dt = el('dt', name), dd = el('dd', value === undefined ? '—' : count(value)); dd.className = 'number'; item.dataset.state = value ? status : ''; item.append(dt, dd); return item;
  }));
  const rows: HTMLElement[] = [];
  if (data && state.page === 'groups') for (const group of data.groups) {
    const row = el('div'); row.className = 'activity-row';
    const copy = el('div'); copy.className = 'activity-row-copy';
    const name = el('strong', group.name); name.title = group.name; copy.append(name);
    const detail = kind === 'skills' ? group.action === 'read' ? '技能读取' : '显式调用' : group.detail;
    if (detail) { const note = el('span', detail); note.className = 'activity-row-detail'; note.title = detail; copy.append(note); }
    const value = el('div'); value.className = 'activity-row-value'; const total = el('strong', count(group.total)); total.className = 'number'; value.append(total);
    if (group.failed) { const error = el('span', '失败 ' + count(group.failed)); error.className = 'activity-error'; value.append(error); }
    else { const share = el('span', Math.round(group.total / Math.max(1, data.total) * 100) + '%'); share.className = 'number'; value.append(share); }
    const track = el('span'); track.className = 'activity-row-track'; track.style.setProperty('--share', String(group.total / Math.max(1, data.total)));
    row.append(copy, value, track); rows.push(row);
  }
  if (data && state.page === 'recent') for (const call of data.recent) {
    const row = el('div'); row.className = 'activity-row activity-recent-row'; row.dataset.state = call.status;
    const copy = el('div'); copy.className = 'activity-row-copy';
    const label = call.name + (kind === 'mcp' && call.detail ? ' · ' + call.detail : '');
    const name = el('strong', label); name.title = label; copy.append(name);
    const parts = [call.at ? new Date(call.at).toLocaleTimeString('zh-CN', { hour12: false }) : '—', call.scope === 'agent' ? '子代理' : '主会话'];
    if (kind === 'skills') parts.push(call.action === 'read' ? '技能读取' : '显式调用');
    else if (call.exitCode !== null) parts.push('exit ' + call.exitCode);
    const note = el('span', parts.join(' · ')); note.className = 'activity-row-detail'; copy.append(note);
    const value = el('div'); value.className = 'activity-row-value'; value.append(el('span', activityStates[call.status]));
    if (kind !== 'skills') { const time = el('span', elapsed(call.durationMs)); time.className = 'number'; value.append(time); }
    row.append(copy, value); rows.push(row);
  }
  const list = find('.activity-list'), scroll = list.scrollTop;
  find('.activity-rows').replaceChildren(...rows);
  text(find('.activity-empty'), !latest ? '等待会话记录' : !data ? '暂无调用数据' : kind === 'skills' ? '暂无技能调用或读取记录' : '暂无执行记录');
  find('.activity-empty').hidden = rows.length > 0;
  list.scrollTop = scroll;
}
function renderActivities(): void { for (const kind of activityPanels.keys()) renderActivity(kind); }
let timingReceivedAt = 0, timingDelta = 0;
function clock(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
}
function renderRuntime(reset = false): void {
  if (reset) { timingReceivedAt = performance.now(); timingDelta = 0; }
  const age = performance.now() - timingReceivedAt;
  if (age < 8000 && $('connection').dataset.state !== 'offline') timingDelta = age;
  const t = latest?.timing;
  text($('runtime-status'), latest && $('connection').dataset.state === 'offline' ? '连接中断' : t ? ({ running: '运行中', waiting: '等待输入', interrupted: '已中断', unknown: '状态未知' })[t.status] : '—');
  $('runtime-status').dataset.state = t?.status || '';
  const delta = t?.status === 'running' ? timingDelta : 0;
  text($('runtime-total'), t?.elapsedMs == null ? '—' : (t.startAccuracy === 'observed' ? '≈' : '') + clock(t.elapsedMs + timingDelta));
  text($('runtime-current'), t?.currentTurnMs == null ? '—' : clock(t.currentTurnMs + delta));
  text($('runtime-active'), t?.activeMs == null ? '—' : (!t.complete ? '≥' : t.activeAccuracy === 'derived' ? '≈' : '') + clock(t.activeMs + delta));
  text($('runtime-turns'), t?.completedTurns == null ? '—' : (t.complete ? '' : '≥') + count(t.completedTurns));
  const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
  text($('runtime-start'), (t?.startAccuracy === 'observed' ? '≈' : '') + date(t?.startedAt));
  text($('runtime-last'), date(t?.lastActivityAt));
  text($('runtime-session-title'), latest?.session.title || latest?.session.id || '暂无活跃会话');
  for (const [id, value] of [['runtime-model', latest?.session.model], ['runtime-directory', latest?.session.cwd], ['runtime-session-title', latest?.session.title || latest?.session.id]] as [string, string | undefined][]) {
    if (id !== 'runtime-session-title') text($(id), value || '—'); $(id).title = value || '';
  }
  text($('runtime-client'), latest ? clientName(latest.session.client) : '—');
}
setInterval(() => { if (!document.documentElement.dataset.island || document.documentElement.dataset.island === 'runtime') renderRuntime(); }, 1000);
for (const node of [document.documentElement, $('model-cost-details'), $('price-list')]) autoScrollbar(node);
let layoutFrame = 0, lastLayout = '', cardTransition = false;
let cardAnimation: Animation | null = null;
let costTabAnimation: Animation | null = null;
let settingsTabAnimation: Animation | null = null;
window.addEventListener('context-lens-card-transition', event => {
  cardTransition = (event as CustomEvent<string>).detail === 'begin';
  if (!cardTransition) { lastLayout = ''; fitDesktopDetail(); }
});
function fitDesktopDetail(): void {
  if (!bridge || layoutFrame || cardTransition) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0;
    const island = document.documentElement.dataset.island;
    if (cardTransition) return;
    if (settingsDialog.open) {
      const page = settingsDialog.dataset.page || 'display';
      const style = getComputedStyle(settingsDialog), gap = parseFloat(style.rowGap) || 0;
      const pane = $(page === 'prices' ? 'price-settings' : page + '-settings');
      const natural = settingsDialog.querySelector('.dialog-heading')!.getBoundingClientRect().height
        + settingsDialog.querySelector('.settings-tabs')!.getBoundingClientRect().height + pane.scrollHeight
        + gap * 2 + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      const height = String(page === 'prices' ? 572 : Math.ceil(Math.max(200, natural)));
      const layout = ['settings', innerWidth, height].join(':');
      if (layout === lastLayout) return;
      lastLayout = layout; bridge.postMessage({ action: 'settings-layout', height, width: String(innerWidth) }); return;
    }
    if (!island) return;
    // Measure the content, not the viewport, so cards can shrink after a disclosure closes.
    const height = island === 'usage' ? '520' : String(Math.ceil(document.querySelector('main')!.getBoundingClientRect().height));
    const layout = [island, innerWidth, height].join(':');
    if (layout === lastLayout) return;
    lastLayout = layout; bridge.postMessage({ action: 'layout', island, height, width: String(innerWidth) });
  });
}
function activeStatus(message: string): void { $('follow-state').title = message; }
function status(message: string, offline = false): void {
  text($('connection'), message); $('connection').dataset.state = offline ? 'offline' : 'online';
}
function updateSelection(): void {
  const session = latest?.session;
  text($('session-label'), session?.title || (selected ? '正在读取对话' : '暂无活跃对话'));
  text($('session-id'), session ? session.client.toUpperCase() + ' · ' + session.id : '');
  $('session-label').title = session?.title || '';
  text($('follow-state'), '自动跟随');
}
async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status); return data;
  } finally { clearTimeout(timer); }
}
const detailUI = createDetailsUI({ session: () => selected, request: api,
  fit: fitDesktopDetail, scroll: autoScrollbar, currentCost: () => showCostPage('current') });
renderActivities();

// Stable DOM nodes keep open disclosures, keyboard focus and scroll position across polling.
const categories = new Map<string, { row: HTMLTableRowElement; bar: HTMLSpanElement; label: HTMLSpanElement; tokens: HTMLTableCellElement; percent: HTMLTableCellElement; swatch: HTMLSpanElement }>();
let activeContextSegment = '', contextSegmentAnchor: number | undefined;
function hideContextSegment(): void {
  $('context-segment-tooltip').hidden = true;
  for (const nodes of categories.values()) { delete nodes.bar.dataset.active; delete nodes.row.dataset.active; }
  activeContextSegment = ''; contextSegmentAnchor = undefined;
}
function showContextSegment(id: string, anchor?: number): void {
  const segment = latest?.context.segments.find(item => item.id === id), nodes = categories.get(id);
  if (!segment || !nodes || segment.tokens === null || !Number.isSafeInteger(segment.tokens) || segment.tokens <= 0) { hideContextSegment(); return; }
  const tooltip = $('context-segment-tooltip'), track = $('segments').getBoundingClientRect(), bounds = nodes.bar.getBoundingClientRect();
  if (!bounds.width || !track.width) { hideContextSegment(); return; }
  activeContextSegment = id; contextSegmentAnchor = anchor;
  text($('segment-tooltip-name'), categoryNames[id] || segment.label);
  text($('segment-tooltip-tokens'), (segment.accuracy === 'estimated' ? '≈' : '') + segment.tokens.toLocaleString('zh-CN'));
  $('segment-tooltip-swatch').style.backgroundColor = segment.color;
  for (const [key, item] of categories) {
    if (key === id) { item.bar.dataset.active = 'true'; item.row.dataset.active = 'true'; }
    else { delete item.bar.dataset.active; delete item.row.dataset.active; }
  }
  tooltip.hidden = false;
  const x = Math.max(0, Math.min(track.width, (anchor ?? bounds.left + bounds.width / 2) - track.left));
  const width = tooltip.getBoundingClientRect().width;
  const left = Math.max(0, Math.min(track.width - width, x - width / 2));
  tooltip.style.left = left + 'px';
  tooltip.style.setProperty('--arrow-x', Math.max(9, Math.min(width - 9, x - left)) + 'px');
}
$('segments').onpointerleave = () => {
  const focused = document.activeElement as HTMLElement | null;
  if (focused?.parentElement === $('segments')) showContextSegment(focused.dataset.category || '');
  else hideContextSegment();
};
$('segments').onkeydown = event => { if (event.key === 'Escape') { hideContextSegment(); event.stopPropagation(); } };
const usageMetrics: [string, keyof Totals][] = [['输入 tokens', 'input'], ['输出 tokens', 'output'], ['缓存写入', 'cacheWrite'], ['写入 5 分钟', 'cacheWrite5m'], ['写入 1 小时', 'cacheWrite1h'], ['缓存读取', 'cacheRead'], ['读取次数', 'cacheReadRequests'], ['命中率', 'hitRate'], ['推理输出', 'reasoning'], ['请求次数', 'requests']];
const usageCells = usageMetrics.map(([label]) => {
  const row = el('tr'); const heading = el('th', label); heading.scope = 'row'; row.append(heading);
  const cells = [el('td'), el('td'), el('td')]; row.append(...cells); $('usage-rows').append(row); return cells;
});
function render(snapshot: HudSnapshot): void {
  latest = snapshot; $('dashboard').hidden = false; $('empty').hidden = true;
  detailUI.update(snapshot);
  renderActivities();
  renderRuntime(true);
  updateSelection();
  const c = snapshot.context;
  text($('context-percent'), (c.budget.accuracy === 'estimated' && c.percent !== null ? '≈' : '') + pct(c.percent));
  text($('settings-preview-percent'), c.percent === null ? '—' : (c.budget.accuracy === 'estimated' ? '≈' : '') + Math.round(c.percent) + '%');
  $('settings-preview-percent').title = $('context-percent').textContent || '—';
  $('settings-preview-percent').parentElement!.style.setProperty('--preview-usage', Math.max(0, Math.min(100, c.percent ?? 0)) * 3.6 + 'deg');
  text($('context-used'), count(c.usedTokens)); text($('context-limit'), count(c.denominator));
  const visible = c.segments.filter(s => s.tokens !== null && Number.isSafeInteger(s.tokens) && s.tokens > 0);
  const allocated = visible.filter(s => s.tokens !== null);
  $('segments').parentElement!.hidden = !allocated.length;
  $('category-table').hidden = !visible.length;
  $('context-details').hidden = !visible.length;
  const notices = [
    c.percent !== null && c.percent > 100 ? '已超出当前口径的容量' : '',
    !allocated.length ? '暂无分类数据' : '',
  ].filter(Boolean);
  text($('context-notice'), notices.join(' · ')); $('context-notice').hidden = !notices.length;
  const contextPanel = document.querySelector<HTMLElement>('.context-panel');
  if (contextPanel) {
    contextPanel.classList.toggle('state-warning', c.percent !== null && c.percent >= 70 && c.percent < 85);
    contextPanel.classList.toggle('state-critical', c.percent !== null && c.percent >= 85);
  }
  const present = new Set(visible.map(s => s.id));
  for (const [id, nodes] of categories) if (!present.has(id as typeof c.segments[number]['id'])) { nodes.row.remove(); nodes.bar.remove(); categories.delete(id); }
  let segmentIndex = 0;
  for (const [index, s] of visible.entries()) {
    let n = categories.get(s.id);
    if (!n) {
      const row = el('tr'); const th = el('th'); th.scope = 'row';
      const summary = el('span'); summary.className = 'category-summary'; summary.dataset.category = s.id;
      const swatch = el('span'); swatch.className = 'swatch'; swatch.setAttribute('aria-hidden', 'true');
      const label = el('span'); summary.append(swatch, label); th.append(summary);
      const tokens = el('td'), percent = el('td'), bar = el('span'); row.append(th, tokens, percent);
      bar.dataset.category = s.id; bar.tabIndex = 0; bar.setAttribute('role', 'img');
      bar.setAttribute('aria-describedby', 'context-segment-tooltip');
      bar.onpointerenter = event => showContextSegment(s.id, event.clientX);
      bar.onpointermove = event => showContextSegment(s.id, event.clientX);
      bar.onfocus = () => showContextSegment(s.id);
      bar.onblur = hideContextSegment;
      bar.onclick = () => showContextSegment(s.id);
      row.onpointerenter = () => showContextSegment(s.id);
      row.onpointerleave = hideContextSegment;
      $('category-rows').append(row);
      n = { row, bar, label, tokens, percent, swatch }; categories.set(s.id, n);
    }
    text(n.label, categoryNames[s.id] || s.label); n.swatch.style.backgroundColor = s.color;
    text(n.tokens, (s.accuracy === 'estimated' && s.tokens !== null ? '≈' : '') + count(s.tokens));
    const approximate = s.accuracy === 'estimated' ? '≈' : '';
    n.tokens.title = s.tokens === null ? '—' : approximate + s.tokens.toLocaleString('zh-CN'); text(n.percent, (s.percent === null ? '' : approximate) + pct(s.percent));
    n.bar.style.backgroundColor = s.color; n.bar.style.width = Math.max(0, s.percent ?? 0) + '%';
    if ($('category-rows').children[index] !== n.row) $('category-rows').insertBefore(n.row, $('category-rows').children[index] ?? null);
    if (s.tokens === null) n.bar.remove();
    else {
      n.bar.setAttribute('aria-label', (categoryNames[s.id] || s.label) + ' ' + approximate + s.tokens.toLocaleString('zh-CN') + ' Tokens，' + approximate + pct(s.percent));
      if ($('segments').children[segmentIndex] !== n.bar) $('segments').insertBefore(n.bar, $('segments').children[segmentIndex] ?? null);
      segmentIndex++;
    }
  }
  $('segments').setAttribute('aria-label', allocated.map(s => (categoryNames[s.id] || s.label) + ' ' + (s.accuracy === 'estimated' ? '≈' : '') + count(s.tokens) + ' tokens ' + pct(s.percent)).join('；') || '暂无分类数据');
  if (activeContextSegment) showContextSegment(activeContextSegment, contextSegmentAnchor);
  text($('input-total'), count(snapshot.totals.all.input)); text($('output-total'), count(snapshot.totals.all.output));
  text($('cache-rate'), pct(snapshot.totals.all.hitRate === null ? null : snapshot.totals.all.hitRate * 100));
  text($('agents-heading'), '子代理 (' + snapshot.totals.agentCount + ')');
  usageMetrics.forEach(([, key], i) => {
    [snapshot.totals.main, snapshot.totals.agents, snapshot.totals.all].forEach((totals, j) => {
      const value = totals[key] as number | null;
      text(usageCells[i][j], key === 'hitRate' ? pct(value === null ? null : value * 100) : count(value));
      usageCells[i][j].title = (value?.toLocaleString('zh-CN') ?? '无法确定') + (totals.complete ? '' : ' · 记录不完整');
    });
  });
  const states = { warm: '有效', cold: '未建立', expired: '已过期', unknown: '未知' };
  text($('cache-status'), '主会话缓存：' + states[snapshot.cache.state]); $('cache-status').dataset.state = snapshot.cache.state;
  text($('cost'), costNumber(snapshot.cost, snapshot.cost.currency));
  $('cost').title = snapshot.cost.amount === null ? '' : snapshot.cost.amount + ' ' + snapshot.cost.currency;
  $('cost').classList.toggle('number', snapshot.cost.amount !== null);
  text($('cost-current-currency'), snapshot.cost.currency);
  text($('cost-session-title'), snapshot.session.title || snapshot.session.id);
  text($('cost-session-model'), snapshot.session.model || '—');
  $('cost-session-title').title = snapshot.session.title || snapshot.session.id;
  $('cost-session-model').title = snapshot.session.model || '';
  text($('cost-session-client'), clientName(snapshot.session.client));
  text($('cost-session-input'), count(snapshot.totals.all.input)); text($('cost-session-output'), count(snapshot.totals.all.output));
  text($('cost-session-requests'), count(snapshot.totals.all.requests));
  text($('cost-session-hit'), pct(snapshot.totals.all.hitRate === null ? null : snapshot.totals.all.hitRate * 100));
}
function clientName(value: string): string { return ({ claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', mimocode: 'MiMo Code', deepseek: 'DeepSeek', zcode: 'ZCode' } as Record<string, string>)[value] || value; }
function clearCurrentCost(): void {
  for (const id of ['cost', 'cost-current-currency', 'cost-session-model', 'cost-session-client', 'cost-session-input', 'cost-session-output', 'cost-session-requests', 'cost-session-hit']) text($(id), '—');
  $('cost').title = ''; text($('cost-session-title'), '暂无活跃对话');
  $('cost-session-title').title = ''; $('cost-session-model').title = '';
}
async function refreshSnapshot(): Promise<void> {
  const key = selected, mode = view, request = ++version;
  if (!key) { $('dashboard').hidden = true; $('empty').hidden = false; hideContextSegment(); clearCurrentCost(); text($('empty-message'), '等待 Claude 或 Codex 的当前活跃对话。'); return; }
  try {
    const data = await api<HudSnapshot>('/api/snapshot?session=' + encodeURIComponent(key) + '&view=' + mode);
    if (request !== version || key !== selected || mode !== view) return;
    render(data); status('已连接 · 本机');
  } catch {
    if (request !== version) return;
    status(latest ? '连接中断 · 保留上次结果' : '会话暂不可读', true);
    if (latest && latest.context.view !== view) { text($('context-notice'), '口径切换尚未完成，当前保留上次结果。'); $('context-notice').hidden = false; }
    if (!latest) { $('empty').hidden = false; text($('empty-message'), '当前对话暂不可读，正在重新连接。'); }
  }
}
async function refreshActive(): Promise<void> {
  if (bridge) { notifyDesktop('refresh'); return; }
  try {
    const data = await api<{ selected: string | null; reason: string }>('/api/active');
    activeStatus(data.reason); selectSession(data.selected || '');
  } catch { activeStatus('自动定位连接中断'); selectSession(''); }
}
function selectSession(key: string): void {
  if (key === selected) { updateSelection(); return; }
  selected = key; latest = null; version++;
  detailUI.clear();
  renderActivities();
  renderRuntime(true);
  hideContextSegment();
  text($('settings-preview-percent'), '—');
  clearCurrentCost();
  $('dashboard').hidden = true; $('empty').hidden = false; text($('empty-message'), '正在读取所选会话…');
  updateSelection(); void refreshSnapshot();
}
function costNumber(value: Pick<CostAmount, 'amount' | 'complete'>, currency = ''): string {
  if (value.amount === null) return '—';
  const symbol = currency ? ({ USD: '$', CNY: '¥', JPY: '¥', EUR: '€', GBP: '£' } as Record<string, string>)[currency] || currency + ' ' : '';
  const digits = value.amount > 0 && value.amount < 0.000001 ? 12 : value.amount > 0 && value.amount < 0.01 ? 6 : 2;
  const amount = value.amount > 0 && value.amount < 0.000000000001 ? value.amount.toExponential(2) : value.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits });
  return (value.complete ? '≈ ' : '≥ ') + symbol + amount;
}
function renderCostReport(data: CostReport): void {
  costReport = data;
  const cumulative = costPeriod === 'all';
  const amountOf = (item: CostReport['models'][number]) => cumulative ? item.cumulative : item.period;
  const models = data.models.filter(item => item.cumulative.requests > 0 && (cumulative || item.period.requests > 0 || !item.period.complete))
    .sort((a, b) => (amountOf(b).amount ?? -1) - (amountOf(a).amount ?? -1) || a.model.localeCompare(b.model));
  text($('cost-query-currency'), data.currency);
  text($('cost-range'), cumulative ? '截至 ' + data.range.end : data.range.start === data.range.end ? data.range.end : data.range.start + ' — ' + data.range.end);
  text($('cost-period-total'), data.loading ? '—' : costNumber(cumulative ? data.totals.cumulative : data.totals.period, data.currency));
  text($('cost-model-count'), data.loading ? '—' : models.length + ' 个模型');
  text($('cost-status'), data.loading ? '读取费用记录…' : models.length ? '' : '暂无费用记录'); $('cost-status').hidden = !data.loading && models.length > 0;
  const select = $<HTMLSelectElement>('cost-tool');
  const values = [{ id: '', name: '全部工具' }, ...data.tools];
  if (JSON.stringify([...select.options].map(o => [o.value, o.text])) !== JSON.stringify(values.map(o => [o.id, o.name]))) {
    const selectedTool = select.value; select.replaceChildren(...values.map(v => { const o = el('option', v.name); o.value = v.id; return o; }));
    select.value = values.some(v => v.id === selectedTool) ? selectedTool : '';
  }
  const signature = JSON.stringify([costPeriod, data.currency, models.map(item => [item.model, amountOf(item)])]);
  if (signature !== modelCostSignature) {
    const scroller = $('model-cost-details'), top = scroller.scrollTop;
    const rows = models.map(item => {
      const row = el('tr'), name = el('th', item.model), amount = amountOf(item), value = el('td', costNumber(amount));
      name.scope = 'row'; value.title = amount.amount === null ? '' : amount.amount + ' ' + data.currency;
      row.append(name, value); return row;
    });
    $('model-cost-rows').replaceChildren(...rows); scroller.scrollTop = top; modelCostSignature = signature;
  }
  $('model-cost-table').hidden = data.loading || !models.length;
  fitDesktopDetail();
}
async function refreshCosts(force = false): Promise<void> {
  if (!force && Date.now() - costAt < (costReport?.loading ? 1500 : 10000)) return;
  costAt = Date.now(); const request = ++costVersion;
  // Lifetime amounts already come from the report's cumulative fields; billing calculations remain on the server.
  const query = new URLSearchParams({ period: costPeriod === 'all' ? 'today' : costPeriod, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, tool: $<HTMLSelectElement>('cost-tool').value });
  if (costPeriod === 'custom') { query.set('start', $<HTMLInputElement>('cost-start').value); query.set('end', $<HTMLInputElement>('cost-end').value); }
  $('cost-periods').setAttribute('aria-busy', 'true');
  try {
    const data = await api<CostReport>('/api/costs?' + query);
    if (request !== costVersion) return;
    renderCostReport(data);
  } catch {
    if (request !== costVersion) return;
    text($('cost-status'), '费用暂不可读'); $('cost-status').hidden = false;
  } finally { if (request === costVersion) $('cost-periods').removeAttribute('aria-busy'); }
}
function changeCostFilter(): void {
  costReport = null; text($('cost-period-total'), '—'); text($('cost-model-count'), '—'); $('model-cost-table').hidden = true;
  text($('cost-status'), '读取费用记录…'); $('cost-status').hidden = false; $('model-cost-details').scrollTop = 0; void refreshCosts(true);
}
$<HTMLSelectElement>('cost-periods').onchange = event => {
  costPeriod = (event.currentTarget as HTMLSelectElement).value;
  $('cost-date-error').hidden = true; $('cost-range').hidden = false;
  $('cost-dates').hidden = costPeriod !== 'custom';
  if (costPeriod === 'custom') {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(p => [p.type, p.value]));
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    for (const id of ['cost-start', 'cost-end']) { const input = $<HTMLInputElement>(id); input.max = today; if (!input.value) input.value = costReport?.range[id === 'cost-start' ? 'start' : 'end'] || today; }
  }
  changeCostFilter(); fitDesktopDetail();
};
$<HTMLSelectElement>('cost-tool').onchange = changeCostFilter;
$<HTMLFormElement>('cost-dates').onsubmit = event => {
  event.preventDefault(); const start = $<HTMLInputElement>('cost-start'), end = $<HTMLInputElement>('cost-end');
  const error = !start.checkValidity() || !end.checkValidity() ? '请选择有效的起止日期' : start.value > end.value ? '开始日期不能晚于结束日期' : '';
  text($('cost-date-error'), error); $('cost-date-error').hidden = !error; $('cost-range').hidden = !!error;
  if (!error) changeCostFilter();
};
for (const id of ['cost-start', 'cost-end']) $<HTMLInputElement>(id).oninput = () => { $('cost-date-error').hidden = true; $('cost-range').hidden = false; };
function showCostPage(page: 'current' | 'query' | 'requests', focus = false): void {
  const changed = activeCostPage !== page; activeCostPage = page;
  for (const button of document.querySelectorAll<HTMLButtonElement>('#cost-tabs [data-cost-page]')) {
    const active = button.dataset.costPage === page; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  }
  $('cost-current-page').hidden = page !== 'current'; $('cost-query-page').hidden = page !== 'query'; $('cost-requests-page').hidden = page !== 'requests';
  costTabAnimation?.cancel(); costTabAnimation = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion === 'true';
  if (changed && !reduced && uiStyle.uiMotion !== 'instant') {
    costTabAnimation = $('cost-' + page + '-page').animate([{ opacity: 0, transform: 'translateX(' + (page === 'query' ? 4 : -4) + 'px)' }, { opacity: 1, transform: 'none' }], { duration: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timing-std')) || 200, easing: 'cubic-bezier(.22,.8,.3,1)' });
  }
  if (page === 'query') void refreshCosts();
  detailUI.cost(page);
  fitDesktopDetail();
}
document.querySelectorAll<HTMLButtonElement>('#cost-tabs [data-cost-page]').forEach(button => button.onclick = () => showCostPage(button.dataset.costPage as 'current' | 'query' | 'requests'));
$('cost-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const tabs = [...document.querySelectorAll<HTMLButtonElement>('#cost-tabs [data-cost-page]')].filter(button => !button.hidden);
  const index = tabs.findIndex(button => button.dataset.costPage === activeCostPage);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  showCostPage(tabs[next].dataset.costPage as 'current' | 'query' | 'requests', true);
});
function closeLayer(): boolean {
  const dialog = document.querySelector<HTMLDialogElement>('dialog[open]'); if (!dialog) return false;
  dialog.close(); if (layerTrigger?.getClientRects().length) layerTrigger.focus({ preventScroll: true }); return true;
}
function showToast(message: string, duration = 1800): void {
  const toast = document.createElement('div'); toast.className = 'toast glass'; toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 150ms'; setTimeout(() => toast.remove(), 160); }, duration);
}
function openLayer(dialog: HTMLDialogElement, trigger: HTMLElement): void {
  closeLayer(); layerTrigger = trigger; dialog.showModal();
}
type SettingsPage = 'display' | 'desktop' | 'prices' | 'updates';
const settingsPages: SettingsPage[] = ['display', 'desktop', 'prices', 'updates'];
function settingsTab(page: SettingsPage): void {
  const changed = settingsDialog.dataset.page !== page;
  const panes = { display: 'display-settings', desktop: 'desktop-settings', prices: 'price-settings', updates: 'updates-settings' };
  for (const name of settingsPages) {
    const chosen = name === page; $(name + '-tab').setAttribute('aria-selected', String(chosen)); $(name + '-tab').tabIndex = chosen ? 0 : -1;
    $(panes[name]).hidden = !chosen;
  }
  settingsDialog.dataset.page = page;
  settingsTabAnimation?.cancel(); settingsTabAnimation = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion === 'true';
  if (changed && settingsDialog.open && !reduced && uiStyle.uiMotion !== 'instant') {
    settingsTabAnimation = $(panes[page]).animate([{ opacity: .4, transform: 'translateX(4px)' }, { opacity: 1, transform: 'none' }], { duration: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timing-std')) || 200, easing: 'cubic-bezier(.22,.8,.3,1)' });
  }
  if (page === 'prices' && !priceDirty) void loadPrices();
  if (page === 'updates' && $('app-version').textContent === '—') void loadUpdateInfo();
  lastLayout = ''; fitDesktopDetail();
}
function openSettings(prices = false, trigger = $('settings-trigger')): void { hideContextSegment(); notifyDesktop('settings-open'); settingsTab(prices ? 'prices' : 'display'); openLayer(settingsDialog, trigger); fitDesktopDetail(); }
for (const dialog of [settingsDialog]) {
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeLayer(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    for (const card of $('price-rows').querySelectorAll<HTMLDetailsElement>('details[open]')) card.open = false;
    priceEditorControls(false);
    notifyDesktop('settings-close'); lastLayout = ''; fitDesktopDetail();
  });
  // A drag that started inside a dialog must not dismiss it on release outside.
  let outside = false;
  const isOutside = (event: MouseEvent) => { const r = dialog.getBoundingClientRect(); return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom; };
  dialog.addEventListener('pointerdown', event => { outside = event.target === dialog && isOutside(event); });
  dialog.addEventListener('click', event => { if (outside && event.target === dialog && isOutside(event)) closeLayer(); outside = false; });
}
document.querySelectorAll<HTMLButtonElement>('[data-close-dialog]').forEach(button => { button.onclick = closeLayer; });
$('settings-trigger').onclick = () => openSettings();
$('configure-prices').onclick = () => openSettings(true, $('configure-prices'));
document.querySelectorAll<HTMLButtonElement>('[data-settings-page]').forEach(button => button.onclick = () => settingsTab(button.dataset.settingsPage as SettingsPage));
settingsDialog.querySelector('[role=tablist]')!.addEventListener('keydown', event => {
  const key = (event as KeyboardEvent).key;
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) {
    event.preventDefault(); const pages = settingsPages;
    const index = pages.findIndex(name => $(name + '-tab').getAttribute('aria-selected') === 'true');
    const next = key === 'Home' ? 0 : key === 'End' ? pages.length - 1 : (index + (key === 'ArrowRight' ? 1 : pages.length - 1)) % pages.length;
    settingsTab(pages[next]); $(pages[next] + '-tab').focus();
  }
});
window.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.preventDefault(); event.stopPropagation(); if (activeContextSegment) { hideContextSegment(); return; } if (!closePriceEditor() && !closeLayer()) notifyDesktop('collapse');
});
window.addEventListener('keydown', event => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
  if (event.key === 'r') { event.preventDefault(); showToast('刷新中…'); void refreshActive(); }
  else if (event.key === 's') { event.preventDefault(); openSettings(); }
});
(window as unknown as { contextLensEscape: () => boolean }).contextLensEscape = () => { if (activeContextSegment) { hideContextSegment(); return true; } return closePriceEditor() || closeLayer(); };
window.addEventListener('context-lens-command', event => {
  const command = (event as CustomEvent<string>).detail;
  if (command === 'settings') openSettings();
});
window.addEventListener('context-lens-environment', event => {
  const data = (event as CustomEvent<Record<string, unknown>>).detail;
  for (const [key, attribute] of [['reduceMotion', 'reduceMotion'], ['reduceTransparency', 'reduceTransparency'], ['increaseContrast', 'increaseContrast']]) document.documentElement.dataset[attribute] = String(data[key] === true);
  if (data.reduceMotion === true) { cardAnimation?.cancel(); costTabAnimation?.cancel(); settingsTabAnimation?.cancel(); for (const state of activityPanels.values()) state.animation?.cancel(); }
  $<HTMLInputElement>('reduce-motion').checked = data.reduceMotion === true;
  $<HTMLInputElement>('reduce-motion').disabled = data.systemReduceMotion === true;
  desktopPlatform = typeof data.platform === 'string' ? data.platform : 'darwin';
  accessibilityTrusted = data.accessibilityTrusted === true;
  if (accessibilityTrusted && $('foreground-status').textContent === '等待授权') $('foreground-status').hidden = true;
  text($('accessibility-state'), desktopPlatform === 'win32' ? accessibilityTrusted ? '可用' : '待检测' : accessibilityTrusted ? '已授权' : '未授权');
  text($('accessibility-follow'), desktopPlatform === 'win32' || accessibilityTrusted ? '重新识别' : '打开权限设置');
  $<HTMLButtonElement>('accessibility-follow').disabled = false;
  $('desktop-actions').hidden = data.desktopConnected !== true;
  fitDesktopDetail();
});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { if (event.matches) { cardAnimation?.cancel(); costTabAnimation?.cancel(); settingsTabAnimation?.cancel(); } });
$('accessibility-follow').onclick = () => {
  $<HTMLButtonElement>('accessibility-follow').disabled = true;
  $('foreground-status').hidden = false;
  const recognize = desktopPlatform === 'win32' || accessibilityTrusted;
  text($('foreground-status'), recognize ? '识别中…' : '打开权限设置…');
  notifyDesktop(recognize ? 'recognize' : 'accessibility'); fitDesktopDetail();
};
window.addEventListener('context-lens-detection', event => {
  const data = (event as CustomEvent<{ state: string }>).detail;
  const values: Record<string, string> = { loading: '识别中…', recognized: '已定位当前会话', waiting: '等待前台会话', permission: '等待授权', failed: '识别失败' };
  if (!values[data?.state]) return;
  $('foreground-status').hidden = false; text($('foreground-status'), values[data.state]);
  $<HTMLButtonElement>('accessibility-follow').disabled = data.state === 'loading'; fitDesktopDetail();
});
$('desktop-actions').hidden = true;
async function loadUpdateInfo(check = false): Promise<void> {
  const button = $<HTMLButtonElement>('check-updates'), output = $('update-status');
  if (button.disabled) return;
  button.disabled = true; output.dataset.state = 'loading';
  text(output, check ? '正在检测…' : '');
  try {
    const info = await api<{ current: string; latest: string | null; state: string; source: string; release: string | null }>('/api/updates' + (check ? '?check=1' : ''));
    text($('app-version'), 'v' + info.current);
    $('update-latest-row').hidden = !info.latest; text($('update-latest'), info.latest ? 'v' + info.latest : '');
    const values: Record<string, string> = { idle: '', current: '已是最新版本', available: '有新版本可用', unpublished: '尚无发布版本' };
    text(output, values[info.state] || ''); output.dataset.state = info.state;
    const release = $<HTMLAnchorElement>('update-release'); release.hidden = !info.release;
    if (info.release) release.href = info.release;
  } catch (error) { output.dataset.state = 'failed'; text(output, error instanceof Error ? error.message : '检测失败，请重试'); }
  finally { button.disabled = false; fitDesktopDetail(); }
}
$('check-updates').onclick = () => { void loadUpdateInfo(true); };
for (const id of ['update-source', 'update-release']) $(id).onclick = event => {
  if (!bridge) return;
  event.preventDefault(); notifyDesktop('open-github', { url: $<HTMLAnchorElement>(id).href });
};
$('hide-ball').onclick = () => { closeLayer(); notifyDesktop('hide'); };
$<HTMLInputElement>('reduce-motion').onchange = event => {
  const enabled = (event.currentTarget as HTMLInputElement).checked;
  if (bridge) bridge.postMessage({ action: 'motion-preference', reduceMotion: String(enabled) });
  else { storage.set('reduce-motion', String(enabled)); document.documentElement.dataset.reduceMotion = String(enabled); }
  if (enabled) { cardAnimation?.cancel(); costTabAnimation?.cancel(); settingsTabAnimation?.cancel(); }
};
if (!bridge) {
  const reduced = storage.get('reduce-motion') === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.dataset.reduceMotion = String(reduced); $<HTMLInputElement>('reduce-motion').checked = reduced;
}

function priceEditorControls(inert: boolean, active?: HTMLDetailsElement): void {
  for (const node of settingsDialog.querySelectorAll<HTMLElement>('.dialog-heading,.settings-tabs,.price-toolbar,.settings-model-heading,.form-actions')) node.inert = inert;
  for (const card of $('price-rows').querySelectorAll<HTMLDetailsElement>('details')) {
    card.inert = inert && card !== active;
    card.querySelector<HTMLElement>('summary')!.inert = inert;
  }
}
function closePriceEditor(): boolean {
  if (!settingsDialog.open || $('price-settings').hidden) return false;
  const card = $('price-rows').querySelector<HTMLDetailsElement>('details[open]:not([hidden])');
  if (!card) return false;
  card.open = false; priceEditorControls(false); card.querySelector<HTMLElement>('summary')!.focus({ preventScroll: true }); return true;
}
function priceListState(): void {
  $('price-list-empty').hidden = !!$('price-rows').querySelector('details:not([hidden])');
}

function markDirty(): void { priceDirty = true; editVersion++; text($('save-status'), '未保存的更改'); $('save-status').dataset.state = ''; }
function fieldError(input: HTMLInputElement, message: string): void {
  const target = $(input.getAttribute('aria-describedby')!);
  text(target, message); target.hidden = !message;
  if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
}
function autoRates(model: string): Rate | undefined {
  const id = Object.hasOwn(officialRates, model) ? model : model.replace(/-\d{4}-\d{2}-\d{2}$|-\d{8}$/, '');
  return Object.hasOwn(officialRates, id) ? officialRates[id] : undefined;
}
function rateSignature(model: string, rates: Rate): string { return JSON.stringify([model, ...fields.map(field => rates[field] ?? null)]); }
function addPrice(model = '', rates: Rate = {}, expanded = false, automatic = false): void {
  const card = el('details'); card.className = 'price-card'; card.open = expanded;
  if (automatic) card.dataset.automaticPrice = rateSignature(model, rates);
  const summary = el('summary'), title = el('span', model === '*' ? '默认价格' : model || '新模型'); title.className = 'price-summary-name';
  const reading = el('span'); reading.className = 'price-summary-rates number';
  const heading = el('span'); heading.className = 'price-summary-text'; heading.append(title, reading);
  const edit = el('span', '编辑'); edit.className = 'price-edit-label'; summary.append(heading, edit); card.append(summary);
  const body = el('div'); body.className = 'price-fields';
  const editorHeading = el('div'); editorHeading.className = 'price-editor-heading';
  const editorTitle = el('strong', model || '添加模型');
  editorTitle.title = model;
  const back = el('button', '返回列表'); back.type = 'button'; back.onclick = () => { card.open = false; priceEditorControls(false); summary.focus({ preventScroll: true }); };
  editorHeading.append(editorTitle, back); body.append(editorHeading);
  const updateSummary = () => {
    const value = (key: string) => card.querySelector<HTMLInputElement>('[data-field=' + key + ']')?.value || '—';
    text(reading, '输入 ' + value('input') + ' / 输出 ' + value('output'));
  };
  const createField = (field: string, label: string, value: string, numeric = false) => {
    const wrap = el('label', label); const input = el('input'); input.dataset.field = field; input.value = value;
    input.setAttribute('aria-label', label);
    const id = 'price-field-' + (++priceId); input.id = id; input.setAttribute('aria-describedby', id + '-error');
    if (numeric) { input.type = 'number'; input.min = '0'; input.max = '1000000000'; input.step = 'any'; input.placeholder = '未配置'; }
    else { input.maxLength = 160; input.placeholder = '实际模型 ID 或 *'; input.autocomplete = 'off'; }
    const error = el('span'); error.id = id + '-error'; error.className = 'field-error'; error.hidden = true;
    input.addEventListener('input', () => {
      fieldError(input, '');
      if (field === 'model') {
        const name = input.value.trim(); text(title, name === '*' ? '默认价格' : name || '新模型'); text(editorTitle, name || '添加模型'); editorTitle.title = name;
        const automatic = $<HTMLInputElement>('currency').value.toUpperCase() === 'USD' ? autoRates(name) : undefined;
        if (automatic && (card.dataset.automaticPrice || fields.every(key => !card.querySelector<HTMLInputElement>('[data-field=' + key + ']')!.value))) {
          fields.forEach(key => { card.querySelector<HTMLInputElement>('[data-field=' + key + ']')!.value = automatic[key]?.toString() ?? ''; });
          card.dataset.automaticPrice = rateSignature(name, automatic);
        }
      } else delete card.dataset.automaticPrice;
      updateSummary(); markDirty();
    });
    wrap.append(input, error); return wrap;
  };
  body.append(createField('model', '模型 ID', model));
  const grid = el('div'); grid.className = 'rates-grid';
  fields.forEach((field, i) => grid.append(createField(field, fieldNames[i], rates[field]?.toString() ?? '', true)));
  const remove = el('button', '移除模型'); remove.type = 'button'; remove.className = 'remove-price';
  remove.onclick = () => { card.remove(); priceEditorControls(false); priceListState(); markDirty(); $('add-price').focus(); };
  const editorFooter = el('div'); editorFooter.className = 'price-editor-footer';
  const done = el('button', '完成编辑'); done.type = 'button'; done.onclick = back.onclick;
  editorFooter.append(remove, done); body.append(grid, editorFooter); card.append(body); $('price-rows').append(card); updateSummary();
  card.ontoggle = () => {
    if (card.open && !card.hidden && settingsDialog.open && !$('price-settings').hidden) {
      for (const other of $('price-rows').querySelectorAll<HTMLDetailsElement>('details[open]')) if (other !== card) other.open = false;
      priceEditorControls(true, card); if (!body.contains(document.activeElement)) card.querySelector<HTMLInputElement>('input')!.focus({ preventScroll: true });
    } else if (!$('price-rows').querySelector('details[open]:not([hidden])')) priceEditorControls(false);
  };
  body.onkeydown = event => {
    if (event.key !== 'Tab') return;
    const nodes = [...body.querySelectorAll<HTMLElement>('button,input')].filter(node => node.getClientRects().length && !(node as HTMLInputElement).disabled);
    if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
    else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
  };
  priceListState();
}
async function loadPrices(): Promise<void> {
  const request = ++priceLoadVersion, edit = editVersion;
  try {
    const query = new URLSearchParams({ period: 'today', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    const [config, official, usage] = await Promise.all([api<LensConfig>('/api/config'), api<LensConfig>('/api/pricing'), api<CostReport>('/api/costs?' + query).catch(() => null)]);
    if (request !== priceLoadVersion || edit !== editVersion || priceDirty) return;
    officialRates = official.prices; $<HTMLInputElement>('currency').value = config.currency;
    const used = new Set((usage?.models || []).filter(item => item.cumulative.requests > 0).map(item => item.model));
    if ((latest?.totals.all.requests ?? 0) > 0) {
      if (latest?.session.model) used.add(latest.session.model);
      for (const price of latest?.cost.pricing || []) used.add(price.model);
    }
    priceEditorControls(false); $('price-rows').replaceChildren();
    for (const [model, rates] of Object.entries(config.prices)) {
      addPrice(model, rates); ($('price-rows').lastElementChild as HTMLElement).hidden = model !== '*' && !used.has(model);
    }
    if (config.currency === 'USD' && !Object.hasOwn(config.prices, '*')) {
      for (const model of used) if (model && !Object.hasOwn(config.prices, model)) {
        const rates = autoRates(model); addPrice(model, rates || {}, false, !!rates);
      }
    }
    priceListState();
    text($('price-list-empty'), !usage ? '使用记录暂不可读' : usage.loading ? '读取使用记录…' : '暂无使用记录');
    if (usage?.loading && settingsDialog.open && !$('price-settings').hidden) setTimeout(() => { if (!priceDirty && settingsDialog.open && !$('price-settings').hidden) void loadPrices(); }, 2000);
    priceReady = true; text($('save-status'), '');
    $('prices').querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false; $<HTMLButtonElement>('add-price').disabled = false;
  } catch { text($('save-status'), '价格配置无法读取，请修复配置后重新加载。'); $('save-status').dataset.state = 'error'; }
}
$<HTMLButtonElement>('add-price').disabled = true;
$('add-price').onclick = () => { addPrice('', {}, true); markDirty(); $('price-rows').lastElementChild?.querySelector('input')?.focus(); };
$('currency').oninput = () => {
  fieldError($<HTMLInputElement>('currency'), '');
  // Dollar prices cannot be relabeled as another currency without conversion.
  if ($<HTMLInputElement>('currency').value.toUpperCase() !== 'USD') {
    for (const card of $('price-rows').querySelectorAll<HTMLElement>('[data-automatic-price]')) card.remove();
    if (!$('price-rows').children.length) addPrice('', {}, true);
  }
  markDirty();
};
$<HTMLFormElement>('prices').onsubmit = async event => {
  event.preventDefault(); if (!priceReady) return;
  const button = $('prices').querySelector<HTMLButtonElement>('button[type=submit]')!;
  if (button.disabled) return;
  const prices: Record<string, Rate> = Object.create(null); let firstInvalid: HTMLInputElement | null = null;
  const seenModels = new Set<string>();
  const invalid = (input: HTMLInputElement, message: string) => { fieldError(input, message); if (message && !firstInvalid) firstInvalid = input; };
  const currency = $<HTMLInputElement>('currency'); const currencyValue = currency.value.trim().toUpperCase();
  invalid(currency, /^[A-Z]{3}$/.test(currencyValue) ? '' : '请输入 3 位英文字母币种。');
  for (const card of $('price-rows').querySelectorAll<HTMLDetailsElement>('.price-card')) {
    const name = card.querySelector<HTMLInputElement>('[data-field=model]')!; const model = name.value.trim(); const rate: Rate = {};
    invalid(name, '');
    let hasRates = false;
    for (const field of fields) {
      const input = card.querySelector<HTMLInputElement>('[data-field=' + field + ']')!;
      const value = input.value; const number = Number(value);
      const error = input.validity.badInput || (value !== '' && (!Number.isFinite(number) || number < 0 || number > 1e9)) ? '请输入 0 至 10 亿之间的有效单价。' : '';
      invalid(input, error); if (value !== '' || error) hasRates = true; if (value !== '' && !error) rate[field] = number;
    }
    if (!model && !hasRates) continue;
    if (!model || model.length > 160 || /[\x00-\x1f\x7f]/.test(model) || ['__proto__', 'constructor', 'prototype'].includes(model)) invalid(name, '请输入有效模型 ID，或使用 * 设置默认价格。');
    else if (seenModels.has(model)) invalid(name, '模型 ID 重复。');
    else {
      seenModels.add(model);
      if (currencyValue !== 'USD' || card.dataset.automaticPrice !== rateSignature(model, rate)) prices[model] = rate;
    }
  }
  if (firstInvalid) {
    const input = firstInvalid as HTMLInputElement; const card = input.closest('details'); if (card) card.open = true; input.focus();
    text($('save-status'), '请检查标出的字段'); $('save-status').dataset.state = 'error'; return;
  }
  const savedVersion = editVersion;
  button.disabled = true; text($('save-status'), '保存中…'); $('save-status').dataset.state = '';
  try {
    await api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currency: currencyValue, prices }) });
    priceDirty = editVersion !== savedVersion;
    text($('save-status'), priceDirty ? '已保存；仍有新的未保存更改' : '已保存，费用已重新计算'); await refreshSnapshot(); costReport = null; if (activeCostPage === 'query') await refreshCosts(true);
  } catch { text($('save-status'), '保存失败，草稿已保留。请检查连接后重试。'); $('save-status').dataset.state = 'error'; }
  finally { button.disabled = false; }
};
window.addEventListener('beforeunload', event => { if (priceDirty) { event.preventDefault(); event.returnValue = ''; } });
$('refresh').onclick = async () => {
  const button = $<HTMLButtonElement>('refresh'); button.disabled = true;
  try { await refreshActive(); } finally { button.disabled = false; }
};
document.querySelectorAll<HTMLInputElement>('input[name=theme]').forEach(input => {
  input.checked = input.value === theme;
  input.onchange = () => { theme = input.value; document.documentElement.dataset.theme = theme; storage.set('theme', theme); notifyDesktop(); };
});
document.documentElement.dataset.theme = theme;
window.addEventListener('context-lens-active', event => {
  const data = (event as CustomEvent<{ session: string; reason: string }>).detail;
  activeStatus(data.reason); selectSession(data.session);
});
window.addEventListener('context-lens-island', event => {
  const section = (event as CustomEvent<string>).detail;
  if (!['context', 'usage', 'cost', 'commands', 'skills', 'mcp', 'runtime'].includes(section)) return;
  const changed = document.documentElement.dataset.island !== section;
  hideContextSegment();
  document.documentElement.dataset.island = section;
  cardAnimation?.cancel(); cardAnimation = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reduceMotion === 'true';
  if (changed && !reduced && uiStyle.uiMotion !== 'instant') {
    const card = document.querySelector<HTMLElement>('.' + section + '-panel');
    const duration = uiStyle.uiMotion === 'magnetic' ? 320 : uiStyle.uiMotion === 'sequence' ? 330 : uiStyle.uiMotion === 'native' ? 220 : 260;
    cardAnimation = card?.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration, easing: 'cubic-bezier(.22,.8,.3,1)' }) || null;
  }
  if (section === 'cost' && changed) showCostPage('current');
  detailUI.enter();
  for (const id of ['context-details', 'usage-details']) $<HTMLDetailsElement>(id).open = true;
  lastLayout = ''; window.scrollTo(0, 0); fitDesktopDetail();
});
if (bridge) {
  document.documentElement.dataset.desktop = 'true';
  document.documentElement.dataset.island = 'context';
  const observer = new ResizeObserver(fitDesktopDetail);
  observer.observe(document.querySelector('main')!); observer.observe(settingsDialog);
  window.addEventListener('resize', () => { lastLayout = ''; fitDesktopDetail(); });
}
async function poll(): Promise<void> {
  if (!bridge) await refreshActive();
  await refreshSnapshot(); if (activeCostPage === 'query' && (!bridge || document.documentElement.dataset.island === 'cost')) await refreshCosts(); setTimeout(poll, 2000);
}
updateSelection(); notifyDesktop('ready'); void refreshActive(); setTimeout(poll, 2000);
