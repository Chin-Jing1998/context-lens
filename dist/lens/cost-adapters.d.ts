import type { CostSession } from './cost-report.js';
export interface CostSource {
    tool: string;
    toolName: string;
    format: 'opencode' | 'zcode' | 'deepseek' | 'ledger';
    path: string;
}
export declare function defaultCostSources(): CostSource[];
export declare function readSqliteCosts(source: CostSource): Promise<CostSession[]>;
export declare function walkCostFiles(root: string, suffix: RegExp, depth?: number): string[];
export declare function costLines(file: string): AsyncGenerator<any>;
/** Public accounting interchange; accepts arbitrary tool IDs, no filesystem paths or prose. */
export declare function validateCostSession(value: unknown): CostSession;
//# sourceMappingURL=cost-adapters.d.ts.map