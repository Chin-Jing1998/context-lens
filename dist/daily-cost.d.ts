import type { WeeklyCostPeriod } from './config.ts';
import type { StdinData } from './types.ts';
export declare const DAILY_COST_WRITE_THROTTLE_MS = 30000;
export type CostTotals = {
    todayUsd: number;
    weekUsd: number | null;
};
export type DailyCostDeps = {
    dataDir: () => string;
    now: () => number;
};
export declare function getDailyCostLedgerPath(dataDir: string): string;
export declare function getCostTotals(stdin: StdinData, options: {
    allowRoutedCost?: boolean;
    sevenDayResetAt?: Date | null;
    weeklyCostPeriod?: WeeklyCostPeriod;
} | undefined, deps: DailyCostDeps): CostTotals | null;
//# sourceMappingURL=daily-cost.d.ts.map