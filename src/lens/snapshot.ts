import * as fs from 'node:fs';
import { buildContext, tokenNumber } from './context.js';
import { readSession, type ParsedSession } from './reader.js';
import { discoverSessions, checkpoint, readLiveClaude, sessionKey, type SessionFile, type LiveClaude } from './sessions.js';
import { readPrices, resolveClaudeSettings, resolveCodexSettings, type LaunchSettings } from './settings.js';
import { addTotals, cacheState, estimateCost, sumRequests, TOKEN_KEYS } from './usage.js';
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
    if (old?.stamp === stamp) return old.data;
    const data = await readSession(file.file, file);
    try {
      const saved = checkpoint(data.info, data.requests, data.cumulative);
      data.requests = saved.requests; data.cumulative = saved.cumulative;
    } catch { data.warnings.push('Token checkpoint unavailable; displaying readable log history'); }
    if (old && stat.size < old.size) data.warnings.push('Log was truncated; retained deduplicated token checkpoint');
    if (this.parsed.size >= 32 && !this.parsed.has(file.file)) this.parsed.delete(this.parsed.keys().next().value!);
    this.parsed.set(file.file, { stamp, size: stat.size, data });
    return data;
  }

  async get(key: string, options: { view?: 'budget' | 'model'; launch?: LaunchSettings } = {}): Promise<HudSnapshot> {
    const file = this.list().find(f => sessionKey(f) === key);
    if (!file) throw new Error('Session not found; refresh the session list');
    return this.snapshot(file, options);
  }

  async snapshot(file: SessionFile, options: { view?: 'budget' | 'model'; launch?: LaunchSettings; live?: LiveClaude } = {}): Promise<HudSnapshot> {
    const main = await this.read(file);
    const warnings = [...main.warnings];
    const mainTotals = totals(main, main.requests);
    const ids = new Set(main.requests.map(r => r.id));
    const requests = [...main.requests];
    let agentTotals = sumRequests([]);
    let agentCount = 0;
    const descendants = new Set([file.id]);
    for (let depth = 0; depth < 20; depth++) {
      let added = false;
      for (const child of this.list()) {
        if (child.client !== file.client || !child.parentId || !descendants.has(child.parentId) || descendants.has(child.id)) continue;
        descendants.add(child.id); added = true; agentCount++;
        try {
          const parsed = await this.read(child);
          const own = parsed.requests.filter(row => !ids.has(row.id));
          for (const row of own) ids.add(row.id);
          requests.push(...own);
          // Cumulative fallbacks are used only when no response IDs are available: inherited IDs have already been removed.
          agentTotals = addTotals(agentTotals, totals(own.length === parsed.requests.length ? parsed : { ...parsed, cumulative: undefined }, own));
          warnings.push(...parsed.warnings.map(w => `Agent ${child.id}: ${w}`));
        } catch { agentTotals.complete = false; warnings.push(`Agent ${child.id}: log unavailable`); }
      }
      if (!added) break;
    }
    const now = Date.now();
    const live = file.client === 'claude' ? options.live ?? readLiveClaude(main.info) : null;
    let used = main.used;
    let capacity = main.capacity;
    let at = main.at;
    const fresh = live && (!at || Date.parse(live.at) >= Date.parse(at));
    if (fresh) {
      const u = live.stdin.context_window?.current_usage;
      used = u && tokenNumber(u.input_tokens) !== null
        ? u.input_tokens! + (tokenNumber(u.cache_read_input_tokens) ?? 0) + (tokenNumber(u.cache_creation_input_tokens) ?? 0) : null;
      at = live.at;
    }
    if (live) capacity = tokenNumber(live.stdin.context_window?.context_window_size) ?? capacity;
    const settings = file.client === 'claude'
      ? resolveClaudeSettings({ cwd: main.info.cwd, model: live?.stdin.model?.id || main.info.model, capacity,
        env: live?.environment ?? {}, launch: options.launch ?? live?.launch })
      : resolveCodexSettings({ cwd: main.info.cwd, capacity, launch: options.launch, runtime: main.runtime });
    warnings.push(...settings.warnings);
    if (live?.hudWindow && tokenNumber(live.hudWindow)) settings.budget = {
      ...settings.budget, tokens: live.hudWindow, accuracy: 'configured', source: 'Context Lens display.autoCompactWindow (manual HUD override)',
    };
    if (file.client === 'claude' && !live) warnings.push('Enable display.showLens in the Claude statusline to capture live window size and cache validity');
    const context = buildContext({ used, capacity: settings.capacity, budget: settings.budget,
      categories: main.categories, buffer: main.buffer, view: options.view, at });
    let prices: LensConfig;
    try { prices = readPrices(); } catch { prices = { currency: 'USD', prices: {} }; warnings.push('Price configuration is invalid; no custom price was applied'); }
    const all = addTotals(mainTotals, agentTotals);
    if (!all.complete) warnings.push('Some history or counters are unavailable; cumulative values may be incomplete and request counts may be unknown');
    const nativeCost = live?.stdin.cost?.total_cost_usd;
    return {
      session: main.info, context, totals: { main: mainTotals, agents: agentTotals, all, agentCount },
      cache: cacheState(fresh ? live.stdin.prompt_cache : undefined, now, live?.at),
      cost: estimateCost(requests, prices, all.complete), nativeCostUsd: typeof nativeCost === 'number' && nativeCost >= 0 ? nativeCost : null,
      warnings: [...new Set([...warnings, ...context.warnings])], capturedAt: new Date(now).toISOString(),
    };
  }
}
