import type { LensConfig, RequestUsage } from './types.js';
import { type PriceCatalog } from './pricing.js';
export interface CostSession {
    tool: string;
    toolName: string;
    id: string;
    title?: string;
    parentId?: string;
    requests: RequestUsage[];
    complete: boolean;
    excludedRequestIds?: string[];
}
export type CostPeriod = 'today' | '7d' | '14d' | 'month' | 'quarter' | 'year' | 'custom';
export interface CostQuery {
    period?: string;
    start?: string;
    end?: string;
    timeZone?: string;
    tool?: string;
    page?: number;
}
export interface CostAmount {
    amount: number | null;
    complete: boolean;
    requests: number;
}
export interface CostPair {
    period: CostAmount;
    cumulative: CostAmount;
}
export interface CostReport {
    range: {
        period: CostPeriod;
        start: string;
        end: string;
        timeZone: string;
    };
    currency: string;
    tool: string;
    tools: {
        id: string;
        name: string;
    }[];
    totals: CostPair;
    models: (CostPair & {
        model: string;
    })[];
    sessions: (CostPair & {
        tool: string;
        toolName: string;
        id: string;
        title?: string;
        lastAt: string;
    })[];
    page: number;
    pages: number;
    sessionCount: number;
    loading: boolean;
    capturedAt: string;
    diagnostics: {
        unpricedModels: string[];
        undatedRequests: number;
        incompleteSessions: number;
    };
}
export declare function costRange(query: CostQuery, now?: Date): CostReport['range'];
export declare function buildCostReport(sessions: CostSession[], config: LensConfig, query?: CostQuery, options?: {
    now?: Date;
    catalog?: PriceCatalog;
    loading?: boolean;
    failed?: boolean;
}): CostReport;
//# sourceMappingURL=cost-report.d.ts.map