import type { CacheState, Client, CostEstimate, LensConfig, RequestUsage, Tokens, Totals } from './types.js';
import { type PriceCatalog } from './pricing.js';
export declare const ZERO_TOKENS: Tokens;
export declare const TOKEN_KEYS: (keyof Tokens)[];
export declare const INPUT_TOKEN_KEYS: readonly ['input', 'cacheRead', 'cacheWrite', 'cacheWrite5m', 'cacheWrite1h'];
export declare const measured: (usage: RequestUsage | Totals, key: keyof Tokens) => boolean;
export declare function uncachedInput(usage: RequestUsage | Totals): number | undefined;
export declare function normalizeUsage(client: Client, raw: any, id: string, model: string, at: string): RequestUsage;
/** 同一响应可能有多个流式快照。输入及其缓存分项必须取自同一个快照。 */
export declare function mergeRequests(rows: RequestUsage[]): RequestUsage[];
export declare function mergeCumulative(previous: RequestUsage | undefined, current: RequestUsage): RequestUsage;
export declare function sumRequests(rows: RequestUsage[], complete?: boolean): Totals;
export declare function addTotals(a: Totals, b: Totals): Totals;
export declare function estimateCost(rows: RequestUsage[], config: LensConfig, complete?: boolean, prices?: PriceCatalog): CostEstimate;
export declare function cacheState(promptCache: any, now: number, at?: string): CacheState;
//# sourceMappingURL=usage.d.ts.map