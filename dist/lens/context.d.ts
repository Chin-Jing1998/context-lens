import type { Budget, Category, Context, Measurement } from './types.js';
export declare const CATEGORIES: [Category, string, string][];
export declare const tokenNumber: (v: unknown) => number | null;
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
}): Context;
//# sourceMappingURL=context.d.ts.map