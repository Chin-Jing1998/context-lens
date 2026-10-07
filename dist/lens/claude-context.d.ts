import type { Category, Measurement } from './types.js';
type Categories = Partial<Record<Category, Measurement>>;
type Estimate = (text: unknown, source: string, at: string) => Measurement | undefined;
/** Observed prompt state only. Never reads installed inventories or saves prompt content. */
export declare class ClaudeContext {
    private estimate;
    private inlineTools;
    private deferredTools;
    private instructions;
    private signatures;
    private history;
    constructor(estimate: Estimate);
    reset(categories: Categories, preserved?: string[]): void;
    private publish;
    private toolMap;
    private publishTools;
    apply(data: Record<string, any>, at: string, categories: Categories, id?: string): void;
}
export {};
//# sourceMappingURL=claude-context.d.ts.map