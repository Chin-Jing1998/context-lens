import { tokenNumber } from './context.js';
import { officialPrice, readOfficialPrices } from './pricing.js';
export const ZERO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0, reasoning: 0 };
export const TOKEN_KEYS = Object.keys(ZERO_TOKENS);
export const INPUT_TOKEN_KEYS = ['input', 'cacheRead', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h'];
export const measured = (usage, key) => !usage.missingTokens?.includes(key);
export function uncachedInput(usage) {
    if (measured(usage, 'input') && measured(usage, 'cacheRead') && measured(usage, 'cacheWrite')) {
        const tokens = usage.input - usage.cacheRead - usage.cacheWrite;
        return tokens >= 0 ? tokens : undefined;
    }
    return usage.uncachedInput;
}
export function normalizeUsage(client, raw, id, model, at) {
    const exclusiveInput = client !== 'codex';
    const reportedInput = tokenNumber(raw.input_tokens), output = tokenNumber(raw.output_tokens);
    const read = tokenNumber(raw.cache_read_input_tokens ?? raw.cached_input_tokens ?? raw.input_tokens_details?.cached_tokens);
    const write5m = tokenNumber(raw.cache_creation?.ephemeral_5m_input_tokens), write1h = tokenNumber(raw.cache_creation?.ephemeral_1h_input_tokens);
    const write = tokenNumber(raw.cache_creation_input_tokens ?? raw.cache_write_input_tokens ?? raw.input_tokens_details?.cache_write_tokens)
        ?? (write5m !== null && write1h !== null ? write5m + write1h : null);
    const reasoning = tokenNumber(raw.reasoning_output_tokens ?? raw.output_tokens_details?.thinking_tokens ?? raw.output_tokens_details?.reasoning_tokens);
    const cacheRead = read ?? 0, cacheWrite = write ?? 0;
    // Claude 和 AGY 的输入字段仅含未缓存输入，Codex 的输入字段已包含缓存。
    const input = (reportedInput ?? 0) + (exclusiveInput ? cacheRead + cacheWrite : 0);
    const uncached = exclusiveInput ? reportedInput
        : reportedInput !== null && read !== null && read + cacheWrite <= reportedInput ? reportedInput - read - cacheWrite : null;
    const missingTokens = [];
    if (reportedInput === null)
        missingTokens.push('input');
    if (output === null)
        missingTokens.push('output');
    if (read === null)
        missingTokens.push('cacheRead');
    if (write === null && exclusiveInput)
        missingTokens.push('cacheWrite');
    if (write5m === null && (cacheWrite > 0 || missingTokens.includes('cacheWrite')))
        missingTokens.push('cacheWrite5m');
    if (write1h === null && (cacheWrite > 0 || missingTokens.includes('cacheWrite')))
        missingTokens.push('cacheWrite1h');
    if (reasoning === null)
        missingTokens.push('reasoning');
    return { id, model, at, input, output: output ?? 0, cacheRead, cacheWrite,
        ...(uncached !== null ? { uncachedInput: uncached } : {}), ...(missingTokens.length ? { missingTokens } : {}),
        ...(typeof (raw.speed === 'fast' ? raw.speed : raw.service_tier) === 'string'
            ? { serviceTier: raw.speed === 'fast' ? raw.speed : raw.service_tier } : {}),
        cacheWrite5m: write5m ?? 0, cacheWrite1h: write1h ?? 0, reasoning: reasoning ?? 0,
        complete: reportedInput !== null && output !== null && read !== null && (!exclusiveInput || write !== null)
            && cacheRead + cacheWrite <= input,
    };
}
function inputCoverage(usage) {
    if (!measured(usage, 'input'))
        return 0;
    if (usage.cacheRead + usage.cacheWrite > usage.input)
        return 1;
    return 2 + Number(measured(usage, 'cacheRead')) + Number(measured(usage, 'cacheWrite'));
}
/** 同一响应可能有多个流式快照。输入及其缓存分项必须取自同一个快照。 */
export function mergeRequests(rows) {
    const byId = new Map();
    for (const row of rows) {
        const old = byId.get(row.id);
        if (!old)
            byId.set(row.id, { ...row });
        else {
            const input = inputCoverage(row) >= inputCoverage(old) && (row.input > 0 || old.input === 0) ? row : old;
            const merged = { ...input, model: row.model || old.model };
            const dated = [old, row].filter(v => v.timestampKnown !== false && Number.isFinite(Date.parse(v.at))).sort((a, b) => a.at.localeCompare(b.at));
            if (dated.length) {
                merged.at = dated[0].at;
                merged.timestampKnown = true;
            }
            if (!merged.serviceTier)
                merged.serviceTier = row.serviceTier || old.serviceTier;
            const missing = INPUT_TOKEN_KEYS.filter(key => !measured(input, key));
            for (const key of ['output', 'reasoning']) {
                if (!measured(old, key) && !measured(row, key))
                    missing.push(key);
                else
                    merged[key] = Math.max(measured(old, key) ? old[key] : 0, measured(row, key) ? row[key] : 0);
            }
            if (missing.length)
                merged.missingTokens = missing;
            else
                delete merged.missingTokens;
            merged.complete = inputCoverage(input) === 4 && measured(merged, 'output') && (old.complete || row.complete);
            const uncached = uncachedInput(merged);
            if (uncached === undefined)
                delete merged.uncachedInput;
            else
                merged.uncachedInput = uncached;
            byId.set(row.id, merged);
        }
    }
    return [...byId.values()];
}
export function mergeCumulative(previous, current) {
    if (!previous)
        return current;
    // 日志回放可能带回旧累计值。保留覆盖面更广的整组输入计数。
    return mergeRequests(current.input < previous.input ? [current, previous] : [previous, current])[0];
}
export function sumRequests(rows, complete = true) {
    const unique = mergeRequests(rows);
    const sum = { ...ZERO_TOKENS, requests: unique.length, cacheReadRequests: 0, hitRate: null, complete };
    const known = new Set();
    for (const row of unique) {
        for (const key of TOKEN_KEYS)
            if (measured(row, key)) {
                sum[key] += row[key];
                known.add(key);
            }
        const uncached = uncachedInput(row);
        if (uncached !== undefined)
            sum.uncachedInput = (sum.uncachedInput ?? 0) + uncached;
        if (measured(row, 'cacheRead') && row.cacheRead > 0)
            sum.cacheReadRequests++;
        sum.complete &&= row.complete;
    }
    sum.missingTokens = TOKEN_KEYS.filter(key => !known.has(key));
    if (!known.has('cacheRead'))
        sum.cacheReadRequests = null;
    sum.hitRate = unique.every(row => measured(row, 'input') && measured(row, 'cacheRead') && measured(row, 'cacheWrite'))
        && sum.input > 0 && sum.cacheRead <= sum.input ? sum.cacheRead / sum.input : null;
    return sum;
}
export function addTotals(a, b) {
    const result = { ...ZERO_TOKENS, requests: a.requests === null || b.requests === null ? null : a.requests + b.requests,
        cacheReadRequests: a.cacheReadRequests === null && b.cacheReadRequests === null ? null : (a.cacheReadRequests ?? 0) + (b.cacheReadRequests ?? 0),
        hitRate: null, complete: a.complete && b.complete };
    for (const key of TOKEN_KEYS)
        result[key] = a[key] + b[key];
    result.missingTokens = TOKEN_KEYS.filter(key => !measured(a, key) && !measured(b, key));
    const first = uncachedInput(a), second = uncachedInput(b);
    if (first !== undefined || second !== undefined)
        result.uncachedInput = (first ?? 0) + (second ?? 0);
    result.hitRate = (a.input === 0 || a.hitRate !== null) && (b.input === 0 || b.hitRate !== null)
        && measured(result, 'cacheRead') && result.input > 0 && result.cacheRead <= result.input ? result.cacheRead / result.input : null;
    return result;
}
export function estimateCost(rows, config, complete = true, prices) {
    let amount = 0;
    let priced = false;
    const unpriced = new Set();
    const catalog = config.currency === 'USD' ? prices ?? readOfficialPrices() : undefined;
    const pricing = new Map();
    for (const row of mergeRequests(rows)) {
        const custom = [Object.hasOwn(config.prices, row.model) ? config.prices[row.model] : undefined, config.prices['*']]
            .find(rate => rate && Object.keys(rate).length > 0);
        const official = !custom && catalog ? officialPrice(row, catalog) : undefined;
        const rates = custom ?? official?.rates;
        if (rates) {
            const detail = { model: row.model, source: custom ? 'User configured price' : official.source,
                ...(official ? { checkedAt: official.checkedAt } : {}), tier: custom ? 'custom' : official.tier };
            pricing.set(row.model + ':' + detail.tier, detail);
        }
        const inputValid = !measured(row, 'input') || row.cacheRead + row.cacheWrite <= row.input;
        const writeValid = row.cacheWrite5m + row.cacheWrite1h <= row.cacheWrite;
        // Codex 的写入计数未区分 30 分钟和 12 小时。按已知的最低写入单价计入下限。
        const extendedWriteRate = official?.rates.cacheWrite12h;
        const hasUnknownWriteTtl = extendedWriteRate !== undefined && row.cacheWrite > 0;
        const writeRate = extendedWriteRate !== undefined && rates?.cacheWrite !== undefined ? Math.min(rates.cacheWrite, extendedWriteRate) : rates?.cacheWrite;
        const components = [[measured(row, 'output') ? row.output : undefined, rates?.output]];
        if (inputValid)
            components.push([uncachedInput(row), rates?.input], [measured(row, 'cacheRead') ? row.cacheRead : undefined, rates?.cacheRead]);
        if (inputValid && writeValid)
            components.push([row.cacheWrite5m, rates?.cacheWrite5m ?? rates?.cacheWrite], [row.cacheWrite1h, rates?.cacheWrite1h ?? rates?.cacheWrite], [measured(row, 'cacheWrite') ? row.cacheWrite - row.cacheWrite5m - row.cacheWrite1h : undefined, writeRate]);
        complete &&= row.complete && inputValid && writeValid && !hasUnknownWriteTtl;
        for (const [tokens, rate] of components) {
            if (!tokens)
                continue;
            if (rate === undefined) {
                complete = false;
                unpriced.add(row.model || '(unknown model)');
            }
            else {
                amount += tokens * rate / 1_000_000;
                priced = true;
            }
        }
    }
    return { amount: priced ? amount : null, currency: config.currency, complete: complete && priced, unpricedModels: [...unpriced], pricing: [...pricing.values()] };
}
export function cacheState(promptCache, now, at) {
    const unknown = { state: 'unknown', accuracy: 'unknown', expiresAt: null, source: 'Client did not report current cache validity' };
    if (!promptCache || typeof promptCache !== 'object')
        return unknown;
    const expires = typeof promptCache.expires_at === 'number' ? promptCache.expires_at * 1000 : NaN;
    if (Number.isFinite(expires) && expires >= 0 && expires < 8.64e15)
        return {
            state: expires <= now ? 'expired' : promptCache.warm === true ? 'warm' : 'unknown',
            accuracy: 'reported', expiresAt: new Date(expires).toISOString(), source: `Claude prompt_cache${at ? ` @ ${at}` : ''}`,
        };
    if (promptCache.warm === false && at && now - Date.parse(at) < 10000)
        return { ...unknown, state: 'cold', accuracy: 'reported', source: 'Claude prompt_cache: latest response has no warm prefix' };
    return unknown;
}
//# sourceMappingURL=usage.js.map