import type { Rate, RequestUsage } from './types.js';
export declare const PRICE_SOURCES: {
    readonly openai: 'https://developers.openai.com/api/docs/pricing';
    readonly anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing';
    readonly deepseek: 'https://api-docs.deepseek.com/quick_start/pricing/';
    readonly mimo: 'https://mimo.mi.com/static/docs/price/pay-as-you-go.md';
    readonly zai: 'https://docs.z.ai/guides/overview/pricing';
};
type Provider = keyof typeof PRICE_SOURCES;
interface TierPrice {
    rates: Rate;
    longContext?: Rate;
}
export interface OfficialPrice extends TierPrice {
    threshold?: number;
    tiers?: Record<string, TierPrice>;
    timePolicy?: 'deepseek';
}
export interface ProviderPrices {
    source: string;
    checkedAt: string;
    models: Record<string, OfficialPrice>;
}
export type PriceCatalog = Record<Provider, ProviderPrices>;
/** Parse only the documented text-token tables; never infer prices from model names. */
export declare function parseOfficialPrices(provider: Provider, document: string, checkedAt: string): ProviderPrices;
export declare function readOfficialPrices(home?: string): PriceCatalog;
export declare function officialPrice(row: Pick<RequestUsage, 'model' | 'input' | 'serviceTier'> & Partial<Pick<RequestUsage, 'at' | 'timestampKnown'>>, catalog: PriceCatalog): {
    rates: Rate;
    source: string;
    checkedAt: string;
    tier: string;
} | undefined;
/** Fetch fixed public official documents only. No session content or credentials are sent. */
export declare function refreshOfficialPrices(options?: {
    home?: string;
    force?: boolean;
    fetch?: typeof fetch;
    now?: number;
}): Promise<void>;
export {};
//# sourceMappingURL=pricing.d.ts.map