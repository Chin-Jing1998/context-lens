import * as fs from 'node:fs';
import { buildContext, percentageNumber, tokenNumber } from './context.js';
import { readSession } from './reader.js';
import { discoverSessions, checkpoint, readLiveClaude, sessionKey } from './sessions.js';
import { readPrices, resolveClaudeSettings, resolveCodexSettings } from './settings.js';
import { addTotals, cacheState, estimateCost, INPUT_TOKEN_KEYS, measured, sumRequests, uncachedInput } from './usage.js';
import { summarizeActivity } from './activity.js';
import { sessionTiming } from './timing.js';
import { summarizeDetails } from './claude-details.js';
import { buildSessionDetails } from './session-details.js';
import { officialModelMetadata } from './model-metadata.js';
import { agySessionHistory, agyStamp, discoverAgySessions, readAgyFile, readAgyLive } from './agy.js';
import { currentQuota } from './quota.js';
import { readWorkspaceGit } from './workspace.js';
import { orcaAccountRoots } from './orca-session.js';
import { claudeDesktopSessions } from './claude-desktop.js';
function totals(parsed, requests) {
    const sum = sumRequests(requests, parsed.complete);
    const cumulative = parsed.cumulative;
    if (cumulative) {
        const baseline = uncachedInput(cumulative);
        if (measured(cumulative, 'input') && (cumulative.input > sum.input || cumulative.input === sum.input && sum.hitRate === null && baseline !== undefined)
            && cumulative.cacheRead + cumulative.cacheWrite <= cumulative.input) {
            if (cumulative.input > sum.input)
                sum.complete = false;
            sum.missingTokens = sum.missingTokens?.filter(key => !INPUT_TOKEN_KEYS.some(input => input === key));
            for (const key of INPUT_TOKEN_KEYS) {
                sum[key] = cumulative[key];
                if (!measured(cumulative, key))
                    sum.missingTokens?.push(key);
            }
            sum.uncachedInput = baseline;
            sum.hitRate = baseline !== undefined && sum.input > 0 ? sum.cacheRead / sum.input : null;
        }
        for (const key of ['output', 'reasoning']) {
            if (!measured(cumulative, key))
                continue;
            sum.missingTokens = sum.missingTokens?.filter(missing => missing !== key);
            if (cumulative[key] > sum[key]) {
                sum[key] = cumulative[key];
                sum.complete = false;
            }
        }
        if (!sum.complete) {
            sum.requests = null;
            sum.cacheReadRequests = null;
        }
    }
    if (!requests.length && !parsed.cumulative && !sum.complete) {
        sum.requests = null;
        sum.cacheReadRequests = null;
    }
    return sum;
}
export class SessionCollector {
    roots;
    files = [];
    scanned = 0;
    // ponytail: reread only changed logs; use incremental byte offsets if large active logs become slow.
    parsed = new Map();
    constructor(roots) {
        this.roots = roots;
    }
    list(refresh = false) {
        if (refresh || Date.now() - this.scanned > 2000) {
            const extra = this.roots ? undefined : orcaAccountRoots();
            const files = [...claudeDesktopSessions.describe(discoverSessions(this.roots, extra)),
                ...discoverAgySessions(this.roots ? this.roots.agy ?? {} : undefined, extra?.agy)];
            this.files = files.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
            this.scanned = Date.now();
        }
        return this.files;
    }
    async read(file) {
        const stat = fs.statSync(file.file);
        const history = agySessionHistory(file);
        const stamp = file.client === 'agy' ? agyStamp(file.file) + (history ? `:${agyStamp(history)}` : '') : `${stat.ino}:${stat.size}:${stat.mtimeMs}:${file.model}:${file.surface ?? ''}`;
        const old = this.parsed.get(file.file);
        if (old?.stamp === stamp) {
            if (file.client !== 'claude' || file.title && file.title !== '未命名对话')
                old.data.info.title = file.title;
            return old.data;
        }
        if (file.client === 'agy') {
            try {
                const data = await readAgyFile(file, history);
                this.saveParsed(file.file, { stamp, size: stat.size, data });
                return data;
            }
            catch (error) {
                const sqliteCode = Number(error.errcode) & 255;
                if (old && stamp.split(':')[0] === old.stamp.split(':')[0] && (sqliteCode === 5 || sqliteCode === 6))
                    return old.data;
                throw error;
            }
        }
        const data = await readSession(file.file, file);
        try {
            const observed = new Set(data.requests.map(row => row.id));
            const saved = checkpoint(data.info, data.requests, data.cumulative);
            data.requests = saved.requests;
            data.cumulative = saved.cumulative;
            if (saved.requests.some(row => !observed.has(row.id))) {
                if (data.activity)
                    data.activity.complete = false;
                if (data.timing)
                    data.timing.complete = false;
                if (data.details)
                    data.details.complete = false;
                data.warnings.push('Older request counters were retained; detailed event history is incomplete');
            }
        }
        catch {
            data.warnings.push('Token checkpoint unavailable; displaying readable log history');
        }
        if (old && stat.size < old.size) {
            data.warnings.push('Log was truncated; retained deduplicated token checkpoint');
            if (data.activity)
                data.activity.complete = false;
            if (data.timing)
                data.timing.complete = false;
            if (data.details)
                data.details.complete = false;
        }
        this.saveParsed(file.file, { stamp, size: stat.size, data });
        return data;
    }
    saveParsed(file, parsed) {
        if (this.parsed.size >= 32 && !this.parsed.has(file))
            this.parsed.delete(this.parsed.keys().next().value);
        this.parsed.set(file, parsed);
    }
    async get(key, options = {}) {
        const file = this.list().find(f => sessionKey(f) === key);
        if (!file)
            throw new Error('Session not found; refresh the session list');
        return this.snapshot(file, options);
    }
    async details(key, query = {}) {
        const files = this.list(), file = files.find(value => sessionKey(value) === key);
        if (!file)
            throw new Error('Session not found; refresh the session list');
        const selected = [file], ids = new Set([file.id]);
        for (let depth = 0; depth < 20; depth++) {
            let added = false;
            for (const child of files)
                if (child.client === file.client && child.parentId && ids.has(child.parentId) && !ids.has(child.id)) {
                    selected.push(child);
                    ids.add(child.id);
                    added = true;
                }
            if (!added)
                break;
        }
        const sources = [], unavailable = [];
        for (const current of selected) {
            try {
                sources.push({ file: current, parsed: await this.read(current) });
            }
            catch (error) {
                if (current === file)
                    throw error;
                unavailable.push(current.id);
            }
        }
        let prices;
        try {
            prices = readPrices();
        }
        catch {
            prices = { currency: 'USD', prices: {} };
        }
        return buildSessionDetails(key, sources, prices, query, unavailable);
    }
    async snapshot(file, options = {}) {
        const main = await this.read(file);
        const warnings = [...main.warnings];
        const mainTotals = totals(main, main.requests);
        const ids = new Set(main.requests.map(r => r.id));
        const requests = [...main.requests];
        let agentTotals = sumRequests([]);
        let agentCount = 0;
        const agentActivity = [];
        const descendants = new Set([file.id]);
        for (let depth = 0; depth < 20; depth++) {
            let added = false;
            for (const child of this.list()) {
                if (child.client !== file.client || !child.parentId || !descendants.has(child.parentId) || descendants.has(child.id))
                    continue;
                descendants.add(child.id);
                added = true;
                agentCount++;
                try {
                    const parsed = await this.read(child);
                    if (parsed.activity)
                        agentActivity.push(parsed.activity);
                    const own = parsed.requests.filter(row => !ids.has(row.id));
                    for (const row of own)
                        ids.add(row.id);
                    requests.push(...own);
                    // Cumulative fallbacks are used only when no response IDs are available: inherited IDs have already been removed.
                    agentTotals = addTotals(agentTotals, totals(own.length === parsed.requests.length ? parsed : { ...parsed, cumulative: undefined }, own));
                    warnings.push(...parsed.warnings.map(w => `Agent ${child.id}: ${w}`));
                }
                catch {
                    agentTotals.complete = false;
                    agentActivity.push({ calls: [], complete: false });
                    warnings.push(`Agent ${child.id}: log unavailable`);
                }
            }
            if (!added)
                break;
        }
        const now = Date.now();
        const candidate = file.client === 'claude' ? options.live ?? readLiveClaude(main.info) : null;
        const live = candidate?.stdin.session_id === main.info.id && Number.isFinite(Date.parse(candidate.at)) ? candidate : null;
        let used = main.used;
        let capacity = tokenNumber(main.capacity) || null;
        let at = main.at;
        let reportedPercent = null;
        const fresh = live && (!at || Date.parse(live.at) >= Date.parse(at));
        if (fresh) {
            const u = live.stdin.context_window?.current_usage;
            const liveUsed = u && tokenNumber(u.input_tokens) !== null
                ? u.input_tokens + (tokenNumber(u.cache_read_input_tokens) ?? 0) + (tokenNumber(u.cache_creation_input_tokens) ?? 0) : null;
            // 首次响应及压缩后的零占位不能证明窗口为空。
            reportedPercent = percentageNumber(live.stdin.context_window?.used_percentage) || null;
            if (liveUsed && tokenNumber(liveUsed) !== null)
                used = liveUsed;
            else if (main.info.surface !== 'desktop' || reportedPercent !== null)
                used = null;
            if (liveUsed || reportedPercent !== null)
                at = live.at;
        }
        const metadata = file.client === 'claude' ? officialModelMetadata(main.info.model) : undefined;
        const contextLive = live && (fresh || live.stdin.model?.id === main.info.model
            || metadata && officialModelMetadata(live.stdin.model?.id)?.id === metadata.id) ? live : null;
        if (contextLive && (fresh || !capacity))
            capacity = tokenNumber(contextLive.stdin.context_window?.context_window_size) || capacity;
        const agyLive = file.client === 'agy' ? readAgyLive(main.info, main.at) : undefined;
        if (agyLive?.percent != null)
            reportedPercent = agyLive.percent;
        const settings = file.client === 'claude'
            ? resolveClaudeSettings({ cwd: main.info.cwd, model: contextLive?.stdin.model?.id || main.info.model, capacity,
                env: contextLive?.environment ?? {}, launch: options.launch ?? contextLive?.launch })
            : file.client === 'codex' ? resolveCodexSettings({ cwd: main.info.cwd, capacity, launch: options.launch, runtime: main.runtime })
                : { capacity: agyLive?.size ?? null, warnings: [], budget: { tokens: capacity,
                        accuracy: capacity === null ? 'unknown' : 'reported', scope: 'total',
                        source: 'Antigravity 会话有效上下文预算' } };
        warnings.push(...settings.warnings);
        if (contextLive?.hudWindow && tokenNumber(contextLive.hudWindow))
            settings.budget = {
                ...settings.budget, tokens: contextLive.hudWindow, accuracy: 'configured', source: 'Context Lens display.autoCompactWindow (manual HUD override)',
            };
        if (file.client === 'claude' && !live)
            warnings.push('当前 Claude 会话没有状态栏实时采样；已配置采集命令不代表 Desktop / SDK 已执行它');
        if (file.client === 'claude' && !capacity && reportedPercent === null)
            warnings.push('当前会话未上报有效窗口容量或占用率；不会根据模型别名、公开上限或压缩预算推测窗口占比');
        const agyBudgetView = file.client === 'agy' && !agyLive?.size;
        const buffer = main.buffer ?? (agyBudgetView && capacity !== null
            ? { tokens: null, accuracy: 'unknown', source: 'Antigravity 窗口外保留空间未上报', placement: 'outside' }
            : undefined);
        const context = buildContext({ used, capacity: settings.capacity, budget: settings.budget, reportedPercent,
            categories: main.categories, buffer, view: file.client === 'agy' ? (agyBudgetView ? 'budget' : 'model') : options.view,
            at, windowEstimated: main.windowEstimated || agyLive?.percent != null });
        if (file.client === 'codex' && used !== null && settings.budget.scope === 'total' && settings.budget.accuracy === 'reported' && settings.budget.tokens !== null)
            context.remainingBeforeCompaction = Math.max(0, settings.budget.tokens - used);
        if (main.messageBreakdown?.length)
            context.messageBreakdown = main.messageBreakdown;
        let prices;
        try {
            prices = readPrices();
        }
        catch {
            prices = { currency: 'USD', prices: {} };
            warnings.push('Price configuration is invalid; no custom price was applied');
        }
        const all = addTotals(mainTotals, agentTotals);
        if (!all.complete)
            warnings.push('Some history or counters are unavailable; cumulative values may be incomplete and request counts may be unknown');
        const nativeCost = live?.stdin.cost?.total_cost_usd;
        const telemetry = { ...main.telemetry, ...live?.telemetry, ...agyLive?.telemetry };
        if (!fresh && main.telemetry?.effort)
            telemetry.effort = main.telemetry.effort;
        const git = options.git ? await readWorkspaceGit(main.info.cwd) : null;
        return {
            session: file.client === 'claude' && (!main.info.model || main.info.model === 'unknown') && live?.stdin.model?.id
                ? { ...main.info, model: live.stdin.model.id } : main.info,
            context, totals: { main: mainTotals, agents: agentTotals, all, agentCount },
            cache: cacheState(fresh ? live.stdin.prompt_cache : undefined, now, live?.at),
            activity: main.activity ? summarizeActivity(main.activity, agentActivity) : undefined,
            timing: main.timing ? sessionTiming(main.timing, now) : undefined,
            insights: main.details ? summarizeDetails(main.details) : undefined,
            quota: currentQuota(live?.quota ?? agyLive?.quota ?? main.quota, now),
            hasRequestDetails: requests.length > 0,
            telemetry: Object.values(telemetry).some(value => value !== undefined) ? telemetry : undefined,
            git: git ?? undefined,
            cost: estimateCost(requests, prices, all.complete), nativeCostUsd: typeof nativeCost === 'number' && nativeCost >= 0 ? nativeCost : null,
            warnings: [...new Set([...warnings, ...context.warnings])], capturedAt: new Date(now).toISOString(),
        };
    }
}
//# sourceMappingURL=snapshot.js.map