import * as path from 'node:path';
import { atomicJson, lensHome, readDocument, validatePrices } from './settings.js';
import { BUNDLED_PRICES } from './pricing-data.js';
import { deepSeekTier, parseAgentPrices } from './pricing-agents.js';
export const PRICE_SOURCES = {
    openai: 'https://developers.openai.com/api/docs/pricing',
    anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
    deepseek: 'https://api-docs.deepseek.com/quick_start/pricing/',
    mimo: 'https://mimo.mi.com/static/docs/price/pay-as-you-go.md',
    zai: 'https://docs.z.ai/guides/overview/pricing',
};
const fields = ['input', 'cacheRead', 'cacheWrite', 'output'];
const cells = (line) => line.trim().split('|').slice(1, -1).map(cell => cell.trim());
const amount = (value) => {
    if (value === '-')
        return undefined;
    const match = value.match(/^\$(\d+(?:\.\d+)?)(?:\s*\/\s*MTok(?:<sup>\d<\/sup>)?)?$/);
    if (!match || Number(match[1]) > 1e9)
        throw new Error('Unrecognized official price');
    return Number(match[1]);
};
function rate(values, keys = fields) {
    if (values.length !== keys.length)
        throw new Error('Official price columns changed');
    const result = {};
    values.forEach((value, index) => { const n = amount(value); if (n !== undefined)
        result[keys[index]] = n; });
    return result;
}
function section(document, heading) {
    const match = document.match(new RegExp('^' + heading + '\\s*$([\\s\\S]*?)(?=^#{2,3} |$(?![\\s\\S]))', 'm'));
    if (!match)
        throw new Error('Official pricing section is missing');
    return match[1];
}
/** Parse only the documented text-token tables; never infer prices from model names. */
export function parseOfficialPrices(provider, document, checkedAt) {
    if (['deepseek', 'mimo', 'zai'].includes(provider))
        return { source: PRICE_SOURCES[provider], checkedAt, models: parseAgentPrices(provider, document) };
    const models = Object.create(null);
    if (provider === 'openai') {
        const threshold = document.match(/Short context:\s*≤([\d.]+)K input tokens\. Long context:\s*>([\d.]+)K input tokens\./);
        for (const tier of ['Standard', 'Batch', 'Flex', 'Fast', 'Ultrafast']) {
            const table = section(document, '### ' + tier + ' pricing data');
            if (!table.includes('| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |'))
                throw new Error('OpenAI price header changed');
            for (const line of table.split('\n')) {
                const row = cells(line);
                const model = row[0]?.match(/^((?:gpt-[\w.-]+|o[134](?:-[\w.-]+)?|davinci-002|babbage-002))(?: \(<272K context length\))?$/)?.[1];
                if (!model)
                    continue;
                if (row.length !== 9)
                    throw new Error('OpenAI price columns changed');
                const rates = rate(row.slice(1, 5));
                if (rates.input === undefined || rates.output === undefined)
                    throw new Error('Missing base price');
                const long = rate(row.slice(5));
                const price = { rates, ...(long.input === undefined ? {} : { longContext: long }) };
                if (price.longContext && (!threshold || threshold[1] !== threshold[2]))
                    throw new Error('Long-context threshold is missing');
                if (tier === 'Standard') {
                    if (models[model])
                        throw new Error('Duplicate official model');
                    models[model] = { ...price, ...(threshold ? { threshold: Number(threshold[1]) * 1000 } : {}) };
                }
                else if (models[model])
                    (models[model].tiers ??= {})[tier.toLowerCase()] = price;
            }
        }
    }
    else {
        const table = section(document, '## Model pricing');
        if (!/\| Model\s*\| Base input tokens\s*\| 5m cache writes\s*\| 1h cache writes\s*\| Cache hits and refreshes\s*\| Output tokens\s*\|/.test(table))
            throw new Error('Claude price header changed');
        const modelId = (name) => name.match(/^Claude (Opus|Sonnet|Haiku|Fable|Mythos) (\d+(?:\.\d+)?)(?:\s|$)/);
        for (const line of table.split('\n')) {
            const row = cells(line);
            const match = modelId(row[0] ?? '');
            if (!match)
                continue;
            const model = 'claude-' + match[1].toLowerCase() + '-' + match[2].replaceAll('.', '-');
            if (row.length !== 6 || models[model])
                throw new Error('Claude price table changed');
            const rates = rate(row.slice(1), ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output']);
            // Claude cache writes default to five minutes when no explicit TTL is recorded.
            rates.cacheWrite = rates.cacheWrite5m;
            models[model] = { rates };
        }
        for (const line of section(document, '### Fast mode pricing').split('\n')) {
            const row = cells(line);
            if (!row[0]?.startsWith('Claude '))
                continue;
            const fastInput = amount(row[1]);
            const fastOutput = amount(row[2]);
            for (const name of row[0].split(' / ')) {
                const match = modelId(name);
                if (!match)
                    throw new Error('Unknown fast model');
                const model = 'claude-' + match[1].toLowerCase() + '-' + match[2].replaceAll('.', '-');
                const standard = models[model]?.rates;
                if (!standard?.input || fastInput === undefined || fastOutput === undefined)
                    throw new Error('Missing fast price');
                const rates = Object.fromEntries(Object.entries(standard).map(([field, value]) => [field, value * fastInput / standard.input]));
                rates.output = fastOutput;
                models[model].tiers = { fast: { rates } };
            }
        }
    }
    if (Object.keys(models).length < 3)
        throw new Error('Incomplete official price table');
    return { source: PRICE_SOURCES[provider], checkedAt, models };
}
function validateProvider(provider, value) {
    const minimum = ['deepseek', 'mimo', 'zai'].includes(provider) ? 2 : 3;
    if (value.source !== PRICE_SOURCES[provider] || !Number.isFinite(Date.parse(value.checkedAt)) || !value.models || Object.keys(value.models).length < minimum || Object.keys(value.models).length > 300)
        throw new Error('Invalid price cache');
    for (const [model, price] of Object.entries(value.models)) {
        validatePrices({ currency: 'USD', prices: { [model]: price.rates } });
        if (price.threshold !== undefined && (!Number.isSafeInteger(price.threshold) || price.threshold <= 0))
            throw new Error('Invalid price threshold');
        for (const tier of [price, ...Object.values(price.tiers ?? {})]) {
            validatePrices({ currency: 'USD', prices: { [model]: tier.rates } });
            if (tier.longContext)
                validatePrices({ currency: 'USD', prices: { [model]: tier.longContext } });
        }
    }
    return value;
}
export function readOfficialPrices(home = lensHome()) {
    const result = { ...BUNDLED_PRICES };
    for (const provider of Object.keys(PRICE_SOURCES)) {
        try {
            const cached = validateProvider(provider, readDocument(path.join(home, 'official-prices-' + provider + '.json')));
            if (Date.parse(cached.checkedAt) >= Date.parse(result[provider].checkedAt))
                result[provider] = cached;
        }
        catch { /* A missing or invalid cache leaves the verified bundled prices available offline. */ }
    }
    return result;
}
export function officialPrice(row, catalog) {
    let id = row.model;
    const provider = Object.values(catalog).find(p => Object.hasOwn(p.models, id) || Object.hasOwn(p.models, id.replace(/-\d{4}-\d{2}-\d{2}$|-\d{8}$/, '')));
    if (!provider)
        return undefined;
    if (!Object.hasOwn(provider.models, id))
        id = id.replace(/-\d{4}-\d{2}-\d{2}$|-\d{8}$/, '');
    if (!Object.hasOwn(provider.models, id))
        return undefined;
    const price = provider.models[id];
    let tier = !row.serviceTier || ['standard', 'default', 'auto'].includes(row.serviceTier) ? 'standard'
        : row.serviceTier === 'priority' && provider === catalog.openai ? 'fast' : row.serviceTier;
    if (price.timePolicy === 'deepseek') {
        const timed = row.timestampKnown === false ? undefined : deepSeekTier(row.at);
        if (!timed || tier !== 'standard')
            return undefined;
        tier = timed;
    }
    const selected = tier === 'standard' ? price : price.tiers?.[tier];
    if (!selected)
        return undefined;
    const long = price.threshold !== undefined && row.input > price.threshold;
    // A published long-context tier cannot silently fall back to short-context prices.
    if (long && price.longContext && !selected.longContext)
        return undefined;
    return { rates: long && selected.longContext ? selected.longContext : selected.rates, source: provider.source, checkedAt: provider.checkedAt, tier };
}
const inFlight = new Map();
const attempts = new Map();
/** Fetch fixed public official documents only. No session content or credentials are sent. */
export function refreshOfficialPrices(options = {}) {
    const home = options.home ?? lensHome(), now = options.now ?? Date.now();
    const pending = inFlight.get(home);
    if (pending)
        return pending;
    if (!options.force && now - (attempts.get(home) ?? 0) < 60 * 60 * 1000)
        return Promise.resolve();
    attempts.set(home, now);
    const work = (async () => {
        const catalog = readOfficialPrices(home);
        await Promise.all(Object.keys(PRICE_SOURCES).map(async (provider) => {
            if (!options.force && now - Date.parse(catalog[provider].checkedAt) < 24 * 60 * 60 * 1000)
                return;
            try {
                const documentUrl = provider === 'deepseek' || provider === 'mimo' ? PRICE_SOURCES[provider] : PRICE_SOURCES[provider] + '.md';
                const response = await (options.fetch ?? fetch)(documentUrl, { signal: AbortSignal.timeout(6000), redirect: 'error' });
                if (!response.ok || !response.body)
                    return;
                const reader = response.body.getReader();
                const chunks = [];
                let size = 0;
                try {
                    for (;;) {
                        const { value, done } = await reader.read();
                        if (done)
                            break;
                        size += value.length;
                        if (size > 512 * 1024)
                            throw new Error('Official document too large');
                        chunks.push(value);
                    }
                }
                finally {
                    await reader.cancel();
                }
                const parsed = parseOfficialPrices(provider, Buffer.concat(chunks).toString('utf8'), new Date(now).toISOString());
                atomicJson(path.join(home, 'official-prices-' + provider + '.json'), validateProvider(provider, parsed));
            }
            catch { /* Offline or a changed document retains the last successfully verified prices. */ }
        }));
    })().finally(() => inFlight.delete(home));
    inFlight.set(home, work);
    return work;
}
//# sourceMappingURL=pricing.js.map