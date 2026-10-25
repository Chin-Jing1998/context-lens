import * as fs from 'node:fs';
import { buildContext, percentageNumber, tokenNumber } from './context.js';
import { readSession, type ParsedSession } from './reader.js';
import { discoverSessions, checkpoint, readLiveClaude, sessionKey, type SessionFile, type LiveClaude } from './sessions.js';
import { readPrices, resolveClaudeSettings, resolveCodexSettings, type LaunchSettings } from './settings.js';
import { addTotals, cacheState, estimateCost, sumRequests, TOKEN_KEYS } from './usage.js';
import { summarizeActivity, type ActivityLog } from './activity.js';
import { sessionTiming } from './timing.js';
import { summarizeDetails } from './claude-details.js';
import { buildSessionDetails, type DetailQuery, type DetailSource } from './session-details.js';
import { officialModelMetadata } from './model-metadata.js';
import type { HudSnapshot, LensConfig, RequestUsage, Totals } from './types.js';

function totals(parsed: ParsedSession, requests: RequestUsage[]): Totals {
  const sum = sumRequests(requests, parsed.complete);
  if (parsed.cumulative) {
    for (const key of TOKEN_KEYS) {
      if (parsed.cumulative[key] > sum[key]) { sum[key] = parsed.cumulative[key]; sum.complete = false; }
    }
    if (!sum.complete) { sum.requests = null; sum.cacheReadRequests = null; }
  }
  sum.hitRate = sum.input ? sum.cacheRead / sum.input : null;
  return sum;
}

export class SessionCollector {
  private files: SessionFile[] = [];
  private scanned = 0;
  // ponytail: reread only changed logs; use incremental byte offsets if large active logs become slow.
  private parsed = new Map<string, { stamp: string; size: number; data: ParsedSession }>();
  constructor(private roots?: { claude?: string; codex?: string }) {}

  list(refresh = false): SessionFile[] {
    if (refresh || Date.now() - this.scanned > 2000) { this.files = discoverSessions(this.roots); this.scanned = Date.now(); }
    return this.files;
  }

  private async read(file: SessionFile): Promise<ParsedSession> {
    const stat = fs.statSync(file.file);
    const stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    const old = this.parsed.get(file.file);
    if (old?.stamp === stamp) { old.data.info.title = file.title; return old.data; }
    const data = await readSession(file.file, file);
    try {
      const observed = new Set(data.requests.map(row => row.id));
      const saved = checkpoint(data.info, data.requests, data.cumulative);
      data.requests = saved.requests; data.cumulative = saved.cumulative;
      if (saved.requests.some(row => !observed.has(row.id))) {
        if (data.activity) data.activity.complete = false;
        if (data.timing) data.timing.complete = false;
        if (data.details) data.details.complete = false;
        data.warnings.push('Older request counters were retained; detailed event history is incomplete');
      }
    } catch { data.warnings.push('Token checkpoint unavailable; displaying readable log history'); }
    if (old && stat.size < old.size) {
      data.warnings.push('Log was truncated; retained deduplicated token checkpoint');
      if (data.activity) data.activity.complete = false;
      if (data.timing) data.timing.complete = false;
      if (data.details) data.details.complete = false;
    }
    if (this.parsed.size >= 32 && !this.parsed.has(file.file)) this.parsed.delete(this.parsed.keys().next().value!);
    this.parsed.set(file.file, { stamp, size: stat.size, data });
    return data;
  }

  async get(key: string, options: { view?: 'budget' | 'model'; launch?: LaunchSettings } = {}): Promise<HudSnapshot> {
    const file = this.list().find(f => sessionKey(f) === key);
    if (!file) throw new Error('Session not found; refresh the session list');
    return this.snapshot(file, options);
  }

  async details(key: string, query: DetailQuery = {}) {
    const files = this.list(), file = files.find(value => sessionKey(value) === key);
    if (!file) throw new Error('Session not found; refresh the session list');
    const selected = [file], ids = new Set([file.id]);
    for (let depth = 0; depth < 20; depth++) {
      let added = false;
      for (const child of files) if (child.client === file.client && child.parentId && ids.has(child.parentId) && !ids.has(child.id)) {
        selected.push(child); ids.add(child.id); added = true;
      }
      if (!added) break;
    }
    const sources: DetailSource[] = [], unavailable: string[] = [];
    for (const current of selected) {
      try { sources.push({ file: current, parsed: await this.read(current) }); }
      catch (error) { if (current === file) throw error; unavailable.push(current.id); }
    }
    let prices: LensConfig;
    try { prices = readPrices(); } catch { prices = { currency: 'USD', prices: {} }; }
    return buildSessionDetails(key, sources, prices, query, unavailable);
  }

  async snapshot(file: SessionFile, options: { view?: 'budget' | 'model'; launch?: LaunchSettings; live?: LiveClaude } = {}): Promise<HudSnapshot> {
    const main = await this.read(file);
    const warnings = [...main.warnings];
    const mainTotals = totals(main, main.requests);
    const ids = new Set(main.requests.map(r => r.id));
    const requests = [...main.requests];
    let agentTotals = sumRequests([]);
    let agentCount = 0;
    const agentActivity: ActivityLog[] = [];
    const descendants = new Set([file.id]);
    for (let depth = 0; depth < 20; depth++) {
      let added = false;
      for (const child of this.list()) {
        if (child.client !== file.client || !child.parentId || !descendants.has(child.parentId) || descendants.has(child.id)) continue;
        descendants.add(child.id); added = true; agentCount++;
        try {
          const parsed = await this.read(child);
          if (parsed.activity) agentActivity.push(parsed.activity);
          const own = parsed.requests.filter(row => !ids.has(row.id));
          for (const row of own) ids.add(row.id);
          requests.push(...own);
          // Cumulative fallbacks are used only when no response IDs are available: inherited IDs have already been removed.
          agentTotals = addTotals(agentTotals, totals(own.length === parsed.requests.length ? parsed : { ...parsed, cumulative: undefined }, own));
          warnings.push(...parsed.warnings.map(w => `Agent ${child.id}: ${w}`));
        } catch { agentTotals.complete = false; agentActivity.push({ calls: [], complete: false }); warnings.push(`Agent ${child.id}: log unavailable`); }
      }
      if (!added) break;
    }
    const now = Date.now();
    const candidate = file.client === 'claude' ? options.live ?? readLiveClaude(main.info) : null;
    const live = candidate?.stdin.session_id === main.info.id && Number.isFinite(Date.parse(candidate.at)) ? candidate : null;
    let used = main.used;
    let capacity = tokenNumber(main.capacity) || null;
    let at = main.at;
    let reportedPercent: number | null = null;
    const fresh = live && (!at || Date.parse(live.at) >= Date.parse(at));
    if (fresh) {
      const u = live.stdin.context_window?.current_usage;
      used = u && tokenNumber(u.input_tokens) !== null
        ? u.input_tokens! + (tokenNumber(u.cache_read_input_tokens) ?? 0) + (tokenNumber(u.cache_creation_input_tokens) ?? 0) : null;
      if (used === 0) used = null;
      // 首次响应及压缩后的零占位不能证明窗口为空。
      reportedPercent = percentageNumber(live.stdin.context_window?.used_percentage) || null;
      at = live.at;
    }
    const metadata = file.client === 'claude' ? officialModelMetadata(main.info.model) : undefined;
    const contextLive = live && (fresh || live.stdin.model?.id === main.info.model
      || metadata && officialModelMetadata(live.stdin.model?.id)?.id === metadata.id) ? live : null;
    if (contextLive && (fresh || !capacity)) capacity = tokenNumber(contextLive.stdin.context_window?.context_window_size) || capacity;
    const settings = file.client === 'claude'
      ? resolveClaudeSettings({ cwd: main.info.cwd, model: contextLive?.stdin.model?.id || main.info.model, capacity,
        env: contextLive?.environment ?? {}, launch: options.launch ?? contextLive?.launch })
      : resolveCodexSettings({ cwd: main.info.cwd, capacity, launch: options.launch, runtime: main.runtime });
    warnings.push(...settings.warnings);
    if (contextLive?.hudWindow && tokenNumber(contextLive.hudWindow)) settings.budget = {
      ...settings.budget, tokens: contextLive.hudWindow, accuracy: 'configured', source: 'Context Lens display.autoCompactWindow (manual HUD override)',
    };
    if (file.client === 'claude' && !live) warnings.push('当前 Claude 会话没有状态栏实时采样；已配置采集命令不代表 Desktop / SDK 已执行它');
    if (file.client === 'claude' && !capacity && reportedPercent === null) warnings.push('当前会话未上报有效窗口容量或占用率；不会根据模型别名、公开上限或压缩预算推测窗口占比');
    const context = buildContext({ used, capacity: settings.capacity, budget: settings.budget, reportedPercent,
      categories: main.categories, buffer: main.buffer, view: options.view, at });
    if (main.messageBreakdown?.length) context.messageBreakdown = main.messageBreakdown;
    let prices: LensConfig;
    try { prices = readPrices(); } catch { prices = { currency: 'USD', prices: {} }; warnings.push('Price configuration is invalid; no custom price was applied'); }
    const all = addTotals(mainTotals, agentTotals);
    if (!all.complete) warnings.push('Some history or counters are unavailable; cumulative values may be incomplete and request counts may be unknown');
    const nativeCost = live?.stdin.cost?.total_cost_usd;
    return {
      session: main.info, context, totals: { main: mainTotals, agents: agentTotals, all, agentCount },
      cache: cacheState(fresh ? live.stdin.prompt_cache : undefined, now, live?.at),
      activity: main.activity ? summarizeActivity(main.activity, agentActivity) : undefined,
      timing: main.timing ? sessionTiming(main.timing, now) : undefined,
      insights: main.details ? summarizeDetails(main.details) : undefined,
      cost: estimateCost(requests, prices, all.complete), nativeCostUsd: typeof nativeCost === 'number' && nativeCost >= 0 ? nativeCost : null,
      warnings: [...new Set([...warnings, ...context.warnings])], capturedAt: new Date(now).toISOString(),
    };
  }
}
