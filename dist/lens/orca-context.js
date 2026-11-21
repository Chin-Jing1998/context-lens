import { buildContext, CATEGORIES } from './context.js';
import { sumRequests } from './usage.js';
import { sessionTiming } from './timing.js';
const unknownBudget = { tokens: null, scope: 'total', accuracy: 'unknown', source: '当前会话未上报压缩预算' };
export function orcaSnapshot(host, view, native) {
    const now = Date.now(), stamp = new Date(now).toISOString();
    const timing = sessionTiming({ startedAt: host.createdAt, reportedStart: true, lastActivityAt: host.updatedAt, turns: [], complete: false }, now);
    const states = { open: 'running', working: 'running', settled: 'waiting', done: 'waiting',
        idle: 'waiting', blocked: 'interrupted', interrupted: 'interrupted' };
    timing.status = states[host.state] ?? 'unknown';
    const unknown = { ...sumRequests([], false), requests: null };
    const base = native ?? {
        session: { client: 'orca', agent: host.agent, id: host.id, model: '', title: host.title, cwd: '',
            updatedAt: host.updatedAt === null ? '' : new Date(host.updatedAt).toISOString() },
        context: buildContext({ capacity: null, used: null, budget: unknownBudget, view: 'model' }),
        totals: { main: unknown, agents: unknown, all: unknown, agentCount: 0 }, nativeCostUsd: null,
        cost: { amount: null, currency: 'USD', complete: false, unpricedModels: [] },
        cache: { state: 'unknown', accuracy: 'unknown', source: '缓存状态未上报', expiresAt: null },
        warnings: [], capturedAt: stamp, hasRequestDetails: false
    };
    const result = { ...base, session: { ...base.session, ...(host.model && { selectedModel: host.model }), title: base.session.title && base.session.title !== '未命名对话' ? base.session.title : host.title || base.session.title },
        timing: base.timing?.status && base.timing.status !== 'unknown' ? base.timing : { ...(base.timing ?? timing), status: timing.status },
        telemetry: { ...(host.effort && { effort: host.effort }), ...base.telemetry } };
    const fact = host.facts;
    if (!fact)
        return result;
    const old = base.context, nativeAt = old.updatedAt ? Date.parse(old.updatedAt) : 0;
    const newer = !nativeAt || fact.at >= nativeAt;
    const served = fact.model && fact.model !== 'unknown' ? fact.model : undefined;
    const nativeModel = native?.session.model;
    if (!newer && (fact.kind === 'unknown' || old.usedTokens === null || !served || served !== nativeModel || old.modelTokens || old.budget.scope === 'body_after_prefix'))
        return result;
    if (newer && fact.kind === 'unknown') {
        result.context = buildContext({ used: null, capacity: null, budget: unknownBudget, at: new Date(fact.at).toISOString(), view });
        return result;
    }
    // 独立的原生占比优先于按输入计算的值，同一会话的数据库预算和完整模型窗口分别保留。
    if (fact.kind === 'estimate' && old.windowPercent !== null && !old.windowEstimated && nativeAt >= fact.at)
        return result;
    const compatible = !served || !nativeModel || nativeModel === 'unknown' || served === nativeModel;
    if (host.agent === 'antigravity' && view === 'budget' && old.view === 'budget' && old.usedTokens !== null
        && old.budget.tokens !== null && newer && fact.kind === 'estimate' && fact.window && fact.used !== null) {
        result.context = { ...old, modelTokens: fact.window, windowPercent: fact.used / fact.window * 100,
            remainingWindowTokens: Math.max(0, fact.window - fact.used) };
        return result;
    }
    const budget = fact.threshold ? { tokens: fact.threshold, scope: 'total', accuracy: 'reported', source: 'Orca 回合自动压缩阈值' }
        : compatible && native ? old.budget : unknownBudget;
    const used = newer ? fact.used : old.usedTokens;
    const capacity = fact.window ?? (compatible ? old.modelTokens : null);
    const at = newer ? new Date(fact.at).toISOString() : old.updatedAt;
    const categories = {};
    if (newer && fact.categories?.length) {
        for (const row of fact.categories) {
            const match = CATEGORIES.find(([id, label]) => !['buffer', 'free', 'unclassified'].includes(id)
                && (label.toLowerCase() === row.name.toLowerCase() || id === 'messages' && row.name.toLowerCase() === 'messages'));
            if (match)
                categories[match[0]] = { tokens: (categories[match[0]]?.tokens ?? 0) + row.tokens, source: 'Orca 回合上下文报告', accuracy: 'reported', at };
        }
    }
    else if (compatible && (old.updatedAt === at || !newer)) {
        for (const row of old.segments)
            if (!['free', 'buffer', 'unclassified'].includes(row.id) && row.tokens !== null)
                categories[row.id] = row;
    }
    const selectedView = !native || (host.agent === 'antigravity' && capacity !== null) || budget.tokens === null ? 'model' : view;
    result.context = buildContext({ used, capacity, at, budget, view: selectedView, categories,
        reportedPercent: newer ? fact.percent : old.windowPercent, windowEstimated: newer ? fact.kind === 'estimate' : old.windowEstimated });
    if (newer && fact.percent !== undefined) {
        result.context.windowPercent = fact.percent;
        if (selectedView === 'model')
            result.context.percent = fact.percent;
    }
    if (fact.threshold && used !== null)
        result.context.remainingBeforeCompaction = Math.max(0, fact.threshold - used);
    if (old.messageBreakdown && old.updatedAt === at && compatible)
        result.context.messageBreakdown = old.messageBreakdown;
    if (newer && served)
        result.session = { ...result.session, model: served, modelName: compatible ? result.session.modelName : undefined };
    return result;
}
//# sourceMappingURL=orca-context.js.map