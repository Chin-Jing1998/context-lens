import type { ActivityKind, HudSnapshot } from './types.js';
import type { DetailQuery, DetailSection } from './session-details.js';

type Row = Record<string, any>;
interface Page { section: DetailSection; items: Row[]; total: number; page: number; pages: number; complete: boolean; supported: boolean }
interface Options {
  session(): string;
  request<T>(url: string): Promise<T>; fit(): void; scroll(node: HTMLElement): void;
  currentCost(): void;
}
const $ = (id: string) => document.getElementById(id)!;
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, value = '', className = '') => {
  const item = document.createElement(tag); item.textContent = value; if (className) item.className = className; return item;
};
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const count = (value: unknown): string => !numeric(value) ? '—' : Math.abs(value) >= 1_000_000 ? (value / 1_000_000).toFixed(2) + 'M'
  : Math.abs(value) >= 1000 ? (value / 1000).toFixed(1) + 'k' : value.toLocaleString('zh-CN');
const time = (value: unknown): string => typeof value !== 'string' || !Number.isFinite(Date.parse(value)) ? '—'
  : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
const duration = (value: unknown): string => !numeric(value) ? '—' : value >= 60000 ? (value / 60000).toFixed(1) + ' min' : (value / 1000).toFixed(value < 10000 ? 2 : 1) + ' s';
const states: Record<string, string> = { succeeded: '成功', failed: '失败', running: '运行中', unknown: '状态未知', completed: '已完成', pending: '待执行', in_progress: '进行中' };
function money(value: Row | null | undefined): string {
  if (!numeric(value?.amount)) return '—';
  const symbol = ({ USD: '$', CNY: '¥', EUR: '€', JPY: '¥', GBP: '£' } as Record<string, string>)[value!.currency] ?? value!.currency + ' ';
  return (value!.complete ? '≈ ' : '≥ ') + symbol + value!.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: value!.amount < .01 ? 6 : 2 });
}

function row(title: string, subtitle: string, value: string, detail: string, state = ''): HTMLElement {
  const root = node('div', '', 'detail-row'); root.dataset.state = state;
  const copy = node('div', '', 'detail-row-copy'), heading = node('strong', title); heading.title = title;
  const meta = node('span', subtitle, 'detail-row-meta'); meta.title = subtitle; copy.append(heading, meta);
  const reading = node('div', '', 'detail-row-value'); reading.append(node('strong', value, 'number'), node('span', detail));
  root.append(copy, reading); return root;
}
function format(section: DetailSection, item: Row): HTMLElement {
  const scope = item.scope === 'agent' ? '子代理' : '主会话';
  if (section === 'requests') return row(item.model || '模型', time(item.at) + ' · ' + scope,
    money(item.cost), '输入 ' + count(item.input) + ' / 输出 ' + count(item.output));
  if (section === 'compactions') return row(({ auto: '自动压缩', manual: '手动压缩' } as Record<string, string>)[item.trigger] || '压缩',
    time(item.at) + ' · ' + duration(item.durationMs), count(item.beforeTokens) + ' → ' + count(item.afterTokens),
    numeric(item.releasedTokens) ? '释放 ' + count(item.releasedTokens) + ' tokens' : '—');
  if (section === 'hooks') return row(item.name || item.event || 'Hook', item.event + ' · ' + time(item.at),
    duration(item.durationMs), (states[item.status] || '状态未知') + (numeric(item.exitCode) ? ' · exit ' + item.exitCode : ''), item.status);
  if (section === 'hookStops') return row('停止检查', time(item.at),
    item.preventedContinuation === true ? '已拦截' : item.preventedContinuation === false ? '允许继续' : '状态未知',
    'Hook ' + count(item.hookCount) + ' / 错误 ' + count(item.errorCount), item.preventedContinuation === true ? 'failed' : '');
  if (section === 'files') {
    const parts = String(item.path || '').replaceAll('\\', '/').split('/'), name = parts.pop() || item.path;
    const action = ({ read: '读取', write: '写入', edit: '编辑' } as Record<string, string>)[item.action] || item.tool;
    const output = row(name, action + ' · ' + time(item.at), numeric(item.addedLines) && numeric(item.removedLines)
      ? '+' + count(item.addedLines) + ' −' + count(item.removedLines) : states[item.status] || '—',
      parts.join('/') || item.path, item.status); output.title = item.path; return output;
  }
  if (section === 'tasks') return row(item.title || item.id, time(item.at), states[item.status] || '状态未知', '', item.status);
  if (section === 'agents') return row(item.description || item.type || item.childSessionId || 'Agent',
    (item.model || '—') + (item.totals ? ' · ' + (item.totals.complete ? '' : '≥') + count(item.totals.requests) + ' 次请求' : ''),
    item.totals ? (item.totals.complete ? '' : '≥') + count(item.totals.input + item.totals.output) + ' tokens' : '—',
    (states[item.status] || '状态未知') + ' · ' + money(item.cost), item.status);
  return row(item.name, [time(item.at), scope, item.detail].filter(Boolean).join(' · '),
    duration(item.durationMs), states[item.status] || '状态未知', item.status);
}

export function createDetailsUI(options: Options) {
  const widgets: Widget[] = [], groups: Group[] = [];
  let session = '', messageSignature = '', stopsRevision = 0, stopsAt = 0, stopsLoading = false;
  const animations = new Map<HTMLElement, Animation>();
  const cancelAnimations = () => { animations.forEach(animation => animation.cancel()); animations.clear(); };
  new MutationObserver(() => {
    if (document.documentElement.dataset.uiMotion === 'instant' || document.documentElement.dataset.reduceMotion === 'true') cancelAnimations();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-ui-motion', 'data-reduce-motion'] });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { if (event.matches) cancelAnimations(); });
  function animate(target: HTMLElement, forward = true): void {
    animations.get(target)?.cancel();
    if (document.documentElement.dataset.uiMotion === 'instant' || document.documentElement.dataset.reduceMotion === 'true'
      || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    animations.set(target, target.animate([{ opacity: 0, transform: `translateX(${forward ? 4 : -4}px)` }, { opacity: 1, transform: 'none' }],
      { duration: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timing-std')) || 180, easing: 'cubic-bezier(.22,.8,.3,1)' }));
  }
  interface Widget {
    host: HTMLElement; query: DetailQuery; page: number; revision: number; fetchedAt: number; loading: boolean;
    signature: string; response: Page | null; reset(): void; load(force?: boolean): void;
  }
  function widget(id: string, section: DetailSection, extras: DetailQuery = {}, size = 6): Widget {
    const host = $(id); host.classList.add('detail-ledger');
    const toolbar = node('div', '', 'detail-toolbar'), total = node('span', '', 'detail-record-count');
    const list = node('div', '', 'detail-list'); list.tabIndex = 0; list.setAttribute('aria-label', '记录列表'); options.scroll(list);
    const empty = node('p', '读取记录…', 'detail-status'); empty.setAttribute('role', 'status');
    const retry = node('button', '重试', 'detail-retry'); retry.type = 'button'; retry.hidden = true;
    const pager = node('div', '', 'detail-pager'), previous = node('button', '上一页'), next = node('button', '下一页'), position = node('span', '', 'number');
    previous.type = next.type = 'button'; previous.setAttribute('aria-label', '上一页记录'); next.setAttribute('aria-label', '下一页记录');
    pager.append(previous, position, next); toolbar.append(total); host.append(toolbar, empty, retry, list, pager);
    const state: Widget = { host, query: { section, pageSize: size, scope: 'main', ...extras }, page: 1, revision: 0, fetchedAt: 0,
      loading: false, signature: '', response: null,
      reset() { this.revision++; this.page = 1; this.response = null; this.fetchedAt = 0; this.loading = false; this.signature = '';
        host.removeAttribute('aria-busy');
        list.replaceChildren(); empty.textContent = '读取记录…'; empty.hidden = false; retry.hidden = true; total.textContent = ''; pager.hidden = true; },
      load(force = false) {
        if (!options.session() || !this.host.getClientRects().length || this.loading || !force && Date.now() - this.fetchedAt < 5000) return;
        const key = options.session(), revision = ++this.revision;
        this.loading = true; previous.disabled = next.disabled = true; retry.hidden = true; host.setAttribute('aria-busy', 'true');
        const query = new URLSearchParams({ session: key, ...Object.fromEntries(Object.entries(this.query).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])), page: String(this.page) });
        void options.request<Page>('/api/details?' + query).then(data => {
          if (revision !== this.revision || key !== options.session()) return;
          this.response = data; this.page = data.page; this.fetchedAt = Date.now();
          const signature = JSON.stringify([data.items, data.page, data.pages, data.complete]);
          if (signature !== this.signature) { this.signature = signature; list.replaceChildren(...data.items.map(item => format(section, item))); }
          empty.hidden = data.items.length > 0; empty.textContent = '暂无记录';
          total.textContent = (data.complete ? '' : '≥') + data.total.toLocaleString('zh-CN') + ' 条';
          position.textContent = data.page + ' / ' + data.pages; pager.hidden = data.total === 0;
          previous.disabled = data.page <= 1; next.disabled = data.page >= data.pages;
          this.loading = false; host.removeAttribute('aria-busy'); options.fit();
        }).catch(() => {
          if (revision !== this.revision || key !== options.session()) return;
          this.loading = false; host.removeAttribute('aria-busy'); empty.hidden = false; empty.textContent = '记录暂不可读'; retry.hidden = false;
          previous.disabled = !this.response || this.page <= 1; next.disabled = !this.response || this.page >= this.response.pages;
        });
      } };
    function select(label: string, values: [string, string][], apply: (value: string) => void) {
      const control = node('select'); control.setAttribute('aria-label', label);
      for (const [value, title] of values) { const option = node('option', title); option.value = value; control.append(option); }
      toolbar.append(control); control.onchange = () => { apply(control.value); state.reset(); state.load(true); };
    }
    if (['hooks', 'files', 'activity'].includes(section)) select('记录状态', [['', '全部状态'], ['failed', '仅失败'], ['succeeded', '仅成功'],
      ...(section === 'hooks' ? [['unknown', '状态未知']] as [string, string][] : [['running', '运行中'], ['unknown', '结果未知']] as [string, string][])], value => state.query.status = value || undefined);
    if (section === 'requests') select('请求范围', [['all', '全部请求'], ['main', '主会话'], ['agents', '子代理']], value => state.query.scope = value);
    const sorts: [string, string][] = [['newest', '时间倒序'], ['oldest', '时间正序']];
    if (['hooks', 'activity', 'compactions'].includes(section)) sorts.push(['duration', '耗时排序']);
    if (section === 'requests') sorts.push(['cost', '费用排序']);
    select('记录排序', sorts, value => state.query.sort = value);
    function changePage(delta: number) { state.page += delta; state.fetchedAt = 0; list.scrollTop = 0; state.load(true); animate(list, delta > 0); }
    previous.onclick = () => changePage(-1); next.onclick = () => changePage(1); retry.onclick = () => state.load(true);
    widgets.push(state); return state;
  }
  const compactions = widget('compaction-ledger', 'compactions', {}, 4), agents = widget('agent-ledger', 'agents', {}, 4);
  const requests = widget('request-ledger', 'requests', { scope: 'all' }, 4);
  const hooks = widget('hook-ledger', 'hooks'), stops = widget('hook-stop-ledger', 'hookStops'), files = widget('file-ledger', 'files'), tasks = widget('task-ledger', 'tasks');
  const histories = new Map<ActivityKind, Widget>();
  for (const kind of ['commands', 'skills', 'mcp'] as ActivityKind[]) {
    const host = document.querySelector<HTMLElement>('.' + kind + '-panel .activity-history')!; host.id = kind + '-history';
    histories.set(kind, widget(host.id, 'activity', { kind, scope: 'all' }));
  }
  interface Group { name: string; active: string; tabs: HTMLElement; buttons: HTMLButtonElement[]; show(page: string, focus?: boolean): void }
  function group(name: string, views: Record<string, Widget | undefined>): Group {
    const tabs = $(name + '-tabs'), buttons = [...tabs.querySelectorAll<HTMLButtonElement>('[data-detail-page]')];
    const state: Group = { name, active: 'overview', tabs, buttons,
      show(page, focus = false) {
        const old = this.active, selected = buttons.find(button => button.dataset.detailPage === page && !button.hidden);
        if (!selected) return; this.active = page;
        buttons.forEach(button => { const active = button === selected; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
          $(name + '-' + button.dataset.detailPage + '-page').hidden = !active; });
        tabs.closest<HTMLElement>('.surface')!.dataset.detailPage = page;
        if (focus) selected.focus();
        if (old !== page) animate($(name + '-' + page + '-page'), buttons.findIndex(button => button === selected) > buttons.findIndex(button => button.dataset.detailPage === old));
        views[page]?.load(); options.fit();
      } };
    buttons.forEach(button => button.onclick = () => state.show(button.dataset.detailPage!));
    tabs.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const visible = buttons.filter(button => !button.hidden), index = visible.findIndex(button => button.dataset.detailPage === state.active);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length;
      state.show(visible[next].dataset.detailPage!, true);
    };
    groups.push(state); return state;
  }
  group('context', { compactions }); group('usage', { agents }); group('runtime', { hooks, stops, files, tasks });
  function available(id: string, value: boolean) { $(id).hidden = !value; }
  function updateGroups() {
    groups.forEach(state => { state.tabs.hidden = state.buttons.filter(button => !button.hidden).length <= 1;
      if (state.buttons.find(button => button.dataset.detailPage === state.active)?.hidden) state.show('overview'); });
  }
  function clear() {
    cancelAnimations();
    session = ''; messageSignature = ''; widgets.forEach(widget => widget.reset());
    stopsRevision++; stopsAt = 0; stopsLoading = false;
    for (const state of groups) { state.show('overview'); state.buttons.slice(1).forEach(button => button.hidden = true); }
    if ($('cost-requests-tab').getAttribute('aria-selected') === 'true') options.currentCost();
    $('cost-requests-tab').hidden = true; $('cache-expiry').hidden = true;
    for (const name of ['version', 'branch', 'permission']) $('runtime-' + name + '-row').hidden = true;
    updateGroups();
  }
  function update(snapshot: HudSnapshot) {
    const key = options.session(); if (key !== session) { clear(); session = key; }
    const messages = snapshot.context.messageBreakdown?.filter(item => numeric(item.tokens) && item.tokens > 0) || [];
    available('context-messages-tab', messages.length > 0);
    available('context-compactions-tab', (snapshot.insights?.compactions?.count ?? 0) > 0);
    available('usage-agents-tab', snapshot.totals.agentCount > 0 || (snapshot.insights?.agents?.total ?? 0) > 0);
    available('runtime-hooks-tab', (snapshot.insights?.hooks?.total ?? 0) > 0);
    available('runtime-files-tab', (snapshot.insights?.files?.operations ?? 0) > 0);
    available('runtime-tasks-tab', (snapshot.insights?.tasks?.total ?? 0) > 0);
    if (snapshot.insights?.hooks && document.querySelector('.runtime-panel')!.getClientRects().length && !stopsLoading && Date.now() - stopsAt >= 5000) {
      const revision = ++stopsRevision; stopsLoading = true;
      void options.request<Page>('/api/details?' + new URLSearchParams({ session: key, section: 'hookStops', scope: 'main', pageSize: '1' })).then(data => {
        if (revision !== stopsRevision || key !== options.session()) return;
        available('runtime-stops-tab', data.total > 0); updateGroups(); options.fit();
      }).catch(() => {}).finally(() => { if (revision === stopsRevision) { stopsLoading = false; stopsAt = Date.now(); } });
    }
    const native = ['claude', 'codex'].includes(snapshot.session.client); available('cost-requests-tab', native && (snapshot.totals.all.requests ?? 0) > 0);
    if ($('cost-requests-tab').hidden && $('cost-requests-tab').getAttribute('aria-selected') === 'true') options.currentCost();
    updateGroups();
    const signature = JSON.stringify(messages);
    if (signature !== messageSignature) {
      messageSignature = signature; const sum = messages.reduce((sum, item) => sum + (item.tokens ?? 0), 0);
      const names: Record<string, string> = { user: '用户消息', assistant: '助手回复', thinking: '明文推理', toolCall: '工具调用', toolResult: '工具返回', file: '文件正文', plan: '计划正文', summary: '压缩摘要', other: '其他文本' };
      $('message-total').textContent = (messages.some(item => item.accuracy === 'estimated') ? '≈' : '') + count(sum);
      $('message-rows').replaceChildren(...messages.map(item => { const line = node('tr'); const label = node('th', names[item.id]); label.scope = 'row';
        line.append(label, node('td', (item.accuracy === 'estimated' ? '≈' : '') + count(item.tokens), 'number'), node('td', sum ? (item.accuracy === 'estimated' ? '≈' : '') + ((item.tokens ?? 0) / sum * 100).toFixed(1) + '%' : '—', 'number')); return line; }));
    }
    const metadata = snapshot.insights?.metadata;
    for (const [name, field] of [['version', 'version'], ['branch', 'gitBranch'], ['permission', 'permissionMode']] as const) {
      const value = metadata?.[field]?.value; available('runtime-' + name + '-row', !!value); $('runtime-' + name).textContent = value || '';
    }
    const expiry = snapshot.cache.expiresAt;
    available('cache-expiry', !!expiry);
    if (expiry) $('cache-expiry').textContent = '缓存到期 ' + time(expiry);
    widgets.forEach(widget => widget.load()); options.fit();
  }
  return { update, clear,
    enter() { widgets.forEach(widget => widget.load()); },
    cost(page: string) { if (page === 'requests') requests.load(); },
    activity(kind: ActivityKind, history: boolean) {
      const widget = histories.get(kind)!; widget.host.hidden = !history;
      widget.host.setAttribute('role', 'tabpanel'); widget.host.setAttribute('aria-labelledby', kind + '-recent');
      $(kind + '-recent').setAttribute('aria-controls', widget.host.id);
      document.querySelector<HTMLElement>('.' + kind + '-panel .activity-list')!.hidden = history;
      if (history) widget.load();
    },
  };
}
