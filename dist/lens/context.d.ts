import type { Budget, Category, Context, Measurement } from './types.js';
export declare const CATEGORIES: [Category, string, string][];
export declare const tokenNumber: (v: unknown) => number | null;
export declare const percentageNumber: (v: unknown) => number | null;
export declare function buildContext(args: {
    used: number | null;
    capacity: number | null;
    budget: Budget;
    categories?: Partial<Record<Category, Measurement>>;
    buffer?: Measurement & {
        placement: 'inside' | 'outside';
    };
    view?: 'budget' | 'model';
    at?: string;
    reportedPercent?: number | null;
    windowEstimated?: boolean;
}): Context;
//# sourceMappingURL=context.d.ts.map