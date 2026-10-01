import type { ContextUsage } from '../stdin.js';
/**
 * Format a token count into a human-readable short string.
 *   >= 1M  → "1.2M"
 *   >= 1k  → "45k"
 *   < 1k   → "800"
 */
export declare function formatTokens(n: number): string;
export declare function formatContextValue(context: ContextUsage, mode: 'percent' | 'tokens' | 'remaining' | 'both'): string;
export declare function formatSessionDuration(ms: number | null | undefined): string;
//# sourceMappingURL=format.d.ts.map