import * as path from 'node:path';
import { atomicJson, lensHome, readDocument, validatePrices } from './settings.js';
import type { Rate, RequestUsage } from './types.js';
import { BUNDLED_PRICES } from './pricing-data.js';
import { deepSeekTier, parseAgentPrices } from './pricing-agents.js';
import { parseGooglePrices } from './pricing-google.js';
import { priceModelIds } from './model-metadata.js';

export const PRICE_SOURCES = {
  openai: 'https://developers.openai.com/api/docs/pricing',
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  deepseek: 'https://api-docs.deepseek.com/quick_start/pricing/',
  mimo: 'https://mimo.mi.com/static/docs/price/pay-as-you-go.md',
  zai: 'https://docs.z.ai/guides/overview/pricing',
  google: 'https://aistudio.google.com/docs/pricing',
} as const;
type Provider = keyof typeof PRICE_SOURCES;
export interface TierPrice {
  rates: Rate; longContext?: Rate;
  dateChange?: { at: string; rates: Rate; longContext?: Rate };
  expiresAt?: string;
}
export interface OfficialPrice extends TierPrice {
  threshold?: number; tiers?: Record<string, TierPrice>; timePolicy?: 'deepseek';
  checkedAt?: string;
}
export interface ProviderPrices { source: string; checkedAt: string; models: Record<string, OfficialPrice> }
export type PriceCatalog = Record<Provider, ProviderPrices>;

const cells = (line: string): string[] => line.trim().split('|').slice(1, -1).map(cell => cell.trim());
const amount = (value: string): number | undefined => {
  if (value === '-') return undefined;
  const match = value?.match(/^\$(\d+(?:\.\d+)?)(?: USD)?(?:\s*\/\s*MTok(?:<sup>\d+<\/sup>)?)?$/);
  if (!match || Number(match[1]) > 1e9) throw new Error('Unrecognized official price');
  return Number(match[1]);
};
function rate(values: string[], keys: (keyof Rate)[]): Rate {
  if (values.length !== keys.length) throw new Error('Official price columns changed');
  const result: Rate = {};
  values.forEach((value, index) => { const n = amount(value); if (n !== undefined) result[keys[index]] = n; });
  return result;
}
function section(document: string, heading: string): string {
  const match = document.match(new RegExp('^' + heading + '[ \\t]*$([\\s\\S]*?)(?=^#{2,3} |$(?![\\s\\S]))', 'm'));
  if (!match) throw new Error('Official pricing section is missing');
  return match[1];
}

const openAIBaseFields: (keyof Rate)[] = ['input', 'output', 'cacheRead'];
const openAIExtendedFields: (keyof Rate)[] = [...openAIBaseFields, 'cacheWrite', 'cacheWrite12h'];
const openAIExtendedHeader = ['Model', ...['Short', 'Long'].flatMap(context =>
  ['input', 'output', 'cached input', '30m write', '12h write'].map(field => `${context} context ${field}`))].join('|');

function openAITable(body: string): Record<string, TierPrice> {
  const prices: Record<string, TierPrice> = Object.create(null);
  let fields: (keyof Rate)[] = [];
  for (const line of body.split('\n')) {
    const row = cells(line);
    if (row[0] === 'Model') {
      const header = row.join('|');
      if (header === openAIExtendedHeader) fields = openAIExtendedFields;
      else if (header === 'Model|Input|Output|Cached input') fields = openAIBaseFields;
      else throw new Error('OpenAI 价格表列已变化');
    }
    const model = row[0]?.match(/^((?:gpt-[\w.-]+|o[134](?:-[\w.-]+)?|davinci-002|babbage-002))(?: \(<[\d.]+K context length\))?$/)?.[1];
    if (!model) continue;
    const extended = fields === openAIExtendedFields;
    if (!fields.length || row.length !== 1 + fields.length * (extended ? 2 : 1) || prices[model]) throw new Error('OpenAI 价格行无效或重复');
    const rates = rate(row.slice(1, 1 + fields.length), fields);
    if (rates.input === undefined || rates.output === undefined) throw new Error('OpenAI 标准输入或输出单价缺失');
    const long = extended ? rate(row.slice(1 + fields.length), fields) : {};
    if ((long.input === undefined) !== (long.output === undefined)) throw new Error('OpenAI 长上下文价格不完整');
    prices[model] = { rates, ...(long.input === undefined ? {} : { longContext: long }) };
  }
  if (!Object.keys(prices).length) throw new Error('OpenAI 价格表为空');
  return prices;
}

function parseOpenAI(document: string): Record<string, OfficialPrice> {
  const limit = document.match(/Short context:\s*≤([\d.]+)K input tokens\. Long context:\s*>([\d.]+)K input tokens\./);
  if (!limit || limit[1] !== limit[2]) throw new Error('OpenAI 长上下文分界值缺失');
  const threshold = Number(limit[1]) * 1000;
  const models: Record<string, OfficialPrice> = openAITable(section(document, '### Standard pricing data'));
  for (const price of Object.values(models)) if (price.longContext) price.threshold = threshold;
  for (const tier of ['Batch', 'Flex', 'Fast', 'Ultrafast']) {
    const prices = openAITable(section(document, '### ' + tier + ' pricing data'));
    for (const [model, price] of Object.entries(prices)) {
      if (models[model]) (models[model].tiers ??= {})[tier.toLowerCase()] = price;
    }
  }
  if (document.includes('### Ultrafast promotion pricing data')) {
    if (!document.includes('through February 28, 2027, and 6 times the Standard rate starting March 1, 2027 (Pacific time)')) throw new Error('OpenAI Ultrafast 生效日期已变化');
    const promo = openAITable(section(document, '### Ultrafast promotion pricing data'));
    const list = openAITable(section(document, '### Ultrafast list pricing data'));
    for (const [model, price] of Object.entries(promo)) {
      if (!models[model] || !list[model]) throw new Error('OpenAI Ultrafast 的正式价格缺失');
      (models[model].tiers ??= {}).ultrafast = { ...price, dateChange: { at: '2027-03-01T08:00:00.000Z', ...list[model] } };
    }
  }
  if (models['gpt-5.6-sol'] && document.includes('GPT-5.6 Sol’s promotional pricing is available until November 30, 2026.')) {
    models['gpt-5.6-sol'].expiresAt = '2026-12-01T00:00:00.000Z';
  }
  return models;
}

function claudeModel(name: string): string | undefined {
  const match = name.match(/^Claude (Opus|Sonnet|Haiku|Fable|Mythos) (\d+(?:\.\d+)?)(?:\s|$)/);
  return match ? 'claude-' + match[1].toLowerCase() + '-' + match[2].replaceAll('.', '-') : undefined;
}

function parseClaude(document: string): Record<string, OfficialPrice> {
  const models: Record<string, OfficialPrice> = Object.create(null);
  const table = section(document, '## Model pricing');
  if (!/\| Model\s*\| Base input tokens\s*\| 5m cache writes\s*\| 1h cache writes\s*\| Cache hits and refreshes\s*\| Output tokens\s*\|/.test(table)) throw new Error('Claude 价格表列已变化');
  const promptLimit = /\(for prompts (up to|over) ([\d,]+) tokens\)$/;
  for (const line of table.split('\n')) {
    const row = cells(line), model = claudeModel(row[0] ?? '');
    if (!model) continue;
    const rates = rate(row.slice(1), ['input', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead', 'output']);
    if (rates.cacheWrite5m !== undefined) rates.cacheWrite = rates.cacheWrite5m;
    const limit = row[0].match(promptLimit);
    if (limit?.[1] === 'over') {
      if (models[model]?.threshold !== Number(limit[2].replaceAll(',', '')) || models[model].longContext) throw new Error('Claude 长输入价格行无效或重复');
      models[model].longContext = rates;
    } else {
      if (models[model]) throw new Error('Claude 价格行重复');
      models[model] = { rates, ...(limit ? { threshold: Number(limit[2].replaceAll(',', '')) } : {}) };
    }
  }
  for (const [heading, tier] of [['Fast mode pricing', 'fast'], ['Batch processing', 'batch']]) {
    for (const line of section(document, '### ' + heading).split('\n')) {
      const row = cells(line);
      if (!row[0]?.startsWith('Claude ')) continue;
      const input = amount(row[1]), output = amount(row[2]);
      for (const name of row[0].split(' / ')) {
        const model = claudeModel(name), long = name.match(promptLimit)?.[1] === 'over';
        const price = model ? models[model] : undefined, standard = long ? price?.longContext : price?.rates;
        if (!price || !standard?.input || input === undefined || output === undefined) throw new Error('Claude 服务档位对应的标准价格缺失');
        // 官方缓存倍率与 Fast 和 Batch 档位叠加。
        const rates: Rate = {};
        for (const [field, value] of Object.entries(standard)) rates[field as keyof Rate] = value * (input / standard.input);
        rates.input = input;
        rates.output = output;
        const tiers = price.tiers ??= {};
        if (long) {
          if (!tiers[tier] || tiers[tier].longContext) throw new Error('Claude 长输入档位无对应价格');
          tiers[tier].longContext = rates;
        } else tiers[tier] = { rates };
      }
    }
  }
  return models;
}

/** 仅解析官方文本 token 价格表。 */
export function parseOfficialPrices(provider: Provider, document: string, checkedAt: string): ProviderPrices {
  const models = provider === 'openai' ? parseOpenAI(document) : provider === 'anthropic' ? parseClaude(document)
    : provider === 'google' ? parseGooglePrices(document) : parseAgentPrices(provider, document);
  if (Object.keys(models).length < (provider === 'openai' || provider === 'anthropic' ? 3 : 2)) throw new Error('Incomplete official price table');
  return { source: PRICE_SOURCES[provider], checkedAt, models };
}

function validateProvider(provider: Provider, value: any): ProviderPrices {
  const minimum = provider === 'google' ? 4 : ['deepseek', 'mimo', 'zai'].includes(provider) ? 2 : 3;
  if (value.source !== PRICE_SOURCES[provider] || !Number.isFinite(Date.parse(value.checkedAt)) || !value.models || Object.keys(value.models).length < minimum || Object.keys(value.models).length > 300) throw new Error('Invalid price cache');
  for (const [model, price] of Object.entries(value.models) as [string, OfficialPrice][]) {
    if (price.checkedAt !== undefined && !Number.isFinite(Date.parse(price.checkedAt))) throw new Error('Invalid price verification date');
    if (price.threshold !== undefined && (!Number.isSafeInteger(price.threshold) || price.threshold <= 0)) throw new Error('Invalid price threshold');
    for (const tier of [price, ...Object.values(price.tiers ?? {})]) {
      if (tier.expiresAt !== undefined && !Number.isFinite(Date.parse(tier.expiresAt))) throw new Error('Invalid price expiration date');
      if (tier.dateChange && !Number.isFinite(Date.parse(tier.dateChange.at))) throw new Error('Invalid price date');
      for (const rates of [tier.rates, tier.longContext, tier.dateChange?.rates, tier.dateChange?.longContext]) {
        if (rates === undefined) continue;
        validatePrices({ currency: 'USD', prices: { [model]: rates } });
        if (rates.input === undefined || rates.output === undefined || provider === 'google' && rates.cacheRead === undefined) throw new Error('Incomplete token rates');
      }
      if (!tier.rates) throw new Error('Missing token rates');
    }
  }
  return value;
}

function retainPriorPrices(verified: ProviderPrices, previous: ProviderPrices): ProviderPrices {
  if (verified.source !== previous.source) return verified;
  const models = { ...verified.models };
  for (const [model, price] of Object.entries(previous.models)) {
    if (!Object.hasOwn(models, model)) models[model] = { ...price, checkedAt: price.checkedAt ?? previous.checkedAt };
  }
  return { ...verified, models };
}

export function readOfficialPrices(home = lensHome()): PriceCatalog {
  const result = { ...BUNDLED_PRICES };
  for (const provider of Object.keys(PRICE_SOURCES) as Provider[]) {
    try {
      const cached = validateProvider(provider, readDocument(path.join(home, 'official-prices-' + provider + '.json')));
      if (Date.parse(cached.checkedAt) >= Date.parse(result[provider].checkedAt)) result[provider] = retainPriorPrices(cached, result[provider]);
    } catch { /* A missing or invalid cache leaves the verified bundled prices available offline. */ }
  }
  return result;
}

function ratesAt(price: TierPrice, at: number): Pick<TierPrice, 'rates' | 'longContext'> | undefined {
  if (price.expiresAt && (!Number.isFinite(at) || at >= Date.parse(price.expiresAt))) return undefined;
  if (!price.dateChange) return price;
  if (!Number.isFinite(at)) return undefined;
  return at >= Date.parse(price.dateChange.at) ? price.dateChange : price;
}

export function referenceRates(catalog: PriceCatalog, now = Date.now()): Record<string, Rate> {
  const result: Record<string, Rate> = Object.create(null);
  for (const provider of Object.values(catalog)) for (const [model, price] of Object.entries(provider.models)) {
    const selected = ratesAt(price, now);
    if (selected) result[model] = selected.rates;
  }
  return result;
}

export function officialPrice(row: Pick<RequestUsage, 'model' | 'input' | 'serviceTier'> & Partial<Pick<RequestUsage, 'at' | 'timestampKnown' | 'missingTokens'>>, catalog: PriceCatalog): { rates: Rate; source: string; checkedAt: string; tier: string } | undefined {
  let provider: ProviderPrices | undefined, price: OfficialPrice | undefined;
  for (const id of priceModelIds(row.model)) {
    provider = Object.values(catalog).find(p => Object.hasOwn(p.models, id));
    if (provider) { price = provider.models[id]; break; }
  }
  if (!provider || !price) return undefined;
  let tier = !row.serviceTier || ['standard', 'default', 'auto'].includes(row.serviceTier) ? 'standard'
    : row.serviceTier === 'priority' && provider === catalog.openai ? 'fast' : row.serviceTier;
  if (price.timePolicy === 'deepseek') { const timed = row.timestampKnown === false ? undefined : deepSeekTier(row.at); if (!timed || tier !== 'standard') return undefined; tier = timed; }
  const selected = tier === 'standard' ? price : Object.hasOwn(price.tiers ?? {}, tier) ? price.tiers?.[tier] : undefined;
  const at = row.timestampKnown === false || !row.at ? NaN : Date.parse(row.at);
  if (!selected || price.expiresAt && (!Number.isFinite(at) || at >= Date.parse(price.expiresAt))) return undefined;
  const applicable = ratesAt(selected, at);
  if (!applicable) return undefined;
  if (price.threshold !== undefined && row.missingTokens?.includes('input')) return undefined;
  const long = price.threshold !== undefined && row.input > price.threshold;
  // 长上下文缺少对应档位时保留未知单价。
  if (long && price.longContext && !applicable.longContext) return undefined;
  const rates = long && applicable.longContext ? applicable.longContext : applicable.rates;
  return { rates, source: provider.source, checkedAt: price.checkedAt ?? provider.checkedAt, tier };
}

const inFlight = new Map<string, Promise<void>>();
const attempts = new Map<string, number>();
/** Fetch fixed public official documents only. No session content or credentials are sent. */
export function refreshOfficialPrices(options: { home?: string; force?: boolean; fetch?: typeof fetch; now?: number } = {}): Promise<void> {
  const home = options.home ?? lensHome(), now = options.now ?? Date.now();
  const pending = inFlight.get(home); if (pending) return pending;
  if (!options.force && now - (attempts.get(home) ?? 0) < 60 * 60 * 1000) return Promise.resolve();
  attempts.set(home, now);
  const work = (async () => {
    const catalog = readOfficialPrices(home);
    await Promise.all((Object.keys(PRICE_SOURCES) as Provider[]).map(async provider => {
      if (!options.force && now - Date.parse(catalog[provider].checkedAt) < 24 * 60 * 60 * 1000) return;
      try {
        const documentUrl = provider === 'deepseek' || provider === 'mimo' ? PRICE_SOURCES[provider] : PRICE_SOURCES[provider] + '.md';
        const response = await (options.fetch ?? fetch)(documentUrl, { signal: AbortSignal.timeout(provider === 'google' ? 15000 : 6000), redirect: 'error' });
        if (!response.ok || !response.body) throw new Error(`Official price document unavailable (HTTP ${response.status})`);
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 512 * 1024) throw new Error('Official document too large'); chunks.push(value); }
        } finally { await reader.cancel(); }
        const parsed = parseOfficialPrices(provider, Buffer.concat(chunks).toString('utf8'), new Date(now).toISOString());
        atomicJson(path.join(home, 'official-prices-' + provider + '.json'), validateProvider(provider, retainPriorPrices(parsed, catalog[provider])));
        if (provider === 'google') atomicJson(path.join(home, 'official-prices-google-status.json'), {
          status: 'ok', source: PRICE_SOURCES.google, attemptedAt: new Date(now).toISOString(),
        });
      } catch (error) {
        // A format/network failure retains verified prices and leaves a local audit record.
        if (provider === 'google') try { atomicJson(path.join(home, 'official-prices-google-status.json'), {
          status: 'failed', source: PRICE_SOURCES.google, attemptedAt: new Date(now).toISOString(),
          reason: error instanceof Error ? error.message.slice(0, 200) : 'Official Google price refresh failed',
        }); } catch { /* Read-only state directories must not interrupt collection. */ }
      }
    }));
  })().finally(() => inFlight.delete(home));
  inFlight.set(home, work); return work;
}
