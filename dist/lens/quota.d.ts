import type { QuotaLimit } from './types.js';
export declare function codexQuota(value: unknown): {
    id: string;
    limits: QuotaLimit[];
} | undefined;
export declare function claudeQuota(value: unknown): QuotaLimit[];
export declare function agyQuota(value: unknown, now: number): QuotaLimit[];
export declare function currentQuota(limits: QuotaLimit[] | undefined, now: number): QuotaLimit[] | undefined;
//# sourceMappingURL=quota.d.ts.map