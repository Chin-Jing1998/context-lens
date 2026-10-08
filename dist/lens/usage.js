import { tokenNumber } from './context.js';
import { officialPrice, readOfficialPrices } from './pricing.js';
export const ZERO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite5m: 0, cacheWrite1h: 0, reasoning: 0 };
export const TOKEN_KEYS = Object.keys(ZERO_TOKENS);
const n = (v) => tokenNumber(v) ?? 0;
export function normalizeUsage(client, raw, id, model, at) {
    const cacheRead = n(raw.cache_read_input_tokens ?? raw.cached_input_tokens);
    const cacheWrite = n(raw.cache_creation_input_tokens ?? raw.cache_write_input_tokens);
    const input = n(raw.input_tokens) + (client === 'claude' ? cacheRead + cacheWrite : 0);
    return { id, model, at, input, output: n(raw.output_tokens), cacheRead, cacheWrite,
        ...(typeof (raw.speed === 'fast' ? raw.speed : raw.service_tier) === 'string'
            ? { serviceTier: raw.speed === 'fast' ? raw.speed : raw.service_tier } : {}),
        cacheWrite5m: n(raw.cache_creation?.ephemeral_5m_input_tokens), cacheWrite1h: n(raw.cache_creation?.ephemeral_1h_input_tokens),
        reasoning: n(raw.reasoning_output_tokens ?? raw.output_tokens_details?.thinking_tokens),
        complete: tokenNumber(raw.input_tokens) !== null && tokenNumber(raw.output_tokens) !== null
            && tokenNumber(raw.cache_read_input_tokens ?? raw.cached_input_tokens) !== null && cacheRead + cacheWrite <= input,
    };
}
/** A response may be logged once per streaming content block and again on resume. */
export function mergeRequests(rows) {
    const byId = new Map();
    for (const row of rows) {
        const old = byId.get(row.id);
        if (!old)
            byId.set(row.id, { ...row });
        else {
            const merged = { ...row, complete: old.complete || row.complete, model: row.model || old.model };
            const dated = [old, row].filter(v => v.timestampKnown !== false && Number.isFinite(Date.parse(v.at))).sort((a, b) => a.at.localeCompare(b.at));
            if (dated.length) {
                merged.at = dated[0].at;
                merged.timestampKnown = true;
            }
            if (!merged.serviceTier && old.serviceTier)
                merged.serviceTier = old.serviceTier;
            for (const key of TOKEN_KEYS)
                merged[key] = Math.max(old[key], row[key]);
            byId.set(row.id, merged);
        }
    }
    return [...byId.values()];
}
export function sumRequests(rows, complete = true) {
    const unique = mergeRequests(rows);
    const sum = { ...ZERO_TOKENS, requests: unique.length, cacheReadRequests: 0, hitRate: null, complete };
    for (const row of unique) {
        for (const key of TOKEN_KEYS)
            sum[key] += row[key];
        if (row.cacheRead > 0)
            sum.cacheReadRequests++;
        sum.complete &&= row.complete;
    }
    sum.hitRate = sum.input > 0 ? sum.cacheRead / sum.input : null;
    return sum;
}
export function addTotals(a, b) {
    const result = { ...ZERO_TOKENS, requests: a.requests === null || b.requests === null ? null : a.requests + b.requests,
        cacheReadRequests: a.cacheReadRequests === null || b.cacheReadRequests === null ? null : a.cacheReadRequests + b.cacheReadRequests,
        hitRate: null, complete: a.complete && b.complete };
    for (const key of TOKEN_KEYS)
        result[key] = a[key] + b[key];
    result.hitRate = result.input > 0 ? result.cacheRead / result.input : null;
    return result;
}
export function estimateCost(rows, config, complete = true, prices) {
    let amount = 0;
    let priced = false;
    const unpriced = new Set();
    const catalog = config.currency === 'USD' ? prices ?? readOfficialPrices() : undefined;
    const pricing = new Map();
    for (const row of mergeRequests(rows)) {
        const custom = Object.hasOwn(config.prices, row.model) ? config.prices[row.model] : config.prices['*'];
        const official = !custom && catalog ? officialPrice(row, catalog) : undefined;
        const rates = custom ?? official?.rates;
        if (rates) {
            const detail = { model: row.model, source: custom ? 'User configured price' : official.source,
                ...(official ? { checkedAt: official.checkedAt } : {}), tier: custom ? 'custom' : official.tier };
            pricing.set(row.model + ':' + detail.tier, detail);
        }
        const components = [
            [Math.max(0, row.input - row.cacheRead - row.cacheWrite), rates?.input],
            [row.output, rates?.output], [row.cacheRead, rates?.cacheRead],
            [row.cacheWrite5m, rates?.cacheWrite5m ?? rates?.cacheWrite],
            [row.cacheWrite1h, rates?.cacheWrite1h ?? rates?.cacheWrite],
            [Math.max(0, row.cacheWrite - row.cacheWrite5m - row.cacheWrite1h), rates?.cacheWrite],
        ];
        complete &&= row.complete && row.cacheWrite5m + row.cacheWrite1h <= row.cacheWrite;
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