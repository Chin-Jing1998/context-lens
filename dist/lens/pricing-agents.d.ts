import type { OfficialPrice } from './pricing.js';
export declare function parseAgentPrices(provider: 'deepseek' | 'mimo' | 'zai', document: string): Record<string, OfficialPrice>;
export declare function deepSeekTier(at?: string): 'standard' | 'off-peak' | undefined;
//# sourceMappingURL=pricing-agents.d.ts.map