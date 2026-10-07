import { estimateCost, mergeRequests } from './usage.js';
import { readOfficialPrices } from './pricing.js';
const validDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const dateFormatter = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
function day(format, date) {
    const parts = Object.fromEntries(format.formatToParts(date).map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}
export function costRange(query, now = new Date()) {
    const period = (query.period ?? 'today');
    if (!['today', '7d', '14d', 'month', 'quarter', 'year', 'custom'].includes(period))
        throw new Error('Invalid period');
    const timeZone = query.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone.length > 100)
        throw new Error('Invalid timezone');
    const today = day(dateFormatter(timeZone), now);
    let start = today, end = today;
    if (period === 'custom') {
        start = query.start ?? '';
        end = query.end ?? '';
        if (!validDate(start) || !validDate(end) || start > end || end > today || start < '1970-01-01')
            throw new Error('Invalid date range');
    }
    else if (period === '7d' || period === '14d') {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() - (period === '7d' ? 6 : 13));
        start = date.toISOString().slice(0, 10);
    }
    else if (period === 'month')
        start = today.slice(0, 7) + '-01';
    else if (period === 'quarter')
        start = `${today.slice(0, 4)}-${String(Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
    else if (period === 'year')
        start = today.slice(0, 4) + '-01-01';
    if (query.tool && (query.tool.length > 80 || /[\x00-\x1f]/.test(query.tool)))
        throw new Error('Invalid tool');
    if (query.page !== undefined && (!Number.isSafeInteger(query.page) || query.page < 1))
        throw new Error('Invalid page');
    return { period, start, end, timeZone };
}
const empty = () => ({ amount: 0, complete: true, requests: 0 });
const pair = () => ({ period: empty(), cumulative: empty() });
function add(target, value) {
    // A wholly unpriced collection stays unknown; a priced subset is a lower bound.
    if (target.requests === 0)
        target.amount = value.amount;
    else if (value.amount !== null)
        target.amount = (target.amount ?? 0) + value.amount;
    target.requests += value.requests;
    target.complete &&= value.complete;
}
const key = (tool, id) => JSON.stringify([tool, id]);
export function buildCostReport(sessions, config, query = {}, options = {}) {
    const now = options.now ?? new Date(), range = costRange(query, now), format = dateFormatter(range.timeZone);
    const catalog = options.catalog ?? readOfficialPrices();
    const bySession = new Map(sessions.map(s => [key(s.tool, s.id), s]));
    const root = (s) => {
        const seen = new Set();
        let current = s;
        while (current.parentId && !seen.has(current.id)) {
            seen.add(current.id);
            const parent = bySession.get(key(s.tool, current.parentId));
            if (!parent)
                break;
            current = parent;
        }
        return current;
    };
    const tools = new Map(), unpriced = new Set();
    const models = new Map();
    const conversations = new Map();
    const requests = new Map();
    const incompleteOwners = new Set(), undatedModels = new Set();
    let undatedRequests = 0, incompleteSessions = 0;
    // Resolve copied history once across each tool, keeping the original parent owner.
    for (const session of [...sessions].sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId) || a.id.localeCompare(b.id))) {
        tools.set(session.tool, session.toolName);
        if (query.tool && query.tool !== session.tool)
            continue;
        if (!session.complete) {
            incompleteSessions++;
            incompleteOwners.add(key(session.tool, root(session).id));
        }
        for (const row of session.requests) {
            const id = key(session.tool, row.id), old = requests.get(id);
            requests.set(id, { session: old?.session ?? root(session), row: old ? mergeRequests([old.row, row])[0] : row });
        }
    }
    const totals = pair();
    for (const { session, row } of requests.values()) {
        const time = Date.parse(row.at);
        if (row.timestampKnown === false || !Number.isFinite(time)) {
            undatedRequests++;
            undatedModels.add(row.model);
            incompleteOwners.add(key(session.tool, session.id));
            continue;
        }
        if (time > now.getTime())
            continue;
        const date = day(format, new Date(time));
        if (date > range.end)
            continue;
        const cost = estimateCost([row], config, true, catalog);
        cost.unpricedModels.forEach(model => unpriced.add(model));
        const value = { amount: cost.amount, complete: cost.complete, requests: 1 };
        const m = models.get(row.model) ?? { model: row.model || '未知模型', ...pair() };
        const id = key(session.tool, session.id);
        const s = conversations.get(id) ?? { tool: session.tool, toolName: session.toolName, id: session.id, title: session.title, lastAt: row.at, ...pair() };
        if (row.at > s.lastAt)
            s.lastAt = row.at;
        for (const target of [totals, m, s]) {
            add(target.cumulative, value);
            if (date >= range.start)
                add(target.period, value);
        }
        models.set(row.model, m);
        conversations.set(id, s);
    }
    if (undatedRequests || incompleteSessions || options.failed) {
        totals.period.complete = false;
        totals.cumulative.complete = false;
        if (!totals.cumulative.requests) {
            totals.period.amount = null;
            totals.cumulative.amount = null;
        }
    }
    for (const [id, s] of conversations)
        if (incompleteOwners.has(id)) {
            s.period.complete = false;
            s.cumulative.complete = false;
            for (const { session, row } of requests.values())
                if (key(session.tool, session.id) === id)
                    undatedModels.add(row.model);
        }
    for (const [id, m] of models)
        if (undatedModels.has(id)) {
            m.period.complete = false;
            m.cumulative.complete = false;
        }
    const all = [...conversations.values()].sort((a, b) => (b.period.amount ?? -1) - (a.period.amount ?? -1) || b.lastAt.localeCompare(a.lastAt) || a.id.localeCompare(b.id));
    const pages = Math.max(1, Math.ceil(all.length / 20)), page = Math.min(query.page ?? 1, pages);
    return { range, currency: config.currency, tool: query.tool ?? '', tools: [...tools].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
        totals, models: [...models.values()].sort((a, b) => (b.period.amount ?? -1) - (a.period.amount ?? -1) || a.model.localeCompare(b.model)),
        sessions: all.slice((page - 1) * 20, page * 20), page, pages, sessionCount: all.length, loading: options.loading ?? false, capturedAt: now.toISOString(),
        diagnostics: { unpricedModels: [...unpriced].sort(), undatedRequests, incompleteSessions } };
}
//# sourceMappingURL=cost-report.js.map