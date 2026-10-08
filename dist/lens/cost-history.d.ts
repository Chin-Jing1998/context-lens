import { type SessionFile } from './sessions.js';
import type { HudSnapshot } from './types.js';
import { type CostQuery, type CostReport } from './cost-report.js';
import { type CostSource } from './cost-adapters.js';
export declare class CostHistory {
    private sessions;
    private stamps;
    private pending?;
    private scannedAt;
    private initialized;
    private failed;
    private invalidLedger;
    private home;
    private sources;
    private native;
    constructor(options?: {
        home?: string;
        sources?: CostSource[];
        native?: () => SessionFile[];
    });
    private save;
    /** Imports are validated in full and committed as one durable batch before becoming visible. */
    import(value: unknown): number;
    refresh(force?: boolean): Promise<void>;
    report(query: CostQuery): CostReport;
    activeFiles(): (HudSnapshot['session'] & {
        lastUserAt?: number;
    })[];
    snapshot(identity: string, view: 'budget' | 'model'): HudSnapshot | undefined;
}
//# sourceMappingURL=cost-history.d.ts.map