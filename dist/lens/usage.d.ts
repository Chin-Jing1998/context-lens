import type { CacheState, Client, CostEstimate, LensConfig, RequestUsage, Tokens, Totals } from './types.js';
import { type PriceCatalog } from './pricing.js';
export declare const ZERO_TOKENS: Tokens;
export declare const TOKEN_KEYS: (keyof Tokens)[];
export declare function normalizeUsage(client: Client, raw: any, id: string, model: string, at: string): RequestUsage;
/** A response may be logged once per streaming content block and again on resume. */
export declare function mergeRequests(rows: RequestUsage[]): RequestUsage[];
export declare function sumRequests(rows: RequestUsage[], complete?: boolean): Totals;
export declare function addTotals(a: Totals, b: Totals): Totals;
export declare function estimateCost(rows: RequestUsage[], config: LensConfig, complete?: boolean, prices?: PriceCatalog): CostEstimate;
export declare function cacheState(promptCache: any, now: number, at?: string): CacheState;
//# sourceMappingURL=usage.d.ts.map